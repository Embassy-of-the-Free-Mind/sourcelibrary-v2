import { describe, it, expect } from 'vitest';
import { classifyTextRole, applyTextRole, textRoleRank } from '@/lib/text-role';

describe('classifyTextRole', () => {
  it('non-English scan is an original-language source', () => {
    expect(classifyTextRole({ language: 'German', title: 'Aurora', author: 'Jacob Böhme', year: 1634 }))
      .toEqual({ text_role: 'original', original_in_scan: false });
    expect(classifyTextRole({ language: 'Latin', title: 'De Occulta Philosophia', author: 'Agrippa' }).text_role)
      .toBe('original');
  });

  it('English book with no translation signal is an English-native original', () => {
    expect(classifyTextRole({ language: 'English', title: 'The Advancement of Learning', author: 'Francis Bacon', year: 1605 }).text_role)
      .toBe('original');
  });

  it('classical author in an English edition is a translation', () => {
    expect(classifyTextRole({ language: 'English', title: 'The Republic', author: 'Plato', year: 1901 }).text_role)
      .toBe('modern-translation');
  });

  it('"translated" / "tr." signals mark a translation', () => {
    expect(classifyTextRole({ language: 'English', title: 'The Dialogues', author: 'Plato; tr. Benjamin Jowett', year: 1875 }).text_role)
      .toBe('modern-translation');
    expect(classifyTextRole({ language: 'English', title: 'A Treatise Translated from the Latin', author: 'Anon', year: 1899 }).text_role)
      .toBe('modern-translation');
  });

  it('Loeb / Sacred Books of the East are modern translations with the original in scan', () => {
    expect(classifyTextRole({ language: 'English', title: 'Moralia (Loeb Classical Library)', author: 'Plutarch', year: 1927 }))
      .toEqual({ text_role: 'modern-translation', original_in_scan: true });
    expect(classifyTextRole({ language: 'English', title: 'The Sacred Books of the East: Upanishads', author: 'Max Müller', year: 1879 }).original_in_scan)
      .toBe(true);
  });

  it('a pre-1700 translation is a period-translation', () => {
    expect(classifyTextRole({ language: 'English', title: 'A Discourse Translated from the Latin', author: 'Anon', published: '1620' }).text_role)
      .toBe('period-translation');
  });

  it('derives the year from published / original_work_year when year is absent', () => {
    // pre-1700 → period; same signal but later year → modern
    expect(classifyTextRole({ language: 'English', title: 'Englished out of the Greek', author: 'Anon', published: 'London, 1599' }).text_role)
      .toBe('period-translation');
    expect(classifyTextRole({ language: 'English', title: 'Englished out of the Greek', author: 'Anon', published: 'London, 1899' }).text_role)
      .toBe('modern-translation');
  });

  it('explicit is_translation hint overrides the language proxy for non-English translations', () => {
    // Charles's 1916 English translation of John of Nikiu — no title/author
    // translation signal, so the heuristic alone reads it as English-native.
    expect(classifyTextRole({ language: 'English', title: 'John Of Nikiu Chronicle 1916', author: 'John of Nikiu', year: 1916, is_translation: true }).text_role)
      .toBe('modern-translation');
    // Chaignet's French Damascius — non-English, so the proxy would force 'original'.
    expect(classifyTextRole({ language: 'French', title: 'Vie de Porphyre', author: 'Bidez', year: 1913, is_translation: true }).text_role)
      .toBe('modern-translation');
    // A pre-1700 rendering with the hint is still a period-translation.
    expect(classifyTextRole({ language: 'German', title: 'Ein Alt Werk', author: 'Anon', year: 1580, is_translation: true }).text_role)
      .toBe('period-translation');
  });

  it('is_translation false / absent falls through to the normal heuristic', () => {
    expect(classifyTextRole({ language: 'German', title: 'Aurora', author: 'Böhme', is_translation: false }).text_role)
      .toBe('original');
  });
});

describe('applyTextRole', () => {
  it('mutates the doc with role + provenance', () => {
    const doc: Record<string, unknown> = { language: 'English', title: 'The Dialogues', author: 'Plato; tr. Jowett', year: 1875 };
    applyTextRole(doc);
    expect(doc.text_role).toBe('modern-translation');
    expect(doc.text_role_source).toBe('import-heuristic-v1');
  });

  it('sets original_in_scan only for Loeb/facing-page', () => {
    const loeb: Record<string, unknown> = { language: 'English', title: 'Moralia (Loeb)', author: 'Plutarch', year: 1927 };
    applyTextRole(loeb);
    expect(loeb.original_in_scan).toBe(true);

    const plain: Record<string, unknown> = { language: 'German', title: 'Aurora', author: 'Böhme' };
    applyTextRole(plain);
    expect(plain.original_in_scan).toBeUndefined();
  });

  it('respects an explicit pre-set text_role instead of re-deriving', () => {
    // A driver hard-sets the role for an edition the heuristic would misread.
    const doc: Record<string, unknown> = { language: 'French', title: 'Vie de Porphyre', author: 'Bidez', text_role: 'modern-translation' };
    applyTextRole(doc);
    expect(doc.text_role).toBe('modern-translation');
    expect(doc.text_role_source).toBe('import-explicit');
  });

  it('honours an is_translation hint passed through the doc', () => {
    const doc: Record<string, unknown> = { language: 'English', title: 'John Of Nikiu Chronicle 1916', author: 'John of Nikiu', year: 1916, is_translation: true };
    applyTextRole(doc);
    expect(doc.text_role).toBe('modern-translation');
  });
});

describe('textRoleRank fallback (unchanged)', () => {
  it('ranks by role, falling back to the language proxy when unset', () => {
    expect(textRoleRank('original')).toBe(0);
    expect(textRoleRank('modern-translation')).toBe(2);
    expect(textRoleRank(null, 'Latin')).toBe(0);
    expect(textRoleRank(null, 'English')).toBe(1);
  });
});

describe('non-English scans that name a translator (#3957)', () => {
  it('de Slane\'s French Muqaddimah — "(trans.)" in the author — is a translation', () => {
    expect(classifyTextRole({ language: 'French', title: 'Les prolégomènes d\'Ibn Khaldoun', author: 'Ibn Khaldun; de Slane (trans.)', year: 1863 }).text_role)
      .toBe('modern-translation');
  });

  it('Ficino\'s Latin Plotinus is a pre-1700 period-translation', () => {
    expect(classifyTextRole({ language: 'Latin', title: 'Plotini Libri Marsilio Ficino interprete', author: 'Plotinus', year: 1492 }).text_role)
      .toBe('period-translation');
    expect(classifyTextRole({ language: 'Latin', title: 'Platonis Opera', author: 'Plato; Marsilio Ficino (translator)', year: 1484 }).text_role)
      .toBe('period-translation');
  });

  it('reads vernacular and Latin title-page formulas, including non-ASCII ones', () => {
    const cases: Array<[string, string, number]> = [
      ['German', 'Lehrreiche Ermahnungen: Aus dem Französischen übersetzt', 1749],
      ['German', 'Kreutter Buch, auß der Griechischen sprachen verteutscht', 1546],
      ['French', 'Recueil de diverses histoires, nouvellement traduit de latin en francois', 1539],
      ['French', 'La Bible, le tout translaté en langue françoise', 1540],
      ['Italian', 'Le epistole famigliari di Cicerone, tradotte secondo i veri sensi', 1548],
      ['Dutch', 'Reys na Oost-Indien, nu alder-eerst uyt het Engels vertaald', 1707],
      ['Latin', 'Laonici Chalcondylae de rebus Turcorum, nuper e Graeco in Latinum conversi', 1556],
      ['Latin', 'Dissertatio, Anglice primum edita, nunc Latine reddita', 1675],
    ];
    for (const [language, title, year] of cases) {
      expect(classifyTextRole({ language, title, author: 'Anon', year }).text_role, title)
        .toBe(year < 1700 ? 'period-translation' : 'modern-translation');
    }
    expect(classifyTextRole({ language: 'German', title: 'Chronicon', author: 'Trithemius; Voegelin, Philipp-Ernst [Übers.]', year: 1616 }).text_role)
      .toBe('period-translation');
  });

  it('does not read "Tr" at the start of a non-ASCII name as "tr."', () => {
    expect(classifyTextRole({ language: 'French', title: 'Le songe du vergier', author: 'Trémaugon, Evrart de.', year: 1450 }).text_role)
      .toBe('original');
    expect(classifyTextRole({ language: 'Vietnamese', title: 'Gia Định Thành Thông Chí', author: 'Trịnh Hoài Đức', year: 1820 }).text_role)
      .toBe('original');
  });

  it('a classical author or "translatio" alone does not make a non-English scan a translation', () => {
    expect(classifyTextRole({ language: 'Greek', title: 'Πολιτεία', author: 'Plato', year: 1800 }).text_role).toBe('original');
    expect(classifyTextRole({ language: 'Latin', title: 'De translatione imperii', author: 'Flacius', year: 1566 }).text_role).toBe('original');
    // original_language is not trusted on non-English rows (mixed codes/names/wrong values)
    expect(classifyTextRole({ language: 'German', title: 'Theatrum machinarum', author: 'Zeising', original_language: 'Latin', year: 1708 }).text_role).toBe('original');
  });
});

describe('import-time classifier and the offline sweep agree', () => {
  it('classifyTextRole() and classify-text-role.mjs classify() give the same role', async () => {
    // @ts-expect-error — untyped .mjs script
    const { classify } = await import('../../scripts/maintenance/classify-text-role.mjs');
    const books = [
      { language: 'French', title: 'Prolégomènes', author: 'Ibn Khaldun; de Slane (trans.)', year: 1863 },
      { language: 'Latin', title: 'Platonis Opera Marsilio Ficino interprete', author: 'Plato', year: 1484 },
      { language: 'German', title: 'Aus dem Französischen übersetzt', author: 'Anon', year: 1749 },
      { language: 'French', title: 'Le songe du vergier', author: 'Trémaugon, Evrart de.', year: 1450 },
      { language: 'Latin', title: 'Epigrams (Loeb)', author: 'Martial', year: 1919 },
      { language: 'German', title: 'Aurora', author: 'Böhme', year: 1634 },
      { language: 'English', title: 'The Dialogues', author: 'Plato; tr. Jowett', year: 1875 },
      { language: 'English', title: 'The Advancement of Learning', author: 'Bacon', year: 1605 },
      { language: 'German', title: 'Ein Alt Werk', author: 'Anon', year: 1580, is_translation: true },
    ];
    for (const b of books) {
      const ts = classifyTextRole(b);
      const mjs = classify(b);
      expect({ role: mjs.role, loeb: mjs.loeb }, b.title).toEqual({ role: ts.text_role, loeb: ts.original_in_scan });
    }
  });

  it('the sweep never overwrites a human / curated / explicit role', async () => {
    // @ts-expect-error — untyped .mjs script
    const { isOverwritable } = await import('../../scripts/maintenance/classify-text-role.mjs');
    expect(isOverwritable({})).toBe(true);
    expect(isOverwritable({ text_role: 'original', text_role_source: 'heuristic-v1' })).toBe(true);
    expect(isOverwritable({ text_role: 'original', text_role_source: 'import-heuristic-v1' })).toBe(true);
    expect(isOverwritable({ text_role: 'period-translation', text_role_source: 'manual-3433' })).toBe(false);
    expect(isOverwritable({ text_role: 'modern-translation', text_role_source: 'human-qa-3942' })).toBe(false);
    expect(isOverwritable({ text_role: 'original' })).toBe(false);
  });

  it('--ids parses one id per line, ignoring blanks, comments and repeats', async () => {
    // @ts-expect-error — untyped .mjs script
    const { parseIdList } = await import('../../scripts/maintenance/classify-text-role.mjs');
    expect(parseIdList('a1\n\n# held\nb2  # Vives\na1\n')).toEqual(['a1', 'b2']);
    expect(parseIdList('\n# only comments\n')).toEqual([]);
  });

  it('--revert restores the logged previous role only if the book still holds what the run wrote', async () => {
    // @ts-expect-error — untyped .mjs script
    const { revertUpdate } = await import('../../scripts/maintenance/classify-text-role.mjs');
    const detail = { from: 'original', from_source: 'heuristic-v1', to: 'period-translation', to_source: 'heuristic-v1' };
    const u = revertUpdate({ text_role: 'period-translation', text_role_source: 'heuristic-v1' }, detail);
    expect(u.$set).toMatchObject({ text_role: 'original', text_role_source: 'heuristic-v1' });
    expect(u.$unset).toBeUndefined();
    // A person has since re-labelled it: leave it alone.
    expect(revertUpdate({ text_role: 'original', text_role_source: 'manual-3957' }, detail)).toBeNull();
    expect(revertUpdate({ text_role: 'period-translation', text_role_source: 'manual-3957' }, detail)).toBeNull();
    // A role that did not exist before the run is unset, not set to null.
    const fresh = revertUpdate({ text_role: 'modern-translation', text_role_source: 'heuristic-v1' }, { from: null, from_source: null, to: 'modern-translation' });
    expect(fresh.$unset).toEqual({ text_role: '', text_role_source: '' });
    expect(revertUpdate(null, detail)).toBeNull();
  });
});

describe('non-English edge cases (#3957)', () => {
  it('"(trad.)" is a traditional attribution, not a translator', () => {
    expect(classifyTextRole({ language: 'Hebrew', title: 'Song of Songs', author: 'Solomon (trad.)', year: 1500 }).text_role).toBe('original');
  });
  it('a Loeb tagged with its source language is still a modern translation with the original in scan', () => {
    expect(classifyTextRole({ language: 'Greek', title: 'Hippocrates, Vol. I (Loeb Classical Library)', author: 'Hippocrates', year: 1923 }))
      .toEqual({ text_role: 'modern-translation', original_in_scan: true });
  });
});
