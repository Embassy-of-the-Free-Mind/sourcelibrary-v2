// Scripts-side twin of src/lib/strip-editorial-wrappers.ts — keep the two in
// lockstep. tests/unit/ngram-normalize.test.ts runs a parity check between this
// file and the TS original on shared fixtures; if you change one side, change
// the other or that test fails.
//
// Why it exists: .mjs workers/analytics scripts can't import the TS module.
// Previous scripts inlined partial copies (e.g. corpus-size.mjs); this is the
// full pipeline so batch consumers (ngram counting, future analytics) get the
// same guarantees as the app surfaces: editorial wrapper blocks stripped
// content-and-all, untagged AI preambles removed, lacuna runs collapsed,
// markdown scaffolding flattened. See the TS file for the full rationale and
// incident history (PR #2232, #3108, issue #2764).

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
  + '|condition|period|surface|genre'
  // `<lacuna>` (#4195 item 5, #3591, #4584) states that a REGION of an otherwise
  // readable page carries no legible source — "20 lines of hieroglyphic text, not
  // transcribed". Its content is a description OF the gap, never the page's own
  // words, so it is dropped content-and-all like any other editorial wrapper.
  // This is precisely why it is a distinct tag and not `<unclear>`: `<unclear>`
  // wraps a best-guess READING and unwraps to body text everywhere, so a lacuna
  // description carried in an `<unclear>` would be quoted, counted, embedded and
  // exported as if it were text on the page. The reader still SHOWS the gap —
  // see NotesRenderer — because a silently dropped region reads as a complete
  // page, which is the failure this whole tag exists to prevent.
  + '|lacuna';

function flattenMarkdownTables(text) {
  return text
    .replace(/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, inner) =>
      inner.split('|').map(c => c.trim()).filter(Boolean).join('  '))
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
}

function stripMarkdownMarkers(text) {
  // Interiors are BOUNDED (300 chars, no newlines) — the lazy-unbounded
  // originals went quadratic on junk pages with thousands of stray asterisks
  // (2h regex spin in the ngram build, 2026-07-18). See the TS twin's comment.
  return text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,})[ \t]*$/gm, '')
    .replace(/->[ \t]*(\S(?:[^\n]{0,300}?\S)?)[ \t]*<-/g, '$1')
    .replace(/\*\*\*(\S(?:[^*\n]{0,300}?\S)?)\*\*\*/g, '$1')
    .replace(/\*\*(\S(?:[^*\n]{0,300}?\S)?)\*\*/g, '$1')
    .replace(/\*(\S(?:[^*\n]{0,300}?\S)?)\*/g, '$1')
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
}

const PREAMBLE_OPENER =
  /^(?:\*\*)?(?:note[:,]|sure[,!:]|certainly|okay|of course|here (?:is|are)\b|here's\b|i(?:'ve| have)\b|i(?:'m| am)\b|i(?:'ll| will)\b|i apologize|i can(?:no|')t\b|please\b|if you\b|the text (?:in|on|of) th(?:e|is) (?:image|page|scan)\b)/i;
const PREAMBLE_META_VOCAB =
  /\b(?:transcri(?:be|bed|bing|ption)|ocr|the image|this image|image provided|you (?:provided|requested)|as requested|as it appears|i apologize|i(?:'m| am) sorry|cannot assist|unable to assist)\b/i;

function stripLeadingAiPreamble(text) {
  let out = text;
  for (let i = 0; i < 3; i++) {
    const trimmed = out.replace(/^\s+/, '');
    const parEnd = trimmed.search(/\n[ \t]*\n/);
    const para = parEnd === -1 ? trimmed.split('\n', 1)[0] : trimmed.slice(0, parEnd);
    if (
      para.length === 0 ||
      para.length > 500 ||
      para.startsWith('<') ||
      !PREAMBLE_OPENER.test(para) ||
      !PREAMBLE_META_VOCAB.test(para)
    ) break;
    out = trimmed.slice(para.length).replace(/^\s+/, '');
  }
  return out;
}

export function cleanOcrArtifacts(text) {
  if (!text) return text;
  return stripLeadingAiPreamble(text)
    .replace(/([.·•…])(?:[ \t ]*\1){11,}/g, '[…]')
    .replace(/_{12,}/g, '[…]')
    .replace(/(?<![|\-–—])[-–—](?:[ \t ]*[-–—]){11,}(?![-–—|])/g, ' […]')
    .replace(/\$?\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}\$?/g, '($1)/($2)')
    .replace(/\$?\\sqrt\s*\{([^{}]*)\}\$?/g, '√($1)')
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
 * @param {string} text
 * @param {{ keepTables?: boolean }} [opts] `keepTables: true` leaves GFM tables
 *   intact. Default (false) flattens them, which is right for snippet/quote
 *   surfaces but destroys column structure on surfaces that deliver a page's
 *   WHOLE text for reuse (exports, bulk content API, corpus snapshot). Parity
 *   with the TS twin (src/lib/strip-editorial-wrappers.ts) — change both together.
 */
export function stripEditorialWrappers(text, opts) {
  if (!text) return text;
  const flattenTables = opts?.keepTables ? (s) => s : flattenMarkdownTables;
  return cleanOcrArtifacts(
    stripMarkdownMarkers(
      flattenTables(
        text
          // `(?:\s[^>]*)?` allows ATTRIBUTES on the opening tag — the OCR prompt emits
          // `<image-desc size="..." type="..." significance="...">` on ~0.77% of
          // page-fields, and a bare `<tag>` pattern never matched them, leaking the
          // AI's plate descriptions into quotable text. Parity with the TS twin
          // (src/lib/strip-editorial-wrappers.ts) — change both together.
          .replace(new RegExp(`<(${EDITORIAL_WRAPPERS})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
          .replace(new RegExp(`<\\/?(?:${EDITORIAL_WRAPPERS})(?:\\s[^>]*)?>`, 'gi'), ' '),
      ),
    ),
  );
}
