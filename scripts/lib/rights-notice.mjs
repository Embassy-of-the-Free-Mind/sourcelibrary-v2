/**
 * Rights-notice screen (#4809) — find a printed rights notice in a page's OCR text.
 * Pure functions; no I/O. Runner: scripts/audit/rights-notice-screen.mjs.
 *
 * PRIOR ART: scripts/lib/rights-normalize.mjs — classifies what the HOLDING LIBRARY's
 *   manifest states about the scan, never what the printed book says about itself (an
 *   importer's `publicdomain` is a default, not a reading: #4809, 2026-10-06).
 *   scripts/lib/ia-date-check.mjs — dates an IA item from IA metadata; our `year` and
 *   IA's date both missed every modern Indian edition the text screen caught.
 *   scripts/eval/spot-check/redact-rights.mjs — redacts, does not detect. The 2026-10-06
 *   canon-shelf screen this ports lived only in the private ops repo.
 *
 * A hit is a SCREEN hit, not a verdict: the imprint read decides (52 of 146 hits were
 * modern editions on the canon shelves). What is dropped, and why:
 *   - Google Books' front-matter boilerplate ("copyright term has expired", "public
 *     domain book") — on every Google scan, says nothing about the edition.
 *   - Digitizer watermarks (eGangotri / Dharmartha Trust; "no known copyright
 *     restrictions") — a statement about the scan, not the imprint.
 *   - A notice whose latest year is before MIN_YEAR (default 1930): a historical notice
 *     on an old imprint ("Copyright, 1889"). "Entered according to Act of Congress" is
 *     not screened at all: the formula went out of use by 1909.
 * An undated notice ("All rights reserved", ISBN, Hindi सर्वाधिकार) is kept: undated is
 * where the modern Varanasi and Bombay editions were.
 */

export const MIN_YEAR = 1930;

const Y = '(1[5-9]\\d\\d|20\\d\\d)';

// Each pattern names a notice class; first match on a line wins. Matched after
// Devanagari / Arabic-Indic digits are folded to ASCII. A pattern's `year` hook turns
// its match into a Common Era year (a Vikram-samvat date is CE + 57).
export const NOTICE_PATTERNS = Object.freeze([
  { kind: 'copyright-year', re: new RegExp(`(?:©|\\(c\\)|copyright|copr\\.)\\s*(?:,|by|\\(c\\))?\\s*(?:[^\\d\\n]{0,40}?)${Y}`, 'i') },
  // A bare © is a common OCR misread of a circled letter or a stray mark on old scans
  // (72 of 90 hits on a 45-day pass, all noise). An undated © counts only when it OPENS
  // the line and names a holder: "© Chaukhamba Orientalia". (© + year is caught above.)
  { kind: 'copyright-sign', re: /^[^\p{L}\d]{0,4}©\s*(?:by\b|\p{Lu}[\p{L}.]{2,}|\p{Lo}[\p{L}\p{M}]+)/u },
  { kind: 'copyright-word', re: /\bcopyright\b\s*(?:,|:|by\b|reserved)|\b(?:is|are)\s+(?:a\s+)?copyrighted\b|\bcopyrighted\s+(?:by|in)\b/i },
  { kind: 'rights-reserved', re: /\brights\s+(?:are\s+)?reserved/i },
  { kind: 'no-reproduction', re: /no\s+part\s+of\s+this\s+(?:book|publication|work)\s+may\s+be\s+reproduced/i },
  { kind: 'isbn', re: /\bISBN(?:[-\s]?1[03])?[:\s]*[\dXx][\d\-\s]{8,}/, undated: true },
  { kind: 'de-rechte', re: /alle\s+rechte\s+(?:\w+\s+)?vorbehalten/i },
  { kind: 'fr-droits', re: /tous\s+droits\s+(?:de\s+[\w\s,]+)?r[ée]serv[ée]s/i },
  { kind: 'es-derechos', re: /(?:todos\s+los\s+|reservados\s+todos\s+los\s+)derechos/i },
  { kind: 'it-diritti', re: /(?:tutti\s+i\s+)?diritti\s+(?:\w+\s+){0,3}riservati/i },
  { kind: 'ar-huquq', re: /(?:جميع\s+)?الحقوق\s+محفوظة|حقوق\s+(?:الطبع|النشر)[^\n]{0,30}محفوظة/ },
  // Sanskrit/Hindi: सर्वाधिकार सुरक्षित; सर्वेऽधिकाराः प्रकाशकाधीनाः; प्रकाशकेन स्वायत्तीकृताः.
  { kind: 'hi-sarvadhikar', re: /सर्वाधिकार|सर्वेऽधिकाराः|सर्वे\s*अधिकाराः|प्रकाशकाधीन|स्वायत्तीकृत/ },
  { kind: 'zh-banquan', re: /版權所有|版权所有|著作權|著作权|翻印必究/ },
  { kind: 'ja-chosaku', re: /著作権|無断転載/ },
  // Not a notice but a modern imprint date, which is what the date fields miss: an
  // edition/printing statement, an Arabic سنة الطبع, or a Vikram-samvat imprint year.
  { kind: 'imprint-year', re: new RegExp(`(?:\\b(?:first|second|third|\\d+(?:st|nd|rd|th))\\s+(?:edition|impression|printing|reprint)|\\b(?:reprinted|printed\\s+in|published\\s+in|edition\\s*[:\\-–])|سنة\\s+الطب)[^\\n]{0,40}?${Y}`, 'i') },
  { kind: 'vikram-samvat', re: /(?:सम्वत्|संवत्|सम्बत्|संवत|वि\.\s*सं\.?)\s*[:\-–]?\s*(\d{4})\b/,
    year: (m) => Number(m[1]) - 57 },
]);

// Lines that look like notices but describe the scan or Google's terms, not the edition.
export const BOILERPLATE = Object.freeze([
  /copyright\s+term\s+has\s+expired/i,
  /public\s+domain\s+book/i,
  /never\s+subject\s+to\s+copyright/i,
  /google/i,
  /no\s+known\s+copyright\s+restrictions/i,
  /egangotri|e\s*gangotri|dharmartha/i,
  /digiti[sz]ed\s+by/i,
  /internet\s+archive/i,
  /proquest|early\s+european\s+books/i, // EEB's scan notice, on every EEB leaf
]);

const YEAR = /\b(1[5-9]\d\d|20\d\d)\b/g;

/** Strip the OCR's own XML-ish tags (<vocab>copyright…</vocab> would self-match). */
export function stripOcrTags(text) {
  return String(text || '')
    .replace(/<(meta|vocab|image-desc|scan-quality|language|script|page-type|summary|note)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>\n]{1,80}>/g, ' ');
}

/** Fold Devanagari, Arabic-Indic and Persian digits to ASCII (१९६६ → 1966). */
export function foldDigits(s) {
  return String(s).replace(/[०-९٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x966 ? c - 0x966 : c >= 0x6f0 ? c - 0x6f0 : c - 0x660);
  });
}

/** Years printed in a line, as numbers. */
export function yearsIn(line) {
  return [...foldDigits(line).matchAll(YEAR)].map((m) => Number(m[1]));
}

/**
 * Notices on one page. Returns [{ kind, line, years }] with boilerplate and
 * old-dated notices removed. `minYear` is the first year that keeps a dated notice;
 * a notice with no year is kept (undated is where the modern Indian editions were).
 */
export function findRightsNotices(text, { minYear = MIN_YEAR, now = new Date() } = {}) {
  const out = [];
  const maxYear = now.getUTCFullYear() + 1;
  for (const raw of stripOcrTags(text).split('\n')) {
    const line = foldDigits(raw.trim());
    if (line.length < 4 || line.length > 400) continue;
    if (BOILERPLATE.some((re) => re.test(line))) continue;
    for (const { kind, re, year, undated } of NOTICE_PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      // An ISBN is modern by construction (1970+), and its digits can read as a year.
      const years = undated ? [] : year ? [year(m)] : yearsIn(line);
      const dated = years.filter((y) => y <= maxYear);
      if (year && !dated.length) continue; // a samvat number that is no plausible year
      if (dated.length && Math.max(...dated) < minYear) break;
      out.push({ kind, line: raw.trim().slice(0, 160), years: dated });
      break;
    }
  }
  return out;
}
