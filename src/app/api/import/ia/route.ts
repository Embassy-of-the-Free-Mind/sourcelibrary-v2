import { NextRequest, NextResponse } from 'next/server';
import { applyTextRole } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';
import { normalizeTitle, normalizeAuthor, sourceFingerprint } from '@/lib/dedup';
import { acquisitionGate, confirmClaims } from '@/lib/acquisition-guard';
import { resolveLanguage, resolveDate, publishedToYear, type LanguageSignal } from '@/lib/resolve-language';

export const maxDuration = 300;

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
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      ia_identifier,
      title,
      display_title,
      author,
      language,
      original_language,
      published,
      year,
      categories,
      collections: requestCollections,
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

    // Check if this exact IA item already exists. Match only on same-item
    // identifiers — NOT on `title`, which collides across distinct editions
    // that share IA's publisher-supplied title (e.g. a 1728 vs 1730 printing).
    // Edition-aware title+author dedup happens in checkDuplicate() below.
    const existing = await db.collection('books').findOne({
      $or: [
        { ia_identifier },
        { 'dublin_core.dc_identifier': `IA:${ia_identifier}` }
      ]
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Cross-source dedup check
    const gate = await acquisitionGate(db, {
      title,
      author,
      display_title,
      year,
      published,
      ia_identifier,
      image_source: {
        provider: 'internet_archive',
        identifier: ia_identifier,
        source_url: `https://archive.org/details/${ia_identifier}`,
      },
    }, { importer: 'api:ia' });
    if (!gate.ok) {
      const best = gate.matches[0];
      return NextResponse.json(
        { error: gate.message, existingId: best?.matchedBookId ?? null, reason: gate.reason, evidence: gate.evidence, matches: gate.matches },
        { status: 409 }
      );
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // IA image URL pattern
    const getPageImageUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/full/0/default.jpg`;

    const getThumbnailUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/pct:15/0/default.jpg`;

    // Extract license from IA metadata
    const iaMetadata = metadata.metadata || {};
    const licenseUrl = iaMetadata.licenseurl || iaMetadata.license || null;
    const rights = iaMetadata.rights || iaMetadata.possible_copyright_status || null;
    const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim();
    const contributor = typeof iaMetadata.contributor === 'string' ? stripHtml(iaMetadata.contributor) : null;
    const sponsor = typeof iaMetadata.sponsor === 'string' ? stripHtml(iaMetadata.sponsor) : null;

    // Normalise fields that may arrive as string or array. IA frequently
    // wraps free-text fields (description, notes) in HTML — strip it so the
    // catalog_metadata holds clean plain text for display/search.
    const stripText = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const firstOf = (v: unknown): string | null => {
      const raw = Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : null) : (typeof v === 'string' ? v : null);
      return raw ? stripText(raw) || null : null;
    };
    const arrOf = (v: unknown): string[] => {
      const raw = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : (typeof v === 'string' ? [v] : []);
      return raw.map(stripText).filter(Boolean);
    };

    // Pull every field we might want downstream into catalog_metadata so the
    // book page can show provenance, ARK/OCLC/LCCN cross-refs, edition info,
    // and scanning provenance without re-fetching IA. Drops null/empty after.
    const iaCatalog: Record<string, unknown> = {
      source: 'internet_archive',
      identifier: ia_identifier,
      ark: iaMetadata['identifier-ark'] || null,
      mediatype: iaMetadata.mediatype || null,
      collections: arrOf(iaMetadata.collection),
      access_restricted: iaMetadata['access-restricted-item'] === 'true' || iaMetadata['access-restricted-item'] === true,
      publisher: firstOf(iaMetadata.publisher),
      place: firstOf(iaMetadata.publishplace) || firstOf(iaMetadata.place),
      creator: firstOf(iaMetadata.creator),
      edition: firstOf(iaMetadata.edition),
      volume: firstOf(iaMetadata.volume),
      description: firstOf(iaMetadata.description),
      subjects: arrOf(iaMetadata.subject),
      notes: arrOf(iaMetadata.notes),
      isbn: arrOf(iaMetadata.isbn),
      oclc_id: firstOf(iaMetadata['oclc-id']),
      lccn: firstOf(iaMetadata.lccn),
      openlibrary_work: firstOf(iaMetadata.openlibrary_work),
      openlibrary_edition: firstOf(iaMetadata.openlibrary_edition),
      external_identifiers: arrOf(iaMetadata['external-identifier']),
      page_progression: firstOf(iaMetadata['page-progression']),
      ppi: iaMetadata.ppi ? parseInt(String(iaMetadata.ppi), 10) : null,
      imagecount: iaMetadata.imagecount ? parseInt(String(iaMetadata.imagecount), 10) : null,
      ocr_detected_lang: firstOf(iaMetadata.ocr_detected_lang),
      ocr_detected_script: firstOf(iaMetadata.ocr_detected_script),
      date_iso: firstOf(iaMetadata.date),
      public_date: firstOf(iaMetadata.publicdate),
      scan_date: firstOf(iaMetadata.scandate),
      scanning_center: firstOf(iaMetadata.scanningcenter),
      scanner: firstOf(iaMetadata.scanner),
      scraped_at: new Date().toISOString(),
    };
    for (const k of Object.keys(iaCatalog)) {
      const v = iaCatalog[k];
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete iaCatalog[k];
    }

    const slug = await generateUniqueBookSlug(db, title, author, display_title);

    // #2185: resolve the MANIFESTATION language from IA's empirical signals
    // (what the scan actually is), not the caller's work-language hint. All
    // three IA signals below were already fetched at import and previously
    // ignored — see #2184. Order = most empirical first.
    const iaLangCollection = (Array.isArray(iaCatalog.collections) ? iaCatalog.collections : [])
      .map((c) => /^booksbylanguage_(.+)$/i.exec(String(c))?.[1])
      .find(Boolean) || null;
    const sourceSignals: LanguageSignal[] = [
      { value: iaCatalog.ocr_detected_lang as string, source: 'ia_ocr_detected' },
      { value: Array.isArray(iaMetadataRaw.language) ? iaMetadataRaw.language[0] : iaMetadataRaw.language, source: 'ia_metadata' },
      { value: iaLangCollection, source: 'ia_collection' },
    ];
    const lang = resolveLanguage({
      callerLanguage: language,
      callerOriginalLanguage: original_language,
      sourceSignals,
    });
    const dateRes = resolveDate({
      callerPublished: published,
      callerYear: year,
      sourceDate: (iaCatalog.date_iso as string) || iaMetadataRaw.date || null,
    });

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      display_title: display_title || null,
      author,
      language: lang.language,
      ...(lang.original_language ? { original_language: lang.original_language } : {}),
      ...(lang.is_translation ? { is_translation: true } : {}),
      ...(lang.language_review ? { language_review: true } : {}),
      published: dateRes.published || 'Unknown',
      ...(publishedToYear(dateRes.published) !== null ? { year: publishedToYear(dateRes.published)! } : {}),
      ...(dateRes.original_work_year ? { original_work_year: dateRes.original_work_year } : {}),
      field_provenance: { language: lang.provenance },
      categories: categories || [],
      ...(requestCollections?.length ? { collections: requestCollections } : {}),
      ...(work_id ? { work_id } : {}),
      ia_identifier,
      thumbnail: getThumbnailUrl(0),
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: dublin_core || {
        dc_identifier: [
          `IA:${ia_identifier}`,
          ...(iaCatalog.ark ? [String(iaCatalog.ark)] : []),
          ...(iaCatalog.oclc_id ? [`OCLC:${iaCatalog.oclc_id}`] : []),
          ...(iaCatalog.lccn ? [`LCCN:${iaCatalog.lccn}`] : []),
        ],
        dc_source: `https://archive.org/details/${ia_identifier}`,
        ...(iaCatalog.publisher ? { dc_publisher: iaCatalog.publisher } : {}),
        ...(iaCatalog.description ? { dc_description: iaCatalog.description } : {}),
        ...(iaCatalog.subjects && Array.isArray(iaCatalog.subjects) && iaCatalog.subjects.length
          ? { dc_subject: iaCatalog.subjects }
          : {}),
      },
      catalog_metadata: iaCatalog,
      ...(iaCatalog.place ? { place_published: String(iaCatalog.place) } : {}),
      ...(iaCatalog.publisher ? { publisher: String(iaCatalog.publisher) } : {}),
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
      hidden: true, visible: false,
      source_fingerprint: sourceFingerprint({ ia_identifier }),
      source_fingerprints: gate.fingerprints,
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      created_at: new Date(),
      updated_at: new Date()
    };

    // Classify original-vs-translation at import (issue #2395).
    applyTextRole(bookDoc as Record<string, unknown>);
    await db.collection('books').insertOne(bookDoc);
    // The claim now points at the row it produced, so it stops being
    // reclaimable and the acquisition ledger is joinable to `books`.
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
