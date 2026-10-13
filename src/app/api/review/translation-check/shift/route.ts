import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { nextCandidate } from '@/lib/review-candidates';
import { isValidVolunteerId } from '@/lib/review-queue';
import { getPageImageUrl, type PageImageFields } from '@/lib/page-image-url';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { contentHash } from '@/lib/write-provenance';

export const maxDuration = 15;

const SITE = 'https://sourcelibrary.org';
const MAX_PAGES = 5;
/** A shift is read in a chat window; a page's text past this is cut, and the
 *  item says so, rather than one long leaf crowding out the other four. */
const MAX_TEXT = 6000;

/**
 * GET /api/review/translation-check/shift?volunteer_id=<id>&language=<Latin>&n=5
 *
 * A volunteer SHIFT (#6418, .claude/docs/volunteer-shifts-design.md): up to five
 * translation-check pages, each with its scan, transcription and English, for a
 * reader working in their own Claude through the MCP tools `start_review_shift`
 * and `submit_page_review`. Same pool, same selection policy and same verdicts
 * as /check and /review/translation-check, so shift rows and website rows can
 * be compared directly.
 *
 * Each item carries `text_version` — the stored OCR's and translation's
 * `contentHash` (the same hash the provenance contract stamps as
 * `content_hash`) — so a verdict or correction stays bound to the text it judged (a later re-OCR
 * would otherwise silently re-point it). The engine and model are deliberately
 * NOT returned: the reviewer judges the text, not its maker.
 *
 * volunteer_id is optional here: a first shift gets a fresh code back, which the
 * volunteer keeps to avoid being shown pages they already judged.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const given = params.get('volunteer_id')?.trim() || '';
  if (given && !isValidVolunteerId(given)) {
    return NextResponse.json({ error: 'invalid volunteer_id' }, { status: 400 });
  }
  const volunteerId = given || randomUUID();
  const language = params.get('language')?.trim() || undefined;
  const n = Math.min(MAX_PAGES, Math.max(1, Number(params.get('n')) || MAX_PAGES));

  // nextCandidate serves one item per call and does not know what this request
  // already took, so draw until n distinct items or the attempts run out.
  const picked = new Map<string, { item_id: string; language: string; prompt: string }>();
  let message: string | null = null;
  for (let attempt = 0; attempt < n * 3 && picked.size < n; attempt++) {
    const result = await nextCandidate('translation-check', volunteerId, { language });
    if (!result.item) {
      message = result.message;
      break;
    }
    const p = (result.item.payload ?? {}) as { language?: string; prompt?: string };
    picked.set(result.item.item_id, {
      item_id: result.item.item_id,
      language: p.language ?? result.item.stratum?.language ?? '',
      prompt: p.prompt ?? '',
    });
  }

  // item_id is `trans:<language>:<pages.id>` (calibration-tasks.mjs).
  const pageIdOf = (itemId: string) => itemId.split(':').slice(2).join(':');
  const pageIds = [...picked.keys()].map(pageIdOf).filter(Boolean);

  const db = await getReadDb();
  const pages = pageIds.length
    ? await db
        .collection('pages')
        .find(
          { id: { $in: pageIds } },
          {
            projection: {
              id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1,
              photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1,
              display_photo: 1, image_thumb: 1, thumbnail: 1, split_from_spread: 1, crop: 1,
            },
          },
        )
        .toArray()
    : [];
  const pageById = new Map(pages.map((p) => [String(p.id), p]));

  // A book is looked up by `id` OR `_id` (book-deletion-and-identity.md).
  const bookIds = [...new Set(pages.map((p) => String(p.book_id)))];
  const books = bookIds.length
    ? await db
        .collection('books')
        .find(
          {
            $or: [
              { id: { $in: bookIds } },
              { _id: { $in: bookIds.filter((b) => ObjectId.isValid(b)).map((b) => new ObjectId(b)) } },
            ],
          },
          { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1, visible: 1 } },
        )
        .toArray()
    : [];
  const bookById = new Map<string, (typeof books)[number]>();
  for (const b of books) {
    bookById.set(String(b._id), b);
    if (b.id) bookById.set(String(b.id), b);
  }

  const clip = (s: string) =>
    s.length > MAX_TEXT ? { text: s.slice(0, MAX_TEXT), truncated: true } : { text: s, truncated: false };

  const items = [];
  for (const entry of picked.values()) {
    const page = pageById.get(pageIdOf(entry.item_id));
    const ocrRaw = page?.ocr?.data as string | undefined;
    const trRaw = page?.translation?.data as string | undefined;
    // A page whose translation was withheld (containment) or never written has
    // nothing to judge on one side; skip it rather than serve half a task.
    if (!page || !ocrRaw || !trRaw) continue;
    const book = bookById.get(String(page.book_id));
    // The pool was drawn weeks ago; a book hidden since (rights screen, a
    // containment hold) must not have its full text served through a side door.
    if (book?.visible !== true) continue;
    const transcription = clip(stripEditorialWrappers(ocrRaw).trim());
    const translation = clip(stripEditorialWrappers(trRaw).trim());
    items.push({
      item_id: entry.item_id,
      language: entry.language,
      book_title: book?.display_title || book?.title || null,
      author: book?.author ?? null,
      published: book?.published ?? null,
      page_number: page.page_number ?? null,
      reader_url: `${SITE}/book/${book?.slug ?? page.book_id}/page/${page.id}`,
      image_url: getPageImageUrl(page as PageImageFields, 'display'),
      transcription: transcription.text,
      translation: translation.text,
      ...(transcription.truncated || translation.truncated
        ? { truncated_note: `Text over ${MAX_TEXT} characters was cut here; open reader_url for the full page.` }
        : {}),
      text_version: { ocr: contentHash(ocrRaw), translation: contentHash(trRaw) },
      question: entry.prompt,
    });
  }

  return NextResponse.json({
    shift_id: randomUUID(),
    volunteer_id: volunteerId,
    language: language ?? null,
    items,
    ...(items.length === 0
      ? { message: message ?? 'No pages are waiting in this language right now. Try another language, or none.' }
      : {}),
  });
}
