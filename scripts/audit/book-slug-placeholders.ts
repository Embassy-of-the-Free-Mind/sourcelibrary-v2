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
 * AND SPLIT AGAIN BY WHETHER ANYONE CAN ACT ON IT (#4521)
 * "Broken" and "fixable" are different questions, and firing on the first one
 * broke the alarm. After the #4521 repair, 39 visible books still carried
 * placeholder slugs — 34 of them CJK records with `display_title: null` and an
 * author in Chinese characters. No slug logic can help those; they need an
 * English title first (#4390). But the workflow keeps ONE open issue at a time,
 * so a finding that stays true forever means the next importer to bypass
 * generateBookSlug — the exact regression this detector exists to catch — files
 * nothing at all. A detector that always fires is not a detector.
 *
 * So `classifySlugRepair` (src/lib/book-slug-repair.ts, shared with the repair
 * sweep) splits the hits:
 *
 *   repairable      → the sweep can write a readable slug from today's data.
 *                     THIS is the finding, and the only thing that exits 1.
 *   blocked         → reported with the reason and a count, exits 0. Waiting on
 *                     metadata, tracked in #4390, not actionable here.
 *
 * EXIT CONTRACT (.claude/docs/invariants/measurement-instruments.md)
 *   0  ran; no REPAIRABLE placeholder slug on a visible book (blocked ones may
 *      still be reported — read the output, not just the code)
 *   1  ran, found a repairable placeholder slug on a visible book
 *   2  could not run — no measurement was taken. Never read as clean.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/audit/book-slug-placeholders.ts [--json] [--limit=50]
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { isPlaceholderSlug } from '../../src/lib/slugify';
import { classifySlugRepair, type SlugRepairBlocker } from '../../src/lib/book-slug-repair';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const LIMIT = parseInt(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '50', 10);

interface Row {
  id: string;
  slug: string;
  title: string;
  visible: boolean;
  /** The slug the sweep would write now, or null when it cannot write one. */
  repairTo: string | null;
  /** Why the sweep cannot act, or null when it can. */
  blockedBy: SlugRepairBlocker | null;
  reason: string;
}

/**
 * What a reader should do about each blocker. The detector's job is not just to
 * count — an unactionable finding with no route out is what turns into a
 * permanently-red check nobody reads.
 */
const BLOCKER_ROUTES: Record<SlugRepairBlocker, string> = {
  'needs-english-title':
    'no Latin-script title or author on the record — needs an English display_title first (#4390)',
  'no-gain':
    'the slug already says everything the record says — needs real metadata, not a new slug (#4390)',
  'held-back':
    'held back on editorial grounds — see SLUG_REPAIR_HOLDBACK in src/lib/book-slug-repair.ts',
};

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
      // `author` is projected because it is half the repairability question:
      // a non-Latin title with a Latin-script author IS repairable (#4521).
      { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, visible: 1 } },
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
      const verdict = classifySlugRepair(doc as Parameters<typeof classifySlugRepair>[0]);
      const row: Row = {
        id: (doc.id as string) || '',
        slug,
        title: ((doc.display_title as string) || (doc.title as string) || '').slice(0, 70),
        visible: doc.visible === true,
        repairTo: verdict.slug,
        blockedBy: verdict.blockedBy,
        reason: verdict.reason,
      };
      (row.visible ? visibleHits : hiddenHits).push(row);
    }

    // The finding is the REPAIRABLE subset. Everything else is a report.
    const repairable = visibleHits.filter((r) => r.repairTo !== null);
    const blocked = visibleHits.filter((r) => r.repairTo === null);

    if (JSON_OUT) {
      console.log(JSON.stringify({
        scanned,
        slugged,
        repairable,
        blocked,
        hidden: hiddenHits,
      }, null, 2));
    } else {
      // Print the denominator. "Clean" means nothing until you can see what was
      // actually in scope.
      console.log(`Scanned ${scanned} books, ${slugged} of them with a slug.`);
      console.log(`Placeholder slugs: ${visibleHits.length} visible, ${hiddenHits.length} hidden.`);
      console.log(`  repairable now: ${repairable.length}   blocked on metadata: ${blocked.length}`);

      if (repairable.length) {
        console.log('\nREPAIRABLE — a readable slug can be built from what the record already holds:');
        for (const r of repairable.slice(0, LIMIT)) {
          console.log(`  /book/${r.slug}  →  /book/${r.repairTo}   "${r.title}"  (${r.id})`);
        }
        if (repairable.length > LIMIT) console.log(`  … and ${repairable.length - LIMIT} more`);
        console.log('\nRepair: npx tsx scripts/maintenance/repair-book-slugs.ts   (dry run by default)');
      }

      if (blocked.length) {
        // Reported, not raised. Grouped so the tail reads as one known backlog
        // rather than N mysterious rows — and so a NEW blocker shows up as a
        // new group instead of hiding inside the count.
        const byBlocker = new Map<SlugRepairBlocker, Row[]>();
        for (const r of blocked) {
          const key = r.blockedBy ?? 'needs-english-title';
          const list = byBlocker.get(key) ?? [];
          list.push(r);
          byBlocker.set(key, list);
        }
        console.log(`\nBLOCKED (${blocked.length}) — reported, not a finding. Running the sweep will not move these:`);
        for (const [blocker, rows] of byBlocker) {
          console.log(`\n  ${rows.length} × ${blocker} — ${BLOCKER_ROUTES[blocker]}`);
          for (const r of rows.slice(0, 5)) {
            console.log(`      /book/${r.slug}  ←  "${r.title}"  (${r.id})`);
          }
          if (rows.length > 5) console.log(`      … and ${rows.length - 5} more`);
        }
      }

      if (!repairable.length && blocked.length) {
        console.log('\nNothing to repair today. The remaining URLs are waiting on titles, not on slug logic.');
      }
    }

    // Only repairable findings fire. See the header: a detector that stays red
    // on an unactionable backlog silences the regression it exists to catch.
    return repairable.length > 0 ? 1 : 0;
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
