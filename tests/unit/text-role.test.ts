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
});

describe('textRoleRank fallback (unchanged)', () => {
  it('ranks by role, falling back to the language proxy when unset', () => {
    expect(textRoleRank('original')).toBe(0);
    expect(textRoleRank('modern-translation')).toBe(2);
    expect(textRoleRank(null, 'Latin')).toBe(0);
    expect(textRoleRank(null, 'English')).toBe(1);
  });
});
