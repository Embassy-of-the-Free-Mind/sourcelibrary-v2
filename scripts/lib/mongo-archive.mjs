/**
 * mongo-archive.mjs — stream the documents out of a `mongodump --archive` (uncompressed) as an async iterator.
 *
 * PRIOR ART: scripts/workers/lib/verify-dump-stream.mjs — the restore rehearsal parses the same layout, but
 * only to COUNT documents, inline in a CLI that exits; it is the check on every weekly backup, so it is left
 * untouched rather than refactored under it. This module yields the decoded documents, for readers that
 * work from the existing weekly `corpus-text` restic snapshot instead of re-reading Atlas (#8150 slice 10).
 *
 * Layout (mongo-tools): magic 6d e2 99 81, header BSON, one metadata BSON per collection, int32 -1; then
 * repeated [namespace header BSON {db, collection, EOF, CRC}] [BSON docs…] [int32 -1].
 *
 *   restic dump <snap> pages.archive.gz | gunzip | node … (reads process.stdin)
 */
import { BSON } from 'bson';

class Reader {
  constructor(stream) { this.it = (stream[Symbol.asyncIterator] ? stream[Symbol.asyncIterator]() : stream[Symbol.iterator]()); this.buf = Buffer.alloc(0); this.bytes = 0; }
  async fill(n) {
    while (this.buf.length < n) {
      const { value, done } = await this.it.next();
      if (done) return false;
      this.bytes += value.length;
      this.buf = this.buf.length ? Buffer.concat([this.buf, value]) : value;
    }
    return true;
  }
  async take(n) {
    if (!(await this.fill(n))) return null;
    const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return out;
  }
}

/**
 * Yields { collection, doc } for every document. `project(doc)` (optional) runs on each raw document and
 * its return value is yielded instead, so callers can drop the bulky fields early. Throws on a truncated
 * archive or a namespace that never closes — a half-read dump must not yield a confident, partial result.
 */
export async function* readMongoArchive(stream, { collections = null } = {}) {
  const r = new Reader(stream);
  const magic = await r.take(4);
  if (!magic || magic.toString('hex') !== '6de29981') throw new Error(`mongo-archive: bad magic ${magic?.toString('hex') ?? 'empty'} (gzip not removed?)`);
  const readDoc = async () => {
    const len = await r.take(4);
    if (!len) return { eof: true };
    const n = len.readInt32LE(0);
    if (n === -1) return { term: true };
    if (n < 5 || n > 64 * 1024 * 1024) throw new Error(`mongo-archive: implausible document length ${n} at byte ${r.bytes}`);
    const body = await r.take(n - 4);
    if (!body) throw new Error('mongo-archive: truncated document');
    return { raw: Buffer.concat([len, body]) };
  };
  const header = await readDoc();
  if (!header.raw) throw new Error('mongo-archive: no header');
  const declared = new Set();
  for (;;) {
    const d = await readDoc();
    if (d.term) break;
    if (d.eof) throw new Error('mongo-archive: truncated in prelude');
    declared.add(BSON.deserialize(d.raw).collection);
  }
  const closed = new Set();
  for (;;) {
    const ns = await readDoc();
    if (ns.eof) break;
    if (ns.term) continue;
    const nsDoc = BSON.deserialize(ns.raw);
    const coll = nsDoc.collection;
    if (nsDoc.EOF) closed.add(coll);
    const want = !collections || collections.includes(coll);
    for (;;) {
      const d = await readDoc();
      if (d.eof) throw new Error(`mongo-archive: truncated inside ${coll}`);
      if (d.term) break;
      if (want) yield { collection: coll, doc: BSON.deserialize(d.raw) };
    }
  }
  const unclosed = [...declared].filter((c) => !closed.has(c));
  if (unclosed.length) throw new Error(`mongo-archive: namespaces never closed: ${unclosed.join(', ')}`);
}

/** Build a minimal archive (for tests): one collection, the given documents. */
export function buildMongoArchive(db, collection, docs) {
  const int = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
  const parts = [Buffer.from('6de29981', 'hex'), BSON.serialize({ concurrent_collections: 1, version: '0.1' }),
    BSON.serialize({ db, collection, metadata: '', size: 0, type: 'collection' }), int(-1),
    BSON.serialize({ db, collection, EOF: false, CRC: BSON.Long.fromNumber(0) }), ...docs.map((d) => BSON.serialize(d)), int(-1),
    BSON.serialize({ db, collection, EOF: true, CRC: BSON.Long.fromNumber(0) }), int(-1)];
  return Buffer.concat(parts);
}
