import { describe, it, expect } from 'vitest';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { stripEditorialWrappers as stripMjs } from '../../scripts/lib/strip-editorial-wrappers.mjs';

/**
 * Editorial wrappers must be stripped even when the opening tag carries
 * ATTRIBUTES.
 *
 * The OCR prompt emits them — `<image-desc size="medium" type="emblem"
 * significance="high">` appears on 0.77% of page-fields in a 12,000-field
 * sample. The strip patterns matched only a bare `<tag>`, so the pair never
 * matched: the AI's description of a plate survived into quotable text, while
 * the generic tag-strip removed its closing tag, leaving editorial prose
 * indistinguishable from the page's own words.
 *
 * That is the #2232 misquote class — words served as a verbatim quotation that
 * are not printed on the page. Found 2026-07-30 while evaluating whether a TEI
 * `@resp` provenance attribute could be added to the annotation family; it
 * could not, because 248 patterns across the codebase are attribute-blind, and
 * checking that turned up the one place where attributes already exist.
 */
describe('editorial wrappers with attributes', () => {
  const PROSE = 'A woodcut of a pelican feeding her young from her own breast.';

  const cases: Array<[string, string]> = [
    ['bare', `<image-desc>${PROSE}</image-desc>`],
    ['single attribute', `<image-desc size="medium">${PROSE}</image-desc>`],
    ['the real production shape', `<image-desc size="medium" type="emblem" significance="high">${PROSE}</image-desc>`],
    ['single quotes', `<image-desc size='small'>${PROSE}</image-desc>`],
    ['meta with attributes', `<meta confidence="low">${PROSE}</meta>`],
    ['warning with attributes', `<warning severity="high">${PROSE}</warning>`],
  ];

  it.each(cases)('strips %s (TS)', (_label, tagged) => {
    const out = stripEditorialWrappers(`Real page text.\n${tagged}\nMore real page text.`);
    expect(out, 'AI editorial prose must never survive into quotable text').not.toMatch(/pelican/i);
    expect(out).toMatch(/Real page text/);
  });

  it.each(cases)('strips %s (.mjs twin — parity)', (_label, tagged) => {
    const out = stripMjs(`Real page text.\n${tagged}\nMore real page text.`);
    expect(out).not.toMatch(/pelican/i);
    expect(out).toMatch(/Real page text/);
  });

  it('leaves a bare opening angle bracket in ordinary text alone', () => {
    const out = stripEditorialWrappers('The value of a < b was disputed.');
    expect(out).toMatch(/value of a/);
  });

  it('does not swallow text between two DIFFERENT wrapper types', () => {
    const out = stripEditorialWrappers(
      `<meta type="x">hidden one</meta>KEEP THIS TEXT<warning level="y">hidden two</warning>`
    );
    expect(out).toMatch(/KEEP THIS TEXT/);
    expect(out).not.toMatch(/hidden one|hidden two/);
  });
});
