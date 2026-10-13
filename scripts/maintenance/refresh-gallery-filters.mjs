#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/seed-timeline-filters.mjs` — same shape (aggregate, upsert one
 * system_config doc), modelled on it. `gallery_filters` itself was seeded once by
 * `_tmp-seed-gallery-filters.mjs` (#393, never committed) and then froze for 190 days;
 * `scripts/maintenance/build-gallery-subject-index.mjs` writes the separate
 * `gallery_subject_index` doc and does not cover types or the year range.
 *
 * Refresh system_config.gallery_filters — the facet lists behind /gallery and
 * /api/gallery (#5501):
 *   - types:     distinct gallery_images.type
 *   - subjects:  the 50 most frequent raw metadata.subjects strings. Kept for the
 *                API's response shape; the gallery's Subject dropdown now reads the
 *                #4856 vocabulary, not this list.
 *   - yearRange: { minYear, maxYear } of book_year
 * and, in a second doc, system_config.gallery_facet_vocab (#4287) — every type /
 * subject / figure / symbol string on ≥3 images, with counts, read by
 * /api/gallery/facets and the MCP list_image_facets tool.
 * Scoped to images of visible books (book_visible: true) — the same scope every
 * gallery browse applies, so the facets never offer a type or year that only a
 * hidden book has.
 *
 * Read-only apart from the one system_config upsert; safe to re-run at any time.
 * Runs weekly on Hetzner (scripts/workers/crontab.production, Sunday 06:20 UTC).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/refresh-gallery-filters.mjs
 *   … --dry-run   print the doc, write nothing
 */
import { MongoClient } from 'mongodb';

const DRY = process.argv.includes('--dry-run');
const VOCAB_MIN_COUNT = 3;
const VOCAB_MAX_TERMS = 20000;
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db('bookstore');
  const images = db.collection('gallery_images');
  const scope = { book_visible: true };
  const opts = { allowDiskUse: true, maxTimeMS: 300000 };

  console.log('Computing types, subjects, year range...');
  const [typesResult, subjectsResult, yearResult] = await Promise.all([
    images.aggregate([
      { $match: scope },
      { $group: { _id: '$type' } },
      { $match: { _id: { $ne: null } } },
      { $sort: { _id: 1 } },
    ], opts).toArray(),
    images.aggregate([
      { $match: { ...scope, 'metadata.subjects.0': { $exists: true } } },
      { $unwind: '$metadata.subjects' },
      { $group: { _id: '$metadata.subjects', n: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { n: -1, _id: 1 } },
      { $limit: 50 },
    ], opts).toArray(),
    images.aggregate([
      { $match: { ...scope, book_year: { $type: 'number' } } },
      { $group: { _id: null, minYear: { $min: '$book_year' }, maxYear: { $max: '$book_year' } } },
    ], opts).toArray(),
  ]);

  const types = typesResult.map(t => t._id).filter(Boolean);
  const subjects = subjectsResult.map(s => s._id).sort();
  const yearRange = yearResult[0]
    ? { minYear: yearResult[0].minYear, maxYear: yearResult[0].maxYear }
    : { minYear: null, maxYear: null };

  // An empty types list means the query saw no images, not that the gallery is empty.
  // Never overwrite a good doc with it — the readers would render a gallery with no facets.
  if (types.length === 0) {
    console.error('No types found — refusing to overwrite gallery_filters');
    process.exit(1);
  }

  const data = { types, subjects, yearRange };
  if (DRY) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    await db.collection('system_config').updateOne(
      { _id: 'gallery_filters' },
      { $set: { data, updated_at: new Date() } },
      { upsert: true },
    );
    console.log(`Cached ${types.length} types, ${subjects.length} subjects, years ${yearRange.minYear}–${yearRange.maxYear} into gallery_filters`);
  }

  // gallery_facet_vocab (#4287): the exact strings search_images' type/subject/
  // figure/symbol filters match, with image counts, so an MCP agent can learn the
  // vocabulary (list_image_facets) instead of guessing free text that matches
  // nothing. A separate doc so /gallery's page load never pulls it. Computed after
  // gallery_filters is written: a failure here must not cost the facets above.
  try {
    console.log('Computing facet vocabulary...');
    const vocab = {};
    for (const [facet, field] of [['type', 'type'], ['subject', 'metadata.subjects'], ['figure', 'metadata.figures'], ['symbol', 'metadata.symbols']]) {
      const isArray = field !== 'type';
      const [r] = await images.aggregate([
        { $match: isArray ? { ...scope, [`${field}.0`]: { $exists: true } } : scope },
        ...(isArray ? [{ $unwind: `$${field}` }] : []),
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
        { $match: { _id: { $type: 'string', $ne: '' } } },
        { $sort: { n: -1, _id: 1 } },
        {
          $facet: {
            // Singletons are mostly one-off phrasings ("a man holding a sword");
            // terms on ≥VOCAB_MIN_COUNT images are the ones worth filtering on.
            terms: [{ $match: { n: { $gte: VOCAB_MIN_COUNT } } }, { $limit: VOCAB_MAX_TERMS }],
            distinct: [{ $count: 'n' }],
          },
        },
      ], opts).toArray();
      vocab[facet] = {
        terms: (r?.terms ?? []).map((t) => [t._id, t.n]),
        distinct: r?.distinct?.[0]?.n ?? 0,
      };
      console.log(`  ${facet}: ${vocab[facet].terms.length} terms kept of ${vocab[facet].distinct} distinct`);
    }
    if (vocab.type.terms.length === 0) throw new Error('no types — refusing to overwrite gallery_facet_vocab');
    if (DRY) {
      for (const [f, v] of Object.entries(vocab)) console.log(f, JSON.stringify(v.terms.slice(0, 10)));
    } else {
      await db.collection('system_config').updateOne(
        { _id: 'gallery_facet_vocab' },
        { $set: { data: { ...vocab, min_count: VOCAB_MIN_COUNT, scope: 'book illustrations of visible books' }, updated_at: new Date() } },
        { upsert: true },
      );
      console.log('Cached gallery_facet_vocab');
    }
  } catch (e) {
    console.error('Facet vocabulary failed (gallery_filters already written):', e.message);
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
