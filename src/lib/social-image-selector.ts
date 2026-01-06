/**
 * Social Media Image Selector for Source Library
 *
 * Selects the most shareable gallery images based on quality,
 * metadata richness, and variety. Excludes recently posted images.
 */

import { Db, Document } from 'mongodb';

export interface SocialImageCandidate {
  pageId: string;
  detectionIndex: number;
  galleryImageId: string;       // "pageId:index" format
  galleryQuality: number;
  shareabilityScore: number;

  // Image data
  description: string;
  type: string;
  museumDescription?: string;
  metadata?: {
    subjects?: string[];
    symbols?: string[];
    figures?: string[];
  };
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  // Book context
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: number;
  pageNumber: number;

  // Image URL
  imageUrl: string;
}

export interface SelectionCriteria {
  minGalleryQuality: number;
  excludeRecentlyPosted: boolean;
  recentDays: number;           // Days to look back for recent posts
  diversifyBooks: boolean;       // Limit to 1 image per book
  preferRichMetadata: boolean;
}

const DEFAULT_CRITERIA: SelectionCriteria = {
  minGalleryQuality: 0.7,
  excludeRecentlyPosted: true,
  recentDays: 30,
  diversifyBooks: true,
  preferRichMetadata: true,
};

/**
 * Select the best images for social media posts.
 *
 * Scoring algorithm:
 * - gallery_quality: 50 points max (normalized to 0-50)
 * - Has rich metadata (subjects/symbols/figures): +10
 * - Has museum_description (50+ chars): +15
 * - Interesting type (emblem/engraving/frontispiece): +10
 * - High confidence detection: +5
 */
export async function selectImagesForPosts(
  db: Db,
  count: number = 5,
  criteria: Partial<SelectionCriteria> = {}
): Promise<SocialImageCandidate[]> {
  const opts = { ...DEFAULT_CRITERIA, ...criteria };

  // Get recently posted image IDs to exclude
  let recentImageIds = new Set<string>();
  if (opts.excludeRecentlyPosted) {
    const cutoffDate = new Date(Date.now() - opts.recentDays * 24 * 60 * 60 * 1000);
    const recentPosts = await db.collection('social_posts')
      .find({
        status: 'posted',
        posted_at: { $gte: cutoffDate }
      })
      .project({ 'image_ref.gallery_image_id': 1 })
      .toArray();

    recentImageIds = new Set(recentPosts.map(p => p.image_ref?.gallery_image_id).filter(Boolean));
  }

  // Build aggregation pipeline
  const pipeline: Document[] = [
    // Stage 1: Match pages with detected images
    {
      $match: {
        'detected_images.0': { $exists: true },
        $or: [
          { cropped_photo: { $exists: true, $ne: '' } },
          { photo_original: { $exists: true, $ne: '' } },
          { photo: { $exists: true, $ne: '' } }
        ]
      }
    },

    // Stage 2: Lookup book info
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },

    // Stage 3: Unwind detected images
    { $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } },

    // Stage 4: Filter by quality and required fields
    {
      $match: {
        'detected_images.gallery_quality': { $gte: opts.minGalleryQuality },
        'detected_images.bbox': { $exists: true },
        $or: [
          { 'detected_images.detection_source': 'vision_model' },
          { 'detected_images.detection_source': 'manual' }
        ]
      }
    },

    // Stage 5: Calculate shareability score
    {
      $addFields: {
        galleryImageId: {
          $concat: ['$id', ':', { $toString: '$detectionIndex' }]
        },
        shareabilityScore: {
          $add: [
            // Base quality score (0-50)
            { $multiply: [{ $ifNull: ['$detected_images.gallery_quality', 0] }, 50] },

            // Rich metadata bonus (+10)
            {
              $cond: [
                {
                  $or: [
                    { $gt: [{ $size: { $ifNull: ['$detected_images.metadata.subjects', []] } }, 0] },
                    { $gt: [{ $size: { $ifNull: ['$detected_images.metadata.symbols', []] } }, 0] },
                    { $gt: [{ $size: { $ifNull: ['$detected_images.metadata.figures', []] } }, 0] }
                  ]
                },
                10,
                0
              ]
            },

            // Museum description bonus (+15)
            {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ['$detected_images.museum_description', ''] } }, 50] },
                15,
                0
              ]
            },

            // Interesting type bonus (+10)
            {
              $cond: [
                {
                  $in: [
                    '$detected_images.type',
                    ['emblem', 'engraving', 'frontispiece', 'portrait', 'diagram']
                  ]
                },
                10,
                0
              ]
            },

            // High confidence bonus (+5)
            {
              $cond: [
                { $gte: [{ $ifNull: ['$detected_images.confidence', 0] }, 0.8] },
                5,
                0
              ]
            }
          ]
        }
      }
    },

    // Stage 6: Sort by shareability score
    { $sort: { shareabilityScore: -1 } },

    // Stage 7: Limit to get more than needed (for filtering)
    { $limit: count * 5 },

    // Stage 8: Project final fields
    {
      $project: {
        pageId: '$id',
        detectionIndex: '$detectionIndex',
        galleryImageId: '$galleryImageId',
        galleryQuality: '$detected_images.gallery_quality',
        shareabilityScore: '$shareabilityScore',

        description: '$detected_images.description',
        type: '$detected_images.type',
        museumDescription: '$detected_images.museum_description',
        metadata: '$detected_images.metadata',
        bbox: '$detected_images.bbox',

        bookId: '$book_id',
        bookTitle: { $ifNull: ['$book.display_title', '$book.title'] },
        bookAuthor: '$book.author',
        bookYear: {
          $cond: [
            { $isNumber: '$book.published' },
            '$book.published',
            {
              $cond: [
                { $and: [
                  { $ne: ['$book.published', ''] },
                  { $ne: ['$book.published', null] }
                ]},
                { $toInt: '$book.published' },
                null
              ]
            }
          ]
        },
        pageNumber: '$page_number',

        imageUrl: { $ifNull: ['$cropped_photo', { $ifNull: ['$photo_original', '$photo'] }] }
      }
    }
  ];

  const candidates = await db.collection('pages').aggregate(pipeline).toArray();

  // Filter out recently posted
  let filtered = candidates.filter(c =>
    !recentImageIds.has(c.galleryImageId)
  );

  // Diversify by book if requested
  if (opts.diversifyBooks) {
    const seenBooks = new Set<string>();
    filtered = filtered.filter(c => {
      if (seenBooks.has(c.bookId)) return false;
      seenBooks.add(c.bookId);
      return true;
    });
  }

  // Return top N
  return filtered.slice(0, count) as SocialImageCandidate[];
}

/**
 * Get a single image candidate by its gallery image ID.
 */
export async function getImageCandidate(
  db: Db,
  galleryImageId: string
): Promise<SocialImageCandidate | null> {
  const [pageId, indexStr] = galleryImageId.split(':');
  const detectionIndex = parseInt(indexStr, 10);

  if (!pageId || isNaN(detectionIndex)) {
    return null;
  }

  const pipeline: Document[] = [
    { $match: { id: pageId } },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        pageId: '$id',
        detectionIndex: { $literal: detectionIndex },
        galleryImageId: { $literal: galleryImageId },
        galleryQuality: { $arrayElemAt: ['$detected_images.gallery_quality', detectionIndex] },
        shareabilityScore: { $literal: 0 }, // Not calculating here

        description: { $arrayElemAt: ['$detected_images.description', detectionIndex] },
        type: { $arrayElemAt: ['$detected_images.type', detectionIndex] },
        museumDescription: { $arrayElemAt: ['$detected_images.museum_description', detectionIndex] },
        metadata: { $arrayElemAt: ['$detected_images.metadata', detectionIndex] },
        bbox: { $arrayElemAt: ['$detected_images.bbox', detectionIndex] },

        bookId: '$book_id',
        bookTitle: { $ifNull: ['$book.display_title', '$book.title'] },
        bookAuthor: '$book.author',
        bookYear: {
          $cond: [
            { $isNumber: '$book.published' },
            '$book.published',
            {
              $cond: [
                { $and: [
                  { $ne: ['$book.published', ''] },
                  { $ne: ['$book.published', null] }
                ]},
                { $toInt: '$book.published' },
                null
              ]
            }
          ]
        },
        pageNumber: '$page_number',

        imageUrl: { $ifNull: ['$cropped_photo', { $ifNull: ['$photo_original', '$photo'] }] }
      }
    }
  ];

  const results = await db.collection('pages').aggregate(pipeline).toArray();
  return results[0] as SocialImageCandidate | null;
}

/**
 * Build the cropped image URL for a candidate.
 */
export function buildCropUrl(
  candidate: SocialImageCandidate,
  baseUrl?: string
): string {
  if (!candidate.bbox) {
    return candidate.imageUrl;
  }

  const base = baseUrl || '';
  const params = new URLSearchParams({
    url: candidate.imageUrl,
    x: candidate.bbox.x.toString(),
    y: candidate.bbox.y.toString(),
    w: candidate.bbox.width.toString(),
    h: candidate.bbox.height.toString(),
  });

  return `${base}/api/crop-image?${params}`;
}
