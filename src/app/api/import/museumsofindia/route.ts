import { NextRequest, NextResponse } from 'next/server';
import { applyTextRole } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { publishedToYear, resolveLanguage, resolveDate } from '@/lib/resolve-language';
import { normalizeTitle, normalizeAuthor } from '@/lib/dedup';
import { acquisitionGate, confirmClaims } from '@/lib/acquisition-guard';
import { generateUniqueBookSlug } from '@/lib/slugify';

export const maxDuration = 300;

/**
 * Import a book from museumsofindia.gov.in (the Indian museums catalogue).
 *
 * The scraper's sqlite DB is exported to a normalized JSON manifest
 * (scripts/export-museumsofindia.mjs). A batch script POSTs one manifest
 * entry per book to this route. Unlike the IIIF/IA routes there is no remote
 * manifest to fetch — the page images are a flat array of hotlinked URLs.
 *
 * POST /api/import/museumsofindia
 * Body (a manifest entry):
 * {
 *   recordIdentifier: string,   // stable source id, e.g. "nat_del-C-A-A-M-595-4834"
 *   museum: string,             // e.g. "National Museum, New Delhi"
 *   object_type: string,        // "Manuscript" | "Farman" | ...
 *   title: string,
 *   author?: string,
 *   language?: string,
 *   script?: string,
 *   period?: string,
 *   subject?: string,
 *   description?: string,
 *   images: string[],           // ordered page image URLs
 *   accession?: string,
 *   collections?: string[],     // Source Library collection slugs
 *   work_id?: string
 * }
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      recordIdentifier,
      museum,
      object_type,
      title,
      author,
      language,
      script,
      period,
      subject,
      description,
      images,
      accession,
      collections: requestCollections,
      work_id,
    } = body;

    if (!recordIdentifier || !title || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: recordIdentifier, title, images[] (non-empty)' },
        { status: 400 }
      );
    }

    const pageCount = images.length;
    const db = await getDb();

    // Cross-source dedup check. The source fingerprint is keyed on the
    // museumsofindia recordIdentifier so re-running an import is a no-op.
    const gate = await acquisitionGate(db, {
      title,
      author,
      display_title: title,
      year: period ? (publishedToYear(period) ?? undefined) : undefined,
      published: period,
      image_source: {
        provider: 'museumsofindia',
        identifier: recordIdentifier,
        source_url: `https://museumsofindia.gov.in/repository/record/${recordIdentifier}`,
      },
    }, { importer: 'api:museumsofindia' });
    if (!gate.ok) {
      const best = gate.matches[0];
      return NextResponse.json(
        { error: gate.message, existingId: best?.matchedBookId ?? null, reason: gate.reason, evidence: gate.evidence, matches: gate.matches },
        { status: 409 }
      );
    }

    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await generateUniqueBookSlug(db, title, author, title);

    // Resolve manifestation language from the museum's own metadata.
    const lang = resolveLanguage({
      callerLanguage: language || null,
      sourceSignals: language ? [{ value: language, source: 'museumsofindia_metadata' }] : [],
    });
    const dateRes = resolveDate({
      callerPublished: period,
      callerYear: period ? publishedToYear(period) : undefined,
    });

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      author: author || 'Unknown',
      language: lang.language,
      ...(lang.original_language ? { original_language: lang.original_language } : {}),
      ...(lang.is_translation ? { is_translation: true } : {}),
      ...(lang.language_review ? { language_review: true } : {}),
      field_provenance: { language: lang.provenance },
      published: dateRes.published || period || 'Unknown',
      ...(publishedToYear(dateRes.published || period) !== null ? { year: publishedToYear(dateRes.published || period)! } : {}),
      categories: object_type ? [object_type] : [],
      ...(requestCollections?.length ? { collections: requestCollections } : {}),
      ...(work_id ? { work_id } : {}),
      thumbnail: images[0] || '',
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: {
        dc_identifier: [`MUSEUMSOFINDIA:${recordIdentifier}`],
        dc_source: `https://museumsofindia.gov.in/repository/record/${recordIdentifier}`,
        ...(description ? { dc_description: description } : {}),
        ...(subject ? { dc_subject: subject } : {}),
      },
      catalog_metadata: {
        source: 'museumsofindia',
        record_identifier: recordIdentifier,
        museum,
        object_type,
        accession,
        script,
        period,
        subject,
        description,
      },
      image_source: {
        provider: 'museumsofindia',
        provider_name: museum || 'Museums of India',
        source_url: `https://museumsofindia.gov.in/repository/record/${recordIdentifier}`,
        identifier: recordIdentifier,
        accession,
        license: 'unknown',
        access_date: new Date(),
      },
      status: 'draft',
      hidden: true, visible: false,
      // museumsofindia hosts only a handful of page images per object (usually
      // 2-3) where the physical manuscript has many more. Mark every import as a
      // preview/partial scan so the "Preview" badge shows once the book is
      // promoted public. Cleared if/when a fuller scan is added.
      preview: true,
      source_fingerprint: `museumsofindia:${recordIdentifier}`,
      source_fingerprints: gate.fingerprints,
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author || 'Unknown'),
      created_at: new Date(),
      updated_at: new Date()
    };

    applyTextRole(bookDoc as Record<string, unknown>);
    await db.collection('books').insertOne(bookDoc);
    await confirmClaims(db, gate.fingerprints, bookIdStr);

    // Create pages
    const pageDocs = [];
    for (let i = 0; i < pageCount; i++) {
      const pageId = new ObjectId();
      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: i + 1,
        photo: images[i],
        thumbnail: images[i],
        photo_original: images[i],
        created_at: new Date(),
        updated_at: new Date()
      });
    }
    await db.collection('pages').insertMany(pageDocs);

    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pageDocs.length,
      metadata: { provider: 'museumsofindia', identifier: recordIdentifier, object_type },
    });

    // Queue split detection (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : request.headers.get('origin') || 'http://localhost:3000';
    fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, { method: 'GET' })
      .catch(() => console.log(`[Import] Split check queued for ${bookIdStr}`));

    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      object_type,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      message: `Created book with ${pageDocs.length} pages from ${museum || 'Museums of India'}.`
    });

  } catch (error) {
    console.error('Museumsofindia Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
