/**
 * PRIOR ART: `src/lib/markdown-prep.ts` transforms Gemini output string→string
 * (linkify, paragraph breaks) and never produces React nodes, so it cannot render
 * emphasis. `src/app/collections/[id]/page.tsx` already parses `[anchor](/href)`
 * inline, but only links — emphasis in the same prose falls through to React's
 * default escaping. This file is the missing half, and is shared rather than
 * inlined because the same strings are also rendered by `BookLibrary`.
 *
 * Inline emphasis for curator-authored prose.
 *
 * Collection descriptions are hand-written and routinely italicise book titles
 * ("Burchard of Worms's <em>Corrector</em>"). React escapes strings by default,
 * so those readers saw the literal characters `<em>Corrector</em>` on the page.
 *
 * BOTH idioms are live in the data, which is why both are supported here rather
 * than picking one and rewriting the other:
 *   - HTML `<em> <i> <strong> <b>`  — 2 collections, 7 occurrences
 *   - Markdown `*italic*` `**bold**` — 1 collection (`connoisseurship`)
 * Measured 2026-09-04 over all 381 collections. Only 3 collections contain an
 * asterisk at all, so treating `*…*` as emphasis has negligible collision risk.
 * `_underscore_` is deliberately NOT supported: zero usage, and underscores are
 * common inside slugs and identifiers.
 *
 * This never renders raw HTML. Nothing is passed to `dangerouslySetInnerHTML` —
 * the tags are *parsed* and replaced with real React elements, so an author (or
 * anything writing into the `collections` document) cannot inject markup. Any
 * tag outside the whitelist stays escaped text, exactly as today.
 */
import React from 'react';

/** Emphasis spans, longest-delimiter-first so `**bold**` wins over `*italic*`. */
const EMPHASIS_RE =
  /<(em|i)>([\s\S]*?)<\/\1>|<(strong|b)>([\s\S]*?)<\/\3>|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;

/**
 * Split `text` on emphasis spans and render each span as a real element, passing
 * every non-emphasis segment through `renderPlain` so existing behaviour (book
 * title auto-linking, markdown links) still applies to it.
 */
export function renderInlineProse(
  text: string,
  renderPlain: (segment: string) => React.ReactNode,
  keyPrefix = 'ip',
): React.ReactNode {
  EMPHASIS_RE.lastIndex = 0;
  if (!EMPHASIS_RE.test(text)) return renderPlain(text);

  EMPHASIS_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = EMPHASIS_RE.exec(text)) !== null) {
    if (m.index > last) out.push(renderPlain(text.slice(last, m.index)));

    const italic = m[2] ?? m[6];
    const bold = m[4] ?? m[5];
    const key = `${keyPrefix}-${k++}-${m.index}`;

    // The inner text is rendered through `renderPlain` too — an italicised book
    // title should still auto-link, which is the common case in this prose.
    if (italic !== undefined) out.push(<em key={key}>{renderPlain(italic)}</em>);
    else out.push(<strong key={key}>{renderPlain(bold)}</strong>);

    last = m.index + m[0].length;
  }

  if (last < text.length) out.push(renderPlain(text.slice(last)));
  return <>{out}</>;
}

/**
 * Flatten authored markup to plain text for consumers that must not carry it:
 * `<meta>` descriptions, schema.org JSON-LD, card summaries, and anything that
 * TRUNCATES — a 150-character cut through `<em>` leaves a half-tag on screen.
 *
 * Handles markdown links as well, superseding the page-local `stripMarkdownLinks`.
 */
export function stripInlineMarkup(text: string | null | undefined): string {
  return (text || '')
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/<\/?(?:em|i|strong|b)>/gi, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
