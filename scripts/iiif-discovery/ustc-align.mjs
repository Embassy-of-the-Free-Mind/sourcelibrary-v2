#!/usr/bin/env node
/**
 * USTC Alignment — match IIIF import candidates against USTC records.
 *
 * Strategy:
 * 1. For each candidate with an author and date, extract author surname
 * 2. Query USTC editions by author_1 surname + year range
 * 3. Score title similarity between candidate title and USTC title
 * 4. Store best match USTC ID on the candidate
 *
 * Uses Supabase REST API for USTC queries.
 * Starts with a pilot on a small sample, then scales.
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';
const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);

const LIMIT = parseInt(args.limit) || 100;
const DRY_RUN = 'dry-run' in args;

// Simple title similarity — word overlap ratio
function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

// Extract surname from "Surname, Given" or "Given Surname" format
function extractSurname(author) {
  if (!author || author === 'Unknown') return null;
  const cleaned = author.replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').trim();
  // "Surname, Given" format (most common in library catalogs)
  const commaIdx = cleaned.indexOf(',');
  if (commaIdx > 0) {
    return cleaned.substring(0, commaIdx).trim().toLowerCase();
  }
  // "Given Surname" — take last word
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

async function queryUstc(surname, yearMin, yearMax) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
  url.searchParams.set('select', 'id,title,author_1,year,language_1,place');
  url.searchParams.set('author_1', `ilike.*${surname}*`);
  if (yearMin) url.searchParams.set('year', `gte.${yearMin}`);
  if (yearMax) url.searchParams.set('and', `(year.lte.${yearMax})`);
  url.searchParams.set('limit', '20');
  url.searchParams.set('order', 'year');

  try {
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function queryUstcEnrichment(surname) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
  url.searchParams.set('select', 'id,std_title,english_title,detected_language,original_author');
  url.searchParams.set('or', `(original_author.ilike.*${surname}*,std_title.ilike.*${surname}*)`);
  url.searchParams.set('limit', '20');

  try {
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function main() {
  console.log('=== USTC Alignment Pilot ===');
  console.log(`Limit: ${LIMIT}, Dry run: ${DRY_RUN}\n`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Get candidates with authors and pre-1800 dates
  const candidates = await db.collection('import_candidates').find({
    status: { $in: ['discovered', 'imported'] },
    author: { $ne: 'Unknown', $exists: true },
    date_earliest: { $gt: 1400, $lt: 1800 },
  }).limit(LIMIT).toArray();

  console.log(`Candidates to match: ${candidates.length}\n`);

  let matched = 0, unmatched = 0, errors = 0;
  const matchQuality = { high: 0, medium: 0, low: 0, none: 0 };
  const sampleMatches = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const surname = extractSurname(c.author);
    if (!surname || surname.length < 3) {
      unmatched++;
      matchQuality.none++;
      continue;
    }

    // Query USTC editions
    const yearMin = (c.date_earliest || 1450) - 5;
    const yearMax = (c.date_latest || c.date_earliest || 1700) + 5;
    const ustcResults = await queryUstc(surname, yearMin, yearMax);

    if (ustcResults.length === 0) {
      // Try enrichments (broader search, has English titles)
      const enrichResults = await queryUstcEnrichment(surname);
      if (enrichResults.length === 0) {
        unmatched++;
        matchQuality.none++;
        continue;
      }

      // Score enrichment matches by English title similarity
      let bestMatch = null, bestScore = 0;
      for (const e of enrichResults) {
        const score = Math.max(
          titleSimilarity(c.title, e.english_title),
          titleSimilarity(c.title, e.std_title),
        );
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { ustc_id: e.id, title: e.std_title, english_title: e.english_title, score };
        }
      }

      if (bestMatch && bestScore >= 0.3) {
        matched++;
        const quality = bestScore >= 0.7 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low';
        matchQuality[quality]++;

        if (sampleMatches.length < 20) {
          sampleMatches.push({
            candidate: `${c.author} — ${c.title?.substring(0, 50)} (${c.date_text})`,
            ustc: `USTC-${bestMatch.ustc_id}: ${bestMatch.title?.substring(0, 50)}`,
            english: bestMatch.english_title?.substring(0, 50),
            score: bestScore.toFixed(2),
            quality,
          });
        }

        if (!DRY_RUN) {
          await db.collection('import_candidates').updateOne(
            { _id: c._id },
            { $set: {
              ustc_id: bestMatch.ustc_id,
              ustc_match_score: bestScore,
              ustc_match_quality: quality,
              ustc_english_title: bestMatch.english_title,
            }}
          );
        }
      } else {
        unmatched++;
        matchQuality.none++;
      }
      continue;
    }

    // Score edition matches by title similarity
    let bestMatch = null, bestScore = 0;
    for (const u of ustcResults) {
      const score = titleSimilarity(c.title, u.title);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ustc_id: u.id, title: u.title, year: u.year, language: u.language_1, score };
      }
    }

    if (bestMatch && bestScore >= 0.3) {
      matched++;
      const quality = bestScore >= 0.7 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low';
      matchQuality[quality]++;

      if (sampleMatches.length < 20) {
        sampleMatches.push({
          candidate: `${c.author} — ${c.title?.substring(0, 50)} (${c.date_text})`,
          ustc: `USTC-${bestMatch.ustc_id}: ${bestMatch.title?.substring(0, 50)} (${bestMatch.year})`,
          score: bestScore.toFixed(2),
          quality,
        });
      }

      if (!DRY_RUN) {
        await db.collection('import_candidates').updateOne(
          { _id: c._id },
          { $set: {
            ustc_id: bestMatch.ustc_id,
            ustc_match_score: bestScore,
            ustc_match_quality: quality,
          }}
        );
      }
    } else {
      unmatched++;
      matchQuality.none++;
    }

    if ((i + 1) % 20 === 0) {
      process.stdout.write(`  ${i + 1}/${candidates.length}: ${matched} matched, ${unmatched} unmatched\r`);
    }

    // Rate limit Supabase
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n=== Results ===`);
  console.log(`Matched:   ${matched} (${(matched / candidates.length * 100).toFixed(1)}%)`);
  console.log(`Unmatched: ${unmatched} (${(unmatched / candidates.length * 100).toFixed(1)}%)`);
  console.log(`\nMatch quality:`);
  console.log(`  High (>0.7):   ${matchQuality.high}`);
  console.log(`  Medium (0.5-0.7): ${matchQuality.medium}`);
  console.log(`  Low (0.3-0.5): ${matchQuality.low}`);
  console.log(`  No match:      ${matchQuality.none}`);

  if (sampleMatches.length > 0) {
    console.log(`\n=== Sample Matches ===`);
    for (const m of sampleMatches) {
      console.log(`\n  Candidate: ${m.candidate}`);
      console.log(`  USTC:      ${m.ustc}`);
      if (m.english) console.log(`  English:   ${m.english}`);
      console.log(`  Score:     ${m.score} (${m.quality})`);
    }
  }

  await client.close();
}

main().catch(console.error);
