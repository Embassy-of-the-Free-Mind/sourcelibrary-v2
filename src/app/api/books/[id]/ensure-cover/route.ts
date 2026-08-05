import { NextRequest, NextResponse } from 'next/server';

// mongodb requires the Node.js runtime (never edge).
export const runtime = 'nodejs';
import { getDb } from '@/lib/mongodb';
import {
  buildCoverUpdate,
  isRenderableCoverUrl,
  RENDERABLE_COVER_HOST_RE,
  selectScoredCoverPage,
  type ThumbnailSource,
} from '@/lib/cover-fields';
import { selectBestCover } from '@/lib/cover-selection';
import { mirrorBookToCatalog } from '@/lib/books-catalog';
import { getPageSource } from '@/lib/page-image-url';
import type { Page } from '@/lib/types';

/**
 * POST /api/books/[id]/ensure-cover
 *
 * Materialises a book's cover on first view, the same way
 * `/api/books/[id]/hero-mosaic` materialises the hero background.
 *
 * WHY THIS EXISTS. The book page has always been able to *show* a cover for a
 * book that has none stored: when `books.thumbnail` is missing or points at a
 * host the CSP blocks, it falls back to the title-page scan (which is on R2).
 * That fallback was render-only and never written back, so the same book showed
 * a blank placeholder in every card grid, slider and search result — the page
 * has the `pages` array to fall back with, a card only has the book document.
 * Cover selection proper is pipeline Phase 8.9, which has been idle since the
 * global pause on 2026-06-08 with ~6.2K books queued behind it at
 * `pipeline_auto.status: 'images_complete'`. This route closes the gap for any
 * book someone actually opens, without resuming paid pipeline phases.
 *
 * HOW IT PICKS (2026-08 upgrade — the old type-priority-only rule chose
 * blanks, library stamps, and scanner's-hand shots whenever `page_type` was
 * missing, and passed over untagged title pages):
 *  1. `selectScoredCoverPage` — the same OCR-content scorer as pipeline
 *     Phase 8.9, shared with the book page's render fallback so the cover a
 *     reader sees and the cover the catalogue stores stay the same page.
 *  2. When the scorer can't decide (typically: OCR hasn't run yet, or nothing
 *     in the front matter looks like a cover), ONE Gemini Vision pass over the
 *     first pages (`selectBestCover`, ~$0.005–0.01). Guarded by an atomic
 *     `cover_vision_attempted_at` marker so a book is only ever paid for once,
 *     and by the `ENSURE_COVER_VISION=0` kill-switch. This only ever runs for
 *     books someone actually opened that have no renderable cover — there is
 *     no sweep behind it.
 *  3. Otherwise the old type-priority pick (title page → frontispiece → first
 *     non-junk leaf).
 *
 * It is deliberately a *narrow* writer:
 *  - never overrides a `manual` pick, or any already-renderable cover;
 *  - only ever writes a URL derived from the book's own pages, so there is no
 *    caller-supplied input to trust (which is why it needs no auth, same trust
 *    model as hero-mosaic);
 *  - only writes a URL on a renderable host — a book whose *scans* were never
 *    archived to R2 gets left alone rather than having a blocked URL promoted
 *    into the catalogue, where nothing can fall back for it;
 *  - never touches `pipeline_auto.status`, so a book stays queued for Phase 8.9
 *    and its pick still supersedes this one later (8.9 skips only
 *    `thumbnail_source: 'manual'`).
 */

// Mirrors the book page's own query: first 100 real leaves in reading order.
// (`page_number >= 0` excludes archived spreads, which carry negative numbers.)
const PAGE_FETCH_LIMIT = 110;
const PAGE_KEEP = 100;

const PAGE_PROJECTION = {
  _id: 0,
  page_number: 1,
  page_type: 1,
  photo: 1,
  photo_original: 1,
  archived_photo: 1,
  enhanced_photo: 1,
  cropped_photo: 1,
  display_photo: 1,
  image_thumb: 1,
  thumbnail_blob: 1,
  thumbnail: 1,
  split_from_spread: 1,
  crop: 1,
  hidden: 1,
  // Feeds both `isJunkRepresentativePage` and the cover scorer. 1200 chars is
  // the scorer's window (`scorePageForCover`). Must stay in step with the book
  // page's projection or the two would pick different pages.
  ocr_head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 1200] },
} as const;

/** The projected page shape this route reasons about. */
type CoverCandidatePage = Partial<Page> & {
  page_number?: number;
  page_type?: string | null;
  ocr_head?: string | null;
  hidden?: boolean;
};

type Result = { ok: boolean; reason: string; thumbnail?: string; cover_page?: number };

function json(body: Result, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      { projection: { _id: 0, id: 1, title: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, thumbnail_source: 1 } },
    );
    if (!book?.id) return json({ ok: false, reason: 'book-not-found' }, 404);

    // A human's pick always wins.
    if (book.thumbnail_source === 'manual') return json({ ok: false, reason: 'manual-cover' });

    // Already has a cover the browser can load — nothing to do. This is the
    // common case and the reason the route is cheap to call on every view.
    const stored = book.image_display || book.thumbnail || book.image_thumb || book.thumbnail_blob;
    if (isRenderableCoverUrl(stored)) return json({ ok: false, reason: 'already-renderable' });

    const pages = await db.collection('pages')
      .find({ book_id: book.id, page_number: { $gte: 0 } }, { projection: PAGE_PROJECTION, maxTimeMS: 5000 })
      .sort({ page_number: 1 })
      .limit(PAGE_FETCH_LIMIT)
      .toArray()
      .then(docs => (docs as unknown as CoverCandidatePage[])
        .filter(d => d.page_type !== 'digitizer-insert' && d.page_type !== 'archived-spread')
        .slice(0, PAGE_KEEP));
    if (!pages.length) return json({ ok: false, reason: 'no-pages' });

    const pick = selectScoredCoverPage(pages, book.title);
    if (!pick) return json({ ok: false, reason: 'no-cover-page' });

    let coverPage: CoverCandidatePage = pick.page;
    let source: ThumbnailSource = pick.method === 'smart-ocr' ? 'smart_ocr' : 'page_fallback';
    let method = pick.method === 'smart-ocr' ? 'ensure-cover-scored' : 'ensure-cover-on-view';
    let confidence = pick.method === 'smart-ocr' ? 0.85 : 0.5;
    let detail = pick.method === 'smart-ocr'
      ? `page ${coverPage.page_number} — ${pick.reason} (score: ${pick.score})`
      : `page ${coverPage.page_number} (${pick.reason}) — first-view fallback, pending Phase 8.9`;

    // Text couldn't decide (no OCR yet, or nothing scored like a cover): one
    // vision pass, at most once per book EVER. The atomic claim means two
    // concurrent first views spend one call, and a failed call is never
    // retried — the type-priority pick above stands until Phase 8.9.
    if (pick.method === 'type-priority'
        && process.env.ENSURE_COVER_VISION !== '0'
        && process.env.GEMINI_API_KEY) {
      const claim = await db.collection('books').updateOne(
        { id: book.id, cover_vision_attempted_at: { $exists: false } },
        { $set: { cover_vision_attempted_at: new Date() } },
      );
      if (claim.modifiedCount === 1) {
        try {
          const vision = await selectBestCover(db, book.id, 10, { triggered_by: 'auto_recovery' });
          const visionPage = vision.confidence !== 'low'
            ? pages.find(p => p.page_number === vision.pageNumber)
            : undefined;
          if (visionPage) {
            coverPage = visionPage;
            source = 'vision';
            method = 'ensure-cover-vision';
            confidence = vision.confidence === 'high' ? 0.9 : 0.7;
            detail = `page ${visionPage.page_number} — ${vision.rationale}`;
          }
        } catch (err) {
          // Non-fatal: the text pick stands. The claim marker stays set on
          // purpose — a book whose images make Gemini fail once will fail the
          // same way on every view, and each retry costs money.
          console.warn('[ensure-cover] vision pass failed:', err instanceof Error ? err.message : err);
        }
      }
    }

    // Verify before writing: the chosen page must resolve to an image the
    // browser can actually load. `buildCoverUpdate` resolves the same way via
    // `resolvePageCoverUrl`, but check the source URL first so an un-archived
    // book returns a diagnosable reason instead of a silently useless write.
    const sourceUrl = getPageSource(coverPage);
    if (!isRenderableCoverUrl(sourceUrl)) {
      return json({ ok: false, reason: 'page-scans-not-archived' });
    }

    const update = buildCoverUpdate(coverPage, {
      source,
      method,
      confidence,
      detail,
      actor: 'pipeline',
    });
    if (!update) return json({ ok: false, reason: 'no-usable-page-image' });

    // Compare-and-set, so two concurrent first views can't fight: write only
    // while the book still has no renderable cover. The loser is a clean no-op,
    // and a `manual` pick that landed in between still wins.
    const written = await db.collection('books').updateOne(
      {
        id: book.id,
        thumbnail_source: { $ne: 'manual' },
        $nor: [
          { image_display: { $regex: RENDERABLE_COVER_HOST_RE } },
          { thumbnail: { $regex: RENDERABLE_COVER_HOST_RE } },
        ],
      },
      { $set: update },
    );
    if (!written.modifiedCount) return json({ ok: false, reason: 'raced-or-unchanged' });

    // Push straight to the Supabase mirror the catalogue/browse/search cards
    // read, so the cover appears there immediately instead of waiting up to
    // 5 min for the Hetzner sync cron.
    await mirrorBookToCatalog(book.id, update as unknown as Record<string, unknown>).catch(() => {});

    return json({ ok: true, reason: 'cover-persisted', thumbnail: update.thumbnail, cover_page: update.cover_page });
  } catch (error) {
    console.error('[ensure-cover] failed:', error);
    return json({ ok: false, reason: error instanceof Error ? error.message : 'failed' }, 500);
  }
}
