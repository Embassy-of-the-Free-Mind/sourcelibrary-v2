#!/usr/bin/env node
/**
 * BPH catalogue: re-converge to 2,222.
 *
 * Why this exists
 * ---------------
 * After the 2026-05-12 final convergence pass landed at 2,222
 * (`bph_works.sl_book_id IS NOT NULL`), the public count drifted up to
 * 2,256. Root cause: the `/api/cron/sync-bph-sl-book-ids` cron re-reads
 * all `image_source.provider: 'bph'` books every 6h and PATCHes
 * `sl_book_id` back into `bph_works`. The cron didn't filter on
 * `visible`, so the 34 books that convergence hid (via dedupe-collision
 * and shared-numeric-UBN merges) got re-linked within hours.
 *
 * The cron query is patched in this PR to add `visible: { $ne: false }`.
 * This script handles the data cleanup:
 *
 *   1. For each of the 34 bph_works rows that point at a hidden Mongo book,
 *      NULL out sl_book_id / sl_book_slug.
 *   2. Set `bph_catalog_link: false` on each hidden book — belt-and-suspenders
 *      so the cron also opts out independently of the visible filter.
 *
 * Result: `bph_works.sl_book_id IS NOT NULL` count drops back to 2,222.
 *
 * The 34 books are appended to GitHub issue #1742 for partner review. If
 * the partner wants any restored, clear `bph_catalog_link` and `visible:false`
 * on the Mongo book and the cron will re-link automatically.
 *
 * Usage
 *   set -a; source .env.production.local; set +a
 *   node scripts/bph-reconverge-2222.mjs              # dry-run
 *   node scripts/bph-reconverge-2222.mjs --apply      # do it
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const REPORT_JSON = `.claude/docs/bph-reconverge-2222-${today}.json`;
const REPORT_MD = `.claude/docs/bph-reconverge-2222-${today}.md`;

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchAllLinkedRows() {
  let all = [];
  let from = 0;
  while (true) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bph_works?select=ubn,sl_book_id,sl_book_slug,title,year,author&sl_book_id=not.is.null&order=ubn.asc&limit=1000&offset=${from}`,
      { headers: sbHeaders },
    );
    const rows = await r.json();
    all = all.concat(rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function patchBphWorks(ubn, body) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(ubn)}`,
    { method: 'PATCH', headers: sbHeaders, body: JSON.stringify(body) },
  );
  if (!r.ok) throw new Error(`PATCH ${ubn}: ${r.status} ${await r.text()}`);
}

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');
  const books = db.collection('books');

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('Fetching all bph_works rows with sl_book_id…');
  const rows = await fetchAllLinkedRows();
  console.log(`  ${rows.length} rows`);

  const ids = rows.map(r => r.sl_book_id);
  const docs = await books.find(
    { id: { $in: ids } },
    { projection: { id: 1, title: 1, author: 1, visible: 1, dedupe: 1, bph_catalog_link: 1, pages_count: 1, pages_translated: 1 } },
  ).toArray();
  const byId = new Map(docs.map(d => [d.id, d]));

  const targets = [];
  for (const r of rows) {
    const b = byId.get(r.sl_book_id);
    if (!b) continue;            // missing-mongo not handled by this script
    if (b.visible !== false) continue;  // only act on hidden books
    targets.push({
      ubn: r.ubn,
      sl_book_id: r.sl_book_id,
      catalog_title: r.title,
      catalog_year: r.year,
      catalog_author: r.author,
      mongo_title: b.title,
      pages: b.pages_count || 0,
      translated: b.pages_translated || 0,
      dedupe_reason: b.dedupe?.reason || null,
      dedupe_detail: b.dedupe?.detail || b.dedupe?.note || null,
      already_opted_out: b.bph_catalog_link === false,
    });
  }

  console.log(`\nFound ${targets.length} bph_works rows linked to hidden Mongo books.`);
  console.log(`Projected count after reconverge: ${rows.length - targets.length}`);

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    bph_works_before: rows.length,
    bph_works_projected_after: rows.length - targets.length,
    targets,
    errors: [],
  };

  if (APPLY) {
    console.log('\nApplying…');
    for (const t of targets) {
      try {
        await patchBphWorks(t.ubn, { sl_book_id: null, sl_book_slug: null });
        if (!t.already_opted_out) {
          await books.updateOne(
            { id: t.sl_book_id },
            { $set: { bph_catalog_link: false } },
          );
        }
        console.log(`  unlinked ubn=${t.ubn} ${t.mongo_title?.slice(0, 50)}`);
      } catch (e) {
        summary.errors.push({ ubn: t.ubn, error: e.message });
        console.log(`  FAIL ubn=${t.ubn}: ${e.message}`);
      }
    }
  }

  fs.writeFileSync(REPORT_JSON, JSON.stringify(summary, null, 2));

  // Markdown report for issue #1742 append
  const lines = [];
  lines.push(`# BPH catalogue: 34 stale links unlinked (re-converge to 2,222, ${today})`);
  lines.push('');
  lines.push(`Mode: **${APPLY ? 'APPLY' : 'DRY-RUN'}**`);
  lines.push('');
  lines.push(`## Context`);
  lines.push('');
  lines.push('After the 2026-05-12 convergence pass (#1742) landed at 2,222 catalogued works, the count drifted up to 2,256. The `/api/cron/sync-bph-sl-book-ids` cron re-PATCHed `sl_book_id` for hidden duplicate books within 6h of convergence, since its query didn\'t filter on `visible`.');
  lines.push('');
  lines.push('This pass:');
  lines.push('1. Patches the cron to add `visible: { $ne: false }`.');
  lines.push('2. NULLs `sl_book_id` on the 34 bph_works rows pointing at hidden Mongo books.');
  lines.push('3. Sets `bph_catalog_link: false` on each hidden book (belt-and-suspenders).');
  lines.push('');
  lines.push(`**Before:** ${rows.length} rows • **After:** ${rows.length - targets.length} rows`);
  lines.push('');
  lines.push(`## The 34 books unlinked (partner review)`);
  lines.push('');
  lines.push('Each row\'s Mongo book remains in MongoDB — just hidden and opted out of catalog auto-link. To restore: clear `bph_catalog_link` and `dedupe`, set `visible: true`. The cron will then re-link on its next 6h run.');
  lines.push('');
  lines.push('| UBN | Title | Author | Year | Pages | Dedupe reason | Mongo id |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const t of targets.sort((a, b) => Number(a.ubn) - Number(b.ubn))) {
    const title = (t.mongo_title || t.catalog_title || '').replace(/\|/g, '\\|').slice(0, 60);
    const author = (t.catalog_author || '').replace(/\|/g, '\\|').slice(0, 40);
    lines.push(`| ${t.ubn} | ${title} | ${author} | ${t.catalog_year || ''} | ${t.pages} | ${t.dedupe_reason || ''} | \`${t.sl_book_id}\` |`);
  }
  fs.writeFileSync(REPORT_MD, lines.join('\n'));

  console.log(`\nReports:\n  ${REPORT_JSON}\n  ${REPORT_MD}`);
  if (!APPLY) console.log('\nDry-run only. Re-run with --apply to execute.');

  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
