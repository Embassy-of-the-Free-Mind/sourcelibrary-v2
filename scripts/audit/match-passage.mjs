#!/usr/bin/env node
/**
 * PRIOR ART: src/lib/atlas-search.ts buildPageSearchStage (the reader's keyword search: ranks pages
 * for a query, never says whether a passage IS ours), /api/search/semantic (finds the same content in
 * any book, so it cannot tell our translation from someone else's: #8150 slice 9 measured that),
 * scripts/audit/decode-provenance.ts (reads the zero-width mark, which a copier strips in one regex).
 * None answers "is this passage our translation, and of which page?" once the mark is gone.
 *
 * match-passage — is this English passage one of OUR translations, and which page? (#8150 slice 9)
 *
 * The zero-width mark is gone after one regex. What survives a strip, a Unicode normalisation, a
 * reflow and most excerpts is the wording itself: our translations are our own, so a long run of
 * the same words, in order, is evidence the text came from us. The mark says so with a key; this says
 * so with the corpus.
 *
 * Method. Normalise (strip zero-width and tags, NFKC, lower case, letters and digits only), take a few
 * 7-word probes spread across the passage, phrase-search each on the field the Atlas `pages_search`
 * index maps (the raw translation: the one direct read, and the reason this file is in the
 * translation-data-readers baseline), and score every candidate page by containment: the share of the passage's 5-word
 * shingles found in that page's words (getTranslationText). A verdict needs containment >= MIN_CONTAINMENT and a book whose text
 * is a translation (not English: the English "translation" of an English book is its own text, and
 * public domain). Thresholds were set on the slice 9 false-positive set (independent public-domain
 * translations of works we hold, and unrelated English), not on the positives.
 *
 * What it cannot do, stated: a paraphrase or a translation into another language leaves few shared
 * runs, and this matcher then says nothing (it does not guess). It is a corpus lookup, so a passage
 * from a page translated after the text was taken is still found, and a page re-translated since is not.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/match-passage.mjs < passage.txt
 *   import { matchPassage } from './match-passage.mjs'   // (db, text) -> verdict
 */
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'url';
import { getTranslationText } from '../lib/translation-text.mjs';

export const SHINGLE = 5;
export const PROBE_WORDS = 7;
export const MAX_PROBES = 4;
export const MIN_CONTAINMENT = 0.25;
export const MIN_SHINGLES = 8; // under ~12 words a passage proves nothing either way

const ZW = /[​-‏⁠-⁤﻿]/g;

export function words(text) {
  return String(text || '')
    .replace(ZW, '')
    .replace(/<[^>]{1,40}>/g, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function shingles(ws, n = SHINGLE) {
  const s = new Set();
  for (let i = 0; i + n <= ws.length; i++) s.add(ws.slice(i, i + n).join(' '));
  return s;
}

/** Probes spread across the passage, each the 7-word window with the most long words near its slot. */
function probes(ws) {
  if (ws.length < PROBE_WORDS) return [];
  const slots = Math.min(MAX_PROBES, Math.max(1, Math.floor(ws.length / (PROBE_WORDS * 2))));
  const out = [];
  for (let s = 0; s < slots; s++) {
    const lo = Math.floor((s * (ws.length - PROBE_WORDS)) / slots);
    const hi = Math.min(ws.length - PROBE_WORDS, lo + PROBE_WORDS * 2);
    let best = lo, bestScore = -1;
    for (let i = lo; i <= hi; i++) {
      const sc = ws.slice(i, i + PROBE_WORDS).filter((w) => w.length >= 5).length;
      if (sc > bestScore) { best = i; bestScore = sc; }
    }
    out.push(ws.slice(best, best + PROBE_WORDS).join(' '));
  }
  return [...new Set(out)];
}

/**
 * @returns {{ours: boolean, book_id: string|null, page_number: number|null, containment: number,
 *   shingles: number, probes: number, candidates: number, reason: string}}
 */
export async function matchPassage(db, text) {
  const ws = words(text);
  const qs = shingles(ws);
  const base = { ours: false, book_id: null, page_number: null, containment: 0, shingles: qs.size, probes: 0, candidates: 0 };
  if (qs.size < MIN_SHINGLES) return { ...base, reason: 'too short' };
  const ps = probes(ws);
  const pages = db.collection('pages');
  const seen = new Map();
  for (const p of ps) {
    const hits = await pages.aggregate([
      { $search: { index: 'pages_search', phrase: { query: p, path: 'translation.data' } } },
      { $limit: 8 },
      { $project: { _id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1 } },
    ], { maxTimeMS: 20_000 }).toArray();
    for (const h of hits) if (!seen.has(String(h._id))) seen.set(String(h._id), h);
  }
  let best = null;
  for (const h of seen.values()) {
    const cs = shingles(words(getTranslationText(h)));
    let hit = 0;
    for (const s of qs) if (cs.has(s)) hit++;
    const c = hit / qs.size;
    if (!best || c > best.c) best = { h, c };
  }
  const res = { ...base, probes: ps.length, candidates: seen.size };
  if (!best) return { ...res, reason: 'no candidate' };
  // `language` is the EDITION's language (language-fields.md): an English edition of a Latin work
  // printed its own English, so its "translation" is the printer's words, not ours.
  const book = await db.collection('books').findOne(
    { $or: [{ id: best.h.book_id }, { _id: best.h.book_id }] },
    { projection: { language: 1 } },
  );
  const lang = String(book?.language || '').toLowerCase();
  const translated = !!lang && !/^(en|eng|english)\b/.test(lang);
  // And the words must not be on the printed page: a bilingual edition, or a page in English inside
  // a Latin book, carries the passage in its OCR too, which makes it the source's text, not ours.
  const os = shingles(words(best.h.ocr?.data));
  let inOcr = 0;
  for (const s of qs) if (os.has(s)) inOcr++;
  const ocrContainment = Math.round((inOcr / qs.size) * 1000) / 1000;
  const out = { ...res, book_id: String(best.h.book_id), page_number: best.h.page_number, containment: Math.round(best.c * 1000) / 1000, ocr_containment: ocrContainment };
  if (!translated) return { ...out, reason: 'matched an English edition: its text is not our translation' };
  if (ocrContainment >= best.c / 2) return { ...out, reason: 'the words are on the printed page (OCR): not our translation' };
  if (best.c < MIN_CONTAINMENT) return { ...out, reason: 'below containment threshold' };
  return { ...out, ours: true, reason: 'our translation' };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    console.log(JSON.stringify(await matchPassage(client.db(process.env.MONGODB_DB || 'bookstore'), Buffer.concat(chunks).toString('utf8')), null, 2));
  } finally { await client.close(); }
}
