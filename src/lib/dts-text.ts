import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

/**
 * Text served by the DTS document endpoint.
 *
 * DTS was the one public text surface serving raw `ocr.data`/`translation.data`
 * (#3822): `<meta>`, `<summary>`, `<image-desc>` prose — the AI's own voice,
 * which routinely describes adjacent pages — went out as document text to
 * scholarly consumers who will treat it as the text of the witness.
 *
 * Editorial wrappers are dropped content-and-all by the canonical stripper.
 * `keepTables: true` because DTS serves the whole artifact, not an excerpt —
 * flattening would silently destroy column structure on table-heavy pages
 * (see .claude/docs/invariants/text-helpers-and-exports.md). Remaining
 * annotation tags (note/term/margin/unclear/…) unwrap: content kept, markup
 * removed. The ideal-state version maps them to TEI equivalents instead —
 * tracked in #3822.
 */
export function dtsPageText(raw: string | undefined | null): string {
  if (!raw) return '';
  return stripEditorialWrappers(raw, { keepTables: true })
    .replace(/<column-break\s*\/?>/gi, '\n\n')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
