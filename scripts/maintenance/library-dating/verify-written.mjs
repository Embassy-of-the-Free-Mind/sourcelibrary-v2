#!/usr/bin/env node
/**
 * Read back N random books a dating run wrote (#6721) and assert their SHAPE, not a count:
 *   - every layer is a SourceWorkDateLayer (type, numeric `date`, `date_display`, `date_precision`) with a `basis`
 *     and a string `evidence`; a title_page layer has non-empty evidence
 *   - `source_work_dates_meta` is schema 2 of THIS run: work/edition with year inside [from, to] and a valid basis
 *   - a title_page edition's evidence is a span of that book's exported opening leaves (loose match)
 *   - `published` equals the exported (pre-run) value — the writer must never touch it
 *   - a `sweep_log` row (sweep library-dating, this run) exists for the book
 * Exit 1 on any failure. Read-only.
 *
 * PRIOR ART: none for this field — scripts/audit/field-sprawl.mjs counts columns; this checks the values one run wrote.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/verify-written.mjs \
 *     <all-books.jsonl> <run_id> [--n 20]
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { loose, BASES } from '../../lib/date-works.mjs';

const [ALL, RUN_ID] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('--n', 20);
if (!ALL || !RUN_ID) { console.error('usage: verify-written.mjs <all-books.jsonl> <run_id> [--n 20]'); process.exit(2); }

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const books = await db.collection('books').aggregate([{ $match: { 'source_work_dates_meta.run_id': RUN_ID } }, { $sample: { size: N } },
  { $project: { id: 1, published: 1, source_work_dates: 1, source_work_dates_meta: 1 } }]).toArray();
const want = new Set(books.map((b) => String(b.id || b._id)));
const exported = new Map();
for await (const l of readline.createInterface({ input: fs.createReadStream(ALL) })) { if (!l) continue; const r = JSON.parse(l); if (want.has(r.book_id)) exported.set(r.book_id, r); }

const TYPES = new Set(['composition', 'translation', 'compilation', 'commentary', 'redaction', 'edition', 'abridgement', 'adaptation']);
const PREC = new Set(['exact', 'decade', 'century', 'millennium']);
const fails = []; const rows = [];
for (const b of books) {
  const id = String(b.id || b._id); const m = b.source_work_dates_meta || {}; const L = b.source_work_dates || []; const e = exported.get(id);
  const f = (msg) => fails.push(`${id}: ${msg}`);
  if (!Array.isArray(L) || !L.length) f('no layers');
  for (const l of L) {
    if (!TYPES.has(l.type)) f(`layer type ${l.type}`);
    if (!/^-?\d+$/.test(String(l.date))) f(`layer date ${l.date}`);
    if (typeof l.date_display !== 'string' || !l.date_display) f('layer date_display');
    if (!PREC.has(l.date_precision)) f(`layer precision ${l.date_precision}`);
    if (!BASES.includes(l.basis)) f(`layer basis ${l.basis}`);
    if (typeof l.evidence !== 'string') f('layer evidence not a string');
    if (l.basis === 'title_page' && !l.evidence) f('title_page layer without evidence');
  }
  if (m.schema !== 2 || m.run_id !== RUN_ID) f(`meta schema/run ${m.schema}/${m.run_id}`);
  for (const k of ['work', 'edition']) {
    const d = m[k];
    if (!d || !Number.isInteger(d.year)) { f(`${k} year`); continue; }
    if (!(d.from <= d.year && d.year <= d.to)) f(`${k} year ${d.year} outside [${d.from}, ${d.to}]`);
    if (!BASES.includes(d.basis) || (k === 'work' && d.basis === 'catalogue')) f(`${k} basis ${d.basis}`);
  }
  if (!['high', 'medium', 'low'].includes(m.confidence)) f(`confidence ${m.confidence}`);
  if (!m.model || !m.prompt_version || !(m.dated_at instanceof Date)) f('model/prompt_version/dated_at');
  if (!e) f('not in the export');
  else {
    if (JSON.stringify(b.published ?? null) !== JSON.stringify(e.published ?? null)) f(`published changed: ${JSON.stringify(e.published)} → ${JSON.stringify(b.published)}`);
    if (m.edition?.basis === 'title_page' && !m.edition.from_book && !loose(e.lead).includes(loose(m.edition.evidence))) f('edition evidence not on the leaves');
  }
  const logged = await db.collection('sweep_log').countDocuments({ sweep: 'library-dating', book_id: id, 'detail.run_id': RUN_ID });
  if (!logged) f('no sweep_log row');
  rows.push(`| \`${id}\` | ${JSON.stringify(b.published ?? null)} | ${m.work?.display} (${m.work?.basis}) | ${m.edition?.year} (${m.edition?.basis}${m.edition?.evidence ? `: “${String(m.edition.evidence).slice(0, 40)}”` : ''}) | ${m.confidence} | ${L.map((l) => `${l.type} ${l.date}`).join(', ')} | ${logged} |`);
}
await c.close();
console.log(`| book | published (unchanged) | work | edition | conf | layers | sweep_log rows |\n|---|---|---|---|---|---|---:|\n${rows.join('\n')}`);
console.log(`\n${books.length} books read back; ${fails.length ? `${fails.length} FAILURES:\n${fails.join('\n')}` : 'all shape assertions pass'}`);
process.exit(fails.length ? 1 : 0);
