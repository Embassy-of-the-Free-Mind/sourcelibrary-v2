/**
 * IA date check (#5458): is an Internet Archive item actually OLD, or a modern
 * print whose date field lies? Rules only — no model calls, no network.
 *
 * PRIOR ART: scripts/iiif-discovery/classify-candidates.mjs — writes the tier-0
 *   `classification` sub-document (record_type/script/language_iso) from IA
 *   collections; it never looks at dates. scripts/maintenance/clear-fabricated-eap-dates.mjs
 *   (#3307) handles one fabricated-year family on `books`, not IA candidates.
 *   scripts/lib/syriac-kraken-lane.mjs `editionYear()` is reused for free-text
 *   `published`. Nothing classified IA candidate dates.
 *
 * Input: the import_candidates row (or a library book) + the IA scrape-API record
 * (identifier, date, year, publicdate, publisher, collection, language, scanner,
 * contributor, isbn, edition, title, …). Output:
 *   { verdict: 'old'|'modern'|'unknown', reason, date_ce, provenance }
 *
 * The idea, measured on the 2026-10-01 pull: a date is only as good as WHO wrote
 * it. Library catalogue records (IA scanning centres, Google Books, partner
 * libraries, newspaper archives) carry an imprint date — trustworthy once its
 * calendar is right. Patron uploads (HTML5 / python-library uploader into
 * personal collections) carry whatever the uploader typed: the work's
 * composition date, the upload date, a solar-Hijri year, or nothing. Those are
 * never read as "old" on the date alone.
 */

// Bump on ANY rule change: write-ia-date-check.mjs skips rows already carrying this METHOD,
// so a changed rule under an unchanged name would silently never be written.
export const METHOD = 'ia-date-rules-v3';

const ISLAMICATE = /^(ara|ar|arabic|per|fas|fa|persian|farsi|urd|ur|urdu|ota|ottoman|ottoman turkish|pus|pashto|snd|sindhi|kas|kashmiri|uig|uighur|uyghur)$/i;
const PERSIAN = /^(per|fas|fa|persian|farsi)$/i;
const BENGALI = /^(ben|bn|bengali|bangla|asm|as|assamese)$/i;
const INDIC = /^(san|sa|sanskrit|hin|hi|hindi|guj|gu|gujarati|mar|mr|marathi|pan|pa|punjabi|panjabi|raj|nep|ne|nepali|ori|or|oriya|odia|kan|kn|kannada|tel|te|telugu|tam|ta|tamil|mal|ml|malayalam|mai|bho|awa|bra|pli|pi|pali|prakrit|pra)$/i;
const CHINESE = /^(chi|zho|zh|cmn|chinese|chinese \(traditional\)|chinese \(simplified\)|lzh|classical chinese)$/i;
const HEBREW = /^(heb|he|hebrew|yid|yiddish|lad|ladino|arc|aramaic)$/i;

// IA scanning centres and library-digitisation pipelines (the `scanner` field).
const LIBRARY_SCANNER = /scribe|google|microfilm|gri-digital|kirtas|e-rara|iasw\d|fold\d|uoft\d|station\d+\.|illi-mf|\.archive\.org/i;
// Collections whose records come from a library/archive catalogue, not a patron.
const LIBRARY_COLLECTIONS = new Set([
  'americana', 'toronto', 'university_of_toronto', 'robarts', 'thomasfisher', 'thomasfisherarabic',
  'europeanlibraries', 'polishpublicdomain', 'medicalheritagelibrary', 'medicallibrary', 'ukmhl',
  'wellcomelibrary', 'bncfirenze', 'early-european-books', 'bibliotecauniversitariadesevilla',
  'getty', 'JohnCarterBrownLibrary', 'rcseng', 'lanemedicallibrary', 'biodiversity',
  'bibliothequeinteruniversitairedesante', 'mcgilluniversity', 'mcgilluniversityislamicstudies',
  'mcgill-university-persianate', 'bulac', 'duke_libraries', 'LeoBaeckInstitute',
  'OhioStateUniversityLibrary', 'osulhjpc', 'usnationallibraryofmedicine', 'cushingwhitneymedicallibrary',
  'nplislamicmanuscripts', 'johncapistranborleyislamicmanuscripts', 'library_of_congress',
  'princeton', 'cdl', 'uclalibrary', 'harvard', 'yale', 'smithsonian', 'brittlebooks',
  'newspapers', 'shenbao-archive', 'zilin-hubao-archive', 'xinwenbao-shanghai', 'subao-archive',
  'china-mail', 'lat-pau-archive', 'cwfap-archive', 'eastasia-periodicals', 'hebrewlit',
  'globallibraries', 'ottoschneidpapers', 'amtsblattzurlemberger', 'dziennikustawpanstwa',
  'theses-and-dissertations', 'microfilm', 'ealmucollection', 'ghani-collection-mirror',
]);
const LIBRARY_ID = /^(bub_gb_|AAlexandrina-|McGillLibrary-|BIUSante_|BL_?Or|cu\d{8}|ARes\d|hvd\.|uc\d\.|ucm\.|mdp\.|nyp\.)|goog$|\.nlm\.nih\.gov$|\.med\.yale\.edu$/i;
const LIBRARY_CONTRIBUTOR = /librar|universit|bibliot|museum|institut|archiv|biblioth|college|society|academy|seminar/i;
const DLI_COLLECTIONS = new Set(['digitallibraryindia']);
const DLI_ID = /^(in\.ernet\.dli|dli\.|in\.gov\.ignca)/i;

// Modern-object evidence that holds whatever the date field says.
const ISBN_RE = /\bISBN\b|\b97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d\b/i;
// Arabic-script critical-edition / modern-publisher / thesis markers (title or publisher).
const MODERN_ARABIC = /(^|[\s(\[])(تحقيق|حققه|تحقیق|تصحیح و تحقیق|رسالة ماجستير|رسالة دكتوراه|أطروحة|اطروحة|ماجستير|دكتوراه|پایان\s?نامه|مجلة|بحوث|المكتبة الشاملة|اقرا اونلاين|دار الكتب العلمية|ط العلمية|ط الرسالة|مؤسسة الرسالة|عالم الكتب|دار ابن حزم|دار ابن الجوزي|أضواء السلف|مكتبة الرشد|الهيئة المصرية العامة للكتاب|وزارة|جامعة)(?=$|[\s)\]:،.])/;
const MODERN_PUBLISHER = /\b(GmbH|Ltd\.?|Pvt\.?|Inc\.|Publishing House|Prakashan|Prakashana|Verlag\s+(GmbH|KG)|Taylor\s*&\s*Francis|Routledge|Penguin|Brill Academic|Motilal Banarsidass|Chaukhamba|Chowkhamba|Bharatiya Vidya Bhavan|Sahitya Akademi)\b|(^|\s)دار\s|انتشارات|نشر\s|چاپخانه|مكتبة\s/i;
// Ordinal editions ('4th ed.', 'الطبعة الأولى') are NOT modern evidence: 19th-century books have
// editions too (v1 validation read an 1830 '4th ed.' and an 1884 '8th ed.' as modern).
const EDITION_RE = /\breprint(ed)?\b|\bfacsimile\b|(^|\s)ط\s?[0-9١-٩]/i;
// Handwritten-object evidence.
const MANUSCRIPT_RE = /\bmanuscripts?\b|\bMS\.?\s?[A-Z]*\s?\d|\bcodex\b|\bmss?\b|مخطوط|مخطوطة|نسخة خطية|نسخه خطی|دستنویس|हस्तलिखित|पाण्डुलिपि|手稿|抄本|写本|寫本|כתב יד/i;
const INDIC_SCRIPT = /[\u0900-\u0DFF]/; // Devanagari … Sinhala blocks: an Indic-script title
const MANUSCRIPT_COLL = /manuscript|indic-manuscripts|egangotri-manuscripts/i;

const AR_DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };
const asciiDigits = (s) => String(s || '').replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d]);

const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x) => String(x));
const first = (v) => list(v)[0] || '';

export const ahToCe = (ah) => Math.round(ah * 0.970229 + 621.5643);

/** The language codes an item carries: candidate language + IA language tags (split on ; , /). */
function languagesOf(cand, ia) {
  const raw = [cand?.language, ...(cand?.langs || []), ...list(ia?.language)].filter(Boolean);
  const out = new Set();
  for (const r of raw) for (const p of String(r).toLowerCase().split(/[;,/]|\s-\s/)) { const t = p.trim().replace(/\.$/, ''); if (t) out.add(t); }
  return [...out];
}

export function provenanceOf(ia, cand) {
  const id = ia?.identifier || cand?.id || '';
  const colls = list(ia?.collection).concat(cand?.colls || []);
  if (colls.some((c) => DLI_COLLECTIONS.has(c)) || DLI_ID.test(id)) return 'dli';
  if (colls.includes('universallibrary')) return 'universallibrary';
  if (LIBRARY_ID.test(id)) return 'library';
  if (colls.some((c) => LIBRARY_COLLECTIONS.has(c))) return 'library';
  if (LIBRARY_SCANNER.test(first(ia?.scanner))) return 'library';
  const contrib = list(ia?.contributor).join(' ');
  if (contrib && LIBRARY_CONTRIBUTOR.test(contrib)) return 'library';
  return 'patron';
}

/**
 * The year the IA record states, or null with a reason. Rejects placeholders and
 * dates that are the upload date in disguise (same day as publicdate/addeddate,
 * or the YYYYMMDD sitting in the identifier). An upload-shaped IDENTIFIER alone
 * says nothing about the book and is never used.
 */
export function statedDate(ia) {
  const d = first(ia?.date) || (ia?.year != null ? String(first(ia.year)) : '');
  const m = /^(-?\d{1,4})(?:-(\d{2})-(\d{2}))?/.exec(asciiDigits(d).trim());
  if (!m) return { year: null, why: 'no-date' };
  const year = Number(m[1]), md = m[2] ? `${m[2]}-${m[3]}` : '01-01';
  const ymd = `${m[1].padStart(4, '0')}-${md}`;
  for (const k of ['publicdate', 'addeddate']) if (ia?.[k] && first(ia[k]).slice(0, 10) === ymd) return { year: null, why: 'date-is-upload-date', raw: ymd };
  const compact = ymd.replace(/-/g, '');
  if (year >= 1990 && md !== '01-01' && String(ia?.identifier || '').includes(compact)) return { year: null, why: 'date-is-upload-date', raw: ymd };
  if (year >= 1000 && md !== '01-01' && String(ia?.identifier || '').includes(`20${String(year).slice(2)}${md.replace('-', '')}`)) return { year: null, why: 'date-from-identifier', raw: ymd };
  if (year === 1000 && md === '01-01') return { year: null, why: 'placeholder-year', raw: ymd };
  if (/^(1111|1234|9999|0000)$/.test(m[1].padStart(4, '0'))) return { year: null, why: 'placeholder-year', raw: ymd };
  if (year > 2100) return { year, md, raw: ymd, why: 'future-year' };
  return { year, md, raw: ymd };
}

/** Map a stated year to CE given the item's languages. Returns { ce, calendar } or { ce:null, why }. */
export function toCe(year, md, langs, prov) {
  const has = (re) => langs.some((l) => re.test(l));
  const islamicate = has(ISLAMICATE), persian = has(PERSIAN), bengali = has(BENGALI), indic = has(INDIC) || bengali;
  const chinese = has(CHINESE), hebrew = has(HEBREW);
  if (chinese && !islamicate && year >= 2 && year <= 115) return { ce: year + 1911, calendar: 'roc' }; // 民國 year
  if (hebrew && year >= 5000 && year <= 5900) return { ce: year - 3760, calendar: 'anno-mundi' };
  if (hebrew && !islamicate && year >= 400 && year <= 799) return { ce: year + 1240, calendar: 'anno-mundi-short' };
  if (year <= 100) return { ce: null, why: 'placeholder-year' };
  if (islamicate) {
    if (persian && year >= 1304 && year <= 1404) {
      // Solar Hijri (official from 1304 SH = 1925) or lunar AH: both land ≥1886.
      const sh = year + 621, ah = ahToCe(year);
      if (ah >= 1900) return { ce: sh, calendar: 'solar-hijri-or-ah' };
      return { ce: null, why: 'persian-sh-or-ah-ambiguous', range: [ah, sh] };
    }
    if (year <= 1450) return { ce: ahToCe(year), calendar: 'ah' };
    return { ce: year, calendar: 'ce' };
  }
  if (bengali && year >= 1100 && year <= 1450) return { ce: year + 593, calendar: 'bengali-san' };
  if (indic && year > 2030 && year <= 2140) return { ce: year - 57, calendar: 'vikram-samvat' };
  if (indic && year < 1500) return { ce: null, why: 'indic-year-implausible-as-ce' };
  if (indic && prov === 'patron' && year >= 1900 && year <= 1956) return { ce: null, why: 'indic-ce-or-vs-ambiguous', range: [year - 57, year] };
  if (year > 2030) return { ce: null, why: 'future-year' };
  return { ce: year, calendar: 'ce' };
}

/**
 * @param cand  candidate summary { id, title, author, language, langs[], colls[] } (library books: same shape)
 * @param ia    IA scrape record, or null when the item is gone from IA
 */
export function classifyIaDate(cand, ia) {
  if (!ia) return { verdict: 'unknown', reason: 'not-on-ia', date_ce: null, provenance: null };
  // Digital Scriptorium legacy mirror: every page image is the same screenshot of a web
  // catalogue record ("Number of Images Available: 0"), never the manuscript. Measured
  // 16/16 (6 in the two validation rounds, 10 more by page hash), 5,150 items.
  if (list(ia.collection).includes('ds-legacy-data')) return { verdict: 'modern', reason: 'web-catalogue-screenshot:ds-legacy-data', date_ce: null, provenance: provenanceOf(ia, cand) };
  const prov = provenanceOf(ia, cand);
  const langs = languagesOf(cand, ia);
  const title = asciiDigits([first(ia.title) || cand?.title || '', first(ia.subject)].join(' '));
  const publisher = asciiDigits(list(ia.publisher).join(' '));
  const out = (verdict, reason, date_ce = null) => ({ verdict, reason, date_ce, provenance: prov });

  let sd = statedDate(ia);
  // A patron's recent full date (not Jan 1) is far more often the day they uploaded or
  // scanned than an imprint — not evidence either way.
  if (prov === 'patron' && sd.year >= 1990 && sd.md !== '01-01') sd = { year: null, why: 'date-looks-like-upload' };
  const cv = sd.year != null ? toCe(sd.year, sd.md, langs, prov) : { ce: null, why: sd.why };
  const ce = cv.ce;
  const manuscript = MANUSCRIPT_RE.test(title) || list(ia.collection).some((c) => MANUSCRIPT_COLL.test(c)) || langs.some((l) => /handwritten/.test(l));
  const softModern = MODERN_ARABIC.test(title) || MODERN_ARABIC.test(publisher) || MODERN_PUBLISHER.test(publisher)
    || EDITION_RE.test(list(ia.edition).join(' ')) || EDITION_RE.test(title);
  const titleYear = (() => { const m = /(?:^|\D)(19\d\d|20[0-2]\d)(?:\D|$)/.exec(title); return m ? Number(m[1]) : null; })();
  const calTag = cv.calendar && cv.calendar !== 'ce' ? `:${cv.calendar}` : '';
  const indic = langs.some((l) => INDIC.test(l) || BENGALI.test(l)) || INDIC_SCRIPT.test(title);

  // 1. ISBN = a modern object — except a library microform of an old imprint (CIHM
  //    microfiche carry an ISBN for the fiche; v1 validation: an 1879 synod read as modern).
  const microform = /micro(form|fiche|film)/i.test(`${title} ${first(ia.scanner)} ${list(ia.collection).join(' ')}`);
  if ((list(ia.isbn).length || ISBN_RE.test(title)) && !(prov === 'library' && (microform || (ce != null && ce < 1900)))) return out('modern', 'isbn');

  // 2. A converted date ≥1900 is modern regardless of provenance (the object cannot predate its imprint).
  if (ce != null && ce >= 1900) return out('modern', `stated-date-${prov}${calTag}`, ce);

  // 3. Provenance-specific readings of an old (or missing) date.
  if (prov === 'library') {
    if (ce != null) return out('old', `catalogue-date${calTag}`, ce);
    return out('unknown', `library-${cv.why || 'no-date'}`);
  }
  if (prov === 'dli') {
    // DLI scans are overwhelmingly 20th-century prints (#5458). A 19th-century year is
    // believable when stated in CE for a non-Indic book, or converted from an explicit
    // AH / Bengali-San year. An Indic-language book's bare 18xx may be Shaka (+78) or
    // Vikram (−57): v1 validation read 'Shaka 1827' (= 1905) and a 1987 Hindi play
    // catalogued '1878' as old. A pre-1800 year on an Indic book is the work's date.
    if (ce != null && ce >= 1800) {
      if (indic && !calTag) return out('unknown', 'dli-indic-era-ambiguous', null);
      return out('old', `dli-19c-date${calTag}`, ce);
    }
    if (ce != null) return indic ? out('modern', `dli-implausible-pre1800${calTag}`) : out('unknown', `dli-pre1800-unverified${calTag}`);
    return out('modern', `dli-${cv.why || 'no-date'}`);
  }
  if (prov === 'universallibrary') {
    if (ce != null) return out('unknown', 'universallibrary-date-unverified', null);
    return out('unknown', 'universallibrary-undated');
  }
  // patron upload: the date is whatever the uploader typed.
  if (softModern) return out('modern', 'patron-modern-marker');
  if (titleYear) return out('modern', 'patron-title-year', titleYear);
  if (manuscript && ce != null) return out('old', `patron-manuscript-dated${calTag}`, ce);
  if (manuscript) return out('unknown', 'patron-manuscript-undated');
  if (ce != null) return out('unknown', `patron-date-unverified${calTag}`, ce);
  // A stated year whose calendar we cannot settle (VS-or-CE, SH-or-AH) is not "undated".
  if (cv.range) return out('unknown', `patron-${cv.why}`);
  // A pre-1900-looking year in the title ('… 8th Ed. (1884)') blocks the base rate below.
  if (/(?:^|[\s(\[,،])(1[2-8]\d\d)(?=[\s)\],.،]|$)/.test(title)) return out('unknown', 'patron-title-old-year');
  // A patron upload with no usable date and no manuscript signal: base rate, not proof.
  // Validation read 25/25 such items (two rounds) as modern prints/PDFs from the title page.
  return out('modern', `patron-undated:${cv.why || 'no-date'}`);
}
