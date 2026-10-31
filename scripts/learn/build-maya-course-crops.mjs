#!/usr/bin/env node
// PRIOR ART: scripts/learn/build-maya-items.mjs — renders the v1 item crops the same way (book-scoped R2 key, hash of source+box), but only for items in learn_maya_items; the course's worked examples and in-the-wild crops are page regions, not items, so they get their own list and no Mongo write.
/**
 * Render the /learn/maya course crops (#6921, v2) from maya-course-crops.json.
 *
 *   node scripts/learn/build-maya-course-crops.mjs --check=<dir>     # write JPGs locally, to look at
 *   node --env-file=.env.production.local scripts/learn/build-maya-course-crops.mjs --apply
 *
 * Writes src/app/learn/maya/course-crops.json (id → url, page url, label) either way;
 * --apply uploads to R2 under learn-maya/<book_id>/course-<id>-<hash>.jpg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.find((a) => a.startsWith('--check='))?.slice(8);
const SRC = JSON.parse(fs.readFileSync(path.join(HERE, 'maya-course-crops.json'), 'utf8'));
const R2_PUBLIC = 'https://images.sourcelibrary.org';
const OUT = path.join(ROOT, 'src/app/learn/maya/course-crops.json');

const pageImg = (bookId, n) => `${R2_PUBLIC}/archived/${bookId}/${n}.jpg`;
const out = {};
const jobs = [];
for (const c of SRC.crops) {
  const bookId = SRC.books[c.book];
  const src = pageImg(bookId, c.page);
  const hash = crypto.createHash('sha1').update(`${src}|${c.box.join(',')}|${c.max}`).digest('hex').slice(0, 8);
  const key = `learn-maya/${bookId}/course-${c.id}-${hash}.jpg`;
  assertBookScopedKey(key, bookId, 'build-maya-course-crops');
  out[c.id] = { url: `${R2_PUBLIC}/${key}`, page_url: `/book/${bookId}?page=${c.page}`, label: c.label };
  jobs.push({ ...c, bookId, src, key });
}

async function render(j) {
  const r = await fetch(j.src);
  if (!r.ok) throw new Error(`fetch ${j.src}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const { width: W, height: H } = await sharp(buf).metadata();
  const [x, y, w, h] = j.box;
  const left = Math.max(0, Math.floor(x * W)), top = Math.max(0, Math.floor(y * H));
  return sharp(buf)
    .extract({ left, top, width: Math.min(W - left, Math.ceil(w * W)), height: Math.min(H - top, Math.ceil(h * H)) })
    .resize(j.max, j.max, { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

if (CHECK) {
  fs.mkdirSync(CHECK, { recursive: true });
  for (const j of jobs) fs.writeFileSync(path.join(CHECK, `${j.id}.jpg`), await render(j));
  console.log(`wrote ${jobs.length} crops to ${CHECK}`);
}
if (APPLY) {
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  const bucket = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
  for (const j of jobs) {
    assertBookScopedKey(j.key, j.bookId, 'build-maya-course-crops');
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: j.key, Body: await render(j), ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
  }
  console.log(`uploaded ${jobs.length} crops`);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}`);
