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
const STARTS_LOWER = /^[\s"'“‘«(\[]*\p{Ll}/u;
const HYPHENATED = /\p{L}[-‐]$/u;

/** Does the text ending `prev` carry on into the text starting `next`? */
export function continuesAcross(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  return !SENTENCE_END.test(prev) || STARTS_LOWER.test(next);
}

export function pageMarker(n: number, href: string): string {
  return `<a class="page-marker" id="p${n}" href="${escapeAttr(href)}" aria-label="Page ${n}, open with the scan">${n}</a>`;
}

export function joinPagesHtml(pages: FlowPage[]): string {
  let out = '';
  let outIsBlock = false;
  let pending = '';
  for (const p of pages) {
    const marker = pending + pageMarker(p.n, p.href);
    pending = '';
    const html = p.html?.trim();
    if (!html) { pending = marker; continue; }

    const prevPara = out.endsWith('</p>') ? out.slice(out.lastIndexOf('<p>') + 3, -4) : null;
    const nextPara = html.startsWith('<p>') ? html.slice(3, html.indexOf('</p>') < 0 ? undefined : html.indexOf('</p>')) : null;
    const prevText = prevPara === null ? '' : textOf(prevPara);
    const nextText = nextPara === null ? '' : textOf(nextPara);
    const join = !p.block && !outIsBlock && prevPara !== null && nextPara !== null && continuesAcross(prevText, nextText);

    if (join && HYPHENATED.test(prevText) && STARTS_LOWER.test(nextText)) {
      // "trea-" | "tise of" → "treatise" + marker, so the marker never splits a word.
      const rest = html.slice(3);
      const cut = rest.search(/[\s<]/);
      const word = cut < 0 ? rest : rest.slice(0, cut);
      out = out.slice(0, -4).replace(/[-‐]$/, '') + word + marker + (cut < 0 ? '' : rest.slice(cut));
    } else if (join) {
      out = out.slice(0, -4) + ' ' + marker + ' ' + html.slice(3);
    } else {
      const withMarker = html.startsWith('<p>') ? `<p>${marker}${html.slice(3)}` : marker + html;
      out += (out ? '\n' : '') + withMarker;
    }
    outIsBlock = !!p.block;
  }
  if (pending) out += pending;
  return out;
}
