import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';

export const preferredRegion = 'fra1';
export const maxDuration = 60;

interface CollectionSeed {
  title: string;
  description: string;
  slug: string;
  types?: string[];
  subjects?: string[];
  figures?: string[];
  searchTerms?: string[];
  minQuality: number;
  maxPerBook: number;
  limit: number;
  featured: boolean;
  sort_order: number;
}

const SEED_COLLECTIONS: CollectionSeed[] = [
  {
    title: 'Alchemical Emblems',
    description: 'Symbolic emblems from Renaissance alchemical treatises, encoding the secrets of transmutation in visual allegory.',
    slug: 'alchemical-emblems',
    types: ['emblem'],
    subjects: ['alchemy'],
    minQuality: 0.7,
    maxPerBook: 5,
    limit: 50,
    featured: true,
    sort_order: 1,
  },
  {
    title: 'Anatomical Illustrations',
    description: 'Early depictions of human anatomy from medical and natural philosophical texts, tracing the evolution of anatomical knowledge.',
    slug: 'anatomical-illustrations',
    subjects: ['anatomy'],
    minQuality: 0.6,
    maxPerBook: 5,
    limit: 40,
    featured: true,
    sort_order: 2,
  },
  {
    title: 'Astronomical Diagrams',
    description: 'Celestial charts, planetary diagrams, and cosmological models from early modern astronomical works.',
    slug: 'astronomical-diagrams',
    subjects: ['astronomy'],
    minQuality: 0.5,
    maxPerBook: 5,
    limit: 40,
    featured: true,
    sort_order: 3,
  },
  {
    title: "Printer's Devices & Frontispieces",
    description: "Elaborate title pages and printer's marks that showcase the artistry of early modern book production.",
    slug: 'printers-devices',
    types: ['frontispiece'],
    minQuality: 0.7,
    maxPerBook: 3,
    limit: 40,
    featured: true,
    sort_order: 4,
  },
  {
    title: 'Botanical Illustrations',
    description: 'Drawings of plants, herbs, and flowers from herbals and natural history treatises.',
    slug: 'botanical-illustrations',
    searchTerms: ['botanical', 'plant', 'herb', 'flower', 'root', 'leaf', 'fruit'],
    minQuality: 0.6,
    maxPerBook: 5,
    limit: 40,
    featured: false,
    sort_order: 5,
  },
  {
    title: 'Portraits',
    description: 'Engraved and woodcut portraits of authors, scholars, rulers, and historical figures from early printed books.',
    slug: 'portraits',
    types: ['portrait'],
    minQuality: 0.7,
    maxPerBook: 3,
    limit: 50,
    featured: true,
    sort_order: 6,
  },
  {
    title: 'Mystical & Cosmological Diagrams',
    description: 'Visual representations of mystical cosmology, esoteric symbolism, and occult philosophy.',
    slug: 'mystical-diagrams',
    types: ['diagram'],
    searchTerms: ['cosmolog', 'mystical', 'occult', 'esoteric', 'sephir', 'celestial', 'macrocosm'],
    minQuality: 0.5,
    maxPerBook: 5,
    limit: 40,
    featured: true,
    sort_order: 7,
  },
  {
    title: 'Maps & Cartography',
    description: 'Historical maps and geographic illustrations from early modern texts.',
    slug: 'maps-cartography',
    types: ['map'],
    minQuality: 0.5,
    maxPerBook: 3,
    limit: 30,
    featured: false,
    sort_order: 8,
  },
];

/**
 * POST /api/admin/seed-collections
 *
 * Seed gallery collections by querying for matching images.
 * ?dry_run=true to preview without creating.
 * ?force=true to recreate even if slug exists.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dry_run') === 'true';
    const force = searchParams.get('force') === 'true';

    const db = await getDb();
    const results: Array<{ slug: string; title: string; imageCount: number; status: string }> = [];

    for (const seed of SEED_COLLECTIONS) {
      // Check if already exists
      const existing = await db.collection('gallery_collections').findOne({ slug: seed.slug });
      if (existing && !force) {
        results.push({
          slug: seed.slug,
          title: seed.title,
          imageCount: (existing.image_ids as string[])?.length || 0,
          status: 'already_exists',
        });
        continue;
      }

      // Build filter conditions for detected_images
      const conditions: Record<string, unknown>[] = [
        { 'detected_images.bbox': { $exists: true } },
        { 'detected_images.gallery_quality': { $gte: seed.minQuality } },
      ];

      if (seed.types?.length) {
        conditions.push({ 'detected_images.type': { $in: seed.types } });
      }

      if (seed.subjects?.length) {
        conditions.push({
          $or: seed.subjects.map((s) => ({
            'detected_images.metadata.subjects': { $regex: s, $options: 'i' },
          })),
        });
      }

      if (seed.searchTerms?.length) {
        const searchOr = seed.searchTerms.map((term) => ({
          $or: [
            { 'detected_images.description': { $regex: term, $options: 'i' } },
            { 'detected_images.museum_description': { $regex: term, $options: 'i' } },
            { 'detected_images.metadata.subjects': { $regex: term, $options: 'i' } },
          ],
        }));
        conditions.push({ $or: searchOr });
      }

      // Query for matching images
      const pipeline: any[] = [
        { $match: { 'detected_images.0': { $exists: true }, $and: conditions } },
        { $unwind: { path: '$detected_images', includeArrayIndex: 'detIdx' } },
      ];

      // Post-unwind filters
      const postConditions: Record<string, unknown>[] = [
        { 'detected_images.bbox': { $exists: true } },
        { 'detected_images.gallery_quality': { $gte: seed.minQuality } },
      ];

      if (seed.types?.length) {
        postConditions.push({ 'detected_images.type': { $in: seed.types } });
      }

      if (seed.subjects?.length) {
        postConditions.push({
          $or: seed.subjects.map((s) => ({
            'detected_images.metadata.subjects': { $regex: s, $options: 'i' },
          })),
        });
      }

      if (seed.searchTerms?.length) {
        const searchOr = seed.searchTerms.map((term) => ({
          $or: [
            { 'detected_images.description': { $regex: term, $options: 'i' } },
            { 'detected_images.museum_description': { $regex: term, $options: 'i' } },
            { 'detected_images.metadata.subjects': { $regex: term, $options: 'i' } },
          ],
        }));
        postConditions.push({ $or: searchOr });
      }

      pipeline.push({ $match: { $and: postConditions } });

      // Per-book diversity
      pipeline.push(
        {
          $setWindowFields: {
            partitionBy: '$book_id',
            sortBy: { 'detected_images.gallery_quality': -1 },
            output: { _bookRank: { $rank: {} } },
          },
        },
        { $match: { _bookRank: { $lte: seed.maxPerBook } } }
      );

      // Sort by quality, limit
      pipeline.push(
        { $sort: { 'detected_images.gallery_quality': -1 } },
        { $limit: seed.limit },
        {
          $project: {
            _id: 0,
            imageId: { $concat: ['$id', '-', { $toString: '$detIdx' }] },
          },
        }
      );

      const images = await db.collection('pages').aggregate(pipeline).toArray();
      const imageIds = images.map((img: any) => img.imageId);

      if (dryRun) {
        results.push({
          slug: seed.slug,
          title: seed.title,
          imageCount: imageIds.length,
          status: 'dry_run',
        });
        continue;
      }

      // Delete existing if force
      if (existing && force) {
        await db.collection('gallery_collections').deleteOne({ slug: seed.slug });
      }

      // Create collection
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
        status: 'created',
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Seed collections error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to seed collections' },
      { status: 500 }
    );
  }
}
