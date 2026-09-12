#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/audit/lambda-drift.mjs` (a counter-vs-reality drift
 * report) is the shape this follows; it audits OCR page counters, not the
 * translation-withhold state, and shares no query. Looked in `scripts/audit/`
 * (`doc-staleness`, `locus-anchor-staleness`, `detect-fabricated-translation`)
 * — none reconciles a stored withhold against the predicate that produced it.
 *
 * Reconciles the WITHHELD STATE against the RULE (#4523).
 *
 * The withhold moves text rather than setting a flag, so there is no boolean to
 * drift — but the two sides can still disagree, in four ways, and each is a
 * different bug:
 *
 *   LEAKED     the predicate holds and the translation is still on the page.
 *              A new apply pass ran and the sweep has not. This is the one that
 *              serves a fabrication to a reader; it must be 0.
 *   ORPHANED   `translation_withheld` is set AND `translation` is set. Two
 *              copies, one of them being served. Should never happen; means a
 *              writer put a translation back without clearing the withhold.
 *   UNBACKED   `translation_withheld` is set but no `page_revisions` snapshot
 *              exists for it. The snapshot is the ONLY copy of the text, so
 *              this is not a bookkeeping gap — that page is unrestorable.
 *   ON-PAGE    `translation_withheld.data` still holds the text. The reader
 *              serialises the whole page document into its RSC flight payload,
 *              so text left on the page ships inside the HTML of every affected
 *              reader page: unrendered, fully scrapeable, and invisible to a
 *              probe that reads the rendered pane. Must be 0.
 *   RESOLVED   `translation_withheld` is set and the page has since been
 *              retranslated — informational, not a fault. The withheld object
 *              can stay as provenance.
 *
 * Also reports the Supabase side: `page_translations` rows for withheld pages
 * that still carry an embedding (and would therefore still be returned by
 * `match_semantic` / `match_pages_in_books`). Skipped when SUPABASE_DB_URL is
 * absent — and SAID, rather than silently passing.
 *
 * Exit 0 = clean, 1 = drift found, 2 = could not measure (UNKNOWN is not PASS).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/withheld-translation-drift.mjs
 *   … --json    machine-readable summary on stdout
 */
import { MongoClient } from 'mongodb';
import {
  STALE_CANDIDATE_FILTER, WITHHOLD_REVISION_SOURCE, staleTranslationReason,
} from '../lib/stale-translation.mjs';

const JSON_OUT = process.argv.includes('--json');
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

let mongo;
try {
  mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
} catch (e) {
  console.error(`UNKNOWN: cannot reach Mongo — ${e.message}`);
  process.exit(2);
}
const db = mongo.db('bookstore');
const pages = db.collection('pages');

const out = { leaked: 0, orphaned: 0, unbacked: 0, onPage: 0, resolved: 0, withheld: 0, byReason: {}, leakedBooks: [], supabase: null };

// ── LEAKED ───────────────────────────────────────────────────────────────────
log('scanning candidates …');
const cursor = pages.find(STALE_CANDIDATE_FILTER, {
  projection: {
    id: 1, book_id: 1, page_number: 1,
    'ocr.pipeline': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1,
    'translation.updated_at': 1, 'translation.edited_at': 1, 'translation.data': 1,
    'translation_withheld.reason': 1,
  },
});
const leakedBooks = new Set();
for await (const p of cursor) {
  const reason = staleTranslationReason(p);
  if (reason) {
    out.leaked++;
    out.byReason[reason] = (out.byReason[reason] || 0) + 1;
    if (leakedBooks.size < 50) leakedBooks.add(p.book_id);
  }
}
out.leakedBooks = [...leakedBooks];

// ── ORPHANED / RESOLVED / withheld total ─────────────────────────────────────
const withheldCursor = pages.find(
  { 'translation_withheld.reason': { $exists: true } },
  {
    projection: {
      id: 1, book_id: 1, 'translation.data': 1, 'translation.updated_at': 1,
      'translation_withheld.reason': 1, 'translation_withheld.withheld_at': 1,
      'translation_withheld.data': 1,
    },
  },
);
const withheldIds = [];
for await (const p of withheldCursor) {
  out.withheld++;
  if (typeof p.translation_withheld?.data === 'string' && p.translation_withheld.data.length) out.onPage++;
  const hasLive = typeof p.translation?.data === 'string' && p.translation.data.length > 0;
  if (hasLive) {
    // A live translation newer than the withhold is the page having been
    // retranslated — the intended exit from this set. One that is NOT newer is
    // a writer having put the old text back without clearing the withhold, and
    // that page is serving the fabrication again.
    const live = p.translation?.updated_at ? new Date(p.translation.updated_at).getTime() : 0;
    const at = p.translation_withheld?.withheld_at ? new Date(p.translation_withheld.withheld_at).getTime() : 0;
    if (live > at) out.resolved++; else out.orphaned++;
  } else if (withheldIds.length < 200000) {
    // Only pages whose text is actually withheld need the Supabase check.
    withheldIds.push(p.id);
  }
}

// ── UNBACKED ─────────────────────────────────────────────────────────────────
// Count snapshots rather than joining 65k ids one by one: if every withheld
// page has one, the counts match. A shortfall names the gap size, and the
// per-page identification is a follow-up query the operator can run.
const snapshots = await db.collection('page_revisions')
  .countDocuments({ field: 'translation', reason: WITHHOLD_REVISION_SOURCE });
out.snapshots = snapshots;
out.unbacked = Math.max(0, out.withheld - snapshots);

// ── Supabase ─────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_DB_URL) {
  out.supabase = { status: 'UNKNOWN', note: 'SUPABASE_DB_URL not set — the embedding side was NOT checked' };
} else if (withheldIds.length) {
  try {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const r = await c.query(
      `select count(*)::int as n from page_translations
        where page_id = any($1::text[]) and embedding is not null and coalesce(translation,'') <> ''`,
      [withheldIds],
    );
    const w = await c.query(
      `select count(*)::int as n from page_translations where withheld_at is not null`,
    ).catch(() => ({ rows: [{ n: null }] }));
    out.supabase = { status: 'OK', reachable_rows: r.rows[0].n, marked_withheld: w.rows[0].n };
    await c.end();
  } catch (e) {
    out.supabase = { status: 'UNKNOWN', note: e.message?.slice(0, 160) };
  }
}

const supabaseUnknown = out.supabase?.status === 'UNKNOWN';
const supabaseLeak = out.supabase?.reachable_rows > 0;
const bad = out.leaked > 0 || out.orphaned > 0 || out.unbacked > 0 || out.onPage > 0 || supabaseLeak;

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('');
  console.log(`LEAKED    ${out.leaked}  (predicate holds, translation still served)  ${JSON.stringify(out.byReason)}`);
  console.log(`ORPHANED  ${out.orphaned}  (withheld AND live translation on the same page)`);
  console.log(`ON-PAGE   ${out.onPage}  (withheld object still carrying the text — it ships in the reader's RSC payload)`);
  console.log(`UNBACKED  ${out.unbacked}  (withheld with no page_revisions snapshot; ${out.withheld} withheld vs ${snapshots} snapshots)`);
  console.log(`SUPABASE  ${JSON.stringify(out.supabase)}`);
  if (out.leakedBooks.length) console.log(`first leaked books: ${out.leakedBooks.slice(0, 10).join(' ')}`);
  console.log('');
  console.log(bad ? 'DRIFT' : supabaseUnknown ? 'MONGO CLEAN, SUPABASE NOT MEASURED' : 'CLEAN');
}

await mongo.close();
process.exit(bad ? 1 : supabaseUnknown ? 2 : 0);
