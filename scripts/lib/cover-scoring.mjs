/**
 * Shared cover page scoring logic.
 *
 * Used by:
 *   - pipeline-orchestrator.mjs (Phase 3 + Phase 8.9)
 *   - smart-cover-selection.mjs (batch re-evaluation)
 *
 * Scores a page as a potential book cover using OCR content analysis.
 * Parses <page-type> tags from OCR text when page.page_type is null.
 * Detects binding photos, digitizer inserts, bookplates (incl. BPH pelican),
 * and prefers decorated title pages with woodcuts/borders/printer's marks.
 *
 * TS twin: src/lib/cover-scoring.ts (used by ensure-cover + the book page).
 * Keep in lock-step — tests/unit/cover-scoring-parity.test.ts runs both over
 * the same fixtures and fails on divergence.
 */

import { stripMarkupTags } from './strip-markup-tags.mjs';

/** Scanner's hand caught in the frame. Mirror of HAND_IN_FRAME_RE in
 *  src/lib/cover-scoring.ts — deliberately narrow ("hand-colored",
 *  "handwriting", body text about hands must not match). */
export const HAND_IN_FRAME_RE =
  /\b(?:human|person'?s|scanner'?s|gloved) hand\b|\bhands? (?:is |are )?(?:visible|hold(?:s|ing)|gripping|resting on|in (?:the )?frame|at the (?:edge|corner))|\bfingers? (?:is |are )?(?:visible|hold(?:s|ing)|gripping)|\bthumb (?:is |appears )?(?:visible|hold(?:s|ing)|in (?:the )?frame)/i;

/**
 * Decorated / pictorial front cover — the one kind of binding photo worth
 * showing as a cover. Mirrored in src/lib/cover-scoring.ts (parity-tested).
 */
export const DECORATED_COVER_RE =
  /\b(?:ornate|elaborate|richly decorated)\b|\bgold[\s-]?tool(?:ed|ing)\b|\bgilt (?:decoration|border|ornament|design|tooling|stamp(?:ed|ing))\b|\bdecorative (?:border|frame|design|panel|tooling|cartouche)\b|\bpictorial (?:cover|wrapper|binding|boards)\b|\billustrated (?:front )?(?:cover|wrapper|boards)\b|\bembossed (?:design|ornament|decoration|pattern)\b/i;
/** Wear, library furniture or marbling: still just a binding snapshot. */
export const PLAIN_BINDING_RE =
  /\b(?:worn|peel(?:ing|ed)|damaged|scuff(?:ed|s)?|faded|torn|deteriorat\w*|stain(?:ed|s)?|sticker|shelf\s?mark|accession|call number|barcode)\b|library (?:label|stamp|sticker)|\bmarbl(?:ed|ing)\b|\bendpaper\b|\binside cover\b|\bfore-edge\b/i;

function isDecoratedFrontCover(ocr) {
  const frontCover = ocr.includes('front cover') || /\b(?:book|the) cover\b/.test(ocr) || ocr.includes('pictorial') || ocr.includes('wrapper');
  return frontCover && DECORATED_COVER_RE.test(ocr) && !PLAIN_BINDING_RE.test(ocr);
}

/** Characters of transcribed text, tags and whitespace removed. */
export function ocrBodyLength(ocrRaw) {
  // Paired tags go with their contents; then stripMarkupTags (#5564) for the rest.
  return stripMarkupTags(String(ocrRaw || '').replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/gi, ''), '')
    .replace(/\s+/g, '').length;
}

/**
 * Extract page type from <page-type> tags in OCR text.
 * Returns null if no tag found.
 */
export function parsePageTypeFromOcr(ocrText) {
  if (!ocrText) return null;
  const match = ocrText.match(/<page-type>([^<]+)<\/page-type>/);
  return match ? match[1].trim() : null;
}

// ── "Does this title page name THIS book?" (#3584) ───────────────────
// A volume can carry several title pages — a work bound in front, a series
// title, a half-title — and the first or the most ornate one is not
// necessarily this record's. These helpers are the single source for the
// selector (below) and the detector (scripts/audit/sammelband-cover.mjs), so
// the two cannot disagree about what "names the work" means.

/** Words too common in early-modern titles to distinguish one work from another. */
export const WORK_STOP_WORDS = new Set([
  'being', 'volume', 'their', 'about', 'which', 'other', 'these', 'those', 'first',
  'second', 'third', 'fourth', 'wherein', 'whereof', 'together', 'containing',
  'contained', 'according', 'concerning', 'translated', 'printed', 'edition',
  'london', 'paris', 'wherewith', 'thereof', 'himself', 'unknown', 'anonymous',
  'selected', 'collected', 'complete', 'general', 'several', 'various', 'sundry',
  'newly', 'lately', 'divers', 'certain', 'brief', 'short', 'great', 'grand',
]);
const WORK_MIN_TOKEN_LEN = 5;

/** Lowercase with diacritics folded: "Ikhwánu-s Safá" must match "Ikhwan al-Safa". */
export function foldForWorkMatch(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Distinctive tokens of a title (folded, >= 5 letters, not a stop word, not a number). */
export function workTitleTokens(title) {
  return [...new Set(
    foldForWorkMatch(title)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= WORK_MIN_TOKEN_LEN && !WORK_STOP_WORDS.has(w) && !/^\d+$/.test(w)),
  )];
}

/** "Vaughan, Thomas" -> "vaughan"; "Thomas Vaughan" -> "vaughan". */
export function workAuthorSurname(author) {
  const a = String(author || '').trim();
  if (!a) return null;
  const surname = a.includes(',') ? a.split(',')[0] : a.split(/\s+/).pop();
  const s = foldForWorkMatch(surname).replace(/[^a-z]/g, '');
  return s.length >= 4 ? s : null;
}

/**
 * How many distinct signals (title tokens + author surname) does `foldedText`
 * carry? Matched on a 6-char PREFIX so Latin inflection doesn't read as
 * absence ("adamica" on the page, "adamicam" in the record).
 */
export function workMatchStrength(tokens, surname, foldedText) {
  let n = 0;
  for (const t of tokens) if (foldedText.includes(t.slice(0, 6))) n++;
  if (surname && foldedText.includes(surname.slice(0, 6))) n++;
  return n;
}

/**
 * Score a page as a potential book cover.
 *
 * @param {Object} page - Page document with page_number, page_type, ocr.data, hidden
 * @param {Object} [options]
 * @param {string} [options.bookTitle] - Book title, for the names-this-work bonus
 * @param {string} [options.bookAuthor] - Book author; the surname is one more signal
 * @returns {{ score: number, reason: string }}
 */
export function scorePageForCover(page, options = {}) {
  const ocrRaw = page.ocr?.data || page.ocr_text || page.ocr_head || '';
  const ocr = ocrRaw.substring(0, 1200).toLowerCase();
  const pageNum = page.page_number;

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

  // A decorated or pictorial FRONT cover is a real cover, not a binding snapshot:
  // gold tooling, a decorative border, an illustrated wrapper. It ranks above a
  // plain title page and below a decorated one or a frontispiece. Wear, library
  // stickers/shelfmarks and marbling keep it in the binding-photo bucket below.
  if (isDecoratedFrontCover(ocr)) {
    return { score: 85 + (pageNum <= 3 ? 5 : 0), reason: 'decorated cover' };
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
      ocr.includes('digital.staatsbibliothek') || ocr.includes('daten.digitale-sammlungen') ||
      // Cornell's insert ("The original of this book is in the Cornell University Library.
      // There are no known copyright restrictions in the United States on the use of the
      // text.") — the model tags it title-page on every volume (#4815 hand-read: 4 of 14
      // sampled "title pages" were this leaf), so the page_type test above never fires.
      /the original of this book is in the .{0,60}library/.test(ocr) ||
      ocr.includes('no known copyright restrictions') ||
      // A library's stand-in leaf ("digital surrogate cover page provided by Cornell
      // University Library") — also tagged title-page, also not the book (#3584).
      ocr.includes('digital surrogate')) {
    return { score: -70, reason: 'digitizer insert' };
  }

  // Series wrapper: the Siku Quanshu's uniform printed board (四庫全書 label plus a
  // volume number, the same on every volume). The OCR types it title-page, but it
  // says nothing about the book. A real title leaf carries far more text.
  if (/四庫全書|四库全书/.test(ocrRaw) && ocrBodyLength(ocrRaw) <= 40) {
    return { score: -70, reason: 'series wrapper' };
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

  // Names-this-work bonus (#3584). A volume can hold several title pages and
  // only one of them is this record's: a title page that NAMES the book must
  // outrank one that is merely first or more ornate (a work bound in front, a
  // series title, a library's seal page). The size holds that as an invariant
  // for typed title pages: the weakest naming one (80 + 75 - 3 = 152) beats
  // the strongest that does not (80 + 15 + 20 + 30 + 5 = 150).
  // "Names" means TWO signals. One shared word earns nothing: it is how the
  // detector's pilot proposed a degraded leaf over a sound title page ("Book
  // Four — Magick"), and here it moved a cover to a show-through leaf. The
  // exception is a title with at most one distinctive word, which can never
  // reach two on the title alone and keeps the old +30.
  if (options.bookTitle && (isTitlePage || looksLikeTitlePage)) {
    const tokens = workTitleTokens(options.bookTitle);
    const surname = workAuthorSurname(options.bookAuthor);
    const strength = workMatchStrength(tokens, surname, foldForWorkMatch(ocr));
    if (strength >= 2) {
      score += 75;
      reason += ' +names-work';
    } else if (strength === 1 && tokens.length <= 1) {
      score += 30;
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

  // Library furniture on an otherwise good page (stamps, shelfmarks, labels):
  // still usable, but a clean title page or plate should win over it.
  if (score > 0 && (hasExLibris || /library stamp|shelf ?mark|accession/.test(ocr))) score -= 15;

  // Position bonus — covers are usually in first 10 pages
  if (pageNum <= 5) score += 5;
  else if (pageNum <= 10) score += 3;
  else if (pageNum > 15) score -= 3;

  return { score, reason };
}
