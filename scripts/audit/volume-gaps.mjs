#!/usr/bin/env node
/**
 * Volume-gap audit — find multivolume works where we hold some volumes but not all.
 *
 * There is NO volume field on `books`. Volume identity lives only inside the title
 * string, written inconsistently by whoever imported the book ("Vol. I (Bekker 1831)"
 * vs "Vol. 2 (Bekker Edition, Reimer 1831)"). So this script parses a volume number
 * out of the title, strips it to get a "base" title, clusters by (author + base), and
 * reports sequences with holes.
 *
 * READ THE LIMITS BEFORE TRUSTING THE OUTPUT — see LIMITS below. This is a lead
 * generator for a human, not a completeness proof. The durable fix is a real
 * `volume_number` + edition key written at import time (issue linked in the PR).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/audit/volume-gaps.mjs
 *   node scripts/audit/volume-gaps.mjs --limit=30
 *   node scripts/audit/volume-gaps.mjs --json=/tmp/volume-gaps.json
 *
 * LIMITS (all three produce silent false negatives):
 *  1. INTERIOR HOLES ONLY. Holding vols 1-3 of a 12-volume set reports zero gaps —
 *     the script has no idea the set has 12 volumes. Catching missing tails needs an
 *     external authority per series (IA metadata, Wikidata, USTC).
 *  2. INCONSISTENT TITLES HIDE SERIES. Volumes of one set whose titles disagree
 *     cluster separately and never form a series at all. The Bekker Aristotle is the
 *     worked example: five volumes held, zero detected.
 *  3. EDITION CONFLATION IS THE OPPOSITE FAILURE. Normalizing titles hard enough to
 *     fix (2) merges distinct editions of the same work into one fake complete set.
 *     This script deliberately keeps publisher/year tokens in the base title and so
 *     errs toward (2) — under-reporting, never inventing a gap that isn't there.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const args = process.argv.slice(2);
const getArg = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1] || null;
const LIMIT = parseInt(getArg('limit') || '60', 10);
const JSON_OUT = getArg('json');

const ROMAN = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
  xix: 19, xx: 20, xxi: 21, xxii: 22, xxiii: 23, xxiv: 24, xxv: 25,
  xxvi: 26, xxvii: 27, xxviii: 28, xxix: 29, xxx: 30,
};

/** Volume numbers above this are almost always parse noise (page numbers, dates). */
const MAX_PLAUSIBLE_VOLUME = 40;

function toNumber(token) {
  if (!token) return null;
  const t = String(token).trim().toLowerCase();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 && n <= 60 ? n : null;
  }
  return ROMAN[t] ?? null;
}

// Ordered, most specific first. Latin/German/French/Dutch/Italian volume words plus
// the bare trailing number catalogues use ("Aristotelis opera, quae extant omnia. 3").
const PATTERNS = [
  /\b(?:vol(?:ume)?s?)\.?\s*([ivxlcIVXLC]+|\d{1,2})\b/,
  /\b(?:tom(?:e|us|o)|tomi)\.?\s*([ivxlcIVXLC]+|\d{1,2})\b/,
  /\b(?:band|bd)\.?\s*([ivxlcIVXLC]+|\d{1,2})\b/,
  /\b(?:th?eil|teil|th)\.?\s*([ivxlcIVXLC]+|\d{1,2})\b/,
  /\b(?:deel|dl)\.?\s*([ivxlcIVXLC]+|\d{1,2})\b/,
  /\b(?:partie|part|pt)\.?\s*([ivxlcIVXLC]+|\d{1,2})\b/,
  /\b(?:libro|liber|lib)\.?\s*([ivxlcIVXLC]+|\d{1,2})\b/,
  /\bno\.?\s*(\d{1,2})\b/,
  /\bv\.\s*(\d{1,2})\b/,
  /[.,]\s*(\d{1,2})\s*$/,
];

const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function parseVolume(title) {
  if (!title) return null;
  for (const re of PATTERNS) {
    const m = title.match(re);
    if (!m) continue;
    const vol = toNumber(m[1]);
    if (vol == null) continue;
    const base = title.slice(0, m.index) + ' ' + title.slice(m.index + m[0].length);
    // Edition markers (publisher, year) stay in the base on purpose — see LIMITS (3).
    return { vol, base: normalize(base) };
  }
  return null;
}

/** `author` is an object on some books; normalize to a printable string. */
const authorLabel = (a) =>
  typeof a === 'string' ? a : a && typeof a === 'object' ? a.name || a.display_name || '' : '';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Text books only. Artwork records carry "…, 01 / …, 02" detail-image sequences that
// parse as volumes; `resource_type` present at all means artwork (see routing rule).
const cursor = db.collection('books').find(
  { resource_type: { $exists: false }, pages_count: { $gt: 20 } },
  {
    projection: {
      id: 1, title: 1, author: 1, author_id: 1, work_id: 1, pages_count: 1,
      pages_ocr: 1, visible: 1, 'image_source.provider': 1, ia_identifier: 1,
    },
  }
);

const series = new Map();
let scanned = 0;
let parsed = 0;

for await (const book of cursor) {
  scanned++;
  const p = parseVolume(book.title);
  if (!p || p.base.length < 8) continue;
  parsed++;
  const authorKey = book.author_id
    ? `A:${book.author_id}`
    : `a:${normalize(authorLabel(book.author)).slice(0, 40)}`;
  const key = `${authorKey}||${p.base.slice(0, 70)}`;
  if (!series.has(key)) series.set(key, []);
  series.get(key).push({ ...book, _vol: p.vol });
}

const multiVolume = [...series.values()].filter(
  (items) => new Set(items.map((i) => i._vol)).size >= 2
);

const gaps = [];
for (const [key, items] of series) {
  const vols = new Set(items.map((i) => i._vol));
  if (vols.size < 2) continue;
  const max = Math.max(...vols);
  if (max > MAX_PLAUSIBLE_VOLUME) continue;
  const missing = [];
  for (let n = 1; n <= max; n++) if (!vols.has(n)) missing.push(n);
  if (!missing.length) continue;
  gaps.push({ key, have: [...vols].sort((a, b) => a - b), missing, items });
}

// Most-complete series first — those are the cheapest to finish.
gaps.sort((a, b) => b.have.length - a.have.length || a.missing.length - b.missing.length);

console.log(
  `scanned ${scanned} text books; ${parsed} parsed a volume number; ` +
    `${multiVolume.length} multivolume series; ${gaps.length} with interior holes\n`
);

for (const g of gaps.slice(0, LIMIT)) {
  const [author, base] = g.key.split('||');
  const anyPublic = g.items.some((i) => i.visible);
  console.log(`— ${base}`);
  console.log(
    `   author=${authorLabel(g.items[0].author).slice(0, 45) || author} ` +
      `have=[${g.have.join(',')}] MISSING=[${g.missing.join(',')}] public=${anyPublic}`
  );
  for (const i of g.items.sort((a, b) => a._vol - b._vol)) {
    console.log(
      `     v${i._vol} ${i.id} ${i.visible ? '' : '(hidden) '}` +
        `${i.pages_ocr || 0}/${i.pages_count}pp ${i.title?.slice(0, 64)}`
    );
  }
  console.log('');
}

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      gaps.map((g) => ({
        key: g.key,
        have: g.have,
        missing: g.missing,
        books: g.items.map((i) => ({
          id: i.id, vol: i._vol, title: i.title, visible: !!i.visible,
          pages_count: i.pages_count, pages_ocr: i.pages_ocr || 0,
          ia_identifier: i.ia_identifier, provider: i.image_source?.provider,
        })),
      })),
      null,
      2
    )
  );
  console.log(`wrote ${JSON_OUT}`);
}

await client.close();
