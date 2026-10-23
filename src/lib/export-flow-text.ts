/**
 * The plain-text download as one continuous reading text (#7118).
 *
 * PRIOR ART: src/lib/strip-editorial-wrappers.ts — flattens one page's markdown for quoting, but knows nothing of
 * page joins, and drops footnote calls and headings' standing as headings; src/lib/export-flow-epub.ts — the same
 * reading text as an EPUB, which this reuses rather than re-deriving (one join, one footnote rule, two outputs).
 *
 * The .txt download used to print each page's STORED text between rules: markdown (`**`, `####`, pipe tables), the
 * prompts' tags (`<note>`, `<margin>`, `<center>`) and a running head at every page top. This renders the continuous
 * edition's HTML instead, so the text reads as the /read view and the Kindle edition do: pages run together where the
 * sentence does, a page break is marked `[p. 12]` (citable, and distinct from a footnote call), notes become numbered
 * footnotes, and each illustration is marked where it stands with what it shows and a link to its page. Plain text
 * has no pop-up, so each note follows the paragraph that calls it, indented, rather than waiting at the end of a
 * forty-page section.
 */
import type { Db } from 'mongodb';
import { buildFlowEpub, footnotesFor } from '@/lib/export-flow-epub';
import { markdownToHtml } from '@/lib/export-markdown-html';
import { stripMarkupTags } from '@/lib/strip-markup-tags';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
const inline = (s: string) => decode(stripMarkupTags(s, '')).replace(/[ \t]+/g, ' ').trim();

/** One section of the continuous edition's HTML as plain text. */
export function flowHtmlToText(html: string): string {
  const notes = new Map<string, string>();
  let t = html
    // Footnotes (footnotesFor): the bodies are lifted out, the calls held as \u0001N\u0002 until the paragraphs are
    // laid out — a literal "[1]" may be the page's own printed reference.
    .replace(/<aside epub:type="footnote"[^>]*>\s*<p>\s*<a [^>]*>(\d+)\.<\/a>\s*([\s\S]*?)<\/p>\s*<\/aside>/g, (_, n, body) => {
      notes.set(n, inline(body));
      return '';
    })
    .replace(/<section class="footnotes">\s*<h3>Notes<\/h3>/g, '')
    .replace(/<a epub:type="noteref"[^>]*>(\d+)<\/a>/g, '\u0001$1\u0002')
    .replace(/<a class="page-marker"[^>]*>\|?(\d+)<\/a>/g, ' [p. $1] ')
    // A plain-text edition cannot carry a picture, so it says where one stands, what it shows, and where to see it
    // (the Project Gutenberg convention, with a link). Any other figure — an embedded image — has nothing to say.
    .replace(/<figure class="flow-figure flow-figure-link" data-page="(\d+)"><figcaption><a href="([^"]*)">[^<]*<\/a>(?:: )?([\s\S]*?)<\/figcaption><\/figure>/g,
      (_, n, href, caption) => `\n\n[Illustration, p. ${n}${inline(caption) ? `: ${inline(caption)}` : ''} — ${decode(href)}]\n\n`)
    .replace(/<figure[\s\S]*?<\/figure>/g, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_, level, s) => {
      const head = inline(s);
      return `\n\n${head}\n${(level <= '2' ? '=' : '-').repeat(Math.min([...head].length, 72))}\n\n`;
    })
    .replace(/<hr[^>]*>/g, '\n\n* * *\n\n')
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_, row) =>
      [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => inline(c[1].replace(/<br\/?>/g, ' '))).join(' | ') + '\n')
    .replace(/<\/table>/g, '\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, s) => `• ${inline(s.replace(/<br\/?>/g, ' '))}\n`)
    .replace(/<\/ul>|<\/ol>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n\n');
  return decode(stripMarkupTags(t, ''))
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(para => {
      const called = [...para.matchAll(/\u0001(\d+)\u0002/g)].map(m => m[1]);
      const text = para.replace(/\u0001(\d+)\u0002/g, '[$1]');
      return called.length ? `${text}\n${called.map(n => `    [${n}] ${notes.get(n) ?? ''}`.trimEnd()).join('\n')}` : text;
    })
    .join('\n\n');
}

/** One page's stored text as plain text, for the page-by-page original-and-translation download. */
export function pageToText(raw: string, seq: { n: number }): string {
  return raw.trim() ? flowHtmlToText(footnotesFor(markdownToHtml(raw), seq)) : '';
}

/**
 * The whole book as one continuous plain text, in the continuous edition's sections (the book's chapters, or runs
 * of 40 pages).
 */
export async function buildFlowText(
  db: Db,
  book: Parameters<typeof buildFlowEpub>[1],
  pages: Parameters<typeof buildFlowEpub>[2],
  opts: { text: 'translation' | 'ocr'; baseUrl: string },
): Promise<{ body: string; imagesTotal: number }> {
  const flow = await buildFlowEpub(db, book, pages, { ...opts, includeImages: false });
  flow.cleanup();
  const body = flow.chapters.map(ch => {
    const text = flowHtmlToText(ch.content);
    // A titled section opens with its own heading; an even run of pages gets its range as one.
    return /^<h2>/.test(ch.content) ? text : `${ch.title}\n${'-'.repeat([...ch.title].length)}\n\n${text}`;
  }).join(`\n\n\n${'─'.repeat(60)}\n\n`);
  return { body, imagesTotal: flow.imagesTotal };
}
