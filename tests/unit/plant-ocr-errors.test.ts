/**
 * #7611: the planted-error controls for the router judge (scripts/eval/lib/plant-ocr-errors.mjs) — every plant records
 * the exact span it changed, is deterministic by seed, never touches markup / headers / the first and last printed line,
 * and the scoring counts a catch as a rejection or the plant named.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { plantError, unplant, bodyLines, layoutMode, scorePlant, namedPlant, bumpNumber, romanValue, romanOf, ERROR_KINDS } from '../../scripts/eval/lib/plant-ocr-errors.mjs';

const LATIN_LINES = `<scan-quality>good</scan-quality>
<language>Latin</language>
<page-type>text</page-type>
<header>LIBER SECVNDVS 1563.</header>
<page-num>107</page-num>
CAPVT VII. DE LAPIDE ET EIVS duabus partibus
Quod si quis in hac arte veritatem quærit, ex duabus
partibus constare dicitur, quarum prima est ratione
animi, altera corporis operatione perficitur. Hoc anno
1563 scripsit Paracelsus in Basilea de compositione
lapidis, & septem metallorum generatione tractauit.
Quod etiam in Germania multi fecerunt. Nam qui
substantiam rei non intelligit, nihil efficit in hac
arte, nisi quod tempus perdit & pecuniam suam.
Sic autem procedendum est in tertio capite.
<margin>Nota 1563 et rationem</margin>
<meta>catchword: sequitur</meta>`;

const FRENCH_PARAS = `<page-num>12</page-num>

Le premier paragraphe commence ici sans majuscule et continue avec une phrase. La seconde phrase parle de la composition des métaux en trois parties distinctes. Une troisième phrase rappelle que le 25 décembre était une fête solennelle chez les anciens peuples.

Le second paragraphe décrit la préparation du remède avec beaucoup de soin. Il faut ensuite observer la couleur et la qualité de la matière pendant quatre jours. Les auteurs anciens en ont parlé longuement dans leurs ouvrages.

---

(1) Voir les textes réunis par Mommsen, t. I, p. 409.`;

const furniture = (text: string) => {
  const lines = text.split('\n'), body = new Set(bodyLines(text));
  return lines.map((l, i) => (body.has(i) ? null : l));
};

describe('bodyLines', () => {
  it('excludes markup, the header, a margin note, the first and last printed lines and the footnotes', () => {
    const lines = LATIN_LINES.split('\n'), body = bodyLines(LATIN_LINES).map((i: number) => lines[i]);
    expect(body.some((l: string) => l.includes('<'))).toBe(false);
    expect(body[0]).toMatch(/^Quod si quis/);                 // CAPVT VII... is the first printed line: furniture
    expect(body.at(-1)).toMatch(/^arte, nisi quod/);         // the last printed line (catchword zone) is out
    expect(layoutMode(LATIN_LINES)).toBe('line');
    const fl = FRENCH_PARAS.split('\n'), fb = bodyLines(FRENCH_PARAS).map((i: number) => fl[i]);
    expect(layoutMode(FRENCH_PARAS)).toBe('paragraph');
    expect(fb).toHaveLength(2);                              // both paragraphs; the footnote after --- is not body
    expect(fb.some((l: string) => l.includes('Mommsen'))).toBe(false);
  });
});

describe('plantError', () => {
  const cases: [string, string][] = [[LATIN_LINES, 'Latin'], [FRENCH_PARAS, 'French']];

  it('changes exactly the recorded span: reversing the plant gives back the original', () => {
    for (const [text, lang] of cases) for (const kind of ERROR_KINDS) for (let seed = 1; seed <= 20; seed++) {
      const r = plantError(text, { kind, lang, seed });
      expect(r, `${lang} ${kind} ${seed}`).not.toBeNull();
      expect(r.text).not.toBe(text);
      expect(r.plant.kind).toBe(kind);
      expect(r.plant.before + r.plant.after).not.toBe('');
      expect(unplant(r.text, r.plant)).toBe(text);
    }
  });

  it('is deterministic by seed', () => {
    for (const [text, lang] of cases) for (const kind of ERROR_KINDS) {
      expect(plantError(text, { kind, lang, seed: 42 })).toEqual(plantError(text, { kind, lang, seed: 42 }));
    }
    const sites = new Set(Array.from({ length: 30 }, (_, s) => JSON.stringify(plantError(LATIN_LINES, { kind: 'C', lang: 'Latin', seed: s + 1 }).plant)));
    expect(sites.size).toBeGreaterThan(1);                   // the seed moves the plant
  });

  it('never touches a header, a margin, a tag line, the first or last printed line, or a footnote', () => {
    for (const [text, lang] of cases) {
      const fixed = furniture(text);
      for (const kind of ERROR_KINDS) for (let seed = 1; seed <= 40; seed++) {
        const r = plantError(text, { kind, lang, seed });
        const after = r.text.split('\n');
        // every furniture line survives verbatim, in order
        const kept = fixed.filter((l: string | null) => l !== null);
        let j = 0; for (const l of after) if (j < kept.length && l === kept[j]) j++;
        expect(j, `${lang} ${kind} ${seed}: ${JSON.stringify(r.plant)}`).toBe(kept.length);
        expect(r.plant.before).not.toMatch(/[<>]/);
      }
    }
  });

  it('plants the variants the brief names', () => {
    const b = plantError(LATIN_LINES, { kind: 'B', lang: 'Latin', seed: 3 }).plant;
    expect(b.before).not.toBe(b.after);
    expect(/\d/.test(b.before) || ['duabus', 'septem', 'tertio', 'prima'].includes(b.before.toLowerCase())).toBe(true);
    const c = plantError(LATIN_LINES, { kind: 'C', lang: 'Latin', seed: 3 });
    expect(LATIN_LINES.toLowerCase()).not.toContain(c.plant.after.toLowerCase());   // the new noun is not on the page
    const d = plantError(LATIN_LINES, { kind: 'D', lang: 'Latin', seed: 3 });
    expect(d.text.split('\n')).toHaveLength(LATIN_LINES.split('\n').length - 1);   // one whole printed line
    const dp = plantError(FRENCH_PARAS, { kind: 'D', lang: 'French', seed: 3 }).plant;
    expect(dp.before.trim()).toMatch(/^[A-ZÀ-Ý].*[.?!]$/);                            // a whole sentence, paragraph-set
    const e = plantError(FRENCH_PARAS, { kind: 'E', lang: 'French', seed: 3 }).plant;
    expect(e.before).toBe(''); expect(e.after).toMatch(/[.]$/);
    expect(plantError(LATIN_LINES, { kind: 'A', lang: 'Latin', seed: 1 }).text).toBe(LATIN_LINES);
  });

  it('returns null where a page has no site, and refuses a language it has no bank for', () => {
    expect(plantError('<page-type>illustration</page-type>\n<image-desc>a woodcut</image-desc>', { kind: 'B', lang: 'Latin', seed: 1 })).toBeNull();
    expect(() => plantError(LATIN_LINES, { kind: 'B', lang: 'Tibetan', seed: 1 })).toThrow();
    expect(() => plantError(LATIN_LINES, { kind: 'B', lang: 'Latin' })).toThrow();
  });

  it('changes numbers the way it says', () => {
    expect(bumpNumber('1563')).toBe('1568'); expect(bumpNumber('1596')).toBe('1591');
    expect(bumpNumber('7')).toBe('10'); expect(bumpNumber('25')).toBe('35');
    expect(romanValue('vij')).toBe(7); expect(romanValue('XVIII')).toBe(18); expect(romanValue('ab')).toBeNull();
    expect(romanOf(9, 'vij')).toBe('ix'); expect(romanOf(8, 'vj')).toBe('viij'); expect(romanOf(20, 'XVIII')).toBe('XX');
  });
});

describe('scorePlant', () => {
  const plant = (kind: string, before: string, after: string) => ({ kind, before, after, mode: 'line' });
  it('caught = not accepted, or the plant named in a defect', () => {
    const p = plant('C', 'pietatem', 'humiditatem');
    expect(scorePlant({ accept: false, fidelity: 3, defects: [] }, p)).toEqual({ accepted: false, named: false, caught: true });
    expect(scorePlant({ accept: true, fidelity: 4, defects: [{ class: 'O6', quote: 'ueram humiditatem definiuit', severity: 'misleads' }] }, p)).toEqual({ accepted: true, named: true, caught: true });
    expect(scorePlant({ accept: true, fidelity: 5, defects: [{ class: 'O8', quote: 'pietatem', severity: 'cosmetic' }] }, p)).toEqual({ accepted: true, named: false, caught: false });
  });
  it('names a number only by the planted number, not a neighbour that contains it', () => {
    const p = plant('B', '1563', '1568');
    expect(namedPlant({ defects: [{ quote: 'anno 1568 scripsit' }] }, p)).toBe(true);
    expect(namedPlant({ defects: [{ quote: '15680' }] }, p)).toBe(false);
  });
  it('names an inserted sentence by three shared words, and a dropped line by an omission defect', () => {
    expect(namedPlant({ defects: [{ quote: 'veteres philosophi diligenter', class: 'O1' }] }, plant('E', '', 'Quod etiam veteres philosophi diligenter observaverunt.'))).toBe(true);
    expect(namedPlant({ defects: [{ quote: 'philosophi', class: 'O1' }] }, plant('E', '', 'Quod etiam veteres philosophi diligenter observaverunt.'))).toBe(false);
    expect(namedPlant({ defects: [{ quote: 'perficitur. Hoc anno', class: 'O5', what: 'a line is missing' }] }, plant('D', 'x', ''))).toBe(true);
    expect(namedPlant({ defects: [{ quote: 'x', class: 'O6', what: 'misread' }] }, plant('D', 'x', ''))).toBe(false);
  });
  it('an unchanged page is never a catch by name', () => {
    expect(scorePlant({ accept: true, fidelity: 5, defects: [{ quote: 'anything' }] }, { kind: 'A', before: '', after: '' }).caught).toBe(false);
  });
});
