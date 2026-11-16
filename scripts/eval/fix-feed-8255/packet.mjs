#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/draw.mjs + REVIEWER.md (a random draw of books, 3 consecutive pages, image URLs the
// reviewer downloads itself; it does not start from a stored verdict's flagged pages) and scripts/eval/paired-fifths-8405/run.mjs
// imageFor() (the fetch-and-resize, restated: that module runs its CLI on import). Neither builds a packet from the pages a
// `fix` verdict already names.
/**
 * fix-feed-8255 packets: for each visible book whose latest image-opened book_checks verdict is `fix`, the pages that
 * verdict flagged (up to 4) plus 2 other pages with text (seeded), each with its image on disk, its OCR and its English.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fix-feed-8255/packet.mjs --frame=frame.json --out=DIR [--lang=Hebrew] [--limit=N]
 *
 * Writes DIR/<book_id>/packet.json and DIR/<book_id>/<page_number>.jpg. A book with a packet.json is skipped (resume).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const FRAME = JSON.parse(fs.readFileSync(arg('frame'), 'utf8')), OUT = path.resolve(arg('out'));
const LANG = arg('lang'), LIMIT = Number(arg('limit', 1e9)), MAX_FLAGGED = 4, EXTRA = 2, MAX_CHARS = 9000;
export const firstLang = (l) => String(l || '?').split(/[,;/ ]/)[0];
const h = (s) => createHash('sha1').update(s).digest('hex');
const PROJ = { _id: 0, id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, translation_withheld: 1, translation_stale: 1, script_type: 1, crop: 1,
  archived_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 };

async function image(url, file) {
  if (fs.existsSync(file)) return true;
  const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/8255 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(90e3) });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  let buf = Buffer.from(await r.arrayBuffer());
  const { default: sharp } = await import('sharp');
  buf = await sharp(buf).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  fs.writeFileSync(file, buf);
  return true;
}

const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
const books = FRAME.filter((b) => !LANG || firstLang(b.language) === LANG).slice(0, LIMIT);
let built = 0, skipped = 0;
for (const b of books) {
  const dir = path.join(OUT, b.book_id);
  if (fs.existsSync(path.join(dir, 'packet.json'))) { skipped++; continue; }
  fs.mkdirSync(dir, { recursive: true });
  const c = b.check;
  const flaggedNums = [...new Set([...(c.page_findings ?? []).map((f) => f.page_number),
    ...(c.page_notes ?? []).filter((n) => n.outcome === 'serious' || (n.defects ?? []).some((d) => d.severity === 'wrong_text')).map((n) => n.page_number)])];
  // a row with no per-page record: its pages_read are the flagged set
  const flagged = (flaggedNums.length ? flaggedNums : c.pages_read ?? []).slice(0, MAX_FLAGGED);
  const all = await db.collection('pages').find({ book_id: b.book_id, page_number: { $gt: 0 }, 'ocr.data': { $type: 'string', $ne: '' } }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const pool = all.filter((p) => !flagged.includes(p.page_number) && !(c.pages_read ?? []).includes(p.page_number) && p.ocr.data.length >= 300 && (p.translation?.data ?? '').length >= 100)
    .sort((x, y) => h(`8255|${x.id}`).localeCompare(h(`8255|${y.id}`)));
  const extra = pool.slice(0, EXTRA).map((p) => p.page_number);
  const want = [...flagged, ...extra];
  const pages = await db.collection('pages').find({ book_id: b.book_id, page_number: { $in: want } }, { projection: PROJ }).toArray();
  const out = [];
  for (const n of want) {
    const p = pages.find((x) => x.page_number === n);
    if (!p) { out.push({ page_number: n, missing: true }); continue; }
    const url = getPageSource(p);
    let img = null, img_error = null;
    try { if (!url) throw new Error('no usable image url'); await image(url, path.join(dir, `${n}.jpg`)); img = `${n}.jpg`; } catch (e) { img_error = e.message; }
    const ocr = p.ocr?.data ?? '', tr = typeof p.translation === 'string' ? p.translation : p.translation?.data ?? '';
    const prov = (c.text_provenance ?? []).find((t) => t.page_number === n);
    const changed = prov ? [[p.ocr?.updated_at, prov.ocr_updated_at], [p.translation?.updated_at, prov.translation_updated_at]].some(([now, then]) => now && then && new Date(now).getTime() !== new Date(then).getTime()) : null;
    out.push({ page_id: p.id, page_number: n, role: flagged.includes(n) ? 'flagged' : 'extra', image: img, img_error, crop: p.split_from_spread && !p.cropped_photo ? p.crop ?? null : null,
      page_type: p.page_type ?? null, ocr_model: p.ocr?.model ?? p.ocr?.source ?? null, ocr_pipeline: p.ocr?.pipeline ?? null, translation_model: p.translation?.model ?? null,
      withheld: Boolean(p.translation_withheld), stale: Boolean(p.translation_stale), human_edited: Boolean(p.ocr?.edited_by || p.translation?.edited_by || p.translation?.source === 'manual'),
      text_changed_since_check: changed,
      prior_finding: (c.page_findings ?? []).find((f) => f.page_number === n) ?? null, prior_note: (c.page_notes ?? []).find((f) => f.page_number === n) ?? null,
      ocr: ocr.slice(0, MAX_CHARS), ocr_truncated: ocr.length > MAX_CHARS, translation: tr.slice(0, MAX_CHARS), translation_truncated: tr.length > MAX_CHARS,
      ocr_hash: contentHash(ocr), translation_hash: contentHash(tr) });
  }
  fs.writeFileSync(path.join(dir, 'packet.json'), JSON.stringify({ book_id: b.book_id, title: b.title, language: b.language, year: b.year, pages_count: b.pages_count, held: b.held, hold_reason: b.hold_reason,
    prior_check: { method_id: c.method_id, run_id: c.run_id, checked_at: c.checked_at, note: c.note ?? null, classes: c.classes ?? null }, pages: out }, null, 1));
  built++;
  console.log(`${b.book_id} ${firstLang(b.language)} ${String(b.title).slice(0, 50)}: ${out.filter((p) => p.role === 'flagged').length} flagged + ${out.filter((p) => p.role === 'extra').length} extra${out.some((p) => p.img_error) ? ` (image errors: ${out.filter((p) => p.img_error).map((p) => `${p.page_number} ${p.img_error}`).join('; ')})` : ''}`);
}
console.log(`built ${built}, already had ${skipped}`);
await client.close();
