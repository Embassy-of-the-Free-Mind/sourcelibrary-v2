import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';

export const maxDuration = 120;

interface LOCFileVariant {
  height?: number;
  width?: number;
  mimetype?: string;
  url?: string;
  info?: string;
  size?: number;
  levels?: number;
}

interface LOCResource {
  caption?: string;
  image?: string;
  url?: string;
  files?: LOCFileVariant[][];
}

interface LOCItem {
  id?: string;
  title?: string;
  other_title?: string[];
  translated_title?: string[];
  contributor_names?: string[];
  date?: string;
  created_published?: string[];
  language?: string[];
  description?: string[];
  summary?: string[];
  notes?: string[];
  subject_headings?: string[];
  medium?: string[];
  call_number?: string[];
  rights?: string[];
  digitized?: boolean;
  access_restricted?: boolean;
  library_of_congress_control_number?: string;
}

interface LOCResponse {
  item?: LOCItem;
  resources?: LOCResource[];
}

/**
 * Pick the best image URL from a page's format variants.
 * Prefers the largest JPEG for display. Falls back to any available URL.
 */
function pickBestImage(variants: LOCFileVariant[]): { photo: string; thumbnail: string } {
  if (!variants || variants.length === 0) return { photo: '', thumbnail: '' };

  // Sort JPEGs by height descending — pick the largest for photo
  const jpegs = variants
    .filter(v => v.mimetype === 'image/jpeg' && v.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  // For photo: use the largest JPEG (full res), or the IIIF info endpoint to construct a URL
  let photo = '';
  let thumbnail = '';

  if (jpegs.length > 0) {
    photo = jpegs[0].url!;
    // Thumbnail: use a smaller JPEG if available, otherwise the same
    thumbnail = jpegs.length > 2 ? jpegs[2].url! : jpegs[jpegs.length - 1].url!;
  }

  // If we have a JP2 with an info endpoint, we can construct IIIF URLs
  const jp2 = variants.find(v => v.mimetype === 'image/jp2' && v.info);
  if (jp2?.info) {
    // IIIF Image API — construct from info endpoint base
    const iiifBase = jp2.info.replace(/\/info\.json$/, '');
    photo = `${iiifBase}/full/1000,/0/default.jpg`;
    thumbnail = `${iiifBase}/full/200,/0/default.jpg`;
  }

  // Fallback to any URL
  if (!photo) {
    const any = variants.find(v => v.url);
    if (any?.url) {
      photo = any.url;
      thumbnail = any.url;
    }
  }

  return { photo, thumbnail };
}

/**
 * Extract author name from LOC contributor_names (strips role suffixes)
 */
function extractAuthor(contributorNames?: string[]): string {
  if (!contributorNames?.length) return 'Unknown';
  // LOC appends role: "Song, Yingxing, born 1587 Author"
  const raw = contributorNames[0];
  return raw
    .replace(/\s+(Author|Editor|Compiler|Illustrator|Engraver|Translator|Commentator|Contributor)$/i, '')
    .trim();
}

/**
 * Import a book from the Library of Congress digital collections.
 *
 * POST /api/import/loc
 * Body: {
 *   lccn: string,           // Library of Congress Control Number (e.g., "2012402109")
 *   title?: string,         // Override title (otherwise extracted from LOC metadata)
 *   display_title?: string, // Optional display title
 *   author?: string,        // Override author
 *   language?: string,      // Override language (e.g., "Chinese")
 *   published?: string,     // Override published date
 *   categories?: string[],  // Book categories
 *   start_page?: number,    // 1-indexed start page (for partial import)
 *   end_page?: number       // 1-indexed end page (inclusive)
 * }
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { lccn, title, display_title, author, language, published, categories, work_id, start_page, end_page } = body;

    if (!lccn) {
      return NextResponse.json(
        { error: 'Missing required field: lccn (Library of Congress Control Number)' },
        { status: 400 }
      );
    }

    // Fetch LOC item JSON
    const locUrl = `https://www.loc.gov/item/${lccn}/?fo=json`;
    const locRes = await fetch(locUrl, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
        'Accept': 'application/json',
      },
    });

    if (!locRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch LOC item: ${locRes.status} ${locRes.statusText}`, url: locUrl },
        { status: 400 }
      );
    }

    const locData: LOCResponse = await locRes.json();
    const item = locData.item;
    const resources = locData.resources;

    if (!item) {
      return NextResponse.json({ error: 'No item data in LOC response' }, { status: 400 });
    }

    if (!resources || resources.length === 0) {
      return NextResponse.json({ error: 'No digitized resources found for this LOC item' }, { status: 400 });
    }

    if (item.access_restricted) {
      return NextResponse.json({ error: 'This LOC item has access restrictions' }, { status: 403 });
    }

    // Flatten all pages across volumes/sections
    const allPages: { photo: string; thumbnail: string; section?: string }[] = [];
    for (const resource of resources) {
      if (!resource.files) continue;
      for (const pageVariants of resource.files) {
        const images = pickBestImage(pageVariants);
        if (images.photo) {
          allPages.push({ ...images, section: resource.caption });
        }
      }
    }

    if (allPages.length === 0) {
      return NextResponse.json({ error: 'No page images found in LOC resources' }, { status: 400 });
    }

    // Support page range extraction
    const startIdx = start_page ? Math.max(0, start_page - 1) : 0;
    const endIdx = end_page ? Math.min(allPages.length, end_page) : allPages.length;
    const selectedPages = allPages.slice(startIdx, endIdx);
    const pageCount = selectedPages.length;

    // Extract metadata from LOC item
    const bookTitle = title || item.other_title?.[0] || item.title || 'Unknown';
    const bookAuthor = author || extractAuthor(item.contributor_names);
    const bookLanguage = language || (item.language?.[0] ? capitalize(item.language[0]) : 'Unknown');
    const bookPublished = published || item.date || 'Unknown';
    const bookDescription = item.description?.[0] || item.summary?.[0] || '';

    const db = await getDb();

    // Check for duplicates
    const existing = await db.collection('books').findOne({
      'image_source.identifier': lccn,
      'image_source.provider': 'loc',
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
    const sourceUrl = `https://www.loc.gov/item/${lccn}/`;

    const slug = await generateUniqueBookSlug(db, bookTitle, bookAuthor, display_title);

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      tenant_id: 'default',
      title: bookTitle,
      display_title: display_title || null,
      author: bookAuthor,
      language: bookLanguage,
      published: bookPublished,
      categories: categories || [],
      ...(work_id ? { work_id } : {}),
      loc_lccn: lccn,
      thumbnail: selectedPages[0]?.thumbnail || '',
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      description: bookDescription,
      dublin_core: {
        dc_identifier: [`LOC:${lccn}`],
        dc_source: sourceUrl,
      },
      image_source: {
        provider: 'loc',
        provider_name: 'Library of Congress',
        source_url: sourceUrl,
        identifier: lccn,
        license: 'publicdomain',
        license_url: null,
        attribution: 'Library of Congress',
        access_date: new Date(),
        ...(start_page || end_page ? { page_range: `${startIdx + 1}-${endIdx}` } : {}),
      },
      status: 'draft',
      pipeline_auto: {
        status: 'queued',
        source: 'import',
        queued_at: new Date(),
        last_updated: new Date(),
        retry_count: 0,
      },
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
        photo: selectedPages[i].photo,
        thumbnail: selectedPages[i].thumbnail,
        photo_original: selectedPages[i].photo,
        ocr: {
          language: bookLanguage,
          model: null,
          data: '',
        },
        translation: {
          language: 'English',
          model: null,
          data: '',
        },
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: bookTitle,
      pages_affected: pageDocs.length,
      metadata: { provider: 'loc', identifier: lccn },
    });

    // Queue split detection (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : request.headers.get('origin') || 'http://localhost:3000';

    fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, {
      method: 'GET',
    }).catch(() => {
      console.log(`[LOC Import] Split check queued for ${bookIdStr}`);
    });

    // Kick off image archiving (non-blocking)
    fetch(`${baseUrl}/api/books/${bookIdStr}/archive-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 50 }),
    }).catch(() => {
      console.log(`[LOC Import] Archive kick-off queued for ${bookIdStr}`);
    });

    // Notify search engines (non-blocking)
    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title: bookTitle,
      author: bookAuthor,
      language: bookLanguage,
      published: bookPublished,
      provider: 'Library of Congress',
      pagesCreated: pageDocs.length,
      totalAvailable: allPages.length,
      bookUrl: `/book/${bookIdStr}`,
      sourceUrl,
      splitCheckQueued: true,
      message: `Imported ${pageDocs.length} pages from Library of Congress (LCCN: ${lccn}).`,
    });

  } catch (error) {
    console.error('LOC Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
