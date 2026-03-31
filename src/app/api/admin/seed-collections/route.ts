import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';
import { Document } from 'mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

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
  {
    title: "Ficino's Florence",
    description:
      'Decorative initials, portraits, and woodcut ornaments from the printed works of Marsilio Ficino and his circle — the visual culture of Florentine Neoplatonism.',
    slug: 'ficinos-florence',
    anchorBooks: [
      '694b3abfde93d1d4cec196fd', // Opera Omnia (53 imgs, avgQ 0.73)
      '694f397023a1d0c2ad1d8814', // Plato translated by Ficino (50 imgs, avgQ 0.73)
      '694f397b53410e29f94e13ea', // Platonic Theology (25 imgs, avgQ 0.77)
      'adefe2d5-88a7-4595-9885-903a93abee51', // Plato Complete Works (10 imgs)
      '6948856a2f9c70e60597cb30', // De Triplici Vita (7 imgs)
      '695593437bd6d2cd1d61bda2', // Iamblichus De Mysteriis Ficino Ed (3 imgs)
    ],
    searchTerms: ['ficino'],
    minQuality: 0.6,
    maxPerBook: 60,
    limit: 200,
    featured: true,
    sort_order: 14,
  },
  {
    title: 'The Venetian Mystery',
    description:
      "Woodcuts and printer's marks from the great Venetian presses — Aldus Manutius, the De Gregoriis, and their contemporaries who made Venice the printing capital of Renaissance Europe.",
    slug: 'venetian-mystery',
    anchorBooks: [
      '69528f16b184004c526a0c18', // De mulieribus claris Venice 1506 (128 imgs, avgQ 0.81)
      '697a9dec450674d6671c315f', // Has Aldus Manutius printer's mark
    ],
    searchTerms: ['venetian', 'venice', 'aldus'],
    minQuality: 0.5,
    maxPerBook: 60,
    limit: 200,
    featured: true,
    sort_order: 15,
  },
];

/**
 * Strip volume/tome/part markers from a title to get a "base title" for comparison.
 * Books sharing a work_id with the same base title are multi-volume sets (keep all).
 * Books sharing a work_id with different base titles are editions (dedup).
 */
function baseTitle(title: string): string {
  return title
    .replace(/,?\s*(?:Vol(?:ume)?|Tome?|Part|Bd|Band|Livre)\.?\s*[\dIVXLCDM]+/gi, '')
    .replace(/\s*\((?:Vol(?:ume)?|Tome?)\.?\s*[\dIVXLCDM]+\)/gi, '')
    .replace(/\s*[·]\s*卷[^\s)]*/, '') // Chinese juan/volume markers (卷上, 卷下之中, etc.)
    .replace(/\s*\([一二三四五六七八九十百千零]+\)\s*$/, '') // CJK volume numbers in parens
    .replace(/\s*[\dIVXLCDM]+\s*$/, '') // trailing volume numbers
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Deduplicate images by work_id: when multiple editions of the same work
 * contribute images to a collection, keep only the best edition's images.
 * Multi-volume sets (same base title) are preserved — only true editions
 * (different titles/years for the same work) get deduplicated.
 */
async function deduplicateByWorkId(
  db: Awaited<ReturnType<typeof getDb>>,
  imageIds: string[],
): Promise<string[]> {
  if (imageIds.length === 0) return [];

  // Get book_id for each image
  const images = await db.collection('gallery_images')
    .find({ id: { $in: imageIds } }, { projection: { id: 1, book_id: 1, gallery_quality: 1 } })
    .toArray();

  const imageMap = new Map(images.map((img) => [img.id as string, img]));
  const bookIds = [...new Set(images.map((img) => img.book_id as string))];

  // Get work_id and title for each book
  const books = await db.collection('books')
    .find({ id: { $in: bookIds } }, { projection: { id: 1, work_id: 1, title: 1 } })
    .toArray();

  const bookInfo = new Map(books.map((b) => [b.id as string, { workId: b.work_id as string | undefined, title: (b.title || '') as string }]));

  // Group book_ids by work_id
  const workToBooks = new Map<string, string[]>();
  for (const [bookId, info] of bookInfo) {
    if (!info.workId) continue;
    const existing = workToBooks.get(info.workId) || [];
    existing.push(bookId);
    workToBooks.set(info.workId, existing);
  }

  // For works with multiple editions, find the best edition (highest avg quality among candidates)
  const excludedBooks = new Set<string>();
  for (const [, editionBookIds] of workToBooks) {
    if (editionBookIds.length <= 1) continue;

    // Check if these are volumes of a set (same base title) or true editions (different titles)
    const baseTitles = editionBookIds.map((id) => baseTitle(bookInfo.get(id)?.title || ''));
    const uniqueBaseTitles = new Set(baseTitles);
    // If all books share the same base title, they're volumes — skip dedup
    if (uniqueBaseTitles.size === 1) continue;

    // Group by base title — dedup across groups, keep all within each group
    const titleGroups = new Map<string, string[]>();
    for (let i = 0; i < editionBookIds.length; i++) {
      const bt = baseTitles[i];
      const existing = titleGroups.get(bt) || [];
      existing.push(editionBookIds[i]);
      titleGroups.set(bt, existing);
    }

    // Score each title group by best avg quality, keep the winning group
    let bestGroup = '';
    let bestAvg = -1;

    for (const [bt, groupBookIds] of titleGroups) {
      const groupImages = images.filter((img) => groupBookIds.includes(img.book_id as string));
      if (groupImages.length === 0) continue;
      const avg = groupImages.reduce((sum, img) => sum + (img.gallery_quality || 0), 0) / groupImages.length;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestGroup = bt;
      }
    }

    // Exclude all groups except the best
    for (const [bt, groupBookIds] of titleGroups) {
      if (bt !== bestGroup) {
        for (const bookId of groupBookIds) excludedBooks.add(bookId);
      }
    }
  }

  if (excludedBooks.size === 0) return imageIds;

  // Filter out images from excluded editions, preserving original order
  return imageIds.filter((id) => {
    const img = imageMap.get(id);
    return img && !excludedBooks.has(img.book_id as string);
  });
}

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
 * Seed thematic gallery collections — one per book collection.
 * Queries all gallery_images from books in each collection, ordered by quality.
 * Creates non-featured gallery_collections with type: 'thematic'.
 */
async function seedThematicCollections(
  db: Awaited<ReturnType<typeof getDb>>,
  opts: { dryRun: boolean; force: boolean; onlySlug: string | null },
) {
  const filter: Record<string, unknown> = {};
  if (opts.onlySlug) filter.slug = opts.onlySlug;

  const bookCollections = await db.collection('collections').find(filter).sort({ order: 1 }).toArray();

  const results: Array<{ slug: string; title: string; imageCount: number; status: string }> = [];

  for (const bc of bookCollections) {
    const galSlug = `collection-${bc.slug}`;
    const existing = await db.collection('gallery_collections').findOne({ slug: galSlug });

    if (existing && !opts.force) {
      results.push({
        slug: galSlug,
        title: bc.name,
        imageCount: (existing.image_ids as string[])?.length || 0,
        status: 'already_exists',
      });
      continue;
    }

    // Find all book IDs in this collection
    const bookDocs = await db.collection('books')
      .find(
        { collections: bc.slug, visible: true },
        { projection: { id: 1 } },
      )
      .toArray();
    const bookIds = bookDocs.map((b) => b.id);

    if (bookIds.length === 0) {
      results.push({ slug: galSlug, title: bc.name, imageCount: 0, status: 'no_books' });
      continue;
    }

    // Get all gallery images from those books, ordered by quality
    const images = await db.collection('gallery_images')
      .find({
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.7 },
        type: { $nin: ['decorative', 'symbol', 'printer_device', 'printer_mark', 'ornament', 'border'] },
      })
      .sort({ gallery_quality: -1 })
      .limit(500)
      .project({ id: 1 })
      .toArray();

    const rawImageIds = images.map((img) => img.id as string);
    const imageIds = await deduplicateByWorkId(db, rawImageIds);

    if (opts.dryRun) {
      results.push({ slug: galSlug, title: bc.name, imageCount: imageIds.length, status: 'dry_run' });
      continue;
    }

    // Upsert: delete existing if force, then insert
    if (existing && opts.force) {
      await db.collection('gallery_collections').deleteOne({ slug: galSlug });
    }

    const doc = {
      id: randomUUID(),
      slug: galSlug,
      title: bc.name,
      description: `Illustrations from the ${bc.name} collection.`,
      cover_image_id: imageIds[0] || '',
      image_ids: imageIds,
      featured: false,
      sort_order: 100 + (bc.order || 0), // after visual collections
      type: 'thematic' as const,
      book_collection_slug: bc.slug,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('gallery_collections').insertOne(doc);
    results.push({ slug: galSlug, title: bc.name, imageCount: imageIds.length, status: 'created' });
  }

  return results;
}

/**
 * POST /api/admin/seed-collections
 *
 * Seed gallery collections from the gallery_images collection.
 * ?mode=thematic to seed thematic collections (one per book collection).
 * ?dry_run=true to preview without creating.
 * ?force=true to recreate even if slug exists.
 * ?slug=X to seed only one collection.
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dry_run') === 'true';
    const force = searchParams.get('force') === 'true';
    const onlySlug = searchParams.get('slug');
    const mode = searchParams.get('mode');

    const db = await getDb();

    // Thematic mode: seed from book collections
    if (mode === 'thematic') {
      const results = await seedThematicCollections(db, { dryRun, force, onlySlug });
      return NextResponse.json({ mode: 'thematic', results });
    }

    // Default: seed visual collections from SEED_COLLECTIONS
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
      const rawImageIds = images.map((img) => (img as { imageId: string }).imageId);
      const imageIds = await deduplicateByWorkId(db, rawImageIds);

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
        type: 'visual' as const,
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
});
