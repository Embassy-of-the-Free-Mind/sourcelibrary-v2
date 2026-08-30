import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script lib, no types
import { buildIndex, resolveName, linkQuality, authorsAgree } from '../../scripts/lib/artwork-work-resolver.mjs';

/**
 * Every case here is a defect this resolver actually produced against the live
 * corpus while building the #4037 review queue, caught by reading the sample.
 * They are the reason the queue exists: each one looked like a plausible link.
 */

const book = (o: Record<string, unknown>) => ({
  id: String(o.title), slug: 'x', visible: true, pages_ocr: 100, pages_translated: 90, ...o,
});

const index = buildIndex([
  book({ title: 'Marsilio Ficino Epistolae', author: 'Ficino, Marsilio' }),
  book({ title: 'Opera Omnia', author: 'Pico della Mirandola, Giovanni' }),
  // english_title is indexed alongside title — that is how "The Golden Ass"
  // reaches Apuleius' "Metamorphoseon Libri XI" in the live corpus.
  book({ title: 'Metamorphoseon Libri XI', english_title: 'The Golden Ass of Apuleius', author: 'Apuleius' }),
  book({ title: 'Ovid, Metamorphoses with Annotations', author: 'Ovid' }),
  book({ title: 'Iconologia', author: 'Ripa, Cesare' }),
  book({ title: 'Klugheit vereint mit Tugend', author: 'Anon' }),
  book({ title: 'Saturn Gnosis', author: 'Anon' }),
  book({ title: 'Atalanta Fugiens', author: 'Maier', visible: false, pages_ocr: 225, pages_translated: 225 }),
  book({ title: 'Atalanta Fugiens', author: 'Maier', id: 'visible-atalanta', pages_ocr: 194, pages_translated: 167 }),
  book({ title: 'A Life of Raphael', author: 'Götz, Raphael' }),
]);

describe('the specificity gate', () => {
  it('refuses single-word allegory labels that prefix a real title', () => {
    // "Prudence" prefix-matched "Klugheit…" only via an English title in prod;
    // the gate is what stops this whole class, so assert the class.
    expect(resolveName(index, 'Prudence')).toBeNull();
    expect(resolveName(index, 'Saturn')).toBeNull();
  });
});

describe('a person is not a work', () => {
  it('resolves a bare personal name to an AUTHOR even though it prefixes a title', () => {
    // Defect: "Marsilio Ficino" matched the work "Marsilio Ficino Epistolae",
    // pointing all 2,047 Ficino references at one volume.
    const hit = resolveName(index, 'Marsilio Ficino');
    expect(hit.kind).toBe('author');
  });

  it('tolerates name-form variation between enrichment and the catalogue', () => {
    // Defect: enrichment writes "Pico della Mirandola"; the catalogue holds
    // "Pico della Mirandola, Giovanni". Exact-key lookup missed, and the name
    // then resolved as the WORK "Opera Omnia".
    const hit = resolveName(index, 'Pico della Mirandola');
    expect(hit.kind).toBe('author');
  });

  it('does not read "Author, Work" as a person name', () => {
    // Defect: "Raphael, Transfiguration" matched a book by "Götz, Raphael" on
    // the shared given name alone.
    const hit = resolveName(index, 'Raphael, Transfiguration');
    expect(hit?.kind).not.toBe('author');
  });
});

describe('author agreement guards generic titles', () => {
  it('refuses a generic title whose author disagrees', () => {
    // "Opera Omnia" is generic across early-modern authors; unchecked it matched
    // whichever indexed first.
    expect(resolveName(index, 'Erasmus, Opera Omnia')).toBeNull();
  });

  it('accepts the work half when the author agrees', () => {
    expect(resolveName(index, 'Cesare Ripa, Iconologia').kind).toBe('work');
    expect(resolveName(index, 'Apuleius, The Golden Ass').book.title).toBe('Metamorphoseon Libri XI');
  });

  it('keeps Ovid off Apuleius despite both being "Metamorphoses"', () => {
    expect(resolveName(index, 'Ovid, Metamorphoses').book.author).toBe('Ovid');
  });
});

describe('link target selection', () => {
  it('prefers the visible edition over a hidden one with more OCR', () => {
    // Defect: the prototype filed Atalanta Fugiens as unreadable off a hidden
    // 225-page copy while a visible 194-page copy sat beside it.
    const hit = resolveName(index, 'Atalanta Fugiens');
    expect(hit.book.id).toBe('visible-atalanta');
  });

  it('scores a hidden book as unlinkable', () => {
    expect(linkQuality({ visible: false, pages_ocr: 500, pages_translated: 500 })).toBe(0);
  });

  it('separates "held but unreadable" from "readable"', () => {
    expect(linkQuality({ visible: true, pages_ocr: 0 })).toBe(1);
    expect(linkQuality({ visible: true, pages_ocr: 10, pages_translated: 10 })).toBe(3);
  });
});

describe('authorsAgree', () => {
  it('ignores particles that thousands of people share', () => {
    expect(authorsAgree('van der Meer', 'van der Berg')).toBe(false);
  });
  it('matches across name order', () => {
    expect(authorsAgree('Marsilio Ficino', 'Ficino, Marsilio')).toBe(true);
  });
});

describe('one shared given name is not a person match (2026-08-19 queue read)', () => {
  // Every case below is a live queue row that resolved WRONG: the token path
  // accepted any candidate sharing a single >=4-char name token. 3,947 of
  // 4,911 author-token rows shared only one token; a read of that bucket put
  // its wrong-rate near 85%.
  const painters = buildIndex([
    book({ title: 'Trattato dell arte della pittura', author: 'Giovanni Paolo Lomazzo' }),
    book({ title: 'Private Diary of Dr. John Dee', author: 'John Dee' }),
    book({ title: 'De transactionibus theses LXIV', author: 'Schorer, Matthäus' }),
    book({ title: 'Historia nuperae rerum mutationis in Anglia', author: 'Burridge, Ezekiel' }),
    book({ title: 'Berg-Ordnung im Hertzogthum Schlesien', author: 'Rudolf, II.' }),
    book({ title: 'Opera Omnia Erasmi', author: 'Erasmus von Rotterdam' }),
  ]);

  it('refuses a match on a shared given name alone', () => {
    expect(resolveName(painters, 'Paolo Veronese')).toBeNull();
    expect(resolveName(painters, 'Matthäus Merian')).toBeNull();
  });

  it('refuses biblical book titles that carry a personal name', () => {
    expect(resolveName(painters, 'Gospel of John')).toBeNull();
    expect(resolveName(painters, 'Ezekiel 37')).toBeNull();
  });

  it('still accepts full mutual coverage on a single distinctive token', () => {
    // "Rudolf II" and the catalogue's "Rudolf, II." are the same one-token name.
    expect(resolveName(painters, 'Rudolf II')?.kind).toBe('author');
  });

  it('still accepts two-token agreement across language forms', () => {
    // enrichment "Erasmus of Rotterdam" vs catalogue "Erasmus von Rotterdam"
    expect(resolveName(painters, 'Erasmus of Rotterdam')?.kind).toBe('author');
  });
});
