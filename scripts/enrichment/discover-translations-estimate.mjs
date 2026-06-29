#!/usr/bin/env node
/**
 * Discovery-pass estimator. Randomly sample N confirmed_first books that
 * haven't been audited yet, ask Gemini 3.1 Flash Lite with Google Search
 * grounding "does any English translation of this work exist?", and
 * report the hit rate.
 *
 * This is a CHEAP estimate (~$0.014/book × N) to decide whether a full
 * retro-audit of all 8,120 confirmed_first books is worth the ~$114.
 *
 * Does not mutate anything. Writes audit results to a session-scoped
 * field so a follow-up apply could act on them, but the main goal is to
 * report a single number: % of confirmed_first books with a translation
 * the prior pipeline missed.
 *
 * Excludes books already audited via audit-translation-claims.mjs (those
 * have audit_applied_2026_05_30:true).
 *
 * Usage:
 *   node scripts/enrichment/discover-translations-estimate.mjs --limit 50
 */

import { GoogleGenAI } from '@google/genai';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { appendAttempt, makeAttemptId, domainsFromEvidence } from '../lib/ft-attempt-log.mjs';

const MODEL = 'gemini-3.1-flash-lite';
const CONCURRENCY = 3;
const DELAY_MS = 1000;

function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          env[m[1].trim()] = v;
        }
      }
      break;
    } catch {}
  }
  return { ...process.env, ...env };
}

const env = loadEnv();
const apiKeys = [
  env.GEMINI_API_KEY,
  env.GEMINI_API_KEY_2,
  env.GEMINI_API_KEY_3,
  env.GEMINI_API_KEY_4,
  env.GEMINI_API_KEY_TIER3,
].filter(Boolean);
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY'); process.exit(1); }
let keyIdx = 0;
const nextKey = () => apiKeys[keyIdx++ % apiKeys.length];

const getArg = name => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : 50;
const SAVE = process.argv.includes('--save');
const LANG_RE = getArg('--language') ? new RegExp(getArg('--language'), 'i') : null;
const ALL = process.argv.includes('--all');  // ignore LIMIT, process all matching

function prompt(book) {
  const author = (book.author || '').replace(/\s+/g, ' ').trim();
  const title = book.display_title || book.title || '';
  const lang = book.language || 'unknown language';
  return `You are searching for English translations of a historical work.

WORK: "${title}" by ${author} (originally in ${lang})

Search the web for any English translation. Look in library catalogs (HathiTrust, Open Library, WorldCat, Internet Archive), bookseller sites, university press pages, scholarly bibliographies, Brill/Cambridge/Oxford/Harvard/Yale.

Report what you find. Be skeptical: distinguish complete English translations from scholarly studies, critical editions of the original language, partial selections, anthologies that include excerpts.

Respond JSON only:
{
  "translation_exists": true | false,
  "confidence": "high" | "medium" | "low",
  "reasoning": "1-2 sentences explaining what the search found",
  "translation": null OR {
    "english_title": "...",
    "translator": "...",
    "pub_year": "...",
    "publisher": "...",
    "completeness": "complete" | "partial" | "selections" | "study_with_excerpts"
  }
}`;
}

async function discoverOne(book) {
  const ai = new GoogleGenAI({ apiKey: nextKey() });
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt(book),
    config: { tools: [{ googleSearch: {} }], temperature: 0.1 },
  });
  const text = resp.text || '';
  const grounding = resp.candidates?.[0]?.groundingMetadata;
  const evidence = (grounding?.groundingChunks || []).filter(c => c.web?.uri).slice(0, 5).map(c => ({ url: c.web.uri, title: c.web.title || '' }));
  const searchQueries = grounding?.webSearchQueries || [];
  let parsed;
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse((m ? m[1] || m[0] : text).trim());
  } catch {
    return { error: 'parse_failed', raw: text.slice(0, 300), evidence, searchQueries };
  }
  return { ...parsed, evidence, searchQueries, tokens: { input: resp.usageMetadata?.promptTokenCount || 0, output: resp.usageMetadata?.candidatesTokenCount || 0 } };
}

async function pool(items, fn, n) {
  for (let i = 0; i < items.length; i += n) {
    await Promise.allSettled(items.slice(i, i + n).map(fn));
    if (i + n < items.length) await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

async function main() {
  console.log(`=== Discovery-pass estimate (${LIMIT} random confirmed_first books) ===`);
  const c = new MongoClient(env.MONGODB_URI); await c.connect();
  const db = c.db(env.MONGODB_DB || 'bookstore');

  const match = {
    'translation_verification.disposition': 'confirmed_first',
    // Stable + legacy markers both honored (#2332 Task 2): skip a book if it
    // was audited or already estimated under EITHER the new or the dated name.
    'translation_verification.audit_applied': { $ne: true },
    'translation_verification.audit_applied_2026_05_30': { $ne: true },
    'translation_verification.discovery_estimate': { $exists: false },
    'translation_verification.discovery_estimate_2026_05_30': { $exists: false },  // idempotent skip
    visible: true,
    pages_count: { $gt: 0 },
  };
  if (LANG_RE) match.language = { $regex: LANG_RE };
  let sample;
  if (ALL) {
    sample = await db.collection('books').find(match).project({ id: 1, title: 1, display_title: 1, author: 1, language: 1 }).toArray();
  } else {
    sample = await db.collection('books').aggregate([
      { $match: match },
      { $sample: { size: LIMIT } },
      { $project: { id: 1, title: 1, display_title: 1, author: 1, language: 1 } },
    ]).toArray();
  }
  console.log(`Pulled ${sample.length} books\n`);

  const found = [], missed = [], errors = [];
  let totalIn = 0, totalOut = 0;

  await pool(sample, async (book) => {
    const t = (book.display_title || book.title || '').slice(0, 55);
    try {
      const r = await discoverOne(book);
      if (r.error) { errors.push({ book, error: r.error }); console.log(`  PARSE-FAIL  ${t}`); return; }
      totalIn += r.tokens?.input || 0;
      totalOut += r.tokens?.output || 0;
      if (r.translation_exists) {
        found.push({ book, ...r });
        console.log(`  FOUND       ${t} (${r.confidence})`);
        console.log(`    → "${r.translation?.english_title?.slice(0, 50)}" by ${r.translation?.translator?.slice(0, 30)} (${r.translation?.pub_year}) [${r.translation?.completeness}]`);
      } else {
        missed.push({ book, ...r });
      }
      if (SAVE) {
        await db.collection('books').updateOne(
          { _id: book._id },
          { $set: {
            'translation_verification.discovery_estimate': {
              audited_at: new Date(),
              model: MODEL,
              translation_exists: r.translation_exists,
              confidence: r.confidence,
              reasoning: r.reasoning,
              translation: r.translation || null,
              evidence: r.evidence,
            },
          }}
        );

        // Keep the search. This is a documented look for ANY prior English
        // translation of the work — record it append-only so the absence (or
        // the missed prior) is durable evidence, not a one-night side note.
        const isoDate = new Date().toISOString();
        const domains = domainsFromEvidence(r.evidence);
        await appendAttempt(db, {
          attempt_id: makeAttemptId(book.id, 'gemini_verifier', isoDate),
          book_id: book.id,
          date: isoDate,
          method: 'gemini_verifier',
          match_key: 'author_title',
          sources_checked: domains,
          queries: r.searchQueries || [],
          result: r.translation_exists ? 'found' : 'none',
          found_refs: [],
          priors: r.translation ? [r.translation] : [],
          evidence_strength: r.translation_exists ? 'moderate' : 'weak',
          independence_score: domains.length ? 0.3 : 0.1,
          model: MODEL,
          notes: `[discover ${r.confidence}] ${(r.reasoning || '').slice(0, 300)}`.trim(),
          _src: 'discover-translations-estimate',
        });
      }
    } catch (err) {
      errors.push({ book, error: err.message });
      console.log(`  ERROR       ${t} — ${err.message?.slice(0, 80)}`);
    }
  }, CONCURRENCY);

  await c.close();

  console.log('\n=== Estimate ===');
  console.log(`  Sample size:                ${sample.length}`);
  console.log(`  Translation found (missed): ${found.length} (${(100 * found.length / sample.length).toFixed(0)}%)`);
  console.log(`  No translation found:       ${missed.length} (${(100 * missed.length / sample.length).toFixed(0)}%)`);
  console.log(`  Errors / parse fails:       ${errors.length}`);

  // Filter to high-confidence "found" — these are the strongest signal
  const highConfFound = found.filter(f => f.confidence === 'high' && f.translation?.completeness === 'complete');
  console.log(`  Found + high conf + complete: ${highConfFound.length} (${(100 * highConfFound.length / sample.length).toFixed(0)}%) — strongest signal of pipeline miss`);

  console.log('\n=== Cost ===');
  const cost = (totalIn / 1_000_000) * 0.15 + (totalOut / 1_000_000) * 0.40;
  console.log(`  Tokens: in=${totalIn.toLocaleString()} out=${totalOut.toLocaleString()}`);
  console.log(`  Model cost (Flash Lite): $${cost.toFixed(2)}`);
  console.log(`  Grounding cost: ~$${(sample.length * 0.014).toFixed(2)}`);

  console.log('\n=== Projected scale ===');
  const rate = highConfFound.length / sample.length;
  const projected8120 = (rate * 8120).toFixed(0);
  console.log(`  If ${(100 * rate).toFixed(1)}% hit rate holds across all 8,120 confirmed_first:`);
  console.log(`    Projected pipeline misses: ~${projected8120}`);
  console.log(`    Cost of full retro-audit: ~$${(8120 * 0.014).toFixed(0)}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
