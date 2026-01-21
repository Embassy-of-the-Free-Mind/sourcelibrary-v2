import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { processImageUpload } from '@/lib/uploads/processing';
import {
  validateBookAndGetPageNumber,
  updateBookAfterUpload,
  getMimeTypeFromExtension
} from '@/lib/uploads/utils';

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

    // Verify book exists and get next page number
    const db = await getDb();
    let nextPageNumber: number;
    try {
      const result = await validateBookAndGetPageNumber(db, bookId);
      nextPageNumber = result.nextPageNumber;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Book not found' },
        { status: 404 }
      );
    }

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
        const contentType = file.type || getMimeTypeFromExtension(file.name);

        // Use shared upload processing function
        const result = await processImageUpload({
          buffer,
          filename,
          contentType,
          bookId,
          nextPageNumber,
          db
        });

        // Insert pages into database
        await db.collection('pages').insertMany(result.pages);
        uploadedPages.push(...result.pages);
        nextPageNumber = result.nextPageNumber;

      } catch (error) {
        console.error(`Failed to process ${file.name}:`, error);
        // Skip this image, continue with rest
        continue;
      }
    }

    // Update book thumbnail and pages_count
    if (uploadedPages.length > 0) {
      await updateBookAfterUpload(db, bookId);
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
