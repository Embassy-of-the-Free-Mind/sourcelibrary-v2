// PRIOR ART: scripts/lib/translate-batch-seam.mjs parseBlockResponse and translate-core
// parseBlockTranslations — split a block response on `<translation page="N">` wrappers, one
// self-contained translation per page; the #5021 drift reject (block-drift.mjs) drops a boundary
// whose clause moved across it. Neither can represent a sentence that legitimately RUNS across the
// break: the wrapper forces the model to end each page, which is the defect (#5678). translate-core
// PAGE_BREAK_* (#5103) — catchwords and split words at a break, resolved in the SOURCE before
// translation; nothing marks the break in the English. scripts/lib/leaf-break.mjs (#5260) — the
// self-closing in-text marker this one is modelled on (`<leaf-break/>`), but a leaf seam is a
// discontinuity no sentence may cross, the opposite case. None splits one continuous English text
// at markers into page spans plus the carried half-sentences a page view shows greyed.
/**
 * folio-markers — continuous English with the page turns marked inside it (#5678).
 *
 * The 84000 convention: "…in the desire realm [F.62.a] and the form realm…". The block
 * translator keeps the English continuous across its pages and writes `<pb n="35"/>` at the point
 * where source page 35 BEGINS, mid-sentence if need be. A page's evidentiary text is then the span
 * between its marker and the next one; a reading view flows straight through them.
 *
 * For a page view the span is shown at full strength with, greyed, the half-sentence carried
 * from a neighbour: `head` (the start of a sentence the previous page began and this page
 * finishes) and `tail` (the end of a sentence this page begins and the next page finishes).
 *
 * Pure: no I/O. The prompt wording lives in translate-core (FOLIO_MARKER_RULE) beside the other
 * page-break rules.
 */

/** One marker: `<pb n="35"/>`, tolerant of spacing and quote style. */
export const FOLIO_MARKER_RE = /<pb\s+n\s*=\s*["']?(\d+)["']?\s*\/?>/g;

/** Editorial blocks that are not running text: removed before the text is split. */
const EDITORIAL_RE = /<(summary|keywords|meta|vocab|warning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;

/**
 * A sentence (or verse-line group) ends at . ! ? (optionally followed by a closing quote or
 * bracket) before whitespace or the end of text, or at a blank line. Verse renderings often end a
 * stanza without a full stop, so the paragraph break counts.
 */
const SENTENCE_END_RE = /[.!?…]["'”’)\]]*(?=\s|$)|\n\s*\n/g;

/** True when `text` (trimmed) ends a sentence. */
export function endsSentence(text) {
  const t = String(text || '').replace(/<\/?(note|term|gloss|margin|insert|unclear)[^>]*>/gi, '').trimEnd();
  return !t || /[.!?…:]["'”’)\]]*$/.test(t);
}

/**
 * Remove the response wrapper and the editorial blocks, keeping the running text and its inline
 * tags (<note>, <term>…). Accepts a bare text or one wrapped in `<translation>…</translation>`.
 */
export function continuousBody(responseText) {
  let t = String(responseText || '');
  const wrapped = t.match(/<translation(?:\s[^>]*)?>([\s\S]*?)<\/translation>/i);
  if (wrapped) t = wrapped[1];
  return t.replace(EDITORIAL_RE, '').trim();
}

/** The trailing unfinished sentence of a span ('' when it ends on a sentence boundary). */
export function trailingFragment(span) {
  const s = String(span || '').trimEnd();
  if (endsSentence(s)) return '';
  let last = 0;
  for (const m of s.matchAll(SENTENCE_END_RE)) last = m.index + m[0].length;
  return s.slice(last).trim();
}

/** The leading text of a span up to and including its first sentence end (the whole span if none). */
export function leadingFragment(span) {
  const s = String(span || '').trimStart();
  SENTENCE_END_RE.lastIndex = 0;
  const m = SENTENCE_END_RE.exec(s);
  SENTENCE_END_RE.lastIndex = 0;
  return (m ? s.slice(0, m.index + m[0].length) : s).trim();
}

/**
 * Split one continuous, marked English text into page spans.
 *
 * Markers are read by POSITION, not by their `n` (#5678 seam A/B, PR #5701): on OCR'd books the
 * model often numbers a marker by the printed page number in the OCR's `<page-num>` (`<pb n="97"/>`
 * for sequence page 21), and Flash-Lite often leaves out the opening marker and starts straight in
 * on the first page's text. The k-th marker is the k-th page start whatever its number says. The
 * readings, in order:
 *   - `literal`        one marker per page, numbered as asked, nothing before the first;
 *   - `renumbered`     one marker per page, numbers wrong or out of order: taken in text order
 *                      (text before the first marker, if any, joins the first page);
 *   - `opener-missing` one marker short and running text before the first marker: that text is the
 *                      first page (its span starts at offset 0) and the markers are the page turns —
 *                      unless the numbers are the sequence and name the first page, which is `partial`;
 *   - `partial`        fewer markers still, but every one carries a page number of this block, in
 *                      order: the numbers are the sequence, so the unmarked page is known and left
 *                      empty (Tengyur vol 96 p123, #5682). The page before it runs on to the next
 *                      marker, so it holds the unmarked page's English too: listed in `overrun`;
 *   - `rejected`       anything else (too many markers, or too few with no way to tell which turn is
 *                      unmarked): every page is left empty and `rejected` says why.
 *
 * @param {string} responseText  the model's response (wrapper and editorial blocks allowed)
 * @param {number[]} pageNumbers the block's pages, in order — the markers the text must carry
 * @returns {{
 *   continuous: string,               body with markers, editorial blocks removed
 *   pages: { page_number: number, span: string, head: string, tail: string,
 *            marker_offset: number|null, marker_fraction: number|null }[],
 *   reading: 'literal'|'renumbered'|'opener-missing'|'partial'|'rejected',
 *   rejected: string|null,
 *   missing: number[],                 pages left without a span
 *   overrun: number[],                 pages whose span runs on over a `missing` page that follows
 *   duplicated: number[], unexpected: number[], outOfOrder: boolean,   what the NUMBERS said
 *   leading: string                    text before the first marker
 * }}
 *
 * `marker_offset` is where the page starts in the continuous text with all markers removed (0 for a
 * first page whose marker was omitted); `marker_fraction` is that offset over the total length. A
 * page without a span gets nulls and is listed in `missing` — it is never silently given a
 * neighbour's text. `head` / `tail` are empty when the break falls on a sentence boundary.
 */
export function parseFolioMarkedText(responseText, pageNumbers) {
  const nums = pageNumbers.map(Number);
  const continuous = continuousBody(responseText);
  const markers = [...continuous.matchAll(FOLIO_MARKER_RE)].map((m) => ({ n: Number(m[1]), index: m.index, length: m[0].length }));

  // What the numbers say — diagnostics only, except for the `partial` reading.
  const wanted = new Set(nums);
  const seen = new Set();
  const duplicated = [];
  const unexpected = [];
  for (const m of markers) {
    if (!wanted.has(m.n)) unexpected.push(m.n);
    else if (seen.has(m.n)) duplicated.push(m.n);
    else seen.add(m.n);
  }
  const valid = markers.filter((m) => wanted.has(m.n));
  const outOfOrder = valid.some((m, i) => i > 0 && nums.indexOf(m.n) < nums.indexOf(valid[i - 1].n));

  const clean = (t) => t.replace(FOLIO_MARKER_RE, '').trim();
  const leading = clean(markers.length ? continuous.slice(0, markers[0].index) : continuous);
  const hasLead = leading.replace(/<[^>]+>/g, '').trim().length > 0;
  const numbersAreSequence = markers.length > 0 && !unexpected.length && !duplicated.length && !outOfOrder;

  // starts: one per page that has a span — { n, at (index in `continuous`), from (where its text starts) }
  let reading;
  let rejected = null;
  let starts = [];
  if (markers.length === nums.length) {
    reading = numbersAreSequence && !hasLead ? 'literal' : 'renumbered';
    starts = markers.map((m, i) => (i === 0 && hasLead ? { n: nums[0], at: 0, from: 0 } : { n: nums[i], at: m.index, from: m.index + m.length }));
  } else if (markers.length === nums.length - 1 && hasLead && !(numbersAreSequence && markers[0].n === nums[0])) {
    // (when the numbers ARE the sequence and the first page's marker is there, the opener was not
    // omitted: the lead is a stray heading or note and the unmarked page is an inner one — `partial`)
    reading = 'opener-missing';
    starts = [{ n: nums[0], at: 0, from: 0 }, ...markers.map((m, i) => ({ n: nums[i + 1], at: m.index, from: m.index + m.length }))];
  } else if (markers.length < nums.length && numbersAreSequence) {
    reading = 'partial';
    starts = markers.map((m) => ({ n: m.n, at: m.index, from: m.index + m.length }));
  } else {
    reading = 'rejected';
    rejected = `${markers.length} marker(s) for ${nums.length} page(s)${hasLead ? '' : ', none missing at the opening'}`;
  }

  // Plain text (markers removed) and each page start's offset in it.
  const plainOffset = (index) => {
    let removed = 0;
    for (const m of markers) { if (m.index < index) removed += m.length; }
    return index - removed;
  };
  const total = continuous.replace(FOLIO_MARKER_RE, '').length;
  const byPage = new Map(starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : continuous.length;
    return [s.n, { span: clean(continuous.slice(s.from, end)), offset: plainOffset(s.at) }];
  }));

  const pages = nums.map((n) => {
    const s = byPage.get(n);
    return { page_number: n, span: s?.span || '', head: '', tail: '', marker_offset: s ? s.offset : null, marker_fraction: s && total ? s.offset / total : null };
  });
  // Carried half-sentences between neighbours that both have a span.
  for (let i = 0; i < pages.length; i++) {
    const prev = pages[i - 1];
    const next = pages[i + 1];
    if (prev?.span && pages[i].span) pages[i].head = trailingFragment(prev.span);
    if (next?.span && pages[i].span && !endsSentence(pages[i].span)) pages[i].tail = leadingFragment(next.span);
  }
  const missing = nums.filter((n) => !byPage.has(n));
  const overrun = reading === 'partial' ? nums.filter((n, i) => byPage.has(n) && i + 1 < nums.length && !byPage.has(nums[i + 1])) : [];
  return { continuous, pages, reading, rejected, missing, overrun, duplicated, unexpected, outOfOrder, leading };
}
