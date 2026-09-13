/**
 * #3825 — the outcomes of the v13-vs-v15 translation prompt A/B.
 *
 * Every one of these is a POSITIVE CONTROL: a hand-built page on which the
 * metric MUST fire, paired with a clean page on which it must not. A scorecard
 * whose metric cannot fire reports effort, not quality — the whole reason the
 * house rule exists (.claude/docs/invariants/measurement-instruments.md), and
 * the reason the first pass at the OCR prompt A/B had to be thrown away.
 *
 * The note verifier is NOT re-tested here; it is `parseTranslationTerms` from
 * scripts/lib/page-terms-parse.mjs, covered by tests/unit/page-terms-parse.test.ts.
 * What is tested is that this harness reads it correctly, including the case
 * that decides the whole study: a note quoting a phrase that is not on the page.
 */
import { describe, it, expect } from 'vitest';
import { scoreTranslation } from '../../scripts/eval/translation-prompt-ab.mjs';

const OCR = `<page-num>42</page-num><header>DE LAPIDE</header>
<vocab>prima materia (first matter), calcinatio (calcination)</vocab>
Materia prima omnium rerum est aqua. Hanc Hermes ἡσυχίαν vocat,
et per calcinationem purgatur antequam opus incipiat.`;

describe('verified-note rate (the primary outcome)', () => {
  it('fires on a fabricated original-note', () => {
    // "aqua permanens" is nowhere in the OCR above — this is the #3308 defect.
    const s = scoreTranslation(
      'The first matter of all things is water <note>original: "aqua permanens"</note>.',
      OCR,
    );
    expect(s.notes_emitted).toBe(1);
    expect(s.notes_verified).toBe(0);
    expect(s.verified_rate).toBe(0);
  });

  it('passes a verbatim original-note, including a non-Latin script', () => {
    const s = scoreTranslation(
      'stillness <note>original: "ἡσυχίαν" (hesychian)</note>, and purified by <note>original: "calcinationem"</note>.',
      OCR,
    );
    expect(s.notes_emitted).toBe(2);
    expect(s.notes_verified).toBe(2);
    expect(s.verified_rate).toBe(1);
  });

  it('reports null, not zero, when a page emits no notes at all', () => {
    // The gaming move the co-primary exists to catch: 0/0 must not score as 0%,
    // or "emit nothing" would look like a perfect arm.
    const s = scoreTranslation('The first matter of all things is water.', OCR);
    expect(s.notes_emitted).toBe(0);
    expect(s.verified_rate).toBeNull();
  });
});

describe('invented tags (#3825 item 1)', () => {
  it('fires on HTML and on an ad-hoc language tag', () => {
    const s = scoreTranslation(
      '<p>The first matter</p> is <greek>ἡσυχία</greek><br/>water.',
      OCR,
    );
    expect(s.invented_tags).toBeGreaterThan(0);
    expect(s.invented_names.sort()).toEqual(['br', 'greek', 'p']);
  });

  it('does not fire on the defined vocabulary', () => {
    const s = scoreTranslation(
      'The <term>prima materia</term> <gloss>first matter</gloss> is water. <summary>On the first matter.</summary><keywords>matter, water</keywords>',
      OCR,
    );
    expect(s.invented_tags).toBe(0);
    expect(s.terms_emitted).toBe(1);
    expect(s.keywords_emitted).toBe(2);
  });
});

describe('housekeeping-tag leakage (#3825 item 4)', () => {
  it('fires when the translation echoes OCR metadata', () => {
    const s = scoreTranslation(
      '<page-num>42</page-num><vocab>first matter, calcination</vocab>The first matter is water.',
      OCR,
    );
    expect(s.housekeeping_tags).toBeGreaterThan(0);
    expect(s.housekeeping_names).toContain('vocab');
    expect(s.housekeeping_names).toContain('page-num');
    // …and they are not miscounted as invented, which would double-charge the arm.
    expect(s.invented_tags).toBe(0);
  });

  it('does not fire on a clean translation', () => {
    const s = scoreTranslation('The first matter of all things is water.', OCR);
    expect(s.housekeeping_tags).toBe(0);
  });
});

describe('standalone glossary block (#3825 item 3)', () => {
  it('fires on a free-text vocabulary heading', () => {
    const s = scoreTranslation(
      'The first matter is water.\n\n**Vocabulary used in this passage:**\nprima materia: first matter\n',
      OCR,
    );
    expect(s.glossary_block).toBe(true);
  });

  it('fires on a trailing run of detached term/gloss pairs', () => {
    const s = scoreTranslation(
      'The first matter is water.\n\n<term>prima materia</term> <gloss>first matter</gloss>\n<term>aqua</term> <gloss>water</gloss>\n<term>calcinatio</term> <gloss>calcination</gloss>',
      OCR,
    );
    expect(s.glossary_block).toBe(true);
  });

  it('does not fire on terms annotated inline', () => {
    const s = scoreTranslation(
      'The <term>prima materia</term> <gloss>first matter</gloss> of all things is water, purified by <term>calcinatio</term> <gloss>calcination</gloss>.',
      OCR,
    );
    expect(s.glossary_block).toBe(false);
  });

  it('does not fire on three terms enumerated in ONE sentence', () => {
    // Line-per-entry is what makes a glossary; a list inside a sentence is prose.
    const s = scoreTranslation(
      'He names <term>sal</term> <gloss>salt</gloss>, <term>sulphur</term> <gloss>sulphur</gloss>, and <term>mercurius</term> <gloss>mercury</gloss> as the three principles.',
      OCR,
    );
    expect(s.glossary_block).toBe(false);
  });
});

describe('body length as a content-loss proxy', () => {
  it('is NOT reduced by removing a glossary block or an original-note citation', () => {
    // Both are removed by v15 BY DESIGN. If the proxy counted them, the gate
    // would fire on the intended change and the study could never flip.
    const clean = scoreTranslation('The first matter of all things is water.', OCR);
    const withGlossary = scoreTranslation(
      'The first matter of all things is water.\n\n**Vocabulary:**\nprima materia: first matter\naqua: water\n<summary>x</summary>',
      OCR,
    );
    const withCitation = scoreTranslation('The first matter of all things is water <note>original: "aqua"</note>.', OCR);
    expect(withGlossary.body_chars).toBe(clean.body_chars);
    expect(withCitation.body_chars).toBe(clean.body_chars);
  });

  it('does not treat centred-text markers (->text<-) as tags', () => {
    // Found on the real run: `<[^>]+>` swallowed 3,000 chars of a Latin page
    // between two centred headings and reported body=563.
    const s = scoreTranslation('->*APOLLO.*<-\n\nOffspring of Latona. Scion of Latona.\n\n->*APOLLONIA.*<-\n\nAlexandrian maiden.', OCR);
    expect(s.body_chars).toBeGreaterThan(60);
  });

  it('IS reduced by dropping an interpretive note', () => {
    const withNote = scoreTranslation('Water <note>that is, the humid radical</note> is first.', OCR);
    const without = scoreTranslation('Water is first.', OCR);
    expect(withNote.body_chars).toBeGreaterThan(without.body_chars);
  });
});

describe('body length and em-dashes', () => {
  it('measures prose, not apparatus', () => {
    const withApparatus = scoreTranslation(
      'Water is first.<summary>A long summary that is not body prose at all, running on.</summary><keywords>a, b, c, d, e</keywords>',
      OCR,
    );
    const bare = scoreTranslation('Water is first.', OCR);
    expect(withApparatus.body_chars).toBe(bare.body_chars);
  });

  it('counts em-dashes in authored prose (#3825 item 5)', () => {
    expect(scoreTranslation('Water — the first matter — is all.', OCR).emdashes).toBe(2);
    expect(scoreTranslation('Water, the first matter, is all.', OCR).emdashes).toBe(0);
  });
});
