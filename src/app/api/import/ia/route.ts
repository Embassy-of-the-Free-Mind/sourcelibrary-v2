import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';

/**
 * Import a book from Internet Archive
 *
 * POST /api/import/ia
 * Body: {
 *   ia_identifier: string,      // e.g., "BIUSante_pharma_res005272"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      ia_identifier,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      dublin_core,
      pages_count: manualPageCount
    } = body;

    if (!ia_identifier || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ia_identifier, title, author' },
        { status: 400 }
      );
    }

    // Fetch metadata from Internet Archive to get page count
    const metadataUrl = `https://archive.org/metadata/${ia_identifier}`;
    const metadataRes = await fetch(metadataUrl);

    if (!metadataRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch IA metadata: ${metadataRes.status}` },
        { status: 400 }
      );
    }

    const metadata = await metadataRes.json();

    // Find the main document file (usually a PDF or DJVU) to get page count
    // Or look for JP2 files which are individual page images
    const files = metadata.files || [];
    const iaMetadataRaw = metadata.metadata || {};

    // Determine page count — prefer manual override, then IIIF manifest, then metadata
    let pageCount = 0;
    let pageCountSource = '';

    // 0. Manual override — for items without IIIF manifests (e.g. BNC Florence incunabula)
    if (manualPageCount && Number.isInteger(manualPageCount) && manualPageCount > 0) {
      pageCount = manualPageCount;
      pageCountSource = 'manual';
    }

    // 1. IIIF manifest — most reliable, counts actual canvases
    try {
      const iiifRes = await fetch(
        `https://iiif.archive.org/iiif/${ia_identifier}/manifest.json`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (iiifRes.ok) {
        const manifest = await iiifRes.json();
        // IIIF v3 uses 'items', v2 uses 'sequences[0].canvases'
        if (manifest.items) {
          pageCount = manifest.items.length;
          pageCountSource = 'iiif_v3';
        } else if (manifest.sequences?.[0]?.canvases) {
          pageCount = manifest.sequences[0].canvases.length;
          pageCountSource = 'iiif_v2';
        }
      }
    } catch {
      // IIIF fetch failed, continue to fallbacks
    }

    // 2. IA metadata imagecount field
    if (pageCount === 0 && iaMetadataRaw.imagecount) {
      pageCount = parseInt(iaMetadataRaw.imagecount, 10);
      pageCountSource = 'imagecount';
    }

    // 3. Count individual .jp2 files (if listed outside zip)
    if (pageCount === 0) {
      const jp2Files = files.filter((f: { name: string }) =>
        f.name.endsWith('.jp2') && !f.name.includes('thumb')
      );
      if (jp2Files.length > 1) {
        pageCount = jp2Files.length;
        pageCountSource = 'jp2_files';
      }
    }

    // 4. Cross-check: if imagecount or jp2 differs wildly from IIIF, trust IIIF
    // (this catches the inflation bug where metadata reports 2-20x too many pages)

    if (pageCount === 0) {
      return NextResponse.json(
        { error: `Could not determine page count for ${ia_identifier}. No IIIF manifest, no imagecount, no jp2 files found.` },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check if book already exists
    const existing = await db.collection('books').findOne({
      $or: [
        { ia_identifier },
        { title },
        { 'dublin_core.dc_identifier': `IA:${ia_identifier}` }
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

    // IA image URL pattern
    const getPageImageUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/pct:50/0/default.jpg`;

    const getThumbnailUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/pct:15/0/default.jpg`;

    // Extract license from IA metadata
    const iaMetadata = metadata.metadata || {};
    const licenseUrl = iaMetadata.licenseurl || iaMetadata.license || null;
    const rights = iaMetadata.rights || iaMetadata.possible_copyright_status || null;
    const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim();
    const contributor = typeof iaMetadata.contributor === 'string' ? stripHtml(iaMetadata.contributor) : null;
    const sponsor = typeof iaMetadata.sponsor === 'string' ? stripHtml(iaMetadata.sponsor) : null;

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
      thumbnail: getThumbnailUrl(0),
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: dublin_core || {
        dc_identifier: [`IA:${ia_identifier}`],
        dc_source: `https://archive.org/details/${ia_identifier}`
      },
      image_source: {
        provider: 'internet_archive',
        provider_name: 'Internet Archive',
        source_url: `https://archive.org/details/${ia_identifier}`,
        identifier: ia_identifier,
        license: licenseUrl || 'publicdomain',
        license_url: licenseUrl,
        rights: rights,
        ...(contributor ? { contributing_library: contributor } : {}),
        ...(sponsor ? { sponsor } : {}),
        access_date: new Date(),
      },
      page_count_source: pageCountSource,
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date()
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
        updated_at: new Date()
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
      metadata: { provider: 'internet_archive', identifier: ia_identifier },
    });

    // Fire off split detection check (non-blocking)
    // This will set book.needs_splitting based on aspect ratio of pages 10 & 15
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : request.headers.get('origin') || 'http://localhost:3000';

    fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, {
      method: 'GET',
    }).catch(() => {
      // Ignore errors - split check is optional
      console.log(`[Import] Split check queued for ${bookIdStr}`);
    });

    // Notify search engines of new book via IndexNow (non-blocking)
    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      ia_identifier,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      iaUrl: `https://archive.org/details/${ia_identifier}`,
      splitCheckQueued: true,
      message: `Created book with ${pageDocs.length} pages from Internet Archive. Split detection queued.`
    });

  } catch (error) {
    console.error('IA Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
