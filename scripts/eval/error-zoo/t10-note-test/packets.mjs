#!/usr/bin/env node
// PRIOR ART: scripts/audit/convergent-audit-weekly.mjs `draw` (makeRecord: the packet record, the image download and
// redactRecord, copied in shape so the weekly audit's reader reads these packets exactly as it reads its own) and
// scripts/eval/route-judge-6740/judge.mjs (key.json with item / wrong_page / repeat rows). Neither packs two prompt arms
// of one page blind. Read-only on Mongo.
/**
 * Packets for the T10 note-rule test (v3#44): one packet per (page, arm), with the arm's fresh read as the English, plus
 * controls. Arm names never reach a packet; packet ids are shuffled; the key stays in DIR/key.json, outside the sealed
 * reader folders.
 *
 *   node --env-file=.env.production.local scripts/eval/error-zoo/t10-note-test/packets.mjs --run DIR [--repeats 6] [--wrong 3]
 *
 * Controls (paired-arm-judge R3, R4):
 *   - repeat: an arm-A read packed a second time, so the reader's noise on identical text is measured (6 pages).
 *   - wrong_page: per arm, a page's transcription and English shown with the image of the next leaf of the same book
 *     (3 per arm). A reader that does not answer right_page "no" there is not reading the image.
 * Then: EXTRA_BRIEFS=<abs>/NOTES-ADDENDUM.md scripts/eval/second-reader/run-readers.sh DIR opus claude opus read 4
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { structureCounts, pageImageUrl } from '../../spot-check/lib.mjs';
import { redactRecord } from '../../second-reader/lib.mjs';
import { makeRng } from '../../lib/paired-stats.mjs';
import { contentHash } from '../../../lib/translate-core.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const R = arg('run'); const N_REPEAT = Number(arg('repeats', 6)), N_WRONG = Number(arg('wrong', 3));
if (!R) { console.error('--run DIR required'); process.exit(2); }
const J = (...p) => path.join(R, ...p);
if (fs.existsSync(J('packets'))) { console.error(`${J('packets')} exists: refusing to pack over a run`); process.exit(2); }
const draw = JSON.parse(fs.readFileSync(J('draw.json'), 'utf8'));
const rng = makeRng(draw.seed + 1);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// The arm's read of a page: the .txt claude-translate wrote, if its meta says the call succeeded.
function readOf(arm, pageId) {
  for (const s of fs.readdirSync(J(arm))) {
    const m = J(arm, s, `${pageId}.meta.json`);
    if (!fs.existsSync(m)) continue;
    const meta = JSON.parse(fs.readFileSync(m, 'utf8'));
    const text = fs.readFileSync(J(arm, s, `${pageId}.txt`), 'utf8').trim();
    return meta.exit === 0 && text.length > 20 ? { text, meta } : null;
  }
  return null;
}

async function download(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return null;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const file = `images/${sha.slice(0, 16)}.jpg`;
    fs.writeFileSync(J(file), buf);
    return { file, sha256: sha };
  } catch { return null; }
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
fs.mkdirSync(J('images'), { recursive: true });
const proj = { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 };
const bookProj = { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, visible: 1, 'catalog_metadata.collections': 1 };

const items = [], skipped = [];
for (const d of draw.pages) {
  const A = readOf('A', d.page_id), B = readOf('B', d.page_id);
  if (!A || !B) { skipped.push({ page_id: d.page_id, why: `${A ? '' : 'A'}${B ? '' : 'B'} read missing or failed` }); continue; }
  const p = await db.collection('pages').findOne({ id: d.page_id }, { projection: proj });
  // The transcription the arms translated must be the one the reader sees (claude-translate records its hash).
  const ocrHash = contentHash(p?.ocr?.data ?? '');
  const url = p && pageImageUrl(p), img = url ? await download(url) : null;
  if (!img) { skipped.push({ page_id: d.page_id, why: 'image unavailable' }); continue; }
  const book = await db.collection('books').findOne({ id: d.book_id }, { projection: bookProj });
  const all = await db.collection('pages').find({ book_id: d.book_id }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  const next = await db.collection('pages').findOne({ book_id: d.book_id, page_number: d.page_number + 1 }, { projection: proj });
  items.push({ d, p, A, B, img, url, book, structure: { ...structureCounts(all), pages_count_field: book?.pages_count, pages_translated_field: book?.pages_translated }, next, ocrHash });
}

const record = (it, english, image) => redactRecord({ slot: 1, stratum: 'audit', book_id: it.d.book_id, book_url: '', tradition: null, book: it.book, structure: it.structure, run: [it.d.page_number],
  pages: [{ page_number: it.d.page_number, page_id: it.d.page_id, image_url: image.url, image_file: image.file, image_sha256: image.sha256,
    crop: !it.p.split_from_spread && !it.p.cropped_photo && it.p.crop?.xStart !== undefined ? it.p.crop : undefined,
    ocr: it.p.ocr.data, translation: english }] });

const rows = [];
for (const it of items) for (const arm of ['A', 'B']) rows.push({ kind: 'item', arm, it, rec: record(it, it[arm].text, { ...it.img, url: it.url }) });
const t10Items = items.filter((it) => it.d.stratum === 't10');
for (const it of shuffle(t10Items).slice(0, N_REPEAT)) rows.push({ kind: 'repeat', arm: 'A', it, rec: record(it, it.A.text, { ...it.img, url: it.url }) });
const withNext = shuffle(items.filter((it) => it.next && pageImageUrl(it.next)));
for (const [k, arm] of [['0', 'A'], ['1', 'B']]) {
  let made = 0;
  for (const it of withNext.filter((_, i) => i % 2 === Number(k))) {
    if (made >= N_WRONG) break;
    const nUrl = pageImageUrl(it.next), nImg = await download(nUrl);
    if (!nImg || nImg.sha256 === it.img.sha256) continue;
    rows.push({ kind: 'wrong_page', arm, it, rec: record(it, it[arm].text, { ...nImg, url: nUrl }) }); made++;
  }
}
await client.close();

const key = shuffle(rows).map((r, i) => {
  const id = `p${String(i).padStart(3, '0')}`;
  fs.mkdirSync(J('packets'), { recursive: true });
  fs.writeFileSync(J('packets', `${id}.json`), JSON.stringify([r.rec], null, 1) + '\n');
  return { id, kind: r.kind, arm: r.arm, stratum: r.it.d.stratum, page_id: r.it.d.page_id, book_id: r.it.d.book_id, page_number: r.it.d.page_number, language: r.it.d.language,
    ocr_hash_now: r.it.ocrHash, read_ocr_hash: r.it[r.arm].meta.ocr_hash ?? null };
});
fs.writeFileSync(J('key.json'), JSON.stringify({ packed_at: new Date().toISOString(), skipped, rows: key }, null, 1));
const c = (k) => key.filter((r) => r.kind === k).length;
console.log(`packed ${key.length}: ${c('item')} items (${items.length} pages x 2 arms), ${c('repeat')} repeats, ${c('wrong_page')} wrong-page controls; skipped ${skipped.length}: ${JSON.stringify(skipped)}`);
