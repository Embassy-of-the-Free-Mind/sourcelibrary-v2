/**
 * Shared helpers for the R2 storage-reclamation passes (issue #3005).
 *
 * All four passes are READ-ONLY measurement here: they LIST the bucket
 * (Size + ETag come back on every ListObjectsV2 Content, so we never HEAD
 * per-object) and write NDJSON manifests + a JSON summary to
 * scripts/output/r2-reclaim/. Deletion is a separate, sign-off-gated step.
 *
 * Env (source .env.production.local): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, MONGODB_URI.
 */
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUCKET = process.env.R2_BUCKET_NAME;

export function makeS3() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function mongo() {
  const c = new MongoClient(process.env.MONGODB_URI, {
    socketTimeoutMS: 300000,
    serverSelectionTimeoutMS: 20000,
  });
  await c.connect();
  return c;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.resolve(HERE, '../../output/r2-reclaim');
export function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  return OUT_DIR;
}
export function outPath(name) {
  ensureOut();
  return path.join(OUT_DIR, name);
}

/**
 * Async generator yielding every object under `prefix` as {key, size, etag}.
 * Streams pages via ContinuationToken — constant memory. Retries transient
 * errors with backoff.
 */
export async function* listPrefix(s3, prefix, { onPage } = {}) {
  let token;
  let pages = 0;
  do {
    let resp;
    for (let attempt = 0; ; attempt++) {
      try {
        resp = await s3.send(
          new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: 1000,
          }),
        );
        break;
      } catch (e) {
        if (attempt >= 6) throw e;
        await sleep(500 * 2 ** attempt);
      }
    }
    for (const o of resp.Contents || []) {
      yield { key: o.Key, size: o.Size, etag: o.ETag };
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    pages++;
    if (onPage) onPage(pages, resp.KeyCount || 0);
  } while (token);
}

/**
 * Wrap listPrefix so it yields per-bookId groups: {bookId, entries[]}.
 * Assumes keys are `<basePrefix><bookId>/<file>` and that R2 returns keys in
 * lexicographic order (so all of one book's keys are contiguous). entries
 * carry {file, key, size, etag}.
 *
 * `prefix` is what we LIST (may include shard chars of the bookId, e.g.
 * `pages/6a`); `opts.basePrefix` is the level at which the bookId starts
 * (e.g. `pages/`) — defaults to `prefix`. bookId is always sliced at basePrefix
 * so shard prefixes don't truncate the id.
 */
export async function* bookGroups(s3, prefix, opts = {}) {
  const base = opts.basePrefix || prefix;
  let curId = null;
  let entries = [];
  for await (const o of listPrefix(s3, prefix, opts)) {
    const rest = o.key.slice(base.length); // "<bookId>/<file>"
    const slash = rest.indexOf('/');
    if (slash < 0) continue; // a bare object directly under prefix — skip
    const bookId = rest.slice(0, slash);
    const file = rest.slice(slash + 1);
    if (bookId !== curId) {
      if (curId !== null) yield { bookId: curId, entries };
      curId = bookId;
      entries = [];
    }
    entries.push({ file, key: o.key, size: o.size, etag: o.etag });
  }
  if (curId !== null) yield { bookId: curId, entries };
}

/**
 * Merge two bookGroups generators (both sorted by bookId, same ordering) and
 * invoke cb(bookId, aEntries, bEntries) once per bookId present in either.
 */
export async function mergeBookGroups(genA, genB, cb) {
  let a = await genA.next();
  let b = await genB.next();
  while (!a.done || !b.done) {
    if (a.done) {
      await cb(b.value.bookId, [], b.value.entries);
      b = await genB.next();
    } else if (b.done) {
      await cb(a.value.bookId, a.value.entries, []);
      a = await genA.next();
    } else if (a.value.bookId === b.value.bookId) {
      await cb(a.value.bookId, a.value.entries, b.value.entries);
      a = await genA.next();
      b = await genB.next();
    } else if (a.value.bookId < b.value.bookId) {
      await cb(a.value.bookId, a.value.entries, []);
      a = await genA.next();
    } else {
      await cb(b.value.bookId, [], b.value.entries);
      b = await genB.next();
    }
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * R2 folders are keyed by the book's STRING `id` (== pages.book_id), NOT the
 * Mongo `_id` — and page `_id`/`id` are themselves stored as strings, differing
 * from each other. So existence must be a string join, never an ObjectId one
 * (the id-vs-_id footgun; getting this wrong falsely flags live books/pages).
 *
 * Returns a Set of every string id that means "this book is accounted for":
 * books.id, String(books._id), and the id fields of deleted_books /
 * failed_imports — so a dir is an orphan only if it's in NONE of them.
 */
export async function loadLiveBookIds(db) {
  const live = new Set();
  const add = (v) => { if (v != null) live.add(String(v)); };
  for await (const b of db.collection('books').find({}, { projection: { id: 1 } })) {
    add(b.id); add(b._id);
  }
  for (const coll of ['deleted_books', 'failed_imports']) {
    try {
      for await (const d of db.collection(coll).find({}, { projection: { id: 1, book_id: 1 } })) {
        add(d.id); add(d._id); add(d.book_id);
      }
    } catch { /* collection may not exist */ }
  }
  return live;
}

export const human = (b) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(2)} ${u[i]}`;
};

/** Buffered NDJSON writer — flushes in chunks to avoid a fd write per row. */
export class NdjsonWriter {
  constructor(file) {
    this.fd = fs.openSync(file, 'w');
    this.buf = [];
    this.count = 0;
  }
  write(obj) {
    this.buf.push(JSON.stringify(obj));
    this.count++;
    if (this.buf.length >= 2000) this.flush();
  }
  flush() {
    if (this.buf.length) {
      fs.writeSync(this.fd, this.buf.join('\n') + '\n');
      this.buf = [];
    }
  }
  close() {
    this.flush();
    fs.closeSync(this.fd);
  }
}
