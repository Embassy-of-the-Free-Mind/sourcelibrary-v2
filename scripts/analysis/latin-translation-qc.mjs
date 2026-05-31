#!/usr/bin/env node
/**
 * Latin (USTC) translation census — QC sampler for error bars
 *
 * The Latin ~2% figure rests on author-surname matching (USTC author ↔
 * translation-catalogue author + Latin→English aliases). This script pulls two
 * samples for a manual error-bar audit (mirror of the Siku Quanshu QC):
 *   A) flagged-true sample — editions where ustc_editions.has_english_translation
 *      is true; hand-check whether THIS work is actually translated (flag
 *      precision at the work level).
 *   B) base-rate sample — random Latin editions, deduped to works; hand-check
 *      the base rate.
 *
 * Finding (see docs/translation-gap-census-paper/latin-qc-audit.md): the
 * author-flag is ~70% precise at the work level (translated authors have many
 * untranslated minor works; surname collisions); and edition-weighted sampling
 * over-represents translated works — a clean work-level rate needs work-uniform
 * sampling + per-work verification.
 *
 * Read-only against the public Supabase (secondrenaissance). Writes sample JSON
 * for the manual audit. Usage: node scripts/analysis/latin-translation-qc.mjs
 */
import { writeFileSync } from 'fs';

const URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const SEL = 'id,author_1,title,year,classification_1,has_english_translation';
const SEED = 42;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
async function page(extra, off, lim) {
  const u = `${URL}/rest/v1/ustc_editions?language_1=eq.Latin&select=${SEL}&order=sn.asc&offset=${off}&limit=${lim}${extra}`;
  const r = await fetch(u, { headers: H });
  return r.ok ? await r.json() : [];
}
const rng = mulberry32(SEED);
function dedupWorks(arr) {
  const m = new Map();
  for (const e of arr) { const k = (e.author_1 || '') + '|' + (e.title || '').slice(0, 40); if (!m.has(k)) m.set(k, e); }
  return [...m.values()];
}
function sample(arr, n) { return dedupWorks(arr).sort(() => rng() - 0.5).slice(0, n); }

async function main() {
  // base-rate: random spread across the sn range, edition-drawn → deduped to works
  const rand = [];
  for (const off of [0, 80000, 160000, 240000, 320000, 400000]) rand.push(...await page('', off, 60));
  // flagged-true: precision check
  const flagged = [];
  for (const off of [0, 20000, 40000]) flagged.push(...await page('&has_english_translation=eq.true', off, 40));

  const base = sample(rand, 50), flag = sample(flagged, 25);
  writeFileSync('scripts/analysis/latin-qc-base-sample.json', JSON.stringify(base, null, 1));
  writeFileSync('scripts/analysis/latin-qc-flagged-sample.json', JSON.stringify(flag, null, 1));
  console.log(`base: ${base.length} works (census-flagged translated: ${base.filter(e => e.has_english_translation).length}); flagged-true: ${flag.length}`);
  console.log('Caveat: edition-weighted sampling over-represents prolific (translated) authors — see latin-qc-audit.md.');
}
main().catch(e => { console.error(e); process.exit(1); });
