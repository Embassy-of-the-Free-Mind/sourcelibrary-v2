#!/usr/bin/env node
/**
 * Restore rehearsal: read a dump back as a STREAM and count what is inside it.
 *
 * PRIOR ART: scripts/workers/backup-corpus-text.sh — its rehearsal (restic dump,
 * `gzip -t`, check the mongodump magic) proves the bytes come back, but not that
 * the documents are in them. This counts them, per collection / per table, so a
 * dump that is valid but nearly empty fails here rather than on the day it's needed.
 *
 * Usage:
 *   restic dump <snap> <file> | node verify-dump-stream.mjs mongo-archive [--expect counts.json]
 *   restic dump <snap> <file> | node verify-dump-stream.mjs pg-plain      [--expect counts.json]
 *
 * --expect is a JSON object { name: approxCount } taken just before the dump
 * (estimatedDocumentCount / pg_stat n_live_tup). These are ESTIMATES of a live
 * database, so only gross disagreement fails: a name that is expected non-empty
 * but missing or empty in the dump, or a count under half the estimate.
 *
 * Prints one JSON summary line to stdout. Exit 0 = verified, 1 = failed.
 *
 * mongodump archive layout (mongo-tools, uncompressed):
 *   magic 0x8199e26d (bytes 6d e2 99 81), a header BSON doc, one BSON doc per
 *   collection (metadata), terminator int32 -1; then repeated blocks of
 *   [namespace header BSON {db, collection, EOF, CRC}] [BSON docs…] [-1].
 * pg_dump plain: "-- PostgreSQL database dump" within the first lines (17.x
 *   wraps it in `--` and a `\restrict` token); each table's rows sit between
 *   `COPY <table> (...) FROM stdin;` and a line `\.`, one row per line (embedded
 *   newlines are escaped); "-- PostgreSQL database dump complete" near the end.
 */
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { BSON } from 'bson';

const mode = process.argv[2];
const ei = process.argv.indexOf('--expect');
const expect = ei > -1 ? JSON.parse(readFileSync(process.argv[ei + 1], 'utf8')) : null;

function judge(counts, extra) {
  const problems = [];
  if (expect) {
    for (const [name, est] of Object.entries(expect)) {
      const got = counts[name];
      if (est > 0 && !got) problems.push(`${name}: expected ~${est}, dump has ${got ?? 'nothing'}`);
      else if (est >= 100 && got < est * 0.5) problems.push(`${name}: expected ~${est}, dump has only ${got}`);
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const ok = problems.length === 0 && extra.ok;
  console.log(JSON.stringify({ ok, mode, names: Object.keys(counts).length, total, ...extra, problems, counts }));
  process.exit(ok ? 0 : 1);
}

/** Pull exact byte counts out of an async chunk stream without concatenating it. */
class Reader {
  constructor(stream) { this.it = stream[Symbol.asyncIterator](); this.buf = Buffer.alloc(0); this.bytes = 0; }
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
  async skip(n) {
    while (n > 0) {
      if (!this.buf.length && !(await this.fill(1))) return false;
      const k = Math.min(n, this.buf.length); this.buf = this.buf.subarray(k); n -= k;
    }
    return true;
  }
}

async function mongoArchive() {
  const r = new Reader(process.stdin);
  const magic = await r.take(4);
  if (!magic || magic.toString('hex') !== '6de29981') {
    return judge({}, { ok: false, magic: magic?.toString('hex') ?? 'empty', error: 'not a mongodump archive' });
  }
  const readDoc = async (decode) => {
    const len = await r.take(4);
    if (!len) return { eof: true };
    const n = len.readInt32LE(0);
    if (n === -1) return { term: true };
    if (decode) { const body = await r.take(n - 4); return { doc: BSON.deserialize(Buffer.concat([len, body])) }; }
    await r.skip(n - 4); return { doc: null };
  };
  const header = (await readDoc(true)).doc;
  const counts = {};
  // Prelude: one metadata doc per collection, then the terminator.
  for (;;) {
    const d = await readDoc(true);
    if (d.term) break;
    if (d.eof) return judge(counts, { ok: false, error: 'truncated in prelude' });
    counts[d.doc.collection] = 0;
  }
  const closed = new Set();
  for (;;) {
    const ns = await readDoc(true);
    if (ns.eof) break;
    if (ns.term) continue;
    const coll = ns.doc.collection;
    if (ns.doc.EOF) closed.add(coll);
    for (;;) {
      const d = await readDoc(false);
      if (d.eof) return judge(counts, { ok: false, error: `truncated inside ${coll}`, bytes: r.bytes });
      if (d.term) break;
      counts[coll] = (counts[coll] ?? 0) + 1;
    }
  }
  const unclosed = Object.keys(counts).filter((c) => !closed.has(c));
  judge(counts, {
    ok: unclosed.length === 0, magic: '6de29981', bytes: r.bytes,
    server_version: header?.server_version, unclosed,
  });
}

async function pgPlain() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const counts = {};
  let header = false, complete = false, lines = 0, cur = null, bytes = 0;
  for await (const line of rl) {
    bytes += line.length + 1;
    if (++lines <= 5 && line === '-- PostgreSQL database dump') header = true;
    if (cur) {
      if (line === '\\.') cur = null; else counts[cur]++;
      continue;
    }
    if (line.startsWith('COPY ') && line.endsWith(' FROM stdin;')) {
      cur = line.slice(5, line.indexOf(' (', 5) > -1 ? line.indexOf(' (', 5) : line.indexOf(' ', 5)).replace(/"/g, ''); // match pg_stat names
      counts[cur] = 0;
    }
    if (line === '-- PostgreSQL database dump complete') complete = true;
  }
  judge(counts, { ok: header && complete && !cur, header, complete, bytes });
}

if (mode === 'mongo-archive') await mongoArchive();
else if (mode === 'pg-plain') await pgPlain();
else { console.error('usage: verify-dump-stream.mjs mongo-archive|pg-plain [--expect counts.json]'); process.exit(2); }
