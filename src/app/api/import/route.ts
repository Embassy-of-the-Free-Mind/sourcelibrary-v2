import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

/**
 * Import a book from a local directory
 *
 * POST /api/import
 * Body: {
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language: string,
 *   published?: string,
 *   pagesDir: string,  // Absolute path to directory with page images
 *   categories?: string[],
 *   ia_identifier?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      display_title,
      author,
      language,
      published,
      pagesDir,
      categories,
      ia_identifier,
      dublin_core,
      image_source,
    } = body;

    // Validate required fields
    if (!title || !author || !pagesDir) {
      return NextResponse.json(
        { error: 'Missing required fields: title, author, pagesDir' },
        { status: 400 }
      );
    }

    // Check if directory exists
    if (!fs.existsSync(pagesDir)) {
      return NextResponse.json(
        { error: `Directory not found: ${pagesDir}` },
        { status: 400 }
      );
    }

    // Get page images
    const pageFiles = fs.readdirSync(pagesDir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();

    if (pageFiles.length === 0) {
      return NextResponse.json(
        { error: 'No image files found in directory' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check if book already exists
    const existing = await db.collection('books').findOne({
      $or: [
        { title },
        { display_title: display_title || title }
      ]
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      tenant_id: 'default',
      title,
      display_title: display_title || null,
      author,
      language: language || 'Unknown',
      published: published || 'Unknown',
      categories: categories || [],
      ia_identifier: ia_identifier || null,
      dublin_core: dublin_core || null,
      image_source: image_source || null,
      pageCount: pageFiles.length,
      pages_count: pageFiles.length,
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date()
    };

    await db.collection('books').insertOne(bookDoc);

    // Create pages
    const pageDocs = pageFiles.map((filename, index) => {
      const pageId = new ObjectId();
      const imagePath = path.join(pagesDir, filename);

      return {
        _id: pageId,
        id: pageId.toHexString(),
        tenant_id: 'default',
        book_id: bookIdStr,
        page_number: index + 1,
        photo: imagePath,
        thumbnail: imagePath,
        ocr: {
          language: language || 'Unknown',
          model: null,
          data: ''
        },
        translation: {
          language: 'English',
          model: null,
          data: ''
        },
        created_at: new Date(),
        updated_at: new Date()
      };
    });

    await db.collection('pages').insertMany(pageDocs);

    // Set thumbnail from first page
    await db.collection('books').updateOne(
      { _id: bookId },
      { $set: { thumbnail: pageDocs[0].photo } }
    );

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      pagesImported: pageDocs.length,
      message: `Created book with ${pageDocs.length} pages`
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
}
