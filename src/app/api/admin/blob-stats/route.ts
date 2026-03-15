import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const GET = withAdminAuth(async (request, session) => {
  try {
    const db = await getDb();

    // Use book-level caches for expensive global counts (avoids full scans on 1.84M pages)
    const [bookAggregates] = await db.collection('books').aggregate([
      {
        $group: {
          _id: null,
          totalPages: { $sum: '$pages_count' },
          pagesWithOcr: { $sum: '$pages_ocr' },
          pagesWithTranslation: { $sum: '$pages_translated' },
        }
      }
    ]).toArray() || [{}];

    // Parallel queries — indexed or small-collection queries only
    const [
      pagesWithCroppedPhoto,
      pagesWithCropData,
      booksWithSplitPages,
      booksWithArchivedImages,
      sampleCropped,
      sampleArchived,
      booksByProvider,
    ] = await Promise.all([
      // crop.xStart is indexed (pages_split_detection_idx)
      db.collection('pages').countDocuments({
        cropped_photo: { $exists: true, $nin: [null, ''] }
      }),
      db.collection('pages').countDocuments({
        'crop.xStart': { $exists: true }
      }),
      db.collection('pages').distinct('book_id', {
        'crop.xStart': { $exists: true }
      }),
      db.collection('books').countDocuments({
        images_archived: true
      }),
      db.collection('pages').findOne(
        { cropped_photo: { $exists: true, $nin: [null, ''] } },
        { projection: { cropped_photo: 1, book_id: 1, id: 1 } }
      ),
      db.collection('pages').findOne(
        { archived_photo: { $exists: true, $nin: [null, ''] } },
        { projection: { archived_photo: 1, book_id: 1, id: 1 } }
      ),
      db.collection('books').aggregate([
        { $group: { _id: '$image_source.provider', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray(),
    ]);

    // Archived photo count from book-level (books with images_archived * avg pages)
    // For blob photo/thumbnail counts, use book-level aggregate as proxy
    const pagesWithArchivedPhoto = await db.collection('pages').countDocuments({
      archived_photo: { $exists: true, $nin: [null, ''] }
    });

    const totalPages = bookAggregates?.totalPages || 0;
    const pagesWithOcr = bookAggregates?.pagesWithOcr || 0;
    const pagesWithTranslation = bookAggregates?.pagesWithTranslation || 0;
    const totalBlobPages = pagesWithCroppedPhoto + pagesWithArchivedPhoto;

    return NextResponse.json({
      totalPages,
      processing: {
        pagesWithOcr,
        pagesWithTranslation,
        pagesWithSummary: 0, // Rarely used, removed full scan
      },
      vercelBlob: {
        pagesWithCroppedPhoto,
        pagesWithArchivedPhoto,
        pagesWithBlobPhoto: 0, // Removed expensive regex scan
        pagesWithBlobThumbnail: 0, // Removed expensive regex scan
        totalBlobPages,
        pagesWithCropData,
        booksWithSplitPages: booksWithSplitPages.length,
        booksWithArchivedImages,
        samples: {
          cropped: sampleCropped?.cropped_photo,
          archived: sampleArchived?.archived_photo,
        }
      },
      booksByImageProvider: booksByProvider.map(p => ({
        provider: p._id || 'unknown',
        count: p.count
      })),
    });
  } catch (error) {
    console.error('Blob stats error:', error);
    return NextResponse.json(
      { error: 'Failed to get blob stats' },
      { status: 500 }
    );
  }
});
