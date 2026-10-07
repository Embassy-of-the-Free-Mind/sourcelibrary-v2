#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-restraint-ab.mjs — the #5305 restraint A/B on the same #5274
// audit pages; its sample.jsonl (OCR + prev/next context + previous translation) is REUSED as the
// page context here, and its Batch submit/collect/packet shape is followed. It tests a prompt line
// for bridging; this tests a pre-model GATE plus a prompt contract for illegible pages.
// scripts/eval/garble-detector-5313.mjs — the $0 lexicon garble score against the same judge; its
// result (P 0.24–0.60, R 0.09–0.19) is cited, not re-run (the lexicon is not on Hetzner).
// scripts/eval/two-read-garble-5313.mjs — the second-read detector; cited, not re-run.
/**
 * illegible-gate-5305 — what should the translator OUTPUT for a page nobody could read? (#5305, #4883)
 *
 * Phases (only --submit costs money; run on Hetzner):
 *   --ngram-sample  pull ~300 OCR pages per audit language from books OUTSIDE the audit      FREE
 *   --measure       step 1 (OCR self-report on the judge's garble positives, by OCR prompt
 *                   version) + step 2 (char-trigram plausibility, with a positive control)
 *                   + the gate's verdict on every judged page                                FREE
 *   --corpus        the gate over every page of N random translated books: fire rate by kind,
 *                   and the flagged pages written out for a hand read                         FREE
 *   --draw          pin the A/B sample and the arm prompts, print the cost estimate           FREE
 *   --submit        one Batch job per model         PAID, needs --approved-usd ≥ estimate
 *   --collect       poll, download, meter to gemini_usage                                     FREE
 *   --packets       blinded judge packets of the non-withheld outputs                         FREE
 *   --score         verdicts + mechanical withholds → the pre-registered table                FREE
 *
 * Arms (pre-registration: scripts/eval/PREREGISTRATION-illegible-gate.md):
 *   A   production translation prompt (v13, pinned by hash), flash-lite, Batch
 *   A2  A again — the noise floor
 *   C   A + the contract clause (the model itself emits <warning>Illegible: …</warning>)
 *   G   the pre-model gate applied to A — $0, no call: a gated page's output is the contract warning
 *
 * NOTHING here writes to `pages` or `prompts`. Outputs land in --dir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildTranslationPrompt, SAFETY_SETTINGS, sanitizeTranslationTags, PAGE_BREAK_SCOPED } from '../lib/translate-core.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { garbleBody } from '../lib/ocr-garble-score.mjs';
import { illegibleSourceVerdict, illegibleWarning, isIllegibleWarningOnly } from '../lib/illegible-source-gate.mjs';
import { createThenDeleteInput } from '../lib/gemini-batch-input-file.mjs';
import { resetSeed, seededRand } from './lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const has = (n) => args.includes(`--${n}`);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const AUDIT = path.join(HERE, 'results/translation-corpus-audit-2026-09-30');
const RESTRAINT = path.join(HERE, 'results/translation-restraint-ab-2026-09-30');
const DIR = opt('dir', path.join(HERE, 'results/illegible-gate-5305-2026-10-02'));
const CACHE = opt('cache', '/root/illegible-gate-cache');   // bulk OCR text stays out of git
const MODEL = 'gemini-3.1-flash-lite';
const V13_HASH = '51651014';
const SEED = 5305;
const ARMS = ['A', 'A2', 'C'];
const CONTROL_N = Number(opt('control', 15));

// The contract clause, verbatim (the pre-registration quotes it). Inserted after the v13 <unclear> block.
export const CONTRACT = `**Illegible pages (CRITICAL):**
- If you cannot read one complete sentence of the source — the OCR holds only lacuna markers or <unclear> spans, its own <warning> says the page is illegible, or its text is a string of letters and fragments that make no sense in the source language — output exactly <warning>Illegible: one-line reason</warning> and NOTHING else: no <meta>, no <summary>, no <keywords>, no <note>.
- Where only part of the page is unreadable, translate the readable part and reproduce each unreadable stretch inside <unclear>…</unclear> as it stands in the OCR. Never write a sentence whose words you could not read in the source.`;
const UNCLEAR_ANCHOR = '**<unclear> marks text that was NOT read (CRITICAL):**';

export function buildArmPrompts(v13) {
  const i = v13.indexOf(UNCLEAR_ANCHOR);
  if (i < 0 || v13.indexOf(UNCLEAR_ANCHOR, i + 1) >= 0) throw new Error('v13 <unclear> anchor not found exactly once — the row changed');
  return { A: v13, A2: v13, C: v13.slice(0, i) + CONTRACT + '\n\n' + v13.slice(i) };
}

const sha = (t, n = 12) => createHash('sha256').update(t).digest('hex').slice(0, n);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const writeJson = (f, o) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(o, null, 2) + '\n');

function loadAudit() {
  const man = new Map(readJsonl(path.join(AUDIT, 'manifest.jsonl')).map((m) => [m.id, m]));
  const items = new Map(readJsonl(path.join(AUDIT, 'items.jsonl')).map((x) => [x.id, x]));
  const rows = [];
  for (const f of fs.readdirSync(path.join(AUDIT, 'verdicts/opus'))) {
    for (const v of readJsonl(path.join(AUDIT, 'verdicts/opus', f))) {
      const m = man.get(v.id);
      if (!m || m.kind !== 'main') continue;   // swap/drop/repeat are translation manipulations with clean sources
      rows.push({
        id: v.id, m, ocr: items.get(v.id).source, translation: items.get(v.id).translation,
        pos: !!v.flags.garble_passthrough,
        major: (v.defects || []).some((d) => d.type === 'garble_passthrough' && d.severity === 'major'),
        fidelity: v.fidelity,
      });
    }
  }
  return rows;
}

async function mongo() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  return { c, db: c.db('bookstore') };
}

// ── --ngram-sample ──────────────────────────────────────────────────────────────────────────────
async function phaseNgramSample() {
  const rows = loadAudit();
  const auditBooks = new Set(rows.map((r) => r.m.book_id));
  const langs = [...new Set(rows.map((r) => r.m.language))];
  const { c, db } = await mongo();
  fs.mkdirSync(CACHE, { recursive: true });
  const out = fs.createWriteStream(path.join(CACHE, 'ngram-sample.jsonl'));
  for (const lang of langs) {
    const books = await db.collection('books').aggregate([{ $match: { language: lang, visible: true, pages_count: { $gt: 20 } } }, { $sample: { size: 80 } }, { $project: { id: 1 } }]).toArray();
    let n = 0;
    for (const b of books) {
      if (auditBooks.has(b.id)) continue;
      const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 5 }, 'ocr.data': { $exists: true } }, { projection: { 'ocr.data': 1, page_number: 1 } }).limit(40).toArray();
      for (const p of pages.filter((p) => (p.ocr?.data || '').length > 400).slice(0, 4)) { out.write(JSON.stringify({ lang, book: b.id, p: p.page_number, ocr: p.ocr.data }) + '\n'); n++; }
    }
    console.log(lang, n);
  }
  out.end(); await c.close();
}

// ── char-trigram plausibility (step 2) ─────────────────────────────────────────────────────────
const prep = (o) => garbleBody(String(o).replace(/<unclear[^>]*>[\s\S]*?<\/unclear>/gi, ' ')).toLowerCase().replace(/[\d\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
function trainTrigram(texts) {
  const tri = new Map(), bi = new Map(), V = new Set();
  for (const t of texts) {
    const a = Array.from('  ' + t);
    for (let i = 2; i < a.length; i++) { V.add(a[i]); const h = a[i - 2] + a[i - 1]; bi.set(h, (bi.get(h) || 0) + 1); tri.set(h + a[i], (tri.get(h + a[i]) || 0) + 1); }
  }
  return { tri, bi, V: V.size + 1 };
}
/** Mean bits per character under the language's model; `n` characters scored. */
function bitsPerChar(m, t, K = 0.1) {
  const a = Array.from('  ' + t); let s = 0, n = 0;
  for (let i = 2; i < a.length; i++) { const h = a[i - 2] + a[i - 1]; s += -Math.log2(((m.tri.get(h + a[i]) || 0) + K) / ((m.bi.get(h) || 0) + K * m.V)); n++; }
  return { bpc: n ? s / n : null, n };
}
const MIN_CHARS = 150;
function auc(P, N) { let a = 0; for (const p of P) for (const n of N) a += p > n ? 1 : p === n ? 0.5 : 0; return P.length && N.length ? +(a / P.length / N.length).toFixed(3) : null; }

// ── --measure ───────────────────────────────────────────────────────────────────────────────────
async function phaseMeasure() {
  fs.mkdirSync(DIR, { recursive: true });
  const rows = loadAudit();

  // Step 1 — OCR self-report. The prompt version is read from the page's CURRENT ocr block, so it
  // is only attributed when the stored OCR is still the text the judge read (hash match).
  const { c, db } = await mongo();
  const pages = await db.collection('pages').find({ id: { $in: rows.map((r) => r.m.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.prompt_version': 1, 'ocr.model': 1 } }).toArray();
  await c.close();
  const byPage = new Map(pages.map((p) => [p.id, p]));
  const sha16 = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
  const self = (ocr) => {
    const sq = (ocr.match(/<scan-quality>\s*([a-z]+)\s*<\/scan-quality>/i)?.[1] || 'missing').toLowerCase();
    const warnings = [...ocr.matchAll(/<warning>([\s\S]*?)<\/warning>/gi)].map((m) => m[1]);
    return {
      scan_quality: sq,
      warning: warnings.length > 0,
      warning_read_harm: warnings.some((w) => /illegib|unreadab|indecipher|difficult to (read|decipher)|faded|damag|obscur|effaced/i.test(w)),
      unclear: (ocr.match(/<unclear\b/gi) || []).length,
    };
  };
  const step1 = [];
  for (const r of rows) {
    const p = byPage.get(r.m.page_id);
    const same = p?.ocr?.data && sha16(p.ocr.data) === r.m.ocr_hash;
    step1.push({ id: r.id, pos: r.pos, major: r.major, language: r.m.language, ocr_model: r.m.ocr_model, prompt_version: same ? (p.ocr.prompt_version || 'unrecorded') : 'ocr-changed-since-audit', ...self(r.ocr) });
  }
  const tab = (sel) => {
    const xs = step1.filter(sel), n = xs.length, pct = (k) => +(xs.filter(k).length / Math.max(1, n)).toFixed(3);
    return {
      n,
      scan_quality_poor: pct((x) => x.scan_quality === 'poor'), scan_quality_fair: pct((x) => x.scan_quality === 'fair'),
      scan_quality_good: pct((x) => x.scan_quality === 'good'), scan_quality_missing: pct((x) => x.scan_quality === 'missing'),
      any_warning: pct((x) => x.warning), warning_about_legibility: pct((x) => x.warning_read_harm),
      any_unclear: pct((x) => x.unclear > 0),
      any_self_report: pct((x) => x.scan_quality === 'poor' || x.warning_read_harm || x.unclear > 0),
    };
  };
  const versions = {};
  for (const x of step1) {
    const k = x.prompt_version; versions[k] ||= { pages: 0, positives: 0, positives_with_scan_quality_tag: 0, positives_with_any_self_report: 0 };
    versions[k].pages++;
    if (x.pos) { versions[k].positives++; if (x.scan_quality !== 'missing') versions[k].positives_with_scan_quality_tag++; if (x.scan_quality === 'poor' || x.warning_read_harm || x.unclear > 0) versions[k].positives_with_any_self_report++; }
  }
  const step1Out = { positives: tab((x) => x.pos), major_positives: tab((x) => x.major), negatives: tab((x) => !x.pos), by_ocr_prompt_version: versions, rows: step1 };

  // Step 2 — char-trigram plausibility per language, trained on books outside the audit; a fifth of
  // the sample's books held out for each language's clean distribution and for the positive control.
  const sample = readJsonl(path.join(CACHE, 'ngram-sample.jsonl'));
  const byLang = {};
  for (const s of sample) ((byLang[s.lang] ||= {})[s.book] ||= []).push(prep(s.ocr));
  const models = {}, base = {}, control = {};
  resetSeed(SEED);
  for (const [lang, books] of Object.entries(byLang)) {
    const ids = Object.keys(books).sort(), held = new Set(ids.filter((_, i) => i % 5 === 0));
    const train = ids.filter((id) => !held.has(id)).flatMap((id) => books[id]);
    const ho = ids.filter((id) => held.has(id)).flatMap((id) => books[id]);
    models[lang] = trainTrigram(train);
    const sc = ho.map((t) => bitsPerChar(models[lang], t)).filter((x) => x.n >= MIN_CHARS).map((x) => x.bpc).sort((a, b) => a - b);
    base[lang] = { held_pages: sc.length, p50: +sc[Math.floor(0.5 * (sc.length - 1))].toFixed(3), p95: +sc[Math.floor(0.95 * (sc.length - 1))].toFixed(3) };
    // Positive control from the INPUT's shape: held-out clean pages with 40% of words letter-shuffled.
    const garbled = ho.slice(0, 20).map((t) => t.split(' ').map((w) => (seededRand() < 0.4 ? Array.from(w).sort(() => seededRand() - 0.5).join('') : w)).join(' '));
    const g = garbled.map((t) => bitsPerChar(models[lang], t)).filter((x) => x.n >= MIN_CHARS).map((x) => x.bpc - base[lang].p50);
    const cl = ho.slice(0, 20).map((t) => bitsPerChar(models[lang], t)).filter((x) => x.n >= MIN_CHARS).map((x) => x.bpc - base[lang].p50);
    control[lang] = { garbled_mean_excess: +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2), clean_mean_excess: +(cl.reduce((a, b) => a + b, 0) / cl.length).toFixed(2), auc_garbled_vs_clean: auc(g, cl) };
  }
  const scored = rows.map((r) => {
    const s = bitsPerChar(models[r.m.language], prep(r.ocr));
    return { id: r.id, language: r.m.language, pos: r.pos, major: r.major, judged: s.n >= MIN_CHARS, excess: s.n >= MIN_CHARS ? +(s.bpc - base[r.m.language].p50).toFixed(3) : null };
  });
  const J = scored.filter((x) => x.judged);
  const op = [0.5, 1, 1.5, 2, 3].map((th) => {
    const f = J.filter((x) => x.excess >= th), tp = f.filter((x) => x.pos).length;
    return { threshold_bits: th, flagged: f.length, tp, precision: +(tp / Math.max(1, f.length)).toFixed(2), recall: +(tp / J.filter((x) => x.pos).length).toFixed(2), recall_major: +(f.filter((x) => x.major).length / J.filter((x) => x.major).length).toFixed(2) };
  });
  const step2 = {
    method: 'char-trigram (add-0.1) per catalogue language; score = page bits/char − language median of held-out clean pages; <unclear> removed',
    sample_pages: sample.length, judged: J.length, unjudged: scored.length - J.length, unjudged_positives: scored.filter((x) => !x.judged && x.pos).length,
    auc: auc(J.filter((x) => x.pos).map((x) => x.excess), J.filter((x) => !x.pos).map((x) => x.excess)),
    auc_major: auc(J.filter((x) => x.major).map((x) => x.excess), J.filter((x) => !x.major).map((x) => x.excess)),
    operating_points: op, baselines: base, positive_control: control, rows: scored,
  };

  // The gate on every judged page.
  const gate = rows.map((r) => ({ id: r.id, language: r.m.language, pos: r.pos, major: r.major, ...illegibleSourceVerdict(r.ocr) }));
  const fired = gate.filter((g) => g.illegible);
  const gateOut = {
    fired: fired.length, tp: fired.filter((g) => g.pos).length, fp: fired.filter((g) => !g.pos).length,
    recall: +(fired.filter((g) => g.pos).length / rows.filter((r) => r.pos).length).toFixed(3),
    recall_major: +(fired.filter((g) => g.major).length / rows.filter((r) => r.major).length).toFixed(3),
    false_withholds_on_clean: fired.filter((g) => !g.pos).length, clean_pages: rows.filter((r) => !r.pos).length,
    fired_rows: fired.map((g) => ({ id: g.id, language: g.language, pos: g.pos, kind: g.kind, warning: illegibleWarning(g) })),
  };
  writeJson('measure.json', { at: new Date().toISOString(), reference: 'Opus judge garble_passthrough flag, #5274 main pages (n=311); measure: judged', step1: step1Out, step2, gate: gateOut });
  console.log(JSON.stringify({ step1: { positives: step1Out.positives, major: step1Out.major_positives, negatives: step1Out.negatives, by_version: versions }, step2: { auc: step2.auc, auc_major: step2.auc_major, op, control }, gate: { ...gateOut, fired_rows: undefined } }, null, 2));
}

// ── --corpus ────────────────────────────────────────────────────────────────────────────────────
async function phaseCorpus() {
  fs.mkdirSync(DIR, { recursive: true });
  const N = Number(opt('books', 600));
  const { c, db } = await mongo();
  const books = await db.collection('books').aggregate([{ $match: { visible: true, pages_count: { $gt: 0 } } }, { $sample: { size: N } }, { $project: { id: 1, language: 1, title: 1 } }]).toArray();
  const counts = { books: books.length, pages: 0, translated: 0, fired: 0, fired_translated: 0, by_kind: {}, by_language: {} };
  const flags = [];
  for (const b of books) {
    const cur = db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 }, 'ocr.data': { $exists: true, $nin: [null, ''] } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, photo: 1, archived_photo: 1, display_photo: 1 } });
    for await (const p of cur) {
      counts.pages++;
      const tr = !!p.translation?.data; if (tr) counts.translated++;
      const v = illegibleSourceVerdict(p.ocr.data, { pageType: p.page_type });
      if (!v.illegible) continue;
      counts.fired++; if (tr) counts.fired_translated++;
      counts.by_kind[v.kind] = (counts.by_kind[v.kind] || 0) + 1;
      counts.by_language[b.language || '—'] = (counts.by_language[b.language || '—'] || 0) + 1;
      flags.push({ book_id: b.id, title: (b.title || '').slice(0, 80), language: b.language, page_number: p.page_number, page_id: p.id, page_type: p.page_type || null, kind: v.kind, legible_letters: v.legibleLetters, translated: tr, warning: illegibleWarning(v), ocr: p.ocr.data.slice(0, 1500), translation_head: (p.translation?.data || '').slice(0, 600), image: p.display_photo || p.archived_photo || p.photo || null, url: `https://sourcelibrary.org/book/${b.id}?page=${p.page_number}` });
    }
  }
  await c.close();
  counts.fire_rate_pages = +(counts.fired / Math.max(1, counts.pages)).toFixed(5);
  counts.fire_rate_translated = +(counts.fired_translated / Math.max(1, counts.translated)).toFixed(5);
  counts.books_with_a_fire = new Set(flags.map((f) => f.book_id)).size;
  writeJson('corpus.json', { at: new Date().toISOString(), sample: `${N} random visible books with pages, every OCR'd page`, ...counts });
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'corpus-flags.jsonl'), flags.map((f) => JSON.stringify(f)).join('\n') + '\n');
  console.log(JSON.stringify(counts, null, 2));
}

// ── --draw ──────────────────────────────────────────────────────────────────────────────────────
async function phaseDraw() {
  fs.mkdirSync(DIR, { recursive: true });
  const { c, db } = await mongo();
  const row = await db.collection('prompts').findOne({ type: 'translation', is_default: true }, { sort: { version: -1 } });
  await c.close();
  const h = (row.content_hash || createHash('md5').update(row.content).digest('hex')).slice(0, 8);
  if (row.version !== 13 || h !== V13_HASH) throw new Error(`production translation prompt is v${row.version}/${h}, expected v13/${V13_HASH} — re-read before drawing`);
  const arms = buildArmPrompts(row.content);

  const audit = new Map(loadAudit().map((r) => [r.id, r]));
  const ctx = new Map(readJsonl(path.join(RESTRAINT, 'sample.jsonl')).map((s) => [s.id, s]));
  // Tibetan is out: its English is already withheld under #4883 and it is never sent to Gemini again.
  const eligible = [...audit.values()].filter((r) => ctx.has(r.id) && !/tibetan/i.test(r.m.language) && !r.m.modernization && !/^english$/i.test(r.m.language));
  const positives = eligible.filter((r) => r.pos);
  // Clean controls: judged clean (no garble, fidelity ≥ 4), weighted toward the shape a gate would
  // wrongly fire on — an OCR warning or <unclear> on the page — so a false withhold has a chance to show.
  resetSeed(SEED);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const clean = eligible.filter((r) => !r.pos && r.fidelity >= 4);
  const hard = shuffle(clean.filter((r) => /<warning>|<unclear/i.test(r.ocr)));
  const easy = shuffle(clean.filter((r) => !/<warning>|<unclear/i.test(r.ocr)));
  const controls = [...hard.slice(0, Math.ceil(CONTROL_N * 2 / 3)), ...easy].slice(0, CONTROL_N);
  const sample = [...positives.map((r) => ({ r, stratum: 'positive' })), ...controls.map((r) => ({ r, stratum: 'control' }))].map(({ r, stratum }) => {
    const s = ctx.get(r.id);
    return { id: r.id, stratum, major: r.major, language: r.m.language, book: s.book, ocr: s.ocr, prevOcr: s.prevOcr, nextOcr: s.nextOcr, prevTr: s.prevTr, gate: illegibleSourceVerdict(s.ocr) };
  });
  // Third stratum: pages the gate FIRES on in a held-out corpus round (--illegible-from), so arm A
  // shows what the production prompt writes over an illegible page and G what the gate does instead.
  // Syriac and Tibetan are excluded (never sent to Gemini again, #4883).
  const from = opt('illegible-from', null), ILL_N = Number(opt('illegible-n', 12));
  if (from) {
    const flags = readJsonl(from).filter((f) => f.translated && !/syriac|tibetan/i.test(`${f.language} ${(f.ocr.match(/<language>([^<]*)</i) || [])[1] || ''}`));
    const pick = shuffle(flags).slice(0, ILL_N);
    const { c, db } = await mongo();
    for (const f of pick) {
      const book = await db.collection('books').findOne({ id: f.book_id }, { projection: { id: 1, title: 1, author: 1, language: 1, published: 1 } });
      const near = await db.collection('pages').find({ book_id: f.book_id, page_number: { $in: [f.page_number - 1, f.page_number, f.page_number + 1] } }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
      const at = (n) => near.find((p) => p.page_number === n);
      const me = at(f.page_number);
      if (!me?.ocr?.data) continue;
      sample.push({ id: `c${f.page_id}`, stratum: 'illegible', major: null, language: book?.language || f.language, book: { id: book?.id, title: book?.title, author: book?.author, language: book?.language, published: book?.published }, ocr: me.ocr.data, prevOcr: at(f.page_number - 1)?.ocr?.data || null, nextOcr: at(f.page_number + 1)?.ocr?.data || null, prevTr: at(f.page_number - 1)?.translation?.data || null, gate: illegibleSourceVerdict(me.ocr.data, { pageType: me.page_type }), url: f.url });
    }
    await c.close();
  }
  fs.writeFileSync(path.join(DIR, 'sample.jsonl'), sample.map((s) => JSON.stringify(s)).join('\n') + '\n');
  writeJson('arms.json', { base: { version: 13, hash: h }, model: MODEL, contract: CONTRACT, arms: Object.fromEntries(ARMS.map((a) => [a, { sha: sha(arms[a]), chars: arms[a].length }])) });
  const est = estimate(sample, arms);
  console.log(`illegible stratum: ${sample.filter((s) => s.stratum === 'illegible').length} (gate fires on ${sample.filter((s) => s.stratum === 'illegible' && s.gate.illegible).length})`);
  console.log(`sample: ${positives.length} positives (${positives.filter((r) => r.major).length} major) + ${controls.length} controls (${Math.min(hard.length, Math.ceil(CONTROL_N * 2 / 3))} with a warning/<unclear>); gate fires on ${sample.filter((s) => s.gate.illegible).length}`);
  console.log(`requests ${est.calls}; ESTIMATE (Batch, ${MODEL}): $${est.usd.toFixed(3)}`);
}

function promptFor(s, text) {
  return buildTranslationPrompt({
    prompts: { translation: { text, ref: {} }, english: { text, ref: {} } },
    book: s.book, ocrText: s.ocr, previousTranslation: s.prevTr,
    prevOcrText: s.prevOcr, nextOcrText: s.nextOcr, pageBreak: PAGE_BREAK_SCOPED,
  }).prompt;
}
async function armTexts() {
  const { c, db } = await mongo();
  const row = await db.collection('prompts').findOne({ type: 'translation', version: 13, is_default: true });
  await c.close();
  const h = (row?.content_hash || createHash('md5').update(row?.content || '').digest('hex')).slice(0, 8);
  if (h !== V13_HASH) throw new Error(`v13 hash ${h} != ${V13_HASH}`);
  return buildArmPrompts(row.content);
}
function estimate(sample, arms) {
  const p = priceFor(MODEL); let usd = 0, calls = 0;
  for (const s of sample) for (const a of ARMS) {
    const i = Math.ceil(promptFor(s, arms[a]).length / 3.5), o = Math.ceil(s.ocr.length * 0.45) + 400;
    usd += 0.5 * ((i / 1e6) * p.input + (o / 1e6) * p.output); calls++;
  }
  return { usd, calls };
}

// ── --submit / --collect (Batch API, metered) ─────────────────────────────────────────────────
const API = 'https://generativelanguage.googleapis.com';
const batchKeyEnv = () => (process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY');

async function phaseSubmit() {
  const sample = readJsonl(path.join(DIR, 'sample.jsonl'));
  const arms = await armTexts();
  const est = estimate(sample, arms);
  const approved = Number(opt('approved-usd', 0));
  if (!(approved >= est.usd)) { console.error(`REFUSING TO SPEND: estimate $${est.usd.toFixed(3)}, --approved-usd ${approved || 'absent'}`); process.exit(2); }
  const lines = [];
  for (const s of sample) for (const a of ARMS) {
    const maxOutputTokens = Math.min(32768, Math.max(4096, Math.ceil(s.ocr.length) + 1200));
    lines.push(JSON.stringify({ key: `${s.id}:${a}`, request: { contents: [{ parts: [{ text: promptFor(s, arms[a]) }] }], safetySettings: SAFETY_SETTINGS, generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } } } }));
  }
  const envName = batchKeyEnv(), key = process.env[envName];
  if (!key) throw new Error(`no ${envName}`);
  const jsonl = lines.join('\n') + '\n', bytes = Buffer.byteLength(jsonl);
  const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' },
    body: JSON.stringify({ file: { displayName: `illegible-gate-5305` } }),
  });
  if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
  const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
  if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
  const fileName = (await up.json()).file?.name;
  if (!fileName) throw new Error('upload response missing file.name');
  const job = await createThenDeleteInput({
    fileName, apiKey: key,
    create: async () => {
      const r = await fetch(`${API}/v1beta/models/${MODEL}:batchGenerateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: { display_name: `illegible-gate-5305`, input_config: { file_name: fileName } } }),
      });
      if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`);
      return r.json();
    },
  });
  writeJson('batch.json', { key_env: envName, estimate_usd: +est.usd.toFixed(4), approved_usd: approved, jobs: [{ model: MODEL, job_name: job.name, requests: lines.length, submitted_at: new Date().toISOString() }] });
  console.log(`submitted ${job.name} (${lines.length} requests, estimate $${est.usd.toFixed(3)})`);
}

async function phaseCollect() {
  const rec = JSON.parse(fs.readFileSync(path.join(DIR, 'batch.json'), 'utf8'));
  const key = process.env[rec.key_env];
  const waitMax = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
  const out = path.join(DIR, 'arms.jsonl');
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
      const state = data.metadata?.state || data.state;
      console.log(`${j.job_name} ${state}`);
      if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) throw new Error(`batch ${state}`);
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!rf) { pending++; continue; }
      const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
      let inTok = 0, outTok = 0, n = 0, errors = 0;
      const p = priceFor(j.model);
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const [id, arm] = (r.key || r.metadata?.key).split(':');
        const resp = r.response, u = resp?.usageMetadata || {};
        const it = { id, arm, model: j.model };
        if (r.error || !resp) { it.error = JSON.stringify(r.error || 'no response').slice(0, 300); errors++; }
        else {
          it.text = sanitizeTranslationTags((resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''));
          it.finish = resp.candidates?.[0]?.finishReason || null;
          it.inTok = u.promptTokenCount || 0; it.outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
          inTok += it.inTok; outTok += it.outTok;
        }
        fs.appendFileSync(out, JSON.stringify(it) + '\n'); n++;
      }
      j.collected_at = new Date().toISOString(); j.responses = n; j.errors = errors; j.in_tokens = inTok; j.out_tokens = outTok;
      j.cost_usd = +(0.5 * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output)).toFixed(5);
      console.log(`collected ${n} (${errors} errors) $${j.cost_usd}`);
      try {
        const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: n - errors, input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: 'eval/illegible-gate-5305', triggered_by: 'manual', prompt_version: 'eval-5305-illegible' });
      } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
    }
    writeJson('batch.json', rec);
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

// ── --packets ──────────────────────────────────────────────────────────────────────────────────
// Only outputs that carry a translation go to the judge. A warning-only output (C's self-withhold)
// is scored mechanically: it is a withhold, and a judge cannot rate the fidelity of nothing.
function phasePackets() {
  const sample = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((s) => [s.id, s]));
  const rows = readJsonl(path.join(DIR, 'arms.jsonl')).filter((r) => r.text && !isIllegibleWarningOnly(r.text));
  resetSeed(SEED + 1);
  const opaque = () => Math.floor(seededRand() * 0xffffffffff).toString(16).padStart(10, '0');
  const items = [], key = {};
  for (const r of rows) { const s = sample.get(r.id), pid = opaque(); key[pid] = { id: r.id, arm: r.arm }; items.push({ id: pid, language: s.language, source: s.ocr, translation: r.text }); }
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  const N = Number(opt('n-packets', 6));
  const packets = Array.from({ length: N }, (_, p) => items.filter((_, i) => i % N === p));
  const REPEATS = Number(opt('repeats', 8));
  for (let i = 0; i < REPEATS; i++) {
    const at = Math.floor(seededRand() * items.length), src = items[at], pid = opaque();
    key[pid] = { ...key[src.id], repeat_of: src.id };
    const p = packets[(at % N + 1 + (i % (N - 1))) % N];
    p.splice(Math.floor(seededRand() * (p.length + 1)), 0, { ...src, id: pid });
  }
  const pdir = path.join(DIR, 'packets'); fs.mkdirSync(pdir, { recursive: true });
  packets.forEach((chunk, p) => {
    const base = path.join(pdir, `packet-${String(p + 1).padStart(2, '0')}`);
    fs.writeFileSync(`${base}.jsonl`, chunk.map((x) => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(`${base}.md`, chunk.map((x, i) => `\n\n######## ITEM ${i + 1}/${chunk.length}  id=${x.id}  language=${x.language}\n\n==== SOURCE ====\n${x.source}\n\n==== TRANSLATION ====\n${x.translation}\n`).join(''));
  });
  writeJson('packet-key.json', key);
  console.log(`${items.length + REPEATS} items (${REPEATS} repeats) in ${N} packets → ${pdir}`);
}

// ── --score ────────────────────────────────────────────────────────────────────────────────────
function mcnemar(b, c) {
  const n = b + c; if (!n) return 1;
  const k = Math.min(b, c); let p = 0;
  const lf = (x) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; };
  for (let i = 0; i <= k; i++) p += Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.log(2));
  return Math.min(1, 2 * p);
}
function phaseScore() {
  const sample = readJsonl(path.join(DIR, 'sample.jsonl'));
  const key = JSON.parse(fs.readFileSync(path.join(DIR, 'packet-key.json'), 'utf8'));
  const texts = new Map(readJsonl(path.join(DIR, 'arms.jsonl')).map((r) => [`${r.id}:${r.arm}`, r]));
  const verdicts = new Map();
  const vdir = path.join(DIR, 'verdicts');
  for (const f of fs.readdirSync(vdir).filter((f) => f.endsWith('.jsonl'))) for (const v of readJsonl(path.join(vdir, f))) verdicts.set(v.id, v);
  const byCell = new Map();
  for (const [pid, k] of Object.entries(key)) if (!k.repeat_of) byCell.set(`${k.id}:${k.arm}`, verdicts.get(pid));
  const reps = Object.entries(key).filter(([, k]) => k.repeat_of).map(([pid, k]) => [verdicts.get(pid), verdicts.get(k.repeat_of)]).filter(([a, b]) => a && b);
  const judgeNoise = { pairs: reps.length, same_garble: reps.filter(([a, b]) => a.flags.garble_passthrough === b.flags.garble_passthrough).length, same_invention: reps.filter(([a, b]) => a.flags.invention === b.flags.invention).length, same_fidelity: reps.filter(([a, b]) => a.fidelity === b.fidelity).length };

  // Per page, per arm: withheld (warning-only, or gated), or the judge's verdict.
  const cell = (s, arm) => {
    if (arm === 'G') {
      if (s.gate.illegible) return { withheld: true, output: illegibleWarning(s.gate) };
      return { ...cell(s, 'A'), from: 'A' };
    }
    const t = texts.get(`${s.id}:${arm}`);
    if (!t?.text) return { missing: true };
    if (isIllegibleWarningOnly(t.text)) return { withheld: true, output: t.text };
    const v = byCell.get(`${s.id}:${arm}`);
    if (!v) return { missing: true };
    return {
      withheld: false, fidelity: v.fidelity,
      invention: !!v.flags.invention, garble: !!v.flags.garble_passthrough,
      fabricated: !!(v.flags.invention || v.flags.garble_passthrough),
      major: (v.defects || []).some((d) => d.severity === 'major' && ['invention', 'garble_passthrough'].includes(d.type)),
      summary: /<summary>/i.test(t.text), unclear: (t.text.match(/<unclear>/gi) || []).length,
    };
  };
  const ALL = ['A', 'A2', 'C', 'G'];
  const table = {}, perPage = [];
  for (const s of sample) perPage.push({ id: s.id, stratum: s.stratum, language: s.language, major: s.major, gate: s.gate.kind, ...Object.fromEntries(ALL.map((a) => [a, cell(s, a)])) });
  for (const stratum of ['positive', 'control', 'illegible']) {
    const rows = perPage.filter((p) => p.stratum === stratum && ALL.every((a) => !p[a].missing));
    const out = { n: rows.length };
    for (const a of ALL) {
      const k = (f) => rows.filter((r) => f(r[a])).length;
      out[a] = {
        withheld: k((c) => c.withheld),
        // invention on positives = the page still carries English the judge found invented or garble-passed
        fabricated: k((c) => !c.withheld && c.fabricated), fabricated_major: k((c) => !c.withheld && c.major),
        fidelity_ge4: k((c) => !c.withheld && c.fidelity >= 4),
        with_summary: k((c) => !c.withheld && c.summary),
      };
    }
    const pair = (x, y, f) => { const b = rows.filter((r) => f(r[x]) && !f(r[y])).length, c = rows.filter((r) => !f(r[x]) && f(r[y])).length; return { [`${x}_only`]: b, [`${y}_only`]: c, p: +mcnemar(b, c).toFixed(4) }; };
    const fab = (c) => !c.withheld && c.fabricated;
    out.noise_A2_vs_A = pair('A2', 'A', fab); out.C_vs_A = pair('C', 'A', fab); out.G_vs_A = pair('G', 'A', fab);
    out.withheld_C_vs_A = pair('C', 'A', (c) => !!c.withheld);
    table[stratum] = out;
  }
  const missing = perPage.filter((p) => ALL.some((a) => p[a].missing)).map((p) => p.id);
  writeJson('report.json', { at: new Date().toISOString(), judge_noise: judgeNoise, table, missing, per_page: perPage });
  console.log(JSON.stringify({ judge_noise: judgeNoise, table, missing }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const phases = { 'ngram-sample': phaseNgramSample, measure: phaseMeasure, corpus: phaseCorpus, draw: phaseDraw, submit: phaseSubmit, collect: phaseCollect, packets: phasePackets, score: phaseScore };
  const phase = Object.keys(phases).find(has);
  if (!phase) { console.error(`pass one of ${Object.keys(phases).map((p) => '--' + p).join(' ')}`); process.exit(1); }
  await phases[phase]();
}
