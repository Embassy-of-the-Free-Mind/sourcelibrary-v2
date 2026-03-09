export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { processImageUpload } from '@/lib/uploads/processing';
import {
  updateBookAfterUpload,
  getMimeTypeFromExtension,
} from '@/lib/uploads/utils';
import type { Book } from '@/lib/types/book';
import path from 'path';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES_PER_REQUEST = 10;

/**
 * Batch upload endpoint for the mobile scanner.
 *
 * Unauthenticated — access controlled by checking the book was created
 * via Mobile Scan and is still in draft status.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const bookId = formData.get('bookId') as string;
    const files = formData.getAll('files') as File[];
    const startPageNumber = parseInt(formData.get('startPageNumber') as string) || 0;

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID is required' }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES_PER_REQUEST} files per request` },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Validate book exists, was created via Mobile Scan, and is still a draft
    const book = await db.collection<Book>('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (
      book.image_source?.provider !== 'user_upload' ||
      book.image_source?.provider_name !== 'Mobile Scan' ||
      (book.status && book.status !== 'draft')
    ) {
      return NextResponse.json(
        { error: 'Upload only allowed for Mobile Scan books in draft status' },
        { status: 403 }
      );
    }

    // Get current max page number
    const lastPage = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: -1 })
      .limit(1)
      .toArray();

    let nextPageNumber = startPageNumber > 0
      ? startPageNumber
      : (lastPage.length > 0 ? lastPage[0].page_number + 1 : 1);

    const uploadedPages = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_FILE_SIZE) continue;

      try {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const ext = path.extname(file.name) || '.jpg';
        const filename = `${new ObjectId().toHexString()}${ext}`;
        const contentType = file.type || getMimeTypeFromExtension(file.name);

        const result = await processImageUpload({
          buffer,
          filename,
          contentType,
          bookId,
          nextPageNumber,
          db,
        });

        await db.collection('pages').insertMany(result.pages);
        uploadedPages.push(...result.pages);
        nextPageNumber = result.nextPageNumber;
      } catch (err) {
        console.error(`Failed to process ${file.name}:`, err);
        continue;
      }
    }

    if (uploadedPages.length > 0) {
      await updateBookAfterUpload(db, bookId);
    }

    return NextResponse.json({
      success: true,
      uploaded: uploadedPages.length,
      pages: uploadedPages.map(p => ({
        id: p.id,
        page_number: p.page_number,
        photo: p.photo,
      })),
    });
  } catch (error) {
    console.error('Scan upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
