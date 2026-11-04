#!/usr/bin/env node
/**
 * hash-snapshot.mjs — a Merkle-rooted, publicly timestamped commitment to every page's text (#8150 slice 10).
 *
 * WHY: a mark can be stripped from a copy. A hash we published BEFORE a copy appeared proves we held that
 * exact text on that date. That is priority and integrity evidence, separate from attribution.
 *
 * PRIOR ART — this adds no new storage of text; every input is something we already keep:
 *   - scripts/workers/backup-corpus-text.sh: the weekly `corpus-text` restic snapshot of `pages`. The
 *     snapshot is built FROM that dump (`restic dump … pages.archive.gz`), so it costs no Atlas egress and
 *     commits to exactly the bytes we would restore.
 *   - scripts/lib/mongo-archive.mjs: streams the dump (same layout verify-dump-stream.mjs counts).
 *   - scripts/lib/page-text-writer.mjs `fieldText`: what counts as a field's text.
 *   - pages.ocr/translation.content_hash (write-provenance.mjs `contentHash`): NOT used as the leaf — it is
 *     64 bits and absent on about half of OCR'd pages (sample 2026-11-04, 773/1602) — but checked against the
 *     text, and the mismatch count is reported, so a stale stored hash shows up here.
 *   - scripts/lib/mirror.mjs `bucketOf`: the same crc32(book_id) % 64 partition the Parquet mirror uses.
 *   - the private R2 bucket `sl-corpus-snapshots` (candidate-reads.mjs, build-corpus-snapshot.mjs), under a
 *     new dated prefix `hash-snapshots/text/<id>/`, written with If-None-Match so nothing is overwritten.
 *   What is new: the Merkle tree (scripts/lib/merkle.mjs) and the public timestamp (OpenTimestamps,
 *   scripts/lib/opentimestamps.mjs; $0, no account; chosen over a weekly Zenodo deposit because a Zenodo
 *   record can be versioned by its owner, and OTS needs no credentials on the box).
 *
 * Output (per snapshot, under --dir):
 *   books/NN.jsonl.gz   one line per book: { book_id, n, root, rows: [[page_id, page_number, field, sha256]] }
 *   book-roots.jsonl.gz { book_id, n, root } sorted by book_id: the corpus tree's leaves, in order
 *   manifest.json       counts, source, algorithm, the corpus root
 *   root.ots            OpenTimestamps proof of the root (pending until a Bitcoin block confirms; `upgrade`)
 * Hashes reveal no text. No field is added to `pages`.
 *
 *   restic dump <snap> pages.archive.gz | gunzip | node scripts/maintenance/hash-snapshot.mjs build --archive - --dir D --source restic:<snap>
 *   node scripts/maintenance/hash-snapshot.mjs stamp   --dir D
 *   node scripts/maintenance/hash-snapshot.mjs upgrade --dir D
 *   node --env-file=.env.production.local scripts/maintenance/hash-snapshot.mjs upload --dir D
 *   node scripts/maintenance/hash-snapshot.mjs prove --dir D --book <book_id> --page <page_id> --field ocr|translation > proof.json
 *   node scripts/maintenance/verify-snapshot-proof.mjs --proof proof.json --text page.txt --ots D/root.ots
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readMongoArchive } from '../lib/mongo-archive.mjs';
import { pageRows, booksFromRows, corpusRoot, TEXT_FIELDS, SNAPSHOT_BUCKET, SNAPSHOT_PREFIX } from '../lib/hash-snapshot.mjs';
import { bucketOf, PAGE_BUCKETS } from '../lib/mirror.mjs';
import { textLeaf, bookLeaf, merkleProof, TEXT_LEAF_VERSION, BOOK_LEAF_VERSION } from '../lib/merkle.mjs';
import { stampDigest, upgradeOts, parseOts, attestations } from '../lib/opentimestamps.mjs';
import { validateR2Key } from '../lib/r2-key.mjs';

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : def; };
const log = (m) => console.error(`[hash-snapshot ${new Date().toISOString()}] ${m}`);

// ── build ────────────────────────────────────────────────────────────────────

async function writeLines(file, items) {
  const gz = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(file);
  gz.pipe(out);
  for (const it of items) if (!gz.write(JSON.stringify(it) + '\n')) await once(gz, 'drain');
  gz.end();
  await once(out, 'close');
}

async function* readLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield JSON.parse(line);
}

async function build(dir, archive, source) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error(`${dir} already holds a snapshot; snapshots are append-only`);
  const tmp = path.join(dir, 'tmp'); fs.mkdirSync(tmp, { recursive: true }); fs.mkdirSync(path.join(dir, 'books'), { recursive: true });
  const started = new Date().toISOString();
  const outs = Array.from({ length: PAGE_BUCKETS }, (_, i) => fs.createWriteStream(path.join(tmp, `${String(i).padStart(2, '0')}.tsv`)));
  const drift = { no_book_id: 0, ocr_no_stored_hash: 0, ocr_stored_hash_mismatch: 0, translation_no_stored_hash: 0, translation_stored_hash_mismatch: 0 };
  let docs = 0, rows = 0;
  const input = archive === '-' ? process.stdin : fs.createReadStream(archive);
  for await (const { doc } of readMongoArchive(input, { collections: ['pages'] })) {
    docs++;
    for (const r of pageRows(doc, drift)) {
      const o = outs[bucketOf(r.bookId)];
      if (!o.write(`${r.bookId}\t${r.pageId}\t${r.pageNumber}\t${r.field}\t${r.sha}\n`)) await once(o, 'drain');
      rows++;
    }
    if (docs % 1_000_000 === 0) log(`${docs.toLocaleString()} pages read, ${rows.toLocaleString()} text rows`);
  }
  await Promise.all(outs.map((o) => new Promise((res) => o.end(res))));
  if (docs === 0) throw new Error('archive held no pages documents');
  log(`read done: ${docs} pages, ${rows} rows; building trees`);

  const bookRoots = [];
  for (let i = 0; i < PAGE_BUCKETS; i++) {
    const nn = String(i).padStart(2, '0');
    const tsv = path.join(tmp, `${nn}.tsv`);
    const rs = [];
    const rl = readline.createInterface({ input: fs.createReadStream(tsv), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const [bookId, pageId, pageNumber, field, sha] = line.split('\t');
      rs.push({ bookId, pageId, pageNumber, field, sha });
    }
    const books = booksFromRows(rs);
    await writeLines(path.join(dir, 'books', `${nn}.jsonl.gz`), books);
    for (const b of books) bookRoots.push({ book_id: b.book_id, n: b.n, root: b.root });
    fs.unlinkSync(tsv);
  }
  fs.rmdirSync(tmp);
  bookRoots.sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : 0));
  await writeLines(path.join(dir, 'book-roots.jsonl.gz'), bookRoots);
  const root = corpusRoot(bookRoots);
  const manifest = {
    kind: 'sourcelibrary-text-hash-snapshot', format: 1, id: path.basename(dir),
    source, started_at: started, finished_at: new Date().toISOString(),
    algorithm: {
      text: 'sha256 of the exact stored UTF-8 string of pages.<field> (fieldText: .data, or a legacy bare string)',
      leaf: `sha256(0x00 || "${TEXT_LEAF_VERSION}\\n" book_id "\\n" page_id "\\n" page_number "\\n" field "\\n" text_sha256_hex)`,
      book_leaf: `sha256(0x00 || "${BOOK_LEAF_VERSION}\\n" book_id "\\n" n "\\n" book_root_hex)`,
      node: 'sha256(0x01 || left || right); an odd last node is carried up; leaves of a book ordered by (page_number, page_id, field); books ordered by book_id',
      fields: TEXT_FIELDS, bucket: 'crc32(book_id) % 64 (scripts/lib/mirror.mjs bucketOf)',
    },
    counts: { pages_read: docs, text_rows: rows, books: bookRoots.length },
    stored_content_hash_check: drift,
    root,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  log(`root ${root} over ${bookRoots.length} books, ${rows} rows`);
  return manifest;
}

// ── stamp / upgrade ──────────────────────────────────────────────────────────

async function stamp(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const f = path.join(dir, 'root.ots');
  if (fs.existsSync(f)) { log('root.ots exists; use upgrade'); return; }
  const r = await stampDigest(Buffer.from(m.root, 'hex'));
  fs.writeFileSync(f, r.ots);
  log(`stamped ${m.root} with ${r.calendars} calendar(s)${r.errors.length ? `; failed: ${r.errors.join('; ')}` : ''}`);
}

async function upgrade(dir) {
  const f = path.join(dir, 'root.ots');
  const before = fs.readFileSync(f);
  const r = await upgradeOts(before);
  const done = attestations(parseOts(r.ots).timestamp).some((a) => a.kind === 'bitcoin');
  if (r.upgraded) { fs.writeFileSync(f + '.tmp', r.ots); fs.renameSync(f + '.tmp', f); }
  log(`${dir}: ${r.upgraded} upgraded, ${r.pending} still pending, bitcoin attestation ${done ? 'present' : 'not yet'}`);
  return { ...r, done };
}

// ── upload (append-only) ─────────────────────────────────────────────────────

async function upload(dir) {
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) throw new Error(`${k} not set`);
  const sdk = await import('@aws-sdk/client-s3');
  const s3 = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const id = path.basename(dir);
  const files = ['manifest.json', 'book-roots.jsonl.gz', ...fs.readdirSync(path.join(dir, 'books')).sort().map((f) => `books/${f}`)];
  let written = 0, existed = 0, bytes = 0;
  for (const rel of files) {
    const key = `${SNAPSHOT_PREFIX}/${id}/${rel}`;
    validateR2Key(key, 'hash-snapshot upload');
    const body = fs.readFileSync(path.join(dir, rel));
    try {
      await s3.send(new sdk.PutObjectCommand({ Bucket: SNAPSHOT_BUCKET, Key: key, Body: body, IfNoneMatch: '*' }));
      written++; bytes += body.length;
    } catch (e) {
      if (e?.$metadata?.httpStatus === 412) { existed++; continue; }
      throw e;
    }
  }
  // root.ots changes when upgraded; each version is its own key so earlier ones are never replaced.
  if (fs.existsSync(path.join(dir, 'root.ots'))) {
    const body = fs.readFileSync(path.join(dir, 'root.ots'));
    const key = `${SNAPSHOT_PREFIX}/${id}/root.${createHash('sha256').update(body).digest('hex').slice(0, 12)}.ots`;
    try { await s3.send(new sdk.PutObjectCommand({ Bucket: SNAPSHOT_BUCKET, Key: key, Body: body, IfNoneMatch: '*' })); written++; bytes += body.length; }
    catch (e) { if (e?.$metadata?.httpStatus !== 412) throw e; existed++; }
  }
  log(`upload ${id}: ${written} written (${(bytes / 1e6).toFixed(1)} MB), ${existed} already present`);
}

// ── prove ────────────────────────────────────────────────────────────────────

export async function prove(dir, { bookId, pageId, field }) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const nn = String(bucketOf(bookId)).padStart(2, '0');
  let book = null;
  for await (const b of readLines(path.join(dir, 'books', `${nn}.jsonl.gz`))) if (b.book_id === String(bookId)) { book = b; break; }
  if (!book) return { ok: false, why: `book ${bookId} not in snapshot ${m.id}` };
  const idx = book.rows.findIndex((r) => r[0] === String(pageId) && r[2] === field);
  if (idx < 0) return { ok: false, why: `page ${pageId} ${field} not in snapshot ${m.id}` };
  const leaves = book.rows.map(([pid, pn, f, sha]) => textLeaf({ bookId: book.book_id, pageId: pid, pageNumber: pn, field: f, textSha256: sha }));
  const roots = [];
  for await (const r of readLines(path.join(dir, 'book-roots.jsonl.gz'))) roots.push(r);
  const bi = roots.findIndex((r) => r.book_id === book.book_id);
  const bookLeaves = roots.map((r) => bookLeaf({ bookId: r.book_id, n: r.n, root: r.root }));
  const [pid, pn, f, sha] = book.rows[idx];
  return {
    ok: true, kind: 'sourcelibrary-text-proof', format: 1,
    snapshot: { id: m.id, finished_at: m.finished_at, source: m.source, root: m.root },
    page: { book_id: book.book_id, page_id: pid, page_number: pn, field: f, text_sha256: sha },
    book: { n: book.n, root: book.root, path: merkleProof(leaves, idx) },
    corpus: { path: merkleProof(bookLeaves, bi) },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const cmd = process.argv[2];
  const dir = path.resolve(arg('--dir', ''));
  try {
    if (!arg('--dir')) throw new Error('--dir is required');
    if (cmd === 'build') { fs.mkdirSync(dir, { recursive: true }); await build(dir, arg('--archive', '-'), arg('--source', 'unknown')); }
    else if (cmd === 'stamp') await stamp(dir);
    else if (cmd === 'upgrade') await upgrade(dir);
    else if (cmd === 'upload') await upload(dir);
    else if (cmd === 'prove') {
      const p = await prove(dir, { bookId: arg('--book'), pageId: arg('--page'), field: arg('--field', 'translation') });
      console.log(JSON.stringify(p, null, 1));
      if (!p.ok) process.exit(1);
    } else { console.error('usage: hash-snapshot.mjs build|stamp|upgrade|upload|prove --dir D …'); process.exit(2); }
  } catch (e) { log(`FAILED: ${e.message}`); process.exit(1); }
}
