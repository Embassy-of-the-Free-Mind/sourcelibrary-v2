import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeLanguageToken, parseLanguageField, languageFamily, sameLanguageFamily,
  LANGUAGES, languageCode, toLanguageCodes, languageName, codeFamily, sameLanguage,
  toBcp47, fromLocale, displayLabel, isLanguageCode,
} from '@/lib/language-normalize';
import * as twin from '../../scripts/lib/language-normalize.mjs';
// The inventory copies (design doc, first table) that export what they hold.
import { displayLanguage, sameLanguage as utilsSameLanguage, expandLanguages } from '@/lib/language-utils';
import { distinctLanguageSet, countDistinctLanguages as countTs, isSingleRealLanguage } from '@/lib/language-canonical';
import { languageToBcp47 } from '@/lib/language-code';
import { NATIVE_EDITION_LANGUAGE as nativeTs } from '@/lib/localized';
import { ORIGINAL_LANGUAGE_CORPUS as ngramCorpusTs } from '@/lib/ngram-normalize';
import { TARGET_LANGUAGE_NAMES } from '@/lib/page-translations';
import { RTL_LANGUAGES } from '@/lib/types/language';
import { canonicalLanguage as ftCanonicalTs } from '@/lib/first-translation/source-language-match';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS modules, no declarations
import { countDistinctLanguages as countMjs, distinctLanguageSet as distinctSetMjs } from '../../scripts/lib/language-count.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { NATIVE_EDITION_LANGUAGE as nativeMjs } from '../../scripts/lib/native-edition-language.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { ORIGINAL_LANGUAGE_CORPUS as ngramCorpusMjs } from '../../scripts/lib/ngram-normalize.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { LATIN_SCRIPT_LANGUAGES as liteMjs, isTibetanBook } from '../../scripts/lib/translate-core.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { getOcrModelForBook, OCR_MODEL_LITE } from '../../scripts/lib/ocr-routing.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { KNOWN_SOURCE_LANGUAGES } from '../../scripts/lib/translation-catalog-record.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { canonicalLanguage as ftCanonicalMjs } from '../../scripts/lib/source-language-match.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { RELIABLE_CATALOGUE_LANGS } from '../../scripts/lib/language-content-classify.mjs';

/**
 * The language detector (#4117) runs the .mjs twin under plain node; API routes
 * and future read paths run the TS side. If they disagree, the same book gets a
 * different language depending on which door it came through — which is how the
 * corpus ended up with four vocabularies in the first place.
 * (Twin convention: cf. identity-fields-parity.test.ts, r2-key.test.ts.)
 *
 * Fixtures are drawn from values actually observed in production on 2026-08-21:
 * `books.language`, `ai_metadata.secondary_languages`, and the free-text
 * `<language>` tag inside `pages.ocr.data`.
 */

const TOKENS = [
  // straightforward
  'Latin', 'Greek', 'German', 'english', 'FRENCH',
  // codes: ISO-1, ISO-2/3, MARC (the #3893 population)
  'la', 'de', 'grc', 'lat', 'ger', 'gre', 'rus', 'nld', 'ota', 'chu',
  // period variants that must COLLAPSE onto the base language
  'Ancient Greek', 'Modern Greek', 'Classical Latin', 'Koine Greek', 'New Latin',
  // period variants that are DISTINCT languages and must survive
  'Old English', 'Middle High German', 'Early New High German', 'Old French',
  'Church Slavonic', 'Classical Chinese', 'Ottoman Turkish', 'Judeo-Arabic',
  // placeholders — every one of these must be null
  'None', 'none', 'N/A', 'NA', 'und', 'zxx', 'mul', 'unknown', 'auto-detect',
  'Visual', 'undetermined', '', '-', 'Multiple', 'various',
  // the parenthetical / script noise the OCR tag emits
  'Sanskrit (transliterated)', 'undetermined (Voynich script)',
  'Russian (pre-reform)', 'Italian in Italian script', 'Hebrew in Hebrew script',
  // synonyms
  'Geez', "Ge'ez", 'Ethiopic', 'Anglo-Norman', 'Flemish', 'Castilian',
  // unmapped but real — must pass through title-cased, not vanish
  'Tamil', 'Nahuatl', 'Syriac', 'Aramaic', 'Ladino', 'Coptic',
  null, undefined,
];

const FIELDS = [
  // real compound values from books.language (96 of 229 distinct live values)
  'Greek-Latin', 'Hebrew and Aramaic', 'Sanskrit-English', 'German-Latin',
  'Cakchiquel / English', 'English, Greek, Hebrew, Latin', 'French, Latin',
  'Church Slavonic, Greek', 'Arabic and Samaritan Hebrew',
  'Hebrew, Judeo-Arabic and Ladino in Hebrew script',
  'Italian in Italian script, Hebrew in Hebrew script',
  'Arabic, Ottoman Turkish, Persian, Latin, Ternate (a Papuan language), French and Dutch.',
  'Hebrew, Aramaic, and Judeo-Arabic',
  // hyphenated SINGLE languages — must NOT split
  'Judeo-Arabic', 'Anglo-Norman', 'Scottish Gaelic', 'Judeo-Persian',
  // the N/A trap: contains "/" but is a placeholder, not two languages
  'N/A', 'n/a',
  // comma-joined forms the OCR tag emits
  'Latin, Greek', 'Greek, Latin',
  // plain singles and nulls
  'Latin', 'lat', 'None', '', null, undefined,
];

describe('language-normalize TS/mjs parity', () => {
  it('normalizeLanguageToken agrees on every fixture', () => {
    for (const t of TOKENS) {
      expect(twin.normalizeLanguageToken(t), `token: ${JSON.stringify(t)}`)
        .toEqual(normalizeLanguageToken(t));
    }
  });

  it('parseLanguageField agrees on every fixture', () => {
    for (const f of FIELDS) {
      expect(twin.parseLanguageField(f), `field: ${JSON.stringify(f)}`)
        .toEqual(parseLanguageField(f));
    }
  });

  it('languageFamily agrees on every fixture', () => {
    for (const t of TOKENS) {
      const canon = normalizeLanguageToken(t);
      expect(twin.languageFamily(canon), `family: ${JSON.stringify(canon)}`)
        .toEqual(languageFamily(canon));
    }
  });
});

describe('language families', () => {
  /**
   * The artifact this guards: on the first full corpus run,
   * "Chinese + Classical Chinese" was 2,387 of 6,230 apparently-bilingual books
   * — 38% of the headline finding — and every one was the OCR model emitting
   * two labels for a single text. Same trap on the Korean hanmun corpus.
   */
  it('treats historical stages as one language for bilingual purposes', () => {
    expect(sameLanguageFamily('Chinese', 'Classical Chinese')).toBe(true);
    expect(sameLanguageFamily('English', 'Old English')).toBe(true);
    expect(sameLanguageFamily('German', 'Middle High German')).toBe(true);
    expect(sameLanguageFamily('Hebrew', 'Biblical Hebrew')).toBe(true);
    // #4781: 7 Books of Hours catalogued Dutch and tagged Middle Dutch read as contradictions.
    expect(sameLanguageFamily('Dutch', 'Middle Dutch')).toBe(true);
  });

  it('still keeps the names distinct for cataloguing', () => {
    expect(normalizeLanguageToken('Classical Chinese')).toBe('Classical Chinese');
    expect(normalizeLanguageToken('Old English')).toBe('Old English');
    expect(languageFamily('Classical Chinese')).toBe('Chinese');
    expect(languageFamily('Latin')).toBe('Latin');
  });

  it('folds every Chinese script/register variant into one family', () => {
    // A Japanese go manual came back tagged Chinese 44% / Japanese 36% /
    // Classical Chinese 12% / Traditional Chinese 8%: four labels, one text.
    for (const v of ['Classical Chinese', 'Literary Chinese', 'Traditional Chinese', 'Simplified Chinese', 'Mandarin']) {
      expect(sameLanguageFamily('Chinese', v), v).toBe(true);
    }
    // …but Japanese is a different language, even when written in kanji.
    expect(sameLanguageFamily('Chinese', 'Japanese')).toBe(false);
  });

  it('does not merge genuinely different languages', () => {
    expect(sameLanguageFamily('Latin', 'Greek')).toBe(false);
    expect(sameLanguageFamily('Chinese', 'Korean')).toBe(false);
    expect(sameLanguageFamily('German', 'Dutch')).toBe(false);
    expect(sameLanguageFamily('Hebrew', 'Aramaic')).toBe(false);
  });
});

describe('language-normalize behaviour', () => {
  it('collapses period variants onto the base language', () => {
    expect(normalizeLanguageToken('Ancient Greek')).toBe('Greek');
    expect(normalizeLanguageToken('Koine Greek')).toBe('Greek');
    expect(normalizeLanguageToken('Classical Latin')).toBe('Latin');
  });

  it('keeps genuinely distinct period languages apart', () => {
    expect(normalizeLanguageToken('Old English')).toBe('Old English');
    expect(normalizeLanguageToken('Middle High German')).toBe('Middle High German');
    expect(normalizeLanguageToken('Old French')).toBe('Old French');
  });

  it('folds codes, including the MARC set behind #3893', () => {
    for (const [code, name] of [['lat', 'Latin'], ['ger', 'German'], ['gre', 'Greek'], ['grc', 'Greek'], ['de', 'German']]) {
      expect(normalizeLanguageToken(code)).toBe(name);
    }
  });

  it('returns null for every placeholder, so callers can tell "no signal" from a value', () => {
    for (const p of ['None', 'n/a', 'und', 'zxx', 'mul', 'auto-detect', 'Visual', 'undetermined', '']) {
      expect(normalizeLanguageToken(p), `placeholder: ${p}`).toBeNull();
    }
  });

  it('does NOT split N/A into languages named "n" and "a"', () => {
    // The bug this guards: splitting on "/" before the placeholder check made
    // "N/A" look like two languages, which then showed up at 1-2% share across
    // the corpus and read as real signal.
    expect(parseLanguageField('N/A')).toEqual([]);
    expect(parseLanguageField('n/a')).toEqual([]);
  });

  it('splits real compounds but never a hyphenated single language', () => {
    expect(parseLanguageField('Greek-Latin')).toEqual(['Greek', 'Latin']);
    expect(parseLanguageField('Hebrew and Aramaic')).toEqual(['Hebrew', 'Aramaic']);
    expect(parseLanguageField('Cakchiquel / English')).toEqual(['Cakchiquel', 'English']);
    expect(parseLanguageField('Judeo-Arabic')).toEqual(['Judeo-Arabic']);
    expect(parseLanguageField('Anglo-Norman')).toEqual(['Anglo-Norman']);
  });

  it('de-duplicates, which is what kills the "Latin + Latin" rows', () => {
    // 257 books list Latin as a secondary language of Latin; 204 the same for Greek.
    expect(parseLanguageField('Latin, Latin')).toEqual(['Latin']);
    expect(parseLanguageField('Greek and Ancient Greek')).toEqual(['Greek']);
  });

  it('strips the parenthetical and script noise the OCR tag emits', () => {
    expect(normalizeLanguageToken('Sanskrit (transliterated)')).toBe('Sanskrit');
    expect(normalizeLanguageToken('Russian (pre-reform)')).toBe('Russian');
    expect(normalizeLanguageToken('undetermined (Voynich script)')).toBeNull();
    expect(normalizeLanguageToken('Italian in Italian script')).toBe('Italian');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CODE API AND THE VOCABULARY (#5330, step 1 of
// .claude/docs/language-fields-design.md).
//
// Fixture: tests/fixtures/language-labels-2026-09-30.json — every distinct
// `books.language` value (live and all), every live `languages[]` element and
// every live `original_language`, with book counts, pulled from production
// BEFORE these assertions were written.
// ─────────────────────────────────────────────────────────────────────────────

type Row = [string | null, number];
const FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/language-labels-2026-09-30.json'), 'utf8'),
) as { live_language: Row[]; all_language: Row[]; live_languages_array: Row[]; live_original_language: Row[] };
const LIVE_LABELS = FIXTURE.live_language.map(([v]) => v);
const ALL_VALUES = [
  ...FIXTURE.all_language, ...FIXTURE.live_languages_array, ...FIXTURE.live_original_language,
].map(([v]) => v);
const CODES = LANGUAGES.map((r) => r.code);

describe('code API: TS/mjs parity', () => {
  it('the table is identical on both sides', () => {
    expect(twin.LANGUAGES).toEqual(LANGUAGES);
  });

  it('toLanguageCodes and languageCode agree on every production value', () => {
    for (const v of ALL_VALUES) {
      expect(twin.toLanguageCodes(v), `label: ${JSON.stringify(v)}`).toEqual(toLanguageCodes(v));
      expect(twin.languageCode(v), `token: ${JSON.stringify(v)}`).toEqual(languageCode(v));
    }
  });

  it('names, families, BCP-47 and labels agree on every code', () => {
    for (const c of CODES) {
      for (const loc of ['en', 'es']) expect(twin.languageName(c, loc), `${c}/${loc}`).toBe(languageName(c, loc));
      expect(twin.codeFamily(c)).toBe(codeFamily(c));
      expect(twin.toBcp47(c)).toBe(toBcp47(c));
      expect(twin.fromLocale(toBcp47(c))).toBe(fromLocale(toBcp47(c)));
      expect(twin.isLanguageCode(c)).toBe(true);
      expect(twin.sameLanguage(c, 'grc')).toBe(sameLanguage(c, 'grc'));
    }
    for (const codes of [['grc', 'lat'], ['heb', 'arc', 'jrb'], ['lat'], []]) {
      for (const loc of ['en', 'es']) expect(twin.displayLabel(codes, loc)).toBe(displayLabel(codes, loc));
    }
  });
});

describe('the vocabulary table', () => {
  it('holds unique lower-case three-letter codes whose families are rows', () => {
    expect(new Set(CODES).size).toBe(CODES.length);
    for (const r of LANGUAGES) {
      expect(r.code, r.code).toMatch(/^[a-z]{3}$/);
      expect(isLanguageCode(r.family), `${r.code} family ${r.family}`).toBe(true);
      expect(codeFamily(r.family), `${r.code}: a family heads itself`).toBe(r.family);
      expect(r.script, r.code).toMatch(/^[A-Z][a-z]{3}$/);
    }
  });

  it('never marks a multi-script language lite (the router cannot see the script)', () => {
    for (const r of LANGUAGES) expect(r.lite_ocr && r.ambiguous_script, r.code).toBe(false);
  });

  it('round-trips every code through its own name, BCP-47 tag, MARC codes and aliases', () => {
    for (const r of LANGUAGES) {
      expect(languageCode(r.name), r.name).toBe(r.code);
      expect(languageCode(r.code), r.code).toBe(r.code);
      for (const m of r.marc) expect(languageCode(m), m).toBe(r.code);
      for (const a of r.aliases) expect(languageCode(a), a).toBe(r.code);
      expect(fromLocale(r.bcp47), r.bcp47).toBe(r.code);
    }
  });

  it('covers every language the live labels name, and nothing else is guessed', () => {
    // The atoms the legacy name API parses out of the 230 live labels (139 on
    // 2026-09-30). Every one resolves to a code EXCEPT the fragments below:
    // the ones invented by the title-case fallthrough, plus two real names the
    // vocabulary deliberately does not guess.
    const NOT_A_LANGUAGE = [
      'E', 'Ne', 'Am', 'An', 'Den', 'Lb', 'Roa', 'Ga', // truncated labels; titles read 2026-09-30: Sanskrit, Chinese, Latin, Greek, Hebrew books
      'And Judeo', 'And Aramaic', 'And Ladino', 'And Arabic', 'And English', // leading "and " fragment
      'Anglo', 'Saxon', // Anglo-Saxon split on its hyphen
      'Multiple (hebrew', 'Ethiopic)', 'Some Hebrew', 'Text On Maps In Latin', // prose split on commas
      'Latin. French. English', 'French. English. Latin', 'Latin. German', // ". " not split
    ];
    const DELIBERATELY_UNRESOLVED = [
      'Mixtec', // ISO 639-3 codes Mixtec per variety (~50); no group code — a curator picks
      'Gaelic', // Irish or Scottish Gaelic; "English/Gaelic" does not say which
    ];
    const atoms = new Set(LIVE_LABELS.flatMap((l) => parseLanguageField(l)));
    const missing = [...atoms].filter((a) => !languageCode(a)).sort();
    expect(missing).toEqual([...NOT_A_LANGUAGE, ...DELIBERATELY_UNRESOLVED].sort());
  });
});

describe('toLanguageCodes: a closed vocabulary', () => {
  it('reports what it does not know instead of inventing a language', () => {
    expect(toLanguageCodes('e')).toEqual({ codes: [], unresolved: ['e'] });
    expect(toLanguageCodes('Ne')).toEqual({ codes: [], unresolved: ['Ne'] });
    // "ga" is the ISO 639-1 code for Irish, but the one live book labelled "Ga" is a Hebrew grammar.
    expect(toLanguageCodes('Ga')).toEqual({ codes: [], unresolved: ['Ga'] });
    expect(toLanguageCodes('Latin, some Hebrew and Greek')).toEqual({ codes: ['lat', 'grc'], unresolved: ['some Hebrew'] });
    expect(toLanguageCodes('Text on maps in latin and german')).toEqual({ codes: ['deu'], unresolved: ['Text on maps in latin'] });
  });

  it('splits the two cases the measurement found', () => {
    expect(toLanguageCodes('Latin. French. English').codes).toEqual(['lat', 'fra', 'eng']);
    expect(toLanguageCodes('Hebrew, Aramaic, and Judeo-Arabic').codes).toEqual(['heb', 'arc', 'jrb']);
    expect(toLanguageCodes('Hebrew, Ladino, and English').codes).toEqual(['heb', 'lad', 'eng']);
  });

  it('keeps the name API split rules', () => {
    expect(toLanguageCodes('Greek-Latin').codes).toEqual(['grc', 'lat']);
    expect(toLanguageCodes('Judeo-Arabic').codes).toEqual(['jrb']);
    expect(toLanguageCodes('Anglo-Saxon').codes).toEqual(['ang']);
    expect(toLanguageCodes('Hebrew and Aramaic in Hebrew script').codes).toEqual(['heb', 'arc']);
    expect(toLanguageCodes("K'iche' Maya-Spanish").codes).toEqual(['quc', 'spa']);
    expect(toLanguageCodes('Kʼicheʼ').codes).toEqual(['quc']);
    expect(toLanguageCodes('N/A')).toEqual({ codes: [], unresolved: [] });
    expect(toLanguageCodes('Latin, Latin').codes).toEqual(['lat']);
  });

  it('reads the list inside a placeholder wrapper', () => {
    expect(toLanguageCodes('Multiple (Hebrew, Greek, Latin, Syriac, Arabic, Ethiopic)').codes)
      .toEqual(['heb', 'grc', 'lat', 'syc', 'ara', 'gez']);
    expect(toLanguageCodes('Multiple')).toEqual({ codes: [], unresolved: [] });
  });

  it('stores historical forms and compares by family', () => {
    expect(languageCode('Greek')).toBe('grc');
    expect(languageCode('el')).toBe('ell');
    expect(languageCode('Classical Chinese')).toBe('lzh');
    expect(sameLanguage('Modern Greek', 'Greek')).toBe(true);
    expect(sameLanguage('lzh', 'Chinese')).toBe(true);
    expect(sameLanguage('Old English', 'eng')).toBe(true);
    expect(sameLanguage('Latin', 'Greek')).toBe(false);
    expect(sameLanguage('Klingon', 'Klingon')).toBe(false);
  });

  it('derives a display label from codes', () => {
    expect(displayLabel(['grc', 'lat'])).toBe('Greek and Latin');
    expect(displayLabel(['lat'])).toBe('Latin');
    expect(displayLabel([])).toBeNull();
    expect(toBcp47('lat')).toBe('la');
    expect(fromLocale('es-ES')).toBe('spa');
  });

  it('never lets a live label produce a code outside the table', () => {
    const unresolved = new Map<string, number>();
    for (const [label, n] of FIXTURE.live_language) {
      const r = toLanguageCodes(label);
      for (const c of r.codes) expect(isLanguageCode(c), `${label} → ${c}`).toBe(true);
      for (const u of r.unresolved) unresolved.set(u, (unresolved.get(u) || 0) + n);
    }
    // 26 live books carry an unresolved fragment; step 5 sends them to review, never to a guess.
    expect(Object.fromEntries([...unresolved].sort())).toEqual({
      Am: 1, An: 1, Den: 1, e: 8, Ga: 1, Gaelic: 1, Lb: 1, Mixtec: 3, Ne: 6, roa: 1,
      'some Hebrew': 1, 'Text on maps in latin': 1,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY COPY IN THE INVENTORY, HELD AGAINST THE TABLE (the translate-core-parity
// lesson: enumerate every copy, import every copy).
//
// Each copy is checked on ITS OWN vocabulary. Disagreements are listed below as
// KNOWN DRIFT, each tagged with the migration step that moves that copy onto
// the table. The assertion is EXACT: a new disagreement fails, and so does a
// fixed one, so the list shrinks as the steps land instead of rotting.
//
// Copies that export what they hold are imported. File-local consts (mostly
// in scripts that run on import) are read from source and evaluated as
// literals — the same technique as archive-status-forward-only.test.ts.
// Not here, deliberately: `holdings-resolver.mjs` and `training-pairs.mjs`
// (inline splitters, no vocabulary); `fix-imported-languages.ts` (its map is
// empty, filled at runtime); the eval/analysis maps (measurement scripts,
// migrated when next touched); static page copy.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '../..');

/** Evaluate the literal assigned to `const NAME` in a source file, without running the file. */
function sourceLiteral(file: string, name: string): unknown {
  const src = readFileSync(resolve(ROOT, file), 'utf8');
  const decl = src.search(new RegExp(`\\bconst\\s+${name}\\b[^=]*=`));
  if (decl < 0) throw new Error(`${file}: const ${name} not found — did the copy move? update the inventory`);
  let i = src.indexOf('=', decl) + 1;
  while (/\s/.test(src[i])) i++;
  let wrap = (literal: string) => literal;
  if (src.startsWith('new Set', i) || src.startsWith('new Map', i)) {
    const kind = src.slice(i + 4, i + 7);
    i = src.indexOf('(', i) + 1;
    while (src[i] !== '[') i++;
    wrap = (literal) => `new ${kind}(${literal})`;
  }
  let j = i;
  if (src[i] === '/') {
    for (j = i + 1; src[j] !== '/' || src[j - 1] === '\\'; j++);
    while (/[a-z]/.test(src[j + 1])) j++;
  } else {
    let depth = 0;
    let quote: string | null = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
      if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); continue; }
      if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; continue; }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '/' && /[:,[(]\s*$/.test(src.slice(i, j))) { // a regex literal as a value
        for (j++; src[j] !== '/' || src[j - 1] === '\\'; j++);
        continue;
      }
      if (c === '[' || c === '{') depth++;
      if (c === ']' || c === '}') { depth--; if (depth === 0) break; }
    }
  }
  return new Function(`return (${wrap(src.slice(i, j + 1))});`)();
}

const lit = <T = Record<string, string>>(file: string, name: string) => sourceLiteral(file, name) as T;
const tokens = (x: unknown): string[] => [...(x as Iterable<string>)];

/** A map whose keys and values both name a language: disagree when the table puts them in different families. */
function mapDrift(map: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    const a = languageCode(k);
    const b = languageCode(v as string);
    if (!(a === b || (a && b && codeFamily(a) === codeFamily(b)))) out.push(`${k} → ${v} (table: ${a ?? 'unknown'} / ${b ?? 'unknown'})`);
  }
  return out;
}
/** A map from language to BCP-47 tag: disagree when `toBcp47` would emit another tag. */
function bcp47Drift(map: Record<string, string>): string[] {
  return Object.entries(map)
    .filter(([k, v]) => toBcp47(languageCode(k)) !== v)
    .map(([k, v]) => `${k} → ${v} (table: ${toBcp47(languageCode(k)) ?? 'unknown'})`);
}
/** Tokens that should each name a language in the vocabulary. */
function unknownTokens(list: Iterable<string>): string[] {
  return [...list].filter((t) => {
    const r = toLanguageCodes(t);
    return r.codes.length === 0 || r.unresolved.length > 0;
  });
}
/** Tokens that should each resolve to a row satisfying `pred`. */
function tokensFailing(list: Iterable<string>, pred: (code: string) => boolean): string[] {
  return [...list].filter((t) => { const c = languageCode(t); return !c || !pred(c); });
}
const rowOf = (c: string) => LANGUAGES.find((r) => r.code === c);
const RTL_SCRIPTS = new Set(['Hebr', 'Arab', 'Syrc', 'Samr', 'Mand', 'Thaa', 'Nkoo', 'Phlv', 'Prti']);
const SCRIPT_WORDS: Record<string, string[]> = {
  Latn: ['latin'], Grek: ['greek'], Cyrl: ['cyrillic'], Cyrs: ['cyrillic'], Hebr: ['hebrew'], Arab: ['arabic'],
  Syrc: ['syriac'], Armn: ['armenian'], Geor: ['georgian'], Ethi: ['ethiopic'], Deva: ['devanagari'],
  Beng: ['bengali'], Taml: ['tamil'], Tibt: ['tibetan'], Thai: ['thai'], Khmr: ['khmer'], Mymr: ['myanmar'],
  Sinh: ['sinhala'], Bali: ['balinese'], Java: ['javanese'], Hani: ['han'], Kore: ['hangul', 'han'],
  Jpan: ['kana', 'han'], Mong: ['mongolian'], Copt: ['coptic'], Xsux: ['cuneiform'], Egyp: ['egyptian'],
  Avst: ['avestan'],
};
const isLite = (c: string) => !!rowOf(c)?.lite_ocr;
const isNonLatin = (c: string) => rowOf(c)?.script !== 'Latn' || !!rowOf(c)?.ambiguous_script;
const tableIdentifiers = (r: (typeof LANGUAGES)[number]) =>
  [r.name.toLowerCase(), r.code, ...(r.iso1 ? [r.iso1] : []), ...r.marc];
const allowlistDrift = (allow: Set<string>) => [
  ...tokensFailing(allow, isLite).map((t) => `allowlisted, not lite in table: ${t}`),
  ...LANGUAGES.filter((r) => r.lite_ocr).flatMap(tableIdentifiers).filter((t) => !allow.has(t)).map((t) => `lite in table, not allowlisted: ${t}`),
];
const pairDrift = (same: (a: string, b: string) => boolean) => {
  const names = LANGUAGES.map((r) => r.name);
  const out: string[] = [];
  for (const a of names) for (const b of names) if (a < b && same(a, b) !== sameLanguage(a, b)) out.push(`${a} ~ ${b}`);
  return out;
};

interface Copy { id: string; step: string; drift: () => string[] }

const COPIES: Copy[] = [
  // ── the legacy name API of this very file ──
  { id: 'language-normalize CODE2/CODE3/SYNONYM', step: 'step 2 (#5332)', drift: () => [
    ...mapDrift(lit('src/lib/language-normalize.ts', 'CODE2')),
    ...mapDrift(lit('src/lib/language-normalize.ts', 'CODE3')),
    ...mapDrift(lit('src/lib/language-normalize.ts', 'SYNONYM')),
  ] },
  { id: 'language-normalize sameLanguageFamily (names)', step: 'step 2 (#5332)', drift: () =>
    pairDrift((a, b) => sameLanguageFamily(normalizeLanguageToken(a), normalizeLanguageToken(b))) },
  // ── read-path vocabularies ──
  { id: 'language-utils CODE_TO_NAME/CODE3_TO_NAME', step: 'step 2 (#5332)', drift: () => [
    ...mapDrift(lit('src/lib/language-utils.ts', 'CODE_TO_NAME')),
    ...mapDrift(lit('src/lib/language-utils.ts', 'CODE3_TO_NAME')),
  ] },
  { id: 'language-utils displayLanguage', step: 'step 2 (#5332)', drift: () =>
    LANGUAGES.filter((r) => !sameLanguage(displayLanguage(r.name), r.code)).map((r) => `${r.name} → ${displayLanguage(r.name)}`) },
  { id: 'language-utils sameLanguage', step: 'step 2 (#5332)', drift: () => pairDrift(utilsSameLanguage) },
  { id: 'language-utils expandLanguages', step: 'step 6 (#5336)', drift: () =>
    LANGUAGES.flatMap((r) => expandLanguages([r.name])
      .filter((v) => languageCode(v) && !sameLanguage(v, r.code))
      .map((v) => `${r.name} ⊃ ${v}`)) },
  { id: 'language-utils PLACEHOLDER_LANGS', step: 'step 2 (#5332)', drift: () =>
    tokens(lit('src/lib/language-utils.ts', 'PLACEHOLDER_LANGS')).filter((t) => languageCode(t)) },
  { id: 'language-canonical.ts distinctLanguageSet/countDistinctLanguages', step: 'step 2 (#5332)', drift: () =>
    LIVE_LABELS.filter((l) => {
      const old = new Set([...distinctLanguageSet([l])].map((a) => codeFamily(languageCode(a)) ?? `?${a}`));
      const now = new Set(toLanguageCodes(l).codes.map(codeFamily));
      return old.size !== now.size || [...old].some((f) => !now.has(f));
    }).map((l) => `${l} → [${[...distinctLanguageSet([l])].join(', ')}]`) },
  { id: 'language-count.mjs = language-canonical.ts', step: 'step 2 (#5332)', drift: () => [
    ...LIVE_LABELS.filter((l) => JSON.stringify([...distinctSetMjs([l])]) !== JSON.stringify([...distinctLanguageSet([l])])).map(String),
    ...(countMjs(LIVE_LABELS) === countTs(LIVE_LABELS) ? [] : [`count ${countMjs(LIVE_LABELS)} ≠ ${countTs(LIVE_LABELS)}`]),
  ] },
  { id: 'language-canonical.ts isSingleRealLanguage', step: 'step 2 (#5332)', drift: () =>
    LIVE_LABELS.filter((l) => {
      const r = toLanguageCodes(l);
      return isSingleRealLanguage(l) !== (r.codes.length === 1 && r.unresolved.length === 0);
    }).map((l) => `${l}: ${isSingleRealLanguage(l)}`) },
  { id: 'language-canonical.ts JUNK', step: 'step 2 (#5332)', drift: () =>
    tokens(lit('src/lib/language-canonical.ts', 'JUNK')).filter((t) => languageCode(t)) },
  // A language the copy has no tag for is a gap (the attribute is omitted), not a disagreement.
  { id: 'language-code.ts languageToBcp47', step: 'step 2 (#5332)', drift: () =>
    LANGUAGES.filter((r) => languageToBcp47(r.name) && languageToBcp47(r.name) !== r.bcp47).map((r) => `${r.name} → ${languageToBcp47(r.name)} (table: ${r.bcp47})`) },
  { id: 'language-code.ts NOT_A_LANGUAGE', step: 'step 2 (#5332)', drift: () =>
    tokens(lit('src/lib/language-code.ts', 'NOT_A_LANGUAGE')).filter((t) => languageCode(t)) },
  { id: 'api/languages LANGUAGE_NORMALIZATION/CANONICAL_LANGUAGES', step: 'step 2 (#5332)', drift: () => [
    ...mapDrift(lit('src/app/api/languages/route.ts', 'LANGUAGE_NORMALIZATION')),
    ...unknownTokens(lit<string[]>('src/app/api/languages/route.ts', 'CANONICAL_LANGUAGES')),
  ] },
  // ── routing (step 3 is on the hold list: routing is money) ──
  { id: 'ai-models.ts LATIN_SCRIPT_LANGUAGES', step: 'step 3 (#5333)', drift: () =>
    allowlistDrift(new Set(tokens(lit('src/lib/types/ai-models.ts', 'LATIN_SCRIPT_LANGUAGES')))) },
  { id: 'translate-core.mjs LATIN_SCRIPT_LANGUAGES', step: 'step 3 (#5333)', drift: () => allowlistDrift(new Set(tokens(liteMjs))) },
  { id: 'ocr-routing.mjs getOcrModelForBook', step: 'step 3 (#5333)', drift: () =>
    LANGUAGES.filter((r) => (getOcrModelForBook({ language: r.name }, { liteOnly: false }) === OCR_MODEL_LITE) !== r.lite_ocr)
      .map((r) => r.name) },
  { id: 'translate-core.mjs isTibetanBook', step: 'step 3 (#5333)', drift: () =>
    LANGUAGES.flatMap((r) => [r.name, ...r.aliases])
      .filter((n) => !!isTibetanBook({ language: n }) !== (languageCode(n) === 'bod')) },
  { id: 'pipeline-orchestrator.mjs NON_LATIN_LANGUAGES', step: 'step 3 (#5333)', drift: () =>
    tokensFailing(tokens(lit('scripts/workers/pipeline-orchestrator.mjs', 'NON_LATIN_LANGUAGES')), isNonLatin) },
  { id: 'batch-transliterate.mjs NON_LATIN_LANGUAGES', step: 'step 2 (#5332)', drift: () =>
    tokensFailing(lit<string[]>('scripts/batch/batch-transliterate.mjs', 'NON_LATIN_LANGUAGES'), isNonLatin) },
  { id: 'non-latin-scripts.ts NON_LATIN_SCRIPT_NAMES', step: 'step 2 (#5332)', drift: () =>
    tokensFailing(lit<string[]>('src/lib/non-latin-scripts.ts', 'NON_LATIN_SCRIPT_NAMES'), isNonLatin) },
  // ── /es native editions ──
  ...([
    ['localized.ts NATIVE_EDITION_LANGUAGE', nativeTs],
    ['native-edition-language.mjs NATIVE_EDITION_LANGUAGE', nativeMjs],
    ['localize-metadata.mjs NATIVE_EDITION_LANGUAGE', lit('scripts/maintenance/localize-metadata.mjs', 'NATIVE_EDITION_LANGUAGE')],
  ] as [string, Record<string, RegExp>][]).map(([id, map]): Copy => ({ id, step: 'step 2 (#5332)', drift: () =>
    Object.entries(map).flatMap(([locale, re]) => LANGUAGES.flatMap((r) => [r.name, ...r.aliases]
      .filter((n) => re.test(n) !== (languageCode(n) === fromLocale(locale)))
      .map((n) => `${locale}: ${n}`))) })),
  // ── English-original screens ──
  ...([
    ['candidate.ts ENGLISH_LANGUAGES', 'src/lib/first-translation/candidate.ts', 'ENGLISH_LANGUAGES'],
    ['ft-source-language-screen.mjs ENGLISH_LANGS', 'scripts/audit/ft-source-language-screen.mjs', 'ENGLISH_LANGS'],
    ['ft-translator-as-author-screen.mjs ENGLISH_LANGS', 'scripts/audit/ft-translator-as-author-screen.mjs', 'ENGLISH_LANGS'],
  ]).map(([id, file, name]): Copy => ({ id, step: 'step 2 (#5332)', drift: () =>
    tokensFailing(tokens(lit(file, name)), (c) => c === 'eng') })),
  // ── first translation ──
  ...([
    ['source-language-match.ts LANGUAGE_ALIASES', 'src/lib/first-translation/source-language-match.ts'],
    ['source-language-match.mjs LANGUAGE_ALIASES', 'scripts/lib/source-language-match.mjs'],
  ]).map(([id, file]): Copy => ({ id, step: 'step 2 (#5332)', drift: () =>
    Object.entries(lit<Record<string, string[]>>(file, 'LANGUAGE_ALIASES'))
      .flatMap(([k, vs]) => mapDrift(Object.fromEntries(vs.map((v) => [v, k])))) })),
  { id: 'source-language-match canonicalLanguage (ts = mjs)', step: 'step 2 (#5332)', drift: () =>
    LANGUAGES.flatMap((r) => [r.name, r.code, ...r.aliases]).filter((n) => ftCanonicalTs(n) !== ftCanonicalMjs(n)) },
  { id: 'translation-catalog-record.mjs KNOWN_SOURCE_LANGUAGES/SOURCE_LANGUAGE_ALIASES', step: 'step 2 (#5332)', drift: () => [
    ...unknownTokens(tokens(KNOWN_SOURCE_LANGUAGES)),
    ...mapDrift(lit('scripts/lib/translation-catalog-record.mjs', 'SOURCE_LANGUAGE_ALIASES')),
  ] },
  // ── citation, IIIF, DTS: the BCP-47 direction ──
  { id: 'edition-citation-language.mjs PLACEHOLDER_LANGS', step: 'step 6 (#5336)', drift: () =>
    tokens(lit('scripts/lib/edition-citation-language.mjs', 'PLACEHOLDER_LANGS')).filter((t) => languageCode(t)) },
  { id: 'scholarly-typst.mjs LANG_CODES', step: 'step 2 (#5332)', drift: () => bcp47Drift(lit('scripts/lib/scholarly-typst.mjs', 'LANG_CODES')) },
  { id: 'api/dts/collection LANG_CODES', step: 'step 2 (#5332)', drift: () => bcp47Drift(lit('src/app/api/dts/collection/route.ts', 'LANG_CODES')) },
  { id: 'api/iiif manifest LANG_CODES', step: 'step 2 (#5332)', drift: () => bcp47Drift(lit('src/app/api/iiif/[id]/manifest/route.ts', 'LANG_CODES')) },
  { id: 'api/iiif canvas LANG_CODES', step: 'step 2 (#5332)', drift: () => bcp47Drift(lit('src/app/api/iiif/[id]/canvas/[pageNumber]/[type]/route.ts', 'LANG_CODES')) },
  // ── localised names and per-language policy keyed by name ──
  { id: 'book-i18n.ts LANGUAGE_NAMES_ES (keys)', step: 'step 2 (#5332)', drift: () => unknownTokens(Object.keys(lit('src/lib/book-i18n.ts', 'LANGUAGE_NAMES_ES'))) },
  { id: 'page-translations.ts TARGET_LANGUAGE_NAMES (locales)', step: 'step 2 (#5332)', drift: () => Object.keys(TARGET_LANGUAGE_NAMES).filter((l) => !fromLocale(l)) },
  { id: 'embassy/librarian.ts LANG_NAMES (locales)', step: 'step 2 (#5332)', drift: () => Object.keys(lit('src/lib/embassy/librarian.ts', 'LANG_NAMES')).filter((l) => !fromLocale(l)) },
  { id: 'prompts.ts LANGUAGE_*_PROMPT_NAMES (keys)', step: 'step 2 (#5332)', drift: () => unknownTokens([
    ...Object.keys(lit('src/lib/prompts.ts', 'LANGUAGE_OCR_PROMPT_NAMES')),
    ...Object.keys(lit('src/lib/prompts.ts', 'LANGUAGE_TRANSLATION_PROMPT_NAMES')),
  ]) },
  { id: 'processing-priority.ts LANGUAGE_SCORES (keys)', step: 'step 2 (#5332)', drift: () => unknownTokens(Object.keys(lit('src/lib/processing-priority.ts', 'LANGUAGE_SCORES'))) },
  { id: 'semantic-alignment.ts LANGUAGE_THRESHOLDS (keys)', step: 'step 2 (#5332)', drift: () => unknownTokens(Object.keys(lit('src/lib/semantic-alignment.ts', 'LANGUAGE_THRESHOLDS'))) },
  { id: 'transcription-reliability.ts UNREADABLE_LANGUAGES', step: 'step 2 (#5332)', drift: () => unknownTokens(tokens(lit('src/lib/transcription-reliability.ts', 'UNREADABLE_LANGUAGES'))) },
  { id: 'types/language.ts RTL_LANGUAGES', step: 'step 2 (#5332)', drift: () => tokensFailing(RTL_LANGUAGES, (c) => RTL_SCRIPTS.has(rowOf(c)?.script ?? '')) },
  { id: 'ngram-normalize ORIGINAL_LANGUAGE_CORPUS (ts = mjs, keys)', step: 'step 2 (#5332)', drift: () => [
    ...(JSON.stringify(ngramCorpusTs) === JSON.stringify(ngramCorpusMjs) ? [] : ['ts and mjs copies differ']),
    ...unknownTokens(Object.keys(ngramCorpusTs)),
  ] },
  // ── script census (the language → script direction) ──
  { id: 'language-script-confusion.mjs LANG_SCRIPTS', step: 'step 7 (#5337)', drift: () =>
    Object.entries(lit<Record<string, string[]>>('scripts/audit/language-script-confusion.mjs', 'LANG_SCRIPTS')).flatMap(([k, scripts]) => {
      const r = rowOf(languageCode(k) ?? '');
      if (!r) return [`${k}: not in table`];
      const own = SCRIPT_WORDS[r.script] ?? [];
      const out: string[] = [];
      if (own.length && !own.some((w) => scripts.includes(w))) out.push(`${k}: table script ${r.script} not in [${scripts}]`);
      if (scripts.some((w) => !own.includes(w)) && !r.ambiguous_script) out.push(`${k}: [${scripts}] but not ambiguous_script`);
      return out;
    }) },
  { id: 'page-language.mjs SCRIPT_LANGUAGE', step: 'step 7 (#5337)', drift: () =>
    Object.entries(lit<Record<string, string>>('scripts/lib/page-language.mjs', 'SCRIPT_LANGUAGE'))
      .filter(([script, name]) => !(SCRIPT_WORDS[rowOf(languageCode(name) ?? '')?.script ?? ''] ?? []).includes(script.toLowerCase()))
      .map(([s, n]) => `${s} → ${n}`) },
  { id: 'language-content-classify.mjs RELIABLE_CATALOGUE_LANGS', step: 'step 7 (#5337)', drift: () => unknownTokens(tokens(RELIABLE_CATALOGUE_LANGS)) },
  { id: 'language-vs-ocr.mjs NOT_A_LANGUAGE', step: 'step 7 (#5337)', drift: () => {
    const re = lit<RegExp>('scripts/audit/language-vs-ocr.mjs', 'NOT_A_LANGUAGE');
    return LANGUAGES.flatMap((r) => [r.name, r.code, ...r.marc, ...r.aliases]).filter((t) => re.test(t));
  } },
  // ── importers and IIIF discovery (MARC → name) ──
  { id: 'iiif-metadata.mjs LANGUAGE_MAP', step: 'step 4 (#5334)', drift: () => mapDrift(lit('scripts/iiif-discovery/lib/iiif-metadata.mjs', 'LANGUAGE_MAP')) },
  { id: 'ia-language.mjs LANGUAGE_PRESETS', step: 'step 4 (#5334)', drift: () =>
    Object.entries(lit('scripts/iiif-discovery/sources/ia-language.mjs', 'LANGUAGE_PRESETS'))
      .flatMap(([k, q]) => mapDrift(Object.fromEntries(q.replace(/[()]/g, '').split(/\s+OR\s+/).map((t) => [t, k])))) },
  { id: 'harvest-istc.mjs LANG_MAP', step: 'step 4 (#5334)', drift: () => mapDrift(lit('scripts/import/harvest-istc.mjs', 'LANG_MAP')) },
  { id: 'batch-import-istc-bsb.mjs LANG_MAP', step: 'step 4 (#5334)', drift: () => mapDrift(lit('scripts/import/batch-import-istc-bsb.mjs', 'LANG_MAP')) },
  { id: 'erara-import-queue.mjs LANG_MAP', step: 'step 4 (#5334)', drift: () => mapDrift(lit('scripts/workers/erara-import-queue.mjs', 'LANG_MAP')) },
  { id: 'ingest-bdrc.mjs LANG_MAP', step: 'step 4 (#5334)', drift: () =>
    mapDrift(Object.fromEntries(Object.values(lit<Record<string, { tradition: string; iso: string }>>('scripts/works-catalog/ingest-bdrc.mjs', 'LANG_MAP')).map((v) => [v.iso, v.tradition]))) },
  { id: 'enrich-bph-from-csv.mjs LANG_MAP', step: 'step 4 (#5334)', drift: () => mapDrift(lit('scripts/migration/enrich-bph-from-csv.mjs', 'LANG_MAP')) },
  { id: 'batch-mint-doi.mjs LANG_MAP', step: 'step 4 (#5334)', drift: () => mapDrift(lit('scripts/batch/batch-mint-doi.mjs', 'LANG_MAP')) },
  { id: 'kloss-enrich.mjs LANG_MARKERS (keys)', step: 'step 4 (#5334)', drift: () => unknownTokens(Object.keys(lit('scripts/import/kloss-enrich.mjs', 'LANG_MARKERS'))) },
  // ── sweep-local vocabularies (retired by the step-5 backfill) ──
  { id: 'normalize-language-tags.mjs CODE', step: 'step 5 (#5335)', drift: () => mapDrift(lit('scripts/maintenance/normalize-language-tags.mjs', 'CODE')) },
  { id: 'enrichment/normalize-languages.mjs LANGUAGE_MAP', step: 'step 5 (#5335)', drift: () => mapDrift(lit('scripts/enrichment/normalize-languages.mjs', 'LANGUAGE_MAP')) },
  { id: 'backfill-language-from-ocr.mjs LANG_CANON', step: 'step 5 (#5335)', drift: () => mapDrift(lit('scripts/maintenance/backfill-language-from-ocr.mjs', 'LANG_CANON')) },
  { id: 'audit-language-provenance.mjs ISO', step: 'step 5 (#5335)', drift: () => mapDrift(lit('scripts/maintenance/audit-language-provenance.mjs', 'ISO')) },
  // ── language → region ──
  { id: 'backfill-facets-phase1.mjs LANGUAGE_TO_REGION (keys)', step: 'step 2 (#5332)', drift: () => unknownTokens(Object.keys(lit('scripts/enrichment/backfill-facets-phase1.mjs', 'LANGUAGE_TO_REGION'))) },
  { id: 'geocode-origin-by-tradition.mjs aliases', step: 'step 2 (#5332)', drift: () => {
    // Its keys are squeezed to [a-z] ("egyptianhieroglyphs"); squeeze the table's spellings the same way.
    const squeeze = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
    const bySqueezed = new Map(LANGUAGES.flatMap((r) => [r.name, ...r.aliases].map((t) => [squeeze(t), r.name] as const)));
    return mapDrift(Object.fromEntries(Object.entries(lit('scripts/enrichment/geocode-origin-by-tradition.mjs', 'aliases'))
      .map(([k, v]) => [bySqueezed.get(k) ?? k, v])));
  } },
  // ── display-only colour and font maps (low priority) ──
  ...([
    ['src/app/timeline/TimelineClient.tsx', 'LANG_COLORS'],
    ['src/components/explore/ConstellationCanvas.tsx', 'LANG_COLORS'],
    ['src/components/research/BookConstellationViz.tsx', 'LANGUAGE_COLORS'],
    ['src/components/research/ConceptDiffusionViz.tsx', 'LANGUAGE_COLORS'],
    ['src/components/research/TranslationLagViz.tsx', 'LANGUAGE_COLORS'],
    ['src/components/comparison/PassageComparison.tsx', 'SCRIPT_FONTS'],
  ]).map(([file, name]): Copy => ({ id: `${file.split('/').pop()} ${name} (keys)`, step: 'step 6 (#5336)', drift: () => unknownTokens(Object.keys(lit(file, name))) })),
];

/**
 * Known drift, per copy. Regenerate with LANG_DRIFT_DUMP=<out.json> and read every line
 * before pasting: an entry here says either the TABLE is right and the copy is
 * wrong, or the two differ by a policy the named step settles.
 */
const KNOWN_DRIFT: Record<string, string[]> = {
  // the table gives these historical stages their modern family; the name API never listed them
  'language-normalize sameLanguageFamily (names)': [
    'Irish ~ Old Irish',
    'Occitan ~ Old Provençal',
    'Old Spanish ~ Spanish',
    'Ardhamagadhi Prakrit ~ Prakrit',
    'Javanese ~ Old Javanese',
  ],
  // same five stages (it delegates to the name API)
  'language-utils sameLanguage': [
    'Irish ~ Old Irish',
    'Occitan ~ Old Provençal',
    'Old Spanish ~ Spanish',
    'Ardhamagadhi Prakrit ~ Prakrit',
    'Javanese ~ Old Javanese',
  ],
  // the homepage tokeniser: merges Maya varieties, Ottoman into Turkish and Anglo-Norman into French; counts `und` and junk atoms; loses Hebrew from "Multiple (Hebrew, …)"
  'language-canonical.ts distinctLanguageSet/countDistinctLanguages': [
    'Ottoman Turkish → [turkish]',
    'Yucatec Maya → [maya]',
    'Ne → [ne]',
    'Maya hieroglyphs / French → [maya, french]',
    'Mixtec → [mixtec]',
    'Anglo-Norman → [french]',
    'Maya hieroglyphs → [maya]',
    'und → [und]',
    'Am → [am]',
    'An → [an]',
    'Arabic, Ottoman Turkish, Persian, Latin, Ternate (a Papuan language), French and Dutch. → [arabic, turkish, persian, latin, ternate, french, dutch]',
    'Cakchiquel / English → [maya, english]',
    'Chagatai Turkish → [turkish]',
    'Den → [den]',
    'English, Scottish Gaelic → [english, gaelic]',
    'English/Gaelic → [english, gaelic]',
    'French. English. Latin → [french. english. latin]',
    'Ga → [ga]',
    'K\'iche\' / French → [maya, french]',
    'K\'iche\' Maya → [maya]',
    'K\'iche\' Maya-Spanish → [maya, spanish]',
    'Latin, some Hebrew and Greek → [latin, some hebrew, greek]',
    'Latin. French. English → [latin. french. english]',
    'Latin. German → [latin. german]',
    'Lb → [lb]',
    'Multiple (Hebrew, Greek, Latin, Syriac, Arabic, Ethiopic) → [greek, latin, syriac, arabic, geez]',
    'Text on maps in latin and german → [text on maps in latin, german]',
    'Yucatec Maya / English → [maya, english]',
  ],
  // junk labels pass as one language; a doubled label fails
  'language-canonical.ts isSingleRealLanguage': [
    'Ne: true',
    'Mixtec: true',
    'und: true',
    'Am: true',
    'An: true',
    'Armenian; Armenian: false',
    'Den: true',
    'French. English. Latin: true',
    'Ga: true',
    'Latin. French. English: true',
    'Latin. German: true',
    'Lb: true',
  ],
  // `lit` is the ISO 639-3 code for Lithuanian
  'language-canonical.ts JUNK': [
    'lit',
  ],
  // collapses stages and Judeo-languages onto the modern tag; the table emits the stage's own tag, and `grc` for Greek
  'language-code.ts languageToBcp47': [
    'Old Spanish → es (table: osp)',
    'Old Irish → ga (table: sga)',
    'Greek → el (table: grc)',
    'Judeo-Italian → it (table: itk)',
    'Judeo-Greek → el (table: yej)',
    'Judeo-Persian → fa (table: jpr)',
    'Middle Persian → fa (table: pal)',
    'Old Javanese → jv (table: kaw)',
  ],
  // `ga` is not accepted as input (a Hebrew grammar is labelled "Ga"); MARC `fre` is French but not allowlisted — the intended step-3 delta
  'ai-models.ts LATIN_SCRIPT_LANGUAGES': [
    'allowlisted, not lite in table: ga',
    'lite in table, not allowlisted: fre',
  ],
  // same as ai-models.ts
  'translate-core.mjs LATIN_SCRIPT_LANGUAGES': [
    'allowlisted, not lite in table: ga',
    'lite in table, not allowlisted: fre',
  ],
  // label-prefix test misses the table's Tibetan aliases
  'translate-core.mjs isTibetanBook': [
    'classical tibetan',
    'standard tibetan',
  ],
  // merges Middle Persian, Old Norse and Ottoman Turkish into modern languages; the design keeps them distinct codes and families
  'source-language-match.ts LANGUAGE_ALIASES': [
    'middle persian → persian (table: pal / fas)',
    'non → icelandic (table: non / isl)',
    'old norse → icelandic (table: non / isl)',
    'ota → turkish (table: ota / tur)',
    'ottoman turkish → turkish (table: ota / tur)',
  ],
  // same as the TS copy
  'source-language-match.mjs LANGUAGE_ALIASES': [
    'middle persian → persian (table: pal / fas)',
    'non → icelandic (table: non / isl)',
    'old norse → icelandic (table: non / isl)',
    'ota → turkish (table: ota / tur)',
    'ottoman turkish → turkish (table: ota / tur)',
  ],
  // Greek → `el`; the table stores and emits `grc`
  'scholarly-typst.mjs LANG_CODES': [
    'greek → el (table: grc)',
  ],
  // Greek → `el`
  'api/dts/collection LANG_CODES': [
    'greek → el (table: grc)',
  ],
  // Greek → `el`
  'api/iiif manifest LANG_CODES': [
    'greek → el (table: grc)',
  ],
  // Greek → `el`
  'api/iiif canvas LANG_CODES': [
    'greek → el (table: grc)',
  ],
  // Mixtec is deliberately unresolved (no group code)
  'book-i18n.ts LANGUAGE_NAMES_ES (keys)': [
    'mixtec',
  ],
  // Vietnamese is on the lite allowlist, so the table cannot mark it multi-script; chữ Nôm holdings are a step-3 question
  'language-script-confusion.mjs LANG_SCRIPTS': [
    'vietnamese: [latin,han] but not ambiguous_script',
  ],
  // `tib` is the MARC code for Tibetan
  'language-vs-ocr.mjs NOT_A_LANGUAGE': [
    'tib',
  ],
  // a junk key in a retired sweep
  'audit-language-provenance.mjs ISO': [
    'la_grc → latin (table: unknown / lat)',
  ],
};

describe('every inventory copy agrees with the table, or its drift is known', () => {
  if (process.env.LANG_DRIFT_DUMP) {
    it('dump', () => {
      const all = Object.fromEntries(COPIES.map((c) => [c.id, c.drift()] as const).filter(([, d]) => d.length));
      writeFileSync(process.env.LANG_DRIFT_DUMP!, `${JSON.stringify(all, null, 2)}\n`);
    });
    return;
  }
  for (const copy of COPIES) {
    it(`${copy.id} [${copy.step}]`, () => {
      expect(copy.drift()).toEqual(KNOWN_DRIFT[copy.id] ?? []);
    });
  }
});
