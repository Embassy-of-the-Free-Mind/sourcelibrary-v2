// PRIOR ART: scripts/eval/translation-vs-reference/gallery.mjs prints source/reference/ours for a page but never opens
// the image; scripts/eval/lib/sampling.mjs fetches page images for OCR arms, not crops for a by-eye reader. This
// builds, per low-scoring page, what a by-eye reader needs: the image cut into overlapping tiles (legible at the
// reader's resolution) and one JSON with the OCR, the served English and the judges' defects (#5695 Addendum 3).
/** image-pass-bundle.mjs <results.json> <records.jsonl> <ids.json> <img dir> <out dir> — tiles + per-page bundle for the by-eye cause pass. */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [RES, RECS, IDS, IMG, OUT] = process.argv.slice(2);
const res = JSON.parse(fs.readFileSync(RES, 'utf8'));
const recs = Object.fromEntries(fs.readFileSync(RECS, 'utf8').trim().split('\n').map(JSON.parse).map((r) => [`${r.book_id}_${String(r.page_number).padStart(5, '0')}`, r]));
const per = Object.fromEntries(res.per_page.map((p) => [p.id, p]));
fs.mkdirSync(OUT, { recursive: true });
for (const s of JSON.parse(fs.readFileSync(IDS, 'utf8'))) {
  const src = path.join(IMG, `${s.id}.jpg`);
  const meta = await sharp(src).metadata();
  const landscape = meta.width > meta.height * 1.15;
  const [cols, rows] = landscape ? [3, 2] : [2, 3];
  const tw = Math.ceil(meta.width / cols * 1.12), th = Math.ceil(meta.height / rows * 1.12);
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const left = Math.min(meta.width - tw, Math.max(0, Math.round(c * meta.width / cols - (tw - meta.width / cols) / 2)));
    const top = Math.min(meta.height - th, Math.max(0, Math.round(r * meta.height / rows - (th - meta.height / rows) / 2)));
    const f = path.join(OUT, `${s.id}.r${r + 1}c${c + 1}.jpg`);
    await sharp(src).extract({ left: Math.max(0, left), top: Math.max(0, top), width: Math.min(tw, meta.width), height: Math.min(th, meta.height) }).jpeg({ quality: 90 }).toFile(f);
    tiles.push(f);
  }
  const r = recs[s.id]; const p = per[s.id];
  const served = r.candidates.find((c) => c.arm === 'served');
  fs.writeFileSync(path.join(OUT, `${s.id}.json`), JSON.stringify({ id: s.id, lang: r.lang, why: s.why, page_url: `https://sourcelibrary.org/book/${r.book_id}?page=${r.page_number}`,
    image: src, image_size: [meta.width, meta.height], tiles, tile_layout: `${rows} rows × ${cols} cols, r1c1 = top-left, 12% overlap`,
    ocr: r.source_text, served_english: served?.text, served_fidelity: p.arms.served.fidelity,
    judges_on_served: Object.fromEntries(Object.entries(p.arms.served.by_judge).map(([j, v]) => [j, { fidelity: v.fidelity, omission: v.omission, reversal: v.reversal, invention: v.invention, defects: v.defects, span: v.span }])),
    judge_reason: p.reason ?? p.reasons ?? null, reference_translator: r.reference_meta.translator, reference: r.reference_text }, null, 1));
}
console.log('bundles written');
