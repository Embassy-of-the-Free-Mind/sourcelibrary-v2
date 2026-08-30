import { NextRequest, NextResponse } from 'next/server';
import { applyTextRole } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { publishedToYear } from '@/lib/resolve-language';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';
import { normalizeTitle, normalizeAuthor, sourceFingerprint } from '@/lib/dedup';
import { acquisitionGate, confirmClaims } from '@/lib/acquisition-guard';

export const maxDuration = 300;

interface WellcomeWork {
  id: string;
  title: string;
  alternativeTitles?: Array<{ title: string }>;
  contributors?: Array<{ agent: { label: string }; roles?: Array<{ label: string }> }>;
  production?: Array<{ dates?: Array<{ label: string }> }>;
  languages?: Array<{ label: string }>;
  subjects?: Array<{ label: string }>;
  items?: Array<{
    locations?: Array<{
      url?: string;
      locationType?: { id: string };
      license?: { id: string; url: string };
    }>;
  }>;
}

interface IIIFManifest {
  '@type'?: string;
  label?: string | { '@value'?: string }[];
  description?: string | { '@value'?: string }[];
  license?: string;
  attribution?: string;
  // Multi-copy works return a sc:Collection wrapping one manifest per copy
  manifests?: Array<{ '@id'?: string; label?: string }>;
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

/**
 * Import a book from Wellcome Collection via IIIF
 *
 * POST /api/import/wellcome
 * Body: {
 *   work_id: string,        // Wellcome work ID (e.g., "pqusmy2a")
 *   title?: string,         // Override title
 *   author?: string,        // Override author
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   collections?: string[]  // Source Library collection slugs to tag the book with
 * }
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      work_id,
      title: titleOverride,
      author: authorOverride,
      language: languageOverride,
      published: publishedOverride,
      year,
      categories,
      collections: requestCollections,
    } = body;

    if (!work_id) {
      return NextResponse.json(
        { error: 'Missing required field: work_id' },
        { status: 400 }
      );
    }

    // Fetch work details from Wellcome Catalogue API
    const workRes = await fetch(
      // `languages`, `subjects` and `production` must be requested explicitly —
      // the Wellcome API omits them otherwise, so the language/categories/date
      // fallbacks below silently resolved to 'Unknown' on every import (#4311).
      `https://api.wellcomecollection.org/catalogue/v2/works/${work_id}?include=items,languages,subjects,production,contributors`
    );

    if (!workRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Wellcome work: ${workRes.status}` },
        { status: 400 }
      );
    }

    const work: WellcomeWork = await workRes.json();

    // Find IIIF presentation URL
    const iiifLocation = work.items
      ?.flatMap(item => item.locations || [])
      .find(loc => loc.locationType?.id === 'iiif-presentation');

    if (!iiifLocation?.url) {
      return NextResponse.json(
        { error: 'No IIIF presentation available for this work' },
        { status: 400 }
      );
    }

    let manifestUrl = iiifLocation.url;

    // Fetch IIIF manifest
    const fetchManifest = async (url: string): Promise<IIIFManifest | NextResponse> => {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
          'Accept': 'application/json, application/ld+json',
        }
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to fetch IIIF manifest: ${res.status}` },
          { status: 400 }
        );
      }
      return res.json();
    };

    let manifest = await fetchManifest(manifestUrl);
    if (manifest instanceof NextResponse) return manifest;

    // Works with multiple physical copies return a sc:Collection whose
    // manifests[] holds one manifest per copy (e.g. b10005766 → b10005766_0001
    // "Copy 1"). Follow the first copy's manifest. See issue #2437.
    if (manifest['@type'] === 'sc:Collection' && manifest.manifests?.length) {
      const copyUrl = manifest.manifests[0]['@id'];
      if (!copyUrl) {
        return NextResponse.json(
          { error: 'IIIF collection has no resolvable copy manifest' },
          { status: 400 }
        );
      }
      manifestUrl = copyUrl;
      manifest = await fetchManifest(manifestUrl);
      if (manifest instanceof NextResponse) return manifest;
    }

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
        { wellcome_id: work_id },
        { 'dublin_core.dc_identifier': `WELLCOME:${work_id}` }
      ]
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Extract metadata from work
    const title = titleOverride || work.title || 'Untitled';
    const author = authorOverride ||
      work.contributors?.find(c => c.roles?.some(r => r.label === 'author'))?.agent.label ||
      work.contributors?.[0]?.agent.label ||
      'Unknown';
    const published = publishedOverride ||
      work.production?.[0]?.dates?.[0]?.label ||
      'Unknown';
    const language = languageOverride ||
      work.languages?.[0]?.label ||
      'Unknown';

    // Cross-source dedup check
    const gate = await acquisitionGate(db, {
      title, author, year, published,
      image_source: { provider: 'wellcome', identifier: work_id, iiif_manifest: manifestUrl, source_url: `https://wellcomecollection.org/works/${work_id}` },
    }, { importer: 'api:wellcome' });
    if (!gate.ok) {
      const best = gate.matches[0];
      return NextResponse.json(
        { error: gate.message, existingId: best?.matchedBookId ?? null, reason: gate.reason, evidence: gate.evidence, matches: gate.matches },
        { status: 409 }
      );
    }

    // Extract license
    const licenseId = iiifLocation.license?.id || 'unknown';
    const licenseUrl = iiifLocation.license?.url || null;

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // Extract b-number from manifest URL for image construction
    // URL pattern: https://iiif.wellcomecollection.org/presentation/v2/b18709436
    const bNumberMatch = manifestUrl.match(/\/v2\/(b\d+)/);
    const bNumber = bNumberMatch?.[1];

    // Get image URLs from canvases
    const getPageImageUrl = (index: number) => {
      const canvas = canvases[index];
      const imageUrl = canvas?.images?.[0]?.resource?.service?.['@id'] ||
                       canvas?.images?.[0]?.resource?.['@id'];
      if (imageUrl) {
        // Use IIIF Image API at native resolution
        return `${imageUrl}/full/full/0/default.jpg`;
      }
      return null;
    };

    const getThumbnailUrl = (index: number) => {
      const canvas = canvases[index];
      const imageUrl = canvas?.images?.[0]?.resource?.service?.['@id'] ||
                       canvas?.images?.[0]?.resource?.['@id'];
      if (imageUrl) {
        return `${imageUrl}/full/200,/0/default.jpg`;
      }
      return null;
    };

    const slug = await generateUniqueBookSlug(db, title, author);

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      display_title: null,
      author,
      language,
      published,
      categories: categories || work.subjects?.map(s => s.label) || [],
      ...(publishedToYear(typeof year === 'number' ? year : published) !== null
        ? { year: publishedToYear(typeof year === 'number' ? year : published)! }
        : {}),
      ...(requestCollections?.length ? { collections: requestCollections } : {}),
      // NOTE: do NOT write the Wellcome id into `work_id` — that field is our
      // work-identity key (`kr:` / `local:` / `wikidata:` ids, see
      // .claude/docs/invariants/work-identity.md). Writing a provider id there
      // minted 8 bogus work identities before this was caught (#4311). The
      // provider id belongs in `wellcome_id` / `image_source.identifier` only.
      wellcome_id: work_id,
      wellcome_b_number: bNumber,
      thumbnail: getThumbnailUrl(0),
      pageCount,
      pages_count: pageCount,
      dublin_core: {
        dc_identifier: [`WELLCOME:${work_id}`],
        dc_source: `https://wellcomecollection.org/works/${work_id}`
      },
      image_source: {
        provider: 'wellcome',
        provider_name: 'Wellcome Collection',
        source_url: `https://wellcomecollection.org/works/${work_id}`,
        iiif_manifest: manifestUrl,
        identifier: work_id,
        license: licenseId,
        license_url: licenseUrl,
        attribution: 'Wellcome Collection',
        access_date: new Date(),
      },
      status: 'draft',
      hidden: true, visible: false,
      source_fingerprint: sourceFingerprint({ image_source: { provider: 'wellcome', identifier: work_id, iiif_manifest: manifestUrl } }),
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

    // Queue preview OCR for early metadata enrichment (non-blocking)
    queuePreviewOcr(bookIdStr, title).catch(() => {});

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pageDocs.length,
      metadata: { provider: 'wellcome', identifier: work_id },
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
      wellcome_id: work_id,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      wellcomeUrl: `https://wellcomecollection.org/works/${work_id}`,
      splitCheckQueued: true,
      message: `Created book with ${pageDocs.length} pages from Wellcome Collection. Split detection queued.`
    });

  } catch (error) {
    console.error('Wellcome Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
