import { describe, it, expect } from 'vitest';
import {
  buildEditionKey,
  editionSurname,
  isTrustedEditionKey,
  normalizeEditionTitle,
  ustcEditionLink,
} from '@/lib/edition-key';
import { normalizeTitle } from '@/lib/dedup';

describe('normalizeEditionTitle', () => {
  it('matches dedup.normalizeTitle exactly on Latin input', () => {
    // The whole reason the cluster metric stays comparable to the pre-existing
    // baseline. If this ever diverges, the 296/+340 reference number is void.
    const latin = [
      'De Mysteriis Aegyptiorum',
      'The Chymical Wedding of Christian Rosenkreutz',
      'Opera omnia, Tomus II',
      "L'Alchimie et l'alchimistes",
      'Kitab al-Shifa (Latin trans.)',
      'Théâtre chimique — vol. 3',
    ];
    for (const t of latin) expect(normalizeEditionTitle(t)).toBe(normalizeTitle(t));
  });

  it('preserves non-Latin scripts that normalizeTitle erases', () => {
    // dedup.normalizeTitle strips [^\w\s] and JS \w is ASCII-only, so each of
    // these normalizes to '' there — 15% of the corpus had no edition layer.
    for (const t of ['營造法式', 'བཀའ་འགྱུར', 'كتاب الشفاء', 'Ἰλιάς', 'Тайная доктрина']) {
      expect(normalizeTitle(t)).toBe('');
      expect(normalizeEditionTitle(t)).not.toBe('');
    }
  });

  it('keeps CJK volume markers so juan ranges key apart', () => {
    // Real regression: eight juan ranges of the 34-volume Yingzao Fashi were
    // reported as seven duplicate copies because the Chinese ranges vanished.
    const a = normalizeEditionTitle('營造法式 (Yingzao Fashi) · 卷一~卷四');
    const b = normalizeEditionTitle('營造法式 (Yingzao Fashi) · 卷五~卷九');
    expect(a).not.toBe(b);
    expect(normalizeTitle('營造法式 (Yingzao Fashi) · 卷一~卷四'))
      .toBe(normalizeTitle('營造法式 (Yingzao Fashi) · 卷五~卷九'));
  });
});

describe('editionSurname', () => {
  it('collapses catalogue name-order variants to one surname', () => {
    expect(editionSurname('Lobel, Matthias de')).toBe('lobel');
    expect(editionSurname('Matthias de Lobel')).toBe('lobel');
    expect(editionSurname('Lobel, M.')).toBe('lobel');
  });

  it('strips life dates and diacritics', () => {
    expect(editionSurname('Ficino, Marsilio (1433-1499)')).toBe('ficino');
    expect(editionSurname('Paracelsus')).toBe('paracelsus');
    expect(editionSurname('Böhme, Jakob')).toBe('bohme');
  });

  it('returns empty for no author', () => {
    expect(editionSurname(null)).toBe('');
    expect(editionSurname('')).toBe('');
  });
});

describe('buildEditionKey', () => {
  it('keys title, surname, year and volume', () => {
    const r = buildEditionKey({ title: 'De Mysteriis Aegyptiorum', author: 'Iamblichus', year: 1607 });
    expect(r.key).toBe('mysteriis aegyptiorum|iamblichus|1607|v');
    expect(r.quality).toBe('full');
  });

  it('separates volumes of one set', () => {
    const a = buildEditionKey({ title: 'Opera omnia', display_title: 'Opera omnia, Tomus I', author: 'Ficino', year: 1576 });
    const b = buildEditionKey({ title: 'Opera omnia', display_title: 'Opera omnia, Tomus II', author: 'Ficino', year: 1576 });
    expect(a.key).not.toBe(b.key);
    expect(a.parts.volume).toBe(1);
    expect(b.parts.volume).toBe(2);
  });

  it('separates printings of one title by year', () => {
    const a = buildEditionKey({ title: 'Curiosa physica', author: 'Hellwig', year: 1700 });
    const b = buildEditionKey({ title: 'Curiosa physica', author: 'Hellwig', year: 1714 });
    expect(a.key).not.toBe(b.key);
  });

  it('falls back to `published` for the year', () => {
    const r = buildEditionKey({ title: 'Amphitheatrum sapientiae', author: 'Khunrath', published: 'Hanau, 1609' });
    expect(r.parts.year).toBe(1609);
    expect(r.quality).toBe('full');
  });

  it('downgrades quality when the year is unknown', () => {
    // The dangerous tier: with an empty year slot every printing of a title
    // collapses into one key. Fine for a review queue, not for a reader rail.
    const r = buildEditionKey({ title: 'Amphitheatrum sapientiae', author: 'Khunrath' });
    expect(r.quality).toBe('no-year');
    expect(isTrustedEditionKey(r.quality)).toBe(false);
  });

  it('downgrades quality when the author is unknown', () => {
    expect(buildEditionKey({ title: 'Rosarium philosophorum', year: 1550 }).quality).toBe('no-author');
    expect(buildEditionKey({ title: 'Rosarium philosophorum' }).quality).toBe('title-only');
  });

  it('refuses to key a stub title', () => {
    expect(buildEditionKey({ title: '', author: 'Anon' }).key).toBeNull();
    expect(buildEditionKey({ title: 'untitled', author: 'Anon' }).reason).toBe('title-uninformative');
    expect(buildEditionKey({ title: 'MS', author: 'Anon' }).key).toBeNull();
  });

  it('allows short titles in dense scripts', () => {
    // 營造法式 is a complete title in four characters; the Latin five-character
    // floor would throw it away.
    const r = buildEditionKey({ title: '營造法式', author: 'Li Jie', year: 1145 });
    expect(r.key).not.toBeNull();
    expect(r.quality).toBe('full');
  });
});

describe('ustcEditionLink', () => {
  it('promotes to edition authority only when the years agree', () => {
    const r = ustcEditionLink({
      title: 'Plantarum seu Stirpium Icones', author: 'Lobel', year: 1581,
      ustc_id: 401886, ustc_match: { ustc_year: 1581, confidence: 'high' },
    });
    expect(r).toMatchObject({ ustc: '401886', scope: 'edition' });
  });

  it('refuses a work-level match across a year gap', () => {
    // Hellwig, Curiosa physica: our 1714 copy matched to USTC's 1700 record,
    // the matcher itself calling it "a later edition of the same work".
    const r = ustcEditionLink({
      title: 'Curiosa physica', author: 'Hellwig', year: 1714,
      ustc_id: 2814137, ustc_match: { ustc_year: 1700, confidence: 'high' },
    });
    expect(r?.scope).toBe('unverified');
    expect(r?.reason).toMatch(/year disagreement/);
  });

  it('keeps the id but withholds authority when the match has no year', () => {
    const r = ustcEditionLink({ title: 'Tractatus duo', author: 'Drebbel', year: 1628, ustc_id: '2020434' });
    expect(r).toMatchObject({ ustc: '2020434', scope: 'unverified' });
  });

  it('never trusts a low-confidence match', () => {
    const r = ustcEditionLink({
      title: 'X', author: 'Y', year: 1600,
      ustc_id: 1, ustc_match: { ustc_year: 1600, confidence: 'low' },
    });
    expect(r?.scope).toBe('unverified');
  });

  it('returns null when there is no USTC id at all', () => {
    expect(ustcEditionLink({ title: 'X', author: 'Y', year: 1600 })).toBeNull();
  });
});
