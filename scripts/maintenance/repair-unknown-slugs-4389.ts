/**
 * repair-unknown-slugs-4389 — move 112 books off /book/unknown-N.
 *
 * WHAT HAPPENED (#4389)
 * On 2026-03-10 an ETCSL import slugged each book from an English-title field
 * that held the literal string "Unknown" for records whose English title had
 * not been resolved. "Unknown" sanitizes to "unknown" — a legal, readable-
 * looking slug — so no fallback branch fired and nothing looked wrong. The
 * importer's own dedupe counter did the rest: one book at /book/unknown and
 * 111 at /book/unknown-1 … /book/unknown-111, all `visible: true`, all with a
 * perfectly good `display_title` sitting one field over.
 *
 * The generator fix is in src/lib/slugify.ts (sentinel titles are treated as
 * absent, and isPlaceholderSlug now recognises the family). The standing check
 * is scripts/audit/book-slug-placeholders.ts. This script repairs the records.
 *
 * SCOPE IS DELIBERATELY NARROW
 * Only `slug` matching ^unknown(-\d+)?$. The wider placeholder classes —
 * /book/-9, /book/216, the `untitled-N` family — are older, have different
 * causes, and mostly cannot be repaired without a display_title first.
 * `repair-book-slugs.ts` owns those; do not widen this one.
 *
 * URLs ARE PUBLIC, SO NOTHING IS DROPPED
 * The old slug is pushed onto `slug_aliases` in the SAME update.
 * findBookByIdOrSlug resolves aliases on its miss path, and /book/[id] now
 * 308s an alias to the canonical slug (added in the same PR), so existing
 * links, citations and indexed results keep working and consolidate onto the
 * new URL.
 *
 * `updated_at` is bumped with the slug. /book/[id] reads the Supabase
 * books_catalog mirror BEFORE Atlas, and that mirror syncs incrementally on
 * `{ updated_at: { $gt: lastSync } }`. A slug written without the bump is
 * invisible to it, and the page keeps serving the OLD slug as canonical until
 * the weekly full rebuild.
 *
 * ORDER MATTERS: run this only AFTER the redirect is deployed. Renaming first
 * turns 112 live URLs into pages that render but never point anywhere new.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/repair-unknown-slugs-4389.ts            # dry run
 *   npx tsx scripts/maintenance/repair-unknown-slugs-4389.ts --apply
 *   npx tsx scripts/maintenance/repair-unknown-slugs-4389.ts --json     # plan as JSON
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient, type Db } from 'mongodb';
import { generateBookSlug, appendSlugSuffix, isPlaceholderSlug } from '../../src/lib/slugify';

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');
const OUT_DIR = join(process.cwd(), 'scripts', 'output');

/** The exact family this script owns. Nothing else is touched. */
const UNKNOWN_SLUG_RE = '^unknown(-\\d+)?$';

interface BookRow {
  _id: unknown;
  id?: string;
  slug?: string;
  title?: string;
  display_title?: string;
  author?: string;
  visible?: boolean;
}

interface PlanRow {
  id: string;
  from: string;
  to: string;
  title: string;
  visible: boolean;
  filter: Record<string, unknown>;
}

/**
 * Claim a slug against the database AND against the slugs minted earlier in
 * this same run — generateUniqueBookSlug only knows about the database, which
 * would hand two books the same slug in a bulk sweep. `slug_aliases` is checked
 * too: a freed-up old slug still redirects and must not be reissued.
 *
 * The candidate ladder matters here. Eleven of these books are "A Balbale to
 * Inana"; their display titles are genuinely identical and only the original
 * `title` carries the ETCSL number that tells them apart. So try the original
 * title before falling back to a bare counter — "a-balbale-to-inana-etcsl-4-08-08"
 * tells a reader something, "a-balbale-to-inana-anonymous-7" does not.
 */
async function reserveSlug(db: Db, candidates: string[], taken: Set<string>): Promise<string> {
  const isFree = async (candidate: string) => {
    if (taken.has(candidate)) return false;
    const hit = await db.collection('books').findOne(
      { $or: [{ slug: candidate }, { slug_aliases: candidate }] },
      { projection: { _id: 1 } },
    );
    return !hit;
  };

  const ladder = candidates.filter((c, i) => c && candidates.indexOf(c) === i);
  for (const candidate of ladder) {
    if (await isFree(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }

  const base = ladder[0];
  let n = 1;
  for (;;) {
    n += 1;
    const candidate = appendSlugSuffix(base, n);
    if (await isFree(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    if (n > 200) throw new Error(`could not find a free slug for "${base}"`);
  }
}

async function main(): Promise<number> {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
    return 2;
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'bookstore');

  try {
    const broken = (await db.collection('books')
      .find({ slug: { $regex: UNKNOWN_SLUG_RE } })
      .project({ _id: 1, id: 1, slug: 1, title: 1, display_title: 1, author: 1, visible: 1 })
      .sort({ created_at: 1 })
      .toArray()) as unknown as BookRow[];

    if (!JSON_OUT) {
      console.log(`Books at /book/unknown[-N]: ${broken.length} (${broken.filter((b) => b.visible === true).length} visible)`);
    }
    if (broken.length === 0) return 0;

    const taken = new Set<string>();
    const plan: PlanRow[] = [];
    const skipped: string[] = [];

    for (const book of broken) {
      const displayTitle = book.display_title || '';
      const title = book.title || '';
      const author = book.author || '';

      // Candidate 1: the generator's own answer (display_title preferred).
      // Candidate 2: built from the original title, which in this corpus carries
      // the ETCSL catalogue number and so disambiguates identical hymn titles.
      const fromDisplay = generateBookSlug(title, author, displayTitle || null);
      const fromTitle = generateBookSlug(title, author, null);

      // If the generator itself can only produce a placeholder, this book has
      // nothing to build a URL from: it needs metadata, not a rename. Moving it
      // from one meaningless URL to another buys nothing and spends the one
      // redirect the old address gets.
      const usable = [fromDisplay, fromTitle].filter((c) => c && !isPlaceholderSlug(c));
      if (usable.length === 0) {
        skipped.push(`${book.id} — nothing to build a slug from: "${(displayTitle || title).slice(0, 50)}"`);
        continue;
      }

      const to = await reserveSlug(db, usable, taken);
      plan.push({
        id: book.id || String(book._id),
        from: book.slug || '',
        to,
        title: (displayTitle || title).slice(0, 70),
        visible: book.visible === true,
        // Books carry both a string `id` and a Mongo `_id`; prefer `id` (indexed,
        // and what every other writer keys on). A stringified ObjectId never
        // matches an ObjectId, and the update would silently no-op.
        //
        // The old slug is part of the selector, which makes the write idempotent
        // and concurrency-safe: if another session already renamed this book,
        // the update matches nothing instead of overwriting their result. A
        // worktree isolates files, never production.
        filter: book.id
          ? { id: book.id, slug: book.slug }
          : { _id: book._id, slug: book.slug },
      });
    }

    if (JSON_OUT) {
      console.log(JSON.stringify(plan.map(({ filter: _f, ...rest }) => rest), null, 2));
    } else {
      if (skipped.length) {
        console.log(`\nSkipped (left exactly as they are): ${skipped.length}`);
        for (const line of skipped) console.log(`  ${line}`);
      }
      console.log(`\nPlanned renames: ${plan.length}${APPLY ? '' : ' (DRY RUN — nothing written)'}\n`);
      for (const p of plan) {
        console.log(`  /book/${p.from}  →  /book/${p.to}`);
        console.log(`      ${p.title}`);
      }
    }

    if (!APPLY) {
      if (!JSON_OUT) {
        console.log('\nRe-run with --apply to write. Old slugs are preserved as aliases.');
        console.log('Do NOT apply before the /book/[id] alias redirect is deployed (#4389).');
      }
      return 0;
    }

    // Backup BEFORE the first write, so a bad sweep is reversible from disk.
    mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(OUT_DIR, `unknown-slugs-backup-${stamp}.json`);
    writeFileSync(backupPath, JSON.stringify(plan.map(({ filter: _f, ...rest }) => rest), null, 2));
    console.log(`\nBackup written: ${backupPath}`);

    let written = 0;
    const misses: string[] = [];
    for (const p of plan) {
      const res = await db.collection('books').updateOne(p.filter, {
        $set: { slug: p.to, updated_at: new Date() },
        $addToSet: { slug_aliases: p.from },
      });
      if (res.matchedCount !== 1) {
        misses.push(`${p.id} — selector matched ${res.matchedCount} docs, slug NOT written`);
        continue;
      }
      written += 1;
    }

    console.log(`\nDone. ${written}/${plan.length} slugs repaired, ${written} old slugs kept as aliases.`);
    for (const m of misses) console.error(`  MISS ${m}`);
    console.log('\nNext:');
    console.log('  1. Purge Cloudflare + revalidate the affected /book paths (.claude/docs/invariants/deploy-and-caching.md).');
    console.log('  2. The Supabase books_catalog sync picks these up on updated_at (:45, every odd hour).');
    console.log('  3. Re-run scripts/audit/book-slug-placeholders.ts — the unknown family should be gone.');
    return misses.length ? 1 : 0;
  } finally {
    await client.close().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
