import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { repairLeakedMarkup, LEAK_RULES } from '../../scripts/lib/leaked-markup.mjs';
import { censusPage } from '../../scripts/audit/leaked-markup-census.mjs';
import { stripEditorialWrappers as stripMjs } from '../../scripts/lib/strip-editorial-wrappers.mjs';
import { stripEditorialWrappers, stripEditorialWrapperBlocks } from '@/lib/strip-editorial-wrappers';
import { markdownToHtml } from '@/lib/export-markdown-html';
import NotesRenderer, { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

/**
 * #5700 A1(c) — raw markup in the English a reader sees, found by the random spot
 * check of 2026-10-06 (#5914). Every string below is an excerpt of a stored
 * `pages.translation.data`, cut but not edited.
 *
 * The repair is one function (scripts/lib/leaked-markup.mjs) called by the reader,
 * by stripEditorialWrappers (quotes, snippets, /text, PDF) and by the EPUB/HTML
 * export. The last block pins that all three call it: a fix that lands on one
 * surface is the failure text-helpers-and-exports.md is about.
 */

// The Song Celestial (699065e7726f64800c10c689), p. 23, page 699065e7726f64800c10c6a0
const SONG_NBSP = `Prepare what help they may! Now, blow my shell!"

&nbsp;&nbsp;&nbsp;&nbsp;Then, at the signal of the aged king,
With blare to wake the blood, rolling around
Like to a lion’s roar, the trumpeter`;
// The Song Celestial, p. 13, page 699065e7726f64800c10c696
const SONG_DUP = `Patanjali <note>The author of the Yoga Sutras, whose system focuses on physical and mental discipline.</note>, and the Vedas <term>Vedas</term> <note>The oldest and most authoritative scriptures of Hinduism, containing hymns, philosophy, and ritual instructions.</note>. So lofty`;
// Satchakranirupanam (6991d8938c1030b12444bfdb), p. 12, page 6991d8948c1030b12444bfe7
const SATCHAKRA = `"In the middle of that, two inches <gloss>in</gloss>ches above, is the **Vajra** and also the **Chitrini**."`;
// 6a08543515c643eb1af520a5 p. 561 — the <meta> is never closed; the page's own text follows the label
const META_UNCLOSED = `<header>DE RHET. AD HERENNIVM</header>
<meta>continues from previous page: ...ad Herennium, rather than the others, of which he makes absolutely no mention? But Quintilian remembers enough, who says that the rhetorical books of Cicero had escaped him.

Whence he openly hints at what Cicero says in the <term>Rhetorica ad Herennium</term>.`;
// 69944b491ba83513779056b0 p. 1037 — the label with no tag at all
const BARE_LABEL = `continues from previous page and if he fails in the trials he ponders or undertakes in action, he reaches the third aid, consolation.`;
// 69e7879f4a6785cfd60cc80f p. 22 (a two-leaf Tibetan frame) and 69dbc54437db7bc4b2eb2662 p. 526
const LEAF = `Following that, the heretics will seize the Dharma valleys. The Upper Hor\n</leaf-break/>\nshall be scattered.`;
const COLUMN = `the assigning of the genus which is said to be the genus. For</column-break/>the species is not said of the genus.`;
// 6a3c64c239b4508b04e29c9c p. 71
const NOTE_ATTR = `<note original: "御定佩文韻府">The Peiwen Yunfu, a comprehensive dictionary of poetic phrases</note>`;
const NOTE_ATTR_OPEN = `the poem "No Sheep" <note original: "无羊"> refers to King Xuan of Zhou <term>kao mu</term> <gloss>managing his pasturage</gloss>.`;
// 697b079711cc8928b55ea3b2 p. 233, 69af447908fe1c6d3da38b17 p. 10, 69ae955b14ec9b78c4cede73 p. 14
const HASHES = `ALDENSIANS BOOK THREE ###

<margin>25</margin> ### *That the cause of sin proceeded from the soul, not from the flesh, and*

| | ### SECTION 4. Physics. | in the same place |`;

const visible = (text: string, showNotes = true) =>
  renderToStaticMarkup(React.createElement(NotesRenderer, { text, showNotes, showMetadata: false }))
    .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('repairLeakedMarkup — one rule per real page', () => {
  it('decodes spacing entities: no-break spaces for the reader, one space or none in plain text', () => {
    expect(repairLeakedMarkup(SONG_NBSP)).toContain('\n    Then, at the signal');
    expect(repairLeakedMarkup(SONG_NBSP, { plain: true })).toContain('\nThen, at the signal');
    expect(repairLeakedMarkup('Preface of Simon Grynaeus &nbsp;&nbsp;&nbsp;&nbsp; α 2', { plain: true })).toBe('Preface of Simon Grynaeus α 2');
    expect(repairLeakedMarkup('ON THE MOTION OF THE HEART, &amp;c.')).toBe('ON THE MOTION OF THE HEART, &c.');
  });

  it('leaves the entities that are doing a job', () => {
    // `&lt;` decoded would open a tag; numeric ASCII entities escape Markdown.
    const kept = 'a &lt;f 3v&gt; reading | cell &#124; pipe | &#42;not emphasis&#42; &unknownname;';
    expect(repairLeakedMarkup(kept)).toBe(kept);
    expect(repairLeakedMarkup('caf&#233; &#x2014; &#8212;')).toBe('café — —');
  });

  it('drops the plain copy of a word the model then repeated as a term', () => {
    const out = repairLeakedMarkup(SONG_DUP);
    expect(out).toContain('and the <term>Vedas</term> <note>The oldest');
    expect(out).not.toContain('Vedas <term>Vedas');
    // the running text's casing wins; a multi-word term works the same way
    expect(repairLeakedMarkup('sulfur in the mastery <term>Mastery</term> ok')).toBe('sulfur in the <term>mastery</term> ok');
    expect(repairLeakedMarkup('small towns in the March <term>the March</term> ok')).toBe('small towns in <term>the March</term> ok');
  });

  it('does not touch a term that differs, a longer word, or a word-list entry', () => {
    for (const s of [
      'a little camphor <term>camphora</term> with',
      'the unmastery <term>mastery</term> of it',
      'orator <term>orator</term>\nlazy <term>piger</term>', // a Latin word list: English, then the source word
    ]) expect(repairLeakedMarkup(s)).toBe(s);
  });

  it('removes the tagged echo of a word', () => {
    expect(repairLeakedMarkup(SATCHAKRA)).toBe('"In the middle of that, two inches above, is the **Vajra** and also the **Chitrini**."');
    // a mark INSIDE a word is transcription (an uncertain syllable, a drop capital) and stays
    // 69cf7d11e721f92aaa5b891e p. 274 — a papyrus read letter by letter: `kai ai`, two words
    for (const s of ['through the al<unclear>ter</unclear>ation of', '<insert>H</insert>ere he has', 'at two <gloss>in</gloss>ches', '<unclear>k</unclear>ai <unclear>a</unclear>i <unclear>y</unclear>ph']) {
      expect(repairLeakedMarkup(s)).toBe(s);
    }
  });

  it('an unclosed continuity <meta> loses its opener and label, never the page text', () => {
    const out = repairLeakedMarkup(META_UNCLOSED);
    expect(out).not.toMatch(/<meta>|continues from previous page/);
    expect(out).toContain('...ad Herennium, rather than the others');
    expect(out).toContain('Whence he openly hints');
    expect(repairLeakedMarkup(BARE_LABEL)).toBe('and if he fails in the trials he ponders or undertakes in action, he reaches the third aid, consolation.');
  });

  it('leaves a closed <meta>, a printed "Continued from", and a label that is not at the top', () => {
    for (const s of [
      '<meta>continues from previous page: ...re-</meta>\n\nbody',
      '<meta>continues from previous page</meta>\n\n<meta>This page lists the lilies.</meta>\n\nbody',
      'EGOTISM\n(Continued from Page 1, Col. 2)\ncriticizing and attacking all creation',
      'Section 38.\ncontinues from previous page: the author explains',
      '<meta>This page describes a diagram\n\nBody text here.', // not a label: left for a human
    ]) expect(repairLeakedMarkup(s)).toBe(s);
    expect(repairLeakedMarkup('<meta type="continuity">continues from previous page</meta>\n\nbody')).toBe('<meta>continues from previous page</meta>\n\nbody');
    // 697e23c3eae9ff63cff4df70 p. 463: the catchword printed as body text
    expect(prepareNotesMarkdown('all their hands together: There-\n\n<meta type="catchword">fore</meta>', { showNotes: true }).processedText).toBe('all their hands together: There-');
    // 6984e84e45b45b78e8d48ab4 p. 126: self-closing — as an opener it would swallow text up to the next </meta>
    expect(repairLeakedMarkup('beneath the Kingdom.\n\n<meta catchword="Return"/>\n\nIn the *Book of Clarity* <meta>x</meta>')).toBe('beneath the Kingdom.\n\n\n\nIn the *Book of Clarity* <meta>x</meta>');
  });

  it('rewrites a break marker written as a closing tag', () => {
    expect(repairLeakedMarkup(LEAF)).toContain('\n<leaf-break/>\n');
    expect(repairLeakedMarkup(COLUMN)).toContain('For<column-break/>the species');
  });

  it('moves note words written as attributes into the note', () => {
    expect(repairLeakedMarkup(NOTE_ATTR)).toBe('<note>original: "御定佩文韻府"; The Peiwen Yunfu, a comprehensive dictionary of poetic phrases</note>');
    // nothing closes this one: the attribute is the whole note, and the sentence stays body text
    expect(repairLeakedMarkup(NOTE_ATTR_OPEN)).toBe('the poem "No Sheep" <note>original: "无羊"</note> refers to King Xuan of Zhou <term>kao mu</term> <gloss>managing his pasturage</gloss>.');
  });

  it('removes heading hashes Markdown would print', () => {
    expect(repairLeakedMarkup(HASHES)).toBe(`ALDENSIANS BOOK THREE

<margin>25</margin> *That the cause of sin proceeded from the soul, not from the flesh, and*

| | SECTION 4. Physics. | in the same place |`);
    expect(repairLeakedMarkup('<center>### CHRIST OR SCIENCE</center>')).toBe('<center>CHRIST OR SCIENCE</center>');
  });

  it('keeps real headings and a # that may be the source\'s own', () => {
    for (const s of [
      '# Book One\n## Chapter 2 ##\n-># DIALOGUE<-\n> ## quoted heading\n- ### in a list',
      'C#. Scarcely used; as D♭ it has fullness of tone.',
      'It came to pass on a holy Sabbath <margin># 2</margin> in Poznań',
      'see https://example.org/page#anchor ### here',
      'the #dispositions of all realms#', // Esukhia note points: a stored-text repair, not this one
    ]) expect(repairLeakedMarkup(s)).toBe(s);
  });

  it('is idempotent and returns clean text untouched', () => {
    const clean = 'Plain **text** with a <note>note</note> and a <term>term</term> <gloss>gloss</gloss>.\n\n## Heading\n\n->centred<-';
    expect(repairLeakedMarkup(clean)).toBe(clean);
    for (const s of [SONG_NBSP, SONG_DUP, SATCHAKRA, META_UNCLOSED, BARE_LABEL, LEAF, COLUMN, NOTE_ATTR, NOTE_ATTR_OPEN, HASHES]) {
      const once = repairLeakedMarkup(s);
      expect(repairLeakedMarkup(once)).toBe(once);
      const plain = repairLeakedMarkup(s, { plain: true });
      expect(repairLeakedMarkup(plain, { plain: true })).toBe(plain);
    }
    expect(repairLeakedMarkup('')).toBe('');
    expect(repairLeakedMarkup(null as unknown as string)).toBe(null);
  });

  it('stays linear on a junk page', () => {
    // Each shape once made a rule rescan the page: an unclosed <meta> per line, a note with
    // attribute words and no paragraph break, and very long runs of spaces before a tag or a #.
    const junk = [
      ('word <term>word</term> &nbsp; # ' + ' '.repeat(40) + '<meta>continues from previous page: x ').repeat(8000),
      '<note original: "x"> y '.repeat(20000),
      ('a' + ' '.repeat(20000) + '<term>abc</term>' + ' '.repeat(20000) + '#\n').repeat(4),
    ];
    const t0 = Date.now();
    for (const j of junk) { repairLeakedMarkup(j); repairLeakedMarkup(j, { plain: true }); }
    // ~100 ms when linear; any of the three quadratic forms takes tens of seconds.
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('reports what it did — the census counts with the repair itself', () => {
    const fired: Record<string, number> = {};
    repairLeakedMarkup([SONG_NBSP, SONG_DUP, SATCHAKRA, META_UNCLOSED, LEAF, NOTE_ATTR, HASHES].join('\n\n'), { fired });
    expect(fired).toMatchObject({ entity: 4, dup_term: 1, stutter: 1, meta_label: 1, break_tag: 1, tag_attr: 1, hash: 3 });
    expect(Object.keys(fired).every((k) => LEAK_RULES.includes(k))).toBe(true);
    const { hit, changed } = censusPage('<meta>continues from previous page: and so the philosophers say that the stone is one thing only</meta>\n\nbody text');
    expect(hit.meta_payload).toBe(1); // counted, deliberately not repaired (#5305)
    expect(changed).toBe(false);
  });
});

describe('every surface applies the same repair', () => {
  it('the reader shows none of it', () => {
    expect(visible(SONG_DUP)).not.toMatch(/Vedas\s+Vedas/);
    expect(visible(SONG_DUP, false)).toMatch(/and the Vedas ?\. So lofty/);
    expect(visible(SATCHAKRA)).toContain('two inches above');
    expect(visible(LEAF)).not.toContain('leaf-break');
    expect(visible(COLUMN)).not.toContain('column-break');
    expect(visible(NOTE_ATTR)).not.toContain('<note');
    expect(visible(HASHES)).not.toContain('#');
    const meta = visible(META_UNCLOSED);
    expect(meta).not.toContain('continues from previous page');
    expect(meta).toContain('...ad Herennium, rather than the others');
  });

  it('the reader keeps a leaf seam a seam, and a closed <meta> out of the body', () => {
    expect(prepareNotesMarkdown(LEAF, { showNotes: true }).processedText).toContain('<div class="leaf-break"></div>');
    const { processedText, metadata } = prepareNotesMarkdown('<meta>continues from page 10: ...re-</meta>\n\nturning to the matter', { showNotes: true });
    expect(processedText).toBe('turning to the matter');
    expect(metadata.meta).toEqual(['continues from page 10: ...re-']);
  });

  it('quotes and snippets (stripEditorialWrappers) — and the scripts twin agrees', () => {
    for (const s of [SONG_NBSP, SONG_DUP, SATCHAKRA, META_UNCLOSED, BARE_LABEL, LEAF, COLUMN, NOTE_ATTR, HASHES]) {
      const out = stripEditorialWrappers(s);
      expect(out).toBe(stripMjs(s));
      expect(out).not.toMatch(/&nbsp;|<\/(?:leaf|column)-break|continues from previous page|<note original|#/);
    }
    expect(stripEditorialWrappers(SONG_NBSP)).toContain('\nThen, at the signal of the aged king,');
    expect(stripEditorialWrappers(META_UNCLOSED)).toContain('...ad Herennium, rather than the others');
    // a leaf seam is a paragraph break in plain text, never a joined line (#5260)
    expect(stripEditorialWrappers(LEAF)).toMatch(/The Upper Hor\s*\n\n\s*shall be scattered/);
    expect(stripEditorialWrapperBlocks(SONG_NBSP)).toContain('    Then');
  });

  it('the EPUB/HTML export', () => {
    expect(markdownToHtml(SONG_NBSP)).not.toContain('nbsp');
    expect(markdownToHtml(SONG_DUP)).not.toMatch(/Vedas\s+<span[^>]*>Vedas/);
    expect(markdownToHtml(SATCHAKRA)).toContain('two inches above');
    const meta = markdownToHtml(META_UNCLOSED);
    expect(meta).not.toContain('continues from previous page');
    expect(meta).toContain('...ad Herennium, rather than the others');
    expect(markdownToHtml(COLUMN)).not.toContain('column-break');
  });
});
