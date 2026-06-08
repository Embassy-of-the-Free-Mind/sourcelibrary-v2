#!/usr/bin/env node
/**
 * Calibrate the translation-census recall floor (#2453).
 *
 * The bare census (Google Books title-match + Gemini precision) UNDERCOUNTS —
 * it misses translations whose published title diverges from the work title.
 * The Siku census showed hand-verified ground truth ran ~2× the automated rate.
 *
 * This re-checks the FIRST N works of the same seeded census order (so their
 * bare verdicts are already in the census cache) with a WEB-GROUNDED Gemini
 * pass (googleSearch tool, thinkingBudget:-1 + parse-inside-retry — the
 * grounding-truncation lesson), which can find translations bare recall misses.
 * Output: a per-work CSV for human review + the calibration multiplier
 * (grounded translated / bare translated on the same works).
 *
 * HONEST FRAMING: this is MACHINE-DEEP-VERIFIED (web-grounded), not
 * human-verified. The CSV is the artifact a human signs off on to make the
 * numbers publishable; the multiplier is an estimate, not the final word.
 *
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/works-catalog/calibrate-census.mjs --tradition islamicate [--sample 40]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { pgClient, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const TRADITION = args[args.indexOf('--tradition') + 1];
const N = parseInt(args.includes('--sample') ? args[args.indexOf('--sample') + 1] : '40', 10);
if (!['islamicate', 'tibetan', 'chinese'].includes(TRADITION)) {
  console.error('Usage: calibrate-census.mjs --tradition islamicate|tibetan|chinese [--sample N]');
  process.exit(1);
}
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const CACHE_DIR = process.env.CENSUS_CACHE_DIR || '/root/works-catalog-cache';
const SEED = 42; // MUST match translation-census.mjs so the stratum is cached
const bareVerdicts = existsSync(`${CACHE_DIR}/census-${TRADITION}-verdicts.json`)
  ? JSON.parse(readFileSync(`${CACHE_DIR}/census-${TRADITION}-verdicts.json`, 'utf8')) : {};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// grounded verification: Gemini + googleSearch, thinkingBudget:-1, parse-inside-retry
async function groundedVerify(w) {
  const desc = TRADITION === 'islamicate'
    ? `Arabic title: ${w.title}; romanized: ${w.title_romanized || ''}; author: ${w.author || '?'} (d. ${w.extra?.author_death_ce || '?'} CE)`
    : TRADITION === 'tibetan'
      ? `Wylie: ${w.title_romanized || ''}; Tibetan: ${w.title}; catalog: ${w.title_english || ''}`
      : `Chinese title: ${w.title}; English: ${w.title_english || ''}`;
  const prompt = `Using web search, determine whether a published English translation of this SPECIFIC premodern work exists. Search thoroughly — the English edition's title often differs from the original.

WORK: ${desc}

Find the actual published English translation if one exists (translator, title, year, publisher). Distinguish a genuine translation of THIS work from books that merely discuss it or translate a different work. A complete translation = "full"; selections/excerpts only = "partial"; none found = "none".

Respond with JSON only (no markdown): {"status":"full"|"partial"|"none","translator":"<name|null>","english_title":"<title|null>","year":<int|null>,"confidence":"high"|"medium"|"low"}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: -1 } },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { await sleep(2000); continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(3000); continue; }
    if (!r.ok) return null;
    const txt = (await r.json())?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* parse-inside-retry */ } }
    await sleep(1500);
  }
  // no-grounding fallback so a grounding flake isn't scored as "none"
  return null;
}

const client = pgClient();
await client.connect();
const scopeFilter = TRADITION === 'islamicate' ? `and (century is null or century <= 19)` : '';
const all = (await client.query(
  `select id, title, title_romanized, title_english, author, extra from works
   where tradition = $1 ${scopeFilter} order by id`, [TRADITION])).rows;
const rng = mulberry32(SEED);
const ordered = [...all].map(w => [rng(), w]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const stratum = ordered.slice(0, N);
console.log(`${TRADITION}: calibration stratum = first ${stratum.length} of seeded census order`);

const rows = [];
let bareTr = 0, deepTr = 0, gainedTr = 0, errors = 0;
for (const w of stratum) {
  const bare = bareVerdicts[w.id]?.state || 'unknown';
  const bareYes = bare === 'translated';
  const g = await groundedVerify(w);
  if (!g) { errors++; rows.push({ id: w.id, bare, deep: 'ERROR' }); continue; }
  const deepYes = g.status === 'full' || g.status === 'partial';
  if (bareYes) bareTr++;
  if (deepYes) deepTr++;
  if (deepYes && !bareYes) gainedTr++;
  rows.push({
    id: w.id, title: w.title_romanized || w.title_english || w.title,
    bare, deep: g.status, translator: g.translator, eng: g.english_title, year: g.year, conf: g.confidence,
  });
  process.stderr.write(`${deepYes ? (bareYes ? '==' : '++') : (bareYes ? '--' : '  ')} ${w.id} bare:${bare} deep:${g.status} ${g.english_title || ''}\n`);
  await sleep(500);
}
await client.end();

// CSV for human review
const csv = ['work_id,title,bare,deep,translator,english_title,year,confidence']
  .concat(rows.map(r => [r.id, r.title, r.bare, r.deep, r.translator, r.eng, r.year, r.conf]
    .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
writeFileSync(`${CACHE_DIR}/calibrate-${TRADITION}.csv`, csv);

const pool = stratum.length - errors;
const multiplier = bareTr > 0 ? (deepTr / bareTr) : null;
console.log(`\n${TRADITION} calibration (n=${pool}, ${errors} errors):`);
console.log(`  bare translated:   ${bareTr} (${(100 * bareTr / pool).toFixed(1)}%)`);
console.log(`  grounded translated: ${deepTr} (${(100 * deepTr / pool).toFixed(1)}%)  [+${gainedTr} the bare pass missed]`);
console.log(`  recall-floor multiplier ≈ ${multiplier ? multiplier.toFixed(2) : 'n/a'}×`);
console.log(`  CSV for human review: ${CACHE_DIR}/calibrate-${TRADITION}.csv`);
