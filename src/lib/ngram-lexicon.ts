/**
 * Cross-language term families for the ngram viewer (issue #3175 follow-up).
 * When a charted term matches a family, the UI offers the other languages'
 * equivalents as one-click comparison chips (`mercurius:la` syntax).
 *
 * Curated by hand, deliberately small: only equivalents that are unambiguous
 * in early-modern usage belong here. Known exclusions: French "or" (gold) is
 * drowned by the conjunction; Greek forms are included only where the everyday
 * word and the technical term coincide. Forms are written in display spelling —
 * the normalizer folds orthography (u/v, ligatures, diacritics) at query time,
 * so "cœlum" and "caelum" are listed separately only when they normalize
 * differently (coelum vs caelum are genuinely distinct spellings).
 */

export interface TermFamily {
  /** English headword — also the `en`-corpus form. */
  en: string;
  /** corpus id → equivalent forms in that corpus. */
  forms: Record<string, string[]>;
}

export const NGRAM_LEXICON: TermFamily[] = [
  { en: 'mercury', forms: { la: ['mercurius'], de: ['quecksilber'], fr: ['mercure'], it: ['mercurio'], es: ['mercurio'] } },
  { en: 'sulphur', forms: { la: ['sulphur'], de: ['schwefel'], fr: ['soufre'], it: ['zolfo'] } },
  { en: 'salt', forms: { la: ['sal'], de: ['salz'], fr: ['sel'], it: ['sale'] } },
  { en: 'gold', forms: { la: ['aurum'], de: ['gold'], it: ['oro'] } },
  { en: 'silver', forms: { la: ['argentum'], de: ['silber'], fr: ['argent'] } },
  { en: "philosopher's stone", forms: { la: ['lapis philosophorum'], de: ['stein der weisen'], fr: ['pierre philosophale'], it: ['pietra filosofale'] } },
  { en: 'elixir', forms: { la: ['elixir'], fr: ['élixir'] } },
  { en: 'quintessence', forms: { la: ['quinta essentia'], fr: ['quintessence'] } },
  { en: 'tincture', forms: { la: ['tinctura'], de: ['tinktur'], fr: ['teinture'] } },
  { en: 'transmutation', forms: { la: ['transmutatio'], fr: ['transmutation'] } },
  { en: 'antimony', forms: { la: ['antimonium'], de: ['antimon'], fr: ['antimoine'] } },
  { en: 'vitriol', forms: { la: ['vitriolum'], de: ['vitriol'] } },
  { en: 'alchemy', forms: { la: ['alchimia', 'alchemia'], de: ['alchemie', 'alchimie'], fr: ['alchimie'], it: ['alchimia'] } },
  { en: 'magic', forms: { la: ['magia'], de: ['magie'], fr: ['magie'], el: ['μαγεια'] } },
  { en: 'kabbalah', forms: { la: ['cabala'], de: ['kabbala'], fr: ['cabale'] } },
  { en: 'spirit', forms: { la: ['spiritus'], de: ['geist'], fr: ['esprit'], el: ['πνευμα'] } },
  { en: 'soul', forms: { la: ['anima'], de: ['seele'], fr: ['âme'], el: ['ψυχη'] } },
  { en: 'nature', forms: { la: ['natura'], de: ['natur'], fr: ['nature'], el: ['φυσις'] } },
  { en: 'god', forms: { la: ['deus'], de: ['gott'], fr: ['dieu'], el: ['θεος'] } },
  { en: 'wisdom', forms: { la: ['sapientia'], de: ['weisheit'], fr: ['sagesse'], el: ['σοφια'] } },
  { en: 'light', forms: { la: ['lux'], de: ['licht'], fr: ['lumière'], el: ['φως'] } },
  { en: 'fire', forms: { la: ['ignis'], de: ['feuer'], fr: ['feu'], el: ['πυρ'] } },
  { en: 'water', forms: { la: ['aqua'], de: ['wasser'], fr: ['eau'], el: ['υδωρ'] } },
  { en: 'earth', forms: { la: ['terra'], de: ['erde'], fr: ['terre'], el: ['γη'] } },
  { en: 'air', forms: { la: ['aer'], de: ['luft'], fr: ['air'], el: ['αηρ'] } },
  { en: 'world', forms: { la: ['mundus'], de: ['welt'], fr: ['monde'], el: ['κοσμος'] } },
  { en: 'heaven', forms: { la: ['caelum', 'coelum'], de: ['himmel'], fr: ['ciel'], el: ['ουρανος'] } },
  { en: 'sun', forms: { la: ['sol'], de: ['sonne'], fr: ['soleil'], el: ['ηλιος'] } },
  { en: 'moon', forms: { la: ['luna'], de: ['mond'], fr: ['lune'], el: ['σεληνη'] } },
  { en: 'death', forms: { la: ['mors'], de: ['tod'], fr: ['mort'], el: ['θανατος'] } },
  { en: 'medicine', forms: { la: ['medicina'], de: ['medizin'], fr: ['médecine'] } },
  { en: 'microcosm', forms: { la: ['microcosmus'], fr: ['microcosme'] } },
];

/**
 * Find the family a (normalized-ish) term belongs to — matches the English
 * headword or any listed form, case-insensitively. Returns null if none.
 */
export function findTermFamily(term: string): TermFamily | null {
  const t = term.trim().toLowerCase();
  if (!t) return null;
  for (const fam of NGRAM_LEXICON) {
    if (fam.en === t) return fam;
    for (const forms of Object.values(fam.forms)) {
      if (forms.some(f => f.toLowerCase() === t)) return fam;
    }
  }
  return null;
}
