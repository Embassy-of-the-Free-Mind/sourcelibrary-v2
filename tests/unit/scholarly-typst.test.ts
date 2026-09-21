/**
 * The scholarly deposit PDF is permanent once Zenodo has it, so the text
 * pipeline's failure modes are pinned here. Each case is one that reached a
 * rendered page while the typography was being rebuilt (2026-09-21).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
// @ts-expect-error — plain .mjs script library, no types
import { translationToTypst, findRunningHeads, generateTypstSource, generateScholarlyPdf } from '../../scripts/lib/scholarly-typst.mjs';

const page = (n: number, data: string) => ({ page_number: n, translation: { data } });

describe('translationToTypst', () => {
  it('ends a labelled marginal note at its own line, not at the end of the paragraph', () => {
    // A page with no blank lines: the author's next speech must stay in the body
    const { body } = translationToTypst(
      'Theod. I find Triton\'s trumpets.\n[Marginal note:] Origin and use of the Murex.\nCosmiel. Those are murex shells, most famous in every age, the unique ornament of Kings.',
    );
    expect(body).toContain('#mnote[Origin and use of the Murex.]');
    expect(body).toMatch(/\nCosmiel\. Those are murex shells/);
  });

  it('gathers the short lines under a bare label and stops at the first full line', () => {
    const { body } = translationToTypst(
      '[Marginal note:]\nTwofold nourishment\nof birds.\n\nCOSMIEL. Every kind of bird is born from seed, and seed from nourishment, which draws its origin from the air.',
    );
    expect(body).toContain('#mnote[Twofold nourishment of birds.]');
    expect(body).toContain('COSMIEL. Every kind of bird');
  });

  it('takes a printed running head as the page number, not as text', () => {
    const { body, printedPage } = translationToTypst('**Cap. V. On the globe of the Earth. 103**\n\nborn, is the multitude.');
    expect(printedPage).toBe('103');
    expect(body).toBe('born, is the multitude.');
  });

  it('leaves a first line alone when it only looks a little like a running head', () => {
    const { body, printedPage } = translationToTypst('In that year the plague returned to the city and all who could leave it left by the river gate in 1630\n\nMore text.');
    expect(printedPage).toBeNull();
    expect(body).toContain('river gate in 1630');
  });

  it('strips entities, attribute-bearing HTML and metadata tags', () => {
    const { body, printedPage } = translationToTypst(
      '<meta>About the page.</meta>\n<page-num>140</page-num>\n\n<div align="center">R</div> text&nbsp;&nbsp;&nbsp;here &nbsp\n\n<summary>s</summary>',
    );
    expect(printedPage).toBe('140');
    expect(body).not.toMatch(/&nbsp|<div|About the page|<summary/);
    expect(body).toContain('text here');
  });

  it('turns notes and explanatory terms into footnotes and resolves a note nested in one', () => {
    const { body } = translationToTypst('the interpreters <term>hypophetas: secondary priests <note>so Ficino</note></term> must abstain.');
    expect(body).toContain('#footnote[hypophetas: secondary priests');
    expect(body).not.toContain('%%');
  });

  it('does not backtrack on a long first line', () => {
    const started = Date.now();
    translationToTypst(`${'word '.repeat(2000)}\nnext`);
    findRunningHeads([page(1, `${'word '.repeat(2000)}\nnext`)]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('findRunningHeads', () => {
  it('calls a page-opening line a running head only when it recurs', () => {
    const pages = [
      ...[1, 2, 3, 4, 5].map(n => page(n, `-># IAMBLICHUS #<-\n\nText of page ${n}.`)),
      page(6, '### Concerning Sacrifices\n\nIt is asked by what logic.'),
      page(7, '<margin>A</margin>\n\nText.'),
    ];
    const heads = findRunningHeads(pages);
    expect([...heads]).toEqual(['iamblichus']);
  });
});

describe('generateTypstSource', () => {
  const book = { id: 'b1', slug: 'a-book', title: 'Liber "de" #rebus', display_title: 'A Book: Of Things', author: 'A | B', language: 'Latin', published: '1657' };
  const pages = [
    page(1, '# Chapter One #\n\n[Marginal note: A note.]\nBody text with *emphasis*.and a <note>note [with] #brackets</note>.'),
    page(2, '/ slash start\n- dash start\n1. numbered\n\n' + ['Aloe','Basil','Caraway','Dodder','Elder','Fennel','Garlic','Hyssop','Iris','Juniper','Kale','Lovage','Mallow','Nettle'].map((n, i) => `${n} ${i + 100}.A`).join('\n')),
  ];

  it('anchors every source page and keeps the DOI when it has one', () => {
    const src = generateTypstSource(book, pages, { doi: '10.5281/zenodo.1', version: '1.0.0' });
    expect(src).toContain('#src("1")');
    expect(src).toContain('#src("2")');
    expect(src).toContain('https://doi.org/10.5281/zenodo.1');
    expect(src).toContain('A, B');
  });

  const hasTypst = (() => { try { execSync('typst --version', { stdio: 'pipe' }); return true; } catch { return false; } })();
  it.skipIf(!hasTypst)('compiles', async () => {
    const pdf = await generateScholarlyPdf(book, pages, { introduction: '## Context\n\nAn *intro* with https://example.org/x.' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60000);
});
