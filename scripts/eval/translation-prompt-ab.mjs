#!/usr/bin/env node
// PRIOR ART: scripts/eval/prompt-ab.mjs — paired repeated-measures A/B for the OCR prompt.
// Same house design (paired arms, pre-registered outcomes, lib/paired-stats.mjs), but it is
// image-in and its estimand is reproducibility of a reading on ten PINNED pathological pages;
// this is text-in over a fresh stratified draw and its estimand is a RATE. Its metrics
// (jaccard agreement, body_len on hand-picked pages) do not answer "are the citations real".
// Also checked: scripts/eval/prompt-ablation.mjs (OCR structured-metadata ablation),
// scripts/eval/qa-eval.mjs (consistency/cross-model, no arm concept),
// scripts/eval/ocr-prompt-v17-acceptance.mjs (acceptance, not A/B). Verification itself is
// NOT reimplemented: it comes from scripts/lib/page-terms-parse.mjs, the same parser
// scripts/maintenance/build-page-terms.mjs uses to produce the corpus-wide 91%.
/** Paired A/B of translation prompt v13 vs v15 (#3825): verified-note rate, note emission, invented/housekeeping tags, glossary blocks, with a numeric pre-registered flip rule. */
/**
 * translation-prompt-ab.mjs — does translation prompt v15 make original-notes real? (#3825)
 *
 * ── The decision this exists to change ─────────────────────────────────────
 * One thing: flip the default translation prompt from v13 to v15, or don't.
 * v15 adds five rules (#3825), of which item 2 is the one with a measurable
 * target: the phrase inside <note>original: "…"</note> must be copied
 * character-for-character from the OCR of that page, or the note is omitted.
 * The #3308 census put fabrication in those notes at 12.2%; the page_terms
 * harvest (#4695) verifies 91% corpus-wide. Those notes are read as CITATIONS.
 *
 * ── The estimand, and why it is reference-free ─────────────────────────────
 * There is no reference translation, and there will not be one. But the
 * original-note rule is self-checking: the quoted phrase either occurs in the
 * OCR of the page or it does not, and that is decidable with string search, no
 * labels and no judge. So the primary outcome is the VERIFIED-NOTE RATE, using
 * the same verifier that produced the corpus figure.
 *
 * ── How a prompt could game it ─────────────────────────────────────────────
 * By emitting no notes at all: 0/0 is not a defeat under a ratio. So NOTE
 * EMISSION is a pre-registered co-primary with a floor, not a footnote. Three
 * further outcomes cover the other #3825 items and the obvious regressions:
 * invented tags (item 1), housekeeping-tag leakage (item 4), standalone
 * glossary blocks (item 3), plus body length as a content-loss proxy.
 *
 * ── Design ─────────────────────────────────────────────────────────────────
 * - PAIRED: both arms translate the SAME pages, same model, same settings.
 * - ONE PAGE PER BOOK. Pages inside a book share a scan, a hand and a
 *   translation chain; they are one observation. n is books, not pages.
 * - STRATIFIED by script and by print/manuscript, because fabrication is
 *   expected to be script-dependent (Tibetan cursive ran 31-35% cross-run
 *   agreement against 87-93% on printed Latin, #4523).
 * - k=1 per (page, arm), deliberately, and NOT in contradiction with
 *   prompt-ab.mjs's k>=5 rule. That harness needed repeats because its outcome
 *   was body length on ~10 pinned pathological pages, where within-page
 *   sampler variance dwarfs the arm effect. Here the outcome is a rate over
 *   ~320 independent pages: precision comes from n, and spending the same
 *   budget on repeats of fewer pages would buy less of it. The cost is that
 *   this harness cannot say anything about per-page stability — it is not
 *   asked to.
 * - PRE-REGISTERED: hypothesis, sample size and decision rule are fixed in
 *   scripts/eval/PREREGISTRATION-translation-prompt-v15.md BEFORE the run, and
 *   the flip threshold there is a number.
 *
 * ── Phases (only `run` costs money) ────────────────────────────────────────
 *   --draw     build + pin the stratified sample, print the cost estimate   FREE
 *   --run      translate every page under both arms                         PAID
 *   --score    metrics, paired statistics, verdict against the rule         FREE
 *   --judge-packet  emit blinded pairs for the Claude regression judge      FREE
 *
 * `--run` REFUSES to start without `--approved-usd <n>` at least as large as
 * the printed estimate. Derek approves spend explicitly, every time.
 *
 *   node --env-file=.env.production.local scripts/eval/translation-prompt-ab.mjs --draw --per-stratum 40
 *   node --env-file=.env.production.local scripts/eval/translation-prompt-ab.mjs --run --approved-usd 5
 *   node --env-file=.env.production.local scripts/eval/translation-prompt-ab.mjs --score
 *   node --env-file=.env.production.local scripts/eval/translation-prompt-ab.mjs --judge-packet --pairs 30
 *
 * NOTHING here writes to `pages`. Outputs land in scripts/eval/results/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTranslationTerms } from '../lib/page-terms-parse.mjs';
import { buildTranslationPrompt, translatablePageFilter, SAFETY_SETTINGS, sanitizeTranslationTags, getTranslateModelForBook } from '../lib/translate-core.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { sampleOnePagePerBook, connect, disconnect } from './lib/sampling.mjs';
import { diffCI, binomTwoSided, bootstrapRatioCI, resetSeed, seededRand, mean } from './lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const RESULTS = new URL('./results/', import.meta.url).pathname;
const SAMPLE_FILE = arg('sample', path.join(RESULTS, 'translation-prompt-v15-sample.json'));
const OUT_FILE = arg('out', path.join(RESULTS, 'translation-prompt-v15-arms.jsonl'));
const A_VER = Number(arg('a', 13));
const B_VER = Number(arg('b', 15));
const MODEL = arg('model', 'gemini-3.1-flash-lite');
const PER_STRATUM = Number(arg('per-stratum', 40));
const CONCURRENCY = Number(arg('concurrency', 4));
/**
 * `--route`: use production's per-book model routing (BPH and non-Latin-script
 * books → gemini-3-flash-preview, the rest → lite) instead of one model for all.
 * Both arms always share a model for a given page either way; --route makes the
 * arm effect observable under the model each stratum actually ships on, at about
 * 2x the cost on the five non-Latin strata. The draw prints both estimates.
 */
const ROUTE = has('route');
const bookOf = (r) => ({ id: r.bookId, title: r.bookTitle, display_title: r.bookTitle, author: r.author, published: r.year, language: r.language, image_source: { provider: r.provider } });
const modelFor = (r) => (ROUTE ? getTranslateModelForBook(bookOf(r)) : MODEL);

/**
 * The draw. Each stratum is a declared claim about what it samples, not a label.
 *
 * The print/manuscript axis is a PROXY: `books` has no manuscript flag (checked
 * 2026-09-12 — `material` and `medium` are empty on every book with OCR, and
 * `format` is null on 62,947 of 63,913). Provider and language are the honest
 * stand-ins, so the axis is named `mode` and its value is asserted here rather
 * than read from a field that does not exist.
 */
const PRINT_PROVIDERS = ['internet_archive', 'mdz', 'e-rara', 'bsb', 'sbb', 'gallica', 'goettingen', 'slub_dresden', 'google_books'];
const STRATA = [
  { id: 'latin-print',  mode: 'print',      script: 'latin',  filter: { language: 'Latin',   'image_source.provider': { $in: PRINT_PROVIDERS } } },
  { id: 'german-print', mode: 'print',      script: 'latin',  filter: { language: 'German',  'image_source.provider': { $in: PRINT_PROVIDERS } } },
  { id: 'greek-print',  mode: 'print',      script: 'greek',  filter: { language: 'Greek',   'image_source.provider': { $in: PRINT_PROVIDERS } } },
  { id: 'hebrew',       mode: 'mixed',      script: 'hebrew', filter: { language: 'Hebrew' } },
  { id: 'arabic',       mode: 'mixed',      script: 'arabic', filter: { language: 'Arabic' } },
  { id: 'cjk-print',    mode: 'print',      script: 'cjk',    filter: { language: 'Chinese' } },
  { id: 'bph-mss',      mode: 'manuscript', script: 'latin',  filter: { 'image_source.provider': 'bph' } },
  { id: 'tibetan-mss',  mode: 'manuscript', script: 'tibetan', filter: { language: 'Tibetan' } },
];

// ── tag vocabularies (the contract v15 declares) ────────────────────────────
/** Tags the translation prompt defines as OUTPUT. Anything else in a translation is a defect. */
const ALLOWED = new Set(['meta', 'note', 'term', 'gloss', 'margin', 'insert', 'unclear', 'column-break', 'warning', 'summary', 'keywords']);
/** OCR housekeeping — legal in the INPUT, never in the output (#3825 item 4). */
const HOUSEKEEPING = new Set(['vocab', 'language', 'lang', 'page-type', 'page-num', 'sig', 'scan-quality', 'script', 'columns', 'header', 'image-desc', 'folio', 'abbrev', 'detected-images', 'catchword']);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
/** Free-text glossary block, the shape #3811 had to teach the renderer to tolerate (#3825 item 3). */
const GLOSSARY_RE = /(?:^|\n)\s*\*{0,2}(?:Vocabulary(?:\s+used)?(?:\s+in\s+this\s+(?:passage|page))?|Key\s+(?:vocabulary|terms|words)|Glossary)\s*:?\s*\*{0,2}\s*\n/i;
/** …or a run of >=3 term/gloss pairs, one per LINE, with no prose between them.
 *  Line-per-entry is what distinguishes a glossary from three terms in one sentence. */
const TERM_RUN_RE = /(?:<term>[^<]*<\/term>\s*<gloss>[^<]*<\/gloss>[ \t*\-–—:,;.]*\n\s*){2,}<term>[^<]*<\/term>\s*<gloss>[^<]*<\/gloss>/i;

function tagStats(text) {
  const t = text || '';
  const counts = { allowed: 0, housekeeping: 0, invented: 0 };
  const inventedNames = new Set();
  const housekeepingNames = new Set();
  for (const m of t.matchAll(TAG_RE)) {
    const name = m[1].toLowerCase();
    if (ALLOWED.has(name)) counts.allowed++;
    else if (HOUSEKEEPING.has(name)) { counts.housekeeping++; housekeepingNames.add(name); }
    else { counts.invented++; inventedNames.add(name); }
  }
  return { ...counts, inventedNames: [...inventedNames], housekeepingNames: [...housekeepingNames] };
}

/**
 * Prose body: apparatus removed, whitespace collapsed. Used as the content-loss
 * proxy, so it must EXCLUDE the two things v15 removes BY DESIGN — a standalone
 * glossary block (item 3) and an original-note's quoted citation (item 2) —
 * or the gate would fire on the intended change and never on an actual loss.
 * Interpretive <note>…</note> prose stays in: losing that IS a regression.
 */
const GLOSSARY_BLOCK_RE = /(?:^|\n)\s*\*{0,2}(?:Vocabulary(?:\s+used)?(?:\s+in\s+this\s+(?:passage|page))?|Key\s+(?:vocabulary|terms|words)|Glossary)\s*:?\s*\*{0,2}\s*\n[\s\S]*?(?=\n<summary>|\n<keywords>|$)/i;
function bodyText(text) {
  const wrappers = 'meta|summary|keywords|warning|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc';
  return (text || '')
    .replace(GLOSSARY_BLOCK_RE, ' ')
    .replace(TERM_RUN_RE, ' ')
    .replace(/<note(?:\s[^>]*)?>\s*original:\s*["“«'][^<]{0,120}<\/note>/gi, ' ')
    .replace(new RegExp(`<(${wrappers})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')   // "water ." left behind by a removed note is not a char of prose
    .trim();
}

/**
 * Every pre-registered outcome for one (page, arm), from the translation text and
 * the OCR it was made from. Note verification is `parseTranslationTerms`, the
 * build-page-terms.mjs parser — not a second implementation of the same check.
 */
export function scoreTranslation(translationText, ocrText) {
  const rows = parseTranslationTerms(translationText, ocrText);
  const originals = rows.filter((r) => r.kind === 'original');
  const verified = originals.filter((r) => r.verified === true).length;
  const tags = tagStats(translationText);
  const body = bodyText(translationText);
  return {
    notes_emitted: originals.length,
    notes_verified: verified,
    // null, not 0, when the page emitted no notes: a page with nothing to verify
    // contributes to emission and must not be scored as 0% verified.
    verified_rate: originals.length ? verified / originals.length : null,
    terms_emitted: rows.filter((r) => r.kind === 'term').length,
    // Terms that sit IN the prose, i.e. what the learn route's flashcards and the
    // reader chips actually get. Item 3 removes glossary-block terms by design,
    // so total terms will fall; inline terms must not.
    inline_terms: (((translationText || '').replace(GLOSSARY_BLOCK_RE, ' ').replace(TERM_RUN_RE, ' ')).match(/<term(?:\s[^>]*)?>/gi) || []).length,
    keywords_emitted: rows.filter((r) => r.kind === 'keyword').length,
    invented_tags: tags.invented,
    invented_names: tags.inventedNames,
    housekeeping_tags: tags.housekeeping,
    housekeeping_names: tags.housekeepingNames,
    glossary_block: GLOSSARY_RE.test(translationText || '') || TERM_RUN_RE.test(translationText || ''),
    emdashes: (body.match(/—/g) || []).length,
    body_chars: body.length,
  };
}

// ── phase: draw ─────────────────────────────────────────────────────────────
async function phaseDraw() {
  const pageFilter = translatablePageFilter();
  const sample = [];
  for (const s of STRATA) {
    const rows = await sampleOnePagePerBook({
      bookFilter: { ...s.filter, pages_ocr: { $gte: 5 } },
      pageFilter,
      n: PER_STRATUM,
      minOcrChars: 200,
    });
    for (const r of rows) sample.push({ stratum: s.id, mode: s.mode, script: s.script, ...r });
    console.log(`${s.id.padEnd(14)} drew ${String(rows.length).padStart(3)}/${PER_STRATUM}` +
      (rows.length < PER_STRATUM ? '   (stratum exhausted — reported, not silently padded)' : ''));
  }
  const books = new Set(sample.map((r) => r.bookId));
  if (books.size !== sample.length) throw new Error(`draw is not one-page-per-book: ${sample.length} pages from ${books.size} books`);

  const ocrChars = sample.reduce((n, r) => n + r.ocrChars, 0);
  const est = estimate(sample);
  const payload = {
    drawn_at: new Date().toISOString(),
    model: MODEL, arms: [A_VER, B_VER], per_stratum: PER_STRATUM,
    n_pages: sample.length, n_books: books.size, ocr_chars: ocrChars,
    estimate: { flat: { model: MODEL, usd: estimate(sample, () => MODEL).usd }, routed: estimate(sample, (r) => getTranslateModelForBook(bookOf(r))) },
    strata: STRATA.map(({ id, mode, script }) => ({ id, mode, script, n: sample.filter((r) => r.stratum === id).length })),
    sample,
  };
  fs.mkdirSync(path.dirname(SAMPLE_FILE), { recursive: true });
  fs.writeFileSync(SAMPLE_FILE, JSON.stringify(payload, null, 1));
  console.log(`\nn = ${sample.length} pages from ${books.size} books, ${ocrChars.toLocaleString()} OCR chars`);
  const flat = estimate(sample, () => MODEL);
  const routed = estimate(sample, (r) => getTranslateModelForBook(bookOf(r)));
  console.log(`calls = ${est.calls} (${sample.length} pages x 2 arms); in ~${est.inputTokens.toLocaleString()} tok, out ~${est.outputTokens.toLocaleString()} tok`);
  console.log(`ESTIMATE, one model for all (${MODEL}):      $${flat.usd.toFixed(2)}`);
  console.log(`ESTIMATE, production routing (--route):        $${routed.usd.toFixed(2)}   ${Object.entries(routed.models).map(([m, n]) => `${m}: ${n} calls`).join(', ')}`);
  console.log(`wrote ${SAMPLE_FILE}`);
  console.log(`\nPAID STEP NOT RUN. To run it: --run --approved-usd ${Math.ceil(flat.usd * 100) / 100}   (or --run --route --approved-usd ${Math.ceil(routed.usd * 100) / 100})`);
}

/**
 * Cost from the drawn sample's real OCR chars, not a per-page rule of thumb.
 * Input  ~= (prompt + OCR + metadata + 2000 chars of previous-page context) / 4.
 * Output ~= 0.35 tokens per OCR char — the worker's own generation cap uses
 * ~0.3 (scripts/workers/translate-worker.mjs maxOutputTokensFor), rounded up.
 */
function estimate(sample, chooser = modelFor, promptChars = 11200) {
  let inputTokens = 0, outputTokens = 0, usd = 0;
  const models = {};
  for (const r of sample) {
    const m = chooser(r);
    const price = priceFor(m);
    models[m] = (models[m] || 0) + 2;
    // two arms per page, identical input shape
    const inTok = 2 * Math.ceil((promptChars + r.ocrChars + 2300) / 4);
    const outTok = 2 * Math.ceil(r.ocrChars * 0.35);
    inputTokens += inTok; outputTokens += outTok;
    usd += (inTok / 1e6) * price.input + (outTok / 1e6) * price.output;
  }
  return { calls: sample.length * 2, inputTokens, outputTokens, usd, models };
}

// ── phase: run (PAID) ───────────────────────────────────────────────────────
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function gemini(promptText, maxOutputTokens, model = MODEL) {
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
  if (!key) throw new Error('no GEMINI_API_KEY');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          safetySettings: SAFETY_SETTINGS,
          // thinkingBudget 0 is the production setting; Gemini 3.x otherwise
          // thinks by default and bills it at the output rate, invisibly (#4581).
          generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(180000),
      });
      const j = await r.json();
      if (r.ok) {
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
        const u = j.usageMetadata || {};
        return { text, inTok: u.promptTokenCount || 0, outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), finish: j.candidates?.[0]?.finishReason || null };
      }
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 4000 * (attempt + 1))); continue; }
      return { error: `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e) {
      if (attempt === 3) return { error: String(e.message || e).slice(0, 200) };
      await new Promise((s) => setTimeout(s, 4000 * (attempt + 1)));
    }
  }
  return { error: 'retries exhausted' };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function phaseRun() {
  const payload = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const est = estimate(payload.sample);   // honours --route
  const approved = Number(arg('approved-usd', 0));
  if (!(approved >= est.usd)) {
    console.error(`REFUSING TO SPEND. Estimate $${est.usd.toFixed(2)} for ${est.calls} calls${ROUTE ? ' (production routing)' : ` (all on ${MODEL})`}; --approved-usd is ${approved || 'absent'}.`);
    console.error('Derek approves spend explicitly. Re-run with --approved-usd >= the estimate once he has.');
    process.exit(2);
  }

  const { db } = await connect();
  const col = db.collection('prompts');
  const armRow = {};
  for (const v of [A_VER, B_VER]) {
    const row = await col.findOne({ type: 'translation', version: v });
    if (!row) throw new Error(`translation prompt v${v} not found`);
    armRow[v] = row;
    console.log(`arm v${v}: ${row.name} ${row.content.length} chars hash=${(row.content_hash || '').slice(0, 8)} default=${!!row.is_default}`);
  }
  // The two arms must actually differ, and the one we intend to ship must be the
  // non-default candidate. A silent assignment bug would produce a null result
  // that looks like "no effect".
  if (armRow[A_VER].content === armRow[B_VER].content) throw new Error('both arms load the SAME prompt text');

  const stream = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  const done = new Set();
  if (fs.existsSync(OUT_FILE)) {
    for (const line of fs.readFileSync(OUT_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); done.add(`${r.bookId}:${r.pageNumber}:${r.arm}`); } catch { /* partial line */ }
    }
    if (done.size) console.log(`resuming: ${done.size} (page, arm) results already on disk`);
  }

  const jobs = [];
  for (const r of payload.sample) for (const v of [A_VER, B_VER]) {
    if (!done.has(`${r.bookId}:${r.pageNumber}:${v}`)) jobs.push({ r, v });
  }
  console.log(`${jobs.length} calls to make (of ${payload.sample.length * 2}); models: ${Object.entries(est.models).map(([m, n]) => `${m} x${n}`).join(', ')}\n`);

  let spent = 0, n = 0;
  await pool(jobs, CONCURRENCY, async ({ r, v }) => {
    const book = bookOf(r);
    const model = modelFor(r);
    // Same door the pipeline uses, with the arm's prompt substituted for the default.
    const { prompt } = buildTranslationPrompt({
      prompts: { translation: { text: armRow[v].content, ref: {} }, english: { text: armRow[v].content, ref: {} } },
      book, ocrText: r.ocrText, previousTranslation: null,
    });
    const maxOut = Math.min(32768, Math.max(4096, Math.ceil(r.ocrChars) + 1200));
    const res = await gemini(prompt, maxOut, model);
    const price = priceFor(model);
    const cost = res.error ? 0 : (res.inTok / 1e6) * price.input + (res.outTok / 1e6) * price.output;
    spent += cost;
    stream.write(JSON.stringify({
      bookId: r.bookId, pageNumber: r.pageNumber, stratum: r.stratum, mode: r.mode, script: r.script,
      language: r.language, arm: v, model, ocrChars: r.ocrChars,
      text: res.error ? null : sanitizeTranslationTags(res.text),
      error: res.error || null, finish: res.finish || null,
      inTok: res.inTok || 0, outTok: res.outTok || 0, cost_usd: cost,
      at: new Date().toISOString(),
    }) + '\n');
    if (++n % 25 === 0) console.log(`  ${n}/${jobs.length}  spent $${spent.toFixed(3)}`);
  });
  stream.end();
  console.log(`\ndone: ${n} calls, actual spend $${spent.toFixed(3)} (estimate was $${est.usd.toFixed(2)})`);
  console.log(`wrote ${OUT_FILE}`);
}

// ── phase: score ────────────────────────────────────────────────────────────
/** Pooled rate with a bootstrap CI clustered on the PAGE (the sampling unit). */
function pooledRate(pages, num, den) {
  resetSeed();
  const r = bootstrapRatioCI(pages.map(num), pages.map(den));
  return { rate: r.rate, ci: r.ci, n: r.units, denom: r.denom };
}

function phaseScore() {
  const rows = fs.readFileSync(OUT_FILE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const byPage = new Map();
  for (const r of rows) {
    const k = `${r.bookId}:${r.pageNumber}`;
    if (!byPage.has(k)) byPage.set(k, { key: k, stratum: r.stratum, mode: r.mode, script: r.script, arms: {} });
    byPage.get(k).arms[r.arm] = r;
  }
  const sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')).sample;
  const ocrByKey = new Map(sample.map((s) => [`${s.bookId}:${s.pageNumber}`, s.ocrText]));

  const pages = [];
  let dropped = 0;
  for (const p of byPage.values()) {
    const a = p.arms[A_VER], b = p.arms[B_VER];
    if (!a?.text || !b?.text) { dropped++; continue; }   // a page is usable only if BOTH arms produced text
    const ocr = ocrByKey.get(p.key);
    pages.push({ ...p, a: scoreTranslation(a.text, ocr), b: scoreTranslation(b.text, ocr) });
  }
  console.log(`pages scored: ${pages.length}   dropped (an arm errored): ${dropped}\n`);
  if (!pages.length) { console.log('nothing to score'); return; }

  const report = { at: new Date().toISOString(), arms: [A_VER, B_VER], model: MODEL, n_pages: pages.length, dropped };

  // ── primary: verified-note rate ──
  const vA = pooledRate(pages, (p) => p.a.notes_verified, (p) => p.a.notes_emitted);
  const vB = pooledRate(pages, (p) => p.b.notes_verified, (p) => p.b.notes_emitted);
  const paired = pages.filter((p) => p.a.notes_emitted > 0 && p.b.notes_emitted > 0);
  resetSeed();
  const pairedDelta = paired.length >= 2
    ? diffCI(paired.map((p) => p.a.verified_rate), paired.map((p) => p.b.verified_rate))
    : null;
  const better = paired.filter((p) => p.b.verified_rate > p.a.verified_rate).length;
  const worse = paired.filter((p) => p.b.verified_rate < p.a.verified_rate).length;

  report.verified_rate = { a: vA, b: vB, paired_n: paired.length, paired_delta: pairedDelta, better, worse,
    sign_p: binomTwoSided(better, better + worse) };

  // ── co-primary: note emission (the way to game the rate is to stop writing notes) ──
  const emitA = mean(pages.map((p) => p.a.notes_emitted));
  const emitB = mean(pages.map((p) => p.b.notes_emitted));
  resetSeed();
  report.note_emission = { a: emitA, b: emitB, relative: emitA ? (emitB - emitA) / emitA : null,
    delta: diffCI(pages.map((p) => p.a.notes_emitted), pages.map((p) => p.b.notes_emitted)) };

  // ── regression gates ──
  /**
   * A gate fires only on a change that is BOTH statistically decisive (95% CI
   * excludes zero) AND, where a floor is given, larger than that floor in
   * relative terms. Defect counts (invented tags, leakage) have no floor: any
   * decisive increase is a regression. Volume proxies (body, inline terms) do,
   * because with n≈300 a 1% drift can be decisive and is not a loss anyone
   * would notice — the floors are the ones in the preregistration.
   */
  const gate = (label, f, direction, floor = 0) => {
    resetSeed();
    const d = diffCI(pages.map((p) => f(p.a)), pages.map((p) => f(p.b)));
    const a = mean(pages.map((p) => f(p.a))), b = mean(pages.map((p) => f(p.b)));
    const rel = a ? (b - a) / a : null;
    const wrongWay = direction === 'lower-is-better' ? (d?.decisive && d.delta > 0) : (d?.decisive && d.delta < 0);
    const beyondFloor = floor === 0 || rel == null || Math.abs(rel) > floor;
    return { label, a, b, delta: d?.delta ?? null, relative: rel, ci: d?.ci ?? null, decisive: !!d?.decisive, floor, regressed: !!(wrongWay && beyondFloor) };
  };
  report.gates = [
    gate('invented tags / page', (s) => s.invented_tags, 'lower-is-better'),
    gate('housekeeping tags / page', (s) => s.housekeeping_tags, 'lower-is-better'),
    gate('glossary block (0/1)', (s) => (s.glossary_block ? 1 : 0), 'lower-is-better'),
    gate('em-dashes / page', (s) => s.emdashes, 'lower-is-better'),
    gate('body chars / page', (s) => s.body_chars, 'higher-is-better', 0.10),
    gate('inline terms / page', (s) => s.inline_terms, 'higher-is-better', 0.20),
  ];
  // Descriptive only — total terms are EXPECTED to fall when glossary blocks go.
  report.descriptive = {
    terms_total: { a: mean(pages.map((p) => p.a.terms_emitted)), b: mean(pages.map((p) => p.b.terms_emitted)) },
    keywords: { a: mean(pages.map((p) => p.a.keywords_emitted)), b: mean(pages.map((p) => p.b.keywords_emitted)) },
  };
  const bodyA = mean(pages.map((p) => p.a.body_chars)), bodyB = mean(pages.map((p) => p.b.body_chars));
  report.body_relative = bodyA ? (bodyB - bodyA) / bodyA : null;

  // ── per stratum, because fabrication is expected to be script-dependent ──
  report.by_stratum = [...new Set(pages.map((p) => p.stratum))].map((id) => {
    const ps = pages.filter((p) => p.stratum === id);
    return {
      stratum: id, n: ps.length,
      a: pooledRate(ps, (p) => p.a.notes_verified, (p) => p.a.notes_emitted),
      b: pooledRate(ps, (p) => p.b.notes_verified, (p) => p.b.notes_emitted),
      emit_a: mean(ps.map((p) => p.a.notes_emitted)), emit_b: mean(ps.map((p) => p.b.notes_emitted)),
    };
  });

  // ── the PRE-REGISTERED decision rule, applied verbatim ──
  const THRESHOLD_PP = 3;      // percentage points, fixed in PREREGISTRATION-translation-prompt-v15.md
  const EMISSION_FLOOR = -0.20; // note emission may not fall more than 20% relative
  const BODY_FLOOR = -0.10;    // body length may not fall more than 10% relative
  const criteria = {
    'paired CI on verified-rate excludes zero and is positive': !!(pairedDelta?.decisive && pairedDelta.delta > 0),
    [`verified-rate gain >= ${THRESHOLD_PP}pp`]: (vB.rate != null && vA.rate != null) && (vB.rate - vA.rate) >= THRESHOLD_PP / 100,
    [`note emission not down more than ${Math.abs(EMISSION_FLOOR) * 100}%`]: report.note_emission.relative == null || report.note_emission.relative >= EMISSION_FLOOR,
    [`body length not down more than ${Math.abs(BODY_FLOOR) * 100}%`]: report.body_relative == null || report.body_relative >= BODY_FLOOR,
    'no regression gate fired': report.gates.every((g) => !g.regressed),
  };
  report.criteria = criteria;
  report.recommendation = Object.values(criteria).every(Boolean) ? 'FLIP (recommend v15 as default)' : 'DO NOT FLIP (not established)';
  report.note = 'The blind Claude regression judge (--judge-packet) is a separate gate and is NOT included above; both must pass.';

  // ── print ──
  const pct = (x) => (x == null ? '  —  ' : (x * 100).toFixed(1) + '%');
  console.log('═══ PRIMARY: verified-note rate (pooled, bootstrap CI clustered on page) ═══');
  console.log(`  v${A_VER}: ${pct(vA.rate)}  [${pct(vA.ci?.[0])}, ${pct(vA.ci?.[1])}]   over ${vA.denom} notes on ${vA.n} pages`);
  console.log(`  v${B_VER}: ${pct(vB.rate)}  [${pct(vB.ci?.[0])}, ${pct(vB.ci?.[1])}]   over ${vB.denom} notes on ${vB.n} pages`);
  console.log(`  paired (${paired.length} pages emitting notes in BOTH arms): Δ=${pct(pairedDelta?.delta)} ` +
    `95% CI [${pct(pairedDelta?.ci?.[0])}, ${pct(pairedDelta?.ci?.[1])}]  ${pairedDelta?.decisive ? 'decisive' : 'not decisive'}`);
  console.log(`  sign test: ${better} pages better, ${worse} worse, p=${report.verified_rate.sign_p.toFixed(3)}\n`);
  console.log('═══ CO-PRIMARY: note emission (a prompt that stops writing notes has not won) ═══');
  console.log(`  notes/page  v${A_VER} ${emitA.toFixed(2)}  v${B_VER} ${emitB.toFixed(2)}  (${pct(report.note_emission.relative)} relative)\n`);
  console.log('═══ GATES ═══');
  for (const g of report.gates) {
    console.log(`  ${g.label.padEnd(26)} v${A_VER} ${g.a.toFixed(2).padStart(9)}   v${B_VER} ${g.b.toFixed(2).padStart(9)}   Δ=${(g.delta ?? 0).toFixed(2).padStart(9)}${g.relative != null ? ` (${(g.relative * 100).toFixed(1)}%)`.padStart(10) : ''}  ${g.decisive ? 'decisive' : ''}${g.floor ? ` floor ${g.floor * 100}%` : ''}${g.regressed ? '  ← REGRESSION' : ''}`);
  }
  console.log(`  (descriptive) terms total/page  v${A_VER} ${report.descriptive.terms_total.a.toFixed(2)}  v${B_VER} ${report.descriptive.terms_total.b.toFixed(2)}   keywords/page  v${A_VER} ${report.descriptive.keywords.a.toFixed(2)}  v${B_VER} ${report.descriptive.keywords.b.toFixed(2)}`);
  console.log('\n═══ BY STRATUM (verified-note rate) ═══');
  for (const s of report.by_stratum) {
    console.log(`  ${s.stratum.padEnd(14)} n=${String(s.n).padStart(3)}   v${A_VER} ${pct(s.a.rate)} (${s.a.denom || 0} notes)   v${B_VER} ${pct(s.b.rate)} (${s.b.denom || 0} notes)   emit ${s.emit_a.toFixed(1)}→${s.emit_b.toFixed(1)}`);
  }
  console.log('\n═══ DECISION RULE (pre-registered; not rewritten after seeing this) ═══');
  for (const [k, v] of Object.entries(criteria)) console.log(`  [${v ? 'x' : ' '}] ${k}`);
  console.log(`\n  ⇒ ${report.recommendation}`);
  console.log('  (the blind Claude regression judge is the other gate — run --judge-packet)');

  const out = path.join(RESULTS, `translation-prompt-v15-report-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`\nwrote ${out}`);
}

// ── phase: judge packet ─────────────────────────────────────────────────────
/**
 * Blinded pairs for the secondary regression check. Arm labels are stripped and
 * the left/right assignment is randomised per pair, so the judge cannot learn
 * which side is the candidate. The key is written separately.
 */
function phaseJudgePacket() {
  const PAIRS = Number(arg('pairs', 30));
  const rows = fs.readFileSync(OUT_FILE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')).sample;
  const ocrByKey = new Map(sample.map((s) => [`${s.bookId}:${s.pageNumber}`, s.ocrText]));
  const byPage = new Map();
  for (const r of rows) {
    const k = `${r.bookId}:${r.pageNumber}`;
    if (!byPage.has(k)) byPage.set(k, {});
    byPage.get(k)[r.arm] = r;
  }
  const usable = [...byPage.entries()].filter(([, v]) => v[A_VER]?.text && v[B_VER]?.text);
  // Deterministic spread across strata rather than the first 30, which would be
  // one stratum: the judge's 30 must look like the draw.
  const byStratum = new Map();
  for (const [k, v] of usable) {
    const s = v[A_VER].stratum;
    if (!byStratum.has(s)) byStratum.set(s, []);
    byStratum.get(s).push([k, v]);
  }
  const picked = [];
  let round = 0;
  while (picked.length < PAIRS && round < 200) {
    for (const list of byStratum.values()) { if (list[round] && picked.length < PAIRS) picked.push(list[round]); }
    round++;
  }
  resetSeed();
  const packet = [], key = [];
  for (const [k, v] of picked) {
    const flip = seededRand() < 0.5;
    packet.push({
      id: k, stratum: v[A_VER].stratum, language: v[A_VER].language,
      ocr: ocrByKey.get(k),
      left: flip ? v[B_VER].text : v[A_VER].text,
      right: flip ? v[A_VER].text : v[B_VER].text,
    });
    key.push({ id: k, left: flip ? B_VER : A_VER, right: flip ? A_VER : B_VER });
  }
  const pf = path.join(RESULTS, 'translation-prompt-v15-judge-packet.jsonl');
  const kf = path.join(RESULTS, 'translation-prompt-v15-judge-key.json');
  fs.writeFileSync(pf, packet.map((p) => JSON.stringify(p)).join('\n') + '\n');
  fs.writeFileSync(kf, JSON.stringify(key, null, 1));
  console.log(`wrote ${packet.length} blinded pairs to ${pf}`);
  console.log(`key (do NOT give this to the judge): ${kf}`);
  console.log('\nJudge question, per pair — ask a Claude subagent, one pair at a time:');
  console.log('  "Here is a page of OCR and two English translations of it, A and B.');
  console.log('   Does either translation LOSE something the other keeps: a phrase left');
  console.log('   untranslated, an annotation that explained something, a passage dropped?');
  console.log('   Answer LEFT_WORSE, RIGHT_WORSE, or EQUIVALENT, then one sentence of why."');
}

// ── main ────────────────────────────────────────────────────────────────────
// Guarded so `scoreTranslation` can be imported by tests/unit/translation-prompt-ab-metrics.test.ts
// without the module opening a Mongo connection or reading argv.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  try {
    if (has('draw')) await phaseDraw();
    else if (has('run')) await phaseRun();
    else if (has('score')) phaseScore();
    else if (has('judge-packet')) phaseJudgePacket();
    else console.log('one of --draw | --run | --score | --judge-packet (see the header)');
  } finally {
    await disconnect().catch(() => {});
  }
}
