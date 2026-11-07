// PRIOR ART: scripts/split-book.mjs — the split writer; it archives the spreads and makes the leaves live in ONE step,
// so a book's text and English leave the reader until the leaves are read again (#7605 gate, 2026-10-30).
// scripts/split-pecha.mjs and scripts/maintenance/atisha-leaf-order-6142.mjs soft-hide a parent and write split_into,
// also in one step. Nothing builds the leaves first and swaps them in later; this module holds the pure rules for that.
/**
 * BUILD, THEN SWAP (#7605, Derek 2026-10-30): readers never see a split book without its text or its English.
 *
 *   1. STAGE  split-book.mjs --stage writes the leaves HIDDEN while the spreads stay live. A staged leaf sits at
 *             page_number = n - STAGE_BASE (n = its leaf number after the swap): negative, so no reader list, counter,
 *             search or sitemap sees it (every one of them filters page_number > 0 or >= 0), and in leaf order, so a lane's
 *             "page before / page after" lookup (page_number ± 1) finds the neighbouring LEAF, never a live spread.
 *             `staged_split` on the page says where it came from: { run, leaf: n, frame_id, side, at, by, mode }.
 *   2. READ   the CLI lanes read and translate the staged leaves by page id (cli-ocr.mjs, claude-ocr.mjs,
 *             cli-translate.mjs). isStagedLeaf() is the one exception to the soft-hidden rule they apply.
 *   3. SWAP   scripts/maintenance/split-swap.mjs, only when swapRefusal() is null: archive the spreads (archived-spread,
 *             split_into → their leaves), give each leaf its number, recount.
 */

import { contentHash } from './write-provenance.mjs';

/** Staged leaf n is stored at page_number n - STAGE_BASE. Archived spreads use -(n+1), far above this range. */
export const STAGE_BASE = 1_000_000;

export const stagedPageNumber = (leafNumber) => leafNumber - STAGE_BASE;

/** A leaf built by split-book.mjs --stage and not yet swapped in (a swapped leaf has a positive page_number). */
export function isStagedLeaf(page) {
  return !!page?.staged_split && typeof page.page_number === 'number' && page.page_number < 0 && page.page_number > -STAGE_BASE;
}

/** The number a staged leaf takes at the swap (and the number a prompt should show for it). */
export function leafNumberOf(page) {
  if (!isStagedLeaf(page)) return page?.page_number;
  return page.staged_split.leaf ?? page.page_number + STAGE_BASE;
}

/** The spread's OCR as it was cut, so the swap can tell it has not been re-read since (null: no OCR). */
export const frameOcrHash = (frame) => (frame?.ocr?.data ? contentHash(frame.ocr.data) : null);

/** Mongo selector for a book's staged leaves. */
export const stagedLeavesQuery = (bookId) => ({ book_id: bookId, 'staged_split.run': { $exists: true }, page_number: { $lt: 0, $gt: -STAGE_BASE } });

const SPLIT_POS = /<split-position>[^<]*<\/split-position>\s*/g;
const PAGE_BREAK = '<page-break/>';

/**
 * A spread's stored OCR, cut at its own <page-break/> (the spread prompt writes the LEFT page, the break, then the RIGHT
 * page). Returns { kind: 'none' } (no text), { kind: 'whole', text } (no break), { kind: 'cut', left, right } (exactly
 * one break), or { kind: 'ambiguous', text } (two or more breaks: which part is which leaf cannot be told, #7605).
 * A side with nothing on it is null: that leaf gets a fresh read rather than an empty page.
 */
export function cutSpreadText(ocr) {
  if (typeof ocr !== 'string' || !ocr.trim()) return { kind: 'none' };
  const text = ocr.replace(SPLIT_POS, '').trim();
  const parts = text.split(PAGE_BREAK);
  if (parts.length === 1) return { kind: 'whole', text };
  if (parts.length > 2) return { kind: 'ambiguous', text: parts.map((p) => p.trim()).filter(Boolean).join('\n\n') };
  const [left, right] = parts.map((p) => p.trim() || null);
  return { kind: 'cut', left, right };
}

/**
 * The leaves one frame becomes under a REVIEWED fold, with the text the spread's OCR gives each.
 * `fold`: a number (cut there) or null (keep the frame whole). `sideOrder`: ['left','right'] or ['right','left'].
 * `sides`: which leaf the text BEFORE the break is on, as checked against the leaf images (split-text-sides.mjs):
 * 'lr' (the left leaf, what the spread prompt asks for), 'rl' (the right leaf), or null (unsure: both read fresh).
 * The prompt's order is not to be trusted: on the #7605 gate book (Arabic script) frame 7 put the right page first.
 * Each leaf: { side, ocr: string|null, text_from: 'page-break'|'whole-frame'|null }. A null ocr means a fresh read.
 *  - A whole frame keeps all of its text (a pasted slip or plate across the fold is one page, whatever the OCR said).
 *  - A cut frame takes the two sides of a single <page-break/>; with none, or with several, both leaves are read fresh:
 *    a reviewed fold must not be paired with text cut somewhere else.
 */
export function leavesForFrame({ fold, ocr, sides = 'lr' }, sideOrder = ['left', 'right']) {
  const t = cutSpreadText(ocr);
  if (fold == null) {
    const whole = t.kind === 'cut' ? [t.left, t.right].filter(Boolean).join('\n\n') : t.text ?? null;
    return [{ side: 'single', ocr: whole || null, text_from: whole ? 'whole-frame' : null }];
  }
  const bySide = t.kind !== 'cut' || !sides ? {} : sides === 'rl' ? { right: t.left, left: t.right } : { left: t.left, right: t.right };
  return sideOrder.map((side) => {
    const ocrText = bySide[side] ?? null;
    return { side, ocr: ocrText, text_from: ocrText ? 'page-break' : null };
  });
}

/**
 * A frame kept WHOLE becomes one leaf with the frame's own text (leavesForFrame), so the English already made from that
 * text is still its English: the swap carries it over rather than paying for a read, which on a cover of English
 * description the printed-English guard refuses anyway (#7605 gate book, leaves 1 and 28). Only for a single leaf whose
 * OCR is exactly the frame's text (less the split tags), and only when the leaf has no English of its own.
 * Returns the translation to write, or null.
 */
export function carriedTranslation(leaf, frame) {
  if (leaf?.staged_split?.side !== 'single' && leaf?.split_side !== 'single') return null;
  if (leaf?.translation?.data || !frame?.translation?.data) return null;
  const [whole] = leavesForFrame({ fold: null, ocr: frame?.ocr?.data });
  if (!whole.ocr || whole.ocr !== leaf?.ocr?.data) return null;
  return { ...frame.translation, carried_from: { page_id: frame.id, reason: 'whole frame, same text', issue: 7605 } };
}

/**
 * The timestamps a leaf takes when the swap makes it live. The keyword and embedding deltas key on
 * translation.updated_at / ocr.updated_at and skipped the leaf while it sat below zero, so one of them must move
 * now: the English's when there is English (the stale sweep then sees English newer than the OCR under it, as it
 * is), else the OCR's — an English book's leaf has no English, and without this it never reached keyword search
 * (#7605: 6a1b91a0…, 6a1dc12b…, 6a1b7d89… returned nothing). Never both: OCR newer than English reads as stale.
 */
export function swapStamps(leaf, now) {
  if (typeof leaf?.translation?.data === 'string' && leaf.translation.data.trim()) return { 'translation.updated_at': now };
  if (typeof leaf?.ocr?.data === 'string' && leaf.ocr.data.trim()) return { 'ocr.updated_at': now };
  return {};
}

/**
 * The `translatable` test the swap passes to leafNeeds/swapRefusal, built from translate-core's own two rules (passed
 * in, as above): a leaf is judged as the page it will be (its swapped-in number), and a leaf the lanes never translate
 * (#5154: an English book, whose reading text is its transcription, or an English page) needs no English. Without
 * the second rule an English book's swap waited for English the lanes will never write (#7605, 6a1b91a0…).
 */
export function swapTranslatable({ book, isTranslatablePage, sameLanguageReason }) {
  return (leaf) => {
    const page = { ...leaf, page_number: leafNumberOf(leaf) };
    const same = sameLanguageReason({ book, page });
    return same ? { ok: false, reason: same } : isTranslatablePage(page);
  };
}

/**
 * What a staged leaf still needs before the swap: 'ocr', 'translation', or null (ready).
 * `translatable(page)` is translate-core's isTranslatablePage, passed in so this module stays free of it.
 * A leaf whose OCR says there is nothing to translate (blank, a plate) is ready with its OCR alone.
 */
export function leafNeeds(leaf, translatable) {
  const hasOcr = typeof leaf?.ocr?.data === 'string' && leaf.ocr.data.trim().length > 0;
  if (!hasOcr && leaf?.ocr?.unreadable !== true) return 'ocr';
  const tr = translatable(leaf);
  if (!tr.ok) return null;
  const hasEnglish = typeof leaf?.translation?.data === 'string' && leaf.translation.data.trim().length > 0;
  return hasEnglish ? null : 'translation';
}

/**
 * Why a book's staged leaves may not be swapped in, or null.
 *  frames: the book's live pages now ({ id, page_number, ocr? }); leaves: its staged leaves.
 *  Refuses unless the staged run covers exactly the live pages, each frame's leaves are numbered without a gap,
 *  no frame's text changed since the stage, and every leaf has what leafNeeds() asks for.
 */
export function swapRefusal({ frames, leaves, translatable }) {
  if (!leaves.length) return 'no staged leaves';
  const runs = new Set(leaves.map((l) => l.staged_split?.run));
  if (runs.size !== 1) return `staged leaves from ${runs.size} runs: ${[...runs].join(', ')}`;
  const byFrame = new Map();
  for (const l of leaves) byFrame.set(l.staged_split.frame_id, [...(byFrame.get(l.staged_split.frame_id) || []), l]);
  const live = new Set(frames.map((f) => f.id));
  for (const id of byFrame.keys()) if (!live.has(id)) return `staged leaves name frame ${id}, which is not a live page now`;
  for (const f of frames) {
    if (!byFrame.has(f.id)) return `live page p.${f.page_number} (${f.id}) has no staged leaves`;
    if (byFrame.get(f.id)[0].staged_split.frame_ocr_hash !== frameOcrHash(f)) return `p.${f.page_number}: the spread's OCR changed since the stage`;
  }
  const nums = leaves.map(leafNumberOf).sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) return `staged leaf numbers are not 1..${nums.length} (at ${i + 1}: ${nums[i]})`;
  // Leaves must follow their frames' order: frame k's leaves come before frame k+1's.
  const frameOrder = new Map([...frames].sort((a, b) => a.page_number - b.page_number).map((f, i) => [f.id, i]));
  const sorted = [...leaves].sort((a, b) => leafNumberOf(a) - leafNumberOf(b));
  for (let i = 1; i < sorted.length; i++) {
    if (frameOrder.get(sorted[i].staged_split.frame_id) < frameOrder.get(sorted[i - 1].staged_split.frame_id)) return `leaf ${i + 1} comes from an earlier frame than leaf ${i}`;
  }
  const missing = { ocr: [], translation: [] };
  for (const l of sorted) { const need = leafNeeds(l, translatable); if (need) missing[need].push(leafNumberOf(l)); }
  if (missing.ocr.length) return `${missing.ocr.length} leaf/leaves have no OCR: ${missing.ocr.slice(0, 12).join(', ')}`;
  if (missing.translation.length) return `${missing.translation.length} leaf/leaves have no English: ${missing.translation.slice(0, 12).join(', ')}`;
  return null;
}

/** Frame id → its leaves' ids in reading order: the archived spread's split_into (#5842). */
export function splitIntoByFrame(leaves) {
  const out = new Map();
  for (const l of [...leaves].sort((a, b) => leafNumberOf(a) - leafNumberOf(b))) {
    out.set(l.staged_split.frame_id, [...(out.get(l.staged_split.frame_id) || []), l.id]);
  }
  return out;
}

/**
 * Old page number → the id of the leaf a citation of it should now open: the first leaf of that frame.
 * For the shortlink redirects written at the swap (codes seen in analytics_events for this book).
 */
export function firstLeafByOldNumber(frames, leaves) {
  const into = splitIntoByFrame(leaves);
  return new Map(frames.map((f) => [f.page_number, into.get(f.id)?.[0] ?? null]));
}
