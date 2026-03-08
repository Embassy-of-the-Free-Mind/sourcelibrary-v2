export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { processImageUpload } from '@/lib/uploads/processing';
import { updateBookAfterUpload } from '@/lib/uploads/utils';
import { logAuditEvent } from '@/lib/audit-logger';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') as string;
    const author = formData.get('author') as string;
    const language = formData.get('language') as string;
    const published = formData.get('published') as string;
    const titlePageFile = formData.get('titlePage') as File;

    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    if (!titlePageFile || !titlePageFile.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Title page image required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await generateUniqueBookSlug(db, title, author || 'Unknown');

    // Create book record
    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      tenant_id: 'default',
      title,
      author: author || 'Unknown',
      language: language || 'Unknown',
      published: published || 'Unknown',
      categories: [],
      pages_count: 0,
      image_source: {
        provider: 'user_upload',
        provider_name: 'Mobile Scan',
      },
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('books').insertOne(bookDoc);

    // Upload title page as page 1
    const bytes = await titlePageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filename = `${new ObjectId().toHexString()}.jpg`;

    const result = await processImageUpload({
      buffer,
      filename,
      contentType: titlePageFile.type,
      bookId: bookIdStr,
      nextPageNumber: 1,
      db,
    });

    await db.collection('pages').insertMany(result.pages);
    await updateBookAfterUpload(db, bookIdStr);

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: result.pages.length,
      metadata: { source: 'mobile_scan' },
    });

    return NextResponse.json({
      id: bookIdStr,
      slug,
      url: `https://sourcelibrary.org/book/${slug}`,
    });
  } catch (error) {
    console.error('Scan create error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Create failed' },
      { status: 500 }
    );
  }
}
