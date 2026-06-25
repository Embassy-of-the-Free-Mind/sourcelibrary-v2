/**
 * Strip EDITORIAL page-level wrapper blocks — content and all — from
 * OCR/translation text before it is embedded, indexed for snippets, or
 * quoted back to a reader.
 *
 * The translation format wraps each page in AI-written <meta> / <summary> /
 * <keywords> / <vocab> blocks that *describe* the page. They routinely name
 * content from ADJACENT pages ("the previous page focused on perpetual motion
 * wheels using mercury…"), so they are never verbatim source text. If the tag
 * is stripped but the inner prose kept (the old `replace(/<[^>]+>/g, '')`
 * mistake), that description gets embedded and served as a quotable snippet —
 * producing citations to words that aren't on the page (Nirmal's "mercury on
 * page 89" misquote, 2026-05-30; see PR #2232).
 *
 * The OCR format adds its own PAGE-LEVEL metadata envelope — <language>,
 * <scan-quality>, <script>, <page-type>, <columns>, <warning> — that likewise
 * *describes* the page/scan rather than transcribing it (the same tags the
 * enrich-worker skips, enrich-worker.mjs). Serving "<scan-quality>good</…>" as
 * a transcription is the same class of fabrication, so these are stripped too.
 *
 * Call this BEFORE the generic tag strip. Inline glosses (note/term/margin/
 * gloss/unclear) and real page marks that happen to sit outside the body flow
 * (header/catchword/sig/page-num — actual printed text, not AI description) are
 * intentionally left for the caller to handle and are safe to keep.
 *
 * IMPORTANT: every search/snippet surface reads its own copy of the page text
 * (web /api/search, /api/books/[id]/search, the librarian, embeddings, the
 * eval, the IIIF annotation + content-search routes). Fixes do NOT propagate
 * between them — route every text-cleaning path through this helper so the leak
 * can't reopen on one surface.
 */

// Translation-side page-description blocks ∪ OCR-side page-level metadata
// envelope. All *describe* the page; none are verbatim source text.
const EDITORIAL_WRAPPERS =
  'meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning';

/**
 * Flatten GFM markdown tables to plain text.
 *
 * OCR/translation of tabular pages — most often the alphabetical "tavola"/index
 * of a book — is stored as a markdown table, frequently with an EMPTY header row
 * (`| | |` + `|---|---|`). In the reader that renders fine (react-markdown +
 * remark-gfm), but every *snippet/quote* surface serves plain text, so the table
 * leaks as raw pipe-soup: "# TABLE OF | | | |---|---| | Luigi Pulci s. | 493 |".
 * Flatten each row to readable text ("Luigi Pulci s.  493") and drop the
 * separator/empty-header scaffolding. Only the snippet/quote path routes through
 * here — the reader keeps the real markdown and is unaffected.
 */
function flattenMarkdownTables(text: string): string {
  return text
    // Drop GFM alignment/separator rows (cells are only dashes + optional colons).
    .replace(/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/gm, '')
    // Flatten remaining table rows "| a | b |" → "a  b"; drop empty cells so an
    // empty header row collapses to nothing rather than a row of blanks.
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, inner: string) =>
      inner.split('|').map(c => c.trim()).filter(Boolean).join('  '))
    // Collapse the blank lines those removals leave behind.
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
}

export function stripEditorialWrappers(text: string): string {
  if (!text) return text;
  return flattenMarkdownTables(
    text
      // Paired blocks, content and all (multiline). Backreference keeps it from
      // swallowing text between two different wrapper types.
      .replace(new RegExp(`<(${EDITORIAL_WRAPPERS})>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
      // Any orphan opening/closing wrapper tag left by malformed AI output.
      .replace(new RegExp(`<\\/?(?:${EDITORIAL_WRAPPERS})>`, 'gi'), ' '),
  );
}
