#!/usr/bin/env node
/**
 * Librarian search evaluation runner.
 *
 * Loads the golden set, runs each variant against each query, computes
 * precision@5 / recall@5 / MRR per variant, prints a summary, and writes
 * a JSON report to results/<timestamp>.json.
 *
 * Usage:
 *   set -a; source ../../../../.env.production.local; set +a
 *   node scripts/eval/librarian-search/run.mjs
 *   node scripts/eval/librarian-search/run.mjs --variant=rrf
 *   node scripts/eval/librarian-search/run.mjs --query=agrippa-planetary-seals
 *   node scripts/eval/librarian-search/run.mjs --verbose
 *   node scripts/eval/librarian-search/run.mjs --category=niche-passage
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { VARIANTS } from './variants.mjs';
import { precisionAtK, recallAtK, reciprocalRank, aggregate } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Arg parsing ───────────────────────────────────────────────────────

function arg(name, def) {
  const flag = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(flag));
  return found ? found.slice(flag.length) : def;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const wantedVariant = arg('variant', null);
const wantedQuery = arg('query', null);
const wantedCategory = arg('category', null);
const verbose = flag('verbose');

// ── Clients ───────────────────────────────────────────────────────────

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}. Source .env.production.local first.`);
    process.exit(1);
  }
  return v;
}

const mongoUri = requireEnv('MONGODB_URI');
const mongoDb = process.env.MONGODB_DB || 'bookstore';
const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const geminiKey = requireEnv('GEMINI_API_KEY');

const mongoClient = new MongoClient(mongoUri);
const supabase = createClient(supabaseUrl, supabaseKey);

// ── Embedding fn (cached per query — many variants embed the same string) ──

const embedCache = new Map();
async function embedFn(text, dims = 768) {
  const key = `${dims}:${text}`;
  if (embedCache.has(key)) return embedCache.get(key);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            model: 'models/gemini-embedding-2-preview',
            content: { parts: [{ text }] },
            outputDimensionality: dims,
          }],
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      console.error(`Embedding API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
      embedCache.set(key, null);
      return null;
    }
    const data = await res.json();
    const vec = data?.embeddings?.[0]?.values || null;
    embedCache.set(key, vec);
    return vec;
  } catch (err) {
    console.error(`Embedding error: ${err.message}`);
    embedCache.set(key, null);
    return null;
  }
}

// ── Query expansion fn (mirrors the terms half of /api/search/ai-expand) ──
// Generates period-appropriate reformulations (Latin titles, original-language
// names, synonyms) so the multiquery variant can RRF-fuse per-term searches.
const expandCache = new Map();
async function expandFn(query) {
  if (expandCache.has(query)) return expandCache.get(query);
  const prompt = `You expand search queries for Source Library — alchemy, Hermetica, Kabbalah, Rosicrucianism, Neoplatonism, Renaissance natural magic, and early modern science (antiquity through ~1850).
Query: "${query}"
Return ONLY a JSON array of 3-5 search terms a visitor wouldn't think of: period-appropriate synonyms, Latin or original-language titles, original-language author names, specific canonical works. No prose, no markdown — just the array.
Example for "Agrippa on planetary magic": ["De Occulta Philosophia","Cornelius Agrippa von Nettesheim","planetary seals","talismanic correspondences","celestial magic"]`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) { expandCache.set(query, []); return []; }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const m = text.match(/\[[\s\S]*?\]/);
    let terms = [];
    if (m) { try { const p = JSON.parse(m[0]); if (Array.isArray(p)) terms = p.filter(t => typeof t === 'string' && t.length >= 2); } catch { /* parse fail */ } }
    terms = terms.slice(0, 5);
    expandCache.set(query, terms);
    return terms;
  } catch (err) {
    console.error(`Expand error: ${err.message}`);
    expandCache.set(query, []);
    return [];
  }
}

// ── Runner ────────────────────────────────────────────────────────────

async function runOne(variant, query, ctx) {
  const start = Date.now();
  let hits = [];
  let error = null;
  try {
    hits = await variant.fn(query.query, ctx);
  } catch (err) {
    error = err.message;
  }
  const latencyMs = Date.now() - start;
  const p1 = hits.length > 0 && (hits.slice(0, 1).filter(h => matchesAny(h, query.expected)).length > 0) ? 1 : 0;
  return {
    queryId: query.id,
    queryText: query.query,
    category: query.category,
    confidence: query.confidence,
    expected: query.expected,
    hits,
    error,
    latencyMs,
    p1,
    p5: precisionAtK(hits, query.expected, 5),
    r5: recallAtK(hits, query.expected, 5),
    mrr: reciprocalRank(hits, query.expected, 20),
  };
}

function matchesAny(hit, expected) {
  return expected.some(e => {
    if (hit.book_slug !== e.book_slug) return false;
    if (e.page_min != null && hit.page_number < e.page_min) return false;
    if (e.page_max != null && hit.page_number > e.page_max) return false;
    return true;
  });
}

async function main() {
  // Load golden set
  const goldenPath = path.join(__dirname, 'golden-set.json');
  if (!fs.existsSync(goldenPath)) {
    console.error(`Golden set not found at ${goldenPath}. Create it first.`);
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

  // Filter queries
  let queries = golden.queries;
  if (wantedQuery) queries = queries.filter(q => q.id === wantedQuery);
  if (wantedCategory) queries = queries.filter(q => q.category === wantedCategory);
  if (queries.length === 0) {
    console.error('No matching queries.');
    process.exit(1);
  }

  // Filter variants
  let variantEntries = Object.entries(VARIANTS);
  if (wantedVariant) variantEntries = variantEntries.filter(([name]) => name === wantedVariant);
  if (variantEntries.length === 0) {
    console.error(`Unknown variant. Known: ${Object.keys(VARIANTS).join(', ')}`);
    process.exit(1);
  }

  await mongoClient.connect();
  const db = mongoClient.db(mongoDb);
  const ctx = { db, supabase, embedFn, expandFn };

  console.log(`\nLibrarian Search Eval`);
  console.log(`  Queries:  ${queries.length}${wantedQuery ? ` (filter: ${wantedQuery})` : ''}${wantedCategory ? ` (category: ${wantedCategory})` : ''}`);
  console.log(`  Variants: ${variantEntries.map(([n]) => n).join(', ')}\n`);

  const results = {}; // variantName → [perQueryResult]

  for (const [variantName, variant] of variantEntries) {
    process.stdout.write(`  ${variantName.padEnd(20)} `);
    results[variantName] = [];
    for (const query of queries) {
      const r = await runOne(variant, query, ctx);
      results[variantName].push(r);
      process.stdout.write(r.error ? 'x' : (r.p1 ? '.' : (r.r5 > 0 ? 'o' : '-')));
    }
    process.stdout.write('\n');
  }

  // ── Summary table ───────────────────────────────────────────────────
  console.log('\n┌─ Aggregate ─────────────────────────────────────────────────────────────┐');
  console.log('│ Variant              │  P@1   │  P@5   │  R@5   │  MRR   │  avg ms       │');
  console.log('├──────────────────────┼────────┼────────┼────────┼────────┼───────────────┤');
  for (const [variantName] of variantEntries) {
    const agg = aggregate(results[variantName]);
    const fmt = n => n.toFixed(3);
    const lat = String(Math.round(agg.avgLatencyMs)).padStart(6) + ' ms';
    console.log(`│ ${variantName.padEnd(20)} │ ${fmt(agg.p1)}  │ ${fmt(agg.p5)}  │ ${fmt(agg.r5)}  │ ${fmt(agg.mrr)}  │ ${lat}        │`);
  }
  console.log('└─────────────────────────────────────────────────────────────────────────┘');

  // ── Per-category breakdown ──────────────────────────────────────────
  const categories = [...new Set(queries.map(q => q.category))];
  if (categories.length > 1) {
    console.log('\nBy category (R@5):');
    process.stdout.write('  variant'.padEnd(22));
    for (const cat of categories) process.stdout.write(cat.padEnd(20));
    console.log();
    for (const [variantName] of variantEntries) {
      process.stdout.write(`  ${variantName.padEnd(20)}`);
      for (const cat of categories) {
        const inCat = results[variantName].filter(r => r.category === cat);
        const r5 = aggregate(inCat).r5;
        process.stdout.write(r5.toFixed(3).padEnd(20));
      }
      console.log();
    }
  }

  // ── Verbose per-query dump ──────────────────────────────────────────
  if (verbose) {
    console.log('\nPer-query results:');
    for (const query of queries) {
      console.log(`\n  [${query.category}] ${query.id} — "${query.query}"`);
      console.log(`    expected: ${query.expected.map(e => e.book_slug + (e.page_min ? `:${e.page_min}-${e.page_max}` : '')).join(', ')}`);
      for (const [variantName] of variantEntries) {
        const r = results[variantName].find(x => x.queryId === query.id);
        const tag = r.error ? `ERROR: ${r.error}` : `r5=${r.r5.toFixed(2)} mrr=${r.mrr.toFixed(2)}`;
        console.log(`    ${variantName.padEnd(20)} ${tag}`);
        if (r.hits.length === 0) {
          console.log(`      (no hits)`);
        } else {
          for (let i = 0; i < Math.min(r.hits.length, 5); i++) {
            const h = r.hits[i];
            const hit = matchesAny(h, query.expected) ? '✓' : ' ';
            console.log(`      ${hit} ${i + 1}. ${h.book_slug || '<no-slug>'} p.${h.page_number} (${(h.score ?? 0).toFixed(3)}, ${h.source})`);
          }
        }
      }
    }
  }

  // ── Save report ─────────────────────────────────────────────────────
  const resultsDir = path.join(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(resultsDir, `${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    queryCount: queries.length,
    variants: Object.fromEntries(variantEntries.map(([n, v]) => [n, v.description])),
    aggregates: Object.fromEntries(Object.entries(results).map(([n, rs]) => [n, aggregate(rs)])),
    perQuery: results,
  }, null, 2));
  console.log(`\nReport: ${path.relative(process.cwd(), reportPath)}`);

  await mongoClient.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
