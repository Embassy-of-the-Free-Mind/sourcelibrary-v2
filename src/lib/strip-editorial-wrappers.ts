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
 * Call this BEFORE the generic tag strip. Inline glosses (note/term/margin/
 * gloss/unclear) are intentionally left for the caller to handle — they sit on
 * real body text and are safe to keep.
 *
 * IMPORTANT: every search/snippet surface reads its own copy of the page text
 * (web /api/search, /api/books/[id]/search, the librarian, embeddings, the
 * eval). Fixes do NOT propagate between them — route every text-cleaning path
 * through this helper so the leak can't reopen on one surface.
 */

const EDITORIAL_WRAPPERS = 'meta|summary|keywords|vocab';

export function stripEditorialWrappers(text: string): string {
  if (!text) return text;
  return text
    // Paired blocks, content and all (multiline). Backreference keeps it from
    // swallowing text between two different wrapper types.
    .replace(new RegExp(`<(${EDITORIAL_WRAPPERS})>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
    // Any orphan opening/closing wrapper tag left by malformed AI output.
    .replace(new RegExp(`<\\/?(?:${EDITORIAL_WRAPPERS})>`, 'gi'), ' ');
}
