// The first-translation ingest withholds a badge when the search's own answer says the work was written in English
// (v3#32). Positives are verbatim work_identified / card text from the 2026-10-30 and 2026-11-13 nightlies, all of
// which were badged and then retracted by hand; negatives are the screen's false hits, which keep their badges.
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { englishOriginEvidence } from '../../scripts/ft-search/english-origin.mjs';

const ENGLISH_ORIGIN = [
  'Isaac Ambrose, Prima, Media, & Ultima (the first, middle and last things), a Puritan devotional work first published in English in London in 1650–1654. This is the 1688 Amsterdam Dutch translation.',
  "Samuel A. B. Mercer, The Ethiopic Liturgy (Hale Lectures 1914-15). This is an English-language work. It combines a study with the Ethiopic liturgy text and Mercer's own English translation of it.",
  'C. W. Leadbeater, Man Visible and Invisible (English original, London, 1902). This book is the German translation, Leipzig, c. 1908.',
  'George Best, A True Discourse (London, 1578). This 1706 Dutch book is a translation made from the English original, so the English text is the source and not a translation.',
  'Jane Lead, The Heavenly Cloud Now Breaking (London, 1681). This book is the 1696 Amsterdam Dutch translation. Lead wrote the work in English, so the English text is the original, not a translation.',
  'Thomas Vaughan, Magia Adamica (London, 1650). The 1704 German book is a translation of this English original, which was first published in English.',
  'Two letters by William Adams. This is a Dutch translation, published in 1706 by Pieter van der Aa in Leiden, of the English letters printed in Purchas His Pilgrimes (1625).',
  'George Smith, The Chaldean Account of Genesis (London, 1876). It is an original English-language work.',
  "William Allport Leighton, 'The Lichens of Ceylon' (1871). It is an English-language paper with Latin species diagnoses.",
  'Dutch version (Leiden, 1706) of three English Guiana voyage accounts. The Dutch text was translated from English and is not an original Dutch work.',
];

const NOT_ENGLISH_ORIGIN = [
  'Registrum brevium (Register of Writs), a 15th-century manuscript formulary of English original and judicial writs, Harvard Law School MS 25. It is mostly Latin with some Anglo-Norman French.',
  'Registrum brevium, a 15th-century manuscript formulary of English original writs, Harvard Law School Library MS 23.',
  'Communication einer vortrefflichen Chymischen Medicin (Augsburg, 1700). It is a German translation of English and Italian manuscripts about Federico Gualdi.',
  'Sanguozhi, Book of Wu juan 10-12. No complete English translation was found.',
  'Du Cerceau, Les plus excellents bastiments de France. The David Thomson 1988 lead is a partial facsimile edition. Its commentary was translated from English into French, and the du Cerceau text is not translated.',
  "The German text was translated from a Dutch pamphlet, 'De oprechte, en onvervalschte Engelandtsche waersegger' (Amsterdam, 1671), which claimed an English original.",
  'Kircher, Polygraphia nova et universalis (Rome, 1663). Only English-language secondary descriptions exist.',
  '',
];

describe('englishOriginEvidence', () => {
  it.each(ENGLISH_ORIGIN)('finds English origin: %s', (text) => {
    expect(englishOriginEvidence({ work_identified: text })).not.toBeNull();
  });
  it.each(NOT_ENGLISH_ORIGIN)('leaves the badge alone: %s', (text) => {
    expect(englishOriginEvidence({ work_identified: text })).toBeNull();
  });
  it('reads the card as well as work_identified, and tolerates a missing record', () => {
    expect(englishOriginEvidence({ work_identified: 'Prima, media, et ultima', card: 'The work was written in English, so the Dutch edition is itself the translation.' })).not.toBeNull();
    expect(englishOriginEvidence(undefined)).toBeNull();
  });
});
