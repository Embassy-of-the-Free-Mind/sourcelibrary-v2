import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';
import { normalizeTitle, normalizeAuthor, sourceFingerprint, checkDuplicate } from '@/lib/dedup';

export const maxDuration = 300;

/**
 * Import a book from Google Books via Internet Archive mirror
 *
 * POST /api/import/google-books
 * Body: {
 *   google_books_id: string,  // Google Books volume ID, e.g. "aTo6AQAAMAAJ"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 *
 * Google Books does not provide IIIF access. However, most Google-digitized
 * books are mirrored on Internet Archive with identifiers like `bub_gb_<id>`.
 * This route checks IA for the mirror and imports from there.
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      google_books_id,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
    } = body;

    if (!google_books_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: google_books_id, title, author' },
        { status: 400 }
      );
    }

    // Google Books items are mirrored to IA with this identifier pattern
    const ia_identifier = `bub_gb_${google_books_id}`;

    // Check if the item exists on Internet Archive
    const metadataRes = await fetch(`https://archive.org/metadata/${ia_identifier}`);

    if (!metadataRes.ok) {
      return NextResponse.json({
        error: 'Google Books item not found on Internet Archive',
        google_books_id,
        ia_identifier,
        guidance: `This Google Books volume is not mirrored on Internet Archive. ` +
          `Try searching IA directly: https://archive.org/search?query=${encodeURIComponent(title)} ` +
          `or use the generic IIIF importer if another source has this text.`,
      }, { status: 404 });
    }

    const metadata = await metadataRes.json();
    if (!metadata.metadata) {
      return NextResponse.json({
        error: 'Invalid IA metadata for Google Books mirror',
        ia_identifier,
        guidance: 'The IA record exists but has no valid metadata. Try importing directly from IA.',
      }, { status: 400 });
    }

    const db = await getDb();

    // Check for duplicates
    const existing = await db.collection('books').findOne({
      $or: [
        { ia_identifier },
        { google_books_id },
        { 'dublin_core.dc_identifier': `IA:${ia_identifier}` },
      ],
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Cross-source dedup check
    const dedupResult = await checkDuplicate(db, {
      title, author, display_title, ia_identifier, google_books_id,
      image_source: { provider: 'google_books', identifier: google_books_id, source_url: `https://books.google.com/books?id=${google_books_id}` },
    });
    if (dedupResult.isDuplicate) {
      const best = dedupResult.matches[0];
      return NextResponse.json(
        { error: `Duplicate detected (${best.matchType}): matches "${best.matchedTitle}"`, existingId: best.matchedBookId, matches: dedupResult.matches },
        { status: 409 }
      );
    }

    // Get page count from IA metadata
    const iaMetadata = metadata.metadata;
    const files = metadata.files || [];
    let pageCount = 0;

    if (iaMetadata.imagecount) {
      pageCount = parseInt(iaMetadata.imagecount, 10);
    }

    if (pageCount === 0) {
      const jp2Files = files.filter((f: { name: string }) =>
        f.name.endsWith('.jp2') && !f.name.includes('thumb')
      );
      if (jp2Files.length > 1) pageCount = jp2Files.length;
    }

    // DjVu-based items (common for Google Books mirrors) lack imagecount and JP2 files.
    // The scandata XML has the definitive page count.
    if (pageCount === 0) {
      const scandataFile = files.find((f: { name: string }) => f.name.endsWith('_scandata.xml'));
      if (scandataFile) {
        try {
          const scandataRes = await fetch(`https://archive.org/download/${ia_identifier}/${scandataFile.name}`);
          if (scandataRes.ok) {
            const xml = await scandataRes.text();
            const matches = xml.match(/<page /g);
            if (matches && matches.length > 0) {
              pageCount = matches.length;
            }
          }
        } catch {
          // Fall through to fallback
        }
      }
    }

    if (pageCount === 0) {
      pageCount = 100; // Last resort fallback
    }

    // Create book using IA image URLs
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    const getPageImageUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/pct:50/0/default.jpg`;
    const getThumbnailUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/pct:15/0/default.jpg`;

    const licenseUrl = iaMetadata.licenseurl || iaMetadata.license || null;
    const rights = iaMetadata.rights || iaMetadata.possible_copyright_status || null;

    const slug = await generateUniqueBookSlug(db, title, author, display_title);

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      tenant_id: 'default',
      title,
      display_title: display_title || null,
      author,
      language: language || 'Unknown',
      published: published || 'Unknown',
      categories: categories || [],
      ...(work_id ? { work_id } : {}),
      ia_identifier,
      google_books_id,
      thumbnail: getThumbnailUrl(0),
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: {
        dc_identifier: [`IA:${ia_identifier}`, `GBOOKS:${google_books_id}`],
        dc_source: `https://archive.org/details/${ia_identifier}`,
      },
      image_source: {
        provider: 'google_books',
        provider_name: 'Google Books (via Internet Archive)',
        source_url: `https://books.google.com/books?id=${google_books_id}`,
        ia_mirror_url: `https://archive.org/details/${ia_identifier}`,
        identifier: google_books_id,
        ia_identifier,
        license: licenseUrl || 'publicdomain',
        license_url: licenseUrl,
        rights,
        access_date: new Date(),
      },
      status: 'draft',
      hidden: true, visible: false,
      source_fingerprint: sourceFingerprint({ ia_identifier, google_books_id }),
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('books').insertOne(bookDoc);

    // Create pages
    const pageDocs = [];
    for (let i = 0; i < pageCount; i++) {
      const pageId = new ObjectId();
      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        tenant_id: 'default',
        book_id: bookIdStr,
        page_number: i + 1,
        photo: getPageImageUrl(i),
        thumbnail: getThumbnailUrl(i),
        photo_original: getPageImageUrl(i),
        // Don't initialize ocr/translation with empty strings -- they cause
        // false completion in job-completion.ts (see: translation loop bug fix)
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // Queue preview OCR for early metadata enrichment (non-blocking)
    queuePreviewOcr(bookIdStr, title).catch(() => {});

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pageDocs.length,
      metadata: { provider: 'google_books', identifier: google_books_id, ia_identifier },
    });

    // Split detection check (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : request.headers.get('origin') || 'http://localhost:3000';

    fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, {
      method: 'GET',
    }).catch(() => {
      console.log(`[Import] Split check queued for ${bookIdStr}`);
    });

    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      google_books_id,
      ia_identifier,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      googleBooksUrl: `https://books.google.com/books?id=${google_books_id}`,
      iaUrl: `https://archive.org/details/${ia_identifier}`,
      splitCheckQueued: true,
      message: `Created book with ${pageDocs.length} pages from Google Books (via IA mirror). Split detection queued.`,
    });
  } catch (error) {
    console.error('Google Books import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
