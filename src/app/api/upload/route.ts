import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { put } from '@vercel/blob';

import type { Page } from '@/lib/types/page';
import { compress_photo } from '@/lib/image-manipulation';

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
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
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

      // Read image file data
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Generate & Upload Original Image
      const ext = path.extname(file.name) || '.jpg';
      const filename = `${new ObjectId().toHexString()}${ext}`;
      const blobPath = `uploads/${bookId}/${filename}`;      
      const origPhotoBlob = await put(
        blobPath,
        buffer,
        {
          access: 'public',
          contentType: file.type || 'image/jpeg',
          addRandomSuffix: false,
        }
      );

      // Generate & Upload Thumbnail Image (max 200px)
      const thumbnailBuffer = await compress_photo(buffer, 150, 60);
      const thumbnailBlobPath = `uploads/${bookId}/thumbnails/${filename}`;      
      const thumbnailPhotoBlob = await put(
        thumbnailBlobPath,
        thumbnailBuffer,
        {
          access: 'public',
          contentType: file.type || 'image/jpeg',
          addRandomSuffix: false,
        }
      );

      // Create page record
      const pageId = new ObjectId().toHexString();
      const photoUrl = origPhotoBlob.url;
      const thumbnailUrl = thumbnailPhotoBlob.url;
      
      const page: Page = {
        id: pageId,
        tenant_id: 'default',
        book_id: bookId,
        page_number: nextPageNumber,
        photo: photoUrl,
        photo_original: photoUrl,
        thumbnail: thumbnailUrl,        
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db.collection('pages').insertOne(page);
      uploadedPages.push(page);
      nextPageNumber++;
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
