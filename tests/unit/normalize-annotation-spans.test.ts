import { describe, it, expect } from 'vitest';
import { normalizeAnnotationSpans } from '../../src/lib/normalize-annotation-spans';

describe('normalizeAnnotationSpans', () => {
  it('leaves text without annotation tags untouched', () => {
    const t = 'Plain body text.\n\nAnother paragraph with <term>chesed</term> inline.';
    expect(normalizeAnnotationSpans(t)).toBe(t);
  });

  it('leaves a balanced single-paragraph note untouched in shape', () => {
    const t = 'Before <note>a short gloss</note> after.';
    expect(normalizeAnnotationSpans(t)).toBe(t);
  });

  it('splits a multi-paragraph note into one balanced pair per paragraph', () => {
    const t = '<note>First paragraph of description.\n\nSecond paragraph of description.</note>';
    expect(normalizeAnnotationSpans(t)).toBe(
      '<note>First paragraph of description.</note>\n\n<note>Second paragraph of description.</note>'
    );
  });

  it('flattens a nested note into the outer span', () => {
    const t = '<note>Archimedes <note>the mathematician</note> sits with a compass.</note>';
    expect(normalizeAnnotationSpans(t)).toBe(
      '<note>Archimedes the mathematician sits with a compass.</note>'
    );
  });

  it('flattens nested family tags of a different name too', () => {
    const t = '<note>text <margin>marginal</margin> more</note>';
    expect(normalizeAnnotationSpans(t)).toBe('<note>text marginal more</note>');
  });

  it('preserves non-family inline tags inside a span', () => {
    const t = '<note>an armillary sphere <term>a model of the heavens</term> rests on a plinth</note>';
    expect(normalizeAnnotationSpans(t)).toBe(t);
  });

  it('keeps list markers outside the tag so lists still render', () => {
    const t = '<note>Two niches:\n- To the left: Mercury.\n- To the right: Nature.</note>';
    expect(normalizeAnnotationSpans(t)).toBe(
      '<note>Two niches:</note>\n- <note>To the left: Mercury.</note>\n- <note>To the right: Nature.</note>'
    );
  });

  it('drops a stray close tag', () => {
    const t = 'Real body text.</note> More body.';
    expect(normalizeAnnotationSpans(t)).toBe('Real body text. More body.');
  });

  it('closes an unclosed open at the end of its own paragraph', () => {
    const t = 'Body.\n\n<note>Dangling description here\n\nReal transcribed text continues.';
    expect(normalizeAnnotationSpans(t)).toBe(
      'Body.\n\n<note>Dangling description here</note>\n\nReal transcribed text continues.'
    );
  });

  it('wraps a fully unclosed trailing note without swallowing structure', () => {
    const t = '<note>only a caption';
    expect(normalizeAnnotationSpans(t)).toBe('<note>only a caption</note>');
  });

  it('preserves attributes on every emitted chunk', () => {
    const t = '<image-desc size="large" type="engraving">One.\n\nTwo.</image-desc>';
    expect(normalizeAnnotationSpans(t)).toBe(
      '<image-desc size="large" type="engraving">One.</image-desc>\n\n<image-desc size="large" type="engraving">Two.</image-desc>'
    );
  });

  it('handles the de Caus shape: multi-paragraph + nested + lists in one span', () => {
    const t = [
      '<note>An ornate title page.',
      '',
      'Flanking the scene are two niches:',
      '- On the left: Archimedes <note>the mathematician</note> sits.',
      '- On the right: Hero points.</note>',
      '',
      '# THE REASONS',
    ].join('\n');
    const out = normalizeAnnotationSpans(t);
    // No text between spans escapes the note family…
    expect(out).toContain('<note>An ornate title page.</note>');
    expect(out).toContain('- <note>On the left: Archimedes the mathematician sits.</note>');
    expect(out).toContain('- <note>On the right: Hero points.</note>');
    // …and the real body text stays outside.
    expect(out).toMatch(/# THE REASONS\s*$/);
    expect(out).not.toMatch(/<note>[^<]*# THE REASONS/);
  });

  it('every emitted span is balanced, non-nested, and blank-line-free', () => {
    const messy =
      '<note>a\n\nb <note>c</note> d\n\ne</note> body </note> <margin>m1\n\nm2</margin> tail <note>open';
    const out = normalizeAnnotationSpans(messy);
    const re = /<(\/?)(note|margin|gloss|insert|unclear|image-desc)(\s[^>]*)?>/g;
    let depth = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      if (m[1]) {
        expect(depth).toBe(1); // every close matches an open (no strays)
        // span content contains no blank line
        expect(/\n[ \t]*\n/.test(out.slice(last, m.index))).toBe(false);
        depth--;
      } else {
        expect(depth).toBe(0); // never nested
        depth++;
        last = re.lastIndex;
      }
    }
    expect(depth).toBe(0); // balanced overall
  });
});
