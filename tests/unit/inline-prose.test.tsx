/**
 * Curator-authored collection prose italicises book titles. React escapes strings
 * by default, so readers saw the literal characters `<em>Corrector</em>` on
 * /collections/forum-of-conscience. Both authoring idioms are live in the data
 * (HTML in 2 collections, markdown `*…*` in 1), so both must render.
 *
 * The negative control matters more than the positive one here: this feature
 * parses a whitelist of tags, and the whole point is that everything OUTSIDE the
 * whitelist stays escaped. A test that only proves `<em>` works would pass just
 * as happily on a `dangerouslySetInnerHTML` implementation that renders `<script>`.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderInlineProse, stripInlineMarkup } from '@/lib/inline-prose';

const render = (text: string) =>
  renderToStaticMarkup(<>{renderInlineProse(text, (seg) => seg)}</>);

describe('renderInlineProse', () => {
  it('renders HTML emphasis authored in the data', () => {
    const html = render("Burchard of Worms's <em>Corrector</em>, whose interrogatory");
    expect(html).toContain('<em>Corrector</em>');
    expect(html).not.toContain('&lt;em&gt;');
  });

  it('renders markdown emphasis authored in the data', () => {
    expect(render('learning to *appreciate* the object')).toContain('<em>appreciate</em>');
    expect(render('the **decisive** break')).toContain('<strong>decisive</strong>');
  });

  it('prefers ** over * so bold does not render as an italic asterisk', () => {
    const html = render('a **bold** claim');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('*');
  });

  it('renders <strong>/<b>/<i> as well as <em>', () => {
    expect(render('<strong>x</strong>')).toContain('<strong>x</strong>');
    expect(render('<b>x</b>')).toContain('<strong>x</strong>');
    expect(render('<i>x</i>')).toContain('<em>x</em>');
  });

  // ── negative controls ──
  it('leaves every non-whitelisted tag ESCAPED', () => {
    for (const evil of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="https://evil.test">link</a>',
      '<iframe src="https://evil.test"></iframe>',
    ]) {
      const html = render(`before ${evil} after`);
      expect(html).toContain('&lt;');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<a ');
    }
  });

  it('does not treat an event handler inside a whitelisted tag as markup', () => {
    // `<em onclick=...>` is not the whitelisted shape, so it must stay text.
    const html = render('<em onclick="alert(1)">x</em>');
    expect(html).not.toContain('onclick="alert(1)"');
  });

  it('passes non-emphasis segments through the caller, so auto-linking still runs', () => {
    const seen: string[] = [];
    renderInlineProse('a <em>b</em> c', (seg) => {
      seen.push(seg);
      return seg;
    });
    expect(seen).toContain('a ');
    expect(seen).toContain(' c');
    // The emphasised text goes through it too — an italicised title should link.
    expect(seen).toContain('b');
  });

  it('leaves plain prose untouched', () => {
    expect(render('no markup here at all')).toBe('no markup here at all');
  });

  it('leaves an unpaired asterisk alone', () => {
    expect(render('3 * 4 = 12')).toBe('3 * 4 = 12');
  });
});

describe('stripInlineMarkup', () => {
  it('flattens both idioms and markdown links for plain-text consumers', () => {
    expect(stripInlineMarkup("Worms's <em>Corrector</em> here")).toBe("Worms's Corrector here");
    expect(stripInlineMarkup('learning to *appreciate* it')).toBe('learning to appreciate it');
    expect(stripInlineMarkup('see [the page](/book/x/page/2) now')).toBe('see the page now');
  });

  it('never leaves a half-tag when the result is truncated', () => {
    // The card cuts at 150 chars; stripping first is what makes that safe.
    const authored = `${'x'.repeat(140)} <em>Corrector</em>`;
    expect(stripInlineMarkup(authored).slice(0, 150)).not.toContain('<');
  });

  it('tolerates null and undefined', () => {
    expect(stripInlineMarkup(null)).toBe('');
    expect(stripInlineMarkup(undefined)).toBe('');
  });
});
