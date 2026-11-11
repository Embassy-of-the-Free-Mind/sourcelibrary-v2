#!/usr/bin/env node
/**
 * #3894 — apply the READY rows of `scripts/eval/results/byline-proposals-3894.json`
 * (written by `scripts/eval/byline-proposals-3894.mjs`): replace a printer,
 * publisher, editor or translator byline with the author the book's own front
 * matter names.
 *
 * PRIOR ART: scripts/maintenance/apply-aldine-byline-correction-3894.mjs — same
 * three-leg write, but hard-wired to one imprint string and to visible books.
 * This one takes the catalogued value from each proposal (so any dynasty string
 * works), covers hidden books, and links `author_id` only by QID.
 *
 * WHAT IT WRITES, per READY proposal, only when `books.author` STILL equals the
 * catalogued value in the proposal (a book somebody has since corrected is skipped):
 *   - `books.author` → the proposed name.
 *   - `books.author_id` → the thesaurus doc whose `wikidata_id` is the proposal's
 *     QID, when one exists; otherwise UNSET if it pointed at the printer (a byline
 *     of Cicero with `author_id: manuzio-paolo` would put Cicero's book on Paulus's
 *     page). No name or surname fallback — that merged strangers three times in #3894.
 *   - `books.translator` → only when the proposal names one AND the field is empty.
 *   - `books_catalog.author` with `updated_at` (an unbumped synced write is inert).
 *   - one `field_provenance` row per changed field, one `sweep_log` row per book.
 * Then: revalidate each /book/<id> (the route also purges Cloudflare).
 *
 * SAFETY. Dry run by default and the dry run writes NOTHING, backup included.
 * The backup merges on book id and the earliest `before` wins
 * (author-identity.md), so a second --apply cannot lose the original.
 *
 * OTHER PROPOSAL SOURCES (#7660). A proposals file may carry its own top-level
 * `run` and `method` (e.g. the placeholder-author title-text pass of
 * scripts/audit/title-page-attribution.mjs --placeholder-authors): the run names
 * the backup, the sweep_log rows and the provenance; the method is written into
 * each field_provenance row. `current.author` may be null (a book with no byline).
 * The backup and a sweep_log row are written BEFORE each book's write.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/apply-byline-proposals-3894.mjs
 *   node --env-file=.env.production.local scripts/maintenance/apply-byline-proposals-3894.mjs --proposals=<file.json> [--apply]
 *   node --env-file=.env.production.local scripts/maintenance/apply-byline-proposals-3894.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/apply-byline-proposals-3894.mjs --revert [--apply]
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const PROPOSALS = (process.argv.find((a) => a.startsWith('--proposals=')) || '').split('=')[1]
  || join(HERE, '..', 'eval', 'results', 'byline-proposals-3894.json');
const FILE = existsSync(PROPOSALS) ? JSON.parse(readFileSync(PROPOSALS, 'utf8')) : null;
const RUN = FILE?.run || 'byline-proposals-3894';
const METHOD = FILE?.method || 'claude -p reader over the OCR attribution window, deterministic screens, Wikidata, adversarial refuter (#3894)';
const PROV_SOURCE = FILE?.provenance_source || 'byline-reader-refuter-v1';
const BACKUP = join(HERE, 'backups', RUN === 'byline-proposals-3894' ? 'apply-byline-proposals-3894.json' : `apply-byline-proposals-${RUN}.json`);
const same = (a, b) => (a ?? null) === (b ?? null);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function supabaseSet(id, author) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ author, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  // Hidden books are often absent from books_catalog: 0 rows is expected there.
  return { ok: res.ok, status: res.status, rows: Array.isArray(b) ? b.length : 0 };
}
function mergeBackup(rows) {
  const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { run: RUN, entries: [] };
  const byId = new Map(prior.entries.map((e) => [e.book_id, e]));
  for (const r of rows) if (!byId.has(r.book_id)) byId.set(r.book_id, r);
  mkdirSync(dirname(BACKUP), { recursive: true });
  writeFileSync(BACKUP, JSON.stringify({ run: RUN, entries: [...byId.values()] }, null, 1));
}
async function revalidate(id) {
  if (!process.env.CRON_SECRET) return false;
  const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  return !!r?.ok;
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error('no backup'); process.exit(1); }
  const { entries } = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const e of entries) {
    if (!APPLY) continue;
    const set = { author: e.before.author };
    const unset = {};
    for (const k of ['author_id', 'translator']) { if (e.before[k] == null) unset[k] = ''; else set[k] = e.before[k]; }
    if (e.before.author == null) { delete set.author; unset.author = ''; }
    const r = await books.updateOne({ id: e.book_id, author: e.after.author }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}), $pull: { author_link_provenance: { run: RUN } } });
    if (r.modifiedCount) n++;
    await supabaseSet(e.book_id, e.before.author);
  }
  console.log(APPLY ? `reverted ${n} of ${entries.length}` : `would revert ${entries.length} (add --apply)`);
  await mc.close(); process.exit(0);
}

const { proposals } = FILE;
const ready = proposals.filter((p) => p.status === 'READY' && p.proposed?.author);
console.log(`READY proposals: ${ready.length} of ${proposals.length}\n`);

const backupRows = [], skipped = [];
let wrote = 0, sb = 0, reval = 0;
for (const p of ready) {
  const b = await books.findOne({ id: p.book_id }, { projection: { id: 1, author: 1, author_id: 1, translator: 1, title: 1 } });
  if (!b) { skipped.push([p.book_id, 'not found']); continue; }
  if (!same(b.author, p.current.author)) { skipped.push([p.book_id, `byline changed since: ${b.author}`]); continue; }

  const set = { author: p.proposed.author };
  const unset = {};
  if (p.proposed.author_id) set.author_id = p.proposed.author_id;
  else if (b.author_id) unset.author_id = '';
  if (p.proposed.translator && !b.translator) set.translator = p.proposed.translator;

  const before = { author: b.author, author_id: b.author_id ?? null, translator: b.translator ?? null };
  const after = { author: set.author, author_id: set.author_id ?? null, translator: set.translator ?? before.translator };
  console.log(`${APPLY ? 'WRITE' : 'would write'}  ${String(b.author ?? '(none)').slice(0, 28).padEnd(28)} -> ${set.author.slice(0, 30).padEnd(30)} ${after.author_id ? `[${after.author_id}]` : '[unlinked]'}${set.translator ? ` +tr ${set.translator}` : ''}  ${String(b.title).slice(0, 40)}`);
  const row = { book_id: p.book_id, before, after, at: new Date().toISOString() };
  backupRows.push(row);
  if (!APPLY) continue;

  // Backup and sweep_log row BEFORE the write, so an interrupted run is still revertible and explained.
  mergeBackup([row]);
  await recordSweepAction(db, { sweep: RUN, book_id: p.book_id, action: `byline-${p.proposed.catalogued_role}-replaced-with-author`, detail: { before, after, page_number: p.evidence.page ?? null } });
  // An author_id link carries its own assertion record, like every link the canonical backfill writes (#7660).
  const link = set.author_id ? { $push: { author_link_provenance: { run: RUN, method: FILE?.link_method || 'byline-proposal', matched: set.author, authors_slug: set.author_id, confidence: p.confidence || 'high', evidence: p.evidence?.record || p.evidence?.quoted_line || null, at: new Date() } } } : {};
  const r = await books.updateOne({ id: p.book_id, author: b.author ?? null }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), ...link });
  if (r.modifiedCount !== 1) { console.log(`   !! modifiedCount ${r.modifiedCount}`); continue; }
  wrote++;
  const s = await supabaseSet(p.book_id, set.author);
  if (s.ok && s.rows > 0) sb++;
  const evidence = {
    page_number: p.evidence.page ?? null, quoted_line: p.evidence.quoted_line, as_printed: p.evidence.as_printed,
    wikidata: p.evidence.wikidata?.qid ?? null, refuter: p.refuter ?? null, catalogued_role: p.proposed.catalogued_role,
    method: METHOD,
  };
  const now = new Date().toISOString();
  for (const [field, value] of Object.entries({ ...set, ...Object.fromEntries(Object.keys(unset).map((k) => [k, null])) })) {
    await db.collection('field_provenance').insertOne({ book_id: p.book_id, field, value, previous_value: before[field] ?? null, source: PROV_SOURCE, run: RUN, evidence, created_at: now });
  }
  if (await revalidate(p.book_id)) reval++;
}

console.log(`\n-- ${APPLY ? 'applied' : 'dry run (nothing written)'} --`);
console.log(`  books ${APPLY ? 'written' : 'that would be written'}: ${APPLY ? wrote : backupRows.length}`);
if (APPLY) console.log(`  supabase mirrored: ${sb} · revalidated: ${reval}`);
console.log(`  skipped: ${skipped.length}`);
for (const [id, why] of skipped) console.log(`      ${id}  ${why}`);
await mc.close();
