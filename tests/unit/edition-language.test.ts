import { describe, it, expect } from 'vitest';
import {
  languageApparatus,
  languageApparatusFields,
  servesTranslatedOriginal,
} from '@/lib/edition-language';

// The two records from #3942, in the state they should hold after
// scripts/maintenance/fix-3942-edition-vs-work-language.mjs runs.
const IBN_KHALDUN = {
  language: 'French',
  original_language: 'Arabic',
  text_role: 'modern-translation',
  is_translation: true,
};
const HEBREW_MS = { language: 'Hebrew', text_role: 'original' };

describe('languageApparatus', () => {
  it('names both languages when the edition translates the work', () => {
    const a = languageApparatus(IBN_KHALDUN);
    expect(a.edition_language).toBe('French');
    expect(a.work_language).toBe('Arabic');
    expect(a.text_role).toBe('modern-translation');
    // The whole point of the field: the chain has to be legible without the
    // caller having to compare two scalars and infer the relationship.
    expect(a.translation_note).toContain('French');
    expect(a.translation_note).toContain('Arabic');
  });

  it('stays silent on an original-language edition', () => {
    const a = languageApparatus(HEBREW_MS);
    expect(a.edition_language).toBe('Hebrew');
    // Absent, not null — a null invites a caller to render "null" beside a
    // citation, and there is nothing here to disclose.
    expect('work_language' in a).toBe(false);
    expect('translation_note' in a).toBe(false);
    expect(servesTranslatedOriginal(HEBREW_MS)).toBe(false);
  });

  it('is the pre-fix Ibn Khaldun record that must NOT read as an Arabic source', () => {
    // Guard against a regression to the shape the issue reported: language
    // "Arabic", nothing else set. The apparatus can only report what the record
    // holds, so this stays quiet — the record is the bug, not the helper. What
    // it must never do is invent an Arabic `work_language` from the mislabel.
    const a = languageApparatus({ language: 'Arabic', text_role: 'original' });
    expect(a.edition_language).toBe('Arabic');
    expect(a.work_language).toBeUndefined();
    expect(a.translation_note).toBeUndefined();
  });

  it('drops a work language equal to the edition language', () => {
    // FRBR work == manifestation carries no information, and older records
    // predate resolveLanguage() dropping it at import.
    const a = languageApparatus({ language: 'Latin', original_language: 'Latin' });
    expect(a.work_language).toBeUndefined();
    expect(a.translation_note).toBeUndefined();
  });

  it('normalises codes on both sides before comparing them', () => {
    // "lat"/"Latin" is the same language; treating it as a difference would
    // stamp a false translation warning on an original-language edition.
    expect(languageApparatus({ language: 'lat', original_language: 'Latin' }).work_language).toBeUndefined();
    const a = languageApparatus({ language: 'fr', original_language: 'ara' });
    expect(a.edition_language).toBe('French');
    expect(a.work_language).toBe('Arabic');
  });

  it('warns from text_role alone when no work language is recorded', () => {
    // The common state in the corpus: a translation classified by the sweep,
    // with original_language never filled in. Failing quiet here would leave
    // the caller exactly as misled as before.
    const a = languageApparatus({ language: 'English', text_role: 'modern-translation' });
    expect(a.work_language).toBeUndefined();
    expect(a.translation_note).toContain('English');
    expect(a.translation_note).toContain('not recorded');
  });

  it('warns from is_translation alone', () => {
    expect(servesTranslatedOriginal({ language: 'English', is_translation: true })).toBe(true);
  });

  it('treats placeholder language tokens as no signal', () => {
    const a = languageApparatus({ language: 'Unknown', original_language: 'n/a' });
    expect(a.edition_language).toBeNull();
    expect(a.work_language).toBeUndefined();
  });

  it('languageApparatusFields omits the edition language it would duplicate', () => {
    const f = languageApparatusFields(IBN_KHALDUN);
    expect('edition_language' in f).toBe(false);
    expect(f.work_language).toBe('Arabic');
    expect(f.translation_note).toBeTruthy();
  });
});
