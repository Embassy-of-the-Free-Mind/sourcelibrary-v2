#!/usr/bin/env node
/**
 * Chinese translation census (works-catalog #2453) — local REST runner.
 *
 * Mirrors scripts/works-catalog/translation-census.mjs (tibetan/islamicate) but
 * (a) adds a Chinese title-resolution branch and (b) reads/writes via the
 * Supabase REST API instead of direct Postgres, so it runs from a laptop with
 * SUPABASE_URL + SERVICE_ROLE + GEMINI_API_KEY + GOOGLE_BOOKS_API_KEY (no
 * SUPABASE_DB_URL / Hetzner needed). Same discipline:
 *   denominator = all chinese works; seeded random sample (seed 42);
 *   recall = established English title (Gemini, null if none) + pinyin form,
 *            Google Books (langRestrict=en) + OpenLibrary fallback;
 *   precision = Gemini gemini-3.1-flash-lite adjudication;
 *   every work -> TRANSLATED | UNTRANSLATED | ERROR; errors excluded from rate.
 * The automated number is a RECALL FLOOR (Siku lesson: hand-verified ~2x higher).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/census-chinese-local.mjs [--sample 300] [--write]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const args = process.argv.slice(2);
const N = args.includes('--sample') ? parseInt(args[args.indexOf('--sample') + 1], 10) : 300;
const WRITE = args.includes('--write');
const SEED = 42;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GBOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY, GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const UA = 'SourceLibrary-TranslationCensus/2.0 (derek@sourcelibrary.org)';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
mkdirSync('scripts/output', { recursive: true });
const VERDICT_CACHE = 'scripts/output/census-chinese-verdicts.json';
const verdicts = existsSync(VERDICT_CACHE) ? JSON.parse(readFileSync(VERDICT_CACHE, 'utf8')) : {};
const persist = () => writeFileSync(VERDICT_CACHE, JSON.stringify(verdicts, null, 1));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function wilson(k, n, z = 1.96) { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }

async function pageAll(p) { const o = []; let f = 0; const s = 1000; while (true) { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + s - 1}` } }); if (!r.ok) { console.error(p, r.status); break; } const rows = await r.json(); o.push(...rows); if (rows.length < s) break; f += s; } return o; }

async function gemini(prompt) {
  const u = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }), signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * a); continue; }
      if (!r.ok) return null;
      const t = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
      try { return JSON.parse(t.replace(/^```json\s*|\s*```$/g, '')); } catch { return null; }
    } catch { if (a === 3) return null; await sleep(2000 * a); }
  }
  return null;
}

async function resolveForms(w) {
  const j = await gemini(`A premodern Chinese work:
Chinese title: ${w.title}
Pinyin/English catalog form: ${w.title_english || '(none)'}
Author: ${w.author || '(unknown)'}

Respond JSON only: {"english_title": "<established English title>"|null}
Rules: give "english_title" ONLY if there is a genuinely established, widely-used English title for THIS SPECIFIC work (e.g. "The Analects" for 論語, "The Classic of Mountains and Seas" for 山海經, "The Platform Sutra" for 六祖壇經, "Zhuangzi" for 莊子). Many works — local gazetteers, collected works (別集/全書), commentaries, sub-canon Buddhist entries — have NO English translation tradition. For those use null. Do NOT invent a literal translation or guess.`);
  const forms = [];
  if (j?.english_title) forms.push(j.english_title);
  if (w.title_english && w.title_english !== j?.english_title) forms.push(w.title_english);
  return { forms: [...new Set(forms)].slice(0, 2), resolved: j?.english_title || null };
}

async function gbCandidates(forms) {
  const cands = [], seen = new Set(); let err = false;
  for (const q of forms.slice(0, 2)) {
    const u = `https://www.googleapis.com/books/v1/volumes?maxResults=5&langRestrict=en&country=US&q=${encodeURIComponent(q)}&key=${GBOOKS_KEY}`;
    let r; try { r = await fetch(u, { headers: { 'User-Agent': UA } }); } catch { err = true; await sleep(700); continue; }
    if (r.status === 429 || r.status >= 500) { err = true; await sleep(1500); continue; }
    if (!r.ok) { await sleep(250); continue; }
    const d = await r.json();
    for (const it of (d.items || [])) { const vi = it.volumeInfo || {}; if (vi.language !== 'en') continue; const key = (vi.title || '') + '|' + (vi.publishedDate || ''); if (seen.has(key)) continue; seen.add(key); cands.push({ title: vi.title, subtitle: vi.subtitle, authors: vi.authors, year: vi.publishedDate, desc: (vi.description || '').slice(0, 200) }); }
    await sleep(300); if (cands.length >= 8) break;
  }
  if (err || cands.length === 0) {
    for (const f of forms.slice(0, 2)) {
      const u = `https://openlibrary.org/search.json?language=eng&limit=4&fields=title,author_name,first_publish_year&q=${encodeURIComponent(f)}`;
      let r; try { r = await fetch(u, { headers: { 'User-Agent': UA } }); } catch { continue; }
      if (!r.ok) { await sleep(400); continue; }
      const d = await r.json();
      for (const doc of (d.docs || [])) { const key = (doc.title || '') + '|ol'; if (seen.has(key)) continue; seen.add(key); cands.push({ title: doc.title, authors: doc.author_name, year: doc.first_publish_year, desc: '' }); }
      await sleep(400); if (cands.length >= 8) break;
    }
    if (cands.length) err = false;
  }
  return { cands, err };
}

async function adjudicate(w, resolved, cands) {
  const j = await gemini(`You are verifying whether a published ENGLISH translation of a specific premodern Chinese work exists.

WORK — a premodern Chinese work:
- Chinese title: ${w.title}
- Pinyin/English catalog form: ${w.title_english || ''}
- Author: ${w.author || '?'}
${resolved ? `- Established English title (resolved): ${resolved}` : ''}

CANDIDATE English-language books found via Google Books / OpenLibrary:
${cands.map((c, i) => `${i + 1}. "${c.title}${c.subtitle ? ': ' + c.subtitle : ''}" (${c.year || '?'}) by ${(c.authors || []).join(', ') || '?'} — ${c.desc || ''}`).join('\n') || '(no candidates found)'}

Decide: is at least one candidate a genuine English translation of THIS specific work (not a book that merely mentions or studies it, not a different work matching by keyword, not a translation of a DIFFERENT text by the same author)? Excerpt anthologies count only as PARTIAL. If no candidates, answer false.

Respond JSON only: {"translated": boolean, "which": <number|null>, "complete": boolean, "confidence": "high"|"medium"|"low", "reason": "<one short sentence>"}`);
  if (!j) return { state: 'error' };
  return { state: j.translated ? 'translated' : 'untranslated', ...j };
}

// --- main ---
const all = await pageAll('works?tradition=eq.chinese&select=id,title,title_english,title_romanized,author');
const rng = mulberry32(SEED);
const sample = [...all].map(w => [rng(), w]).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, N);
console.log(`chinese: ${all.length} works, sampling ${sample.length} (seed ${SEED})${WRITE ? ' [WRITE]' : ''}`);

let done = 0;
for (const w of sample) {
  if (verdicts[w.id]) { done++; continue; }
  try {
    const { forms, resolved } = await resolveForms(w);
    if (!forms.length) { verdicts[w.id] = { state: 'untranslated', reason: 'no established English title' }; }
    else { const { cands, err } = await gbCandidates(forms); verdicts[w.id] = err && !cands.length ? { state: 'error', reason: 'recall error' } : { ...(await adjudicate(w, resolved, cands)), resolved }; }
  } catch (e) { verdicts[w.id] = { state: 'error', reason: e.message }; }
  done++;
  if (done % 10 === 0) { persist(); process.stderr.write(`${done}/${sample.length}\n`); }
}
persist();

const states = sample.map(w => verdicts[w.id]?.state);
const translated = states.filter(s => s === 'translated').length;
const untranslated = states.filter(s => s === 'untranslated').length;
const errors = states.filter(s => s === 'error').length;
const censused = translated + untranslated;
const rate = censused ? translated / censused : 0;
const ci = wilson(translated, censused);
const report = { tradition: 'chinese', denominator: all.length, sampled: sample.length, translated, untranslated, errors, censused, rate, ci, projected_translated_works: Math.round(rate * all.length), method: 'REST runner; Gemini established-English-title resolution + Google Books recall + Gemini flash-lite precision; errors excluded; RECALL FLOOR' };
writeFileSync('scripts/output/census-chinese-report.json', JSON.stringify(report, null, 2));
console.log('\n=== CHINESE TRANSLATION CENSUS ===');
console.log(`denominator ${all.length} | sample ${sample.length} | translated ${translated} untranslated ${untranslated} error ${errors}`);
console.log(`rate ${(rate * 100).toFixed(1)}%  (95% CI ${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}%)  → projected ~${report.projected_translated_works} translated works`);
console.log('NOTE: recall floor; Siku hand-verified ground truth ran ~2x higher.');

if (WRITE) {
  let wrote = 0;
  for (const w of sample) {
    const v = verdicts[w.id];
    if (v?.state !== 'translated') continue;
    const r = await fetch(`${URL}/rest/v1/works?id=eq.${encodeURIComponent(w.id)}&translation_status=eq.unknown`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ translation_status: v.complete ? 'full' : 'partial', translation_evidence: (v.reason || '').slice(0, 300), translation_method: 'census-auto' }) });
    if (r.ok) wrote++;
  }
  console.log(`wrote ${wrote} translated verdicts to works.translation_status (census-auto, unknown-only)`);
}
