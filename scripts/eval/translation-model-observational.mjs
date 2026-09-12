#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-ab.mjs — paired A/B of two PROMPTS on fresh
// paid translations; its scorer (scoreTranslation) is reused here verbatim, but its draw
// translates pages (paid) and its arms are prompt versions, not models. scripts/eval/qa-eval.mjs
// (cross-model agreement on OCR, image-in). scripts/eval/stats-cross-model.mjs (paired per-page
// deltas over page_revisions — a different corpus, and no translation.model axis). None reads
// the translations we ALREADY HOLD and compares them by the model that wrote them.
/** Observational lite-vs-flash comparison of existing non-Latin translations (#4759): zero model spend. */
/**
 * translation-model-observational.mjs — did flash-lite translate non-Latin books
 * worse than full flash, on the pages we already hold? (#4759)
 *
 * ── The decision this exists to change ─────────────────────────────────────
 * Route TRANSLATION (not OCR) of non-Latin-script books to flash-lite, worth
 * ~$12K over 5.4M untranslated pages, or keep them on full flash. Derek's
 * direction is to move; this is the free check that nothing blocks it.
 *
 * ── The natural experiment ─────────────────────────────────────────────────
 * 2026-03-27 (#467) put everything non-BPH on flash-lite; 2026-05-12 (#1726)
 * carved non-Latin scripts back out to full flash. Many non-Latin books have
 * pages translated in both eras. Within ONE book, a lite page and a flash page
 * a few leaves apart share the scan, the hand, the language and the genre —
 * so pairing them controls for the book, and pairing on `ocr.model` controls
 * for the OCR input, which is the main confound (the eras differ in OCR model
 * too, and translation reads `ocr.data`).
 *
 * ── What it is NOT ────────────────────────────────────────────────────────
 * Randomised. Pages were assigned to models by DATE, not by lot, and the two
 * eras also differ in prompt version. Every number here is SUGGESTIVE. The
 * report prints the prompt-version and OCR-model mix per arm so the reader can
 * see how much of the difference could be those instead of the model.
 * Reference-free metrics also do not measure whether a translation is RIGHT:
 * that is the blind judge (`--judge-packet`), Claude reading pairs with the
 * labels stripped.
 *
 * ── Unit of analysis ───────────────────────────────────────────────────────
 * The BOOK. Up to --per-book pairs per book are averaged into one observation
 * per arm per book, and the paired delta is bootstrapped over books. Pages in
 * a book are one observation (lesson_sample_one_page_per_book).
 *
 * ── Phases (all FREE — nothing here calls a model or writes to `pages`) ─────
 *   --find          non-Latin, non-BPH books with lite translations in the window
 *   --draw          pair lite/flash pages within each candidate book
 *   --score         metrics, per-book paired deltas, confound mix
 *   --judge-packet  blinded pairs for the Claude judge (+ a key, kept apart)
 *   --judge-score   unblind a verdicts file and tally
 *
 *   node --env-file=.env.production.local scripts/eval/translation-model-observational.mjs --find
 *   node --env-file=.env.production.local scripts/eval/translation-model-observational.mjs --draw --books 300 --per-book 3
 *   node scripts/eval/translation-model-observational.mjs --score
 *   node scripts/eval/translation-model-observational.mjs --judge-packet --pairs 30
 *   node scripts/eval/translation-model-observational.mjs --judge-score --verdicts <file>
 *
 * Outputs land in scripts/eval/results/translation-model-obs-*.
 */
import fs from 'node:fs';
import path from 'node:path';
import { scoreTranslation } from './translation-prompt-ab.mjs';
import { isLatinScriptLanguage, SKIP_TRANSLATION_PAGE_TYPES } from '../lib/translate-core.mjs';
import { connect, disconnect } from './lib/sampling.mjs';
import { diffCI, binomTwoSided, bootstrapRatioCI, resetSeed, seededRand, mean } from './lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const RESULTS = new URL('./results/', import.meta.url).pathname;
const CANDIDATES_FILE = arg('candidates', path.join(RESULTS, 'translation-model-obs-candidates.json'));
const PAIRS_FILE = arg('pairs-file', path.join(RESULTS, 'translation-model-obs-pairs.jsonl'));
const REPORT_FILE = path.join(RESULTS, 'translation-model-obs-report.json');
const PACKET_FILE = path.join(RESULTS, 'translation-model-obs-judge-packet.jsonl');
const KEY_FILE = path.join(RESULTS, 'translation-model-obs-judge-key.json');

/** The lite era: #467 merged 2026-03-27, #1726 merged 2026-05-12. */
const WINDOW = { $gte: new Date('2026-03-27T00:00:00Z'), $lt: new Date('2026-05-13T00:00:00Z') };
/** `gemini-3.1-flash-lite-preview` is the retired preview id of the same model (issue #4759, comment 2). */
const isLite = (m) => /^gemini-3\.1-flash-lite/.test(m || '');
const isFlash = (m) => m === 'gemini-3-flash-preview';
const armOf = (m) => (isLite(m) ? 'lite' : isFlash(m) ? 'flash' : null);

// ── phase: find ─────────────────────────────────────────────────────────────
async function phaseFind() {
  const { db } = await connect();
  const t0 = Date.now();
  // 3.1M pages carry a translation.updated_at in the window. One $group over all of them
  // FETCHes every doc and Atlas closed the connection at ~10 min (measured 2026-09-12), so
  // the window is sampled in --slices evenly spaced slices of --slice-hours each. This is a
  // sample of the era, not a census — 300 candidate books is all --draw needs.
  const SLICES = Number(arg('slices', 16));
  const SLICE_MS = Number(arg('slice-hours', 6)) * 3600e3;
  const span = WINDOW.$lt - WINDOW.$gte;
  const rows = [];
  for (let i = 0; i < SLICES; i++) {
    const from = new Date(WINDOW.$gte.getTime() + (span * i) / SLICES);
    const to = new Date(Math.min(from.getTime() + SLICE_MS, WINDOW.$lt.getTime()));
    const part = await db.collection('pages').aggregate([
      { $match: { 'translation.updated_at': { $gte: from, $lt: to } } },
      { $group: { _id: { b: '$book_id', m: '$translation.model' }, n: { $sum: 1 } } },
    ], { allowDiskUse: true }).toArray();
    rows.push(...part);
    console.log(`slice ${i + 1}/${SLICES} ${from.toISOString().slice(0, 13)}: ${part.reduce((s, r) => s + r.n, 0)} pages, ${part.length} book×model groups (${Date.now() - t0}ms)`);
  }
  const models = {};
  for (const r of rows) models[r._id.m] = (models[r._id.m] || 0) + r.n;
  const liteBooks = new Set(rows.filter((r) => isLite(r._id.m)).map((r) => r._id.b));
  const books = await db.collection('books').find(
    { id: { $in: [...liteBooks] } },
    { projection: { id: 1, language: 1, 'image_source.provider': 1, title: 1 } },
  ).toArray();
  const candidates = books
    .filter((b) => !isLatinScriptLanguage(b.language) && b.image_source?.provider !== 'bph')
    .map((b) => ({ id: b.id, language: b.language, title: b.title }));
  fs.writeFileSync(CANDIDATES_FILE, JSON.stringify({ at: new Date().toISOString(), window: WINDOW, models, candidates }, null, 1));
  console.log(`window models: ${JSON.stringify(models)}`);
  console.log(`books with lite translations in window: ${liteBooks.size}; non-Latin non-BPH: ${candidates.length}  (${Date.now() - t0}ms)`);
  console.log(`wrote ${CANDIDATES_FILE}`);
}

// ── phase: draw ─────────────────────────────────────────────────────────────
/**
 * Pair every lite page with the nearest unused flash page of the same book.
 * Same `ocr.model` is REQUIRED for a pair unless --allow-ocr-mismatch; the
 * mismatch flag is carried on every pair either way so --score can stratify.
 */
function pairBook(pages, { perBook, allowMismatch }) {
  const skip = new Set(SKIP_TRANSLATION_PAGE_TYPES);
  const usable = pages.filter((p) => p.translation?.data && p.ocr?.data && armOf(p.translation.model) && !skip.has(p.page_type));
  const lite = usable.filter((p) => armOf(p.translation.model) === 'lite');
  const flash = usable.filter((p) => armOf(p.translation.model) === 'flash');
  if (!lite.length || !flash.length) return [];
  const cands = [];
  for (const l of lite) for (const f of flash) {
    const ocrMatched = (l.ocr.model || null) === (f.ocr.model || null);
    if (!ocrMatched && !allowMismatch) continue;
    cands.push({ l, f, dist: Math.abs(l.page_number - f.page_number), ocrMatched });
  }
  // Closest leaves first; matched OCR beats mismatched at equal distance.
  cands.sort((a, b) => a.dist - b.dist || (b.ocrMatched - a.ocrMatched));
  const usedL = new Set(), usedF = new Set(), out = [];
  for (const c of cands) {
    if (out.length >= perBook) break;
    if (usedL.has(c.l.page_number) || usedF.has(c.f.page_number)) continue;
    usedL.add(c.l.page_number); usedF.add(c.f.page_number);
    out.push(c);
  }
  return out;
}

const armRow = (p) => ({
  page_number: p.page_number, page_type: p.page_type || null,
  model: p.translation.model, prompt_version: p.translation.prompt_version || null,
  translated_at: p.translation.updated_at || null,
  ocr_model: p.ocr.model || null, ocr_text: p.ocr.data, text: p.translation.data,
});

async function phaseDraw() {
  const BOOKS = Number(arg('books', 300));
  const PER_BOOK = Number(arg('per-book', 3));
  const allowMismatch = has('allow-ocr-mismatch');
  const { candidates } = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
  resetSeed();
  const shuffled = [...candidates].sort(() => seededRand() - 0.5).slice(0, BOOKS);
  const { db } = await connect();
  const out = fs.createWriteStream(PAIRS_FILE);
  let booksWithPairs = 0, pairs = 0;
  for (const b of shuffled) {
    const pages = await db.collection('pages').find(
      { book_id: b.id, 'translation.data': { $exists: true, $nin: [null, ''] }, 'ocr.data': { $exists: true, $nin: [null, ''] } },
      { projection: { page_number: 1, page_type: 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1, 'ocr.data': 1, 'ocr.model': 1 } },
    ).toArray();
    const ps = pairBook(pages, { perBook: PER_BOOK, allowMismatch });
    if (!ps.length) continue;
    booksWithPairs++;
    for (const p of ps) {
      pairs++;
      out.write(JSON.stringify({ bookId: b.id, title: b.title, language: b.language, dist: p.dist, ocr_matched: p.ocrMatched, lite: armRow(p.l), flash: armRow(p.f) }) + '\n');
    }
  }
  out.end();
  console.log(`candidates: ${candidates.length}  drawn: ${shuffled.length}  books with pairs: ${booksWithPairs}  pairs: ${pairs}`);
  console.log(`wrote ${PAIRS_FILE}`);
}

// ── phase: score ────────────────────────────────────────────────────────────
const readPairs = () => fs.readFileSync(PAIRS_FILE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const METRICS = {
  notes_emitted: (s) => s.notes_emitted,
  inline_terms: (s) => s.inline_terms,
  invented_tags: (s) => s.invented_tags,
  housekeeping_tags: (s) => s.housekeeping_tags,
  glossary_block: (s) => (s.glossary_block ? 1 : 0),
  body_chars: (s) => s.body_chars,
  // The two sides of a pair are DIFFERENT pages, so raw body length also measures how much
  // text was on each leaf. Body per OCR character is the length signal with the page's own
  // size divided out — the one that can say "shorter than its source warrants".
  ocr_chars: (s) => s.ocr_chars,
  body_per_ocr_char: (s) => (s.ocr_chars ? s.body_chars / s.ocr_chars : 0),
};

function tally(pairs) {
  const byBook = new Map();
  for (const p of pairs) {
    if (!byBook.has(p.bookId)) byBook.set(p.bookId, []);
    byBook.get(p.bookId).push(p);
  }
  const books = [...byBook.values()];
  const perBook = (arm, f) => books.map((ps) => mean(ps.map((p) => f(p[arm].score))));
  const out = { n_books: books.length, n_pairs: pairs.length, metrics: {} };
  // Verified-note rate: pooled over pages (cluster bootstrap), plus the per-book paired delta
  // on books where BOTH arms emitted at least one note.
  for (const arm of ['lite', 'flash']) {
    resetSeed();
    out.metrics[`verified_rate_${arm}`] = bootstrapRatioCI(pairs.map((p) => p[arm].score.notes_verified), pairs.map((p) => p[arm].score.notes_emitted));
  }
  const both = books.filter((ps) => ps.some((p) => p.lite.score.notes_emitted) && ps.some((p) => p.flash.score.notes_emitted));
  const vr = (ps, arm) => { const e = ps.reduce((s, p) => s + p[arm].score.notes_emitted, 0); const v = ps.reduce((s, p) => s + p[arm].score.notes_verified, 0); return e ? v / e : null; };
  resetSeed();
  out.metrics.verified_rate_delta_flash_minus_lite = both.length >= 2 ? { n_books: both.length, ...diffCI(both.map((ps) => vr(ps, 'lite')), both.map((ps) => vr(ps, 'flash'))) } : null;
  for (const [name, f] of Object.entries(METRICS)) {
    const a = perBook('lite', f), b = perBook('flash', f);
    resetSeed();
    const d = diffCI(a, b);
    const wins = books.filter((_, i) => b[i] > a[i]).length, losses = books.filter((_, i) => b[i] < a[i]).length;
    out.metrics[name] = { lite_mean: mean(a), flash_mean: mean(b), delta_flash_minus_lite: d?.delta ?? null, ci: d?.ci ?? null, decisive: d?.decisive ?? false, flash_higher: wins, lite_higher: losses, sign_p: binomTwoSided(wins, wins + losses) };
  }
  return out;
}

function mix(pairs, arm, key) {
  const m = {};
  for (const p of pairs) { const k = String(p[arm][key]); m[k] = (m[k] || 0) + 1; }
  return m;
}

function phaseScore() {
  const pairs = readPairs();
  for (const p of pairs) {
    p.lite.score = { ...scoreTranslation(p.lite.text, p.lite.ocr_text), ocr_chars: p.lite.ocr_text.length };
    p.flash.score = { ...scoreTranslation(p.flash.text, p.flash.ocr_text), ocr_chars: p.flash.ocr_text.length };
    // Which policy era wrote the flash side: before #467 (old prompts), or after #1726.
    const t = p.flash.translated_at ? new Date(p.flash.translated_at) : null;
    p.flash.era = !t ? 'unknown' : t < WINDOW.$gte ? 'pre-2026-03-27' : t >= WINDOW.$lt ? 'post-2026-05-12' : 'in-window';
    p.lite.era = 'in-window';
  }
  const report = {
    at: new Date().toISOString(),
    issue: 4759,
    design: 'observational, within-book pairs, unit = book; SUGGESTIVE not decisive (see header)',
    all: tally(pairs),
    ocr_matched_only: tally(pairs.filter((p) => p.ocr_matched)),
    ocr_mismatched_only: tally(pairs.filter((p) => !p.ocr_matched)),
    confounds: {
      prompt_version: { lite: mix(pairs, 'lite', 'prompt_version'), flash: mix(pairs, 'flash', 'prompt_version') },
      ocr_model: { lite: mix(pairs, 'lite', 'ocr_model'), flash: mix(pairs, 'flash', 'ocr_model') },
      flash_era: mix(pairs, 'flash', 'era'),
      page_distance: { mean: mean(pairs.map((p) => p.dist)), max: Math.max(...pairs.map((p) => p.dist)) },
      languages: pairs.reduce((m, p) => ((m[p.language] = (m[p.language] || 0) + 1), m), {}),
    },
    by_language: {},
  };
  const langs = [...new Set(pairs.map((p) => p.language))];
  for (const lang of langs) {
    const ps = pairs.filter((p) => p.language === lang);
    if (new Set(ps.map((p) => p.bookId)).size >= 3) report.by_language[lang] = tally(ps);
  }
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));

  const fmt = (x, d = 3) => (x == null ? '—' : Number(x).toFixed(d));
  const line = (label, t) => {
    console.log(`\n${label}: ${t.n_books} books, ${t.n_pairs} pairs`);
    const vl = t.metrics.verified_rate_lite, vf = t.metrics.verified_rate_flash, vd = t.metrics.verified_rate_delta_flash_minus_lite;
    console.log(`  verified-note rate   lite ${fmt(vl.rate)} [${fmt(vl.ci?.[0])},${fmt(vl.ci?.[1])}] (${vl.denom} notes)   flash ${fmt(vf.rate)} [${fmt(vf.ci?.[0])},${fmt(vf.ci?.[1])}] (${vf.denom} notes)   paired Δ ${vd ? `${fmt(vd.delta)} [${fmt(vd.ci[0])},${fmt(vd.ci[1])}] n=${vd.n_books}${vd.decisive ? ' DECISIVE' : ''}` : '—'}`);
    for (const name of Object.keys(METRICS)) {
      const m = t.metrics[name];
      console.log(`  ${name.padEnd(20)} lite ${fmt(m.lite_mean, 2).padStart(8)}   flash ${fmt(m.flash_mean, 2).padStart(8)}   Δ ${fmt(m.delta_flash_minus_lite, 2)} [${fmt(m.ci?.[0], 2)},${fmt(m.ci?.[1], 2)}]${m.decisive ? ' DECISIVE' : ''}   flash>lite ${m.flash_higher} / lite>flash ${m.lite_higher}  sign p=${fmt(m.sign_p, 3)}`);
    }
  };
  line('ALL PAIRS', report.all);
  if (report.ocr_matched_only.n_pairs) line('OCR-MATCHED PAIRS (same ocr.model both sides)', report.ocr_matched_only);
  if (report.ocr_mismatched_only.n_pairs) line('OCR-MISMATCHED PAIRS', report.ocr_mismatched_only);
  for (const [lang, t] of Object.entries(report.by_language)) line(`LANGUAGE ${lang}`, t);
  console.log('\nconfounds:', JSON.stringify(report.confounds, null, 1));
  console.log(`\nwrote ${REPORT_FILE}`);
}

// ── phase: judge-packet ─────────────────────────────────────────────────────
function phaseJudgePacket() {
  const PAIRS = Number(arg('pairs', 30));
  const MAX_CHARS = Number(arg('max-chars', 7000));
  const pairs = readPairs().filter((p) => p.ocr_matched && p.lite.text.length <= MAX_CHARS && p.flash.text.length <= MAX_CHARS && p.lite.ocr_text.length <= MAX_CHARS);
  // One pair per book, round-robin across languages so the judge's set looks like the corpus, not one book.
  const seen = new Set(), byLang = new Map();
  for (const p of pairs) {
    if (seen.has(p.bookId)) continue;
    seen.add(p.bookId);
    if (!byLang.has(p.language)) byLang.set(p.language, []);
    byLang.get(p.language).push(p);
  }
  const picked = [];
  for (let round = 0; picked.length < PAIRS && round < 500; round++) {
    for (const list of byLang.values()) if (list[round] && picked.length < PAIRS) picked.push(list[round]);
  }
  resetSeed();
  const packet = [], key = [];
  for (const p of picked) {
    const flip = seededRand() < 0.5;
    const id = `${p.bookId}:${p.lite.page_number}-${p.flash.page_number}`;
    packet.push({
      id, language: p.language, title: p.title,
      left: { ocr: flip ? p.flash.ocr_text : p.lite.ocr_text, translation: flip ? p.flash.text : p.lite.text },
      right: { ocr: flip ? p.lite.ocr_text : p.flash.ocr_text, translation: flip ? p.lite.text : p.flash.text },
    });
    key.push({ id, left: flip ? 'flash' : 'lite', right: flip ? 'lite' : 'flash' });
  }
  fs.writeFileSync(PACKET_FILE, packet.map((p) => JSON.stringify(p)).join('\n') + '\n');
  fs.writeFileSync(KEY_FILE, JSON.stringify(key, null, 1));
  console.log(`wrote ${packet.length} blinded pairs to ${PACKET_FILE}`);
  console.log(`key (do NOT give this to the judge): ${KEY_FILE}`);
  console.log('\nNote: LEFT and RIGHT are DIFFERENT pages of the same book, a few leaves apart — each side');
  console.log('carries its own OCR. The judge compares each translation against ITS OWN source, then says');
  console.log('which side is the more faithful piece of work. Verdict per pair: LEFT_BETTER | RIGHT_BETTER | EQUIVALENT,');
  console.log('plus fabricated:left/right/none — content with no plausible basis in that side\'s OCR.');
}

// ── phase: judge-score ──────────────────────────────────────────────────────
function phaseJudgeScore() {
  const vf = arg('verdicts');
  if (!vf) throw new Error('--verdicts <jsonl> required');
  const key = new Map(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).map((k) => [k.id, k]));
  const verdicts = fs.readFileSync(vf, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const tally = { lite_better: 0, flash_better: 0, equivalent: 0, fabricated: { lite: 0, flash: 0, none: 0 }, unknown_ids: 0, rows: [] };
  for (const v of verdicts) {
    const k = key.get(v.id);
    if (!k) { tally.unknown_ids++; continue; }
    const side = v.verdict === 'LEFT_BETTER' ? k.left : v.verdict === 'RIGHT_BETTER' ? k.right : null;
    if (side) tally[`${side}_better`]++; else tally.equivalent++;
    for (const f of String(v.fabricated || 'none').split(/[,\s/]+/).filter(Boolean)) {
      const s = f === 'left' ? k.left : f === 'right' ? k.right : 'none';
      tally.fabricated[s] = (tally.fabricated[s] || 0) + 1;
    }
    tally.rows.push({ id: v.id, language: v.language, verdict: v.verdict, winner: side || 'equivalent', fabricated: v.fabricated || 'none', why: v.why });
  }
  tally.sign_p = binomTwoSided(tally.flash_better, tally.flash_better + tally.lite_better);
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  report.judge = { at: new Date().toISOString(), verdicts_file: path.basename(vf), ...tally };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
  console.log(`judge: flash better ${tally.flash_better}, lite better ${tally.lite_better}, equivalent ${tally.equivalent}  (sign p=${tally.sign_p.toFixed(3)})`);
  console.log(`fabrication flagged: lite ${tally.fabricated.lite}, flash ${tally.fabricated.flash}`);
  for (const r of tally.rows) console.log(`  ${r.winner.padEnd(10)} fab=${String(r.fabricated).padEnd(5)} ${r.language.padEnd(10)} ${r.why}`);
  console.log(`\nupdated ${REPORT_FILE}`);
}

// ── main ────────────────────────────────────────────────────────────────────
try {
  if (has('find')) await phaseFind();
  else if (has('draw')) await phaseDraw();
  else if (has('score')) phaseScore();
  else if (has('judge-packet')) phaseJudgePacket();
  else if (has('judge-score')) phaseJudgeScore();
  else console.log('one of --find | --draw | --score | --judge-packet | --judge-score (see the header)');
} finally {
  await disconnect().catch(() => {});
}
