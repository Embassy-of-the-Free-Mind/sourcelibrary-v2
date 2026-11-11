#!/usr/bin/env node
// PRIOR ART: scripts/workers/needs/trustworthy.{json,md} (2026-10-16: a ranked queue of WORK items, weighted by
// readership and lane accuracy; no per-book order for the standing check, and its rates are a week old — refreshed
// below from the experiment files); scripts/maintenance/priority-v2.mjs and scripts/audit/build-page-check-candidates.mjs
// and scripts/audit/leaf-shift-risk-5021.mjs (rank pages/books for repair or one named defect, not for a sampled check
// whose measured rate must stay unbiased); scripts/eval/spot-check/served-draw.mjs (owns ocrLane/scriptFamily/formOf but
// runs a draw on import, so they are restated small here); scripts/lib/book-checks.mjs (the book_checks reader of record;
// read directly here, read-only).
/**
 * book-check-priority: the order in which the standing paired-fifths-check (#8478 phase 2) visits books. READ-ONLY.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/book-check-priority.mjs \
 *        [--limit=500] [--out=queue.jsonl] [--seed=8478]
 *
 * Frame: books.visible && pages_count > 0, pages_ocr >= 10, not under a hold (pipeline_auto.hold, except the
 * not-acquired work hold in hold-reasons.mjs; the Siku lane holds are skipped too, their pages are OCR-only and the
 * check reads the English at every break), not an unsplit spread,
 * and — checked on each pick, not the whole frame — at least 4 drawable pairs by the real pairedFifths()/eligiblePage().
 * Skipped: any book with a book_checks row (any method) in the last 30 days.
 * Order: tier 0 (never checked) before tier 1 (last check older than 30 days); inside a tier, score desc.
 * score = (1 + log1p(books.human_read_count)) * risk.   (+1 floor so unread books are not all zero)
 * Stratum: every 10th pick (positions 10, 20, ...) is drawn uniformly from the remaining eligible frame, seeded, and
 * labelled stratum "random", so a rate measured on the "random" rows is not biased by this priority.
 *
 * RISK. Table of MEASURED serious-error rates (k of n books, one served page per book read against its image).
 * A cell's rate is shrunk toward the overall rate with m = 10 pseudo-books, (k + m*overall)/(n + m), so an n = 10 cell
 * cannot claim 0 or 1. A book's risk = the MAX of the shrunk rates of the cells it falls in (form, script, OCR engine,
 * non-English); max not product, because the cells are not independent (manuscripts are mostly non-Latin Gemini-lite).
 * A book matching no cell with a measurement gets the overall rate and risk_basis "overall".
 */
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { mulberry32, pairedFifths } from '../lib/paired-fifths.mjs';
import { isNotAcquiredReason, SIKU_LANE_HOLDS } from '../lib/hold-reasons.mjs';
import { isUnsplitSpread } from '../lib/pipeline-hold.mjs';
import { scriptsOfLanguage } from '../lib/stray-script.mjs';
import { eligiblePage } from '../eval/confidence-7866/lib.mjs';
import { PAGE_PROJECTION } from '../eval/paired-fifths-8405/run.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const LIMIT = Number(arg('limit', 500)), OUT = arg('out'), SEED = Number(arg('seed', 8478));
const RECENT_DAYS = 30, MIN_OCR_PAGES = 10, RANDOM_EVERY = 10, SHRINK_M = 10;

// ---- measured rates --------------------------------------------------------------------------------------------
const SERVED_6691 = 'scripts/eval/experiments/2026-10-13-served-text-audit-by-lane-6691.md, report.json (strata summed), measured 2026-10-13, served books';
export const OVERALL = { k: 62, n: 184, source: `${SERVED_6691}: 62 of 184 (34%), all lanes` };
export const RATES = {
  'form:ms': { k: 15, n: 30, source: `${SERVED_6691}; catalogue-heuristic form (reviewer-seen form: manuscript 28 of 44)` },
  'form:print': { k: 43, n: 134, source: SERVED_6691 },
  'script:cjk': { k: 21, n: 45, source: SERVED_6691 },
  'script:greek': { k: 13, n: 30, source: SERVED_6691 },
  'script:cyrillic': { k: 3, n: 10, source: SERVED_6691 },
  'script:indic': { k: 3, n: 10, source: SERVED_6691 },
  'script:latin': { k: 18, n: 69, source: SERVED_6691 },
  'script:tibetan': { k: 0, n: 10, source: `${SERVED_6691} (Esukhia typed e-text stratum; BDRC served none)` },
  'ocr:gem-3flash': { k: 35, n: 100, source: SERVED_6691 },
  'ocr:gem-lite': { k: 14, n: 44, source: SERVED_6691 },
  'ocr:paddle': { k: 9, n: 20, source: SERVED_6691 },
  'lang:non-english': { k: 171, n: 551, source: 'scripts/workers/needs/trustworthy.md (#6420, job opus-audit-6420, 2026-10-16): random visible non-English books, one Opus reader, 171 of 551' },
};
// Not used as a cell rate: #8405 (2026-11-08-paired-fifths-results-8405.md) 24 of 159 books good on 5 pages were bad on
// 10 paired pages (15.1%) — a different instrument (paired-fifths, books already judged good), so it justifies the
// check, not a per-cell prior.
const shrunk = (c) => (c.k + SHRINK_M * (OVERALL.k / OVERALL.n)) / (c.n + SHRINK_M);

// ---- lane of a book (restated from scripts/eval/spot-check/served-draw.mjs, which cannot be imported) -----------
const FAMILY = [['Han', 'cjk'], ['Hiragana', 'cjk'], ['Hangul', 'cjk'], ['Tibetan', 'tibetan'], ['Greek', 'greek'], ['Hebrew', 'hebrew'],
  ['Arabic', 'arabic'], ['Syriac', 'syriac'], ['Cyrillic', 'cyrillic'], ['Devanagari', 'indic'], ['Bengali', 'indic'], ['Tamil', 'indic']];
function scriptFamily(language) {
  const s = scriptsOfLanguage(language);
  if (!s.size) return 'latin';
  for (const [k, f] of FAMILY) if (s.has(k)) return f;
  return 'other-script';
}
const MS_PROVIDERS = new Set(['laurenziana', 'vatican', 'e-codices', 'penn_colenda', 'chester_beatty', 'morgan', 'e-manuscripta']);
const MS_TITLE = /manuscri|handschrift|\bms\.?\s|\bmss?\b|\bcod(ex|\.)\b|manoscr|autograph/i;
function formOf(b) {
  const y = Number(String(b.published ?? '').match(/\d{3,4}/)?.[0]);
  return MS_PROVIDERS.has(b.image_source?.provider) || MS_TITLE.test(b.title ?? '') || (y && y < 1450) ? 'ms' : 'print';
}
function ocrLane(model) {
  const m = String(model ?? '').toLowerCase();
  if (/paddle/.test(m)) return 'paddle';
  if (/flash-lite/.test(m)) return 'gem-lite';
  if (/gemini-3-flash|gemini-3\.0-flash/.test(m)) return 'gem-3flash';
  return null; // claude, ia-ocr, kraken, BDRC ... no measured cell
}
const isEnglish = (l) => /^(english|en|eng)$/i.test(String(l ?? '').trim());

function riskOf(b, engine) {
  const keys = [`form:${formOf(b)}`, `script:${scriptFamily(b.language)}`, engine ? `ocr:${engine}` : null, b.language && !isEnglish(b.language) ? 'lang:non-english' : null]
    .filter((k) => k && RATES[k]);
  if (!keys.length) return { risk: OVERALL.k / OVERALL.n, risk_basis: 'overall' };
  const scored = keys.map((k) => [k, shrunk(RATES[k])]).sort((a, c) => c[1] - a[1]);
  return { risk: scored[0][1], risk_basis: scored[0][0] };
}

async function main() {
  const rng = mulberry32(SEED);
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  await withMongo(async (db) => {
    const books = db.collection('books');
    const last = new Map();
    for (const r of await db.collection('book_checks').find({}, { projection: { _id: 0, book_id: 1, checked_at: 1 } }).toArray()) {
      const t = new Date(r.checked_at).getTime();
      if (Number.isFinite(t) && t > (last.get(r.book_id) ?? 0)) last.set(r.book_id, t);
    }
    const cutoff = Date.now() - RECENT_DAYS * 864e5;
    const rows = await books.find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, title: 1, language: 1, published: 1, pages_ocr: 1, human_read_count: 1,
      needs_splitting: 1, split_completed: 1, 'pipeline_auto.hold.reason': 1, 'image_source.provider': 1 } }).toArray();
    const frame = [];
    for (const b of rows) {
      if (!b.id) { skip('no id'); continue; }
      const hr = b.pipeline_auto?.hold?.reason;
      if (b.pipeline_auto?.hold && !isNotAcquiredReason(hr)) { skip(SIKU_LANE_HOLDS.includes(hr) ? 'Siku lane hold (OCR-only)' : 'text hold (pipeline_auto.hold)'); continue; }
      if (isUnsplitSpread(b)) { skip('unsplit spread'); continue; }
      if ((b.pages_ocr ?? 0) < MIN_OCR_PAGES) { skip(`pages_ocr < ${MIN_OCR_PAGES}`); continue; }
      const lc = last.get(b.id);
      if (lc && lc > cutoff) { skip(`checked in last ${RECENT_DAYS} days`); continue; }
      const reads = b.human_read_count ?? 0;
      const base = riskOf(b, null);
      frame.push({ b, reads, tier: lc ? 1 : 0, last: lc ? new Date(lc).toISOString() : null, ...base });
    }
    // engine cell: one page lookup, only for the head of the pre-ranking (the engine is a page field, not a book field)
    const pre = (c) => (1 + Math.log1p(c.reads)) * c.risk;
    frame.sort((a, c) => a.tier - c.tier || pre(c) - pre(a));
    for (const c of frame.slice(0, LIMIT * 3)) {
      const p = await db.collection('pages').findOne({ book_id: c.b.id, 'ocr.model': { $exists: true }, page_number: { $gt: 0 } }, { projection: { _id: 0, 'ocr.model': 1 } });
      Object.assign(c, riskOf(c.b, ocrLane(p?.ocr?.model)));
    }
    for (const c of frame) c.score = (1 + Math.log1p(c.reads)) * c.risk;
    frame.sort((a, c) => a.tier - c.tier || c.score - a.score);

    const drawable = async (c) => {
      const all = await db.collection('pages').find({ book_id: c.b.id }, { projection: PAGE_PROJECTION }).sort({ page_number: 1 }).toArray();
      return pairedFifths(all.map((p) => ({ page_number: p.page_number, eligible: eligiblePage(p) })), c.b.id).filter((q) => q.partner != null).length >= 4;
    };
    const pool = frame.slice(); // remaining eligible frame, still in priority order
    const picks = [];
    let head = 0;
    while (picks.length < LIMIT && pool.length) {
      const random = (picks.length + 1) % RANDOM_EVERY === 0;
      const i = random ? Math.floor(rng() * pool.length) : head;
      const c = pool[i];
      if (!random && head >= pool.length) break;
      pool.splice(i, 1);
      if (!(await drawable(c))) { skip('fewer than 4 drawable pairs'); continue; }
      picks.push({ ...c, stratum: random ? 'random' : 'priority' });
    }
    const out = picks.map((c) => ({ book_id: c.b.id, title: c.b.title, language: c.b.language, stratum: c.stratum, tier: c.tier, reads: c.reads,
      risk: +c.risk.toFixed(4), risk_basis: c.risk_basis, score: +c.score.toFixed(3), last_checked_at: c.last }));
    if (OUT) fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`frame ${frame.length} (of ${rows.length} live books) · picks ${out.length} (random ${out.filter((r) => r.stratum === 'random').length}) · seed ${SEED}`);
    console.log('skipped:', JSON.stringify(skipped));
    console.log('tiers:', JSON.stringify({ never_checked_in_frame: frame.filter((c) => c.tier === 0).length, stale_in_frame: frame.filter((c) => c.tier === 1).length }));
    for (const r of out.slice(0, 10)) console.log(`${r.stratum.padEnd(8)} t${r.tier} reads ${String(r.reads).padStart(5)} risk ${r.risk} [${r.risk_basis}] score ${r.score}  ${r.book_id}  ${String(r.title).slice(0, 50)}`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
