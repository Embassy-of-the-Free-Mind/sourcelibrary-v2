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
