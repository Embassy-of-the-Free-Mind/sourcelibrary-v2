import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { ObjectId } from 'mongodb';
import { put } from '@vercel/blob';
import { getDb } from '@/lib/mongodb';
import {
  detectSplit,
  processSingleImage,
  processSplitImage
} from '@/lib/page-split/split-processing';

// Maximum file size: 20MB
const MAX_FILE_SIZE_MEGABYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const bookId = formData.get('bookId') as string;
    const files = formData.getAll('files') as File[];

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID is required' }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Verify book exists
    const db = await getDb();
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found!' }, { status: 404 });
    }

    // Get current max page number
    const existingPages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: -1 })
      .limit(1)
      .toArray();
    let nextPageNumber = existingPages.length > 0 ? existingPages[0].page_number + 1 : 1;

    const uploadedPages = [];    

    for (const file of files) {
      // Validate file
      if (!file.type.startsWith('image/')) {
        continue; // Skip non-image files
      }

      if (file.size > MAX_FILE_SIZE_MEGABYTES) {
        continue; // Skip files that are too large
      }

      try {
        // Read image file data
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Generate unique filename
        const ext = path.extname(file.name) || '.jpg';
        const filename = `${new ObjectId().toHexString()}${ext}`;
        const contentType = file.type || 'image/jpeg';

        // STEP 1: Upload original image FIRST (always needed)
        const originalBlobPath = `uploads/${bookId}/${filename}`;
        const originalBlob = await put(originalBlobPath, buffer, {
          access: 'public',
          contentType,
          addRandomSuffix: false
        });

        // STEP 2: Detect if this is a two-page spread using Gemini (URL now available)
        const splitResult = await detectSplit(buffer, originalBlob.url, db);

        if (splitResult.isTwoPageSpread) {
          // STEP 3a: Process as split image (creates 2 pages with separate thumbnails)
          try {
            const [leftPage, rightPage] = await processSplitImage(
              buffer,
              bookId,
              nextPageNumber,
              originalBlob.url,
              splitResult
            );

            // Insert both pages
            await db.collection('pages').insertMany([leftPage, rightPage]);
            uploadedPages.push(leftPage, rightPage);
            nextPageNumber += 2;            
            continue; // Success, move to next file
          } catch (splitError) {
            console.error(`Split processing failed for ${file.name}, falling back to single page:`, splitError);
            // Fall through to single page logic with thumbnail generation
          }
        }

        // STEP 3b: Process as single page (either not a spread or split failed)
        // Generate thumbnail from original buffer
        const { compress_photo } = await import('@/lib/image-manipulation');
        const thumbnailBuffer = await compress_photo(buffer, 150, 60);
        const thumbnailBlobPath = `uploads/${bookId}/thumbnails/${filename}`;
        const thumbnailBlob = await put(thumbnailBlobPath, thumbnailBuffer, {
          access: 'public',
          contentType,
          addRandomSuffix: false
        });

        const singlePage = await processSingleImage(
          bookId,
          nextPageNumber,
          originalBlob.url,
          thumbnailBlob.url
        );

        await db.collection('pages').insertOne(singlePage);
        uploadedPages.push(singlePage);
        nextPageNumber += 1;

      } catch (error) {
        console.error(`Failed to process ${file.name}:`, error);
        // Skip this image, continue with rest
        continue;
      }
    }

    // Update book thumbnail and pages_count
    if (uploadedPages.length > 0) {
      const firstPage = await db.collection('pages')
        .findOne({ book_id: bookId, page_number: 1 });

      const updateFields: Record<string, unknown> = { updated_at: new Date() };
      if (firstPage && !book.thumbnail) {
        updateFields.thumbnail = firstPage.photo;
      }

      // Update pages_count
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: updateFields,
          $inc: { pages_count: uploadedPages.length }
        }
      );
    }

    return NextResponse.json({
      success: true,
      uploaded: uploadedPages.length,
      pages: uploadedPages,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
