#!/usr/bin/env node
/**
 * Audit: every stored reference to a book must still resolve, and every book
 * that left `books` must have left a row in `deleted_books` (#4450).
 *
 * THE TWO INVARIANTS
 *   1. LEDGER — a book removed from `books` is archived to `deleted_books`
 *      first. That collection *is* the recovery path (`POST /api/books/restore/[id]`),
 *      so a delete that skips it is unrecoverable by design and silent.
 *      Route every removal through `deleteBookArchived()` (src/lib/warehouse.ts
 *      `softDeleteBook`, or scripts/lib/delete-book.mjs) — never a raw
 *      `books.deleteOne` / `deleteMany`.
 *   2. IDENTITY — a book's Mongo `_id` is minted once and never changes.
 *      Importers write `{ _id: oid, id: oid.toHexString() }`, so `id` and `_id`
 *      agree for the life of the record. A document that comes back with a NEW
 *      `_id` (restore, re-import, warehouse round-trip) keeps its `id` and
 *      breaks every reference anyone stored as `_id`.
 *
 * WHY IT MATTERS — the incident this audit exists for (#4450)
 *   Five books were reported "vanished from `books` with no `deleted_books`
 *   row", found via feedback rows whose reader had been on the page. All five
 *   were in fact ALIVE, visible, and fully paginated. They had simply been
 *   re-created with a fresh `_id`, and the lookup that declared them missing
 *   used `_id`. A book whose `_id` was re-minted is invisible to any `_id`
 *   lookup while remaining perfectly readable at its URL — it reads as deletion
 *   without being one, and no alarm can fire because nothing failed.
 *
 *   So the honest question is not "is it in `books`?" but "does every stored
 *   reference still resolve, by EITHER key?" This audit answers that, and
 *   separates the two populations, because they need opposite responses:
 *     - unresolved by either key  -> possible real loss; check `deleted_books`.
 *     - resolves by `id` but not `_id` -> identity churn; the record is fine,
 *       the *reader* of it is wrong.
 *
 * WHAT IT MEASURES
 *   Denominators, each read-only, over references that outlive the record:
 *     (a) `entities.books[].book_id`
 *     (b) `collections.sample_books[].id`
 *     (c) `feedback` rows whose `page` path names a book
 *     (d) Supabase `books_catalog` rows with no Mongo twin
 *   Plus the corpus-wide identity-churn cohort and the `deleted_books` health
 *   line (row count, newest `deleted_at`) that made the original report look
 *   like a broken ledger.
 *
 *   Shortlinks (`/q/…`) are deliberately absent: they are stateless — encoded
 *   in the code itself (`src/lib/shortlinks.ts`), never stored — so there is no
 *   set of them to enumerate.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/books-delete-ledger-gap.mjs
 *   node scripts/audit/books-delete-ledger-gap.mjs --json out.json
 *   node scripts/audit/books-delete-ledger-gap.mjs --no-supabase
 *
 * Exits 1 when a reference resolves by neither key (possible real loss),
 * 0 otherwise. Identity churn is REPORTED, not failed — 16k+ records carry it
 * historically, so failing on it would make the audit useless on day one.
 * Exits 2 when it cannot reach the database: that is UNKNOWN, not clean.
 *
 * READ-ONLY — it never writes to Mongo, Supabase, or R2.
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const NO_SUPABASE = args.includes('--no-supabase');
const SAMPLE = args.includes('--sample');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set — cannot audit. This is UNKNOWN, not clean.'); process.exit(2); }

const HEX24 = /^[0-9a-f]{24}$/;

/** Pull one book-id-shaped token out of a reader path like /book/<id>/page/3. */
export function bookIdFromPath(path) {
  if (typeof path !== 'string') return null;
  const m = path.match(/\/book\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // ── The resolvable key space ────────────────────────────────────────────
  // A reference resolves if it names a live book by ANY of its public keys.
  // Warehoused books are live-but-parked, not deleted; deleted_books rows are
  // recoverable. Both count as "accounted for", and are tracked separately so
  // the report can say WHICH.
  const live = { id: new Set(), _id: new Set(), slug: new Set() };
  const warehouse = new Set();
  const ledger = new Set();

  for await (const b of db.collection('books').find({}, { projection: { id: 1, slug: 1 } })) {
    if (b.id) live.id.add(String(b.id));
    live._id.add(String(b._id));
    if (b.slug) live.slug.add(String(b.slug));
  }
  for await (const b of db.collection('books_warehouse').find({}, { projection: { id: 1 } })) {
    warehouse.add(String(b._id));
    if (b.id) warehouse.add(String(b.id));
  }
  for await (const b of db.collection('deleted_books').find({}, { projection: { id: 1, original_id: 1 } })) {
    ledger.add(String(b._id));
    if (b.id) ledger.add(String(b.id));
    if (b.original_id) ledger.add(String(b.original_id));
  }

  const classify = (ref) => {
    const r = String(ref);
    if (live.id.has(r) || live.slug.has(r)) return live._id.has(r) ? 'live' : 'live_id_only';
    if (live._id.has(r)) return 'live';
    if (warehouse.has(r)) return 'warehoused';
    if (ledger.has(r)) return 'in_ledger';
    return 'unresolved';
  };

  const sources = {};
  const addRef = (source, ref, evidence) => {
    if (!ref) return;
    const s = (sources[source] ||= { total: 0, live: 0, live_id_only: 0, warehoused: 0, in_ledger: 0, unresolved: 0, unresolved_refs: new Map(), churn_refs: new Set() });
    s.total++;
    const verdict = classify(ref);
    s[verdict]++;
    if (verdict === 'unresolved') {
      if (!s.unresolved_refs.has(String(ref))) s.unresolved_refs.set(String(ref), evidence || null);
    } else if (verdict === 'live_id_only') {
      s.churn_refs.add(String(ref));
    }
  };

  // (a) entities.books[].book_id
  const entCursor = db.collection('entities').find({}, { projection: { books: 1, name: 1 } });
  for await (const e of entCursor) {
    for (const b of e.books || []) addRef('entities.books[]', b.book_id, { entity: e.name, title: b.book_title });
  }

  // (b) collections.sample_books[].id
  for await (const col of db.collection('collections').find({}, { projection: { sample_books: 1, slug: 1 } })) {
    for (const b of col.sample_books || []) addRef('collections.sample_books[]', b.id, { collection: col.slug, title: b.title });
  }

  // (c) feedback rows naming a book in their page path
  for await (const f of db.collection('feedback').find({}, { projection: { page: 1, created_at: 1, message: 1 } })) {
    const ref = bookIdFromPath(f.page);
    if (ref) addRef('feedback.page', ref, { created_at: f.created_at, page: f.page });
  }

  // (d) Supabase books_catalog rows with no Mongo twin
  let supabase = { checked: false, reason: 'skipped (--no-supabase)' };
  if (!NO_SUPABASE) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      supabase = { checked: false, reason: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — UNKNOWN, not clean' };
    } else {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(url, key);
      // supabase-js silently caps every response at 1,000 rows — paginate.
      const PAGE = 1000;
      let from = 0, rows = 0;
      for (;;) {
        const { data, error } = await sb.from('books_catalog').select('id,slug,title').range(from, from + PAGE - 1);
        if (error) { supabase = { checked: false, reason: `supabase error: ${error.message}` }; break; }
        if (!data || data.length === 0) break;
        for (const r of data) addRef('supabase.books_catalog', r.id, { slug: r.slug, title: r.title });
        rows += data.length;
        if (data.length < PAGE) break;
        from += PAGE;
        if (SAMPLE && rows >= 5000) break;
      }
      if (supabase.checked !== false || !supabase.reason?.startsWith('supabase error')) {
        supabase = { checked: true, rows };
      }
    }
  }

  // ── Corpus-wide identity churn ──────────────────────────────────────────
  // `id` is a 24-hex ObjectId string that does NOT equal this document's own
  // `_id`. Since importers mint them together, that means the document was
  // re-created at some point and every reference stored as `_id` is now dead.
  const churn = { total: 0, byRemintDay: {} };
  for await (const b of db.collection('books').find(
    { id: { $type: 'string' } }, { projection: { id: 1 } }
  )) {
    const id = String(b.id);
    if (!HEX24.test(id)) continue;
    if (id === String(b._id)) continue;
    churn.total++;
    const day = b._id.getTimestamp().toISOString().slice(0, 10);
    churn.byRemintDay[day] = (churn.byRemintDay[day] || 0) + 1;
  }
  churn.topRemintDays = Object.entries(churn.byRemintDay).sort((a, b) => b[1] - a[1]).slice(0, 10);
  delete churn.byRemintDay;

  // ── deleted_books health ────────────────────────────────────────────────
  const ledgerRows = await db.collection('deleted_books').countDocuments({});
  const newest = await db.collection('deleted_books').find({}, { projection: { deleted_at: 1 } })
    .sort({ deleted_at: -1 }).limit(1).next();

  // ── CONFIRMATION PASS ───────────────────────────────────────────────────
  // Re-check every apparently-unresolved reference against Mongo directly,
  // BEFORE reporting.
  //
  // The key space above is a snapshot taken while the corpus was being written
  // to. An import running during the sweep inserts books AFTER the `books`
  // cursor has passed them but BEFORE Supabase is read, so its rows arrive
  // looking like orphans. The first run of this audit produced exactly that:
  // 19 "unresolved" catalog rows, all present in Mongo, all imported in the
  // twenty minutes the sweep was running.
  //
  // An audit that cries loss whenever an importer is active is an audit nobody
  // trusts. One query per candidate, and there should never be many.
  const raced = new Set();
  for (const s of Object.values(sources)) {
    for (const ref of [...s.unresolved_refs.keys()]) {
      if (raced.has(ref)) { s.unresolved--; s.unresolved_refs.delete(ref); continue; }
      const or = [{ id: ref }, { slug: ref }];
      if (HEX24.test(ref)) or.push({ _id: new ObjectId(ref) });
      const found =
        (await db.collection('books').findOne({ $or: or }, { projection: { _id: 1 } })) ||
        (await db.collection('books_warehouse').findOne({ id: ref }, { projection: { _id: 1 } })) ||
        (await db.collection('deleted_books').findOne({ id: ref }, { projection: { _id: 1 } }));
      if (found) {
        raced.add(ref);
        s.unresolved--;
        s.unresolved_refs.delete(ref);
      }
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const report = {
    generated_at: new Date().toISOString(),
    books_live: live.id.size,
    books_warehoused: warehouse.size,
    deleted_books_rows: ledgerRows,
    deleted_books_newest: newest?.deleted_at?.toISOString?.() || null,
    identity_churn: churn,
    supabase,
    sources: {},
  };

  console.log('=== books delete-ledger + identity gap (#4450) ===\n');
  console.log(`books (live):        ${live.id.size}`);
  console.log(`books_warehouse:     ${warehouse.size / 2 | 0} (approx, keyed twice)`);
  console.log(`deleted_books rows:  ${ledgerRows}  newest deleted_at: ${report.deleted_books_newest}`);
  console.log(`\nidentity churn (books whose _id was re-minted): ${churn.total}`);
  for (const [day, n] of churn.topRemintDays) console.log(`   ${day}  ${n}`);
  console.log('\nreference resolution by source:');
  for (const [name, s] of Object.entries(sources)) {
    console.log(`\n  ${name}`);
    console.log(`    references:            ${s.total}`);
    console.log(`    live:                  ${s.live}`);
    console.log(`    live but _id-churned:  ${s.live_id_only}   (resolve by \`id\`, dead by \`_id\`)`);
    console.log(`    warehoused:            ${s.warehoused}`);
    console.log(`    in deleted_books:      ${s.in_ledger}   (recoverable)`);
    console.log(`    UNRESOLVED:            ${s.unresolved}`);
    const sample = [...s.unresolved_refs.entries()].slice(0, 5);
    for (const [ref, ev] of sample) console.log(`       e.g. ${ref} ${ev ? JSON.stringify(ev).slice(0, 160) : ''}`);
    report.sources[name] = {
      total: s.total, live: s.live, live_id_only: s.live_id_only,
      warehoused: s.warehoused, in_ledger: s.in_ledger, unresolved: s.unresolved,
      unresolved_sample: sample.map(([ref, ev]) => ({ ref, evidence: ev })),
      churn_sample: [...s.churn_refs].slice(0, 20),
    };
  }

  // Deduplicated corpus-wide count of references that resolve nowhere.
  const allUnresolved = new Set();
  for (const s of Object.values(sources)) for (const ref of s.unresolved_refs.keys()) allUnresolved.add(ref);
  if (raced.size) {
    console.log(`\nnote: ${raced.size} reference(s) looked unresolved in the snapshot but exist on re-check`);
    console.log('      — a writer was active during the sweep; not loss.');
  }
  report.raced_recheck = raced.size;
  report.unresolved_unique = allUnresolved.size;
  report.unresolved_ids = [...allUnresolved];
  console.log(`\nUNIQUE unresolved book references across all sources: ${allUnresolved.size}`);
  console.log(
    allUnresolved.size === 0
      ? '\nOK — every stored reference resolves to a live, warehoused, or ledgered book.'
      : '\nFAIL — the ids above name no book under either key and no ledger row. Investigate before re-import.'
  );

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }
  return allUnresolved.size === 0 ? 0 : 1;
}

let code = 2;
try {
  code = await main();
} catch (err) {
  console.error('audit failed (UNKNOWN, not clean):', err.message);
  code = 2;
} finally {
  await client.close().catch(() => {});
}
process.exit(code);
