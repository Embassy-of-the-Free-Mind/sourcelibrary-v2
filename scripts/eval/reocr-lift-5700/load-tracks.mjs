#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/from-ab-sample.mjs converts ONE #5606-style sample into harness
// records; scripts/eval/build-quality-dataset.mjs bundles finished results for download. Neither reads the five
// #5695 track result directories (each has its own file layout) into one table keyed by page with the served OCR,
// the by-eye corrected transcription, and each track's fidelity on the OCR and on the corrected text. This does.
/** Unify the five #5695 track outputs (T1 Latin, T2 Greek, T3 vernaculars, T4 Hebrew/Arabic/Persian, T5 Sanskrit/Pali/Chinese) into one page table for #5700 A5. */
/**
 *   node scripts/eval/reocr-lift-5700/load-tracks.mjs --t1 <dir> --t4 <dir> --t5 <dir> --out scripts/eval/results/reocr-lift-2026-10
 * T2 and T3 are read from scripts/eval/results/ (merged); T1, T4 and T5 from the directories given (their PRs
 * #5721, #5735, #5724 are open: `git archive origin/job-xlref-tN scripts/eval/results/xlref-tN-2026-10 | tar -x -C <tmp>`).
 * Output: <out>/track-pages.jsonl, one row per page that has a corrected transcription OR a served fidelity ≤ 3.
 * Reads files only. No network, no Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const R = 'scripts/eval/results';
const T1 = opt('t1'), T2 = opt('t2', `${R}/xlref-t2-2026-10`), T3 = opt('t3', `${R}/xlref-t3-2026-10`), T4 = opt('t4'), T5 = opt('t5');
const OUT = opt('out', `${R}/reocr-lift-2026-10`);
const rl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const idOf = (b, p) => `${b}_${String(p).padStart(5, '0')}`;
const perPage = (res, arm) => Object.fromEntries(res.per_page.map((p) => [p.id, p.arms?.[arm]?.fidelity ?? null]));
const rows = [];
const push = (r) => rows.push({ ...r, has_corrected: !!r.corrected_text, served_low: r.served_fidelity != null && r.served_fidelity <= 3 });

// ── T1 Latin ── fidelity pairs from pass 2 (prod-A / flash-0 on the OCR, lite-fixocr / flash-fixocr on the fixed text)
if (T1) {
  const rec = rl(`${T1}/records.jsonl`); const p1 = rj(`${T1}/results-pass1.json`), p2 = rj(`${T1}/results-pass2.json`);
  const served = perPage(p1, 'served'); const f = (a) => perPage(p2, a);
  const lo = f('prod-A'), fo = f('flash-0'), lc = f('lite-fixocr'), fc = f('flash-fixocr');
  const cause = {}; for (const fn of fs.readdirSync(`${T1}/image-check`)) { const j = rj(`${T1}/image-check/${fn}`); cause[fn.replace('.json', '')] = j.primary_cause ?? j.cause ?? null; }
  for (const r of rec) {
    const id = idOf(r.book_id, r.page_number); const fx = `${T1}/fixed-transcriptions/${r.book_id}_${r.page_number}.txt`;
    const corrected = fs.existsSync(fx) && lc[id] != null ? fs.readFileSync(fx, 'utf8') : null;
    push({ track: 'T1', id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, edition_year: r.year, stratum: r.period, ocr_text: r.source_text, corrected_text: corrected,
      reference_text: r.reference_text, reference_meta: r.reference_meta, served_fidelity: served[id], primary_cause: cause[id] ?? null,
      track_fidelity: corrected ? { lite_ocr: lo[id], lite_corr: lc[id], flash_ocr: fo[id], flash_corr: fc[id], judges: 2, judged_against: 'see write-up (pass 2)' } : null });
  }
}
// ── T2 Greek ── arms packet: one judge; on the 26 corrected pages every arm was judged against the corrected text
{
  const pages = rl(`${T2}/pages.jsonl`); const srv = pages.filter((p) => p.arm === 'served');
  const cbi = Object.fromEntries(rl(`${T2}/cause-by-image.jsonl`).map((c) => [c.id, c]));
  const rs = rj(`${T2}/results-served.json`), ra = rj(`${T2}/results-arms.json`);
  const served = perPage(rs, 'served'), lo = perPage(ra, 'lite-a'), fo = perPage(ra, 'flash'), lc = perPage(ra, 'lite-corr');
  for (const p of srv) {
    const c = cbi[p.id]; const corrected = c?.corrected_transcription && lc[p.id] != null ? c.corrected_transcription : null;
    push({ track: 'T2', id: p.id, book_id: p.book_id, page_number: p.page_number, lang: p.lang, edition_year: Number(String(p.book?.published || '').match(/\d{4}/)?.[0]) || null, stratum: p.edition_stratum,
      ocr_text: p.source_text, corrected_text: corrected, corrected_from: c?.corrected_from ?? null,
      reference_text: p.reference?.text ?? null, reference_withheld: !p.reference?.text,
      reference_meta: { title: p.reference.title, translator: p.reference.translator, year: p.reference.year, licence: p.reference.licence, private: !p.reference.publishable, style: p.reference.style, canonical: p.reference.canonical, located: p.reference.located, url: p.reference.url, coverage_note: p.reference.coverage_note },
      served_fidelity: served[p.id], primary_cause: c?.primary_cause ?? null,
      track_fidelity: corrected ? { lite_ocr: lo[p.id], lite_corr: lc[p.id], flash_ocr: fo[p.id], flash_corr: null, judges: 1, judged_against: 'corrected' } : null });
  }
}
// ── T3 vernaculars ── corrected-OCR packet: L1 / F0 on the OCR, L1_fix / F0_fix on the corrected text
{
  const rec = rl(`${T3}/records.jsonl`); const res = rj(`${T3}/results.json`), rc = rj(`${T3}/results-corrected-ocr.json`);
  const corr = Object.fromEntries(rl(`${T3}/corrected-ocr.jsonl`).map((c) => [idOf(c.book_id, c.page_number), c.source_text]));
  const img = Object.fromEntries(rl(`${T3}/image-check.jsonl`).map((c) => [c.id ?? idOf(c.book_id, c.page_number), c.primary_cause ?? c.cause ?? null]));
  const served = perPage(res, 'served'), lo = perPage(rc, 'L1'), lc = perPage(rc, 'L1_fix'), fo = perPage(rc, 'F0'), fc = perPage(rc, 'F0_fix');
  for (const r of rec) {
    const id = idOf(r.book_id, r.page_number);
    push({ track: 'T3', id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, edition_year: r.book_meta?.year ?? null, stratum: r.book_meta?.period ?? null, ocr_text: r.source_text, corrected_text: corr[id] ?? null,
      reference_text: r.reference_text, reference_meta: r.reference_meta, served_fidelity: served[id], primary_cause: img[id] ?? null,
      track_fidelity: corr[id] ? { lite_ocr: lo[id], lite_corr: lc[id], flash_ocr: fo[id], flash_corr: fc[id], judges: 2, judged_against: 'see write-up' } : null });
  }
}
// ── T4 Hebrew/Aramaic, Arabic, Persian ── packet 2: prod-A / flash-0 on the OCR and lite-fixocr / flash-fixocr, judged against the corrected text
if (T4) {
  const refs = rl(`${T4}/references.jsonl`); const pages = rl(`${T4}/pages.jsonl`);
  const fid = (arm, packet) => Object.fromEntries(pages.filter((p) => p.arm === arm && p.packet === packet).map((p) => [p.id, p.fidelity]));
  const served = fid('served', 1), lo = fid('prod-A', 2), fo = fid('flash-0', 2), lc = fid('lite-fixocr', 2), fc = fid('flash-fixocr', 2);
  const meta = Object.fromEntries(pages.filter((p) => p.arm === 'served').map((p) => [p.id, p]));
  const img = Object.fromEntries(rj(`${T4}/image-check.json`).map((c) => [c.id, c]));
  for (const r of refs) {
    const fx = `${T4}/corrected-transcriptions/${r.book_id}_${r.page_number}.txt`;
    const corrected = fs.existsSync(fx) ? fs.readFileSync(fx, 'utf8') : null;
    push({ track: 'T4', id: r.id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, edition_year: null, stratum: meta[r.id]?.period_bucket ?? null, ocr_text: r.source_text_ocr, corrected_text: corrected,
      reference_text: r.reference_text ?? null, reference_withheld: !r.reference_text, reference_meta: r.reference_meta, served_fidelity: served[r.id], primary_cause: img[r.id]?.primary_cause ?? null,
      ocr_word_errors_per_100_by_eye: img[r.id]?.ocr_word_errors_per_100 ?? null,
      track_fidelity: corrected ? { lite_ocr: lo[r.id], lite_corr: lc[r.id], flash_ocr: fo[r.id], flash_corr: fc[r.id], judges: 2, judged_against: 'corrected' } : null });
  }
}
// ── T5 Sanskrit, Pali, Chinese ── corrected-OCR packet: lite / flash on the OCR, lite-corr / flash-corr, judged against the corrected text
if (T5) {
  const rec = rl(`${T5}/work/records-arms.jsonl`); const res = rj(`${T5}/results.json`), rc = rj(`${T5}/results-corrected-ocr.json`);
  const ip = Object.fromEntries(rl(`${T5}/image-pass.jsonl`).map((c) => [c.id, c]));
  const pg = Object.fromEntries(rl(`${T5}/pages.jsonl`).map((p) => [p.id, p]));
  const served = perPage(res, 'served'), lo = perPage(rc, 'lite'), lc = perPage(rc, 'lite-corr'), fo = perPage(rc, 'flash'), fc = perPage(rc, 'flash-corr');
  for (const r of rec) {
    const id = idOf(r.book_id, r.page_number); const c = ip[id]; const corrected = c?.corrected_ocr && lc[id] != null ? c.corrected_ocr : null;
    push({ track: 'T5', id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, edition_year: Number(String(pg[id]?.edition?.published || '').match(/\d{4}/)?.[0]) || null, stratum: pg[id]?.edition?.period ?? null,
      ocr_text: r.source_text, corrected_text: corrected, corrected_scope: c?.corrected_scope ?? null, reference_text: r.reference_text, reference_meta: r.reference_meta,
      served_fidelity: served[id] ?? null, primary_cause: c?.primary_cause ?? null,
      track_fidelity: corrected ? { lite_ocr: lo[id], lite_corr: lc[id], flash_ocr: fo[id], flash_corr: fc[id], judges: 2, judged_against: 'corrected' } : null });
  }
}

const keep = rows.filter((r) => r.has_corrected || r.served_low);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'track-pages.jsonl'), keep.map((r) => JSON.stringify(r)).join('\n') + '\n');
const by = {}; for (const r of rows) { const k = r.track; by[k] ??= { pages: 0, corrected: 0, served_low: 0, kept: 0, low_without_corrected: 0, reference_withheld: 0 }; by[k].pages++; if (r.has_corrected) by[k].corrected++; if (r.served_low) by[k].served_low++; if (r.has_corrected || r.served_low) { by[k].kept++; if (r.reference_withheld) by[k].reference_withheld++; } if (r.served_low && !r.has_corrected) by[k].low_without_corrected++; }
console.table(by); console.log(`kept ${keep.length} of ${rows.length} track pages → ${OUT}/track-pages.jsonl`);
