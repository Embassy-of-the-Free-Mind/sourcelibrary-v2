#!/usr/bin/env node
/**
 * estimate-unflagged-agent.mjs — ESTIMATE ONLY (dryRun, no writes).
 *
 * Runs the REAL 8-tool verification agent (src/lib/verify-first-translation.ts:
 * local_catalogs + Open Library + Google Books + Internet Archive + OpenAlex +
 * Library of Congress + USTC) on a random sample of the non-English, never-flagged,
 * readable+visible pool, to estimate how many would come back as a first-translation
 * disposition under the production method (not the weaker 3-catalog synthesis).
 *
 * Run with:  npx tsx scripts/enrichment/estimate-unflagged-agent.mjs --limit 40
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try { for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); env[m[1].trim()] = v; }
    } break; } catch {}
  }
  return env;
}
const fileEnv = loadEnv();
for (const [k, v] of Object.entries(fileEnv)) if (!process.env[k]) process.env[k] = v;

const getArg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : 40;
const CONCURRENCY = 3;

const { verifyFirstTranslation } = await import('../../src/lib/verify-first-translation.ts');

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const match = { visible: true, pages_translated: { $gt: 0 }, is_first_translation: { $exists: false }, language: { $not: /^english$/i } };
const pop = await db.collection('books').countDocuments(match);
const sample = await db.collection('books').aggregate([{ $match: match }, { $sample: { size: LIMIT } }, { $project: { id: 1, title: 1, display_title: 1, language: 1 } }]).toArray();
console.log(`=== Estimate via REAL 8-tool agent (dryRun) — non-English never-flagged readable+visible ===`);
console.log(`Population: ${pop.toLocaleString()} | Sampled: ${sample.length}\n`);

const tally = { confirmed_first: 0, first_from_source: 0, first_complete_translation: 0, first_modern_translation: 0, translation_found: 0, needs_review: 0, error: 0 };
const byLang = {};
async function one(book) {
  const lang = book.language || '?'; byLang[lang] = byLang[lang] || { n: 0, first: 0 };
  const t = (book.display_title || book.title || '').slice(0, 46);
  try {
    const r = await verifyFirstTranslation(db, book.id, { dryRun: true });
    if (!r.success || !r.verification) { tally.error++; console.log(`  ERR  [${lang}] ${t} — ${r.error || '?'}`); return; }
    const d = r.verification.disposition; tally[d] = (tally[d] || 0) + 1; byLang[lang].n++;
    const isFirst = ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(d);
    if (isFirst) byLang[lang].first++;
    console.log(`  ${isFirst ? 'FIRST' : 'has  '} [${lang}] ${t} → ${d} (${r.verification.confidence}, ${r.verification.tools_called?.length || 0} tools)`);
  } catch (e) { tally.error++; console.log(`  ERR  [${lang}] ${t} — ${(e.message || '').slice(0, 60)}`); }
}
for (let i = 0; i < sample.length; i += CONCURRENCY) {
  await Promise.allSettled(sample.slice(i, i + CONCURRENCY).map(one));
}
await c.close();

const firstFam = tally.confirmed_first + tally.first_from_source + tally.first_complete_translation + tally.first_modern_translation;
const classified = firstFam + tally.translation_found + tally.needs_review;
const rate = classified ? firstFam / classified : 0;
console.log(`\n=== Result ===`);
console.log(JSON.stringify(tally, null, 0));
console.log(`  First-translation family: ${firstFam}/${classified} (${(100 * rate).toFixed(0)}%)`);
console.log(`  translation_found: ${tally.translation_found} | needs_review: ${tally.needs_review} | errors: ${tally.error}`);
console.log(`\n=== By language ===`);
for (const [l, s] of Object.entries(byLang).sort((a, b) => b[1].n - a[1].n)) if (s.n) console.log(`  ${l.padEnd(14)} ${s.first}/${s.n}`);
const proj = Math.round(rate * pop);
console.log(`\n  Projection: ~${(100 * rate).toFixed(0)}% of ${pop.toLocaleString()} → ~${proj.toLocaleString()} (would lift ~6,009 toward ~${(6009 + proj).toLocaleString()} via a deliberate reviewed batch)`);
