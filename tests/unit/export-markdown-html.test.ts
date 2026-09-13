import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '@/lib/export-markdown-html';
import { stripEditorialWrapperBlocks, stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

/**
 * Exported books must not carry the prompts' tags as literal text (#4782).
 *
 * The OCR/translation prompts emit a page-level envelope — <scan-quality>,
 * <script>, <language>, <meta>, <vocab>… — plus <image-desc>, the AI's own
 * account of a plate. `markdownToHtml` kept a private hide-list that drifted from
 * the canonical one in strip-editorial-wrappers and tolerated no attributes, so
 * `<scan-quality>good</scan-quality>` and `<image-desc size="medium">A woodcut of
 * a lion.</image-desc>` reached every EPUB/HTML download HTML-escaped: visible
 * angle-bracket text, the plate description sitting inline in the running text
 * with nothing to mark it as commentary. Nothing errored, because escaped tags
 * are valid markup.
 *
 * Each case below was verified failing against the pre-fix helper.
 */
describe('markdownToHtml — prompt tags never reach a downloaded book as text (#4782)', () => {
  const leak = 'Real text. <scan-quality>good</scan-quality> <script>latin</script> More real text.';

  it('drops the OCR page-level envelope content-and-all', () => {
    const html = markdownToHtml(leak, { stripNotes: false });
    expect(html).not.toContain('scan-quality');
    expect(html).not.toContain('latin');
    expect(html).toContain('Real text.');
    expect(html).toContain('More real text.');
  });

  it('never emits an escaped tag of any kind', () => {
    const everything = [
      '<meta>About the page.</meta>', '<summary>Sums up.</summary>', '<keywords>a, b</keywords>',
      '<vocab>x: y</vocab>', '<language>Latin</language>', '<lang>la</lang>',
      '<scan-quality>poor</scan-quality>', '<script>gothic</script>', '<page-type>text</page-type>',
      '<columns>2</columns>', '<warning>bleed-through</warning>', '<condition>fragmentary</condition>',
      '<period>Ur III</period>', '<surface>obverse</surface>', '<genre>letter</genre>',
      '<page-num>17</page-num>', '<sig>A2</sig>', '<header>LIBER I</header>',
      'Body sentence.',
    ].join('\n');
    const html = markdownToHtml(everything, { stripNotes: false });
    expect(html).not.toMatch(/&lt;\/?[a-z-]+/);
    expect(html).toContain('Body sentence.');
  });

  it('tolerates attributes on the opening tag — the OCR prompt emits them', () => {
    const html = markdownToHtml(
      'Text. <image-desc size="medium" type="emblem" significance="high">An enneagram.</image-desc> Text.',
      { stripNotes: false },
    );
    expect(html).not.toContain('&lt;');
    expect(html).toContain('<span class="image-desc">[Image description: An enneagram.]</span>');
  });

  it('marks an image description as commentary when notes are on', () => {
    // The serious half of #4782: with no marker a reader cannot tell the AI's
    // account of a plate from the printed words. The reader shows it as a
    // labelled chip; the export shows it as a labelled span, never as body text.
    const html = markdownToHtml('Before. <image-desc>A woodcut of a lion.</image-desc> After.', { stripNotes: false });
    expect(html).toContain('<span class="image-desc">[Image description: A woodcut of a lion.]</span>');
    expect(html).not.toMatch(/Before\. A woodcut/);
  });

  it('removes an image description entirely when notes are off', () => {
    const html = markdownToHtml('Before. <image-desc>A woodcut of a lion.</image-desc> After.', { stripNotes: true });
    expect(html).not.toContain('woodcut');
    expect(html).toContain('Before.');
    expect(html).toContain('After.');
  });

  it('shows a lacuna as a marked gap in BOTH note states', () => {
    // A silently dropped region reads as a complete page — the fabrication the
    // tag exists to prevent (see strip-editorial-wrappers and NotesRenderer).
    for (const stripNotes of [true, false]) {
      const html = markdownToHtml('Line one.\n<lacuna>three lines lost</lacuna>\nLine five.', { stripNotes });
      expect(html).toContain('<span class="lacuna">[Not transcribed: three lines lost]</span>');
      expect(html).not.toContain('&lt;');
    }
  });

  it('keeps the reader-visible page marks with their content', () => {
    // An export that dropped <unclear> would be a new integrity bug, not a fix.
    const html = markdownToHtml(
      'The <unclear>Frisia</unclear> coast, <margin>nota</margin> <insert>and</insert> <gloss>sea</gloss>.',
      { stripNotes: false },
    );
    expect(html).toContain('<span class="unclear">Frisia?</span>');
    expect(html).toContain('<span class="margin">[nota]</span>');
    expect(html).toContain('<span class="gloss">sea</span>');
    expect(html).toContain('and');
    expect(html).not.toContain('&lt;');
  });

  it('renders a multi-line note as one span, not a stranded placeholder', () => {
    const html = markdownToHtml('Text <note>first line\nsecond line</note> more.', { stripNotes: false });
    expect(html).not.toContain('PLACEHOLDER');
    expect(html).toContain('<span class="note">[first line second line]</span>');
  });

  it('still escapes the page\'s own stray angle brackets', () => {
    const html = markdownToHtml('5 < 6 and 7 > 3 <scan-quality>good</scan-quality>', { stripNotes: false });
    expect(html).toContain('5 &lt; 6 and 7 &gt; 3');
    expect(html).not.toContain('scan-quality');
  });
});

describe('stripEditorialWrapperBlocks — the canonical list, without the plain-text flattening', () => {
  it('strips the same wrappers as stripEditorialWrappers', () => {
    const text = '# Heading\n**bold** <meta>desc</meta> <scan-quality>good</scan-quality> body';
    const blocks = stripEditorialWrapperBlocks(text);
    expect(blocks).not.toContain('desc');
    expect(blocks).not.toContain('good');
    // …but leaves the markdown for the caller to render.
    expect(blocks).toContain('# Heading');
    expect(blocks).toContain('**bold**');
    // The full function strips both.
    const full = stripEditorialWrappers(text);
    expect(full).not.toContain('desc');
    expect(full).not.toContain('# ');
  });
});
