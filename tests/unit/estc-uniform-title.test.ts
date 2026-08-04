/**
 * ESTC uniform-title extraction. (#3522)
 *
 * A MARC 240 is subfields flattened with ". ", and `$l` (language) is NOT
 * necessarily last — `$s` (version), `$k` (selections) and `$f` (date) follow it
 * routinely. The first implementation anchored the language to end-of-string and
 * therefore dropped every "Bible. Psalms. English. Sternhold and Hopkins." shape.
 * Caught by sampling: 9% of ESTC records carry the word "English" in a title but
 * only 5.5% matched, and the gap was almost entirely this.
 *
 * The opposite error matters just as much: a 245 DISPLAY title that merely
 * contains the word ("The English intelligencer", "English exercises for
 * school-boys to translate into Latin") is not a translation, and admitting
 * those would pour noise into a reference set whose whole job is deciding
 * whether a prior exists.
 *
 * Every string below is real, taken from a live CERL sample.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import { splitUniformTitle, toReferenceRow } from '../../scripts/enrichment/ingest-estc.mjs';

describe('language as the LAST component', () => {
  it.each([
    ['De consolatione philosophiae. English', 'De consolatione philosophiae'],
    ['Recueil des histoires de Troie. English', 'Recueil des histoires de Troie'],
    ['Della vanita delle scienze. English', 'Della vanita delle scienze'],
    ['Concio quam habuit reverendiss. in Christo pater Hugo Latimerus. English',
      'Concio quam habuit reverendiss. in Christo pater Hugo Latimerus'],
  ])('%s', (input, uniform) => {
    expect(splitUniformTitle(input)?.uniform).toBe(uniform);
  });
});

describe('language MID-field — the regression', () => {
  it.each([
    ['Bible. Psalms. English. Sternhold and Hopkins.', 'Bible. Psalms'],
    ['Bible. Old Testament. English. Authorised. Selections.', 'Bible. Old Testament'],
    ['Bible. English. Geneva.', 'Bible'],
  ])('%s', (input, uniform) => {
    const r = splitUniformTitle(input);
    expect(r, 'an end-anchored match drops this entire shape').not.toBeNull();
    expect(r.uniform).toBe(uniform);
    expect(r.declared).toBe('English');
  });

  it('handles a bilingual language component', () => {
    expect(splitUniformTitle('Catonis disticha. English and Latin.')?.declared).toBe('English and Latin');
    expect(splitUniformTitle('Poems. English & Italian.')?.uniform).toBe('Poems');
  });
});

describe('MUST NOT match — display titles that merely contain the word', () => {
  it.each([
    'The English intelligencer, shewing the true and most remarkeable passages',
    'English exercises for school-boys to translate into Latin, ... By J. Garretson',
    'The true English Protestants apology, against the blacke-mouth\'d obloquie',
    'The penman\'s companion containing specimens in all hands, by the most eminent English',
  ])('%s', (input) => {
    expect(splitUniformTitle(input)).toBeNull();
  });

  it('refuses a title that is nothing but the language', () => {
    // Nothing before the language means no work is named.
    expect(splitUniformTitle('English')).toBeNull();
    expect(splitUniformTitle('English.')).toBeNull();
  });
});

describe('toReferenceRow', () => {
  const row = {
    id: 'S100458',
    dates: ['1569'],
    language: 'eng',
    search_titles: [
      'Della vanita delle scienze. English',
      'Henrie Cornelius Agrippa, of the vanitie and vncertaintie of artes and sciences',
    ],
    search_names: ['Agrippa von Nettesheim, Heinrich Cornelius, 1486?-1535.', 'Sanford, James, translator.'],
    subjects: [],
  };

  it('takes the uniform title as the join key and the other title for display', () => {
    const r = toReferenceRow(row);
    expect(r.uniform_title).toBe('Della vanita delle scienze');
    expect(r.title).toMatch(/^Henrie Cornelius Agrippa/);
    expect(r.estc_id).toBe('S100458');
    expect(r.year).toBe('1569');
  });

  it('records HOW the translation was declared', () => {
    expect(toReferenceRow(row).translation_evidence).toBe('uniform_title_lang:English');
    expect(toReferenceRow({ ...row, search_titles: ['Some title'] }).translation_evidence)
      .toBe('translator_relator');
  });

  it('leaves original_languages EMPTY rather than guessing', () => {
    // ESTC records no original-language code. An empty array makes the language
    // screen treat it as UNKNOWN and KEEP the candidate; inventing a value here
    // would let it reject a real prior.
    expect(toReferenceRow(row).original_languages).toEqual([]);
  });

  it('sorts a translator out of the author entries', () => {
    const r = toReferenceRow(row);
    expect(r.author).toMatch(/^Agrippa/);
    expect(r.added_entries).toContain('Sanford, James, translator.');
  });
});
