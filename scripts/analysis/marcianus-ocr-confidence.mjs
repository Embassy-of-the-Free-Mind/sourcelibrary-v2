#!/usr/bin/env node
/**
 * OCR confidence signals for Marcianus gr. Z. 299 — two independent measures:
 *
 *  (1) SELF-AGREEMENT: we hold two full OCR passes (same model, same images) —
 *      one live on pages.ocr.data, one snapshotted in page_revisions. Word-level
 *      Dice (accent-normalized) between them. Low = the model is interpolating,
 *      not reading. Clean, fully computable; ranks the least-stable folios.
 *
 *  (2) OCR vs BERTHELOT COVERAGE: fraction of our OCR's Greek word-tokens that
 *      appear in Berthelot's aligned folio (best-matching candidate page from the
 *      concordance). A NOISY LOWER BOUND, not an accuracy rate — Berthelot is a
 *      critical edition (normalized/emended/other-ms readings), so even a perfect
 *      diplomatic transcription scores well under 1.0. Use the ranking, not the
 *      absolute number.
 *
 * Also reports Pearson r(self-agreement, coverage) — self-agreement predicts
 * accuracy only weakly (~0.27): soft triage, not a substitute for collation.
 *
 * See .claude/docs/edition-facsimile-pairing.md. Requires the concordance:
 *   node scripts/analysis/marcianus-berthelot-concordance.mjs   (run first)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/marcianus-ocr-confidence.mjs
 * Output: scripts/output/marcianus-ocr-confidence.json
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const MARC = '6a45298cc6d95bc278fbc8c3';
const BERT = '6994383a6879ff0184cb803a';
const CONC = 'scripts/output/marcianus-berthelot-concordance.json';
const OUT = 'scripts/output/marcianus-ocr-confidence.json';

// Greek tokens: strip diacritics (NFD + combining), lowercase, final sigma -> sigma,
// keep only Greek-letter words length >= 2. Naturally ignores wrapper tags, French, numbers.
function gtok(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ς/g, 'σ').match(/[Ͱ-Ͽ]{2,}/g) || [];
}
function count(a) { const m = new Map(); for (const t of a) m.set(t, (m.get(t) || 0) + 1); return m; }
function dice(a, b) { if (!a.length && !b.length) return 1; const ma = count(a), mb = count(b); let i = 0; for (const [k, v] of ma) i += Math.min(v, mb.get(k) || 0); const tot = a.length + b.length; return tot ? 2 * i / tot : 0; }
function contain(sub, sup) { if (!sub.length) return 0; const ms = count(sup); let i = 0; for (const [k, v] of count(sub)) i += Math.min(v, ms.get(k) || 0); return i / sub.length; }
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await c.connect();
  const db = c.db('bookstore');

  const pages = await db.collection('pages').find({ book_id: MARC }, { projection: { page_number: 1, id: 1, page_label: 1, 'ocr.data': 1 } }).toArray();
  const live = new Map(); const byPn = new Map();
  for (const p of pages) { const t = gtok(p.ocr?.data); live.set(p.id, { pn: p.page_number, label: p.page_label, tok: t }); byPn.set(p.page_number, t); }
  const revs = await db.collection('page_revisions').find({ book_id: MARC, field: 'ocr' }, { projection: { page_id: 1, data: 1 } }).toArray();
  const prior = new Map(); for (const r of revs) prior.set(r.page_id, gtok(r.data));

  // (1) self-agreement
  const selfRows = [];
  for (const [id, L] of live) { const P = prior.get(id); if (P === undefined || L.tok.length < 8) continue; selfRows.push({ pn: L.pn, label: L.label, dice: dice(L.tok, P), n: L.tok.length }); }
  selfRows.sort((a, b) => a.dice - b.dice);
  const selfByPn = new Map(selfRows.map((r) => [r.pn, r.dice]));
  const sd = selfRows.map((r) => r.dice);
  console.log(`SELF-AGREEMENT (pass1 vs pass2, n=${selfRows.length}): mean Dice=${mean(sd).toFixed(3)} median=${sd.slice().sort((a, b) => a - b)[Math.floor(sd.length / 2)].toFixed(3)}`);
  console.log('  10 least self-consistent:', selfRows.slice(0, 10).map((r) => `p${r.pn}(${r.dice.toFixed(2)})`).join(' '));

  // (2) OCR vs Berthelot — best-matching candidate page (true transcription self-selects)
  const bpages = await db.collection('pages').find({ book_id: BERT }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  const bmap = new Map(); for (const b of bpages) bmap.set(b.page_number, gtok(b.ocr?.data));
  const conc = JSON.parse(readFileSync(CONC, 'utf8'));
  const bRows = [];
  for (const row of conc.rows) {
    if (row.marc_page == null) continue; const ours = byPn.get(row.marc_page); if (!ours || ours.length < 10) continue;
    const cands = new Set(); for (const bp of row.bert_pages) { cands.add(bp); cands.add(bp + 1); } // folio may span 2 print pages
    let best = 0, bestp = null; for (const bp of cands) { const bt = bmap.get(bp); if (!bt) continue; const cov = contain(ours, bt); if (cov > best) { best = cov; bestp = bp; } }
    bRows.push({ folio: row.folio, pn: row.marc_page, cover: best, bert: bestp, self: selfByPn.get(row.marc_page) ?? null });
  }
  const cv = bRows.map((r) => r.cover);
  console.log(`OCR vs BERTHELOT (best candidate, n=${bRows.length}): mean coverage=${mean(cv).toFixed(3)} median=${cv.slice().sort((a, b) => a - b)[Math.floor(cv.length / 2)].toFixed(3)}  [LOWER BOUND, not an accuracy rate]`);

  // predictive validity
  const paired = bRows.filter((r) => r.self != null);
  const xs = paired.map((r) => r.self), ys = paired.map((r) => r.cover), mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0; for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  const r = dx && dy ? num / Math.sqrt(dx * dy) : 0;
  console.log(`Pearson r(self-agreement, Berthelot-coverage) = ${r.toFixed(3)} (n=${paired.length}) — weak: soft triage, not a collation substitute`);

  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    note: 'self_agreement = pass1-vs-pass2 word Dice (clean). ocr_vs_berthelot.cover = fraction of our Greek tokens in best-matching Berthelot page (NOISY LOWER BOUND, not accuracy). See .claude/docs/edition-facsimile-pairing.md.',
    pearson_self_vs_coverage: r,
    self_agreement: selfRows, ocr_vs_berthelot: bRows,
  }, null, 1));
  console.log(`\nsaved -> ${OUT}`);
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
