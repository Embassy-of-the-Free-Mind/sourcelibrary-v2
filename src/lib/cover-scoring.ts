/**
 * Cover page scoring — TS twin of `scripts/lib/cover-scoring.mjs`.
 *
 * Scores a page as a potential book cover from OCR content analysis. Used by
 * `/api/books/[id]/ensure-cover` and the book page's render fallback so the
 * on-view pick uses the same intelligence as pipeline Phase 8.9 instead of the
 * crude type-priority rule (which picked blanks, library stamps, and pages
 * with the scanner's hand in frame whenever `page_type` was missing).
 *
 * Keep in lock-step with `scripts/lib/cover-scoring.mjs` — the parity test in
 * `tests/unit/cover-scoring-parity.test.ts` runs both implementations over the
 * same fixtures and fails on any divergence.
 */

export interface CoverScoreInput {
  page_number?: number;
  page_type?: string | null;
  hidden?: boolean;
  ocr?: { data?: string | null } | null;
  ocr_text?: string | null;
  /** Projected head of `pages.ocr.data` (callers use `$substrCP` … 1200). */
  ocr_head?: string | null;
}

export interface CoverScore {
  score: number;
  reason: string;
}

/**
 * The scanner's own hand caught in the frame. Written the way the OCR model
 * describes such pages ("a gloved hand is visible at the edge…"), and kept
 * deliberately narrow: "hand-colored", "handwriting", and body text discussing
 * hands must not match (same lesson as the DIGITIZER_RE watermark trap in
 * cover-fields.ts). Mirrored in cover-fields.ts / cover-write.mjs /
 * cover-scoring.mjs — change all four together.
 */
export const HAND_IN_FRAME_RE =
  /\b(?:human|person'?s|scanner'?s|gloved) hand\b|\bhands? (?:is |are )?(?:visible|hold(?:s|ing)|gripping|resting on|in (?:the )?frame|at the (?:edge|corner))|\bfingers? (?:is |are )?(?:visible|hold(?:s|ing)|gripping)|\bthumb (?:is |appears )?(?:visible|hold(?:s|ing)|in (?:the )?frame)/i;

/**
 * Extract page type from <page-type> tags in OCR text.
 * Returns null if no tag found.
 */
export function parsePageTypeFromOcr(ocrText?: string | null): string | null {
  if (!ocrText) return null;
  const match = ocrText.match(/<page-type>([^<]+)<\/page-type>/);
  return match ? match[1].trim() : null;
}

/**
 * Score a page as a potential book cover. Higher is better; anything below 30
 * is "no confident pick" (callers fall back or escalate to vision).
 */
export function scorePageForCover(
  page: CoverScoreInput,
  options: { bookTitle?: string | null } = {},
): CoverScore {
  const ocrRaw = page.ocr?.data || page.ocr_text || page.ocr_head || '';
  const ocr = ocrRaw.substring(0, 1200).toLowerCase();
  // NaN mirrors the mjs twin's `undefined` semantics: every position
  // comparison is false for a page with no page_number.
  const pageNum = page.page_number ?? NaN;

  // Resolve page type: explicit field → parsed from OCR tags → null
  const pageType = page.page_type || parsePageTypeFromOcr(ocrRaw);

  let score = 0;
  let reason = pageType || 'unknown';

  // Skip hidden pages
  if (page.hidden) return { score: -200, reason: 'hidden' };

  // === NEGATIVE signals ===

  // Blank pages — check both field and OCR content patterns
  if (pageType === 'blank' || (!pageType && (
    ocr.includes('blank page') || ocr.includes('this page is blank') ||
    ocr.includes('blank, aged') || ocr.includes('blank, textured') ||
    ocr.includes('blank, dark')
  ))) {
    return { score: -100, reason: 'blank' };
  }
  if (pageType === 'digitizer-notice' || pageType === 'digitizer-insert') {
    return { score: -90, reason: 'digitizer-notice' };
  }

  // Physical binding / cover photos
  if (ocr.includes('front cover') || (ocr.includes('external') && ocr.includes('cover')) ||
      (ocr.includes('binding') && ocr.includes('spine')) || ocr.includes('fore-edge') ||
      ocr.includes('closed book') || ocr.includes('book block') ||
      ocr.includes('leather-bound') || ocr.includes('leather bound') ||
      ((ocr.includes('blind-stamp') || ocr.includes('blind stamp')) && ocr.includes('cover')) ||
      ocr.includes('textured surface') || ocr.includes('inside cover') ||
      ocr.includes('endpaper') || ocr.includes('marbled paper') ||
      ocr.includes('cover material') || ocr.includes('cover interior') ||
      (ocr.includes('marbled') && pageNum <= 3)) {
    return { score: -80, reason: 'physical book photo' };
  }

  // Scanner's hand / fingers caught in the frame
  if (HAND_IN_FRAME_RE.test(ocr)) {
    return { score: -75, reason: 'hand in frame' };
  }

  // Digitizer inserts and portal pages
  if (ocr.includes('digitized by') || (ocr.includes('google') && ocr.includes('logo')) ||
      ocr.includes('google books') || ocr.includes('scanned by google') ||
      (ocr.includes('internet archive') && ocr.includes('logo')) ||
      ocr.includes('proquest') || ocr.includes('early european books') ||
      ocr.includes('hathitrust') || ocr.includes('scan sheet') ||
      ocr.includes('e-rara.ch') || ocr.includes('www.e-rara') ||
      ocr.includes('gallica.bnf') || ocr.includes('mdz-nbn') ||
      ocr.includes('digital.staatsbibliothek') || ocr.includes('daten.digitale-sammlungen')) {
    return { score: -70, reason: 'digitizer insert' };
  }

  // BPH pelican bookplate
  const isBphBookplate =
    (ocr.includes('pelican') && (ocr.includes('piety') || ocr.includes('nest') || ocr.includes('young') || ocr.includes('hermetica'))) ||
    ocr.includes('philosophia hermetica') || ocr.includes('philosophica hermetica');
  if (isBphBookplate && pageType !== 'title-page') {
    return { score: -65, reason: 'BPH pelican bookplate' };
  }

  // Ex-libris / bookplates (but allow on actual title pages with small inscriptions)
  const hasExLibris = ocr.includes('ex-libris') || ocr.includes('exlibris') || ocr.includes('ex libris') ||
      ocr.includes('bookplate') || (ocr.includes('ownership') && ocr.includes('stamp')) ||
      ocr.includes('library stamp') || ocr.includes('library sticker') ||
      ocr.includes('library of the') || (ocr.includes('botanical garden') && pageNum <= 5) ||
      ocr.includes('book fund') || ocr.includes('university library') ||
      (ocr.includes('library') && ocr.includes('accession'));
  if (hasExLibris && pageType !== 'title-page') {
    return { score: -60, reason: 'ex-libris/bookplate' };
  }

  // Bleed-through / ghosting
  if (ocr.includes('bleed-through') || ocr.includes('ghosting') || ocr.includes('mirrored impression')) {
    return { score: -50, reason: 'bleed-through' };
  }

  if (pageType === 'toc' || pageType === 'index') return { score: -20, reason: pageType };
  if (pageType === 'colophon') return { score: -10, reason: 'colophon' };

  // === POSITIVE signals ===

  const hasHeadings = (ocr.match(/^#+ .+/gm) || []).length;
  const isTitlePage = pageType === 'title-page';
  const looksLikeTitlePage = !pageType && hasHeadings >= 3;

  if (isTitlePage) { score += 80; reason = 'title-page'; }
  else if (looksLikeTitlePage) { score += 70; reason = 'likely title-page'; }

  if (isTitlePage || looksLikeTitlePage) {
    // Publisher imprint bonus (Latin publishing terms)
    if (ocr.includes('excudebat') || ocr.includes('typis') || ocr.includes('apud') ||
        ocr.includes('impensis') || ocr.includes('sumptibus') || ocr.includes('officina') ||
        ocr.includes('printed by') || ocr.includes('published by') || ocr.includes('printed for')) {
      score += 15;
      reason = (isTitlePage ? 'title-page' : 'likely title-page') + ' with imprint';
    }
    // Decorative elements bonus
    if (ocr.includes('decorative') || ocr.includes('ornamental') || ocr.includes('border') ||
        ocr.includes('frame') || ocr.includes('vignette') || ocr.includes('woodcut') ||
        ocr.includes('architectural') || ocr.includes("printer's mark") ||
        ocr.includes("printer's device")) {
      score += 20;
      reason = 'decorated title-page';
    }
  }

  // Title-match bonus: boost pages whose OCR contains the book's actual title
  if (options.bookTitle && (isTitlePage || looksLikeTitlePage)) {
    const titleWords = options.bookTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
    if (titleWords.length > 0) {
      const matchCount = titleWords.filter(w => ocr.includes(w)).length;
      if (matchCount >= Math.min(2, titleWords.length)) {
        score += 30;
        if (!reason.includes('title')) reason += ' +title-match';
      }
    }
  }

  // Frontispieces — but not binding photos mislabeled as frontispiece
  if (pageType === 'frontispiece') {
    if (ocr.includes('cover') && (ocr.includes('leather') || ocr.includes('binding') || ocr.includes('marbled'))) {
      return { score: -80, reason: 'binding photo (mislabeled frontispiece)' };
    }
    score += 90; reason = 'frontispiece';
    if (ocr.includes('engrav') || ocr.includes('allegor') || ocr.includes('portrait') ||
        ocr.includes('emblem') || ocr.includes('woodcut')) {
      score += 15; reason = 'frontispiece with engraving';
    }
  }

  if (pageType === 'illustration') {
    if (ocr.includes('photograph') && (ocr.includes('fore-edge') || (ocr.includes('book') && ocr.includes('closed')))) {
      return { score: -80, reason: 'physical book photo' };
    }
    if (hasExLibris) {
      return { score: -60, reason: 'bookplate illustration' };
    }
    score += 60; reason = 'illustration';
  }

  if (pageType === 'dedication') { score += 15; reason = 'dedication'; }
  if (pageType === 'text' && score === 0) { score += 5; reason = 'text'; }

  // Position bonus — covers are usually in first 10 pages
  if (pageNum <= 5) score += 5;
  else if (pageNum <= 10) score += 3;
  else if (pageNum > 15) score -= 3;

  return { score, reason };
}
