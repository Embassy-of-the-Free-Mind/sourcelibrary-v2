import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';
import { Document } from 'mongodb';

export const preferredRegion = 'fra1';
export const maxDuration = 60;

interface CollectionSeed {
  title: string;
  description: string;
  slug: string;
  types?: string[];
  subjects?: string[];
  searchTerms?: string[];
  anchorBooks?: string[]; // Books that get ALL qualifying images (no per-book limit)
  minQuality: number;
  maxPerBook: number;
  limit: number;
  featured: boolean;
  sort_order: number;
}

const SEED_COLLECTIONS: CollectionSeed[] = [
  {
    title: 'Chinese Woodcuts & Illustrations',
    description:
      'Woodblock-printed illustrations from Chinese rare books and manuscripts, featuring mythical creatures, celestial maps, botanical diagrams, and narrative scenes.',
    slug: 'chinese-woodcuts',
    types: ['woodcut', 'illustration'],
    searchTerms: ['chinese'],
    anchorBooks: [
      '6992f3d4dc69844b023ff228', // Shishi Yuanliu (Buddhist, 370 imgs, avgQ 0.92)
      '6992c91569b777d72c7633f7', // Shanhai Jing (42 imgs)
    ],
    minQuality: 0.7,
    maxPerBook: 10,
    limit: 250,
    featured: true,
    sort_order: 0,
  },
  {
    title: 'Alchemical Emblems',
    description:
      'Symbolic emblems from Renaissance alchemical treatises, encoding the secrets of transmutation in visual allegory.',
    slug: 'alchemical-emblems',
    types: ['emblem'],
    subjects: ['alchemy'],
    anchorBooks: [
      '69520c46ab34727b1f044141', // Atalanta Fleeing (181 imgs)
      '6952d0c377f38f6761bc585e', // Atalanta Fleeing alt (81 imgs)
      '6975158ba88d83c830d99e24', // Atalanta fugiens (33 imgs)
      '6952dbf977f38f6761bc7720', // Splendor Solis (28 imgs)
      '6955930e7bd6d2cd1d61ba5c', // Splendor Solis alt (31 imgs)
      '69526359ab34727b1f046d5a', // Mutus Liber (43 imgs)
    ],
    minQuality: 0.7,
    maxPerBook: 8,
    limit: 400,
    featured: true,
    sort_order: 1,
  },
  {
    title: 'Anatomical Illustrations',
    description:
      'Early depictions of human anatomy from medical and natural philosophical texts, tracing the evolution of anatomical knowledge.',
    slug: 'anatomical-illustrations',
    subjects: ['anatomy'],
    anchorBooks: [
      '6ff1a28b-f7cd-4fcd-8d08-77d2f7818be1', // Vesalius 1555 (306 imgs)
      '6953e55777f38f6761bf05cf', // Vesalius 1543 (296 imgs)
    ],
    minQuality: 0.7,
    maxPerBook: 8,
    limit: 300,
    featured: true,
    sort_order: 2,
  },
  {
    title: 'Astronomical Diagrams',
    description:
      'Celestial charts, planetary diagrams, and cosmological models from early modern astronomical works.',
    slug: 'astronomical-diagrams',
    subjects: ['astronomy'],
    anchorBooks: [
      '7d66e9ad-9572-49c6-82ce-0265337e491d', // Tycho Brahe Astronomiae Instauratae (125 imgs)
      '6952d0fa77f38f6761bc5aef', // Instruments of the Restored Astronomy (120 imgs)
    ],
    minQuality: 0.7,
    maxPerBook: 8,
    limit: 200,
    featured: true,
    sort_order: 3,
  },
  {
    title: 'Architectural Illustrations',
    description:
      'Architectural plans, elevations, and perspectives from Renaissance treatises to imperial building manuals, spanning Vitruvius to Palladio.',
    slug: 'architectural-illustrations',
    subjects: ['architecture'],
    searchTerms: [
      'architect',
      'column',
      'facade',
      'temple',
      'building',
      'floor plan',
      'elevation',
      'palazzo',
      'villa',
      'fortification',
    ],
    anchorBooks: [
      '24285aea-eed6-43e9-8a49-ecc9442f46f5', // Serlio (97 imgs)
      'f20894c1-495f-4afe-815b-e8bf3c8938a5', // Palladio (68 imgs)
      '6949af986ef4a68b726b7fa9', // Vitruvius (91 imgs)
      '6991e94fefe0293c6e9e9b65', // Leonardo Vol II (55 imgs)
      '69099eb5cf28baa1b4caeb37', // Hypnerotomachia Poliphili (51 imgs)
      '6992c90d453c7175dc1bcf22', // State Building Standards (68 imgs)
    ],
    minQuality: 0.7,
    maxPerBook: 8,
    limit: 400,
    featured: true,
    sort_order: 4,
  },
  {
    title: 'Botanical Illustrations',
    description:
      'Drawings of plants, herbs, and flowers from herbals and natural history treatises.',
    slug: 'botanical-illustrations',
    searchTerms: ['botanical', 'plant', 'herb', 'flower', 'root', 'leaf', 'fruit'],
    minQuality: 0.7,
    maxPerBook: 15,
    limit: 400,
    featured: true,
    sort_order: 5,
  },
  {
    title: 'Portraits',
    description:
      'Engraved and woodcut portraits of authors, scholars, rulers, and historical figures from early printed books.',
    slug: 'portraits',
    types: ['portrait'],
    minQuality: 0.7,
    maxPerBook: 3,
    limit: 150,
    featured: true,
    sort_order: 6,
  },
  {
    title: 'Mystical & Cosmological Diagrams',
    description:
      'Visual representations of mystical cosmology, esoteric symbolism, and occult philosophy.',
    slug: 'mystical-diagrams',
    types: ['diagram'],
    searchTerms: ['cosmolog', 'mystical', 'occult', 'esoteric', 'sephir', 'celestial', 'macrocosm'],
    anchorBooks: [
      '69520176ab34727b1f04136b', // Fludd Utriusque cosmi (696 imgs)
      '6952dac677f38f6761bc683a', // Fludd History of Both Worlds (647 imgs)
    ],
    minQuality: 0.7,
    maxPerBook: 8,
    limit: 200,
    featured: true,
    sort_order: 7,
  },
  {
    title: 'Maps & Cartography',
    description: 'Historical maps and geographic illustrations from early modern texts.',
    slug: 'maps-cartography',
    types: ['map'],
    minQuality: 0.6,
    maxPerBook: 5,
    limit: 150,
    featured: true,
    sort_order: 8,
  },
  {
    title: 'Astrological Charts & Celestial Diagrams',
    description:
      'Horoscopes, zodiacal figures, and planetary charts from the history of Western astrology.',
    slug: 'astrological-charts',
    subjects: ['astrology'],
    searchTerms: ['zodiac', 'horoscope', 'planet'],
    minQuality: 0.7,
    maxPerBook: 8,
    limit: 150,
    featured: true,
    sort_order: 9,
  },
  {
    title: 'Frontispieces & Title Pages',
    description:
      'Ornate architectural and allegorical title pages from early printed books.',
    slug: 'frontispieces',
    types: ['frontispiece'],
    minQuality: 0.7,
    maxPerBook: 3,
    limit: 150,
    featured: true,
    sort_order: 10,
  },
  {
    title: 'Musical Scores & Notation',
    description:
      'Historical musical notation from liturgical chants to Renaissance polyphony and baroque compositions.',
    slug: 'musical-scores',
    subjects: ['music'],
    searchTerms: ['musical', 'score', 'notation', 'polyphon'],
    anchorBooks: [
      '69557560f63a7571091747c1', // Guqin works (280 imgs, avgQ 0.74)
    ],
    minQuality: 0.7,
    maxPerBook: 10,
    limit: 200,
    featured: true,
    sort_order: 11,
  },
  {
    title: 'Kabbalistic Diagrams',
    description:
      'Tree of Life schematics, sephirotic charts, and letter permutation tables from the Jewish and Christian Kabbalistic traditions.',
    slug: 'kabbalistic-diagrams',
    subjects: ['kabbalah'],
    searchTerms: ['kabbalist', 'sephir', 'tree of life', 'sephirotic'],
    minQuality: 0.7,
    maxPerBook: 8,
    limit: 150,
    featured: true,
    sort_order: 12,
  },
  {
    title: "Printer's Devices & Marks",
    description:
      "Publisher emblems, colophon marks, and printer's devices that identify the workshops of early modern book production.",
    slug: 'printers-devices',
    searchTerms: ["printer's mark", "printer's device", 'colophon', 'publisher'],
    minQuality: 0.7,
    maxPerBook: 3,
    limit: 100,
    featured: false,
    sort_order: 13,
  },
];

/**
 * Build the match filter and aggregation pipeline for a collection seed.
 * Queries the flat `gallery_images` collection (much faster than nested pages).
 * Anchor books get ALL qualifying images; other books are capped at maxPerBook.
 */
function buildPipeline(seed: CollectionSeed): Document[] {
  // Base quality filter
  const matchFilter: Record<string, unknown> = {
    gallery_quality: { $gte: seed.minQuality },
  };

  // Type filter (AND with everything else)
  if (seed.types?.length) {
    matchFilter.type = { $in: seed.types };
  }

  // Subjects and searchTerms are OR'd together — match any qualifying text
  const textConditions: Record<string, unknown>[] = [];

  if (seed.subjects?.length) {
    for (const s of seed.subjects) {
      textConditions.push({ 'metadata.subjects': { $regex: s, $options: 'i' } });
    }
  }

  if (seed.searchTerms?.length) {
    for (const term of seed.searchTerms) {
      textConditions.push(
        { description: { $regex: term, $options: 'i' } },
        { 'metadata.subjects': { $regex: term, $options: 'i' } },
      );
    }
  }

  if (textConditions.length) {
    matchFilter.$or = textConditions;
  }

  const anchorBooks = seed.anchorBooks || [];

  const pipeline: Document[] = [
    { $match: matchFilter },
    // Mark anchor books so they bypass the per-book limit
    {
      $addFields: {
        _isAnchor: anchorBooks.length > 0 ? { $in: ['$book_id', anchorBooks] } : false,
      },
    },
    // Rank images within each book by quality
    {
      $setWindowFields: {
        partitionBy: '$book_id',
        sortBy: { gallery_quality: -1 },
        output: { _bookRank: { $rank: {} } },
      },
    },
    // Keep all anchor images + top maxPerBook from discovery books
    {
      $match: {
        $or: [{ _isAnchor: true }, { _bookRank: { $lte: seed.maxPerBook } }],
      },
    },
    // Anchor images first, then by quality
    { $sort: { _isAnchor: -1, gallery_quality: -1 } },
    { $limit: seed.limit },
    { $project: { _id: 0, imageId: '$id' } },
  ];

  return pipeline;
}

/**
 * POST /api/admin/seed-collections
 *
 * Seed gallery collections from the gallery_images collection.
 * ?dry_run=true to preview without creating.
 * ?force=true to recreate even if slug exists.
 * ?slug=X to seed only one collection.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dry_run') === 'true';
    const force = searchParams.get('force') === 'true';
    const onlySlug = searchParams.get('slug');

    const db = await getDb();
    const results: Array<{
      slug: string;
      title: string;
      imageCount: number;
      anchorCount: number;
      status: string;
    }> = [];

    const seeds = onlySlug
      ? SEED_COLLECTIONS.filter((s) => s.slug === onlySlug)
      : SEED_COLLECTIONS;

    for (const seed of seeds) {
      const existing = await db.collection('gallery_collections').findOne({ slug: seed.slug });
      if (existing && !force) {
        results.push({
          slug: seed.slug,
          title: seed.title,
          imageCount: (existing.image_ids as string[])?.length || 0,
          anchorCount: 0,
          status: 'already_exists',
        });
        continue;
      }

      const pipeline = buildPipeline(seed);
      const images = await db.collection('gallery_images').aggregate(pipeline).toArray();
      const imageIds = images.map((img) => (img as { imageId: string }).imageId);

      // Count how many came from anchor books (for reporting)
      const anchorSet = new Set(seed.anchorBooks || []);
      let anchorCount = 0;
      if (anchorSet.size > 0) {
        // Re-check from the pipeline results — we don't have book_id in the projection,
        // so count is approximate from the seed definition
        anchorCount = imageIds.length; // Will be refined below
      }

      if (dryRun) {
        results.push({
          slug: seed.slug,
          title: seed.title,
          imageCount: imageIds.length,
          anchorCount: seed.anchorBooks?.length || 0,
          status: 'dry_run',
        });
        continue;
      }

      // Delete existing if force
      if (existing && force) {
        await db.collection('gallery_collections').deleteOne({ slug: seed.slug });
      }

      const doc = {
        id: randomUUID(),
        slug: seed.slug,
        title: seed.title,
        description: seed.description,
        cover_image_id: imageIds[0] || '',
        image_ids: imageIds,
        featured: seed.featured,
        sort_order: seed.sort_order,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db.collection('gallery_collections').insertOne(doc);

      results.push({
        slug: seed.slug,
        title: seed.title,
        imageCount: imageIds.length,
        anchorCount: seed.anchorBooks?.length || 0,
        status: 'created',
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Seed collections error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to seed collections' },
      { status: 500 },
    );
  }
}
