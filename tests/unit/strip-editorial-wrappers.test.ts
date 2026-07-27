import { describe, it, expect } from 'vitest';
import { stripEditorialWrappers, cleanOcrArtifacts } from '@/lib/strip-editorial-wrappers';

describe('stripEditorialWrappers', () => {
  it('drops a <meta> block content-and-all', () => {
    // The real page-89 misquote: the <meta> note names "mercury", which is on
    // page 88, not 89. Stripping it must remove "mercury" entirely.
    const page89 = `<meta>While the previous page focused on perpetual motion wheels using mercury, this page shifts toward water-driven mechanisms.</meta>\n\n...should be held in that <term>yantra</term>. When the interior space is filled with water...`;
    const out = stripEditorialWrappers(page89);
    expect(out).not.toMatch(/mercury/i);
    expect(out).not.toMatch(/perpetual/i);
    expect(out).toContain('filled with water');
    expect(out).toContain('<term>yantra</term>'); // inline glosses survive
  });

  it('drops summary, keywords, and vocab blocks', () => {
    const t = `body text <summary>AI description of the page</summary> more body <keywords>a, b, c</keywords> end <vocab>term1, term2</vocab>`;
    const out = stripEditorialWrappers(t).replace(/\s+/g, ' ').trim();
    expect(out).toBe('body text more body end');
  });

  it('handles multiline wrapper content', () => {
    const t = `<meta>line one\nline two\nline three</meta>real body`;
    expect(stripEditorialWrappers(t)).not.toMatch(/line (one|two|three)/);
    expect(stripEditorialWrappers(t)).toContain('real body');
  });

  it('does not swallow body text between two different wrapper types', () => {
    const t = `<meta>desc</meta>KEEP THIS BODY<keywords>k</keywords>`;
    expect(stripEditorialWrappers(t)).toContain('KEEP THIS BODY');
  });

  it('removes orphan wrapper tags from malformed AI output', () => {
    const t = `body <meta>unclosed description that runs to end of page`;
    expect(stripEditorialWrappers(t)).not.toContain('<meta>');
  });

  it('is a no-op on text with no wrappers', () => {
    const t = 'plain translated body with a <term>gloss</term>';
    expect(stripEditorialWrappers(t)).toBe(t);
  });

  it('strips the OCR page-level metadata envelope content-and-all', () => {
    // The real value served by the live IIIF OCR annotation route before the fix.
    const ocr = `<scan-quality>good</scan-quality>\n<language>English</language>\n<script>printed</script>\n<page-type>blank</page-type>\n\nActual body line of the page.`;
    const out = stripEditorialWrappers(ocr);
    expect(out).not.toMatch(/scan-quality|page-type/);
    expect(out).not.toMatch(/\bprinted\b/); // <script>printed</script> label gone
    expect(out).not.toMatch(/\bblank\b/);   // <page-type>blank</page-type> label gone
    expect(out).toContain('Actual body line of the page.');
  });

  it('drops <columns> and <warning> metadata but keeps real page marks', () => {
    const t = `<columns>2</columns><warning>low contrast</warning><header>RUNNING HEAD</header>real body<insert>OLIN BM 175</insert>`;
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/low contrast/);
    expect(out).not.toContain('<columns>');
    // header/insert are real printed marks, not AI description — they survive.
    expect(out).toContain('<header>RUNNING HEAD</header>');
    expect(out).toContain('real body');
    expect(out).toContain('<insert>OLIN BM 175</insert>');
  });

  it('drops an <image-desc> AI plate description content-and-all', () => {
    // Real leak: get_quote on Morestel 1621 p.39 served this AI description of a
    // woodcut as quotable translation text. The word "enneagram" is the model's,
    // not the author's — quoting it fabricates a citation. Strip content and tag.
    const t = `The third section encompasses the relative predicates, the sign of which is T.\n\n<image-desc>A circular diagram... a complex nine-pointed star (enneagram) is formed by lines connecting each of the nine points.</image-desc>`;
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/enneagram/i);
    expect(out).not.toMatch(/nine-pointed/i);
    expect(out).not.toContain('<image-desc>');
    expect(out).toContain('relative predicates'); // real translated body survives
  });

  it('strips inline <language> switch markers without eating the body', () => {
    const t = `Lorem ipsum <language>Latin</language> dolor sit amet`;
    const out = stripEditorialWrappers(t).replace(/\s+/g, ' ').trim();
    expect(out).toBe('Lorem ipsum dolor sit amet');
  });

  // ── Markdown table flattening (Vasari "tavola"/index pages) ──────────────
  it('flattens an empty-header markdown table to readable lines, no pipe-soup', () => {
    // The Vasari Vol.1 1568 index, p.42 — leaked into a search snippet as
    // "# TABLE OF | | | |---|---| | Luigi Pulci s. | 493 | ...".
    const t = `# TABLE OF\n\n| | |\n|---|---|\n| Luigi Pulci s. | 493 |\n| Gaddo Gaddi p. | 13 |`;
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/\|/);          // no raw pipes survive
    expect(out).not.toMatch(/---/);         // no separator scaffolding
    expect(out).toContain('Luigi Pulci s.  493');
    expect(out).toContain('Gaddo Gaddi p.  13');
  });

  it('flattens aligned separator rows and multi-cell rows', () => {
    const t = `| Name | Page |\n| :--- | ---: |\n| Thomas Aquinas, saint p. | 187 |`;
    const out = stripEditorialWrappers(t).trim();
    expect(out).not.toMatch(/[|]|:---|---:/);
    expect(out).toContain('Name  Page');
    expect(out).toContain('Thomas Aquinas, saint p.  187');
  });

  it('leaves prose containing an inline pipe untouched', () => {
    const t = 'the choice of good | evil is the soul’s';
    expect(stripEditorialWrappers(t)).toBe(t);
  });

  // ── Residual markdown markers in plain-text snippets ─────────────────────
  it('strips ATX heading markers but keeps the heading text', () => {
    const t = '# TABLE OF\n\n### G\nGaddo Gaddi p.  13';
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/^#/m);
    expect(out).toContain('TABLE OF');
    expect(out).toContain('G\n');
    expect(out).toContain('Gaddo Gaddi p.  13');
  });

  it('strips paired asterisk emphasis and ->centered<- markers', () => {
    expect(stripEditorialWrappers('->**B**<-')).toBe('B');
    expect(stripEditorialWrappers('->THE END.<-')).toBe('THE END.');
    expect(stripEditorialWrappers('a **bold** and *italic* word')).toBe('a bold and italic word');
  });

  it('drops --- / *** thematic-break rules', () => {
    const t = 'Zanobi Stradi s 467\n\n---\n\nTHE END.';
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/^---$/m);
    expect(out).toContain('Zanobi Stradi s 467');
    expect(out).toContain('THE END.');
  });

  it('leaves spaced-out or literal asterisks and underscores alone', () => {
    // Not markdown emphasis (spaces hug the asterisks) — must survive.
    expect(stripEditorialWrappers('see footnote * and ** below')).toBe('see footnote * and ** below');
    // Underscores are never touched (literal in OCR/transliteration).
    expect(stripEditorialWrappers('istimnāʾ _ or jing_preservation')).toBe('istimnāʾ _ or jing_preservation');
  });

  // ── OCR safety net is inherited by every snippet/quote surface (#2764) ──────
  it('collapses a runaway dot wall served through a snippet surface', () => {
    const t = 'the temple of [...] before the ' + '.'.repeat(800) + ' and then the river';
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/\.{12}/);            // no dot wall survives
    expect(out).toContain('the temple of');
    expect(out).toContain('and then the river'); // text after the lacuna survives
  });
});

describe('cleanOcrArtifacts', () => {
  it('collapses 12+ literal dots to a single […] marker', () => {
    expect(cleanOcrArtifacts('before ' + '.'.repeat(2000) + ' after')).toBe('before […] after');
  });

  it('collapses spaced-out dot lacunae (". . . .")', () => {
    expect(cleanOcrArtifacts('μῆνιν ' + '. '.repeat(20).trim() + ' θεά')).toBe('μῆνιν […] θεά');
  });

  it('collapses long underscore blank-fills', () => {
    expect(cleanOcrArtifacts('name: ' + '_'.repeat(30))).toBe('name: […]');
  });

  it('collapses a long dash rule but NOT a markdown table separator', () => {
    expect(cleanOcrArtifacts('section ' + '—'.repeat(20))).toContain('[…]');
    // A wide table separator must survive intact (dashes touch a pipe).
    const sep = '| Name | Page |\n|--------------|--------------|\n| Aquinas | 187 |';
    expect(cleanOcrArtifacts(sep)).toBe(sep);
  });

  it('leaves short, normal punctuation runs alone', () => {
    expect(cleanOcrArtifacts('wait... what? — yes')).toBe('wait... what? — yes');
    expect(cleanOcrArtifacts('a --- thematic break')).toBe('a --- thematic break');
  });

  it('converts leaked LaTeX fractions and roots to readable form', () => {
    expect(cleanOcrArtifacts('the ratio $\\frac{a}{b}$ holds')).toBe('the ratio (a)/(b) holds');
    expect(cleanOcrArtifacts('bare \\frac{1}{2} too')).toBe('bare (1)/(2) too');
    expect(cleanOcrArtifacts('side $\\sqrt{2}$')).toBe('side √(2)');
  });

  it('converts common LaTeX operators', () => {
    expect(cleanOcrArtifacts('3 \\times 4 \\div 2 \\pm 1')).toBe('3 × 4 ÷ 2 ± 1');
    expect(cleanOcrArtifacts('a \\leq b \\geq c \\neq d')).toBe('a ≤ b ≥ c ≠ d');
  });

  it('leaves $^{n}$ superscript spans for the reader to render', () => {
    // The reader turns these into <sup> downstream — cleanOcrArtifacts must not touch them.
    expect(cleanOcrArtifacts('verse $^{19}$ here')).toBe('verse $^{19}$ here');
  });

  it('is a no-op on ordinary prose and prices', () => {
    expect(cleanOcrArtifacts('a plain sentence with no artifacts.')).toBe('a plain sentence with no artifacts.');
    expect(cleanOcrArtifacts('it cost $5 to $10')).toBe('it cost $5 to $10');
  });
});

describe('stripLeadingAiPreamble (via cleanOcrArtifacts)', () => {
  it('strips the Dec-2025 language-mismatch disclaimer (real production case)', () => {
    const text =
      "Note: The text in the image is in French, not Latin. I have transcribed it exactly as it appears, including the use of the long 's' (ſ) and original punctuation.\n\nT A B L E\nCHAP. XII. *De la neceſſité…*";
    expect(cleanOcrArtifacts(text)).toBe('T A B L E\nCHAP. XII. *De la neceſſité…*');
  });

  it('strips a "Here is the transcription:" preface', () => {
    expect(cleanOcrArtifacts('Here is the transcription of the page as requested:\n\nDe Lapide Philosophorum')).toBe(
      'De Lapide Philosophorum',
    );
  });

  it('strips a refusal, leaving the page empty rather than fake text', () => {
    expect(cleanOcrArtifacts("I'm sorry, I cannot transcribe this image.")).toBe('');
  });

  it('strips a two-paragraph preamble (disclaimer + preface)', () => {
    const text =
      'Note: The text in the image is in German, not Latin.\n\nHere is the transcription as it appears:\n\nVon der wahren Medicin';
    expect(cleanOcrArtifacts(text)).toBe('Von der wahren Medicin');
  });

  it('keeps a printed editorial note that merely begins with "Note:"', () => {
    const printed = 'Note: this passage cannot be dated with certainty.\n\nBody text follows.';
    expect(cleanOcrArtifacts(printed)).toBe(printed);
  });

  it('keeps real body text that begins with "The image"', () => {
    const optics = 'The image formed by the lens is inverted and diminished.\n\nProposition II.';
    expect(cleanOcrArtifacts(optics)).toBe(optics);
  });

  it('keeps mid-text conversational-looking sentences (guard anchors to the start)', () => {
    const text = 'Real page text.\n\nNote: The text in the image is in French. I have transcribed it.';
    expect(cleanOcrArtifacts(text)).toBe(text);
  });

  it('does not touch tagged content — wrapper strip owns tags', () => {
    const tagged = '<warning>faded page</warning>\nBody text.';
    expect(cleanOcrArtifacts(tagged)).toBe(tagged);
  });

  it('does not strip an over-long opening paragraph even if it matches', () => {
    const long = 'Note: The text in the image ' + 'x'.repeat(520) + '\n\nBody.';
    expect(cleanOcrArtifacts(long)).toBe(long);
  });

  it('strips a multi-paragraph refusal including the "If you provide…" tail (production case)', () => {
    const refusal =
      'I cannot fulfill this request because no image of a manuscript page was provided. The image provided is a placeholder that says "image not available."\n\nIf you provide the actual image of the manuscript, I will transcribe it.';
    expect(cleanOcrArtifacts(refusal)).toBe('');
  });

  it('strips a "solid black image" refusal with a "Please provide…" tail (production case)', () => {
    const refusal =
      'I cannot transcribe this image because it is completely blank (solid black).\n\nPlease provide a clear image of the manuscript page you would like me to transcribe.';
    expect(cleanOcrArtifacts(refusal)).toBe('');
  });
});

// ReDoS guard (2026-07-18): the emphasis/centered-marker regexes originally
// used unbounded lazy interiors; on a junk page with thousands of stray
// asterisks each unpaired `*` scanned to end-of-line and the whole call went
// quadratic (a 400KB page held the ngram build at 111% CPU for 2h; the same
// text through a reader/quote route would spin that request). Interiors are
// now capped at 300 chars and single-line. These tests pin both the bound and
// the preserved behavior.
describe('stripMarkdownMarkers ReDoS bound', () => {
  it('survives a 400KB junk page riddled with unpaired asterisks', () => {
    const junk = ('lorem ipsum * dolor ** sit -> amet '.repeat(20) + '\n').repeat(600);
    expect(junk.length).toBeGreaterThan(400_000);
    const t0 = Date.now();
    stripEditorialWrappers(junk);
    // Unbounded interiors take minutes-to-hours here; bounded takes ~tens of ms.
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('still strips normal emphasis and centered markers', () => {
    expect(stripEditorialWrappers('**B** and *italic* and ***both***')).toBe('B and italic and both');
    expect(stripEditorialWrappers('->THE END.<-')).toBe('THE END.');
  });

  it('leaves markers literal on over-long spans instead of scanning', () => {
    const long = '**' + 'a'.repeat(400) + '**';
    expect(stripEditorialWrappers(long)).toBe(long);
  });
});
