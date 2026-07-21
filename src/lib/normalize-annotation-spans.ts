/**
 * Normalize AI annotation spans (<note>/<margin>/<gloss>/<insert>/<unclear>/
 * <image-desc>) so the reader's markdown pipeline can render them reliably.
 *
 * The translation model emits three structural shapes the render path cannot
 * represent (issue #2709; reader report 2026-07-13):
 *
 *  1. MULTI-PARAGRAPH spans — CommonMark ends a raw-HTML block at the first
 *     blank line, so paragraphs 2+ of a long <note> silently lose their
 *     highlight and read as the book's own text. On the de Caus title page the
 *     AI's engraving description flickers in and out of yellow mid-sentence.
 *  2. NESTED spans (<note> inside <note>) — the lazy pairing regexes downstream
 *     (`<note>[\s\S]*?<\/note>`) match the outer open to the INNER close,
 *     stranding the tail of the outer note as body text.
 *  3. UNBALANCED tags — a stray close renders as junk; an unclosed open swallows
 *     unpredictable amounts of the page depending on parser fallback.
 *
 * This pass rewrites every annotation span into the one shape the whole
 * pipeline handles correctly: balanced, non-nested, and confined to a single
 * paragraph (one open/close pair PER paragraph of content). Run it before any
 * of the lazy-regex preprocessors so they only ever see well-formed spans.
 *
 * Provenance rule: content is never dropped or reordered — only the tag
 * structure changes. Non-family inline tags (<term>, <sup>, …) inside a span
 * pass through untouched. Nested family tags are flattened into the outer span
 * (a note inside a note is just more note). A stray close tag is removed; an
 * unclosed open is closed at the end of its own paragraph — the conservative
 * choice, since swallowing subsequent real body text into a highlight would
 * misattribute source text to the AI.
 */

const FAMILY = 'note|margin|gloss|insert|unclear|image-desc';

// Open or close tag of the family, with optional attributes on the open tag
// (the OCR side emits e.g. <image-desc size="large" type="engraving">).
const TAG_RE = new RegExp(`<(\\/?)(${FAMILY})((?:\\s[^>]*)?)>`, 'gi');

const PARAGRAPH_BREAK = /\n[ \t]*\n+/;

// Markdown list/heading marker at line start. Lines like "- To the left: …"
// inside a <note> must keep the marker OUTSIDE the tag — a line starting with
// "-" interrupts the paragraph and becomes a list item, which would strand the
// note content outside the span again. "marker + <note>text</note>" renders as
// a real list item whose text is highlighted.
const MARKER_LINE = /^([ \t]*(?:[-*+]|\d+[.)]|#{1,6})[ \t]+)(.*)$/;

/** Wrap one blank-line-free chunk, handling markdown marker lines line-wise. */
function emitChunk(tagName: string, attrs: string, chunk: string): string {
  const lines = chunk.split('\n');
  if (!lines.some(l => MARKER_LINE.test(l))) {
    return `<${tagName}${attrs}>${chunk}</${tagName}>`;
  }
  return lines
    .map(line => {
      const m = line.match(MARKER_LINE);
      if (m) return m[2].trim() ? `${m[1]}<${tagName}${attrs}>${m[2]}</${tagName}>` : line;
      return line.trim() ? `<${tagName}${attrs}>${line.trim()}</${tagName}>` : line;
    })
    .join('\n');
}

/** Wrap each blank-line-separated paragraph of `content` in its own tag pair. */
function emitSpan(tagName: string, attrs: string, content: string): string {
  const chunks = content
    .split(PARAGRAPH_BREAK)
    .map(c => c.trim())
    .filter(Boolean);
  if (chunks.length === 0) return '';
  return chunks.map(c => emitChunk(tagName, attrs, c)).join('\n\n');
}

export function normalizeAnnotationSpans(text: string): string {
  if (!text || text.indexOf('<') === -1) return text;

  let out = '';
  let depth = 0;
  let outerTag = '';
  let outerAttrs = '';
  let content = ''; // accumulated span content, family tags excluded
  let cursor = 0;

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text)) !== null) {
    const [token, slash, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    const between = text.slice(cursor, m.index);
    cursor = m.index + token.length;

    if (depth === 0) {
      out += between;
      if (slash) continue; // stray close tag: drop it
      depth = 1;
      outerTag = name;
      outerAttrs = attrs || '';
      content = '';
    } else {
      content += between;
      if (slash) {
        depth--;
        if (depth === 0) out += emitSpan(outerTag, outerAttrs, content);
      } else {
        depth++; // nested family tag: flatten (keep its content, drop the tag)
      }
    }
  }

  const tail = text.slice(cursor);
  if (depth === 0) return out + tail;

  // Unclosed open: close the span at the end of its own paragraph and emit
  // everything after that blank line as ordinary text.
  const all = content + tail;
  const breakAt = all.search(PARAGRAPH_BREAK);
  if (breakAt === -1) return out + emitSpan(outerTag, outerAttrs, all);
  return out + emitSpan(outerTag, outerAttrs, all.slice(0, breakAt)) + '\n\n' + all.slice(breakAt).replace(/^\s+/, '');
}
