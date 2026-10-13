import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { Document } from 'mongodb';
import { getDb, getReadDb } from '@/lib/mongodb';
import { plantError, shouldPlant } from '@/lib/review-plants';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { nextCandidate } from '@/lib/review-candidates';
import { isValidVolunteerId } from '@/lib/review-queue';
import { getPageImageUrl, type PageImageFields } from '@/lib/page-image-url';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { supabaseAdmin } from '@/lib/supabase';
import { contentHash } from '@/lib/write-provenance';

export const maxDuration = 15;

const SITE = 'https://sourcelibrary.org';
/** One page per call is read in a chat window; past this the text is cut and the page says so. */
const MAX_TEXT = 8000;
/** How much of the previous page travels with each page, so the join can be checked. */
const TAIL = 400;
/** Scan width for the model: legible abbreviations, and under the MCP 1MB inline cap. */
const SCAN_WIDTH = 1600;
const SCAN_QUALITY = 80;

const PAGE_PROJECTION = {
  id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1,
  photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1,
  display_photo: 1, image_thumb: 1, thumbnail: 1, split_from_spread: 1, crop: 1,
};

const HAS_TEXT = { 'ocr.data': { $type: 'string', $ne: '' }, 'translation.data': { $type: 'string', $ne: '' } };

function abs(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('/') ? `${SITE}${url}` : url;
}

/** Scan candidates, best first: a resized copy of the source, then the display size. */
function scanUrls(page: PageImageFields): string[] {
  const source = getPageImageUrl(page, 'original');
  const display = abs(getPageImageUrl(page, 'display'));
  const urls: string[] = [];
  if (source && /^https?:\/\//.test(source)) {
    urls.push(`${SITE}/api/image?url=${encodeURIComponent(source)}&w=${SCAN_WIDTH}&q=${SCAN_QUALITY}`);
  }
  if (display) urls.push(display);
  return urls;
}

/** Where this volunteer's last book run stopped, from their own submitted reviews. */
async function lastRunPosition(volunteerId: string): Promise<{ book: string; page: number } | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('volunteer_ratings')
    .select('detail')
    .eq('volunteer_id', volunteerId)
    .eq('queue', 'book-run')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const d = data[0].detail as { book_id?: string; page_number?: number } | null;
  return d?.book_id && typeof d.page_number === 'number' ? { book: d.book_id, page: d.page_number } : null;
}

/**
 * The English to serve: the stored text, or on a test page (#6682) the stored text with one
 * planted error, recorded in `review_plants` so the review and any fix can be scored. A plant
 * that cannot be recorded is not served: an unscored wrong page would only mislead.
 */
async function servedTranslation(volunteerId: string, page: Document, bookId: string, raw: string): Promise<string> {
  const pageId = String(page.id);
  if (!shouldPlant(volunteerId, pageId)) return raw;
  const plant = plantError(raw, volunteerId, pageId);
  if (!plant) return raw;
  const plantedHash = contentHash(plant.planted_text);
  try {
    const db = await getDb();
    const now = new Date();
    await db.collection('review_plants').updateOne(
      { volunteer_id: volunteerId, page_id: pageId, planted_hash: plantedHash },
      {
        $setOnInsert: {
          id: plantedHash, version: 'plant-v1', book_id: bookId, page_number: page.page_number ?? null,
          field: 'translation', kind: plant.kind, original: plant.original, planted: plant.planted, at: plant.at,
          base_hash: contentHash(raw), planted_text: plant.planted_text, created_at: now,
        },
        $set: { last_served_at: now },
        $inc: { served: 1 },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('[book-run] plant not recorded, serving the real page:', err);
    return raw;
  }
  return plant.planted_text;
}

/**
 * GET /api/review/book-run?volunteer_id=&language=&book=&after=&fresh=
 *
 * A model-operated review shift (#6418, .claude/docs/volunteer-shifts-design.md):
 * ONE page of ONE book per call, walked in order. The volunteer's own Claude reads
 * the scan and both texts and records what it finds; the person runs it and says
 * "continue". The MCP tools start_review_shift / continue_review_shift call this.
 *
 *  - `book` (id, slug or reader URL) + `after` (a page_number): the next page with
 *    both a transcription and an English translation after `after`.
 *  - `book` alone: from the start of that book.
 *  - neither: resume this volunteer's last run, else start a new one at a page
 *    drawn from the translation-check pool (in `language` if given), so runs
 *    spread over the books the pool already samples.
 *
 * Every page carries the last lines of the previous page (`previous_page_tail`),
 * because text carried across a page join is a defect only a reader of both
 * pages can see, and `text_version` (the stored texts' contentHash) so a review
 * or correction stays bound to the text it judged. Engine and model are not
 * returned: the reviewer judges the text, not its maker.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const given = params.get('volunteer_id')?.trim() || '';
  if (given && !isValidVolunteerId(given)) {
    return NextResponse.json({ error: 'invalid volunteer_id' }, { status: 400 });
  }
  const volunteerId = given || randomUUID();
  const language = params.get('language')?.trim() || undefined;
  // A reader URL works as well as an id or slug: /book/<ref>/page/<id>.
  let bookRef = params.get('book')?.trim() || '';
  const fromUrl = bookRef.match(/\/book\/([^/?#]+)/);
  if (fromUrl) bookRef = decodeURIComponent(fromUrl[1]);
  const afterParam = params.get('after');
  let after = afterParam != null && afterParam !== '' ? Number(afterParam) : null;
  if (after != null && !Number.isFinite(after)) {
    return NextResponse.json({ error: 'after must be a page number' }, { status: 400 });
  }

  const db = await getReadDb();
  let resumed = false;

  // `fresh=1` asks for a new book instead of resuming the last run.
  if (!bookRef && given && params.get('fresh') !== '1') {
    const last = await lastRunPosition(volunteerId);
    if (last) {
      bookRef = last.book;
      after = last.page;
      resumed = true;
    }
  }

  // No book named and nothing to resume: start where the pool has a page waiting.
  if (!bookRef) {
    const result = await nextCandidate('translation-check', volunteerId, { language });
    if (!result.item) {
      return NextResponse.json({
        volunteer_id: volunteerId,
        page: null,
        message: result.message ?? 'No books are waiting in this language right now. Try another language, or name a book.',
      });
    }
    const pageId = result.item.item_id.split(':').slice(2).join(':');
    const start = await db.collection('pages').findOne({ id: pageId }, { projection: { book_id: 1, page_number: 1 } });
    if (!start) return NextResponse.json({ error: 'pool page not found' }, { status: 404 });
    bookRef = String(start.book_id);
    // Start two pages before the pool page, so it is read with its context.
    after = typeof start.page_number === 'number' ? start.page_number - 3 : null;
  }

  const found = await findBookByIdOrSlug(db, bookRef, {
    id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1, visible: 1,
  });
  const book = found?.book;
  // Hidden books (rights screen, containment hold) are never served through a side door.
  if (!book || book.visible !== true) {
    return NextResponse.json({ error: 'book not found or not open for review' }, { status: 404 });
  }
  const bookKeys = [...new Set([book.id, String(book._id)].filter(Boolean).map(String))];
  const inBook: Document = { book_id: { $in: bookKeys } };

  const pages = db.collection('pages');
  const page = await pages.findOne(
    { ...inBook, ...HAS_TEXT, ...(after != null ? { page_number: { $gt: after } } : {}) },
    { sort: { page_number: 1 }, projection: PAGE_PROJECTION },
  );
  const bookUrl = `${SITE}/book/${book.slug ?? book.id ?? book._id}`;
  const run = {
    book_id: String(book.id ?? book._id),
    book_title: book.display_title || book.title || null,
    author: book.author ?? null,
    published: book.published ?? null,
    language: book.language ?? language ?? null,
    book_url: bookUrl,
  };

  if (!page) {
    return NextResponse.json({
      volunteer_id: volunteerId,
      run,
      page: null,
      message: after != null
        ? 'That was the last page of this book with both a transcription and a translation. Start another book, or stop here.'
        : 'This book has no pages with both a transcription and a translation yet.',
    });
  }

  const [previous, pagesWithText, laterWithText] = await Promise.all([
    pages.findOne(
      { ...inBook, page_number: { $lt: page.page_number } },
      { sort: { page_number: -1 }, projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
    ),
    pages.countDocuments({ ...inBook, ...HAS_TEXT }),
    pages.countDocuments({ ...inBook, ...HAS_TEXT, page_number: { $gt: page.page_number } }),
  ]);

  const clip = (s: string) => (s.length > MAX_TEXT ? { text: s.slice(0, MAX_TEXT), truncated: true } : { text: s, truncated: false });
  const tail = (s: unknown) => {
    const t = typeof s === 'string' ? stripEditorialWrappers(s).trim() : '';
    return t ? t.slice(-TAIL) : null;
  };
  const ocrRaw = page.ocr.data as string;
  const trRaw = await servedTranslation(volunteerId, page, run.book_id, page.translation.data as string);
  const transcription = clip(stripEditorialWrappers(ocrRaw).trim());
  const translation = clip(stripEditorialWrappers(trRaw).trim());
  const itemLanguage = (typeof book.language === 'string' && book.language) || language || 'unknown';

  return NextResponse.json({
    volunteer_id: volunteerId,
    resumed,
    run: { ...run, pages_with_text: pagesWithText, pages_left_after_this: laterWithText },
    page: {
      item_id: `trans:${itemLanguage}:${page.id}`,
      page_number: page.page_number ?? null,
      reader_url: `${bookUrl}/page/${page.id}`,
      scan_urls: scanUrls(page as PageImageFields),
      transcription: transcription.text,
      translation: translation.text,
      ...(transcription.truncated || translation.truncated
        ? { truncated_note: `Text over ${MAX_TEXT} characters was cut here; open reader_url for the full page.` }
        : {}),
      previous_page_tail: previous
        ? { page_number: previous.page_number ?? null, transcription: tail(previous.ocr?.data), translation: tail(previous.translation?.data) }
        : null,
      text_version: { ocr: contentHash(ocrRaw), translation: contentHash(trRaw) },
    },
    next: { book: run.book_id, after: page.page_number },
  });
}
