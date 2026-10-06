/**
 * Book-level cover choice — the policy that sits on top of the page scorer.
 *
 * `scorePageForCover()` (cover-scoring.mjs) rates ONE page. This module decides
 * which page a BOOK should wear, in this order:
 *
 *   1. Illustration-led titles (Icones, Illustrations, Figures, Tafeln, Planches,
 *      圖譜 …) wear their best extracted plate. A book sold on its pictures
 *      should show one, even when a fine title page exists.
 *   2. Otherwise the best-scoring page in the opening window: a decorated cover,
 *      a decorated title page, a frontispiece, a plain title page.
 *   3. No confident page there → the book's best plate, if it has any.
 *   4. Still nothing → the first ordinary page that is not junk (a text page
 *      beats a blank leaf, a binding snapshot, a scanner insert or a shelfmark).
 *   5. Nothing usable at all → null; the caller keeps what it has.
 *
 * Hand-picked covers (`thumbnail_source` starting with "manual") are never
 * replaced — callers check `isManualCover()` before calling this.
 *
 * Pure: no DB access. `loadCoverCandidates()` below fetches the inputs.
 */
import { scorePageForCover } from './cover-scoring.mjs';
import { resolvePageCoverUrl, isRenderableCoverUrl } from './cover-write.mjs';

/** Pages scanned for a cover. Title pages after long front matter (half-title,
 *  privileges, a plate list) sit past page 20 often enough to matter. */
export const COVER_WINDOW = 40;

/** A page must score at least this to be a confident pick (scorer convention). */
export const CONFIDENT_SCORE = 30;

/** Plates below this gallery_quality are not good enough to front a book. */
export const MIN_PLATE_QUALITY = 0.75;

/** The cover shows the whole PAGE, so the picture must fill a real share of it:
 *  a marginal drawing on a text spread reads as a text page (bbox is 0..1). */
export const MIN_PLATE_AREA = 0.25;

/** Detected-image types that are never a book's face. */
const NON_COVER_PLATE_TYPES = new Set(['exlibris', 'decorative', 'symbol', 'unknown']);

function isCoverWorthyPlate(g) {
  if ((g.gallery_quality ?? 0) < MIN_PLATE_QUALITY || !(g.page_number > 0)) return false;
  if (NON_COVER_PLATE_TYPES.has(String(g.type || ''))) return false;
  const area = g.bbox ? (g.bbox.width ?? 0) * (g.bbox.height ?? 0) : null;
  return area === null || area >= MIN_PLATE_AREA;
}

/**
 * Titles that promise pictures. Latin, English, French, German, Italian,
 * Spanish, Dutch, plus CJK picture-book words. Matched against title and
 * display_title together.
 */
export const ILLUSTRATED_TITLE_RE = new RegExp([
  String.raw`\bicon(?:es|um|ibus|ographi\w*)\b`,
  String.raw`\billustrat\w*`,
  String.raw`\bfigur(?:ae|is|arum|es|en)\b`,
  String.raw`\btabul(?:ae|is|arum)\b`,
  String.raw`\bimagin(?:es|um|ibus)\b`,
  String.raw`\bemblem\w*`,
  String.raw`\bplates?\b`,
  String.raw`\bplanches?\b`,
  String.raw`\bgravures?\b`,
  String.raw`\b(?:ab)?bildungen\b`,
  String.raw`\btafeln?\b`,
  String.raw`\bkupfer\w*`,
  String.raw`\btavole\b`,
  String.raw`\bl[áa]minas?\b`,
  String.raw`\bplaten\b`,
  String.raw`\batlas\b`,
  String.raw`\bpictures?\b`,
  String.raw`\bdrawings?\b`,
  String.raw`\bcoloured figures?\b`,
  '圖', '図', '畫', '画', '絵', '繪',
].join('|'), 'i');

/** Scorer reasons that must never front a book, even as a last resort. */
const JUNK_REASONS = new Set([
  'blank', 'hidden', 'digitizer-notice', 'digitizer insert', 'physical book photo',
  'binding photo (mislabeled frontispiece)', 'hand in frame', 'BPH pelican bookplate',
  'ex-libris/bookplate', 'bookplate illustration', 'bleed-through',
]);

export function isManualCover(book) {
  return /^manual/.test(String(book?.thumbnail_source || ''));
}

export function isIllustratedTitle(book) {
  const text = `${book?.title || ''} ${book?.display_title || ''}`;
  return ILLUSTRATED_TITLE_RE.test(text);
}

/**
 * @param {Object} book    { title, display_title }
 * @param {Object[]} pages Opening-window page docs (page_number, page_type, hidden,
 *                         ocr.data, and the photo fields resolvePageCoverUrl reads)
 * @param {Object[]} plates gallery_images for the book: { page_number, gallery_quality, type, bbox }
 * @param {Map<number,Object>} platePages page docs for plate page_numbers outside the window
 * @returns {{ page: Object, rule: string, score: number, reason: string } | null}
 */
export function chooseCover(book, pages, plates = [], platePages = new Map()) {
  const byNumber = new Map(pages.map(p => [p.page_number, p]));
  const pageFor = n => byNumber.get(n) || platePages.get(n) || null;
  // Renderable host only: a raw archive.org/gallica URL resolves with curl but the
  // site CSP blocks it, so it would render as a blank card.
  const usable = p => p && !p.hidden && isRenderableCoverUrl(resolvePageCoverUrl(p));

  const goodPlates = plates
    .filter(isCoverWorthyPlate)
    .sort((a, b) => (b.gallery_quality - a.gallery_quality) || (a.page_number - b.page_number));
  const bestPlate = () => {
    for (const g of goodPlates) {
      const p = pageFor(g.page_number);
      if (usable(p)) return { page: p, score: Math.round(g.gallery_quality * 100), reason: 'plate' };
    }
    return null;
  };

  // 1. Illustration-led titles wear a plate.
  if (isIllustratedTitle(book)) {
    const plate = bestPlate();
    if (plate) return { ...plate, rule: 'illustrated-title-plate' };
  }

  const scored = pages
    .filter(usable)
    .map(p => ({ page: p, ...scorePageForCover(p, { bookTitle: book?.title }) }))
    .sort((a, b) => (b.score - a.score) || (a.page.page_number - b.page.page_number));

  // 2. A confident page in the opening window.
  if (scored[0] && scored[0].score >= CONFIDENT_SCORE) {
    return { ...scored[0], rule: 'scored-page' };
  }

  // 3. A representative plate.
  const plate = bestPlate();
  if (plate) return { ...plate, rule: 'representative-plate' };

  // 4. The first ordinary page that is not junk.
  // Only pages the OCR model actually read: an unread page could be anything.
  const ordinary = scored
    .filter(s => !JUNK_REASONS.has(s.reason) && s.reason !== 'unknown' && s.score >= 0
      && String(s.page.ocr?.data || '').trim().length > 0)
    .sort((a, b) => a.page.page_number - b.page.page_number)[0];
  if (ordinary) return { ...ordinary, rule: 'first-ordinary-page' };

  return null;
}

/** True when the current cover page is one the policy would never pick. */
export function isJunkCover(page, book) {
  if (!page) return true;
  return JUNK_REASONS.has(scorePageForCover(page, { bookTitle: book?.title }).reason);
}

const PAGE_PROJECTION = {
  _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, hidden: 1, 'ocr.data': 1,
  photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1,
  crop: 1, enhanced_photo: 1, image_thumb: 1, thumbnail_blob: 1,
};

/** Fetch everything chooseCover needs for one book. */
export async function loadCoverCandidates(db, bookId) {
  const [pages, plates] = await Promise.all([
    db.collection('pages')
      .find({ book_id: bookId, page_number: { $gt: 0, $lte: COVER_WINDOW } }, { projection: PAGE_PROJECTION })
      .sort({ page_number: 1 })
      .toArray(),
    db.collection('gallery_images')
      .find({ book_id: bookId, gallery_quality: { $gte: MIN_PLATE_QUALITY } },
        { projection: { _id: 0, page_number: 1, gallery_quality: 1, type: 1, bbox: 1 } })
      .sort({ gallery_quality: -1 })
      .limit(40)
      .toArray(),
  ]);
  const outside = [...new Set(plates.map(g => g.page_number))].filter(n => n > COVER_WINDOW);
  const platePages = new Map();
  if (outside.length) {
    const docs = await db.collection('pages')
      .find({ book_id: bookId, page_number: { $in: outside } }, { projection: PAGE_PROJECTION })
      .toArray();
    for (const d of docs) platePages.set(d.page_number, d);
  }
  return { pages, plates, platePages };
}
