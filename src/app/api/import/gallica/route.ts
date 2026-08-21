import { NextRequest, NextResponse } from 'next/server';
import { applyTextRole } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';
import { normalizeTitle, normalizeAuthor, sourceFingerprint, checkDuplicate } from '@/lib/dedup';
import { resolveLanguage, publishedToYear } from '@/lib/resolve-language';

export const maxDuration = 300;

interface IIIFManifest {
  label?: string;
  description?: string;
  license?: string | string[];
  attribution?: string | Array<{ '@value'?: string; '@language'?: string }>;
  sequences?: Array<{
    canvases?: Array<{
      images?: Array<{
        resource?: {
          '@id'?: string;
        };
      }>;
    }>;
  }>;
}

/**
 * Import a book from Gallica (BnF) via IIIF
 *
 * POST /api/import/gallica
 * Body: {
 *   ark: string,           // e.g., "bpt6k61073880" (Gallica ARK identifier)
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
      ark,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
    } = body;

    if (!ark || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ark, title, author' },
        { status: 400 }
      );
    }

    // Fetch IIIF manifest from Gallica
    const manifestUrl = `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/manifest.json`;
    const manifestRes = await fetch(manifestUrl, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
        'Accept': 'application/json, application/ld+json',
        'Referer': 'https://gallica.bnf.fr/',
      }
    });

    if (!manifestRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Gallica manifest: ${manifestRes.status}` },
        { status: 400 }
      );
    }

    const manifest: IIIFManifest = await manifestRes.json();

    // Get page count from IIIF canvases
    const canvases = manifest.sequences?.[0]?.canvases || [];
    const pageCount = canvases.length;

    if (pageCount === 0) {
      return NextResponse.json(
        { error: 'No pages found in IIIF manifest' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check if book already exists
    const existing = await db.collection('books').findOne({
      $or: [
        { gallica_ark: ark },
        { 'dublin_core.dc_identifier': `GALLICA:${ark}` }
      ]
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Cross-source dedup check
    const dedupResult = await checkDuplicate(db, {
      title, author, display_title, gallica_ark: ark, published,
      image_source: { provider: 'gallica', identifier: ark, iiif_manifest: manifestUrl, source_url: `https://gallica.bnf.fr/ark:/12148/${ark}` },
    });
    if (dedupResult.isDuplicate) {
      const best = dedupResult.matches[0];
      return NextResponse.json(
        { error: `Duplicate detected (${best.matchType}): matches "${best.matchedTitle}"`, existingId: best.matchedBookId, matches: dedupResult.matches },
        { status: 409 }
      );
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // Gallica IIIF image URL pattern — native resolution (typically 3000-5000px).
    // Archive script downscales for display; we want the full source for posterity.
    const getPageImageUrl = (pageNum: number) =>
      `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f${pageNum + 1}/full/full/0/default.jpg`;

    const getThumbnailUrl = (pageNum: number) =>
      `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f${pageNum + 1}/full/200,/0/default.jpg`;

    // Extract license URL from manifest
    const licenseUrl = Array.isArray(manifest.license)
      ? manifest.license[0]
      : manifest.license || null;

    // Extract attribution from manifest (prefer English)
    let attribution: string | null = null;
    if (typeof manifest.attribution === 'string') {
      attribution = manifest.attribution;
    } else if (Array.isArray(manifest.attribution)) {
      const englishAttr = manifest.attribution.find(a => a['@language'] === 'en');
      attribution = englishAttr?.['@value'] || manifest.attribution[0]?.['@value'] || null;
    }

    const slug = await generateUniqueBookSlug(db, title, author, display_title);

    // #2185: normalise the caller's language and stamp provenance. Gallica IIIF v2
    // manifests don't expose a reliable structured language field, so the caller
    // is the only signal here — but normalised and attributed rather than raw.
    const lang = resolveLanguage({ callerLanguage: language });

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      display_title: display_title || null,
      author,
      language: lang.language,
      ...(lang.original_language ? { original_language: lang.original_language } : {}),
      field_provenance: { language: lang.provenance },
      published: published || 'Unknown',
      ...(publishedToYear(published) !== null ? { year: publishedToYear(published)! } : {}),
      categories: categories || [],
      ...(work_id ? { work_id } : {}),
      gallica_ark: ark,
      thumbnail: getThumbnailUrl(0),
      pageCount,
      pages_count: pageCount,
      dublin_core: {
        dc_identifier: [`GALLICA:${ark}`],
        dc_source: `https://gallica.bnf.fr/ark:/12148/${ark}`
      },
      image_source: {
        provider: 'gallica',
        provider_name: 'Gallica (Bibliothèque nationale de France)',
        source_url: `https://gallica.bnf.fr/ark:/12148/${ark}`,
        iiif_manifest: manifestUrl,
        identifier: ark,
        license: licenseUrl || 'publicdomain',
        license_url: licenseUrl,
        attribution: attribution,
        access_date: new Date(),
      },
      status: 'draft',
      hidden: true, visible: false,
      source_fingerprint: sourceFingerprint({ gallica_ark: ark }),
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      created_at: new Date(),
      updated_at: new Date()
    };

    // Classify original-vs-translation at import (issue #2395).
    applyTextRole(bookDoc as Record<string, unknown>);
    await db.collection('books').insertOne(bookDoc);

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
      metadata: { provider: 'gallica', identifier: ark },
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
      gallica_ark: ark,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      gallicaUrl: `https://gallica.bnf.fr/ark:/12148/${ark}`,
      splitCheckQueued: true,
      message: `Created book with ${pageDocs.length} pages from Gallica. Split detection queued.`
    });

  } catch (error) {
    console.error('Gallica Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
