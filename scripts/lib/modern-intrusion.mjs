// PRIOR ART: scripts/audit/detect-fabricated-translation.mjs (#4584 — a translation that asserts
// content for a region the OCR declined; non-Latin scripts only, keyed on bracket placeholders) and
// scripts/audit/detect-fabricated-ocr.mjs (#4149 — OCR invented for a BLANK leaf, read from the
// image). Neither can see this class: fluent modern English on a page with a real transcription,
// e.g. a 2011 nephrology journal's table of contents as the "translation" of a 1657 Latin dialogue.
//
// modern-intrusion — does a page's English contain text that cannot belong to a book of its date?
// (#4960)
//
// `quality_score` scored the Kircher book carrying that page 100, and the page was one deposit from
// a permanent DOI. This is the screen that was missing. It is a GATE input, not an authority: a hit
// means "a person reads this page before anything permanent happens", never "rewrite it".
//
// ── Four false detectors came before this one (all from the #4960 session) ────────────────────
//   `I cannot`          214/352 books — ordinary prose ("I cannot fail to be greatly delighted").
//   `\b20[0-2]\d\b`     logarithm-table values (2000, 2017, 2061) in the Rudolphine Tables.
//   `as an AI`          inside "as an aid"; and, word-boundaried but case-blind, Marcgrave's
//                       "The Ai, or the Sloth" (Historia naturalis Brasiliae p.366).
//   `https?://`         Internet Archive / Google digitizer notices — real text on a real leaf.
// And two found re-measuring the issue's own table on 2026-10-13: "peer-reviewed" and "clinical
// trials" appeared ONLY inside the model's <summary> paraphrase (Weyer, Ficino, Mattioli, Kircher's
// Prodromus), and "Journal of the American…" in Bibliographia Kabbalistica (1927) is a genuine
// citation of JAOS 36 (1916). Of the issue's eight books, one was real.
//
// So the rules here are:
//   1. Match the BODY only: apparatus the model writes ABOUT the page (<summary>, <keywords>, <meta>,
//      <vocab>, <note>, <gloss>, …) is stripped. Modern words there are paraphrase or a translator's
//      comparison ("a very early proposal for what we would now call a randomized controlled trial",
//      Mesmer 1781; "N. N. … similar to Jane Doe", Theater of Witches), not a fabricated leaf. The
//      first corpus run (3,000 books, 2026-10-13) had 14 such false positives out of 15 pages.
//   2. Every marker carries the year it could first appear in print, and fires only on a book
//      published BEFORE that year. A 1927 bibliography may cite a journal; a 1657 dialogue may not.
//   3. No placeholder-name marker: Pepys (1893) really mentions "Dr. John Smith's foundation".
//   4. Markers are word-boundaried and, where case carries the meaning (AI vs Ai), case-sensitive.
// The positive control (Kircher p.170) and every false-positive family above are fixtures in
// tests/unit/modern-intrusion.test.ts; a change that breaks one is a regression.

/** Tags whose content is model apparatus about the page, not the page's text. */
const APPARATUS = /<(summary|keywords|meta|note|gloss|vocab|language|lang|scan-quality|script|page-type|columns|warning|image-desc|detected-images|header|sig|page-num)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Markers: [name, regex, first year it can appear in print]. A marker fires only when the book's
 * publication year is before `since` (or unknown). Keep each one narrow enough that it names a
 * thing, not a register: the chatbot-reply family, and the modern biomedical vocabulary the
 * observed fabrication was made of.
 */
export const MARKERS = [
  // A model talking about itself.
  ['as-an-ai', /\bas an AI\b/, 1960],
  ['language-model', /\b(?:AI|large|an?) language model\b/i, 2000],
  ['knowledge-cutoff', /\bknowledge cut-?off\b/i, 2000],
  // Must name the task: Casanova's "I am sorry, but I cannot; tell them the truth" is dialogue.
  ['assistant-apology', /\bI(?:'m| am) sorry, but I (?:can(?:no|')t|am unable to) (?:assist|help with|provide|transcribe|translate|fulfil+|comply)\b/, 2000],
  // Modern scholarly / biomedical vocabulary (the #4960 Kircher page).
  ['nephrology', /\bnephrology\b/i, 1960],
  ['randomized-trial', /\brandomi[sz]ed,?\s+(?:double-blind,?\s+)?(?:placebo-)?controlled\b/i, 1948],
  // No `clinical trial` marker: translators render Greek peira / Latin experimentum that way
  // (Galen vol. 8 p.53, Philostratus p.586, Mesmer) — an anachronistic word, not an invented leaf.
  ['peer-reviewed', /\bpeer[- ]reviewed\b/i, 1960],
  ['type-2-diabetes', /\btype (?:2|II) diabetes\b/i, 1979],
  ['microbiome', /\bmicrobiome\b/i, 1990],
  ['gene-symbol', /\b(?:SGLT2|APOL1|BRCA[12]|mRNA|CRISPR)\b/, 1960],
];

/** Body text a reader is served, with the model's apparatus about the page removed. */
export function intrusionBody(text) {
  return String(text || '').replace(APPARATUS, ' ');
}

/** First 4-digit year in a `published` value ("1657", "c. 1563", 1927); null if none. */
export function bookYear(published) {
  const m = String(published ?? '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Markers that fire on one page's English for a book of `year` (null = unknown date, every marker
 * applies). Returns [] for a clean page; otherwise [{ marker, match, context }].
 */
export function findModernIntrusions(text, year) {
  const body = intrusionBody(text);
  const hits = [];
  for (const [marker, re, since] of MARKERS) {
    if (year != null && year >= since) continue;
    const m = body.match(re);
    if (!m) continue;
    const at = m.index ?? 0;
    hits.push({ marker, match: m[0], context: body.slice(Math.max(0, at - 80), at + m[0].length + 80).replace(/\s+/g, ' ').trim() });
  }
  return hits;
}

/**
 * Screen a book's pages. `pages` are page documents ({ page_number, translation: { data } }).
 * Returns [{ page_number, hits }] for every page with at least one hit.
 */
export function screenBookPages(book, pages) {
  const year = bookYear(book?.published);
  const out = [];
  for (const p of pages || []) {
    const hits = findModernIntrusions(p?.translation?.data, year);
    if (hits.length) out.push({ page_number: p.page_number, hits });
  }
  return out;
}
