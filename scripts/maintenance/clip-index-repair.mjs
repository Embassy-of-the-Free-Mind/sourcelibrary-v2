#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/delete-stale-embeddings.mjs — removes clip rows whose BOOK is
 * gone; it cannot see a row that names the wrong existing book, and it never rewrites anything.
 * scripts/backfill-clip-embeddings.mjs — upserts by id and would re-embed ($0 but a CLIP-server
 * round trip per row) rather than rewrite the three metadata columns that are actually wrong.
 * scripts/maintenance/cleanup-orphan-gallery-images.mjs — the same orphan shape one layer down
 * (gallery rows whose PAGE is gone); its gates (list-then-delete, count cap) are copied here.
 *
 * clip-index-repair — make clip_embeddings agree with gallery_images again (#5195).
 *
 * WHO THIS IS FOR: the /identify visitor. `clip_embeddings` is the retrieval index; every
 * `gallery_image` row in it is keyed to a gallery row and carries a denormalised `book_id`,
 * `title`, `author`. After re-mints and merges, 3,711 rows named the wrong book (2026-09-28) and
 * 31,210 named a gallery row that no longer exists. The read side hydrates from the gallery row
 * now (PR #5196), but a wrong book_id still pollutes dedupe and the visibility filter, and any
 * other reader of the index trusts it.
 *
 * TWO LANES, two gates:
 *
 *   1. DRIFT (safe, reversible, on by default with --apply): for every index row whose gallery
 *      row exists with a different book_id, UPDATE book_id/title/author from the truth. One
 *      `sweep_log` row per BOOK touched (sweep `clip-index-repair-2026-09`), so the change is
 *      recorded as rows, not as a new column (scripts/lib/sweep-log.mjs). The expected count is
 *      measured by the same scan the audit uses; a mismatch between expected and updated is
 *      printed as a FINDING, never rounded away.
 *
 *   2. ORPHANS (a batch delete — GATED): the scan classifies them and, with --orphans-out, writes
 *      the full list to a file. Nothing is deleted unless you pass BOTH --apply and
 *      --delete-orphans-from <that file>; each id in the file is re-verified as still an orphan
 *      at run time before the DELETE, and the run refuses above --max-delete (default 40000)
 *      as a guard against a join bug wiping a good index. Per CLAUDE.md Data Protection the
 *      list goes on the issue and waits for Derek's OK first — these are index rows, not books,
 *      and the rule is still the rule. Deleted rows are recoverable by re-running
 *      scripts/backfill-clip-embeddings.mjs ($0 on the Hetzner CLIP server) IF the gallery
 *      row comes back; an orphan by definition has no gallery row to re-embed from.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/clip-index-repair.mjs                         # dry run: counts + samples
 *   node scripts/maintenance/clip-index-repair.mjs --orphans-out orphans.json
 *   node scripts/maintenance/clip-index-repair.mjs --apply                 # rewrite drift rows only
 *   node scripts/maintenance/clip-index-repair.mjs --apply --delete-orphans-from orphans.json
 *
 * Then confirm: node scripts/audit/clip-index-integrity.mjs
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { loadClipRows, loadBookMap, scanGalleryIndex, galleryIdOf } from '../lib/clip-index-scan.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'clip-index-repair-2026-09';
const args = process.argv.slice(2);
const flag = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const APPLY = args.includes('--apply');
const ORPHANS_OUT = flag('--orphans-out', null);
const DELETE_FROM = flag('--delete-orphans-from', null);
const MAX_DELETE = Number(flag('--max-delete', 40000));
const CONCURRENCY = 8;

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const log = (s) => console.error(s);
const mongo = await MongoClient.connect(MONGODB_URI);
const db = mongo.db('bookstore');
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

try {
  log(`${APPLY ? 'APPLY' : 'DRY RUN'} — loading the gallery index…`);
  const galleryRows = await loadClipRows(sb, { sourceType: 'gallery_image', log });
  const scan = await scanGalleryIndex(db, galleryRows, { log });
  const books = await loadBookMap(db);

  // ── Lane 1: drift ────────────────────────────────────────────────────────────
  const expected = scan.drift.length;
  log(`\nDRIFT: ${expected} index rows disagree with their gallery row (expected 3,711 on 2026-09-28).`);
  const byTarget = new Map();
  for (const d of scan.drift) {
    if (!byTarget.has(d.gallery_book)) byTarget.set(d.gallery_book, { from: new Set(), rows: [] });
    const t = byTarget.get(d.gallery_book);
    t.from.add(d.clip_book);
    t.rows.push(d);
  }
  const targetsMissing = [...byTarget.keys()].filter(b => !books.has(String(b)));
  log(`  ${byTarget.size} target books; ${targetsMissing.length} of them have no books row (the gallery row is still the truth — the row becomes a book-gone orphan for delete-stale-embeddings to judge).`);
  for (const d of scan.drift.slice(0, 5)) {
    log(`  e.g. ${d.id}: ${d.clip_book} (${books.get(d.clip_book)?.title ?? 'no books row'}) → ${d.gallery_book} (${books.get(d.gallery_book)?.title ?? 'no books row'})`);
  }

  let updated = 0, failed = 0;
  if (APPLY && expected > 0) {
    const results = await mapLimit(scan.drift, CONCURRENCY, async (d) => {
      const book = books.get(String(d.gallery_book));
      const patch = {
        book_id: d.gallery_book,
        // Same derivation as the backfill: the illustration's own description first, else the book.
        title: d.description || book?.title || d.book_title || null,
        author: book?.author ?? d.book_author ?? null,
      };
      const { error, count } = await sb.from('clip_embeddings').update(patch, { count: 'exact' }).eq('id', d.id).eq('book_id', d.clip_book);
      if (error) { log(`  update failed ${d.id}: ${error.message}`); return 0; }
      return count ?? 0;
    });
    for (const n of results) { if (n === 1) updated++; else failed++; }
    for (const [target, t] of byTarget) {
      await recordSweepAction(db, {
        sweep: SWEEP,
        book_id: String(target),
        action: 'clip-book-id-rewritten',
        detail: { rows: t.rows.length, from_book_ids: [...t.from], row_ids_sample: t.rows.slice(0, 5).map(r => r.id) },
      });
    }
    log(`  updated ${updated} / expected ${expected}${failed ? `, ${failed} did not update (row changed or vanished between scan and write)` : ''}`);
    if (updated !== expected) log(`  FINDING: updated count ≠ expected count — do not round this away; re-run the audit and look at the difference.`);
    log(`  sweep_log: ${byTarget.size} rows under '${SWEEP}'`);
  } else if (expected > 0) {
    log(`  (dry run — pass --apply to rewrite these ${expected} rows and log ${byTarget.size} sweep_log rows)`);
  }

  // ── Lane 2: orphans ──────────────────────────────────────────────────────────
  log(`\nORPHANS: ${scan.orphans.length} index rows have no gallery row: ${JSON.stringify(scan.byClass)}`);
  if (ORPHANS_OUT) {
    fs.writeFileSync(ORPHANS_OUT, JSON.stringify({ measured_at: new Date().toISOString(), by_class: scan.byClass, orphans: scan.orphans }, null, 1));
    log(`  full list → ${ORPHANS_OUT} (${scan.orphans.length} rows). Put the breakdown on the issue and wait for the OK before --delete-orphans-from.`);
  }

  if (DELETE_FROM) {
    const listed = JSON.parse(fs.readFileSync(DELETE_FROM, 'utf8'));
    const ids = (listed.orphans || listed).map(o => (typeof o === 'string' ? o : o.id));
    const stillOrphan = new Set(scan.orphans.map(o => o.id));
    const toDelete = ids.filter(id => stillOrphan.has(id));
    const skipped = ids.length - toDelete.length;
    log(`  delete list: ${ids.length} ids in ${DELETE_FROM}; ${toDelete.length} still orphans now, ${skipped} skipped (a gallery row exists again — not deleted)`);
    if (toDelete.length > MAX_DELETE) {
      log(`  REFUSING: ${toDelete.length} > --max-delete ${MAX_DELETE}. A count this size is more likely a join bug than a cleanup.`);
      process.exitCode = 1;
    } else if (!APPLY) {
      log(`  (dry run — pass --apply with --delete-orphans-from to delete these ${toDelete.length} rows)`);
    } else {
      let deleted = 0;
      for (let i = 0; i < toDelete.length; i += 200) {
        const chunk = toDelete.slice(i, i + 200);
        const { error, count } = await sb.from('clip_embeddings').delete({ count: 'exact' }).in('id', chunk).eq('source_type', 'gallery_image');
        if (error) { log(`  delete failed at ${i}: ${error.message}`); process.exitCode = 1; break; }
        deleted += count ?? 0;
      }
      const deleteSet = new Set(toDelete);
      const byBook = new Map();
      for (const o of scan.orphans) if (deleteSet.has(o.id)) byBook.set(o.book_id || 'unknown', (byBook.get(o.book_id || 'unknown') || 0) + 1);
      for (const [b, n] of byBook) {
        await recordSweepAction(db, { sweep: SWEEP, book_id: String(b), action: 'clip-orphan-rows-deleted', detail: { rows: n, list: DELETE_FROM } });
      }
      log(`  deleted ${deleted} / listed-and-verified ${toDelete.length}; sweep_log: ${byBook.size} rows`);
      if (deleted !== toDelete.length) log(`  FINDING: deleted count ≠ verified count.`);
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run', drift_expected: expected, drift_updated: APPLY ? updated : null, drift_failed: APPLY ? failed : null,
    drift_target_books: byTarget.size, orphans: scan.orphans.length, orphans_by_class: scan.byClass, orphans_out: ORPHANS_OUT,
  }, null, 1));
} catch (e) {
  log(`ERROR clip-index-repair: ${e.message}`);
  process.exitCode = 2;
} finally {
  await mongo.close();
}
