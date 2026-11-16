/**
 * The one-or-two-line preview of an answer shown in the Librarian's thread
 * lists (v3#250). The stored answer is markdown; a raw cut of it put
 * "**Abundantia**" and "## Heading" in front of readers.
 *
 * PRIOR ART: src/lib/embassy/grounding.ts `plainText` — reused here for links,
 * images and emphasis; it leaves headings, quote marks and list bullets, and
 * does not cut to a length, which a preview needs.
 */
import { plainText } from './grounding';

export function previewText(markdown: string | null | undefined, max: number): string {
  if (!markdown) return '';
  const text = plainText(markdown)
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+]|\d+\.)\s+/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:(—–-]+$/, '')}…`;
}
