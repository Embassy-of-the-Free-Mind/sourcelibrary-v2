/**
 * repair-book-slugs.ts — give every book a readable slug, without breaking
 * any URL already in the wild.
 *
 * Two classes of broken book URL, one cause each:
 *
 *   1. NO SLUG at all (29 visible books). Reachable only as
 *      /book/<objectid>. Older imports that predate slugs, or a batch that
 *      skipped the step.
 *   2. PLACEHOLDER SLUG (~85 visible books). An import wrote a bare counter,
 *      so they sit at /book/-10, /book/-13. Every one of them has a perfectly
 *      good English `display_title` going unused — "-10" should read
 *      "setsubun-in-the-shimabara-district-issho". See also the
 *      generateBookSlug fix in src/lib/slugify.ts, which stops a non-Latin
 *      title from minting new ones.
 *
 * WHICH OF THOSE THIS SWEEP CAN ACTUALLY FIX is decided by
 * `classifySlugRepair` in src/lib/book-slug-repair.ts — holdbacks, "nothing
 * Latin-script to build from", "the slug already says what the record says".
 * That module is shared with scripts/audit/book-slug-placeholders.ts, the
 * detector that REPORTS this work, so the two cannot drift into disagreeing
 * about what is repairable (#4521). Change the rule there, not here.
 *
 * Renaming a slug changes a public URL, so the old one is pushed onto
 * `slug_aliases` in the SAME update. findBookByIdOrSlug resolves aliases on
 * its miss path and the caller 301s to the canonical slug, so existing links,
 * citations and search-engine results keep working. Books in class 1 have no
 * old slug to preserve — their /book/<objectid> URLs keep resolving by id,
 * as they always have.
 *
 * Every prior slug is also written to a timestamped JSON backup before the
 * first write, so the whole sweep is reversible from disk.
 *
 * The write bumps `updated_at` as well as `slug`. /book/[id] reads the Supabase
 * books_catalog mirror BEFORE Atlas, so that mirror is what decides the
 * rendered canonical, and its incremental sync selects on
 * `{ updated_at: { $gt: lastSync } }`. A slug written without the bump is
 * invisible to it — the page keeps serving the OLD slug as canonical until the
 * weekly --full rebuild. `--resync-catalog` repairs a sweep that already ran
 * without it, by touching only the books named in the newest backup.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/repair-book-slugs.ts            # dry run (default)
 *   npx tsx scripts/maintenance/repair-book-slugs.ts --apply
 *   npx tsx scripts/maintenance/repair-book-slugs.ts --apply --include-hidden
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient, type Db } from 'mongodb';
import { appendSlugSuffix, isPlaceholderSlug } from '@/lib/slugify';
import { classifySlugRepair } from '@/lib/book-slug-repair';

const APPLY = process.argv.includes('--apply');
const INCLUDE_HIDDEN = process.argv.includes('--include-hidden');
// One-off repair for the 2026-08-01 sweep, which wrote slugs before the
// `updated_at` bump above existed. Reads the newest backup and touches only
// those books, so the next incremental catalog sync picks them up.
const RESYNC = process.argv.includes('--resync-catalog');
const OUT_DIR = join(process.cwd(), 'scripts', 'output');

interface BookRow {
  _id: unknown;
  id?: string;
  slug?: string;
  title?: string;
  display_title?: string;
  author?: string;
  visible?: boolean;
  slug_aliases?: string[];
}

/**
 * Reserve a slug against both the database and the slugs minted earlier in
 * this same run. generateUniqueBookSlug only checks the DB, which is correct
 * for a single import but would hand the same slug to two books in a bulk
 * sweep — the four Comte de Gabalis / Tyrocinium duplicates in this batch are
 * exactly that case. `slug_aliases` is checked too: a freed-up old slug must
 * not be reissued to a different book while it still redirects.
 */
async function reserveSlug(db: Db, base: string, taken: Set<string>): Promise<string> {
  const exists = async (candidate: string) => {
    if (taken.has(candidate)) return true;
    const hit = await db.collection('books').findOne(
      { $or: [{ slug: candidate }, { slug_aliases: candidate }] },
      { projection: { _id: 1 } },
    );
    return !!hit;
  };

  let candidate = base;
  let n = 1;
  while (await exists(candidate)) {
    n += 1;
    candidate = appendSlugSuffix(base, n);
  }
  taken.add(candidate);
  return candidate;
}

async function resyncCatalog(db: Db) {
  const backups = readdirSync(OUT_DIR)
    .filter((f) => f.startsWith('book-slugs-backup-') && f.endsWith('.json'))
    .sort();
  if (backups.length === 0) {
    console.error(`No book-slugs-backup-*.json in ${OUT_DIR} — nothing to resync.`);
    return;
  }
  const backupPath = join(OUT_DIR, backups[backups.length - 1]);
  const rows = JSON.parse(readFileSync(backupPath, 'utf8')) as Array<{ id: string; to: string }>;
  console.log(`Resyncing ${rows.length} books from ${backups[backups.length - 1]}`);

  let touched = 0;
  for (const row of rows) {
    const res = await db.collection('books').updateOne(
      // Guard on the slug we wrote: if something changed it since, leave it.
      { id: row.id, slug: row.to },
      { $set: { updated_at: new Date() } },
    );
    touched += res.modifiedCount;
  }
  console.log(`Touched ${touched}/${rows.length}. The books_catalog sync runs at :45 every odd hour.`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  if (RESYNC) {
    await resyncCatalog(db);
    await client.close();
    return;
  }

  const scope = INCLUDE_HIDDEN ? {} : { visible: true };
  const candidates = (await db.collection('books')
    .find(scope)
    .project({ _id: 1, id: 1, slug: 1, title: 1, display_title: 1, author: 1, visible: 1, slug_aliases: 1 })
    .toArray()) as unknown as BookRow[];

  const broken = candidates.filter((b) => isPlaceholderSlug(b.slug));

  console.log(`Scanned ${candidates.length} books${INCLUDE_HIDDEN ? '' : ' (visible only)'}`);
  console.log(`Broken or missing slugs: ${broken.length}`);
  if (broken.length === 0) {
    await client.close();
    return;
  }

  const taken = new Set<string>();
  // `filter` is the exact document selector for the write. Books carry both a
  // string `id` and a Mongo `_id`; prefer `id` (indexed, and what every other
  // writer keys on) and fall back to the raw ObjectId, never a stringified one
  // — a string never matches an ObjectId and the update would silently no-op.
  const plan: Array<{
    id: string; from: string; to: string; title: string; visible: boolean;
    filter: Record<string, unknown>;
  }> = [];

  const skipped: string[] = [];

  for (const book of broken) {
    const title = book.display_title || book.title || '';
    const bookId = book.id || String(book._id);

    // The whole triage — holdbacks, "nothing to build from", "no gain" — lives
    // in src/lib/book-slug-repair.ts, shared with the detector that reports
    // this work. A detector disagreeing with its own repair tool reports work
    // that cannot be done; see the header there (#4521).
    const verdict = classifySlugRepair({ ...book, id: bookId });
    if (!verdict.repairable || !verdict.slug) {
      skipped.push(`${bookId} — ${verdict.reason}: "${title.slice(0, 40)}"`);
      continue;
    }
    const base = verdict.slug;

    const to = await reserveSlug(db, base, taken);
    plan.push({
      id: book.id || String(book._id),
      from: book.slug || '',
      to,
      title: title.slice(0, 60),
      visible: book.visible === true,
      filter: book.id ? { id: book.id } : { _id: book._id },
    });
  }

  console.log(`\nSkipped (left exactly as they are): ${skipped.length}`);
  for (const line of skipped.slice(0, 10)) console.log(`  ${line}`);
  if (skipped.length > 10) console.log(`  ... and ${skipped.length - 10} more`);

  console.log(`\nPlanned renames: ${plan.length}${APPLY ? '' : ' (dry run — nothing written)'}\n`);
  for (const p of plan) {
    console.log(`  ${p.from || '(no slug)'} → ${p.to}`);
    console.log(`      ${p.title}`);
  }

  if (!APPLY) {
    console.log('\nRe-run with --apply to write. Old slugs will be preserved as aliases.');
    await client.close();
    return;
  }

  // Backup BEFORE the first write, so a bad sweep is reversible from disk.
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(OUT_DIR, `book-slugs-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(plan.map(({ filter: _f, ...rest }) => rest), null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  let written = 0;
  for (const p of plan) {
    // `updated_at` matters as much as the slug here. The Supabase
    // books_catalog mirror — which /book/[id] reads BEFORE Atlas, so it is
    // what decides the rendered canonical — syncs incrementally on
    // `{ updated_at: { $gt: lastSync } }` every two hours. A slug written
    // without touching it is invisible to that sync, and the old slug keeps
    // being served as canonical until the weekly --full rebuild.
    const update: Record<string, unknown> = { $set: { slug: p.to, updated_at: new Date() } };
    // Only a real previous slug becomes an alias. A missing slug has no URL
    // to preserve, and a placeholder like "-10" is worth keeping too: it may
    // have been linked, and an alias costs one indexed field.
    if (p.from) update.$addToSet = { slug_aliases: p.from };

    const res = await db.collection('books').updateOne(p.filter, update);
    if (res.matchedCount !== 1) {
      console.error(`  MISS ${p.id} — selector matched ${res.matchedCount} docs, slug NOT written`);
      continue;
    }
    written += 1;
  }

  console.log(`\nDone. ${written} slugs repaired, ${plan.filter((p) => p.from).length} old slugs kept as aliases.`);
  console.log('Next: revalidate the affected book pages so the new URLs render.');
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
