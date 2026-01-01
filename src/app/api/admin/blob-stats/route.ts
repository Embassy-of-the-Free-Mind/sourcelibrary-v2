import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET() {
  try {
    const db = await getDb();

    // Count pages with cropped_photo (Vercel Blob - split pages)
    const pagesWithCroppedPhoto = await db.collection('pages').countDocuments({
      cropped_photo: { $exists: true, $nin: [null, ''] }
    });

    // Count pages with archived_photo (Vercel Blob - full archived images)
    const pagesWithArchivedPhoto = await db.collection('pages').countDocuments({
      archived_photo: { $exists: true, $nin: [null, ''] }
    });

    // Count pages with photo containing blob.vercel-storage
    const pagesWithBlobPhoto = await db.collection('pages').countDocuments({
      photo: { $regex: 'blob.vercel-storage|vercel-storage.com' }
    });

    // Count pages with thumbnail containing blob
    const pagesWithBlobThumbnail = await db.collection('pages').countDocuments({
      thumbnail: { $regex: 'blob.vercel-storage|vercel-storage.com' }
    });

    // Count pages with crop data (split but might not have cropped_photo yet)
    const pagesWithCropData = await db.collection('pages').countDocuments({
      'crop.xStart': { $exists: true }
    });

    // Get distinct books that have been split
    const booksWithSplitPages = await db.collection('pages').distinct('book_id', {
      'crop.xStart': { $exists: true }
    });

    // Get books with archived images
    const booksWithArchivedImages = await db.collection('books').countDocuments({
      images_archived: true
    });

    // Sample URLs from different fields
    const sampleCropped = await db.collection('pages').findOne(
      { cropped_photo: { $exists: true, $nin: [null, ''] } },
      { projection: { cropped_photo: 1, book_id: 1, id: 1 } }
    );

    const sampleArchived = await db.collection('pages').findOne(
      { archived_photo: { $exists: true, $nin: [null, ''] } },
      { projection: { archived_photo: 1, book_id: 1, id: 1 } }
    );

    const sampleBlobPhoto = await db.collection('pages').findOne(
      { photo: { $regex: 'blob.vercel-storage|vercel-storage.com' } },
      { projection: { photo: 1, book_id: 1, id: 1 } }
    );

    // Count pages with summaries
    const pagesWithSummary = await db.collection('pages').countDocuments({
      'summary.data': { $exists: true, $nin: [null, ''] }
    });

    // Count pages with OCR
    const pagesWithOcr = await db.collection('pages').countDocuments({
      'ocr.data': { $exists: true, $nin: [null, ''] }
    });

    // Count pages with translation
    const pagesWithTranslation = await db.collection('pages').countDocuments({
      'translation.data': { $exists: true, $nin: [null, ''] }
    });

    // Total pages
    const totalPages = await db.collection('pages').countDocuments({});

    // Get books by image_source provider
    const booksByProvider = await db.collection('books').aggregate([
      {
        $group: {
          _id: '$image_source.provider',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Total blob pages (deduplicated estimate)
    const totalBlobPages = pagesWithCroppedPhoto + pagesWithArchivedPhoto + pagesWithBlobPhoto;

    return NextResponse.json({
      totalPages,
      processing: {
        pagesWithOcr,
        pagesWithTranslation,
        pagesWithSummary,
      },
      vercelBlob: {
        pagesWithCroppedPhoto,
        pagesWithArchivedPhoto,
        pagesWithBlobPhoto,
        pagesWithBlobThumbnail,
        totalBlobPages,
        pagesWithCropData,
        booksWithSplitPages: booksWithSplitPages.length,
        booksWithArchivedImages,
        samples: {
          cropped: sampleCropped?.cropped_photo,
          archived: sampleArchived?.archived_photo,
          blobPhoto: sampleBlobPhoto?.photo,
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
}
