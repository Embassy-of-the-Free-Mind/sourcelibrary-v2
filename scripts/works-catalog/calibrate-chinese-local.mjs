#!/usr/bin/env node
/**
 * Chinese census calibration — local REST runner (mirrors calibrate-census.mjs).
 *
 * Re-checks the first N (default 40) works of the seeded census order with a
 * WEB-GROUNDED Gemini pass (googleSearch tool, thinkingBudget:-1, parse-inside-
 * retry — the grounding-truncation lesson, #2244), which finds translations
 * whose published English title diverges from the original (bare Google-Books
 * title-match misses these). The deep/bare ratio is the recall-floor multiplier.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/calibrate-chinese-local.mjs [--sample 40]
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const N = args.includes('--sample') ? parseInt(args[args.indexOf('--sample') + 1], 10) : 40;
const SEED = 42;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY, MODEL = 'gemini-3.1-flash-lite';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bareVerdicts = JSON.parse(readFileSync('scripts/output/census-chinese-verdicts.json', 'utf8'));

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
async function pageAll(p) { const o = []; let f = 0; const s = 1000; while (true) { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + s - 1}` } }); if (!r.ok) break; const rows = await r.json(); o.push(...rows); if (rows.length < s) break; f += s; } return o; }

async function groundedVerify(w) {
  const prompt = `Using web search, determine whether a published English translation of this SPECIFIC premodern work exists. Search thoroughly — the English edition's title often differs from the original.

WORK: Chinese title: ${w.title}; English/pinyin: ${w.title_english || ''}; author: ${w.author || '?'}

Find the actual published English translation if one exists (translator, title, year, publisher). Distinguish a genuine translation of THIS work from books that merely discuss it or translate a different work by the same author. A complete translation = "full"; selections/excerpts/anthology portions only = "partial"; none found = "none".

Respond with JSON only (no markdown): {"status":"full"|"partial"|"none","translator":"<name|null>","english_title":"<title|null>","year":<int|null>,"confidence":"high"|"medium"|"low"}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ googleSearch: {} }], generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: -1 } } };
  for (let attempt = 0; attempt < 3; attempt++) {
    let r; try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }); }
    catch { await sleep(2500); continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(3000); continue; }
    if (!r.ok) return null;
    const txt = (await r.json())?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* parse-inside-retry */ } }
    await sleep(1500);
  }
  return null;
}

const all = await pageAll('works?tradition=eq.chinese&select=id,title,title_english,author');
const rng = mulberry32(SEED);
const ordered = [...all].map(w => [rng(), w]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const stratum = ordered.slice(0, N);
console.log(`chinese: calibration stratum = first ${stratum.length} of seeded census order\n`);

const rows = [];
let bareTr = 0, deepTr = 0, gainedTr = 0, errors = 0;
for (const w of stratum) {
  const bare = bareVerdicts[w.id]?.state || 'unknown';
  const bareYes = bare === 'translated';
  const g = await groundedVerify(w);
  if (!g) { errors++; rows.push({ id: w.id, bare, deep: 'ERROR' }); process.stderr.write(`!! ${w.id} ERROR\n`); continue; }
  const deepYes = g.status === 'full' || g.status === 'partial';
  if (bareYes) bareTr++;
  if (deepYes) deepTr++;
  if (deepYes && !bareYes) gainedTr++;
  rows.push({ id: w.id, title: w.title_english || w.title, bare, deep: g.status, translator: g.translator, eng: g.english_title, year: g.year, conf: g.confidence });
  process.stderr.write(`${deepYes ? (bareYes ? '==' : '++') : (bareYes ? '--' : '  ')} ${w.id} bare:${bare} deep:${g.status} ${g.english_title || ''}\n`);
  await sleep(500);
}
const csv = ['work_id,title,bare,deep,translator,english_title,year,confidence']
  .concat(rows.map(r => [r.id, r.title, r.bare, r.deep, r.translator, r.eng, r.year, r.conf].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
writeFileSync('scripts/output/calibrate-chinese.csv', csv);
const pool = stratum.length - errors;
const multiplier = bareTr > 0 ? (deepTr / bareTr) : null;
console.log(`\nchinese calibration (n=${pool}, ${errors} errors):`);
console.log(`  bare translated:     ${bareTr} (${(100 * bareTr / pool).toFixed(1)}%)`);
console.log(`  grounded translated: ${deepTr} (${(100 * deepTr / pool).toFixed(1)}%)  [+${gainedTr} bare missed]`);
console.log(`  recall-floor multiplier ≈ ${multiplier ? multiplier.toFixed(2) + 'x' : 'n/a (bare=0)'}`);
console.log(`  CSV: scripts/output/calibrate-chinese.csv`);
