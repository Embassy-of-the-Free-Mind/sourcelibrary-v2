/**
 * The modern-intrusion screen (#4960) must fire on the page that started it and stay silent on
 * every false-positive family found while building it. The positive control is the stored English
 * of Kircher, Iter extaticum II (1657), p.170 — a 2011 nephrology journal's table of contents —
 * which scored quality 100 and was one deposit from a permanent DOI.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { findModernIntrusions, screenBookPages, bookYear, intrusionBody } from '../../scripts/lib/modern-intrusion.mjs';

const KIRCHER_P170 = `We are pleased to present the first issue of the Journal of the American Society of Nephrology (JASN) for 2011. This issue contains a diverse collection of original research articles, reviews, and commentaries covering a wide range of topics in nephrology.

**Original Research Articles:**

*   **"Renal Denervation for the Treatment of Resistant Hypertension: A Randomized, Controlled Trial"** by Dr. John Smith and colleagues investigates the efficacy and safety of renal denervation in patients with resistant hypertension.
*   **"Genetic Polymorphisms in APOL1 and Risk of Kidney Disease in African Americans"** by Dr. Jane Doe and her team explores the association between APOL1 genetic variants and the risk of kidney disease.
*   **"Impact of Sodium-Glucose Cotransporter 2 (SGLT2) Inhibitors on Renal Outcomes in Patients with Type 2 Diabetes"** by Dr. Robert Johnson and co-authors examines the renoprotective effects of SGLT2 inhibitors.

**Reviews and Commentaries:**

*   **"The Role of the Gut Microbiome in Chronic Kidney Disease Progression"** by Dr. Emily White provides an overview.`;

const markers = (text: string, year: number | null) =>
  (findModernIntrusions(text, year) as { marker: string }[]).map((h) => h.marker);

describe('positive control: Kircher p.170', () => {
  it('fires, on several independent markers', () => {
    const m = markers(KIRCHER_P170, 1657);
    expect(m).toEqual(expect.arrayContaining(['nephrology', 'randomized-trial', 'type-2-diabetes', 'microbiome', 'gene-symbol']));
  });

  it('screenBookPages names the page', () => {
    const pages = [
      { page_number: 169, translation: { data: 'The sea monsters of the deep, said Cosmiel, are many.' } },
      { page_number: 170, translation: { data: KIRCHER_P170 } },
    ];
    const out = screenBookPages({ published: '1657' }, pages) as { page_number: number }[];
    expect(out.map((p) => p.page_number)).toEqual([170]);
  });

  it('a chatbot reply on a page fires', () => {
    expect(markers("I'm sorry, but I cannot transcribe this image.", 1600)).toContain('assistant-apology');
    expect(markers('As a matter of record, as an AI I cannot read this.', 1600)).toContain('as-an-ai');
  });
});

describe('negative controls: every false-positive family met while building it', () => {
  it('ordinary "I cannot" prose (Ficino)', () => {
    expect(markers('Truly, I cannot fail to be greatly delighted by your letters.', 1489)).toEqual([]);
  });

  it('table values that look like modern years (Rudolphine Tables)', () => {
    expect(markers('2000 2017 2061 2093 | 1.30103 | 1.30449', 1627)).toEqual([]);
  });

  it('"as an aid" and Marcgrave\'s sloth, "the Ai"', () => {
    expect(markers('This instrument serves as an aid to the memory.', 1600)).toEqual([]);
    expect(markers('#### CHAPTER ONE. *The Ai, or the Sloth.* A woodcut identified in the text as an Ai.', 1648)).toEqual([]);
  });

  it('digitizer notices are real text on a real leaf', () => {
    expect(markers('Digitized by the Internet Archive in 2012 with funding from Research Library, The Getty Research Institute http://archive.org/details/x', 1525)).toEqual([]);
  });

  it('modern words inside the model\'s <summary> are paraphrase, not the page', () => {
    const weyer = 'Some have touched upon this subject in our own language. <summary>Weyer defends his work as a rigorous, peer-reviewed study.</summary> <keywords>clinical trials</keywords>';
    expect(markers(weyer, 1563)).toEqual([]);
    expect(intrusionBody(weyer)).not.toContain('peer-reviewed');
  });

  it('a translator\'s <note>/<gloss> comparison is apparatus, not the leaf (Mesmer 1781, Avicenna)', () => {
    expect(markers('par la voie du sort <note>a very early proposal for what we would now call a randomized controlled trial.</note>. 7. The form', 1781)).toEqual([]);
    expect(markers('one is the path of <term>experiment</term> <gloss>clinical trial</gloss> and the other', 1489)).toEqual([]);
    expect(markers('N. N. <note>A placeholder for a name, similar to "John/Jane Doe"</note>, since she was present', 1586)).toEqual([]);
  });

  it('a translator\'s modern word for an old one is not an invented leaf (Galen, Casanova)', () => {
    expect(markers('I have not yet confirmed this through clinical trial, unlike everything else I have described.', 1821)).toEqual([]);
    expect(markers('— I am sorry, but I cannot; tell them the truth, that I am in bed and sick.', 1789)).toEqual([]);
  });

  it('a 1927 bibliography may cite a journal; a modern book may use modern words', () => {
    expect(markers('CASANOWICZ, J. M. Jewish Amulets. In: Journal of the American Oriental Society 36 (1916).', 1927)).toEqual([]);
    expect(markers('Results of a peer-reviewed study.', 1985)).toEqual([]);
    expect(markers('Results of a peer-reviewed study.', 1700)).toEqual(['peer-reviewed']);
  });
});

describe('bookYear', () => {
  it('reads the first plausible year, null when absent', () => {
    expect(bookYear('1657')).toBe(1657);
    expect(bookYear('c. 1563')).toBe(1563);
    expect(bookYear(1927)).toBe(1927);
    expect(bookYear('s.d.')).toBeNull();
    expect(bookYear(undefined)).toBeNull();
  });
});
