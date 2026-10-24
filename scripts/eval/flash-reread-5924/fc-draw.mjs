#!/usr/bin/env node
// PRIOR ART: ./draw.mjs (writes draw/<slug>.{jpg,full.jpg,lite.txt}) and ./oc-set.mjs (stored-text check) — the
//   draw/ dir they made lives on l7a only; this box (clawdbot) runs the Flash-correction arm, so it rebuilds draw/ for
//   the same 250 pages with draw.mjs's exact image steps, without re-running the frame or the sample.
// fc-draw.mjs — the Flash-correction arm's inputs (#5924, PREREGISTRATION-flash-correct.md): for each page in
//   results/sample.json, the image (getPageSource, as draw.mjs) as $JOB_SCRATCH/draw/<slug>.jpg (≤ 2000 px) and
//   .full.jpg, and the stored ocr.data as <slug>.lite.txt. The judged lite text is not committed, so a page is kept
//   only when its stored text hashes to the `stored_sha256` the Opus correction recorded (results/oc-reads.jsonl.gz;
//   oc-set.mjs had checked that against the judged lite text, 250/250). Writes results/fc-stored-check.json and
//   $JOB_SCRATCH/pages.json (the kept page ids). Reads Mongo only.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname), J = process.env.JOB_SCRATCH;
const OUT = path.join(J, 'draw'); fs.mkdirSync(OUT, { recursive: true });
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'results/sample.json'), 'utf8'));
const O = new Map(zlib.gunzipSync(fs.readFileSync(path.join(HERE, 'results/oc-reads.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.page_id, r]));
const all = sample.books.flatMap((b) => b.pages.map((p) => ({ ...p, book_id: b.book_id })));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const stored = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: all.map((p) => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray()).map((p) => [p.id, p]));
await c.close();
const kept = [], mismatch = [], imgDiff = [];
for (const p of all) {
  const s = stored.get(p.page_id), o = O.get(p.page_id), data = s?.ocr?.data ?? '';
  if (!s || !o || contentHash(data) !== o.stored_sha256) { mismatch.push({ slug: p.slug, page_id: p.page_id, found: !!s, stored_chars: data.length, stored_updated_at: s?.ocr?.updated_at ?? null }); continue; }
  fs.writeFileSync(path.join(OUT, `${p.slug}.lite.txt`), data);
  if (!fs.existsSync(path.join(OUT, `${p.slug}.full.jpg`))) {
    const r = await fetch(getPageSource(s), { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${p.slug} HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (createHash('sha256').update(buf).digest('hex') !== o.image_sha256) imgDiff.push(p.slug);
    await sharp(buf).resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(OUT, `${p.slug}.jpg`));
    await sharp(buf).jpeg({ quality: 92 }).toFile(path.join(OUT, `${p.slug}.full.jpg`));
  }
  kept.push(p.page_id);
}
fs.writeFileSync(path.join(J, 'pages.json'), JSON.stringify(kept));
fs.writeFileSync(path.join(HERE, 'results/fc-stored-check.json'), JSON.stringify({ checked_at: new Date().toISOString(), pages: all.length, match: kept.length, mismatch, image_bytes_differ_from_opus_run: imgDiff }, null, 1));
console.log(JSON.stringify({ pages: all.length, match: kept.length, mismatch: mismatch.length, image_differs: imgDiff.length }));
