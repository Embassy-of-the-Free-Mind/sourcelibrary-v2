// PRIOR ART: src/app/book/[id]/read/page.tsx renders one <section> per page (a hard break at every page);
// src/lib/export-markdown-html.ts makes each page's HTML and is reused unchanged. Nothing joined pages.
/**
 * Join pages into one continuous reading text (#7118).
 *
 * A printed page ends wherever the paper ran out, not where the sentence did. Rendered one
 * section per page, a sentence that crosses a page is cut in two by a rule and a heading. Here a
 * page whose text ends mid-sentence runs straight into the next page's first paragraph, and
 * the page boundary becomes a small marker linking to that page in the reader (scan beside it).
 * A page whose text ends a sentence still starts a new paragraph — the join never invents one.
 *
 * Input HTML is `markdownToHtml` output: blocks (`<p>…</p>`, headings, tables) joined by `\n`.
 * A page marked `block` (e.g. an untranslated page shown in its original language) is never
 * joined into or out of: running Latin into English would read as one passage.
 */

export interface FlowPage {
  n: number;
  /** The page's HTML, or null when the page has no text (its marker joins the next page). */
  html: string | null;
  /** Reader URL for this page. */
  href: string;
  block?: boolean;
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** Ends a sentence: terminal punctuation, optionally closed by quotes or brackets. */
const SENTENCE_END = /[.!?…:;][\s"'”’»)\]]*$/u;
const STARTS_LOWER = /^[\s"'“‘«(\[]*(?:\.\.\.|…)?\s*\p{Ll}/u;
/** The translation's own continuation marks at a page edge ("…we may reach"): a seam artifact, not text. */
const ELLIPSIS_START = /^\s*(?:\.\.\.|…)\s*/;
const ELLIPSIS_END = /\s*(?:\.\.\.|…)\s*$/;
const SHORT_PARA = 40;
const HYPHENATED = /\p{L}[-‐]$/u;

/** A paragraph that is wholly an editorial bracket ("[Blank page]", "[A woodcut of …]") is never prose to join. */
const BRACKETED = /^\[[^\]]*\]$/;
/** Page furniture the translation kept as a line of its own (measured on Fludd, Giorgi, Kircher, 2026-10-22):
 *  a running head at the top of a page ("PROLOGUE.", "INDEX") and a signature mark at the foot ("a iij", "b"). */
const RUNNING_HEAD = /^[^\p{Ll}]*\p{Lu}[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u;
const SIGNATURE = /^(?:\*{1,3}|[A-Za-z]{1,3})\s?(?:\d{1,2}|[ivxj]{1,5})?$/;

/** Does the text ending `prev` carry on into the text starting `next`? */
export function continuesAcross(prev: string, next: string): boolean {
  if (!prev || !next || BRACKETED.test(prev) || BRACKETED.test(next)) return false;
  if (ELLIPSIS_END.test(prev) && ELLIPSIS_START.test(next)) return true;
  // A short unpunctuated paragraph before a capital is a title or heading ("THE MARRIAGE of HEAVEN and HELL"), not prose.
  if (prev.length < SHORT_PARA && !STARTS_LOWER.test(next)) return false;
  return !SENTENCE_END.test(prev) || STARTS_LOWER.test(next);
}

/** Drop a trailing signature line from the paragraph that ends a page (only when it has text before it). */
function trimFoot(para: string): string {
  const lines = para.split('<br/>');
  if (lines.length > 1 && SIGNATURE.test(textOf(lines[lines.length - 1]))) lines.pop();
  return lines.join('<br/>');
}
const firstLine = (html: string) => (html.startsWith('<p>') ? textOf(html.slice(3).split(/<br\/>|<\/p>/)[0]) : '');
/** Drop a leading running-head line from the paragraph that starts a page (only when it has text after it).
 *  A capitals line counts as a running head when it opens two or more pages in the run (a chapter title opens
 *  one), or when the line under it carries on in lower case ("PROLOGUE." / "truly harmonious") — no title does. */
function trimHead(para: string, heads: Set<string>): string {
  const lines = para.split('<br/>');
  if (lines.length < 2) return para;
  const first = textOf(lines[0]);
  if (heads.has(first) || (first.length <= 60 && RUNNING_HEAD.test(first) && STARTS_LOWER.test(textOf(lines[1])))) lines.shift();
  return lines.join('<br/>');
}
/** A running head the translation set as a paragraph of its own: drop that first block. */
function dropHeadBlock(html: string, heads: Set<string>): string {
  const end = html.indexOf('</p>');
  if (!html.startsWith('<p>') || end < 0 || !heads.has(textOf(html.slice(3, end)))) return html;
  return html.slice(end + 4).trimStart();
}

/** Trailing whitespace and line breaks off, without a `$`-anchored regex (that rescans every run of spaces). */
function trimEndBreaks(s: string): string {
  for (;;) {
    const t = s.trimEnd();
    if (t.endsWith('<br/>')) s = t.slice(0, -5);
    else return t;
  }
}

export function pageMarker(n: number, href: string): string {
  return `<a class="page-marker" id="p${n}" href="${escapeAttr(href)}" aria-label="Page ${n}, open with the scan">${n}</a>`;
}

export function joinPagesHtml(pages: FlowPage[]): string {
  let out = '';
  let outIsBlock = false;
  let pending = '';
  const seen = new Map<string, number>();
  for (const p of pages) {
    const line = p.html ? firstLine(p.html.trim()) : '';
    if (line && line.length <= 60 && RUNNING_HEAD.test(line)) seen.set(line, (seen.get(line) || 0) + 1);
  }
  const heads = new Set([...seen].filter(([, k]) => k >= 2).map(([line]) => line));
  for (const p of pages) {
    const marker = pending + pageMarker(p.n, p.href);
    pending = '';
    const whole = p.html?.trim();
    if (!whole) { pending = marker; continue; }
    // Joined, a running head set as its own paragraph goes; unjoined, the page keeps it.
    const dropped = dropHeadBlock(whole, heads);
    const html = dropped.startsWith('<p>') ? dropped : whole;

    const prevStart = out.endsWith('</p>') ? out.lastIndexOf('<p>') + 3 : -1;
    const nextEnd = html.startsWith('<p>') ? (html.indexOf('</p>') < 0 ? html.length : html.indexOf('</p>')) : -1;
    // Furniture is trimmed only for the join test and a join; a page that does not join keeps every line.
    const prevPara = prevStart < 0 ? null : trimFoot(out.slice(prevStart, -4));
    const nextPara = nextEnd < 0 ? null : trimHead(html.slice(3, nextEnd), heads);
    // Only the edges decide a join; testing whole paragraphs is quadratic on OCR's long runs of spaces.
    const prevText = prevPara === null ? '' : textOf(prevPara.slice(-400));
    const nextText = nextPara === null ? '' : textOf(nextPara.slice(0, 400));
    const join = !p.block && !outIsBlock && prevPara !== null && nextPara !== null && continuesAcross(prevText, nextText);

    if (join) {
      let head = out.slice(0, prevStart) + trimEndBreaks(prevPara as string);
      const lead = (nextPara as string).replace(/^(?:\s|<br\/>)+/, '');
      const rest = lead.replace(ELLIPSIS_START, '') + html.slice(nextEnd);
      const elided = rest.length !== lead.length + html.length - nextEnd;
      if (elided) head = head.slice(0, -40) + head.slice(-40).replace(ELLIPSIS_END, '');
      if (!elided && HYPHENATED.test(prevText) && STARTS_LOWER.test(nextText) && /[-‐]$/.test(head.slice(-1))) {
        // "trea-" | "tise of" → "treatise" + marker, so the marker never splits a word.
        const cut = rest.search(/[\s<]/);
        const word = cut < 0 ? rest : rest.slice(0, cut);
        out = head.slice(0, -1) + word + marker + (cut < 0 ? '' : rest.slice(cut));
      } else {
        out = head + ' ' + marker + ' ' + rest;
      }
    } else {
      const withMarker = whole.startsWith('<p>') ? `<p>${marker}${whole.slice(3)}` : marker + whole;
      out += (out ? '\n' : '') + withMarker;
    }
    outIsBlock = !!p.block;
  }
  if (pending) out += pending;
  return out;
}
