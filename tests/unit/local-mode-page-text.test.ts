/**
 * The desk reader's parser: each case is a defect seen on a real page, by eye,
 * in the screenshots taken while building it (De Aetna p.20, Mundus Subterraneus
 * pp.20, 40, 42). The inputs are the pipeline's own tagged strings.
 */
import { describe, it, expect } from 'vitest';
import { parsePageText, type Block, type Run } from '@/lib/local-mode/page-text';

const text = (runs: Run[]) => runs.map((r) => ('s' in r ? r.s : '\n')).join('');
const paras = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { kind: 'para' }> => b.kind === 'para');

// De Aetna dialogus (Aldus, 1495), page 20 — abridged.
const AETNA_OCR = `<scan-quality>good</scan-quality>
<language>Latin</language>
<page-type>text</page-type>
<sig>A iii</sig>

uiratu tuo : saepe enim ex te audiui ( si
fieri possit ) quoniam tibi id cum modice continge-
ret , tum etiam perraro.

->BEMBVS PATER<-

Est ita , ut
dicis : tanque a flucti -
bus , in hunc solitudinis portum

<vocab>Bembus, Pater, solitude</vocab>`;

const AETNA_TR = `having taken as it were some draught of Lethe <note>A river in the underworld whose waters caused forgetfulness</note>.

->BEMBUS THE FATHER<-

It is as you say.`;

describe('parsePageText — furniture and apparatus', () => {
  const p = parsePageText(AETNA_OCR);

  it('moves the printer\'s signature into the furniture, out of the text', () => {
    expect(p.furniture.signature).toBe('A iii');
    expect(JSON.stringify(p.blocks)).not.toContain('A iii');
  });

  it('reads language and page type, and never shows vocab as text', () => {
    expect(p.language).toBe('Latin');
    expect(p.pageType).toBe('text');
    expect(p.vocabulary).toEqual(['Bembus', 'Pater', 'solitude']);
    expect(JSON.stringify(p.blocks)).not.toMatch(/vocab|solitude,/);
  });
});

describe('parsePageText — reading text', () => {
  const p = parsePageText(AETNA_OCR);

  it('sets ->…<- as a centred block (the speaker, in a dialogue)', () => {
    expect(p.blocks).toContainEqual({ kind: 'centred', text: 'BEMBVS PATER' });
  });

  it('joins words the compositor broke across lines, both "continge-\\nret" and "flucti -\\nbus"', () => {
    const all = paras(p.blocks).map((b) => text(b.runs)).join(' ');
    expect(all).toContain('contingeret');
    expect(all).toContain('fluctibus');
    expect(all).not.toContain('\n');
  });
});

describe('parsePageText — notes become glosses keyed to their word', () => {
  const p = parsePageText(AETNA_TR);

  it('keys the note to the word before it', () => {
    expect(p.glosses).toEqual([{ id: 'g1', anchor: 'Lethe', text: 'A river in the underworld whose waters caused forgetfulness' }]);
    const runs = paras(p.blocks)[0].runs;
    expect(runs).toContainEqual({ t: 'anchor', s: 'Lethe', gloss: 'g1' });
  });

  it('closes up the space the note leaves behind ("Lethe." not "Lethe .")', () => {
    expect(text(paras(p.blocks)[0].runs)).toMatch(/Lethe\.$/);
  });

  it('keeps a note whole when it runs across a blank line', () => {
    const q = parsePageText('the line of direction<note>The vertical line\n\nrepresenting gravity</note>, which directs');
    expect(q.glosses[0].text).toBe('The vertical line representing gravity');
    expect(JSON.stringify(q.blocks)).not.toContain('<note');
  });
});

describe('parsePageText — markdown the translations carry', () => {
  it('turns **x** and *x* into emphasis runs, with no stray asterisks', () => {
    const q = parsePageText('the **line of direction**, and *Hedera* too');
    const runs = paras(q.blocks)[0].runs;
    expect(runs).toContainEqual({ t: 'strong', s: 'line of direction' });
    expect(runs).toContainEqual({ t: 'em', s: 'Hedera' });
    expect(text(runs)).not.toContain('*');
  });

  it('sets a ### heading, and a heading inside ->…<-, as a clean centred line', () => {
    const q = parsePageText('### Volume I, in the Preface\n\n->Propositio VIII. ### *Omnes minerales*<-');
    expect(q.blocks).toEqual([
      { kind: 'centred', text: 'Volume I, in the Preface' },
      { kind: 'centred', text: 'Propositio VIII. Omnes minerales' },
    ]);
  });
});

describe('parsePageText — a plate page', () => {
  const p = parsePageText(`<language>Latin</language>
<page-type>illustration</page-type>
<header>Tomus I. in præfatione Caput III.</header>
<image-desc>A copperplate engraving of a volcano.</image-desc>`);

  it('has no body text, but keeps the running head and the picture description', () => {
    expect(p.isEmpty).toBe(true);
    expect(p.furniture.header).toBe('Tomus I. in præfatione Caput III.');
    expect(p.imageDescription).toBe('A copperplate engraving of a volcano.');
  });
});

it('never throws on nothing', () => {
  expect(parsePageText(null).isEmpty).toBe(true);
  expect(parsePageText('').isEmpty).toBe(true);
});
