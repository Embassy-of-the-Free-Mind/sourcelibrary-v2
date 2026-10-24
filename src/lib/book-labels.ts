/**
 * PRIOR ART: src/lib/og-page-card.tsx — holds one 'Auctor ignotus' string for the share card only; no author-placeholder or period (books.published) localizer exists (git grep for the Latin strings, 2026-10-20).
 *
 * Reader-facing renderings of catalogue placeholders (#7055).
 *
 * `books.author` and `books.published` are free text. Two kinds of value in
 * them are English WORDS rather than data: author placeholders ("Anonymous",
 * "Unknown") and period labels ("Medieval", "15th century"). On a localized
 * page those read as English chrome, so they are rendered per locale here.
 * Rendering only: nothing is written back. Anything not recognised is returned
 * unchanged (a real year, a range of years, a name).
 */
import type { Locale } from '@/lib/locale-path';

const UNKNOWN_AUTHOR: Record<Locale, string> = {
  en: 'Unknown',
  es: 'Autor desconocido',
  la: 'Auctor ignotus',
  nl: 'Onbekende auteur',
  zh: '佚名',
};

/** "Anonymous", "Unknown", "Anonymus", "Anónimo", "Auctor ignotus"… */
const AUTHOR_PLACEHOLDER =
  /^\s*[[(]?\s*(anonymous|anonymus|anonym|anonyme|anonimo|anónimo|anoniem|unknown(\s+author)?|author\s+unknown|auctor\s+ignotus|onbekend|desconocido)\s*[\])]?\.?\s*$/i;

/** The per-locale placeholder for an anonymous/unknown author, or the name untouched. */
export function localizeAuthorName(name: string, lang: Locale): string {
  if (lang === 'en') return name;
  return AUTHOR_PLACEHOLDER.test(name) ? UNKNOWN_AUTHOR[lang] : name;
}

const MEDIEVAL: Record<Locale, string> = {
  en: 'Medieval',
  es: 'Edad Media',
  la: 'Medii aevi',
  nl: 'Middeleeuwen',
  zh: '中世纪',
};

const EARLY_MODERN: Record<Locale, string> = {
  en: 'Early modern',
  es: 'Edad Moderna',
  la: 'Recentioris aevi',
  nl: 'Vroegmodern',
  zh: '近代早期',
};

function toRoman(n: number): string {
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

/** One century ("15th century") or a span of two, in the locale's words. */
function centuries(a: number, b: number | null, lang: Locale): string {
  switch (lang) {
    case 'la': return `saec. ${toRoman(a)}${b ? `–${toRoman(b)}` : ''}`;
    case 'es': return `${b ? 'siglos' : 'siglo'} ${toRoman(a)}${b ? `–${toRoman(b)}` : ''}`;
    case 'nl': return b ? `${a}e–${b}e eeuw` : `${a}e eeuw`;
    case 'zh': return b ? `${a}–${b}世纪` : `${a}世纪`;
    default: return b ? `${a}th–${b}th century` : `${a}th century`;
  }
}

const ORD = '(\\d{1,2})(?:st|nd|rd|th)';
const ONE_CENTURY = new RegExp(`^${ORD}\\s+century$`, 'i');
const TWO_CENTURIES = new RegExp(`^${ORD}\\s*[-–—]\\s*${ORD}\\s+century$`, 'i');

/**
 * A `books.published` string in the locale's words. Only recognised period
 * words ("Medieval", "Early modern", "Nth century", "Nth-Mth century") are
 * changed; years, dates and every other string come back as given.
 */
export function localizePublished(raw: string, lang: Locale): string {
  if (lang === 'en') return raw;
  const s = raw.trim();
  if (/^medieval$/i.test(s)) return MEDIEVAL[lang];
  if (/^early\s+modern$/i.test(s)) return EARLY_MODERN[lang];
  const one = ONE_CENTURY.exec(s);
  if (one) return centuries(Number(one[1]), null, lang);
  const two = TWO_CENTURIES.exec(s);
  if (two) return centuries(Number(two[1]), Number(two[2]), lang);
  return raw;
}

// ---------- Work dates (`source_work_dates[].date_display`, #7072) ----------
//
// The dating run (#6721) writes `date_display` as English prose: a year range
// plus how it was reached ("1532–1593, the author's adult life"), "c.", BCE/CE,
// the odd "15th century". Twelve shapes cover 98% of live books. Each known
// phrase is rendered per locale; a string with an unrecognised phrase comes
// back unchanged rather than half-translated.

type Foreign = Exclude<Locale, 'en'>;

const DATE_PHRASES: { re: RegExp; t: Record<Foreign, string> }[] = [
  { re: /^the author['’]s adult life$/i, t: { es: 'vida adulta del autor', la: 'aetate auctoris adulta', nl: 'volwassen leven van de auteur', zh: '作者成年时期' } },
  { re: /^the author['’]s likely working life$/i, t: { es: 'probable época de actividad del autor', la: 'aetate auctoris operosa, ut videtur', nl: 'vermoedelijke werkzame jaren van de auteur', zh: '作者可能的创作时期' } },
  { re: /^the author['’]s working years$/i, t: { es: 'años de actividad del autor', la: 'annis auctoris operosis', nl: 'werkzame jaren van de auteur', zh: '作者创作时期' } },
  { re: /^before the author['’]s death$/i, t: { es: 'antes de la muerte del autor', la: 'ante mortem auctoris', nl: 'vóór de dood van de auteur', zh: '作者去世之前' } },
  { re: /^around the author['’]s floruit$/i, t: { es: 'en torno al floruit del autor', la: 'circa floruit auctoris', nl: 'rond de bloeitijd van de auteur', zh: '作者活跃时期前后' } },
  { re: /^Indian composition$/i, t: { es: 'composición india', la: 'compositio Indica', nl: 'Indiase compositie', zh: '印度成书' } },
];

const UNCERTAIN: Record<Foreign, string> = { es: 'incierta', la: 'incerta', nl: 'onzeker', zh: '不详' };
const CIRCA: Record<Foreign, string> = { es: 'c.', la: 'c.', nl: 'ca.', zh: '约' };
const ERA: Record<Foreign, { bce: string; ce: string }> = {
  es: { bce: 'a. C.', ce: 'd. C.' },
  la: { bce: 'a.C.n.', ce: 'p.C.n.' },
  nl: { bce: 'v.Chr.', ce: 'n.Chr.' },
  zh: { bce: '公元前', ce: '公元' },
};
const ERA_WORDS = /a\. C\.|d\. C\.|a\.C\.n\.|p\.C\.n\.|v\.Chr\.|n\.Chr\.|ca\.|c\./g;

/** The date part only: years, "c.", BCE/CE, "Nth century". Null if any other word is left. */
function localizeDatePart(s: string, lang: Foreign): string | null {
  const cent = /^(c\.\s*)?(\d{1,2})(?:st|nd|rd|th)(?:\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th))?\s+(?:century|c\.)$/i.exec(s);
  if (cent) return `${cent[1] ? `${CIRCA[lang]} ` : ''}${centuries(Number(cent[2]), cent[3] ? Number(cent[3]) : null, lang)}`;
  const era = ERA[lang];
  let out = s.replace(/\b(?:AD|A\.D\.)\s*(\d+)/g, '$1 CE');
  // Chinese puts the era before the year (公元前500); the others after it.
  out = out.replace(/(\d+)\s*(BCE|BC|CE)\b/g, (_, y: string, e: string) => {
    const word = e === 'CE' ? era.ce : era.bce;
    return lang === 'zh' ? `${word}${y}` : `${y} ${word}`;
  });
  out = out.replace(/^c\.\s*/i, lang === 'zh' ? CIRCA.zh : `${CIRCA[lang]} `);
  // Any Latin letter left that is not one of our own era words is an English
  // word we do not know.
  return /[A-Za-z]/.test(out.replace(ERA_WORDS, '')) ? null : out;
}

/**
 * A `source_work_dates[].date_display` string in the locale's words. Rendering
 * only; an unrecognised string is returned as stored.
 */
export function localizeDateDisplay(raw: string, lang: Locale): string {
  if (lang === 'en' || !raw) return raw;
  const s = raw.trim();
  if (/^uncertain$/i.test(s)) return UNCERTAIN[lang];
  const comma = s.indexOf(',');
  const date = localizeDatePart(comma === -1 ? s : s.slice(0, comma).trim(), lang);
  if (date === null) return raw;
  if (comma === -1) return date;
  const phrase = s.slice(comma + 1).trim();
  const known = DATE_PHRASES.find((p) => p.re.test(phrase));
  if (!known) return raw;
  return lang === 'zh' ? `${date}，${known.t.zh}` : `${date}, ${known.t[lang]}`;
}

const TRANSLATED_ABBR: Record<Locale, string> = { en: 'trans.', es: 'trad.', la: 'interpr.', nl: 'vert.', zh: '译' };

/** The short "trans." word before a translation date. */
export function translatedAbbr(lang: Locale): string {
  return TRANSLATED_ABBR[lang];
}
