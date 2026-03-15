export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { processImageUpload } from '@/lib/uploads/processing';
import { updateBookAfterUpload } from '@/lib/uploads/utils';
import { logAuditEvent } from '@/lib/audit-logger';
import { normalizeTitle, normalizeAuthor } from '@/lib/dedup';

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

    const hasTitlePage = titlePageFile && titlePageFile.type?.startsWith('image/');

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
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author || 'Unknown'),
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('books').insertOne(bookDoc);

    let pagesAffected = 0;

    // Upload title page as page 1 (if provided)
    if (hasTitlePage) {
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
      pagesAffected = result.pages.length;
    }

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pagesAffected,
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
