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
 * @param {string} responseText  the model's response (wrapper and editorial blocks allowed)
 * @param {number[]} pageNumbers the block's pages, in order — the markers the text must carry
 * @returns {{
 *   continuous: string,               body with markers, editorial blocks removed
 *   pages: { page_number: number, span: string, head: string, tail: string,
 *            marker_offset: number|null, marker_fraction: number|null }[],
 *   missing: number[], duplicated: number[], unexpected: number[], outOfOrder: boolean,
 *   leading: string                    text before the first marker (should be empty)
 * }}
 *
 * `marker_offset` is the page's marker position in the continuous text with all markers removed;
 * `marker_fraction` is that offset over the total length. A page whose marker is missing gets an
 * empty span and nulls, and is listed in `missing` — it is never silently given a neighbour's text.
 * `head` / `tail` are empty when the break falls on a sentence boundary.
 */
export function parseFolioMarkedText(responseText, pageNumbers) {
  const continuous = continuousBody(responseText);
  const markers = [...continuous.matchAll(FOLIO_MARKER_RE)].map((m) => ({ n: Number(m[1]), index: m.index, length: m[0].length }));
  const wanted = new Set(pageNumbers.map(Number));
  const seen = new Map();
  const duplicated = [];
  const unexpected = [];
  for (const m of markers) {
    if (!wanted.has(m.n)) { unexpected.push(m.n); continue; }
    if (seen.has(m.n)) { duplicated.push(m.n); continue; }
    seen.set(m.n, m);
  }
  const ordered = pageNumbers.map(Number).filter((n) => seen.has(n));
  const outOfOrder = ordered.some((n, i) => i > 0 && seen.get(n).index < seen.get(ordered[i - 1]).index);

  // Plain text (markers removed) and each kept marker's offset in it.
  const plainOffset = (index) => {
    let removed = 0;
    for (const m of markers) { if (m.index < index) removed += m.length; }
    return index - removed;
  };
  const plain = continuous.replace(FOLIO_MARKER_RE, '');
  const total = plain.length;

  // Spans: from each kept marker to the next kept marker in text order.
  const byPosition = ordered.map((n) => seen.get(n)).sort((a, b) => a.index - b.index);
  const spanOf = new Map();
  byPosition.forEach((m, i) => {
    const end = i + 1 < byPosition.length ? byPosition[i + 1].index : continuous.length;
    spanOf.set(m.n, continuous.slice(m.index + m.length, end).replace(FOLIO_MARKER_RE, '').trim());
  });
  const leading = byPosition.length ? continuous.slice(0, byPosition[0].index).replace(FOLIO_MARKER_RE, '').trim() : continuous;

  const pages = pageNumbers.map(Number).map((n) => {
    const m = seen.get(n);
    const offset = m ? plainOffset(m.index) : null;
    return { page_number: n, span: spanOf.get(n) || '', head: '', tail: '', marker_offset: offset, marker_fraction: m && total ? offset / total : null };
  });
  // Carried half-sentences between neighbours that both have a span.
  for (let i = 0; i < pages.length; i++) {
    const prev = pages[i - 1];
    const next = pages[i + 1];
    if (prev?.span && pages[i].span) pages[i].head = trailingFragment(prev.span);
    if (next?.span && pages[i].span && !endsSentence(pages[i].span)) pages[i].tail = leadingFragment(next.span);
  }
  return { continuous, pages, missing: pageNumbers.map(Number).filter((n) => !seen.has(n)), duplicated, unexpected, outOfOrder, leading };
}
