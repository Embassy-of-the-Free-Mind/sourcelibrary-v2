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
// envelope ∪ AI image descriptions. All *describe* the page; none are verbatim
// source text. `image-desc` is an AI-written account of a plate/diagram (e.g.
// "a complex nine-pointed star (enneagram)…" on Morestel p.39) — quoting it
// fabricates a citation to words that aren't in the source. The reader keeps
// these as captions via NotesRenderer's own <image-desc> handling; only the
// quote/search/text/IIIF surfaces route through here, so stripping it here does
// not touch the reader.
const EDITORIAL_WRAPPERS =
  // `lang` is the OCR-prompt alias of `language` (src/lib/types/prompt.ts emits
  // `<lang>`); without it, `<lang>Hindustani</lang>` survives into quotable text.
  // Listed after `language` so the longer alternative wins the alternation.
  'meta|summary|keywords|vocab|language|lang|scan-quality|script|page-type|columns|warning|image-desc'
  // The EPIGRAPHY/ARTIFACT schema, used by tablet, papyrus and manuscript-fragment
  // records. `<condition>` in particular is a paragraph of English prose about the
  // OBJECT ("The image shows multiple fragments (K.2421, K.2511, K.16765) from the
  // British Museum collection..."), which is editorial description, not the text on
  // the page — quoting it fabricates a citation exactly as `<meta>` did (#2232).
  //
  // Deliberately NOT included: `<transliteration>`, which holds the real
  // line-by-line reading of the artifact and IS the page's text; and `<notes>` /
  // `<confidence>`, whose contents were not verified, so they are left alone rather
  // than guessed at.
  //
  // SCOPE, measured 2026-08-03: 5 pages across 4 books (Ur III Administrative
  // Tablet, Code of Hammurabi, Neo-Assyrian Medical Prescriptions, Manishtusu
  // Obelisk) — zero hits in a random 30,240-page sample. Small, but a fabricated
  // citation is a fabricated citation.
  + '|condition|period|surface|genre';

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
 *
 * BOUNDED interiors, not lazy-unbounded (2026-07-18): the emphasis/centered
 * patterns originally used `[^*]*?` / `.+?` interiors. On junk pages (the
 * ~50k-word single-page ingest dumps, which can also carry thousands of stray
 * asterisks) every unpaired `*` triggered an O(line)-scan and the whole call
 * went quadratic — the ngram batch build sat 2h at 111% CPU inside this
 * function on one page, and the same text served through a reader/quote route
 * would spin that request. Real emphasis and ->centered<- spans are short and
 * never cross a line, so interiors are capped at 300 chars and excluded from
 * matching newlines; longer spans keep their literal markers (harmless).
 */
function stripMarkdownMarkers(text: string): string {
  return text
    // ATX headings: drop the leading #'s + space, keep the heading text.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    // Thematic-break rules (a whole line of only --- or ***). Underscore rules
    // are left alone to honour the "never touch _" guarantee below.
    .replace(/^[ \t]*(?:-{3,}|\*{3,})[ \t]*$/gm, '')
    // ->centered<- markers (content kept).
    .replace(/->[ \t]*(\S(?:[^\n]{0,300}?\S)?)[ \t]*<-/g, '$1')
    // Paired bold/italic asterisks (content must start & end non-space).
    .replace(/\*\*\*(\S(?:[^*\n]{0,300}?\S)?)\*\*\*/g, '$1')
    .replace(/\*\*(\S(?:[^*\n]{0,300}?\S)?)\*\*/g, '$1')
    .replace(/\*(\S(?:[^*\n]{0,300}?\S)?)\*/g, '$1')
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
/**
 * Strip a leading CONVERSATIONAL AI preamble from OCR/translation text.
 *
 * Early OCR batches (Dec 2025 era) asserted the book's language in the prompt;
 * when that metadata was wrong, Gemini prepended an untagged disclaimer before
 * the transcription — "Note: The text in the image is in French, not Latin.
 * I have transcribed it exactly as it appears…" — which then rendered in the
 * reader and every quote/snippet surface indistinguishable from source text.
 * The same class covers "Here is the transcription:" prefaces and outright
 * refusals ("I'm sorry, I cannot…"). None of it sits inside a wrapper tag, so
 * the editorial strip can't catch it; this is the read-time guard for that
 * frozen legacy data (the OCR prompt's output contract forbids untagged
 * commentary at write time going forward).
 *
 * Deliberately conservative to protect real page text: only the leading
 * paragraph(s), each capped at 500 chars, and only when a conversational
 * opener AND self-referential transcription vocabulary ("I have transcribed",
 * "the image", "as requested"…) BOTH appear. A printed editorial note that
 * merely begins with "Note:" survives unless it also talks about "the image"
 * or transcribing in the first person.
 */
const PREAMBLE_OPENER =
  /^(?:\*\*)?(?:note[:,]|sure[,!:]|certainly|okay|of course|here (?:is|are)\b|here's\b|i(?:'ve| have)\b|i(?:'m| am)\b|i(?:'ll| will)\b|i apologize|i can(?:no|')t\b|please\b|if you\b|the text (?:in|on|of) th(?:e|is) (?:image|page|scan)\b)/i;
const PREAMBLE_META_VOCAB =
  /\b(?:transcri(?:be|bed|bing|ption)|ocr|the image|this image|image provided|you (?:provided|requested)|as requested|as it appears|i apologize|i(?:'m| am) sorry|cannot assist|unable to assist)\b/i;

function stripLeadingAiPreamble(text: string): string {
  let out = text;
  // Up to 3 leading paragraphs ("Note: …" followed by "Here is the transcription:").
  for (let i = 0; i < 3; i++) {
    const trimmed = out.replace(/^\s+/, '');
    // Leading paragraph = up to the first blank line, else the first line.
    const parEnd = trimmed.search(/\n[ \t]*\n/);
    const para = parEnd === -1 ? trimmed.split('\n', 1)[0] : trimmed.slice(0, parEnd);
    if (
      para.length === 0 ||
      para.length > 500 ||
      para.startsWith('<') || // tagged content belongs to the wrapper strip
      !PREAMBLE_OPENER.test(para) ||
      !PREAMBLE_META_VOCAB.test(para)
    ) break;
    out = trimmed.slice(para.length).replace(/^\s+/, '');
  }
  return out;
}

export function cleanOcrArtifacts(text: string): string {
  if (!text) return text;
  return stripLeadingAiPreamble(text)
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

/**
 * Options for {@link stripEditorialWrappers}.
 */
export interface StripEditorialWrappersOptions {
  /**
   * Keep GFM markdown tables intact instead of flattening them to plain text.
   *
   * Default `false` — flattening is right for the snippet/quote/search surfaces
   * this function was originally written for, where a table would otherwise leak
   * as raw pipe-soup (see {@link flattenMarkdownTables}).
   *
   * Pass `true` from surfaces that deliver a page's WHOLE text for reuse rather
   * than an excerpt of it — the PDF/EPUB exporters, the bulk content API, and
   * the corpus snapshot. There, flattening silently destroys the table's
   * structure: the cell values survive but the column they belonged to does not,
   * so a 16-column calendar table becomes unrecoverable runs of bare digits.
   * Wrapper stripping (the #2232 quote-integrity guarantee) is unaffected either
   * way — only the table markup differs.
   */
  keepTables?: boolean;
}

export function stripEditorialWrappers(
  text: string,
  opts?: StripEditorialWrappersOptions,
): string {
  if (!text) return text;
  const flattenTables = opts?.keepTables
    ? (s: string) => s
    : flattenMarkdownTables;
  // cleanOcrArtifacts runs LAST so lacuna/LaTeX cleanup applies to the final
  // plain text (after table flattening + marker stripping). Every snippet/quote
  // surface routes through here, so they all inherit the OCR safety net.
  //
  // Both remaining steps are table-safe when `keepTables` is set: the thematic-
  // break rule in stripMarkdownMarkers only matches a line of BARE dashes (a
  // `| :--- |` separator carries pipes, so it never matches), and the dash-run
  // rule in cleanOcrArtifacts already guards on an adjacent `|`.
  return cleanOcrArtifacts(
    stripMarkdownMarkers(
      flattenTables(
        text
          // Paired blocks, content and all (multiline). Backreference keeps it from
          // swallowing text between two different wrapper types.
          //
          // The `(?:\s[^>]*)?` allows ATTRIBUTES on the opening tag. The OCR prompt
          // emits them — `<image-desc size="medium" type="emblem" significance="high">`
          // appears on 0.77% of page-fields — and without this the pair never matched:
          // the AI's description of a plate survived as quotable text while the generic
          // tag-strip below removed its closing tag, leaving editorial prose
          // indistinguishable from the page's own words. That is the #2232 misquote
          // class. Never tighten this back to a bare `<tag>`.
          .replace(new RegExp(`<(${EDITORIAL_WRAPPERS})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
          // Any orphan opening/closing wrapper tag left by malformed AI output.
          .replace(new RegExp(`<\\/?(?:${EDITORIAL_WRAPPERS})(?:\\s[^>]*)?>`, 'gi'), ' '),
      ),
    ),
  );
}
