/**
 * Block parsing and the BLOCK-SHIFT guard (#5103 round 4).
 *
 * The fixture is a real block — pages 6–13 of the Apologia (Jakob Böhme's defender, 1675), the
 * j012 seam of the 63-seam fidelity draw — cut to each page's opening line. In round 4 the model
 * returned SEVEN well-formed entries for the eight pages: page 13 missing, and `<translation
 * page="8">` holding page 9's text ("auch selbst ein exemplarisch Leben…" → "even yourself an
 * exemplary life…"), page 9 holding page 10's, and so on. The worker's old parse accepted the seven
 * and would have written every one of them a page off. The guard: a short block is discarded whole.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseBlockTranslations } from '../../scripts/lib/translate-core.mjs';

const OCR: Record<number, string> = {
  6: 'Ewigkeit bleiben müssen. GOTT gibt uns nicht allein fromme Prediger / die uns zur Busse vermahnen und da',
  7: 'glauben als GOtt / wie die Juden auch von dem HErrn Christo muthmasseten / und sagten: Das muß vom Teuffel sey',
  8: 'der Welt auſſchreyen laſſen / dann die Welt bleibt Welt / und wird nicht anders / Gott mache auch was Er wolle',
  9: 'auch selbst ein exemplarisch Leben / gehe deinen Zuhörern mit guten Exempeln vor / so hastu ein gut Gewissen',
  10: 'stets beseuffze/ Gott Stündlich/ Augenblicklich anflehe in meinem Hertzen / daß Er mich doch stets mit seine',
  11: 'hinkomme / bin es auch versichere / habe es auch würcklich empfunden / und mein Leib und Seele hat sich darübe',
  12: 'langen nach der Warheit gehabt / und sich gerne von ihren gottlosen Wege haben wollen bekehren / dann GOTT hat',
  13: 'Leben ein lauter Creuz und Trübſal / und alſoleben ſie heilig / und ſind freudig / wann ſie aus dieſen zeitl',
};
// The correct translation of each page's opening (what a full block returns).
const TR: Record<number, string> = {
  6: 'Eternity must remain. GOD does not only give us pious preachers who admonish us to repentance and',
  7: 'But listen! What does GOD\'s word say to this, and our LORD Christ, whom the Jews also suspected',
  8: 'by the world, for the world remains the world and does not become otherwise. Let God do what He will',
  9: 'even yourself an exemplary life, go before your listeners with good examples, so you have a good conscience',
  10: 'always sigh, implore GOD hourly, momentarily in my heart, that He would always govern me with His good Spirit',
  11: 'am going, and am also assured of it, have also actually felt it, and my body and soul have rejoiced',
  12: 'for the truth, and have wanted to gladly convert from their godless ways, for GOD has',
  13: 'life a pure cross and tribulation, and thus they live holy and are joyful; when they depart',
};
const pages = [6, 7, 8, 9, 10, 11, 12, 13].map((n) => ({ page_number: n, ocr: { data: OCR[n] } }));
const entry = (n: number, text: string) => `<translation page="${n}">${text}</translation>`;

describe('parseBlockTranslations — the block-shift guard', () => {
  it('a block that comes back with fewer entries than pages sent is discarded whole (the j012 shift: 7 of 8, every label one page off)', () => {
    // What the model returned in round 4: pages 6 and 7 right, then page 8 carrying page 9's text …, page 13 gone.
    const shifted = [entry(6, TR[6]), entry(7, TR[7]), entry(8, TR[9]), entry(9, TR[10]), entry(10, TR[11]), entry(11, TR[12]), entry(12, TR[13])].join('\n');
    const r = parseBlockTranslations(shifted, pages);
    expect(r.returned).toBe(7);
    expect(r.discarded).toBe('short-block');
    expect(r.translations.size).toBe(0);
  });

  it('negative control — the same block with all eight entries is accepted, each on its own page', () => {
    const full = pages.map((p) => entry(p.page_number, TR[p.page_number])).join('\n');
    const r = parseBlockTranslations(full, pages);
    expect(r.discarded).toBeNull();
    expect(r.returned).toBe(8);
    expect(r.translations.size).toBe(8);
    expect(r.translations.get(8)).toBe(TR[8]);
    expect(r.translations.get(9)).toBe(TR[9]);
  });

  it('a full block with one truncated entry keeps the other seven — only that page falls back, the labels stand', () => {
    const full = pages.map((p) => entry(p.page_number, p.page_number === 10 ? 'sigh' : TR[p.page_number])).join('\n');
    const r = parseBlockTranslations(full, pages);
    expect(r.discarded).toBeNull();
    expect(r.returned).toBe(8);
    expect(r.translations.size).toBe(7);
    expect(r.translations.has(10)).toBe(false);
    expect(r.translations.get(11)).toBe(TR[11]);
  });

  it('a full block the model renumbered 1–8 is mapped back by position', () => {
    const renumbered = pages.map((p, i) => entry(i + 1, TR[p.page_number])).join('\n');
    const r = parseBlockTranslations(renumbered, pages);
    expect(r.discarded).toBeNull();
    expect(r.translations.get(6)).toBe(TR[6]);
    expect(r.translations.get(13)).toBe(TR[13]);
  });

  it('an empty or tagless response is a short block of zero entries', () => {
    expect(parseBlockTranslations('', pages)).toMatchObject({ returned: 0, discarded: 'short-block' });
    expect(parseBlockTranslations('Here are the translations…', pages).translations.size).toBe(0);
  });
});
