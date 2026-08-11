/**
 * `authors.variants[]` shape classification (#3894 follow-up).
 *
 * Behaviour tests against real variant strings from the corpus.
 *
 * The invariant: `matchable` means "safe to use as a lookup key". Both error
 * directions are costly, in opposite ways, and the test pins both:
 *
 *   marking a BAD variant matchable    → the identity layer resolves an incoming
 *                                        name onto the wrong person. This is not
 *                                        theoretical: "Cicero (ed. Manutius
 *                                        family)" is why a title page reading
 *                                        "Aldi Manvtii" resolved to Cicero.
 *
 *   marking a GOOD variant unmatchable → a real lookup key is withdrawn and the
 *                                        books that reach their author through
 *                                        it are orphaned. The first production
 *                                        run did this to 40 Zhang Jiebin books,
 *                                        25 Heo Jun and 17 Yao Genchō by reading
 *                                        a transliteration pair as two people.
 *
 * So the "one person" block below is exactly as load-bearing as the "several
 * people" block, and neither may be loosened to fix the other.
 */
import { describe, it, expect } from 'vitest';
import { classifyVariant, stripRole } from '../../scripts/lib/variant-shape.mjs';

describe('several people — must NOT be matchable', () => {
  const MULTI: Array<[string, number]> = [
    ['Galen; Karl Gottlob Kühn (ed.)', 2],
    ['Bernard P. Grenfell; Arthur S. Hunt', 2],
    ['Bernard P. Grenfell & Arthur S. Hunt', 2],
    ['Philip Schaff & Henry Wace (eds.)', 2],
    ['Lull, Ramón|Bernhardus Trevisanus|Basilius Valentinus|Potier, Michael', 4],
    ['Geber|Bacon, Roger|Richardus Anglicus|Calid|Hermes Trismegistus|Hortulanus', 6],
  ];
  for (const [v, n] of MULTI) {
    it(`${v.slice(0, 44)}… → ${n} people`, () => {
      const c = classifyVariant(v);
      expect(c.shape).toBe('multi_person');
      expect(c.matchable).toBe(false);
      expect(c.people.length).toBe(n);
    });
  }
});

describe('one person in two scripts — MUST stay matchable', () => {
  // Withdrawing these strips the romanised key that is the only way most
  // callers can reach these authors.
  const PAIRS = [
    'Zhang, Jiebin, 1563-1640; 張介賓, 1563-1640',
    'Hŏ, Chun, 1546-1615; 許浚, 1546-1615',
    'Yao, Genchō, 1633-1673; 八尾玄長, 1633-1673',
    'Ji Xue approximately 1488-1558; 薛己, approximately 1488-1558',
    'Ma, Shi, active 15th century-16th century; 馬蒔, active 15th century-16th century',
  ];
  for (const v of PAIRS) {
    it(`${v.slice(0, 40)}… is ONE person`, () => {
      const c = classifyVariant(v);
      expect(c.shape).toBe('script_pair');
      expect(c.matchable).toBe(true);
    });
  }

  it('mixed scripts with DIFFERENT dates is still two people', () => {
    // The date agreement is what separates a transliteration from a compound.
    expect(classifyVariant('Zhang, Jiebin, 1563-1640; 李時珍, 1518-1593').shape).toBe('multi_person');
  });
});

describe('institutional headings containing "&" — MUST stay matchable', () => {
  for (const v of ['Drametse & Ogyen Choling Collection', 'Thadrak, Tshamdrak & Nyephug Collection']) {
    it(`${v} is one heading`, () => {
      const c = classifyVariant(v);
      expect(c.shape).toBe('institutional');
      expect(c.matchable).toBe(true);
    });
  }
});

describe('contributor and edition annotations — not matchable', () => {
  it('a role annotation marks a contributor, not the author', () => {
    const c = classifyVariant('Iamblichus (ed. Marsilio Ficino)');
    expect(c.matchable).toBe(false);
  });
  it('an edition annotation is not part of a name', () => {
    const c = classifyVariant('Jerome (Sixtine-Clementine edition)');
    expect(c.shape).toBe('edition_annotated');
    expect(c.matchable).toBe(false);
  });
  it('the Cicero variant that caused a real misresolution', () => {
    expect(classifyVariant('Cicero (ed. Manutius family)').matchable).toBe(false);
  });
});

describe('ordinary names stay matchable', () => {
  for (const v of ['Bodin, Jean', 'Jakob Böhme', 'Manuzio, Aldo',
    'Natta, Marco Antonio, n.?-m.1616', 'Pico della Mirandola, Giovanni, 1463-1494',
    'Aldus Manutius (the elder)', '王圻']) {
    it(`${v} is clean`, () => expect(classifyVariant(v).matchable).toBe(true));
  }
});

describe('stripRole', () => {
  it('drops a trailing role', () => expect(stripRole('Karl Gottlob Kühn (ed.)')).toBe('Karl Gottlob Kühn'));
  it('keeps life dates', () => expect(stripRole('Pico della Mirandola, Giovanni, 1463-1494'))
    .toBe('Pico della Mirandola, Giovanni, 1463-1494'));
});
