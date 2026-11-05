/**
 * Read a book's IMPRINT off its own opening leaves, and keep only what cites its line (#7201).
 *
 * PRIOR ART: scripts/audit/titlepage-model-pilot-v2.mjs — the author-only pilot (#3949) this extends; its
 * cite-the-quoted-line guards (`quoteIsOnPage`, `quoteSupportsName`) MOVED here so the pilot and the imprint
 * mode share one copy, and the pilot imports them back. scripts/lib/title-page-ocr.mjs finds the window of
 * typed pages (text mode) and is reused as is. scripts/lib/date-works.mjs `findImprint` already decides
 * whether a span prints a given year in Arabic or Roman figures (#6721), so the date check calls it rather
 * than growing a second Roman-numeral reader. None of them reads title, place, printer or edition, and none
 * reads a page IMAGE, which is the only thing 56K scans-only books have.
 *
 * The rule carried over from the pilot is the point: every field comes back with the page it was read from
 * and the line it was read in. In TEXT mode the line must be on the cited page's OCR. In IMAGE mode there is
 * no OCR to test against, so the guard is the weaker one that is still checkable: the page must be one the
 * model was shown, and the quoted line must itself carry the value (the year in the date's line, the name in
 * the author's line). A person checks the rest against the scan in ten seconds.
 *
 * Writes nothing. A full-run writer may only go through setCatalogueFields() (scripts/lib/catalogue-fields.mjs,
 * #6327), after Derek approves it.
 */
import { foldOrtho } from './name-equivalence.mjs';
import { findImprint, roman } from './date-works.mjs';

export const IMPRINT_PROMPT_VERSION = 'titlepage-imprint-v1';
/**
 * v2 (2026-10-23, #7201): v1 rejected correct readings set in early-modern TYPE, not wrong ones — letter-spaced
 * capitals ("B A S I L E A E"), apostrophic numerals ("clɔ Iɔ CXIV" = 1614), spaced or I-for-1 digits ("I 5 7 9"),
 * and a title quoted by its first line only. Re-checking the stored replies needs no model call (`--recheck`).
 */
export const GUARD_VERSION = 'imprint-guard-v3';

/** Page types that never carry an imprint; skipped in image mode where a page's type is known. */
export const SKIP_IMAGE_TYPES = new Set(['blank', 'cover', 'binding', 'flyleaf', 'endpaper', 'colour-chart', 'color-chart', 'spine']);

const ROLES = ['author', 'editor', 'translator', 'commentator', 'printer', 'publisher', 'dedicatee', 'patron', 'respondent', 'illustrator', 'other'];

const PROMPT_CORE = `Report the IMPRINT of this book: what the book ITSELF states about its title, who made it, and when, where and by whom it was printed. Read across all the pages given.

Why several pages: many books carry a half-title (short title, no author), an engraved title and then the full letterpress title. Dedications and prefaces are usually SIGNED by the author. Incunabula and manuscripts may have no title page at all: the incipit or colophon is then the only statement there is.

FIELDS (each one null when the book does not state it — null is a NORMAL and CORRECT answer, far better than a guess):

- title: the main title as printed on the main title page, the first sentence or main words (at most ~25 words), original spelling.
- names: every PERSON the book names as making it, with the role the text's own grammar assigns:
    "author"      WROTE the work: Latin genitive ("Auli Gellii Noctium Atticarum libri"), "auctore X", "by X", "von X", "par X", or the signature of a dedication or preface.
    "editor"      corrected, emended, annotated, collected: "recognitus", "emendatus", "edited by", "herausgegeben von".
    "translator"  "interprete", "translated by", "traduit par", "übersetzt von", "tradotto da".
    "commentator" "cum commentariis X".
    "printer"     "apud X", "excudebat X", "typis X", "printed by X", "chez X", "gedruckt bey X".
    "publisher"   "impensis X", "sumptibus X", "printed for X", "verlegt von X", "se vend chez X".
    "dedicatee"   the work is dedicated TO them.   "patron" named in a privilege, licence or approbation.
    "respondent"  defends a disputation's theses under a presiding PRAESES; the praeses is the author.
    "illustrator", "other".
  An OFFICE or a PLACE is not a name ("Consiliario Aulico Hassiaco" is a post). IGNORE names inside quoted or cited matter: an epigraph, a scriptural proof-text, a reference to another book. A pseudonym printed on the page IS the author as the book gives it.
- date: the year THIS edition was printed, from the imprint or colophon. Give "as_printed" exactly ("M. D. XLIX.", "1672", "MDCCLXXXIII") and "year" as an integer in the Common Era. NOT a date in a privilege, approbation, licence or dedication, NOT a library stamp, bookplate, shelfmark, accession or handwritten note, NOT a sitter's age or life dates under a portrait, NOT a year mentioned in the title about events. If the year is in another calendar (Hijri, a reign era, Samvat), give the CE year and name the calendar in "calendar"; otherwise "calendar" is "CE".
- place: where it was printed or published, "as_printed" ("LVGDVNI", "Francofurti ad Moenum", "London") and "modern" in English ("Lyon", "Frankfurt am Main", "London").
- printer_publisher: the printer, publisher or bookseller of the imprint, "as_printed" ("Apud Ioan. Tornaesium", "Printed for J. Johnson").
- edition_statement: only an edition statement actually printed ("Editio secunda, auctior", "Third edition, revised", "Nunc primum in lucem edita"), else null.
- title_page: the page number of the main title page, or null when there is none.

Every non-null field carries "page" (the page number it is read from) and "quoted_line": the EXACT line as printed on THAT page, copied verbatim, original spelling and capitals. A field whose quoted line is not on the page it cites is discarded.`;

const TEXT_FRAME = `You are reading the OPENING LEAVES of a book, transcribed by OCR. Each page is labelled with its page number and the page type the transcriber assigned.\n\n`;
const IMAGE_FRAME = `You are looking at the OPENING LEAVES of a book as page IMAGES. Each image follows a label "PAGE n"; use that n as the page number. Some images are covers, bindings, blank leaves, bookplates, library stamps or colour charts: ignore those. Transcribe quoted lines from the image exactly as printed.\n\n`;

export function imprintPrompt(mode) {
  if (mode !== 'text' && mode !== 'image') throw new Error(`imprintPrompt: mode must be text|image, got ${mode}`);
  return (mode === 'image' ? IMAGE_FRAME : TEXT_FRAME) + PROMPT_CORE;
}

const cite = (extra = {}) => ({ type: 'OBJECT', nullable: true, properties: { ...extra, page: { type: 'INTEGER' }, quoted_line: { type: 'STRING' } }, required: [...Object.keys(extra), 'page', 'quoted_line'] });
/** Gemini responseSchema for the imprint reply. */
export const IMPRINT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: cite({ value: { type: 'STRING' } }),
    names: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name_nominative: { type: 'STRING' }, name_as_printed: { type: 'STRING' }, role: { type: 'STRING', enum: ROLES }, page: { type: 'INTEGER' }, quoted_line: { type: 'STRING' } }, required: ['name_nominative', 'name_as_printed', 'role', 'page', 'quoted_line'] } },
    date: cite({ as_printed: { type: 'STRING' }, year: { type: 'INTEGER' }, calendar: { type: 'STRING' } }),
    place: cite({ as_printed: { type: 'STRING' }, modern: { type: 'STRING' } }),
    printer_publisher: cite({ as_printed: { type: 'STRING' } }),
    edition_statement: cite({ as_printed: { type: 'STRING' } }),
    title_page: { type: 'INTEGER', nullable: true },
  },
  required: ['title', 'names', 'date', 'place', 'printer_publisher', 'edition_statement', 'title_page'],
};

/** The cited-field keys, in report order. `names` is handled per person. */
export const IMPRINT_FIELDS = ['title', 'date', 'place', 'printer_publisher', 'edition_statement'];

/**
 * Parse a model reply into the imprint shape. Tolerates a ```json fence and a missing key; anything that is not
 * an object is a parse failure, never an empty imprint (an empty imprint would read as "the page states nothing").
 */
export function parseImprintReply(text) {
  let t = String(text ?? '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let o;
  try { o = JSON.parse(t); } catch { return { parse_failed: true }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { parse_failed: true };
  const field = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  return {
    title: field(o.title),
    names: Array.isArray(o.names) ? o.names.filter((n) => n && typeof n === 'object') : [],
    date: field(o.date),
    place: field(o.place),
    printer_publisher: field(o.printer_publisher),
    edition_statement: field(o.edition_statement),
    title_page: Number.isInteger(o.title_page) ? o.title_page : null,
  };
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();

/**
 * A proposal must quote a line that is ACTUALLY ON THE PAGE. This is the guard that makes the provenance real
 * rather than decorative: a fabricated citation is the exact failure mode a "cite your evidence" instruction
 * invites, and checking it costs a substring test.
 */
export function quoteIsOnPage(quote, prose) {
  const q = norm(quote);
  if (q.length < 4) return false;
  return norm(prose).includes(q);
}

const latinShare = (x) => {
  const L = String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/\p{L}/gu) || [];
  return L.length ? L.filter((ch) => /[a-zA-Z]/.test(ch)).length / L.length : 0;
};

/**
 * Does the quoted line actually NAME the person it is cited for?
 *
 * The on-page check above proves the quote is real. It does not prove the quote is EVIDENCE. A line can be
 * verbatim from the page and still not mention the person: Francisco Hernández was cited to "Médico e
 * Historiador de Su Majestad Felipe II, Rey de España y de las Indias" — true text, no name in it. That is
 * worse than no citation, because it looks checkable.
 *
 * Returns true / false / null, and NULL IS NOT FALSE. The first cut of this check flagged 7 rows and 5 were
 * its own blindness, not bad citations — "Boetii" vs "Boethius" (th/t), "ABDALLAH BEN AHMED" vs "Abd Allah
 * ibn Ahmad" (transliteration), and a Devanagari quote that folds to nothing. Rejecting those would discard
 * correct evidence for being written in another script, which is the same mistake as reading an empty token
 * set as disagreement.
 */
export function quoteSupportsName(quote, name) {
  // Either side substantially non-Latin: fold() empties it, so abstain.
  if (latinShare(quote) < 0.6 || latinShare(name) < 0.6) return null;
  const q = foldOrtho(quote);
  const parts = foldOrtho(name).split(' ').filter((w) => w.length >= 4);
  if (!q || !parts.length) return null;
  // Letter-spaced type ("I O A N N I S"): compare with the spaces taken out.
  if (parts.some((p) => q.replace(/ /g, '').includes(p.slice(0, 4)))) return true;
  // A 4-char prefix absorbs declension and abbreviation without merging people:
  // "boethius" -> "boet" matches "opera boetii"; "allah" matches "abdallah".
  return parts.some((p) => q.includes(p.slice(0, 4)));
}

/**
 * Does the quoted line print the year proposed? Arabic or Roman figures, via date-works `findImprint`.
 * null when the model says it converted from another calendar: the line then legitimately does not print the
 * CE year, and only a person (or a calendar table) can judge it.
 */
export function quoteSupportsYear(quote, year, calendar) {
  if (!Number.isInteger(year)) return false;
  if (calendar && !/^(ce|ad|gregorian|julian|common era)$/i.test(String(calendar).trim())) return null;
  const q = String(quote ?? '').replace(/\n/g, ' ');
  if (findImprint(q, year)) return true;
  // Spaced and I/J-for-1 digits: "1 5 61", "I 5 7 9.", "J . 5 81".
  const digits = q.replace(/(?<![A-Za-z])[IJlі](?=[\s.]*\d)/g, '1').replace(/(\d)[\s.]+(?=\d)/g, '$1');
  if (new RegExp(`(?<!\\d)${year}(?!\\d)`).test(digits)) return true;
  // Apostrophic numerals: CIↃ (often OCR'd or typed "clɔ", "CIƆ", "cIↄ") = M, IↃ = D.
  const apos = q.replace(/[cC]\s*[Iil|1]\s*[ↃↄɔƆ)]/g, 'M').replace(/[Iil|1]\s*[ↃↄɔƆ)]/g, 'D');
  // findImprint's span is greedy across a following capital ("M.DC.LXXX. Cum privilegio" compacts to MDCLXXXC),
  // so also try every run of whole numeral tokens.
  const want = new Set([roman(year), roman(year).replace('CD', 'CCCC').replace('XC', 'LXXXX').replace('IV', 'IIII').replace('IX', 'VIIII')]);
  for (const text of [q, apos]) {
    if (text !== q && findImprint(text, year)) return true;
    const toks = text.split(/\s+/).map((t) => t.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, ''));
    for (let i = 0; i < toks.length; i++) {
      let acc = '';
      for (let j = i; j < toks.length && /^[MDCLXVIJmdclxvij.]+$/.test(toks[j]); j++) {
        acc += toks[j].toUpperCase().replace(/[^MDCLXVIJ]/g, '').replace(/J/g, 'I');
        if (want.has(acc)) return true;
      }
    }
  }
  return false;
}

/**
 * Does the quote carry the as-printed value? Half its words (≥3 letters) present; null for non-Latin.
 * Letter-spaced type ("B A S I L E A E") is compared with the spaces taken out. With `fragment` (titles), a quote
 * that is the title's first line passes too: most of the QUOTE's words must then be in the value.
 */
export function quoteCarriesValue(quote, value, { fragment = false } = {}) {
  const v = norm(value);
  if (!v) return false;
  if (latinShare(value) < 0.6) return norm(quote).includes(v) || norm(quote).replace(/ /g, '').includes(v.replace(/ /g, '')) ? true : null;
  const q = ` ${norm(quote)} `;
  const qSolid = q.replace(/ /g, '');
  const has = (w) => q.includes(w) || qSolid.includes(w);
  const words = v.split(' ').filter((w) => w.length >= 3);
  if (!words.length) return q.includes(` ${v} `) || qSolid.includes(v.replace(/ /g, ''));
  if (words.filter(has).length / words.length >= 0.5) return true;
  if (!fragment) return false;
  const vSolid = v.replace(/ /g, '');
  const qWords = norm(quote).split(' ').filter((w) => w.length >= 3);
  if (qWords.length) return qWords.filter((w) => v.includes(w)).length / qWords.length >= 0.8;
  // all one-letter tokens: letter-spaced type throughout
  const qs = qSolid.trim();
  return qs.length >= 4 && vSolid.includes(qs);
}

/**
 * Guard v3 (#7201): the wrong-date classes the by-eye labels of the first draw found, as checks on the QUOTE.
 *   bracketed_year   "[1728]", "(1499)", "Basileae, [1554]": brackets are a cataloguer's or a pencil's convention,
 *                    never the printer's (a digitiser's cover sheet, a library card, a handwritten note).
 *   day_month_date   "ad VII. d. Junii An. M DC LXXXI.", "Rome Id. Nouemb. M.cccc.lxxxiiii.": a day and a month
 *                    with no imprint word is the occasion inside an occasional title, or a dated dedication. A
 *                    colophon that dates to the day ("Impressum … die xx. Octobris") keeps its imprint word.
 * Returns the rejection reason or null.
 */
const MONTH = String.raw`(?:[ij]an(?:uar\w*)?|febr(?:uar\w*)?|mart(?:ii|ij|io|ius|is)?|m[äe]r[tz]z?|apr(?:il\w*)?|ma[ij](?:i|j|o|us|um)?|[ij][uv]n(?:ii|ij|io|ius|i|e)?|[ij][uv]l(?:ii|ij|io|ius|i|y)?|aug(?:usti|usto|ustus|ust)?|sept?(?:emb\w*)?|o[ck]t(?:ob\w*)?|no[uv](?:emb\w*)?|de[cz](?:emb\w*)?|march|jenner|hornung|janvier|f[eé]vrier|avril|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)(?![a-zà-ÿ])\.?`;
const DAY_MONTH = new RegExp(String.raw`(?:\b(?:\d{1,2}|[ivxl]{1,7})\.?\s*(?:d\.\s*|die\s+)?${MONTH}|\b${MONTH}\s+\d{1,2}\b|\b(?:kal|calend|kalend|non|nonis|id|idib|idus)[a-z]*\.?\s+${MONTH}|\bdie\s+(?:\d{1,2}|[ivxl]{1,7})\b)`, 'i');
const IMPRINT_WORD = /\b(?:apud|typis|typ\.|excud\w*|impress\w*|imprim\w*|gedruckt|druck\w*|printed|datum|data|geben|finit\w*|explicit\w*|chez|officina|aedibus|ædibus)\b/i;
export function dateQuoteFault(quote) {
  // ")(" is a printer's ornament round the year ("MUTINÆ, )( M. DC. XC. VIII. )("), not a bracket.
  const q = String(quote ?? '').replace(/\)\s*\(/g, ' ');
  if (/\[[^\]]*\]/.test(q) || /\(\s*[\dMDCLXVImdclxvi.,\s]{3,}\)/.test(q)) return 'bracketed_year';
  if (DAY_MONTH.test(q) && !IMPRINT_WORD.test(q)) return 'day_month_date';
  return null;
}

/** A Siku Quanshu cover label (四庫全書 子部 …) is the series, not the book's title (13 of 20 wrong titles, #7201). */
export const SERIES_LABEL = /四庫全書|四库全书/;

/**
 * The transcriber's own note that a page is mirrored show-through from the other side of the leaf. Three live
 * books carried an imprint invented on such a page (#7201 containment); nothing read from one is evidence.
 */
export function isShowThroughPage(prose) {
  return /<warning>[^<]*(?:mirror|bleed-?through|show-?through|ghosting)/i.test(String(prose ?? ''));
}

export const YEAR_MIN = 600;
export const YEAR_MAX = 2030;

/**
 * Apply the citation guards to one parsed reply.
 *
 * @param {object} parsed  parseImprintReply() output
 * @param {{ mode: 'text'|'image', pages: Map<number, string|null> }} ctx
 *   `pages`: every page the model was SHOWN, with its OCR prose in text mode (null in image mode).
 * @returns {{ fields: Record<string, object|null>, names: object[], rejected: object[], title_page: number|null }}
 *   Each kept field is the model's object plus `checks`; each rejected one is `{ field, reason, proposal }`.
 */
export function checkImprint(parsed, { mode, pages }) {
  const rejected = [];
  const fields = {};
  const shown = (p) => Number.isInteger(Number(p)) && pages.has(Number(p));

  const citation = (field, o) => {
    if (!shown(o.page)) return 'page_not_shown';
    if (norm(o.quoted_line).length < 4) return 'no_quote';
    if (mode === 'text' && isShowThroughPage(pages.get(Number(o.page)))) return 'show_through_page';
    if (mode === 'text') {
      if (!quoteIsOnPage(o.quoted_line, pages.get(Number(o.page)))) {
        const elsewhere = [...pages.values()].some((pr) => quoteIsOnPage(o.quoted_line, pr));
        return elsewhere ? 'quote_on_other_page' : 'quote_not_on_page';
      }
    }
    return null;
  };

  for (const f of IMPRINT_FIELDS) {
    const o = parsed[f];
    if (!o) { fields[f] = null; continue; }
    let reason = citation(f, o);
    const checks = {};
    if (!reason && f === 'date') {
      if (!Number.isInteger(o.year) || o.year < YEAR_MIN || o.year > YEAR_MAX) reason = 'implausible_year';
      else {
        checks.quote_has_year = quoteSupportsYear(o.quoted_line, o.year, o.calendar);
        if (checks.quote_has_year === false) reason = 'quote_lacks_year';
        else reason = dateQuoteFault(o.quoted_line);
      }
    }
    if (!reason && f === 'title' && (SERIES_LABEL.test(o.value ?? '') || SERIES_LABEL.test(o.quoted_line ?? ''))) reason = 'series_label';
    if (!reason && f !== 'date') {
      const val = f === 'title' ? o.value : o.as_printed;
      checks.quote_has_value = quoteCarriesValue(o.quoted_line, val, { fragment: f === 'title' });
      if (checks.quote_has_value === false) reason = 'quote_lacks_value';
    }
    if (reason) { rejected.push({ field: f, reason, proposal: o }); fields[f] = null; continue; }
    fields[f] = { ...o, page: Number(o.page), checks };
  }

  const names = [];
  for (const n of parsed.names ?? []) {
    let reason = citation('names', n);
    let supports = null;
    if (!reason) {
      supports = quoteSupportsName(n.quoted_line, n.name_nominative);
      if (supports === false) supports = quoteSupportsName(n.quoted_line, n.name_as_printed);
      if (supports === false) reason = 'quote_lacks_name';
    }
    if (reason) { rejected.push({ field: 'names', reason, proposal: n }); continue; }
    names.push({ ...n, role: String(n.role ?? '').toLowerCase(), page: Number(n.page), quote_supports_name: supports });
  }
  const tp = Number.isInteger(parsed.title_page) && pages.has(parsed.title_page) ? parsed.title_page : null;
  return { fields, names, rejected, title_page: tp };
}

/**
 * Image mode: which leaves to show. The first `max` pages in order, skipping any whose type says it cannot carry
 * an imprint. Scans-only pages are almost never typed, so in practice this is "the first `max` leaves"; the
 * model is told to ignore covers and blanks itself.
 */
export function imageWindow(pages, max = 8) {
  const byNum = [...pages].sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
  const out = [];
  for (const p of byNum) {
    const t = String(p.page_type ?? '').toLowerCase().trim();
    if (t && SKIP_IMAGE_TYPES.has(t)) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Ask an IIIF image server for a bounded rendition instead of the full master (BSB's `full/full` is ~4K px,
 * and its per-client budget is shared with the archivers). Non-IIIF URLs are returned unchanged.
 */
export function boundedImageUrl(url, px = 1600) {
  return String(url).replace(/\/full\/(full|max)\/0\/(default|native)\.(jpg|jpeg|png)$/i, `/full/!${px},${px}/0/$2.$3`);
}
