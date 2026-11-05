#!/usr/bin/env node
/**
 * Load, back up and moderate the Trithemian hunt (#8150 slice 3).
 *
 * PRIOR ART: src/lib/hunt-payloads.ts (reads hunt_clues into the colophon) and src/lib/hunt.ts
 * (answer hashing) — this script writes what they read, using the same hash. scripts/maintenance/
 * hash-snapshot.mjs — the R2 upload pattern (append-only PutObject with IfNoneMatch) is copied from
 * it. No other loader for hunt_clues or hunt_solvers exists (git grep hunt_clues).
 *
 * THIS REPO IS PUBLIC. The riddles and their answers never enter it. They live in a private JSON
 * file that this script reads; Mongo keeps the riddle text and only salted hashes of the answers.
 * The private file and a Mongo export go to the private R2 bucket by `backup`.
 *
 *   load    --file <private.json> [--apply]  validate every clue, then upsert (dry run without --apply)
 *   backup  [--source <private.json>]         export hunt_clues + hunt_solvers (and the source file)
 *                                             to R2 sl-corpus-snapshots/private/hunt/<stamp>/
 *   pending                                   list solver names waiting for approval
 *   approve <id> | reject <id>                publish or drop a solver's name
 *
 * Private file shape:
 *   { "chain": "trithemius", "clues": [ { "step": 1, "carrier_book_id": "<books.id>",
 *       "payload": "<riddle, <= 320 bytes>", "answers": ["...", "..."],
 *       "target": { "book_id": "<books.id>", "page_number": 65 } }, ... ] }
 * Clue n's answer is on clue n's target page; the target of clue n is the carrier of clue n+1.
 *
 * Run: node --env-file=.env.production.local scripts/maintenance/hunt-clues.mjs <command> ...
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';

const CLUES = 'hunt_clues';
const SOLVERS = 'hunt_solvers';
const MAX_PAYLOAD_BYTES = 320; // src/lib/provenance.ts MAX_HUNT_PAYLOAD_BYTES
const MAX_COLOPHON_BYTES = 512; // steganographia.ts MAX_MSG_BYTES
const BUCKET = 'sl-corpus-snapshots';
const PREFIX = 'private/hunt';

// Same reduction as src/lib/hunt.ts normalizeAnswer; tests/unit/hunt.test.ts pins the two together.
export function normalizeAnswer(raw) {
  return String(raw)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, '');
}
export function hashAnswer(salt, raw) {
  return crypto.createHash('sha256').update(`${salt}:${normalizeAnswer(raw)}`).digest('hex');
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function citationFor(bookId, page) {
  const key = process.env.SL_INTERNAL_KEY || (fs.existsSync('/root/.sl-internal-key') ? fs.readFileSync('/root/.sl-internal-key', 'utf-8').trim() : '');
  const res = await fetch(`https://sourcelibrary.org/api/books/${bookId}/quote?page=${page}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) throw new Error(`quote API ${res.status} for ${bookId} p${page}`);
  const q = await res.json();
  const c = q.citation || {};
  return { citation: c.footnote || c.inline || null, url: c.url || q.url || null };
}

async function load(db) {
  const file = arg('--file');
  if (!file) throw new Error('--file <private.json> is required');
  const spec = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const chain = spec.chain;
  if (!/^[a-z0-9-]{1,40}$/.test(chain || '')) throw new Error('chain must be a short slug');
  const clues = [...spec.clues].sort((a, b) => a.step - b.step);
  const total = clues.length;
  const problems = [];
  const docs = [];
  for (const [i, c] of clues.entries()) {
    const where = `step ${c.step}`;
    if (c.step !== i + 1) problems.push(`${where}: steps must run 1..${total} without gaps`);
    const bytes = Buffer.byteLength(String(c.payload || '').trim(), 'utf-8');
    if (!bytes || bytes > MAX_PAYLOAD_BYTES) problems.push(`${where}: payload is ${bytes} bytes (max ${MAX_PAYLOAD_BYTES})`);
    const colophon = `Source Library · sourcelibrary.org/book/${c.carrier_book_id} · ${String(c.payload).trim()}`;
    if (Buffer.byteLength(colophon, 'utf-8') > MAX_COLOPHON_BYTES) problems.push(`${where}: colophon over ${MAX_COLOPHON_BYTES} bytes`);
    if (!Array.isArray(c.answers) || !c.answers.length || c.answers.some((a) => !normalizeAnswer(a))) problems.push(`${where}: answers missing or empty after normalising`);
    const carrier = await db.collection('books').findOne(
      { id: c.carrier_book_id },
      { projection: { _id: 0, id: 1, visible: 1, pages_count: 1, tenantId: 1, hidden: 1 } },
    );
    // Carriers stay global: a riddle must not ride inside a partner's reading room.
    if (!carrier || carrier.visible !== true || !(carrier.pages_count > 0) || carrier.hidden === true) problems.push(`${where}: carrier ${c.carrier_book_id} is not a live book`);
    else if (carrier.tenantId) problems.push(`${where}: carrier ${c.carrier_book_id} belongs to tenant ${carrier.tenantId}`);
    const page = await db.collection('pages').findOne(
      { book_id: c.target?.book_id, page_number: c.target?.page_number },
      { projection: { _id: 0, id: 1 } },
    );
    if (!page) problems.push(`${where}: target page ${c.target?.book_id} p${c.target?.page_number} not found`);
    const next = clues[i + 1];
    if (next && next.carrier_book_id !== c.target?.book_id) problems.push(`${where}: target book should carry step ${next.step}`);
    let cite = { citation: null, url: null };
    if (page) {
      try {
        cite = await citationFor(c.target.book_id, c.target.page_number);
      } catch (e) {
        problems.push(`${where}: ${e.message}`);
      }
    }
    const salt = crypto.randomBytes(16).toString('hex');
    docs.push({
      chain,
      step: c.step,
      total,
      carrier_book_id: c.carrier_book_id,
      payload: String(c.payload).trim(),
      answer_salt: salt,
      answer_hashes: [...new Set(c.answers.map((a) => hashAnswer(salt, a)))],
      target: { book_id: c.target.book_id, page_number: c.target.page_number, page_id: page?.id ?? null, ...cite },
      active: true,
    });
    // Counts and sizes only: the riddle and its answers never reach a log.
    console.log(`${where}: payload ${bytes} B, ${c.answers.length} accepted answer(s), carrier ${c.carrier_book_id}, target p${c.target?.page_number}`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  if (!process.argv.includes('--apply')) {
    console.log(`\nDry run: ${docs.length} clues valid. Re-run with --apply to write.`);
    return;
  }
  const col = db.collection(CLUES);
  await col.createIndex({ chain: 1, step: 1 }, { unique: true });
  await col.createIndex({ active: 1, carrier_book_id: 1 });
  const now = new Date();
  for (const d of docs) {
    await col.updateOne({ chain: d.chain, step: d.step }, { $set: { ...d, updated_at: now }, $setOnInsert: { created_at: now } }, { upsert: true });
  }
  // Steps beyond the new chain length stop serving rather than linger as orphans.
  const off = await col.updateMany({ chain, step: { $gt: total }, active: true }, { $set: { active: false, updated_at: now } });
  console.log(`\nWrote ${docs.length} clues for chain ${chain}; deactivated ${off.modifiedCount} beyond step ${total}.`);
  console.log('Readers: the reader, quote and export routes load these within 10 minutes (hunt-payloads.ts cache).');
}

async function backup(db) {
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) throw new Error(`${k} not set`);
  const sdk = await import('@aws-sdk/client-s3');
  const s3 = new sdk.S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const objects = [
    [`${CLUES}.json.gz`, await db.collection(CLUES).find({}).toArray()],
    [`${SOLVERS}.json.gz`, await db.collection(SOLVERS).find({}).toArray()],
  ];
  const source = arg('--source');
  if (source) objects.push([`source-${source.split('/').pop()}.gz`, JSON.parse(fs.readFileSync(source, 'utf-8'))]);
  for (const [name, data] of objects) {
    const body = zlib.gzipSync(JSON.stringify(data, null, 1));
    const key = `${PREFIX}/${stamp}/${name}`;
    await s3.send(new sdk.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, IfNoneMatch: '*' }));
    const back = await s3.send(new sdk.HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (back.ContentLength !== body.length) throw new Error(`${key}: wrote ${body.length} B, R2 holds ${back.ContentLength}`);
    console.log(`r2://${BUCKET}/${key}  ${Array.isArray(data) ? data.length + ' rows, ' : ''}${body.length} B`);
  }
}

async function moderate(db, cmd) {
  const col = db.collection(SOLVERS);
  if (cmd === 'pending') {
    for (const r of await col.find({ name_status: 'pending' }).sort({ finished_at: 1 }).toArray()) {
      console.log(`${r._id}\t${r.finished_at.toISOString()}\t${r.name}`);
    }
    return;
  }
  const id = process.argv[3];
  if (!id) throw new Error(`${cmd} <id>`);
  const set = cmd === 'approve' ? { name_status: 'approved' } : { name: null, name_status: 'rejected' };
  const r = await col.updateOne({ _id: id, name_status: 'pending' }, { $set: { ...set, moderated_at: new Date() } });
  console.log(r.modifiedCount ? `${cmd}d ${id}` : `no pending name for ${id}`);
}

async function main() {
  const cmd = process.argv[2];
  if (!['load', 'backup', 'pending', 'approve', 'reject'].includes(cmd)) {
    console.error('usage: hunt-clues.mjs load --file <private.json> [--apply] | backup [--source f] | pending | approve <id> | reject <id>');
    process.exit(2);
  }
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    if (cmd === 'load') await load(db);
    else if (cmd === 'backup') await backup(db);
    else await moderate(db, cmd);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
