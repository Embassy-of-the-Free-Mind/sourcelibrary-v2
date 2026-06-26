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

/**
 * Strip residual markdown *markup* (not content) that leaks into plain-text
 * snippets/quotes alongside tables: ATX heading markers ("# TABLE OF" → "TABLE
 * OF", "### G" → "G"), paired asterisk emphasis ("**B**" → "B"), and the
 * "->centered<-" markers the reader pre-processes (e.g. "->THE END.<-"). The
 * reader renders these properly; only the plain-text path needs them gone.
 *
 * Deliberately conservative: emphasis must hug non-whitespace (real markdown
 * rule) so spaced-out literal asterisks survive, and underscore emphasis is left
 * alone — "_" appears too often as a literal in OCR/transliteration to strip safely.
 */
function stripMarkdownMarkers(text: string): string {
  return text
    // ATX headings: drop the leading #'s + space, keep the heading text.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    // Thematic-break rules (a whole line of only --- or ***). Underscore rules
    // are left alone to honour the "never touch _" guarantee below.
    .replace(/^[ \t]*(?:-{3,}|\*{3,})[ \t]*$/gm, '')
    // ->centered<- markers (content kept).
    .replace(/->\s*(.+?)\s*<-/g, '$1')
    // Paired bold/italic asterisks (content must start & end non-space).
    .replace(/\*\*\*(\S(?:[^*]*?\S)?)\*\*\*/g, '$1')
    .replace(/\*\*(\S(?:[^*]*?\S)?)\*\*/g, '$1')
    .replace(/\*(\S(?:[^*]*?\S)?)\*/g, '$1')
    // Collapse blank lines left by removed headings/rules.
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
}

/**
 * Collapse runaway lacuna fills and convert leaked LaTeX math to readable text.
 *
 * Two OCR-artifact classes reach readers/search/quotes as garbage text:
 *  1. Runaway dot/dash/underscore loops — papyrus and critical-edition lacunae
 *     the model reproduces character-for-character (sometimes thousands long).
 *     OCR prompt v14 prevents most at write-time; this is the read-time guard for
 *     legacy pages and any residual loop.
 *  2. LaTeX math leakage — literal `$\frac{a}{b}$` etc. rendered raw to readers.
 *
 * Safe for BOTH the reader (run before markdown) and the plain-text snippet/quote
 * surfaces. Deliberately leaves `$^{n}$` superscript spans alone — the reader
 * turns those into <sup>, and on snippet surfaces they're harmless. Markdown
 * table separator rows (`|---|`) are left intact (the dash guard skips any run
 * adjacent to a `|`). See issue #2764.
 */
export function cleanOcrArtifacts(text: string): string {
  if (!text) return text;
  return text
    // 1a. 12+ of the same dot-class char, optionally space-separated (". . . ."),
    //     collapse to a single […] lacuna marker.
    .replace(/([.·•…])(?:[ \t ]*\1){11,}/g, '[…]')
    // 1b. Blank-fill underscore runs (12+).
    .replace(/_{12,}/g, '[…]')
    // 1c. Dash rules (12+), incl. spaced ("- - - -"). The leading guard skips any
    //     run that starts adjacent to a `|` or another dash, so markdown table
    //     separators (`|------------|`) are never collapsed.
    .replace(/(?<![|\-–—])[-–—](?:[ \t ]*[-–—]){11,}(?![-–—|])/g, ' […]')
    // 2a. \frac{a}{b} (optionally $-wrapped) → (a)/(b); \sqrt{x} → √(x).
    .replace(/\$?\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}\$?/g, '($1)/($2)')
    .replace(/\$?\\sqrt\s*\{([^{}]*)\}\$?/g, '√($1)')
    // 2b. Common operators leaked as bare LaTeX commands.
    .replace(/\\times(?![a-z])/gi, '×')
    .replace(/\\cdot(?![a-z])/gi, '·')
    .replace(/\\div(?![a-z])/gi, '÷')
    .replace(/\\pm(?![a-z])/gi, '±')
    .replace(/\\(?:leq|le)(?![a-z])/gi, '≤')
    .replace(/\\(?:geq|ge)(?![a-z])/gi, '≥')
    .replace(/\\neq(?![a-z])/gi, '≠')
    .replace(/\\infty(?![a-z])/gi, '∞');
}

export function stripEditorialWrappers(text: string): string {
  if (!text) return text;
  // cleanOcrArtifacts runs LAST so lacuna/LaTeX cleanup applies to the final
  // plain text (after table flattening + marker stripping). Every snippet/quote
  // surface routes through here, so they all inherit the OCR safety net.
  return cleanOcrArtifacts(
    stripMarkdownMarkers(
      flattenMarkdownTables(
        text
          // Paired blocks, content and all (multiline). Backreference keeps it from
          // swallowing text between two different wrapper types.
          .replace(new RegExp(`<(${EDITORIAL_WRAPPERS})>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
          // Any orphan opening/closing wrapper tag left by malformed AI output.
          .replace(new RegExp(`<\\/?(?:${EDITORIAL_WRAPPERS})>`, 'gi'), ' '),
      ),
    ),
  );
}
