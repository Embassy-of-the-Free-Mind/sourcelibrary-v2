/**
 * The Spanish column of a bilingual leaf (`scripts/lib/source-column.mjs`).
 *
 * What these pin, in order of how expensive the mistake is:
 *
 *  1. The column is chosen by its TEXT, never by the order of the OCR's
 *     `<language>` tag. Measured on Florentine Codex vol. 1: the model wrote
 *     "Spanish, Nahuatl" 300 times and "Nahuatl, Spanish" 24 times for the same
 *     physical layout, so an order-trusting reader puts Nahuatl into the Spanish
 *     lane on one page in fourteen and nothing downstream can tell.
 *  2. The book-level gate refuses the values that look Spanish and are not —
 *     "Spanish in Hebrew characters" (Judeo-Spanish in Hebrew script) — and does
 *     not overlap the NATIVE-edition set, which is a different mechanism.
 *  3. Editorial wrappers are stripped BEFORE scoring. The envelope's `<warning>`
 *     is prose about the page in English or Spanish and it sits above the first
 *     column; scored unstripped it lends the K'iche' column a Spanish share it
 *     has not got.
 *
 * The thresholds themselves are not pinned here — they are measured against the
 * corpus by `scripts/audit/source-column-separation.mjs`, which is the right
 * instrument for a question about distributions. These tests pin the RULES.
 */
import { describe, it, expect } from 'vitest';

import {
  isBilingualEditionLanguage,
  pageColumns,
  spanishColumnText,
  spanishFunctionWordShare,
  SOURCE_COLUMN_PROVENANCE,
} from '../../scripts/lib/source-column.mjs';
import { NATIVE_EDITION_LANGUAGE, isNativeEditionLanguage } from '../../scripts/lib/native-edition-language.mjs';
import { SOURCE_COLUMN_PROVENANCE as PROVENANCE_TS } from '../../src/lib/quote-text';

/** Ximénez, Ayer MS 1515, fol. 16r — K'iche' left, his Spanish right. */
const KICHE = `val la hucahau, mahabi achih vetaam uvach xghacut vhbal la quibih vi chi at hoxol chee
chipasu ixrahpop a chih chicama vloc v vqux chupan zel chiqui v loleh ahanab vacamic xevghax cut
ri hucuv, ecahib la xebec quihquem rizel la xebec quichelem ri capoh cucaan ri zaquiboc puzebal re
mani chuhinic quinicamizah ix zamahel rumal mani nu hoxbal rigo chinu pam xagui x vinaquiric xere
xbenumaihah ri v holom hunhunahpu, qochi puchal chah queque ta cut mani qui puz ix zamahel`;

const SPANISH = `Padre aun no he conocido varon esta bien dixo el ciertamente mereces fornicaria ea andad
vuestros señores principales andad y traed su calda, y traed su corazon en una hicara esto se les mando
a los tecolotes, que eran cuatro y luego fueron y tomaron una hicara y se fueron llevando la cargada,
y tambien llebaban una cuchilla aguda para rebanarla y entonces ella les dixo no me mateis mensageros
porque no soy fornicaria sino que solamente se engendro lo que tengo en la barriga`;

/** Florentine Codex, Nahuatl column — colonial orthography, Latin script. */
const NAHUATL = `Injc chicunavi capitulo, itechpa tlatoa in ilhuicatl, in tonatiuh, in metztli, in cicitlaltin,
auh in iehoatl in tlalticpactli, auh in cemanaoac in oncan onoque in maceoalti, auh in oncan mochioa in tonacaiotl,
in iehoatl in tlaolli, in etl, in aiotli, auh in izquitlamantli xochiqualli, in oncan mochioa in tlalticpac,
ca in iehoantin in vevetque, in ilamatque, iuh qujtoa, iuh qujmatia, ca in ilhuicac ca oncan in inchan in teteu`;

const ENVELOPE = (body: string) =>
  `<scan-quality>good</scan-quality>\n<language>K'iche', Spanish</language>\n<script>handwritten</script>\n`
  + `<page-type>text</page-type>\n<columns>2</columns>\n<page-num>16</page-num>\n`
  + `<warning>Handwritten Spanish colonial hand. The page contains a bilingual text with K'iche' in the `
  + `left column and a Spanish translation in the right column, and the scribal abbreviations for `
  + `"que" and "señores" have been expanded by the transcriber.</warning>\n\n${body}\n`
  + `<vocab>Hunhunahpu, hicara, tecolotes</vocab>`;

describe('the book-level gate', () => {
  it('accepts the catalogue values the corpus actually holds', () => {
    for (const v of ["K'iche' Maya-Spanish", 'Nahuatl-Spanish', 'Spanish / Latin', 'Spanish / French', 'Spanish, Nahuatl']) {
      expect(isBilingualEditionLanguage(v, 'es'), v).toBe(true);
    }
  });

  it('refuses a value that names Spanish but is not readable Spanish', () => {
    // Judeo-Spanish in Hebrew script parses to ONE token, so it can never look
    // like a two-language edition. A substring match would claim it.
    expect(isBilingualEditionLanguage('Spanish in Hebrew characters', 'es')).toBe(false);
  });

  it('refuses a bilingual edition that has no Spanish in it', () => {
    for (const v of ['Greek-Latin', 'Latin-German', 'Hebrew and Aramaic']) {
      expect(isBilingualEditionLanguage(v, 'es'), v).toBe(false);
    }
  });

  it('does not overlap the NATIVE-edition set', () => {
    // Two mechanisms, two disjoint sets: a book WRITTEN in Spanish is served
    // whole by `pageTextForLang`'s nativeEdition flag and must never also be
    // routed through the column extractor, which would decline half its pages.
    const values = [
      'Spanish', 'español', 'Castellano', 'Old Spanish', 'Spanish in Hebrew characters',
      'Nahuatl-Spanish', "K'iche' Maya-Spanish", 'Spanish / Latin', 'Latin', 'Greek-Latin',
    ];
    for (const v of values) {
      const native = isNativeEditionLanguage(v, 'es');
      const bilingual = isBilingualEditionLanguage(v, 'es');
      expect(native && bilingual, `${v} is claimed by both`).toBe(false);
    }
    // …and the native set is not empty, or the assertion above passes vacuously.
    expect(NATIVE_EDITION_LANGUAGE.es.test('Spanish')).toBe(true);
  });
});

describe('splitting a page into columns', () => {
  it('splits on the marker and drops the envelope, content and all', () => {
    const cols = pageColumns(ENVELOPE(`${KICHE}\n\n<column-break/>\n\n${SPANISH}`));
    expect(cols).toHaveLength(2);
    expect(cols[0]).toContain('hucahau');
    expect(cols[1]).toContain('tecolotes');
    // The <warning> block is Spanish prose about the page. Left in, it lands in
    // the FIRST column and lifts the K'iche' side over the bar.
    expect(cols[0]).not.toContain('transcriber');
    expect(cols[0]).not.toContain('bilingual text');
    // <vocab> sits at the tail, inside the LAST column.
    expect(cols[1]).not.toContain('Hunhunahpu, hicara');
  });

  it('treats a page with no marker as one column', () => {
    expect(pageColumns(ENVELOPE(SPANISH))).toHaveLength(1);
  });

  it('returns nothing for a page with no text', () => {
    expect(pageColumns('')).toEqual([]);
    expect(pageColumns('<language>Latin</language><page-type>blank</page-type>')).toEqual([]);
  });
});

describe('choosing the Spanish column', () => {
  it('finds it on the right', () => {
    const res = spanishColumnText(ENVELOPE(`${KICHE}\n\n<column-break/>\n\n${SPANISH}`));
    expect(res).not.toBeNull();
    expect(res!.columns).toBe(2);
    expect(res!.accepted).toBe(1);
    expect(res!.text).toContain('tecolotes');
    expect(res!.text).not.toContain('hucahau');
  });

  it('finds it on the LEFT — the order of the <language> tag is not evidence', () => {
    // Same envelope, tag still reading "K'iche', Spanish", columns swapped. A
    // reader that trusted the tag order would return the K'iche'.
    const res = spanishColumnText(ENVELOPE(`${SPANISH}\n\n<column-break/>\n\n${KICHE}`));
    expect(res).not.toBeNull();
    expect(res!.text).toContain('tecolotes');
    expect(res!.text).not.toContain('hucahau');
  });

  it('finds it beside Nahuatl, which is Latin-script and looks Spanish-ish', () => {
    const res = spanishColumnText(`${NAHUATL}\n\n<column-break/>\n\n${SPANISH}`);
    expect(res).not.toBeNull();
    expect(res!.text).toContain('tecolotes');
    expect(res!.text).not.toContain('cemanaoac');
  });

  it('takes a wholly Spanish single-column leaf entire', () => {
    const res = spanishColumnText(ENVELOPE(SPANISH));
    expect(res).not.toBeNull();
    expect(res!.columns).toBe(1);
    expect(res!.text).toContain('tecolotes');
  });

  it('declines a page with no Spanish on it', () => {
    expect(spanishColumnText(`${KICHE}\n\n<column-break/>\n\n${NAHUATL}`)).toBeNull();
    expect(spanishColumnText(ENVELOPE(NAHUATL))).toBeNull();
  });

  it('declines a column too short to measure', () => {
    // A catchword or a folio number can score 100% on four words. The floor is
    // what stops marginalia becoming "a Spanish column".
    expect(spanishColumnText('de la que en el')).toBeNull();
  });

  it('declines FRENCH, which a broad function-word test alone would admit', () => {
    // Brasseur's commentary in the Landa edition. `de que en le un si ni es` are
    // French too, so the broad share reaches into the Spanish band; the
    // Spanish-exclusive share is what refuses it.
    const french = `ditions, c'est aux divers fragments cosmogoniques, conservé dans les livres et les histoires
      du temps de la conquête, que nous devons recourir. Les plus formels sont ceux que nous appelons
      l'Histoire des soleils, cités par Humboldt, d'après Gomara, et que l'on trouve, avec des variantes,
      dans divers documents, en particulier dans le Codex Chimalpopoca. Ainsi que nous l'avons fait
      remarquer déjà, ces soleils sont signalés comme des époques auxquelles sont rapportées les diverses
      catastrophes que le monde a subies ce que nous avons remarqué également`;
    const broad = spanishFunctionWordShare(french);
    expect(broad.share).toBeGreaterThan(0.10);   // the broad test is fooled…
    expect(broad.exclusive).toBeLessThan(0.05);  // …the exclusive one is not
    expect(spanishColumnText(french)).toBeNull();
  });
});

describe('the provenance marker', () => {
  it('is the same string on the writer side and the read side', () => {
    // The writer is a node script and cannot import the TS module, so the value
    // is declared twice. Two copies of a magic string drift the first time one
    // of them is corrected — and the failure is silent: the reader would simply
    // stop labelling Ximénez's Spanish as his.
    expect(SOURCE_COLUMN_PROVENANCE).toBe(PROVENANCE_TS);
    expect(SOURCE_COLUMN_PROVENANCE).toBe('source-column');
  });
});
