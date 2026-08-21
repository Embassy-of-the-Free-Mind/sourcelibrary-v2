/**
 * The 041 item-language filter for the reference-set ingest. (#3556)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The filter read only the FIRST `041$a` and asked `startsWith('eng')`. MARC
 * lists an item's languages **in order of predominance**, so a facing-page
 * scholarly edition puts the ancient language first — the ancient text is the
 * primary content. `$a lat $a eng` and the concatenated `$a lateng` were both
 * rejected outright, which discarded the entire Loeb / I Tatti / Dumbarton Oaks
 * class: the dominant vehicle for scholarly English translations of exactly the
 * works this reference set exists to check.
 *
 * Downstream, Caplan's Loeb *Ad Herennium* returned ZERO rows and Lemay's
 * *Women's Secrets* was absent, while the search reported `none_found` for books
 * whose priors those are.
 *
 * The bug was invisible for two reasons that this test and the ingest's new
 * reject tally address together: the script reported only what it KEPT, and the
 * raw dump is deleted after extraction, so the discards could not be counted
 * afterwards either.
 *
 * These are behavioural — they build real MARC-XML record shapes and run the
 * extractor over them, so deleting the fix fails them.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import { itemLanguages, extractEnglishTranslation } from '../../scripts/enrichment/ingest-loc-bulk.mjs';

/** Minimal but real MARC-XML record. `langSubfields` are raw `041$a` values. */
function marc({
  langSubfields = ['eng'],
  original = 'lat',
  title = 'A title',
  uniform = '',
  f008 = '000000s2000    xx            000 0 eng d',
}: {
  langSubfields?: string[]; original?: string | null; title?: string;
  uniform?: string; f008?: string;
}) {
  const a = langSubfields.map((v) => `<subfield code="a">${v}</subfield>`).join('');
  const h = original ? `<subfield code="h">${original}</subfield>` : '';
  return `<record>
    <controlfield tag="008">${f008}</controlfield>
    <datafield tag="010"><subfield code="a">   12345678 </subfield></datafield>
    <datafield tag="041" ind1="1"culture="">${a}${h}</datafield>
    ${uniform ? `<datafield tag="240"><subfield code="a">${uniform}</subfield></datafield>` : ''}
    <datafield tag="245"><subfield code="a">${title}</subfield></datafield>
  </record>`;
}

describe('itemLanguages — both MARC encodings, order-independent', () => {
  it('reads repeated subfields: $a lat $a eng', () => {
    expect(itemLanguages(marc({ langSubfields: ['lat', 'eng'] }))).toEqual(['lat', 'eng']);
  });

  it('reads the concatenated form: $a lateng', () => {
    expect(itemLanguages(marc({ langSubfields: ['lateng'] }))).toEqual(['lat', 'eng']);
  });

  it('reads a concatenated run of three', () => {
    expect(itemLanguages(marc({ langSubfields: ['englatgrc'] }))).toEqual(['eng', 'lat', 'grc']);
  });

  it('falls back to the 008 language position when 041$a is absent', () => {
    const rec = `<record><controlfield tag="008">000000s2000    xx            000 0 eng d</controlfield>
      <datafield tag="041"><subfield code="h">lat</subfield></datafield></record>`;
    expect(itemLanguages(rec)).toEqual(['eng']);
  });

  it('dedupes and ignores punctuation/case', () => {
    expect(itemLanguages(marc({ langSubfields: ['ENG', 'eng.'] }))).toEqual(['eng']);
  });
});

describe('THE REGRESSION — bilingual editions must be kept', () => {
  // Each of these was rejected outright before #3556.
  it('keeps a Loeb-shaped record: Latin listed first, English second', () => {
    const row = extractEnglishTranslation(marc({
      langSubfields: ['lat', 'eng'], original: 'lat',
      title: 'Ad C. Herennium de ratione dicendi', uniform: 'Rhetorica ad Herennium.',
    }));
    expect(row, 'a facing-page Latin/English edition IS an English translation').not.toBeNull();
    expect(row.item_languages).toEqual(['lat', 'eng']);
    expect(row.bilingual).toBe(true);
  });

  it('keeps the concatenated Latin-first form', () => {
    expect(extractEnglishTranslation(marc({ langSubfields: ['lateng'] }))).not.toBeNull();
  });

  it('keeps a Greek-first bilingual', () => {
    const row = extractEnglishTranslation(marc({ langSubfields: ['grc', 'eng'], original: 'grc' }));
    expect(row).not.toBeNull();
    expect(row.bilingual).toBe(true);
  });

  it('still keeps the plain monolingual English translation', () => {
    const row = extractEnglishTranslation(marc({ langSubfields: ['eng'], original: 'ger' }));
    expect(row).not.toBeNull();
    expect(row.bilingual).toBe(false);
    expect(row.item_languages).toEqual(['eng']);
  });
});

describe('still rejects what it should', () => {
  it('rejects an item with no English at all', () => {
    // A French translation of a Latin work is not an English translation.
    expect(extractEnglishTranslation(marc({
      langSubfields: ['fre'], original: 'lat',
      f008: '000000s2000    xx            000 0 fre d',
    }))).toBeNull();
  });

  it('rejects a record with no 041$h — nothing asserts it is a translation', () => {
    expect(extractEnglishTranslation(marc({ langSubfields: ['eng'], original: null }))).toBeNull();
  });

  it('rejects a record with no 041 field at all', () => {
    expect(extractEnglishTranslation('<record><controlfield tag="008">x</controlfield></record>')).toBeNull();
  });
});

describe('the reject tally — a filter that reports only survivors cannot be audited', () => {
  it('reports WHY each record was dropped, and the offending language code', () => {
    const seen: Array<[string, string | undefined]> = [];
    const rej = (reason: string, detail?: string) => { seen.push([reason, detail]); };

    extractEnglishTranslation('<record></record>', rej);
    extractEnglishTranslation(marc({ langSubfields: ['eng'], original: null }), rej);
    extractEnglishTranslation(marc({
      langSubfields: ['fre'], original: 'lat',
      f008: '000000s2000    xx            000 0 fre d',
    }), rej);

    expect(seen.map(([r]) => r)).toEqual(['no_041', 'no_041h', 'item_not_english']);
    // The detail is what makes the blind spot visible: a rejected code containing
    // a language we translate FROM names a whole excluded class.
    expect(seen[2][1]).toBe('fre');
  });

  it('does not fire on a record that is kept', () => {
    const seen: string[] = [];
    extractEnglishTranslation(marc({ langSubfields: ['lat', 'eng'] }), (r: string) => seen.push(r));
    expect(seen).toEqual([]);
  });
});

describe('three grades of translation evidence (#3599)', () => {
  // Requiring 041$h was the dominant cause of 27% catalogue recall: of 136,193
  // English-language records in one part, 3,918 carry it and ~131,000 declare
  // nothing at all. Every confirmed-absent prior we chased was in LoC with a
  // good MARC 240 and no 041 — Caplan's Loeb Ad Herennium (LCCN 55004252).
  const withUniform = (uniform: string, lang?: string) => `<record>
    <controlfield tag="008">000000s1954    xx            000 0 eng d</controlfield>
    <datafield tag="240"><subfield code="a">${uniform}</subfield>${lang ? `<subfield code="l">${lang}</subfield>` : ''}</datafield>
    <datafield tag="245"><subfield code="a">Ad C. Herennium de ratione dicendi</subfield></datafield>
  </record>`;

  it('accepts 041$h as before', () => {
    const row = extractEnglishTranslation(marc({ langSubfields: ['eng'], original: 'lat' }));
    expect(row.translation_evidence).toBe('041h');
    expect(row.original_languages).toEqual(['lat']);
  });

  it('accepts 240$l English when there is no 041 at all — the Caplan shape', () => {
    const row = extractEnglishTranslation(withUniform('Rhetorica ad Herennium.', 'English'));
    expect(row, 'a 240 with $l English is the same assertion as 041$h').not.toBeNull();
    expect(row.translation_evidence).toBe('uniform_title_lang');
  });

  it('accepts 240$l mid-field, where $s or $k follows the language', () => {
    const rec = `<record>
      <controlfield tag="008">000000s1600    xx            000 0 eng d</controlfield>
      <datafield tag="240"><subfield code="a">Bible. Psalms</subfield><subfield code="l">English</subfield><subfield code="s">Sternhold and Hopkins</subfield></datafield>
      <datafield tag="245"><subfield code="a">The whole booke of Psalmes</subfield></datafield>
    </record>`;
    expect(extractEnglishTranslation(rec).translation_evidence).toBe('uniform_title_lang');
  });

  it('accepts a bare 240 on an English item as the WEAKEST grade, labelled', () => {
    const row = extractEnglishTranslation(withUniform('Rhetorica ad Herennium.'));
    expect(row.translation_evidence).toBe('uniform_title_only');
    // No 041$h means no source language. Empty is required: the language screen
    // reads unresolvable as UNKNOWN and keeps the candidate.
    expect(row.original_languages).toEqual([]);
  });

  it('still rejects an English item with no 240 and no 041$h', () => {
    const rec = `<record>
      <controlfield tag="008">000000s1900    xx            000 0 eng d</controlfield>
      <datafield tag="245"><subfield code="a">An ordinary English book</subfield></datafield>
    </record>`;
    expect(extractEnglishTranslation(rec)).toBeNull();
  });

  it('still rejects a non-English item however it declares itself', () => {
    const rec = `<record>
      <controlfield tag="008">000000s1600    xx            000 0 fre d</controlfield>
      <datafield tag="240"><subfield code="a">Rhetorica ad Herennium.</subfield><subfield code="l">French</subfield></datafield>
    </record>`;
    expect(extractEnglishTranslation(rec)).toBeNull();
  });
});
