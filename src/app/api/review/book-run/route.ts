import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { Collection, Document } from 'mongodb';
import { getDb, getReadDb } from '@/lib/mongodb';
import { plantError, shouldPlant } from '@/lib/review-plants';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { nextCandidate } from '@/lib/review-candidates';
import { isValidVolunteerId } from '@/lib/review-queue';
import { getPageImageUrl, type PageImageFields } from '@/lib/page-image-url';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { supabaseAdmin } from '@/lib/supabase';
import { contentHash } from '@/lib/write-provenance';
import { PAIRED_FIFTHS_VERSION, PAIRED_SKIP_PAGE_TYPES, pairedFifths, pairedReadingOrder, type PagePair } from '@/lib/paired-fifths';
import { isMeteredAnonRequest, meteredSignInResponse } from '@/lib/metered-gate';

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

/** The page numbers this volunteer has already reviewed in this book (a paired check resumes at the first gap). */
async function reviewedPages(volunteerId: string, bookKeys: string[]): Promise<Set<number>> {
  const done = new Set<number>();
  if (!supabaseAdmin) return done;
  const { data, error } = await supabaseAdmin
    .from('volunteer_ratings')
    .select('detail')
    .eq('volunteer_id', volunteerId)
    .eq('queue', 'book-run')
    .in('detail->>book_id', bookKeys)
    .limit(1000);
  if (error) {
    console.error('[book-run] could not read this volunteer\'s reviews; the paired check starts at its first page:', error.message);
    return done;
  }
  for (const r of data ?? []) {
    const n = (r.detail as { page_number?: unknown } | null)?.page_number;
    if (typeof n === 'number') done.add(n);
  }
  return done;
}

/**
 * The paired-fifths plan for a book (#8405): two adjacent pages from each fifth, 10 pages, 5 joins. A page is
 * eligible when it has both texts, is not hidden or split, and is not front matter, a plate or a blank (the #7866
 * page types). The seed is the book id, so every volunteer, and the Opus check, read the same pages of a book.
 */
async function pairedPlan(pages: Collection<Document>, inBook: Document, seedKey: string) {
  const [all, withText] = await Promise.all([
    pages.find(inBook, { projection: { _id: 0, page_number: 1, page_type: 1, hidden: 1, split_into: 1 } }).sort({ page_number: 1 }).toArray(),
    pages.find({ ...inBook, ...HAS_TEXT }, { projection: { _id: 0, page_number: 1 } }).toArray(),
  ]);
  const hasText = new Set(withText.map((p) => p.page_number));
  const draw = all
    .filter((p) => typeof p.page_number === 'number')
    .map((p) => ({
      page_number: p.page_number as number,
      eligible: hasText.has(p.page_number) && !p.hidden && !p.split_into && !PAIRED_SKIP_PAGE_TYPES.includes(p.page_type),
    }));
  const pairs = pairedFifths(draw, seedKey);
  return { pairs, order: pairedReadingOrder(pairs) };
}

/**
 * The English to serve: the stored text, or on a test page (#6682) the stored text with one
 * planted error, recorded in `review_plants` so the review and any fix can be scored. A plant
 * that cannot be recorded is not served: an unscored wrong page would only mislead.
 */
async function servedTranslation(volunteerId: string, page: Document, bookId: string, raw: string): Promise<string> {
  if (typeof page.id !== 'string' || !page.id) return raw;
  const pageId = page.id;
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
 * ONE page of ONE book per call. The volunteer's own Claude reads the scan and
 * both texts and records what it finds; the person runs it and says "continue".
 * The MCP tools start_review_shift / continue_review_shift call this.
 *
 * Two plans (#8405):
 *  - `plan=paired` (the default): the book's paired-fifths check, 10 pages as two
 *    adjacent pages from each fifth (src/lib/paired-fifths.ts), so one shift covers
 *    the whole book and checks five page joins. `step` indexes into it; without
 *    one, the first planned page this volunteer has not reviewed.
 *  - `plan=walk`: the book in order. `after` (a page_number) gives the next page
 *    with both texts after it; without one, from the start. A call with `after`
 *    and no `plan` is a walk, so chats from before #8405 carry on as they were.
 *  - no book: resume this volunteer's last run (paired if its last page is in the
 *    book's plan, else a walk), else a new book from the translation-check pool
 *    (in `language` if given), so runs spread over the books the pool samples.
 *
 * Every page carries the last lines of the previous page (`previous_page_tail`),
 * because text carried across a page join is a defect only a reader of both
 * pages can see, and `text_version` (the stored texts' contentHash) so a review
 * or correction stays bound to the text it judged. Engine and model are not
 * returned: the reviewer judges the text, not its maker.
 */
export async function GET(request: NextRequest) {
  // A run walks a whole book, page by page, with both texts: under the metered
  // reader (#4357) that is for signed-in readers and for shifts run through our
  // MCP server (a trusted caller), never an anonymous walk round the free sample.
  if (await isMeteredAnonRequest(request)) return meteredSignInResponse();
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

  const planParam = params.get('plan');
  if (planParam && planParam !== 'paired' && planParam !== 'walk') {
    return NextResponse.json({ error: 'plan must be paired or walk' }, { status: 400 });
  }
  const stepParam = params.get('step');
  const stepGiven = stepParam != null && stepParam !== '' ? Number(stepParam) : null;
  if (stepGiven != null && (!Number.isInteger(stepGiven) || stepGiven < 0)) {
    return NextResponse.json({ error: 'step must be a whole number from 0' }, { status: 400 });
  }
  let plan: 'paired' | 'walk' = planParam === 'walk' || (planParam == null && after != null) ? 'walk' : 'paired';

  const db = await getReadDb();
  let resumed = false;
  let resumedFrom: number | null = null;

  // `fresh=1` asks for a new book instead of resuming the last run.
  if (!bookRef && given && params.get('fresh') !== '1') {
    const last = await lastRunPosition(volunteerId);
    if (last) {
      bookRef = last.book;
      after = last.page;
      resumedFrom = last.page;
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
    // A walk starts two pages before the pool page, so it is read with its context; a paired check draws its own pages.
    if (plan === 'walk') after = typeof start.page_number === 'number' ? start.page_number - 3 : null;
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
  const bookId = String(book.id ?? book._id);

  // The paired plan, when this call is (or, on a resume, may be) a paired check.
  let pairs: PagePair[] = [];
  let order: number[] = [];
  if (plan === 'paired' || resumedFrom != null) ({ pairs, order } = await pairedPlan(pages, inBook, bookId));
  if (resumedFrom != null) plan = order.includes(resumedFrom) ? 'paired' : 'walk';
  // A book too sparse for a single pair is walked instead.
  if (plan === 'paired' && order.length === 0) plan = 'walk';

  let step = 0;
  if (plan === 'paired') {
    if (stepGiven != null) step = stepGiven;
    else {
      const done = given ? await reviewedPages(volunteerId, bookKeys) : new Set<number>();
      const gap = order.findIndex((n) => !done.has(n));
      step = gap < 0 ? order.length : gap;
    }
  }

  const page = plan === 'paired'
    ? (step < order.length ? await pages.findOne({ ...inBook, ...HAS_TEXT, page_number: order[step] }, { projection: PAGE_PROJECTION }) : null)
    : await pages.findOne(
      { ...inBook, ...HAS_TEXT, ...(after != null ? { page_number: { $gt: after } } : {}) },
      { sort: { page_number: 1 }, projection: PAGE_PROJECTION },
    );
  const bookUrl = `${SITE}/book/${book.slug ?? book.id ?? book._id}`;
  const run = {
    book_id: bookId,
    book_title: book.display_title || book.title || null,
    author: book.author ?? null,
    published: book.published ?? null,
    language: book.language ?? language ?? null,
    book_url: bookUrl,
  };

  if (!page && plan === 'paired') {
    const last = order[order.length - 1];
    return NextResponse.json({
      volunteer_id: volunteerId,
      run: { ...run, plan: 'paired' },
      page: null,
      message: step >= order.length
        ? `That completes this book's ${order.length}-page check: two facing pages from each part of the book. Start another book (start_review_shift with new_book true), or read on in order from page ${last} (continue_review_shift with plan "walk" and after ${last}).`
        : 'A planned page of this book has lost its text since the plan was drawn. Start another book, or read this one in order with plan "walk".',
      next: { book: bookId, plan: 'walk', after: last },
    });
  }

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

  // Where this page sits in a paired check: which pair, first or second of it, and which part of the book.
  let planInfo: Record<string, unknown> = { kind: 'walk' };
  let next: Record<string, unknown> = { book: run.book_id, plan: 'walk', after: page.page_number };
  if (plan === 'paired') {
    const pairIdx = pairs.findIndex((p) => p.first === page.page_number || p.second === page.page_number);
    const pair = pairs[pairIdx];
    planInfo = {
      kind: 'paired', version: PAIRED_FIFTHS_VERSION, step, of: order.length,
      pair: pairIdx + 1, pairs: pairs.length, role: pair.first === page.page_number ? 'first' : 'second',
      part_of_book: `${pair.fifth} of 5`,
    };
    next = { book: run.book_id, plan: 'paired', step: step + 1 };
  }

  return NextResponse.json({
    volunteer_id: volunteerId,
    resumed,
    run: { ...run, plan, pages_with_text: pagesWithText, pages_left_after_this: laterWithText },
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
      plan: planInfo,
    },
    next,
  });
}
