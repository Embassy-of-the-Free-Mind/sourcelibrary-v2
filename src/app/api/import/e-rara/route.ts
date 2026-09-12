import { NextRequest, NextResponse } from 'next/server';
import { applyTextRole } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { publishedToYear } from '@/lib/resolve-language';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { normalizeTitle, normalizeAuthor, sourceFingerprint } from '@/lib/dedup';
import { acquisitionGate, confirmClaims } from '@/lib/acquisition-guard';
import { normalizeMarcAuthor } from '@/lib/marc-utils';

export const maxDuration = 300;

interface IIIFManifest {
  label?: string;
  description?: string;
  attribution?: string;
  license?: string;
  sequences?: Array<{
    canvases?: Array<{
      '@id'?: string;
      images?: Array<{
        resource?: {
          '@id'?: string;
          service?: {
            '@id'?: string;
          };
        };
      }>;
    }>;
  }>;
}

interface OAIMetadata {
  title?: string;
  creator?: string;
  date?: string;
  language?: string;
  rights?: string;
  doi?: string;
}

/**
 * Parse OAI-PMH Dublin Core XML response
 */
function parseOAIMetadata(xml: string): OAIMetadata {
  const getTag = (tag: string): string | undefined => {
    const match = xml.match(new RegExp(`<dc:${tag}>([^<]+)</dc:${tag}>`));
    return match?.[1];
  };

  // Get DOI from identifiers
  const doiMatch = xml.match(/<dc:identifier>doi:([^<]+)<\/dc:identifier>/);

  return {
    title: getTag('title'),
    creator: getTag('creator'),
    date: getTag('date'),
    language: getTag('language'),
    rights: getTag('rights'),
    doi: doiMatch?.[1],
  };
}

/**
 * Import a book from e-rara (Swiss rare books platform) via IIIF
 *
 * POST /api/import/e-rara
 * Body: {
 *   erara_id: string,        // e-rara numeric ID (e.g., "8962689") or DOI (e.g., "10.3931/e-rara-28119")
 *   title?: string,          // Override title
 *   author?: string,         // Override author
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      erara_id,
      title: titleOverride,
      author: authorOverride,
      language: languageOverride,
      published: publishedOverride,
      categories,
      work_id,
    } = body;

    if (!erara_id) {
      return NextResponse.json(
        { error: 'Missing required field: erara_id' },
        { status: 400 }
      );
    }

    // Normalize ID - extract numeric ID from DOI if provided
    let numericId = erara_id;
    let doi: string | undefined;

    if (erara_id.includes('10.3931/e-rara-')) {
      // Extract DOI and derive numeric ID (we'll get it from OAI)
      doi = erara_id.replace('doi:', '');
    } else if (erara_id.startsWith('e-rara-')) {
      // Handle "e-rara-28119" format
      doi = `10.3931/${erara_id}`;
    }

    // Fetch OAI metadata to get full record info and verify ID
    const oaiUrl = `https://www.e-rara.ch/oai?verb=GetRecord&identifier=oai:www.e-rara.ch:${numericId}&metadataPrefix=oai_dc`;
    const oaiRes = await fetch(oaiUrl);

    let metadata: OAIMetadata = {};
    if (oaiRes.ok) {
      const oaiXml = await oaiRes.text();
      if (!oaiXml.includes('<error code="idDoesNotExist">')) {
        metadata = parseOAIMetadata(oaiXml);
        if (metadata.doi) {
          doi = metadata.doi;
        }
      }
    }

    // Fetch IIIF manifest
    const manifestUrl = `https://www.e-rara.ch/i3f/v21/${numericId}/manifest`;
    const manifestRes = await fetch(manifestUrl, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
        'Accept': 'application/json, application/ld+json',
      }
    });

    if (!manifestRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch e-rara manifest: ${manifestRes.status}. Check if ID "${numericId}" is valid.` },
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
        { erara_id: numericId },
        { 'dublin_core.dc_identifier': `ERARA:${numericId}` },
        ...(doi ? [{ erara_doi: doi }] : [])
      ]
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Extract metadata. `author` is null when the source records the MARC
    // "sine nomine" sigil — we store null in the DB and pass a stable fallback
    // string to helpers that require a non-null author (slug, normalize, dedup).
    const title = titleOverride || metadata.title || manifest.label || 'Untitled';
    const author = normalizeMarcAuthor(authorOverride) ?? normalizeMarcAuthor(metadata.creator);
    const authorForLookup = author ?? 'Unknown';
    const published = publishedOverride || metadata.date || 'Unknown';
    const numericYear = publishedToYear(published);
    const language = languageOverride || metadata.language || 'Unknown';

    // Map language codes to full names
    const languageMap: Record<string, string> = {
      'ger': 'German',
      'lat': 'Latin',
      'fre': 'French',
      'ita': 'Italian',
      'eng': 'English',
      'dut': 'Dutch',
    };
    const languageFull = languageMap[language.toLowerCase()] || language;

    // Cross-source dedup check
    const gate = await acquisitionGate(db, {
      title, author: authorForLookup, published,
      image_source: { provider: 'e-rara', identifier: numericId, iiif_manifest: manifestUrl },
    }, { importer: 'api:e-rara' });
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

    // Get image URLs from canvases
    const getPageImageUrl = (index: number) => {
      const canvas = canvases[index];
      const serviceId = canvas?.images?.[0]?.resource?.service?.['@id'];
      if (serviceId) {
        return `${serviceId}/full/full/0/default.jpg`;
      }
      // Fallback to webcache (max-res variant)
      const canvasId = canvas?.['@id']?.split('/').pop();
      if (canvasId) {
        return `https://www.e-rara.ch/download/webcache/0/${canvasId}`;
      }
      return null;
    };

    const getThumbnailUrl = (index: number) => {
      const canvas = canvases[index];
      const serviceId = canvas?.images?.[0]?.resource?.service?.['@id'];
      if (serviceId) {
        return `${serviceId}/full/200,/0/default.jpg`;
      }
      const canvasId = canvas?.['@id']?.split('/').pop();
      if (canvasId) {
        return `https://www.e-rara.ch/download/webcache/200/${canvasId}`;
      }
      return null;
    };

    const sourceUrl = doi
      ? `https://www.e-rara.ch/doi/${doi}`
      : `https://www.e-rara.ch/content/titleinfo/${numericId}`;

    const slug = await generateUniqueBookSlug(db, title, authorForLookup);

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      display_title: null,
      author,
      language: languageFull,
      published,
      ...(numericYear !== null ? { year: numericYear } : {}),
      categories: categories || [],
      ...(work_id ? { work_id } : {}),
      erara_id: numericId,
      erara_doi: doi || null,
      thumbnail: getThumbnailUrl(0),
      pageCount,
      pages_count: pageCount,
      dublin_core: {
        dc_identifier: [`ERARA:${numericId}`, ...(doi ? [`DOI:${doi}`] : [])],
        dc_source: sourceUrl,
        dc_rights: metadata.rights || null,
      },
      image_source: {
        provider: 'e-rara',
        provider_name: 'e-rara (Swiss rare books)',
        source_url: sourceUrl,
        iiif_manifest: manifestUrl,
        identifier: numericId,
        doi: doi || null,
        license: metadata.rights || 'unknown',
        attribution: manifest.attribution || 'e-rara, the platform for digitized rare books from Swiss institutions',
        access_date: new Date(),
      },
      status: 'draft',
      hidden: true, visible: false,
      source_fingerprint: sourceFingerprint({ image_source: { provider: 'e-rara', identifier: numericId, iiif_manifest: manifestUrl } }),
      source_fingerprints: gate.fingerprints,
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(authorForLookup),
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
      const photoUrl = getPageImageUrl(i);
      const thumbUrl = getThumbnailUrl(i);

      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: i + 1,
        photo: photoUrl,
        thumbnail: thumbUrl,
        photo_original: photoUrl,
        // Don't initialize ocr/translation with empty strings -- they cause
        // false completion in job-completion.ts (see: translation loop bug fix)
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pageDocs.length,
      metadata: { provider: 'e-rara', identifier: numericId },
    });

    // Fire off split detection check (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : request.headers.get('origin') || 'http://localhost:3000';

    fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, {
      method: 'GET',
    }).catch(() => {
      console.log(`[Import] Split check queued for ${bookIdStr}`);
    });

    // Notify search engines of new book via IndexNow (non-blocking)
    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      author,
      erara_id: numericId,
      erara_doi: doi || null,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      eraraUrl: sourceUrl,
      splitCheckQueued: true,
      message: `Created book with ${pageDocs.length} pages from e-rara. Split detection queued.`
    });

  } catch (error) {
    console.error('e-rara Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
