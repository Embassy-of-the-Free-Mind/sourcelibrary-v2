#!/usr/bin/env node
/**
 * How many artwork records present an AI description of the picture as if it
 * were a published title? (#4288 item 1)
 *
 * READ-ONLY BY DEFAULT, and read-only is the whole answer for the descriptive
 * bucket: `scripts/artwork-enrichment.mjs` already stamps
 * `field_provenance.display_title = { source: 'ai_enrichment', … }` on every
 * row it rewrites, so the data needed to tell a catalogued title from an
 * invented one is already on disk. Nothing in `src/` had ever read it — the fix
 * is a read-side resolver (`src/lib/title-provenance.ts`), not a migration.
 *
 * So this script measures rather than repairs. It reports four buckets:
 *
 *   descriptive  display_title differs from title AND carries an ai_enrichment
 *                stamp — a vision model wrote it by looking at the image.
 *                THE ISSUE'S POPULATION.
 *   derived      display_title differs from title with NO provenance stamp.
 *                Almost all of these are scripts/clean-artwork-metadata.mjs
 *                stripping catalogue apparatus, which recorded nothing until
 *                #4288 added the stamp. Truthful but unprovable from the row.
 *   attributed   display_title differs and a stamp names a real catalogue.
 *   mirrored     display_title equals title — the importers set both.
 *
 * `--stamp-derived` is the one write this script can perform: it stamps the
 * `derived` bucket as `catalog_cleanup` so future reads stop treating a
 * deterministic shortening as unverified. It is OFF by default, prints a full
 * diff first, refuses to run without --yes, and records every touched book as a
 * ROW in `sweep_log` (never a new column — see
 * .claude/docs/invariants/field-sprawl.md). Do not run it without a human
 * approving the sample: the bucket is defined by the ABSENCE of a stamp, so it
 * can in principle contain rows some other writer produced, and a wrong stamp
 * here would silently authorise a fabricated title as a citable one.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/artwork-title-provenance.mjs
 *   node --env-file=.env.production.local scripts/audit/artwork-title-provenance.mjs --samples 40
 *   node --env-file=.env.production.local scripts/audit/artwork-title-provenance.mjs --stamp-derived          # dry run
 *   node --env-file=.env.production.local scripts/audit/artwork-title-provenance.mjs --stamp-derived --yes    # writes
 *
 * Exit 1 when the descriptive bucket is public and unmarked in a way the
 * resolver cannot classify, so this can run as a standing detector.
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'artwork-title-provenance-2026-08';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
// Mongo's .limit(0) means UNLIMITED, so `--samples 0` would print all 12,245
// rows instead of none. Clamp, and treat 0 as "skip the sample sections".
const SAMPLES = Math.max(0, Number(valueOf('--samples', '15')) || 0);
const STAMP_DERIVED = has('--stamp-derived');
const CONFIRMED = has('--yes');

/** Artwork records live in `books`; an explicit content_type of book/text wins. */
const ARTWORK = {
  $and: [
    { $or: [{ resource_type: { $exists: true } }, { content_type: 'artwork' }] },
    { content_type: { $nin: ['book', 'text'] } },
  ],
};
const FP = 'field_provenance.display_title';
/** display_title is a non-empty string that is not a copy of title. */
const REWRITTEN = {
  $expr: {
    $and: [
      { $eq: [{ $type: '$display_title' }, 'string'] },
      { $ne: ['$display_title', ''] },
      { $ne: ['$display_title', { $ifNull: ['$title', null] }] },
    ],
  },
};

const BUCKETS = {
  descriptive: { ...ARTWORK, ...REWRITTEN, [`${FP}.source`]: 'ai_enrichment' },
  derived: { ...ARTWORK, ...REWRITTEN, [FP]: { $exists: false } },
  attributed: { ...ARTWORK, ...REWRITTEN, [FP]: { $exists: true }, [`${FP}.source`]: { $ne: 'ai_enrichment' } },
  mirrored: {
    ...ARTWORK,
    $expr: {
      $and: [
        { $eq: [{ $type: '$display_title' }, 'string'] },
        { $eq: ['$display_title', { $ifNull: ['$title', null] }] },
      ],
    },
  },
};

function pad(s, n) {
  return String(s).padEnd(n);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Run with --env-file=.env.production.local');
    process.exit(2);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  try {
    const totalArtwork = await books.countDocuments(ARTWORK);
    const visibleArtwork = await books.countDocuments({ ...ARTWORK, visible: true });

    console.log('=== Artwork title provenance (#4288 item 1) ===\n');
    console.log(`artwork records: ${totalArtwork}  (public: ${visibleArtwork})\n`);
    console.log(`${pad('bucket', 14)}${pad('total', 10)}${pad('public', 10)}what the displayed title IS`);
    console.log('-'.repeat(96));

    const counts = {};
    const descriptions = {
      descriptive: 'AI wrote it from the image — NOT a published title',
      derived: 'mechanically shortened from the source title, unstamped',
      attributed: 'a source catalogue supplied it',
      mirrored: 'the source record\'s own title (importers set both fields)',
    };
    for (const [name, filter] of Object.entries(BUCKETS)) {
      const total = await books.countDocuments(filter);
      const visible = await books.countDocuments({ ...filter, visible: true });
      counts[name] = { total, visible };
      console.log(`${pad(name, 14)}${pad(total, 10)}${pad(visible, 10)}${descriptions[name]}`);
    }

    const classified = Object.values(counts).reduce((a, b) => a + b.total, 0);
    console.log('-'.repeat(96));
    console.log(`${pad('classified', 14)}${pad(classified, 10)}${pad('', 10)}(${totalArtwork - classified} records carry no display_title at all)\n`);

    // Which writer produced the descriptive bucket, and with which model.
    const byWriter = await books.aggregate([
      { $match: BUCKETS.descriptive },
      { $group: { _id: { script: `$${FP}.script`, model: `$${FP}.model` }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]).toArray();
    console.log('descriptive bucket, by writer:');
    for (const w of byWriter) {
      console.log(`  ${pad(w._id.script || '(unrecorded)', 32)}${pad(w._id.model || '(unrecorded)', 32)}${w.n}`);
    }

    if (SAMPLES > 0) {
      console.log(`\n--- descriptive samples (public, ${SAMPLES}) ---`);
      const samples = await books.find({ ...BUCKETS.descriptive, visible: true })
        .project({ _id: 0, slug: 1, title: 1, display_title: 1, author: 1, year: 1 })
        .limit(SAMPLES).toArray();
      for (const b of samples) {
        console.log(`  /artwork/${b.slug}`);
        console.log(`      shown : "${b.display_title}"   ← AI, from the image`);
        console.log(`      record: "${b.title}"  · ${b.author || '(no author)'} · ${b.year ?? '(no year)'}`);
      }

      console.log(`\n--- derived samples (public, ${SAMPLES}) ---`);
      const derivedSamples = await books.find({ ...BUCKETS.derived, visible: true })
        .project({ _id: 0, slug: 1, title: 1, display_title: 1 })
        .limit(SAMPLES).toArray();
      for (const b of derivedSamples) {
        console.log(`  /artwork/${b.slug}`);
        console.log(`      shown : "${(b.display_title || '').replace(/\s+/g, ' ').trim()}"`);
        console.log(`      record: "${(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 130)}"`);
      }
    }

    // A descriptive title that reached a bibliographic authority match is the
    // sharpest form of the bug: an invented English title was fed to the USTC
    // matcher, which then bound the record to a printed edition.
    const ustcContaminated = await books.countDocuments({ ...BUCKETS.descriptive, ustc_id: { $exists: true } });
    if (ustcContaminated > 0) {
      console.log(`\n! ${ustcContaminated} descriptive-title artworks also carry a ustc_id.`);
      console.log('  scripts/catalog-coverage/backfill-ustc-matches.mjs matched on the AI title, so');
      console.log('  those bindings rest on a work that was never published. Out of scope for');
      console.log('  #4288 item 1 — file separately before trusting any artwork USTC id.');
    }

    if (STAMP_DERIVED) {
      console.log(`\n=== --stamp-derived: ${CONFIRMED ? 'APPLYING' : 'DRY RUN'} ===`);
      console.log(`Would stamp ${counts.derived.total} records with`);
      console.log("  field_provenance.display_title = { source: 'catalog_cleanup', script: 'artwork-title-provenance.mjs' }");
      console.log('and record one sweep_log row per record.\n');
      if (!CONFIRMED) {
        console.log('DRY RUN — nothing written. Review the derived samples above with a human,');
        console.log('then re-run with --yes to apply. This is a WRITE to production.');
      } else {
        let applied = 0;
        const cursor = books.find(BUCKETS.derived).project({ _id: 1, id: 1, title: 1, display_title: 1 });
        for await (const b of cursor) {
          await books.updateOne({ _id: b._id }, {
            $set: {
              [FP]: {
                source: 'catalog_cleanup',
                script: 'artwork-title-provenance.mjs',
                date: new Date().toISOString(),
                note: '#4288 — display_title was shortened from title by an unstamped cleanup run',
              },
            },
          });
          await recordSweepAction(db, {
            sweep: SWEEP,
            book_id: String(b.id || b._id),
            action: 'stamped-display-title-provenance',
            detail: { source: 'catalog_cleanup', title: b.title, display_title: b.display_title },
          });
          applied++;
          if (applied % 200 === 0) console.log(`  ${applied}…`);
        }
        console.log(`Stamped ${applied} records; ${applied} sweep_log rows written under sweep '${SWEEP}'.`);
      }
    }

    // Standing-detector exit code: a public descriptive title is only safe
    // while the resolver can see the stamp that makes it classifiable.
    const unclassifiable = await books.countDocuments({
      ...ARTWORK,
      ...REWRITTEN,
      visible: true,
      [FP]: { $exists: true },
      [`${FP}.source`]: { $exists: false },
    });
    if (unclassifiable > 0) {
      console.log(`\nFAIL: ${unclassifiable} public artwork records carry a display_title provenance`);
      console.log('stamp with no `source` key. src/lib/title-provenance.ts cannot classify those,');
      console.log('so they land in `derived` — shown WITHOUT the AI marker. If any of them is');
      console.log('actually a model\'s description of the image, it is presented as a title again.');
      console.log('Find the writer and make it record a `source`.');
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
