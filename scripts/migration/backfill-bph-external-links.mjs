#!/usr/bin/env node
/**
 * Backfill bph_works.sl_external_book_id / sl_external_slug / sl_external_source
 * for BPH-held works that were digitised by another archive (IA, CMC Kloss,
 * MDZ, Gallica, e-rara, etc.) — i.e. Mongo books with held_by:'bph' AND
 * image_source.provider !== 'bph'.
 *
 * The catalogue UI uses these columns to surface a "Read at [Source]" link
 * on rows where BPH has no native digitisation. They are deliberately kept
 * separate from sl_book_id so existing "BPH digitised" counters and filters
 * don't change.
 *
 * Match logic: title+author+year fuzzy match, ported from
 * scripts/migration/backfill-held-by-fuzzy.mjs (PR #1324). The threshold and
 * short-title guards are intentionally identical, so the set of rows that
 * gain an external link mirrors the set of Mongo books that gained held_by:'bph'.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/backfill-bph-external-links.mjs            # Dry run
 *   node scripts/migration/backfill-bph-external-links.mjs --apply    # Write
 *   node scripts/migration/backfill-bph-external-links.mjs --threshold 0.7
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = !process.argv.includes('--apply');
const thresholdIdx = process.argv.indexOf('--threshold');
const THRESHOLD = thresholdIdx >= 0 ? parseFloat(process.argv[thresholdIdx + 1]) : 0.6;
const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing MONGODB_URI / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ── Fuzzy matching (lifted from backfill-held-by-fuzzy.mjs) ─────────
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wordsA = new Set(na.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / (wordsA.size + wordsB.size - overlap);
}

function authorMatch(bookAuthor, bphAuthor) {
  if (!bookAuthor || !bphAuthor) return true;
  const na = normalize(bookAuthor);
  const nb = normalize(bphAuthor);
  if (na.includes(nb) || nb.includes(na)) return true;
  const lastA = na.split(' ').pop();
  const lastB = nb.split(' ').pop();
  return lastA === lastB;
}

function findBestMatch(book, bphResults) {
  let bestMatch = null;
  let bestScore = 0;
  for (const bph of bphResults) {
    let score = titleSimilarity(book.title, bph.title);
    if (authorMatch(book.author, bph.author)) score += 0.1;
    else score -= 0.3;
    const bookYear = book.year ?? parseYear(book.published);
    if (bookYear && bph.year) {
      const yearDiff = Math.abs(bookYear - bph.year);
      if (yearDiff === 0) score += 0.1;
      else if (yearDiff <= 5) score += 0.05;
      else if (yearDiff > 20) score -= 0.2;
    }
    if (score > bestScore) { bestScore = score; bestMatch = { bph, score }; }
  }
  if (!bestMatch || bestScore < THRESHOLD) return null;
  const minLen = Math.min(normalize(book.title).length, normalize(bestMatch.bph.title).length);
  if (bestScore < 0.9 && minLen < 15) return null;
  if (bestScore < 1.0 && minLen < 10) return null;
  return bestMatch;
}

function parseYear(s) {
  if (!s) return null;
  const m = String(s).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

function buildIndex(bphWorks) {
  const index = new Map();
  for (const bph of bphWorks) {
    const words = normalize(bph.title).split(' ').filter(w => w.length > 3);
    for (const w of words) {
      if (!index.has(w)) index.set(w, []);
      index.get(w).push(bph);
    }
  }
  return index;
}

function getCandidates(book, index) {
  const words = normalize(book.title).split(' ').filter(w => w.length > 3).slice(0, 4);
  const seen = new Set();
  const candidates = [];
  for (const w of words) {
    for (const e of index.get(w) || []) {
      if (!seen.has(e.ubn)) { seen.add(e.ubn); candidates.push(e); }
    }
  }
  return candidates;
}

// ── Supabase helpers ────────────────────────────────────────────────
const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function loadCatalog() {
  const all = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/bph_works?select=ubn,title,author,year,sl_book_id,sl_external_book_id&order=ubn&offset=${offset}&limit=1000`;
    const res = await fetch(url, { headers: sbHeaders });
    if (!res.ok) {
      const body = await res.text();
      if (body.includes('sl_external_book_id') && body.includes('does not exist')) {
        console.error('\nERROR: sl_external_book_id column missing.');
        console.error('Apply scripts/migration/add-bph-external-links.sql first.\n');
        process.exit(2);
      }
      throw new Error(`Supabase load failed: ${res.status} ${body}`);
    }
    const data = await res.json();
    if (!data.length) break;
    all.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

async function patchExternalLink(ubn, payload) {
  const url = `${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(ubn)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PATCH ubn=${ubn}: ${res.status} ${await res.text()}`);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BPH cross-provider external link backfill ===');
  console.log(`Mode      : ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Threshold : ${THRESHOLD}`);

  console.log('\nLoading BPH catalog from Supabase...');
  const catalog = await loadCatalog();
  console.log(`Loaded ${catalog.length} catalog rows`);

  const index = buildIndex(catalog);
  console.log(`Built word index: ${index.size} words`);

  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  // The candidate set: books we've already classified as BPH-held but that
  // came from another archive's scans. These are the rows produced by PR #1324.
  // We deliberately skip image_source.provider:'bph' here — those go through
  // the existing sync-bph-sl-book-ids cron via UBN match.
  const candidates = await db.collection('books').find(
    {
      held_by: 'bph',
      'image_source.provider': { $ne: 'bph' },
      visible: true,
      pages_count: { $gt: 0 },
      bph_catalog_link: { $ne: false },
    },
    {
      projection: {
        id: 1, _id: 1, slug: 1, title: 1, author: 1, year: 1, published: 1,
        'image_source.provider': 1,
      },
    },
  ).toArray();
  console.log(`\nCandidate Mongo books (cross-provider, BPH-held): ${candidates.length}`);

  const matches = [];
  let collidesWithBphScan = 0;
  let alreadyLinked = 0;
  for (const book of candidates) {
    const cands = getCandidates(book, index);
    if (!cands.length) continue;
    const match = findBestMatch(book, cands);
    if (!match) continue;
    // Don't overwrite a row that already has a BPH-native scan — that's a
    // stronger claim than "also held by BPH." Leave sl_book_id alone.
    if (match.bph.sl_book_id) { collidesWithBphScan++; continue; }
    // Skip rows where this exact external link is already set.
    if (match.bph.sl_external_book_id === book.id) { alreadyLinked++; continue; }
    matches.push({
      ubn: match.bph.ubn,
      bphTitle: match.bph.title,
      bphYear: match.bph.year,
      book,
      source: book.image_source?.provider || 'unknown',
      score: match.score,
    });
  }

  // Volume-mismatch guard: many works in the BPH catalog are multi-volume,
  // and a Mongo book labelled "Vol II" / "II" / "Band 2" / "Teil 3" should
  // NOT be linked to the catalog row for volume I. We strip volume markers
  // when comparing the *base* title (so volumes still match each other when
  // both sides carry the marker), then reject the match if exactly one side
  // claims a volume number and the other doesn't, or if both do but differ.
  function extractVolume(t) {
    if (!t) return null;
    const s = String(t);
    // Arabic: "Vol 2", "Volume 3", "Band 4", "Teil 5", "Part 6", "Deel 7"
    let m = s.match(/\b(?:vol|volume|band|teil|part|deel|tome|tomo|tom)\.?\s*(\d{1,3})\b/i);
    if (m) return parseInt(m[1], 10);
    // Roman at end after a dot/space: "... II", "... III", "... IV"
    m = s.match(/(?:[.\s])(I{2,3}|IV|VI{0,3}|IX|XI{0,3}|XIV?|XV)\.?\s*$/);
    if (m) return romanToInt(m[1]);
    // Bare arabic at end: "... 2" — only if title has multiple words to
    // avoid catching years (already filtered by length) and identifier rows.
    m = s.match(/[^\d]\s+(\d{1,2})\.?\s*$/);
    if (m && s.split(/\s+/).length > 2) return parseInt(m[1], 10);
    return null;
  }
  function romanToInt(r) {
    const map = { I: 1, V: 5, X: 10, L: 50 };
    let n = 0, prev = 0;
    for (let i = r.length - 1; i >= 0; i--) {
      const v = map[r[i]];
      if (!v) return null;
      n += v < prev ? -v : v;
      prev = v;
    }
    return n;
  }

  // Strip volume markers + tail punctuation so two volumes of the same work
  // share a base key. Used to look up a sibling catalog row at the right volume.
  function baseTitle(t) {
    if (!t) return '';
    return normalize(String(t)
      .replace(/\b(?:vol|volume|band|teil|part|deel|tome|tomo|tom)\.?\s*\d{1,3}\b/gi, '')
      .replace(/(?:[.\s])(I{2,3}|IV|VI{0,3}|IX|XI{0,3}|XIV?|XV)\.?\s*$/i, '')
      .replace(/[^\d]\s+\d{1,2}\.?\s*$/, ''));
  }

  // Group catalog rows by base title so we can hop between volumes.
  const catalogByBase = new Map();
  for (const c of catalog) {
    const base = baseTitle(c.title);
    if (!base) continue;
    if (!catalogByBase.has(base)) catalogByBase.set(base, []);
    catalogByBase.get(base).push(c);
  }

  function findSiblingVolume(bookTitle, bookAuthor, wantVol) {
    const base = baseTitle(bookTitle);
    const siblings = catalogByBase.get(base);
    if (!siblings) return null;
    // Look for a sibling whose extracted volume matches wantVol AND author lines up.
    for (const s of siblings) {
      if (extractVolume(s.title) !== wantVol) continue;
      if (!authorMatch(bookAuthor, s.author)) continue;
      return s;
    }
    return null;
  }

  const volumeMismatches = [];
  const volumeRepairs = [];
  const filtered = [];
  for (const m of matches) {
    const bookVol = extractVolume(m.book.title);
    const bphVol = extractVolume(m.bphTitle);
    const reasonIf = (r) => ({ ...m, reason: r });
    let mismatch = null;
    if (bookVol != null && bphVol == null) mismatch = `book is vol ${bookVol}, catalog is base/vol I`;
    else if (bphVol != null && bookVol == null) mismatch = `catalog is vol ${bphVol}, book is base/vol I`;
    else if (bookVol != null && bphVol != null && bookVol !== bphVol) mismatch = `book vol ${bookVol} ≠ catalog vol ${bphVol}`;

    if (!mismatch) { filtered.push(m); continue; }

    // Volume mismatch — try to find the correct sibling volume in the catalog.
    const want = bookVol; // null only when bphVol is set; in that case skip (book has no volume marker)
    if (want != null) {
      const sibling = findSiblingVolume(m.book.title, m.book.author, want);
      if (sibling && !sibling.sl_book_id && !sibling.sl_external_book_id) {
        volumeRepairs.push({
          oldUbn: m.ubn,
          ubn: sibling.ubn,
          bphTitle: sibling.title,
          bphYear: sibling.year,
          book: m.book,
          source: m.source,
          score: m.score,
        });
        continue;
      }
    }
    volumeMismatches.push(reasonIf(mismatch));
  }

  console.log(`\n=== Matches ===`);
  console.log(`Match candidates                                : ${matches.length}`);
  console.log(`Skipped (UBN already has BPH-native scan)       : ${collidesWithBphScan}`);
  console.log(`Skipped (external link already set to this book): ${alreadyLinked}`);
  console.log(`Volume mismatch → re-pointed to sibling UBN     : ${volumeRepairs.length}`);
  console.log(`Volume mismatch → no sibling found, skipped     : ${volumeMismatches.length}`);
  console.log(`Will apply                                      : ${filtered.length + volumeRepairs.length}`);

  if (volumeRepairs.length > 0) {
    console.log(`\nVolume repairs (re-pointed to correct vol):`);
    for (const r of volumeRepairs) {
      console.log(`  ${r.oldUbn} → ${r.ubn}  "${(r.book.title || '').slice(0, 60)}" → "${(r.bphTitle || '').slice(0, 60)}"`);
    }
  }
  if (volumeMismatches.length > 0) {
    console.log(`\nVolume mismatches (no sibling, skipped):`);
    for (const m of volumeMismatches) {
      console.log(`  UBN ${m.ubn}  ${m.reason}`);
      console.log(`    Mongo : "${(m.book.title || '').slice(0, 70)}"`);
      console.log(`    BPH   : "${(m.bphTitle || '').slice(0, 70)}"`);
    }
  }

  // Replace `matches` with the post-volume-filter set (clean + repaired) for the rest of the run.
  matches.length = 0;
  matches.push(...filtered, ...volumeRepairs);

  const high = matches.filter(m => m.score >= 0.9).length;
  const med = matches.filter(m => m.score >= 0.7 && m.score < 0.9).length;
  const low = matches.filter(m => m.score < 0.7).length;
  console.log(`Score distribution: ≥0.9 ${high}  |  0.7-0.9 ${med}  |  <0.7 ${low}`);

  const bySource = {};
  for (const m of matches) bySource[m.source] = (bySource[m.source] || 0) + 1;
  console.log('\nMatches by source provider:');
  Object.entries(bySource).sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`  ${s.padEnd(20)} ${n}`));

  console.log('\nSample (first 10):');
  for (const m of matches.slice(0, 10)) {
    console.log(`  UBN ${m.ubn}  score=${m.score.toFixed(2)}  src=${m.source}`);
    console.log(`    Mongo: "${(m.book.title || '').slice(0, 60)}"`);
    console.log(`    BPH  : "${(m.bphTitle || '').slice(0, 60)}" (${m.bphYear || '—'})`);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — no writes. Re-run with --apply to PATCH bph_works.');
    await mongo.close();
    return;
  }

  console.log(`\nApplying ${matches.length} PATCHes...`);
  let updated = 0, failed = 0;
  const errs = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    try {
      await patchExternalLink(m.ubn, {
        sl_external_book_id: m.book.id,
        sl_external_slug: m.book.slug || m.book.id,
        sl_external_source: m.source,
      });
      updated++;
      if (updated % 100 === 0) console.log(`  ${updated}/${matches.length}…`);
    } catch (e) {
      failed++;
      if (errs.length < 10) errs.push(String(e.message || e));
    }
  }
  console.log(`\nDone. updated=${updated} failed=${failed}`);
  if (errs.length) {
    console.log('First errors:');
    errs.forEach(e => console.log(`  ${e}`));
  }
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
