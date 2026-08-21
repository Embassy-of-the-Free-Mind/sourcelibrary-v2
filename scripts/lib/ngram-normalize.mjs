// Ngram tokenizer + orthographic normalizer — canonical copy for batch scripts.
// TS twin: src/lib/ngram-normalize.ts (used by /api/ngrams to normalize query
// terms). The twins MUST stay identical — the build writes ngram keys with this
// code and the API looks keys up with the twin, so any drift silently breaks
// lookups. tests/unit/ngram-normalize.test.ts pins parity on shared fixtures.
//
// Normalization philosophy: fold the variation that makes the SAME word look
// different across early-modern printings (long s, ligatures, u/v and i/j in
// Latin, polytonic accents in Greek, line-break hyphenation), and nothing more.
// Both the indexed text and the user's query pass through the same pipeline, so
// a reader can type "verbum" or "уerbum"-era spellings and land on one series.

/** Corpora the viewer exposes. `en` is the cross-language corpus: every page's
 * English translation (plus original OCR of English-language books that have no
 * modernized layer), keyed by the edition's publication year. The rest are
 * original-language corpora keyed off books.language. v1 is whitespace-delimited
 * scripts only — Tibetan/Chinese/Sanskrit need segmentation work (issue #3175). */
export const NGRAM_CORPORA = [
  { id: 'en', label: 'English — all works (via translation)' },
  { id: 'la', label: 'Latin (originals)' },
  { id: 'de', label: 'German (originals)' },
  { id: 'el', label: 'Greek (originals)' },
  { id: 'fr', label: 'French (originals)' },
  { id: 'en-orig', label: 'English (original spelling)' },
  { id: 'it', label: 'Italian (originals)' },
  { id: 'nl', label: 'Dutch (originals)' },
  { id: 'ru', label: 'Russian (originals)' },
  { id: 'es', label: 'Spanish (originals)' },
  { id: 'pt', label: 'Portuguese (originals)' },
  { id: 'he', label: 'Hebrew (originals)' },
];

/** books.language (lowercased) → original-language corpus id. */
export const ORIGINAL_LANGUAGE_CORPUS = {
  latin: 'la',
  english: 'en-orig',
  german: 'de',
  greek: 'el',
  'ancient greek': 'el',
  french: 'fr',
  italian: 'it',
  dutch: 'nl',
  russian: 'ru',
  spanish: 'es',
  portuguese: 'pt',
  hebrew: 'he',
};

export const MAX_NGRAM_N = 3;
const MAX_TOKEN_LEN = 40;

const LIGATURES = [
  [/ſ/g, 's'], [/æ/g, 'ae'], [/œ/g, 'oe'],
  [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'], [/ﬀ/g, 'ff'], [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'],
  [/ﬅ/g, 'st'], [/ﬆ/g, 'st'],
];

/** Drop repetitive page-apparatus tags CONTENT AND ALL before counting: running
 * headers, signature marks, catchwords, and printed page numbers repeat on every
 * page, so counting them would swamp real prose frequencies (a book's title as
 * running header = pages_count spurious hits). These are real printed text —
 * fine to *quote*, wrong to *count*. Inline gloss tags (note/term/margin/gloss/
 * unclear/insert) are body text: strip only the tag, keep the content. */
export function stripApparatusTags(text) {
  if (!text) return '';
  return text
    .replace(/<(header|catchword|sig|page-num)>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/**
 * Text → normalized tokens for ngram counting/lookup.
 * @param {string} text
 * @param {string} corpus corpus id from NGRAM_CORPORA
 * @returns {string[]}
 */
export function tokenize(text, corpus) {
  if (!text) return [];
  let t = text
    .replace(/­/g, '') // soft hyphens
    // Re-join words hyphenated across a line break ("philo-\nsopher").
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(?=\p{L})/gu, '$1')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’‘ʼ`´]/g, "'");
  for (const [re, sub] of LIGATURES) t = t.replace(re, sub);
  if (corpus === 'la') {
    // Classical convention: fold diacritics (ā→a) and the u/v, i/j pairs that
    // early printers used interchangeably (VNIVERSVM ~ universum, ejus ~ eius).
    t = t.normalize('NFD').replace(/\p{M}+/gu, '').replace(/v/g, 'u').replace(/j/g, 'i');
  } else if (corpus === 'el') {
    // Polytonic → base letters; final sigma folded so λόγος ~ λογοσ match.
    t = t.normalize('NFD').replace(/\p{M}+/gu, '').replace(/ς/g, 'σ');
  }
  const matches = t.match(/\p{L}[\p{L}'-]*/gu);
  if (!matches) return [];
  const out = [];
  for (let tok of matches) {
    tok = tok.replace(/['-]+$/g, '');
    if (!tok || tok.length > MAX_TOKEN_LEN) continue;
    out.push(tok);
  }
  return out;
}

/** Normalize a user-typed phrase to its ngram key ("The Philosopher's  Stone"
 * → "the philosopher's stone"). Returns '' if nothing tokenizable remains. */
export function normalizePhrase(phrase, corpus) {
  return tokenize(phrase, corpus).join(' ');
}
