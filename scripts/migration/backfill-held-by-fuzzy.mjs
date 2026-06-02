#!/usr/bin/env node
/**
 * Cross-reference ALL non-BPH books against the BPH catalog using fuzzy
 * title+author+year matching. Adds 'bph' to held_by for confirmed matches.
 *
 * This catches books we imported from MDZ, Gallica, IA, etc. that BPH also
 * physically holds (e.g., the Boehme books from MDZ).
 *
 * Uses the same matching logic as enrich-efm-from-bph.mjs.
 *
 * Usage:
 *   node scripts/migration/backfill-held-by-fuzzy.mjs                # Preview
 *   node scripts/migration/backfill-held-by-fuzzy.mjs --apply        # Write
 *   node scripts/migration/backfill-held-by-fuzzy.mjs --threshold 0.7  # Stricter
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Env ──────────────────────────────────────────────────────────────
function loadEnv() {
  for (const f of ['../../.env.production.local', '.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
        }
      }
    } catch { /* skip */ }
  }
}
loadEnv();

const DRY_RUN = !process.argv.includes('--apply');
const thresholdIdx = process.argv.indexOf('--threshold');
const THRESHOLD = thresholdIdx >= 0 ? parseFloat(process.argv[thresholdIdx + 1]) : 0.6;
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Fuzzy matching (from enrich-efm-from-bph.mjs) ────────────────────
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
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
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
    if (authorMatch(book.author, bph.author)) {
      score += 0.1;
    } else {
      score -= 0.3;
    }
    if (book.year && bph.year) {
      const yearDiff = Math.abs(book.year - bph.year);
      if (yearDiff === 0) score += 0.1;
      else if (yearDiff <= 5) score += 0.05;
      else if (yearDiff > 20) score -= 0.2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { bph, score };
    }
  }

  if (!bestMatch || bestScore < THRESHOLD) return null;
  // Short titles produce false positives — require higher confidence
  const bookTitleLen = normalize(book.title).length;
  const bphTitleLen = normalize(bestMatch.bph.title).length;
  const minLen = Math.min(bookTitleLen, bphTitleLen);
  if (bestScore < 0.9 && minLen < 15) return null;
  if (bestScore < 1.0 && minLen < 10) return null; // Very short titles need exact+author+year
  return bestMatch;
}

// ── Build title word index for fast candidate lookup ─────────────────
function buildIndex(bphWorks) {
  const index = new Map(); // word → [bph entries]
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
    const entries = index.get(w) || [];
    for (const e of entries) {
      if (!seen.has(e.ubn)) {
        seen.add(e.ubn);
        candidates.push(e);
      }
    }
  }
  return candidates;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== Fuzzy BPH Catalog Cross-Reference ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Threshold: ${THRESHOLD}\n`);

  // Load full BPH catalog from Supabase
  console.log('Loading BPH catalog from Supabase...');
  const allBph = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?select=ubn,title,author,year&order=ubn&offset=${offset}&limit=1000`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const data = await res.json();
    if (!data.length) break;
    allBph.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`Loaded ${allBph.length} BPH catalog entries`);

  // Build word index
  const index = buildIndex(allBph);
  console.log(`Built index with ${index.size} words\n`);

  // Connect to MongoDB
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Get all non-BPH books that don't already have 'bph' in held_by
  const nonBph = await books.find(
    {
      'image_source.provider': { $nin: ['bph', 'cmc_kloss'] },
      visible: true,
      pages_count: { $gt: 0 },
      $or: [
        { held_by: { $exists: false } },
        { held_by: { $not: { $elemMatch: { $eq: 'bph' } } } },
      ],
    },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, author: 1, year: 1, 'image_source.provider': 1 } }
  ).toArray();
  console.log(`Checking ${nonBph.length} non-BPH books...\n`);

  const matches = [];
  let checked = 0;

  for (const book of nonBph) {
    checked++;
    const candidates = getCandidates(book, index);
    if (candidates.length === 0) continue;

    const match = findBestMatch(book, candidates);
    if (match) {
      matches.push({ book, bph: match.bph, score: match.score });
      if (matches.length <= 20 || matches.length % 50 === 0) {
        console.log(`  MATCH (${match.score.toFixed(2)}): "${book.title?.substring(0, 50)}" [${book.image_source?.provider}]`);
        console.log(`     ↔  "${match.bph.title?.substring(0, 50)}" [BPH UBN ${match.bph.ubn}]`);
      }
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Checked: ${checked}`);
  console.log(`Matches: ${matches.length}`);

  // Score distribution
  const high = matches.filter(m => m.score >= 0.9).length;
  const med = matches.filter(m => m.score >= 0.7 && m.score < 0.9).length;
  const low = matches.filter(m => m.score < 0.7).length;
  console.log(`  ≥0.9: ${high}  |  0.7-0.9: ${med}  |  <0.7: ${low}`);

  if (!DRY_RUN && matches.length > 0) {
    console.log(`\nApplying ${matches.length} updates...`);
    let updated = 0;
    for (const { book } of matches) {
      await books.updateOne(
        { _id: book._id },
        { $addToSet: { held_by: 'bph' } }
      );
      updated++;
    }
    console.log(`Updated: ${updated}`);

    const bphTotal = await books.countDocuments({ held_by: 'bph' });
    console.log(`Total BPH held_by: ${bphTotal}`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
