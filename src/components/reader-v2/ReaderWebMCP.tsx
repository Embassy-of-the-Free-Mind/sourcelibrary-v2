'use client';

import { useWebMCPTools } from '@/hooks/useWebMCPTools';
import { textResult, type WebMCPTool } from '@/lib/webmcp';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import type { useReaderV2 } from './useReaderV2';

type ReaderState = ReturnType<typeof useReaderV2>;

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');

/**
 * Registers WebMCP tools scoped to the open book, so in-browser agents
 * (Gemini in Chrome, ChatGPT Desktop, …) can page through the reader, read
 * the current page's text, mint a citation, and search within the book —
 * instead of scraping the DOM. Renders nothing; no-ops in browsers without
 * WebMCP. All tools are read-only (issue #4594): they call the same
 * same-origin APIs the reader UI already calls, in the user's own session,
 * so auth, metering and rate limits apply unchanged.
 */
export default function ReaderWebMCP({ r }: { r: ReaderState }) {
  useWebMCPTools((): WebMCPTool[] => {
    const { book, currentPage, pageList, totalPages } = r;
    const bookLabel = `"${book.display_title || book.title}"${book.author ? ` by ${book.author}` : ''}`;

    return [
      {
        name: 'go_to_page',
        description:
          `Turn the reader to a printed page number of the open book, ${bookLabel} ` +
          `(${totalPages} pages). Use get_current_page_text afterwards to read it.`,
        inputSchema: {
          type: 'object',
          properties: {
            page_number: {
              type: 'number',
              description: 'The printed page number to open, starting at 1.',
            },
          },
          required: ['page_number'],
        },
        execute: (params) => {
          const n = Number(params.page_number);
          const target = pageList.find((p) => p.page_number === n);
          if (!target) {
            return textResult(
              `No page ${n} in this book — printed page numbers run 1 to ${totalPages}.`
            );
          }
          r.goToPage(target.id);
          return textResult(`Opened page ${n} of ${bookLabel}.`);
        },
      },
      {
        name: 'get_current_page_text',
        description:
          `Read the page the reader is currently showing in ${bookLabel}: ` +
          'the original transcription (OCR) and the English translation, when available.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: () => {
          // A tool result is a quotable text surface: route it through
          // stripEditorialWrappers like every other one (quote/search/text/
          // IIIF), or the AI-written <meta>/<warning>/… page descriptions get
          // served to the agent as if they were words on the page.
          const ocr = currentPage.ocr?.data
            ? stripEditorialWrappers(currentPage.ocr.data).trim()
            : '';
          const translation = currentPage.translation?.data
            ? stripEditorialWrappers(currentPage.translation.data).trim()
            : '';
          const parts = [
            `${bookLabel}, page ${currentPage.page_number} of ${totalPages}.`,
          ];
          if (translation) parts.push(`--- English translation ---\n${translation}`);
          if (ocr) parts.push(`--- Original text (${book.language || 'source language'}) ---\n${ocr}`);
          if (!ocr && !translation) {
            parts.push(
              'No text is available on this client for this page (it may be untranscribed, an image plate, or gated pending sign-in).'
            );
          }
          return textResult(parts.join('\n\n'));
        },
      },
      {
        name: 'get_citation',
        description:
          `Get a stable, shareable citation URL and a formatted reference for the page ` +
          `currently open in ${bookLabel}.`,
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: () => {
          // Built from the canonical /book/<slug>/page/<id> shape, not
          // window.location — the reader can be mounted on an /embed/… or
          // /es/… or design-preview path, none of which is the citable URL.
          const url = `${window.location.origin}/book/${r.bookPath}/page/${r.currentPageId}`;
          const line = [
            book.author,
            `"${book.display_title || book.title}"`,
            book.published ? `(${book.published})` : null,
            `p. ${currentPage.page_number}`,
            `Source Library, ${url}`,
          ]
            .filter(Boolean)
            .join(', ');
          return textResult(`${line}\n\nCitable URL: ${url}`);
        },
      },
      {
        name: 'search_this_book',
        description:
          `Full-text search within ${bookLabel} — matches both the original text and ` +
          'the English translation, returning page numbers you can open with go_to_page.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Words or a phrase to find in this book.' },
          },
          required: ['query'],
        },
        annotations: { readOnlyHint: true },
        execute: async (params) => {
          const query = String(params.query || '').trim();
          if (!query) return textResult('Provide a non-empty query.');
          const res = await fetch(
            `/api/books/${encodeURIComponent(book.id)}/search?q=${encodeURIComponent(query)}`
          );
          if (!res.ok) {
            return textResult(`Search failed (HTTP ${res.status}). Try again shortly.`);
          }
          const data = (await res.json()) as {
            total?: number;
            results?: Array<{
              pageNumber?: number;
              matches?: Array<{ field?: string; snippet?: string }>;
            }>;
          };
          const results = data.results || [];
          if (!results.length) {
            return textResult(`No matches for "${query}" in ${bookLabel}.`);
          }
          const lines = results.slice(0, 8).map((hit) => {
            const snippet = stripTags(hit.matches?.[0]?.snippet || '').trim();
            return `p. ${hit.pageNumber}: ${snippet}`;
          });
          const shown = Math.min(results.length, 8);
          return textResult(
            `${data.total ?? results.length} matching page(s) for "${query}" in ${bookLabel}` +
              ` — showing ${shown}:\n\n${lines.join('\n')}\n\nUse go_to_page to open one.`
          );
        },
      },
    ];
  }, [r.book.id]);

  return null;
}
