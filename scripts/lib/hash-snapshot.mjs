/**
 * hash-snapshot.mjs — the shared pieces of the text hash snapshot (#8150 slice 10): what a page commits to,
 * how books and the corpus are rolled up, image hashes for the #4406 write ledger, and the before/after
 * snapshot a bulk sweep takes of the books it touches.
 *
 * PRIOR ART: scripts/maintenance/hash-snapshot.mjs (the weekly whole-corpus run built from the restic dump;
 * this module is what it and a sweep share); scripts/lib/sweep-log.mjs (records that a sweep RAN and what it
 * meant to change; it holds no commitment to the text before and after, which is what this adds);
 * scripts/lib/write-provenance.mjs `contentHash` (64-bit, absent on about half of OCR'd pages — checked
 * against here, not relied on); scripts/lib/merkle.mjs; scripts/lib/opentimestamps.mjs.
 */
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { fieldText } from './page-text-writer.mjs';
import { contentHash } from './write-provenance.mjs';
import { textLeaf, bookLeaf, merkleRoot, compareLeafRows } from './merkle.mjs';
import { validateR2Key } from './r2-key.mjs';
import { stampDigest } from './opentimestamps.mjs';

export const TEXT_FIELDS = ['ocr', 'translation'];
export const SNAPSHOT_BUCKET = 'sl-corpus-snapshots';
export const SNAPSHOT_PREFIX = 'hash-snapshots/text';
export const SWEEP_PREFIX = 'hash-snapshots/sweeps';

const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Rows a page document contributes: one per text field that carries text. */
export function pageRows(doc, drift) {
  const out = [];
  const bookId = doc.book_id;
  if (bookId === undefined || bookId === null || bookId === '') { if (drift) drift.no_book_id++; return out; }
  for (const field of TEXT_FIELDS) {
    const text = fieldText(doc[field]);
    if (!text) continue;
    const row = { bookId: String(bookId), pageId: String(doc._id), pageNumber: String(doc.page_number ?? ''), field, sha: sha256hex(text) };
    if (/[\t\n]/.test(row.bookId + row.pageId + row.pageNumber)) throw new Error(`hash-snapshot: tab or newline in an id of page ${row.pageId}`);
    if (drift) {
      const stored = doc[field]?.content_hash;
      if (!stored) drift[`${field}_no_stored_hash`]++;
      else if (stored !== contentHash(text)) drift[`${field}_stored_hash_mismatch`]++;
    }
    out.push(row);
  }
  return out;
}

/** Group rows into books; returns [{ book_id, n, root, rows }] sorted by book_id. */
export function booksFromRows(rows) {
  const by = new Map();
  for (const r of rows) { let a = by.get(r.bookId); if (!a) by.set(r.bookId, (a = [])); a.push(r); }
  const books = [];
  for (const [bookId, rs] of by) {
    rs.sort(compareLeafRows);
    const leaves = rs.map((r) => textLeaf({ bookId, pageId: r.pageId, pageNumber: r.pageNumber, field: r.field, textSha256: r.sha }));
    books.push({ book_id: bookId, n: rs.length, root: merkleRoot(leaves), rows: rs.map((r) => [r.pageId, r.pageNumber, r.field, r.sha]) });
  }
  return books.sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : 0));
}

export function corpusRoot(bookRoots) {
  return merkleRoot(bookRoots.map((b) => bookLeaf({ bookId: b.book_id, n: b.n, root: b.root })));
}

// ── images (the #4406 write ledger) ──────────────────────────────────────────

/**
 * sha256 of the bytes plus a 64-bit difference hash (dHash: 9x8 greyscale, each bit = left pixel brighter
 * than its right neighbour). The sha256 proves the exact file; the dHash still matches after re-encoding or
 * resizing, which is what a copier does to an image. Hamming distance <= 10 of 64 is the usual "same image".
 */
export async function imageHashes(buf) {
  const sharp = (await import('sharp')).default;
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return { sha256: createHash('sha256').update(buf).digest('hex'), dhash: bits.toString(16).padStart(16, '0'), bytes: buf.length };
}

export function hamming64(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

// ── sweep snapshots ──────────────────────────────────────────────────────────

/**
 * Commit to the current text of every page of `bookIds`, before or after a bulk change. Reads only those
 * books' pages (the same rows the sweep is about to touch), writes one gzipped JSON to the private snapshot
 * bucket under hash-snapshots/sweeps/, stamps the root with OpenTimestamps next to it (<phase>.ots; a
 * calendar outage is reported, never fatal: the sweep is not held up by it), and returns
 * { runId, key, root, books, rows, stamped }. A pending .ots completes later with `upgradeOts`.
 *
 *   const before = await snapshotBooks(db, ids, { label: 'reocr-greek', phase: 'before' });
 *   … the sweep …
 *   const after = await snapshotBooks(db, ids, { label: 'reocr-greek', phase: 'after', runId: before.runId });
 *
 * `put` is injectable for tests; by default it writes to R2 with If-None-Match, so no snapshot is replaced.
 */
export async function snapshotBooks(db, bookIds, { label, phase, runId = null, put = null, stamp = null, now = new Date() } = {}) {
  if (!label || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(label)) throw new Error('snapshotBooks: label must be a short lowercase slug');
  if (phase !== 'before' && phase !== 'after') throw new Error("snapshotBooks: phase must be 'before' or 'after'");
  const ids = [...new Set(bookIds.map(String))];
  if (!ids.length) throw new Error('snapshotBooks: no books');
  const rows = [];
  const drift = { no_book_id: 0, ocr_no_stored_hash: 0, ocr_stored_hash_mismatch: 0, translation_no_stored_hash: 0, translation_stored_hash_mismatch: 0 };
  const cur = db.collection('pages').find({ book_id: { $in: ids } }, { projection: { book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.content_hash': 1, 'translation.data': 1, 'translation.content_hash': 1 } });
  for await (const doc of cur) rows.push(...pageRows(doc, drift));
  const books = booksFromRows(rows);
  const root = corpusRoot(books);
  const run = runId || `${now.toISOString().replace(/[:.]/g, '').slice(0, 15)}-${label}`;
  const key = `${SWEEP_PREFIX}/${run}/${phase}.json.gz`;
  validateR2Key(key, 'snapshotBooks');
  const body = zlib.gzipSync(JSON.stringify({ kind: 'sourcelibrary-sweep-hash-snapshot', format: 1, run, label, phase, at: now.toISOString(), book_ids: ids, root, counts: { books: books.length, rows: rows.length }, stored_content_hash_check: drift, books }));
  const write = put || r2Put;
  await write(key, body);
  let stamped = false;
  try {
    const { ots } = await (stamp || stampDigest)(Buffer.from(root, 'hex'), { minResponses: 1 });
    await write(`${SWEEP_PREFIX}/${run}/${phase}.ots`, ots);
    stamped = true;
  } catch (e) { console.error(`  snapshotBooks: root ${root} not stamped (${e.message}); the snapshot itself is written`); }
  return { runId: run, key, root, books: books.length, rows: rows.length, stamped };
}

async function r2Put(key, body) {
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) throw new Error(`snapshotBooks: ${k} not set`);
  const sdk = await import('@aws-sdk/client-s3');
  const s3 = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  await s3.send(new sdk.PutObjectCommand({ Bucket: SNAPSHOT_BUCKET, Key: key, Body: body, ContentType: 'application/gzip', IfNoneMatch: '*' }), { abortSignal: AbortSignal.timeout(30_000) });
}
