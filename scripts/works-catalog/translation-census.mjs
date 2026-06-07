#!/usr/bin/env node
/**
 * Translation census over a works-catalog tradition (#2453).
 *
 * First-ever English-translation gap numbers for the tibetan and islamicate
 * corpora, following the Siku census discipline (scripts/analysis/
 * siku-translation-census.mjs, #2234):
 *
 *  - DENOMINATOR: works rows for the tradition (seeded random sample).
 *  - RECALL: per-work searchable forms — romanized/English titles, plus a
 *    grounded Gemini resolution that supplies the ESTABLISHED English title
 *    iff one genuinely exists (null otherwise, no guessing). Candidates from
 *    Google Books (keyed, quota 1000/day) with OpenLibrary fallback.
 *  - PRECISION: Gemini (gemini-3.1-flash-lite) adjudicates whether any
 *    candidate is a genuine English translation of THIS work, and whether it
 *    is complete or partial.
 *  - DISCIPLINE: every work -> TRANSLATED | UNTRANSLATED | ERROR. Errors are
 *    counted separately and EXCLUDED from the rate, never scored as
 *    untranslated. Verdicts disk-cached per work id -> fully resumable
 *    (Google Books quota death mid-run is recoverable next day).
 *  - Remember: the automated number is a RECALL FLOOR (Siku lesson —
 *    hand-verified ground truth ran ~2x the automated rate).
 *
 * Usage (Hetzner):
 *   node scripts/works-catalog/translation-census.mjs --tradition islamicate [--sample 300] [--write]
 *   node scripts/works-catalog/translation-census.mjs --tradition tibetan    [--sample 300] [--write]
 *
 * --write: persist translated verdicts to works.translation_status as
 *          census-auto claims (full/partial per adjudication).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { pgClient, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const TRADITION = args[args.indexOf('--tradition') + 1];
const N = parseInt(args.includes('--sample') ? args[args.indexOf('--sample') + 1] : '300', 10);
const WRITE = args.includes('--write');
if (!['islamicate', 'tibetan'].includes(TRADITION)) {
  console.error('Usage: translation-census.mjs --tradition islamicate|tibetan [--sample N] [--write]');
  process.exit(1);
}

const UA = 'SourceLibrary-TranslationCensus/2.0 (derek@sourcelibrary.org)';
const GBOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const SEED = 42;
const CACHE_DIR = process.env.CENSUS_CACHE_DIR || '/root/works-catalog-cache';
mkdirSync(CACHE_DIR, { recursive: true });
const VERDICT_CACHE = `${CACHE_DIR}/census-${TRADITION}-verdicts.json`;
const verdicts = existsSync(VERDICT_CACHE) ? JSON.parse(readFileSync(VERDICT_CACHE, 'utf8')) : {};
const persist = () => writeFileSync(VERDICT_CACHE, JSON.stringify(verdicts, null, 1));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

async function gemini(prompt) {
  const u = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } };
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try { r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { await sleep(1500); continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(2500); continue; }
    if (!r.ok) return null;
    const txt = (await r.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
    try { return JSON.parse(txt); } catch { /* parse-inside-retry */ }
  }
  return null;
}

// --- searchable-form resolution (per tradition) -----------------------------
async function resolveForms(w) {
  if (TRADITION === 'islamicate') {
    const j = await gemini(`A premodern Islamicate (Arabic) work:
Arabic title: ${w.title}
Romanized title: ${w.title_romanized || '(none)'}
Author: ${w.author || '(unknown)'} (d. ${w.extra?.author_death_ce || '?'} CE)

Respond JSON only: {"english_title": "<established English title>"|null}
Rules: give "english_title" ONLY if there is a genuinely established, widely-used English title for THIS SPECIFIC work (e.g. "The Revival of the Religious Sciences" for Ihya Ulum al-Din). Do NOT invent a literal translation or guess — if no standard English title exists, use null.`);
    const forms = [];
    if (j?.english_title) forms.push(j.english_title);
    if (w.title_romanized) {
      forms.push(w.title_romanized);
      if (w.author) forms.push(`${w.title_romanized} ${w.author}`);
    }
    return { forms: [...new Set(forms)].slice(0, 3), resolved: j?.english_title || null };
  }
  // tibetan: Wylie in title_romanized, Tibetan unicode in title
  const j = await gemini(`A Tibetan work from the BDRC catalog:
Wylie transliteration: ${w.title_romanized || '(none)'}
Tibetan title: ${w.title}
Catalog entry (may include author): ${w.title_english || '(none)'}

Respond JSON only: {"english_title": "<established English title>"|null}
Rules: give "english_title" ONLY if there is a genuinely established, widely-used English title for THIS SPECIFIC work (e.g. "The Life of Milarepa" for mi la ras pa'i rnam thar, "The Words of My Perfect Teacher" for kun bzang bla ma'i zhal lung). Many BDRC records are local manuscript collections, ritual texts, or editions with NO English translation tradition — for those use null. Do NOT invent a literal translation or guess.`);
  const forms = [];
  if (j?.english_title) forms.push(j.english_title);
  if (w.title_romanized && w.title_romanized.length >= 8) forms.push(`"${w.title_romanized.replace(/\s*\/$/, '')}"`);
  return { forms: [...new Set(forms)].slice(0, 3), resolved: j?.english_title || null };
}

// --- candidate recall (Google Books + OpenLibrary fallback) -----------------
async function gbCandidates(forms) {
  const cands = [], seen = new Set(); let err = false;
  for (const q of forms.slice(0, 3)) {
    const u = `https://www.googleapis.com/books/v1/volumes?maxResults=5&langRestrict=en&country=US&q=${encodeURIComponent(q)}&key=${GBOOKS_KEY}`;
    let r;
    try { r = await fetch(u, { headers: { 'User-Agent': UA } }); }
    catch { err = true; await sleep(700); continue; }
    if (r.status === 429 || r.status >= 500) { err = true; await sleep(1500); continue; }
    if (!r.ok) { await sleep(250); continue; }
    const d = await r.json();
    for (const it of (d.items || [])) {
      const vi = it.volumeInfo || {};
      if (vi.language !== 'en') continue;
      const key = (vi.title || '') + '|' + (vi.publishedDate || '');
      if (seen.has(key)) continue; seen.add(key);
      cands.push({ title: vi.title, subtitle: vi.subtitle, authors: vi.authors, year: vi.publishedDate, desc: (vi.description || '').slice(0, 200) });
    }
    await sleep(300);
    if (cands.length >= 8) break;
  }
  if (err || cands.length === 0) {
    for (const f of forms.slice(0, 2)) {
      const u = `https://openlibrary.org/search.json?language=eng&limit=4&fields=title,author_name,first_publish_year&q=${encodeURIComponent(f.replace(/"/g, ''))}`;
      let r;
      try { r = await fetch(u, { headers: { 'User-Agent': UA } }); } catch { continue; }
      if (!r.ok) { await sleep(400); continue; }
      const d = await r.json();
      for (const doc of (d.docs || [])) {
        const key = (doc.title || '') + '|ol';
        if (seen.has(key)) continue; seen.add(key);
        cands.push({ title: doc.title, authors: doc.author_name, year: doc.first_publish_year, desc: '' });
      }
      await sleep(400);
      if (cands.length >= 8) break;
    }
    if (cands.length > 0) err = false;
  }
  return { cands, err };
}

// --- adjudication ------------------------------------------------------------
async function adjudicate(w, resolved, cands) {
  const desc = TRADITION === 'islamicate'
    ? `a premodern Islamicate (Arabic) work:\n- Arabic title: ${w.title}\n- Romanized: ${w.title_romanized || ''}\n- Author: ${w.author || '?'} (d. ${w.extra?.author_death_ce || '?'} CE)`
    : `a Tibetan work:\n- Wylie: ${w.title_romanized || ''}\n- Tibetan: ${w.title}\n- Catalog entry: ${w.title_english || ''}`;
  const j = await gemini(`You are verifying whether a published ENGLISH translation of a specific premodern work exists.

WORK — ${desc}
${resolved ? `- Established English title (resolved): ${resolved}` : ''}

CANDIDATE English-language books found via Google Books / OpenLibrary:
${cands.map((c, i) => `${i + 1}. "${c.title}${c.subtitle ? ': ' + c.subtitle : ''}" (${c.year || '?'}) by ${(c.authors || []).join(', ') || '?'} — ${c.desc || ''}`).join('\n') || '(no candidates found)'}

Decide: is at least one candidate a genuine English translation of THIS specific work (not a book that merely mentions or studies it, not a different work matching by keyword)? Excerpt anthologies count only as PARTIAL. If no candidates, answer false.

Respond JSON only: {"translated": boolean, "which": <number|null>, "complete": boolean, "confidence": "high"|"medium"|"low", "reason": "<one short sentence>"}`);
  if (!j) return { state: 'error' };
  return { state: j.translated ? 'translated' : 'untranslated', ...j };
}

// --- main ---------------------------------------------------------------------
const client = pgClient();
await client.connect();
// Pre-1900 scope: OpenITI carries modern authors (century = author death CE),
// so exclude century > 19 from the islamicate denominator. Tibetan/etc. are
// already purified into their own traditions, so no filter needed there.
const scopeFilter = TRADITION === 'islamicate' ? `and (century is null or century <= 19)` : '';
const all = (await client.query(
  `select id, title, title_romanized, title_english, author, extra from works
   where tradition = $1 ${scopeFilter} order by id`,
  [TRADITION])).rows;
const rng = mulberry32(SEED);
const sample = [...all].map(w => [rng(), w]).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, N);
console.log(`${TRADITION}: ${all.length} works, sampling ${sample.length} (seed ${SEED})`);

let done = 0;
for (const w of sample) {
  if (verdicts[w.id]) { done++; continue; }
  try {
    const { forms, resolved } = await resolveForms(w);
    if (forms.length === 0) {
      verdicts[w.id] = { state: 'untranslated', reason: 'no searchable form (no established English title, short Wylie)' };
    } else {
      const { cands, err } = await gbCandidates(forms);
      if (err && cands.length === 0) verdicts[w.id] = { state: 'error', reason: 'recall sources unavailable' };
      else if (cands.length === 0) verdicts[w.id] = { state: 'untranslated', reason: 'no English candidates' };
      else verdicts[w.id] = { ...(await adjudicate(w, resolved, cands)), resolved };
    }
  } catch (e) {
    verdicts[w.id] = { state: 'error', reason: e.message.slice(0, 80) };
  }
  done++;
  if (done % 10 === 0) { persist(); process.stderr.write(`${done}/${sample.length}\n`); }
}
persist();

// --- report -------------------------------------------------------------------
const states = sample.map(w => ({ id: w.id, ...verdicts[w.id] }));
const tr = states.filter(s => s.state === 'translated');
const un = states.filter(s => s.state === 'untranslated').length;
const er = states.filter(s => s.state === 'error').length;
const pool = tr.length + un;
const rate = pool ? tr.length / pool : 0;
const [lo, hi] = wilson(tr.length, pool);
const report = {
  tradition: TRADITION,
  denominator: all.length,
  sampled: sample.length,
  translated: tr.length,
  untranslated: un,
  errors_excluded: er,
  rate, ci95: [lo, hi],
  projected_translated_works: [Math.round(lo * all.length), Math.round(hi * all.length)],
  method: 'works-catalog denominator; Gemini established-title resolution; Google Books+OpenLibrary recall; Gemini precision; errors excluded; automated number is a recall floor',
  hits: tr.map(t => ({ id: t.id, resolved: t.resolved, evidence: states.find(s => s.id === t.id), confidence: t.confidence })),
};
writeFileSync(`${CACHE_DIR}/census-${TRADITION}-report.json`, JSON.stringify(report, null, 2));
console.log(`\n${TRADITION}: translated ${tr.length}/${pool} = ${(rate * 100).toFixed(1)}% (95% CI ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}%), ${er} errors excluded`);
console.log(`projected translated works: ${report.projected_translated_works.join('–')} of ${all.length}`);
for (const t of tr) console.log(`  HIT ${t.id} ${t.resolved || ''} — ${t.reason}`);

if (WRITE) {
  let wrote = 0;
  for (const t of tr) {
    const r = await client.query(
      `update works set translation_status = $2, translation_evidence = $3, translation_method = 'census-auto', updated_at = now()
       where id = $1 and translation_status = 'unknown'`,
      [t.id, t.complete ? 'full' : 'partial', (t.reason || '').slice(0, 300)]);
    wrote += r.rowCount;
  }
  console.log(`wrote ${wrote} census-auto claims`);
}
await client.end();
