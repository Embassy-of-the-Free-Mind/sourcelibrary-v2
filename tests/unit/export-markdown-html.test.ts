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

describe('markdownToHtml — an unpaired annotation tag is dropped, not printed (#7118)', () => {
  it('drops a stray closing </margin> but keeps the text around it and paired tags', () => {
    const html = markdownToHtml('The lamps of my house.\n</margin>\nAnd he recited <margin>a gloss</margin>.', { stripNotes: false });
    expect(html).not.toContain('&lt;/margin&gt;');
    expect(html).toContain('The lamps of my house.');
    expect(html).toContain('<span class="margin">[a gloss]</span>');
  });
});

/**
 * #7118: a probe of 12 random books' EPUBs counted markup printed as text — 283 `---`, 242 escaped HTML tags, 44
 * leaked `[[…_PLACEHOLDER:` strings, 88 pipe-table rows, 27 `####` headings. Each case is one of those shapes.
 */
describe('markdownToHtml — no markup printed as text (#7118 EPUB probe)', () => {
  it('converts a gloss inside a note without leaking the placeholder (Man\'yōshū)', () => {
    const html = markdownToHtml('poem <note>Motoori reads <gloss>the act of holding a branch</gloss> here.</note> end', { stripNotes: false });
    expect(html).not.toContain('PLACEHOLDER');
    expect(html).toContain('<span class="note">[Motoori reads <span class="gloss">the act of holding a branch</span> here.]</span>');
  });
  it('makes a separator line a rule, not text', () => {
    const html = markdownToHtml('Newly revised\n---\nat Amsterdam');
    expect(html).toBe('<p>Newly revised</p>\n<hr/>\n<p>at Amsterdam</p>');
  });
  it('turns <br> into a line break, a paired <s> into strikethrough, <foreign> into italic, and drops <center>', () => {
    const html = markdownToHtml('Hour of <br> Meridian; <s>the metal?</s> called <foreign lang="la">laas</foreign> <center>P.</center>');
    expect(html).toBe('<p>Hour of <br/> Meridian; <s>the metal?</s> called <i>laas</i> P.</p>');
  });
  it('leaves angle brackets that are not tags alone', () => {
    expect(markdownToHtml('if a < b and c > d')).toContain('a &lt; b and c &gt; d');
  });
  it('converts four- to six-hash headings', () => {
    expect(markdownToHtml('#### Manifestations of Malignant Strike')).toBe('<h4>Manifestations of Malignant Strike</h4>');
  });
  it('keeps a <br> inside a table cell as a line break in the cell, so the row survives (Ptolemy)', () => {
    const html = markdownToHtml('| Midpoint <br> ω | Equal |\n|---|---|\n| 6 | 51 |');
    expect(html).toContain('<th>Midpoint <br/> ω</th>');
  });
  it('makes a block of bullet lines a list, and leaves a lone dash line as text (Ptolemy, horizons)', () => {
    expect(markdownToHtml('* SOUTH\n* SOUTH-WEST\n* WEST')).toBe('<ul><li>SOUTH</li><li>SOUTH-WEST</li><li>WEST</li></ul>');
    expect(markdownToHtml('- Alas! said he.')).toBe('<p>- Alas! said he.</p>');
    expect(markdownToHtml('Landmasses and Regions:\n*   GREENLAND\n*   Baffins Bay\nThen the sea.'))
      .toBe('<p>Landmasses and Regions:</p>\n<ul><li>GREENLAND</li><li>Baffins Bay</li></ul>\n<p>Then the sea.</p>');
    expect(markdownToHtml('Be blessed.\n+ JEAN BAPTISTE')).toBe('<p>Be blessed.<br/>+ JEAN BAPTISTE</p>');
  });
  it('drops a heading marker typed into a table cell', () => {
    expect(markdownToHtml('| # Fifth Sound | x |\n|---|---|\n| a | b |')).toContain('<th>Fifth Sound</th>');
  });
  it('makes a table that shares its block with a caption a real table', () => {
    const html = markdownToHtml('Table of lunar eclipses\n| Hour | Mean |\n|---|---|\n| 6 | 51 |');
    expect(html).toBe('<p>Table of lunar eclipses</p>\n<table class="page-table"><thead><tr><th>Hour</th><th>Mean</th></tr></thead><tbody><tr><td>6</td><td>51</td></tr></tbody></table>');
  });
});

describe('markdownToHtml — OCR layout tags with long attributes, ink and orientation notes, a literal rule (#7118)', () => {
  it('drops a drop-cap span whose style runs past 80 characters, keeping the letter', () => {
    const html = markdownToHtml(`<span style="font-size: 200%; float: left; margin-right: 0.2em; line-height: 0.8em; font-family: 'Times New Roman', serif;">N</span>or would it`);
    expect(html).not.toContain('&lt;');
    expect(html).toContain('Nor would it');
  });
  it('drops <red> and <rotate value="90">', () => {
    const html = markdownToHtml('<red>Chapter</red> one <rotate value="90">side text</rotate>');
    expect(html).not.toContain('&lt;');
    expect(html).toContain('Chapter one side text');
  });
  it('reads a literal <hr/> on its own line as a rule', () => {
    expect(markdownToHtml('Before.\n\n<hr/>\n\nAfter.')).toMatch(/<p>Before\.<\/p>\s*<hr\/>\s*<p>After\.<\/p>/);
  });
});
