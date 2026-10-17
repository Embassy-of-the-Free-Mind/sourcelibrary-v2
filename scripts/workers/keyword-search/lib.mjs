// Shared pieces of the keyword page service (#6852): paths, the Mongo client, and the tokenizer that the
// build, the delta and the query path must all run identically.
//
// PRIOR ART: github.com/JDerekLomas/sourcelibrary-atlas scripts/local-corpus/{index-fts,search,fuse-lib}.mjs
// — the same corpus in SQLite FTS5 on a laptop, with two tables (translation in unicode61, OCR in
// trigram) and English-only stopword dropping. That index answers a different question (a reader's
// local corpus), so it does not reproduce the Atlas page lane: trigram OCR scores substrings, and its
// unicode61 table folds diacritics, which `lucene.standard` does not. This file keeps its FTS5 choice
// and its lessons (quote every term; FTS5 has no stop list and bm25 scores every match) and copies
// the Atlas analyzer instead. scripts/workers/vector-search/lib.mjs is the layout this mirrors.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const ROOT = process.env.KEYWORD_SEARCH_ROOT || '/data/keyword-search';
export const SHARD_DIR = path.join(ROOT, 'shards');
export const INDEX_DIR = path.join(ROOT, 'index');
export const LOG_DIR = path.join(ROOT, 'logs');
export const DB_PATH = path.join(INDEX_DIR, 'keyword.sqlite');
export const STATE_PATH = path.join(INDEX_DIR, 'state.json');

/**
 * The Atlas lane's `$match` after `$search` (src/lib/atlas-search.ts NON_CONTENT_PAGE_TYPES). Kept here
 * as a copy because this directory is installed apart from the app; tests/unit/keyword-search-lib.test.ts
 * pins the two lists together.
 */
export const NON_CONTENT_PAGE_TYPES = ['blank', 'illustration', 'title-page', 'colophon', 'frontispiece', 'digitizer-insert'];

// ---------------------------------------------------------------------------------------------------
// Tokenizer: an approximation of Atlas `lucene.standard` (StandardTokenizer = UAX#29 words, then
// LowerCaseFilter; no stemming, no stop list, no diacritic folding — .claude/docs/search.md).
//
//  - A word is a run of letters, marks, digits and connector punctuation (`_`). An apostrophe or a
//    period BETWEEN two word characters joins them, as UAX#29's MidLetter/MidNumLet do: "Drebbel's"
//    is one token, as it is in Atlas, so "Drebbel" does not match it there either. A comma joins
//    only digits ("1,000").
//  - Han ideographs and Hiragana are one token per character, which is what StandardTokenizer emits
//    for them. Katakana, Hangul and Thai runs stay whole.
//  - Lowercase with toLowerCase(). (Lucene lowercases per code point, so a word-final capital sigma
//    becomes σ there and ς here. Page text is rarely in capitals.)
//
// FTS5 then sees the tokens joined by spaces under a unicode61 tokenizer whose token characters are
// every category except separators and controls, so it splits on the spaces this code put there and
// nowhere else, and the analyzer is defined in exactly one place: this function.
// ---------------------------------------------------------------------------------------------------
const W = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]';
const TOKEN_RE = new RegExp(`${W}+(?:(?:['’.:·]|,(?=\\p{N}))${W}+)*`, 'gu');
const SPLIT_CHARS_RE = /[\p{Script=Han}\p{Script=Hiragana}]/u;
const SPLIT_CHARS_G = /([\p{Script=Han}\p{Script=Hiragana}])/gu;

/** Lowercased tokens of `text`, in order. */
export function tokenize(text) {
  if (!text) return [];
  const out = [];
  for (const m of String(text).matchAll(TOKEN_RE)) {
    let t = m[0];
    // A comma survives only between digits; a trailing joiner never matches (the regex needs a word char after it).
    if (SPLIT_CHARS_RE.test(t)) {
      for (const part of t.split(SPLIT_CHARS_G)) if (part) out.push(part.toLowerCase());
    } else {
      out.push(t.toLowerCase());
    }
  }
  return out;
}

/** The string stored in the FTS5 table for a text: its tokens joined by single spaces. */
export const indexText = (text) => tokenize(text).join(' ');

/** FTS5 tokenizer spec: split on separators (Z*) and controls (C*) only; everything else is a token character. */
export const FTS_TOKENIZER = "unicode61 remove_diacritics 0 categories 'L* M* N* P* S* Co'";

/**
 * The index schema (build-fts.mjs creates it; the tests build a small copy with it). `pages` and `fts`
 * share rowids. `content` = 0 marks a NON_CONTENT_PAGE_TYPES page. `vocab` lists index terms for the
 * fuzzy expansion. `live_books` is the last live set the sync posted.
 */
export const SCHEMA_SQL = `
  CREATE TABLE books(idx INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE);
  CREATE TABLE pages(rowid INTEGER PRIMARY KEY, page_id TEXT NOT NULL, book INTEGER NOT NULL, page_number INTEGER NOT NULL, content INTEGER NOT NULL, u INTEGER NOT NULL);
  CREATE VIRTUAL TABLE fts USING fts5(tr, ocr, content='', contentless_delete=1, detail=full, tokenize="${FTS_TOKENIZER}");
  CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE live_books(id TEXT PRIMARY KEY);
  CREATE VIRTUAL TABLE vocab USING fts5vocab(fts, 'row');`;
/** Created after the bulk load (cheaper than maintaining them row by row). */
export const SCHEMA_INDEXES_SQL = 'CREATE UNIQUE INDEX pages_page_id ON pages(page_id); CREATE INDEX pages_book ON pages(book);';

// ---------------------------------------------------------------------------------------------------
// Query side: the Atlas lane's query shapes (buildPageSearchStage) as FTS5 MATCH strings.
// ---------------------------------------------------------------------------------------------------

/** A token as an FTS5 string literal. Tokens never hold spaces; a double quote is doubled. */
const lit = (t) => `"${t.replace(/"/g, '""')}"`;

/**
 * Function words dropped from an unquoted query that has other words (fuse-lib.mjs's lesson: FTS5 has
 * no stop list and bm25 scores every page that matches, so "the" alone means reading every page).
 * Atlas keeps them, but in a corpus where they print on nearly every page their IDF is ~0, so they move
 * the BM25 order very little; the parity eval measures what it costs. The book lane's list
 * (src/lib/search/page-rollup.ts STOPWORDS) plus the English auxiliaries.
 */
export const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'der', 'des', 'di', 'du', 'el', 'en', 'et', 'for', 'from', 'in', 'la', 'le', 'les', 'of', 'on', 'or', 'the', 'to', 'und', 'von', 'with',
  'is', 'are', 'was', 'were', 'be', 'that', 'this', 'it', 'its', 'as', 'into', 'his', 'her', 'their', 'which', 'what', 'how', 'do', 'does', 'not', 'but', 'he', 'she', 'they', 'we', 'i', 'you', 'qui', 'que', 'il', 'die', 'das', 'ist']);

/** Detect the lane's quoted-phrase form, `"…"` around the whole query. */
export function parseQuery(query) {
  const q = String(query || '').trim();
  const isPhrase = /^".*"$/.test(q);
  return { isPhrase, text: isPhrase ? q.slice(1, -1) : q };
}

/**
 * Terms of an unquoted query, stopwords dropped when anything else is left. Duplicates collapse (Lucene
 * would count a repeated word twice; one copy is what a reader means).
 */
export function queryTerms(text, { keepStopwords = false } = {}) {
  const toks = [...new Set(tokenize(text))];
  if (keepStopwords) return toks;
  const kept = toks.filter((t) => !STOPWORDS.has(t));
  return kept.length > 0 ? kept : toks;
}

/** `"a" OR "b" OR …` — Atlas `text` with several words matches ANY of them. */
export const anyOf = (terms) => terms.map(lit).join(' OR ');
/** One FTS5 phrase over the tokens of `text` (Atlas `phrase`: the tokens adjacent and in order). */
export const phraseOf = (text) => { const t = tokenize(text); return t.length ? `"${t.map((x) => x.replace(/"/g, '""')).join(' ')}"` : null; };

/**
 * Atlas fuzzy for a one-word query of 6+ characters: maxEdits 1, prefixLength 4. FTS5 has no fuzzy, so
 * the caller expands the word against the index vocabulary; this is the edit-distance test it uses
 * (Levenshtein ≤ 1 with an adjacent transposition counted as one edit, Lucene's default).
 */
export function withinOneEdit(a, b) {
  const A = [...a], B = [...b]; // code points, so an astral character is one edit
  const la = A.length, lb = B.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0; while (i < la && i < lb && A[i] === B[i]) i++;
  if (i === la && i === lb) return true;
  const rest = (X, from) => X.slice(from).join('');
  if (la === lb) {
    if (rest(A, i + 1) === rest(B, i + 1)) return true;                                   // substitution
    return A[i] === B[i + 1] && A[i + 1] === B[i] && rest(A, i + 2) === rest(B, i + 2);  // transposition
  }
  return la > lb ? rest(A, i + 1) === rest(B, i) : rest(A, i) === rest(B, i + 1);        // deletion / insertion
}
export const FUZZY_MIN_LEN = 6;
export const FUZZY_PREFIX = 4;
/** Atlas `fuzzy.maxExpansions` default. */
export const FUZZY_MAX_EXPANSIONS = 50;

// ---------------------------------------------------------------------------------------------------
// Mongo + small helpers
// ---------------------------------------------------------------------------------------------------

/**
 * Read-only Mongo client with zlib wire compression: page text is the bulk of every byte this service
 * reads, and compression cuts Atlas egress 3.5–14× for text (measured for the dump tooling).
 */
export async function mongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set (run with node --env-file=/root/sourcelibrary/.env.production.local)');
  let mod;
  try { mod = require('mongodb'); } catch { mod = createRequire('/root/sourcelibrary/package.json')('mongodb'); }
  const client = new mod.MongoClient(uri, { compressors: ['zlib'], zlibCompressionLevel: 6, maxPoolSize: 16, readPreference: 'secondaryPreferred' });
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
}

export function readState() {
  return fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : null;
}

/** tmp + rename: state.json is the commit point, so it is never half-written. */
export function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

export const log = (...a) => console.log(new Date().toISOString(), ...a);

/** The page fields every reader of `pages` here projects. */
export const PAGE_PROJECTION = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'translation.data': 1, 'ocr.data': 1, 'translation.updated_at': 1, 'ocr.updated_at': 1 };

/** A page document → the row this service stores, or null when it has nothing the Atlas lane can match. */
export function pageRow(p) {
  const tr = p.translation?.data || '';
  const ocr = p.ocr?.data || '';
  if (!(p.page_number > 0) || (!tr && !ocr) || !p.id || !p.book_id) return null;
  const tu = p.translation?.updated_at ? +new Date(p.translation.updated_at) : 0;
  const ou = p.ocr?.updated_at ? +new Date(p.ocr.updated_at) : 0;
  return { i: String(p.id), b: String(p.book_id), n: p.page_number, t: p.page_type || '', tr, o: ocr, u: Math.max(tu, ou) || 0 };
}
