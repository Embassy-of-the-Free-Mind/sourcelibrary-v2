/**
 * book-slug-placeholders — is any live book published at a placeholder URL?
 *
 * WHY THIS EXISTS (#4389)
 * A book's slug IS its public address. On 2026-08-30 an MCP client found 111
 * visible books sitting at /book/unknown-1 … /book/unknown-111 — shareable,
 * citable, indexable URLs — while every one of them carried a perfectly good
 * title one field over. They had been live since 2026-03-10. Nothing surfaced
 * them because nothing was looking: the slug generator has a fallback, the
 * fallback produced a string that *looks* like a slug, and a string that looks
 * like a slug passes every check downstream.
 *
 * That is the class this detector exists for. A slug fallback reaching
 * production should be a failing check, not a doc.
 *
 * WHAT IT MEASURES
 * Every book, tested with the same `isPlaceholderSlug` the repair sweeps and
 * the import path use — imported, not reimplemented, so the detector cannot
 * drift away from the rule it is watching. Findings are split by reachability:
 *
 *   visible: true   → public URLs. This is the finding.
 *   hidden          → reported for context; a hidden book with a bad slug
 *                     becomes a public one the day it is unhidden.
 *
 * EXIT CONTRACT (.claude/docs/invariants/measurement-instruments.md)
 *   0  ran, clean
 *   1  ran, found placeholder slugs on visible books
 *   2  could not run — no measurement was taken. Never read as clean.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/audit/book-slug-placeholders.ts [--json] [--limit=50]
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { isPlaceholderSlug } from '../../src/lib/slugify';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const LIMIT = parseInt(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '50', 10);

interface Row {
  id: string;
  slug: string;
  title: string;
  visible: boolean;
}

async function main(): Promise<number> {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.error('Missing MONGODB_URI — no measurement taken.');
    return 2;
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'bookstore');

    // Scope: EVERY book with a slug, not just the ones a listing surface shows.
    // A count that excludes the failure reports clean forever (#4146), and a
    // hidden book's slug is one `visible: true` away from being public.
    const cursor = db.collection('books').find(
      {},
      { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, visible: 1 } },
    );

    let scanned = 0;
    let slugged = 0;
    const visibleHits: Row[] = [];
    const hiddenHits: Row[] = [];

    for await (const doc of cursor) {
      scanned += 1;
      const slug = doc.slug as string | undefined;
      // No slug at all is a different (and older) problem — /book/<objectid>
      // still resolves, so it is ugly, not broken. repair-book-slugs.ts owns it.
      if (!slug) continue;
      slugged += 1;
      if (!isPlaceholderSlug(slug)) continue;
      const row: Row = {
        id: (doc.id as string) || '',
        slug,
        title: ((doc.display_title as string) || (doc.title as string) || '').slice(0, 70),
        visible: doc.visible === true,
      };
      (row.visible ? visibleHits : hiddenHits).push(row);
    }

    if (JSON_OUT) {
      console.log(JSON.stringify({ scanned, slugged, visible: visibleHits, hidden: hiddenHits }, null, 2));
    } else {
      // Print the denominator. "Clean" means nothing until you can see what was
      // actually in scope.
      console.log(`Scanned ${scanned} books, ${slugged} of them with a slug.`);
      console.log(`Placeholder slugs: ${visibleHits.length} visible, ${hiddenHits.length} hidden.`);
      if (visibleHits.length) {
        console.log('\nPublic URLs that say nothing about the book:');
        for (const r of visibleHits.slice(0, LIMIT)) {
          console.log(`  /book/${r.slug}  ←  "${r.title}"  (${r.id})`);
        }
        if (visibleHits.length > LIMIT) console.log(`  … and ${visibleHits.length - LIMIT} more`);
        console.log('\nRepair: npx tsx scripts/maintenance/repair-book-slugs.ts   (dry run by default)');
      }
    }

    return visibleHits.length > 0 ? 1 : 0;
  } finally {
    await client.close().catch(() => {});
  }
}

// An uncaught throw is an instrument failure (2), never a finding (1).
main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('book-slug-placeholders could not run:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
