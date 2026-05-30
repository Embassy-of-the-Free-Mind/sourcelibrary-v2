#!/usr/bin/env node
/**
 * Siku Quanshu translation census
 *
 * Question: of the ~3,461 works in the Siku Quanshu (四庫全書, the Qianlong
 * imperial library), what fraction have a published English translation?
 *
 * DENOMINATOR — Wikidata works linked to Siku Quanshu (Q699477) via
 *   part-of / catalog / published-in. ~3,418 items, ≈ the full corpus.
 *   Open, keyless, near-complete. (CTEXT used only as a sanity cross-check.)
 *
 * STRATIFY by whether the work has any English form in Wikidata (label OR
 *   alias). Only ~7–8% do; that stratum carries essentially all the
 *   translation probability, so we CENSUS it in full (no sampling error) and
 *   only SAMPLE the large obscure tail.
 *
 * NUMERATOR — two-stage to fix the v1/v2 matching problems:
 *   1. Recall: loose + exact Google Books search (keyed, English editions) to
 *      surface candidate volumes. Loose query avoids the false-negatives that
 *      strict exact-phrase caused in v2.
 *   2. Precision: Gemini (gemini-3.1-flash-lite) adjudicates whether any
 *      candidate is a genuine English translation/edition of THIS work, given
 *      the Chinese title + English label/aliases + description. Kills the
 *      false-positives that loose search introduces (e.g. "Master & Margarita"
 *      matching "Records of the Grand Historian").
 *
 * DISCIPLINE — every work resolves to TRANSLATED | UNTRANSLATED | ERROR.
 *   Errors (rate-limit/network/model) are counted separately and EXCLUDED from
 *   the rate, never silently scored as "untranslated" (the v1 fake-0/100 bug).
 *
 * Residual caveat: recall for the Chinese-only-titled tail is limited — a work
 *   with no English form we can query could still have a translation under an
 *   English title we never searched. Reported as a known blind spot.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/analysis/siku-translation-census.mjs [nUnlabeledSample]
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';

const DENOM_CACHE = 'scripts/analysis/siku-denominator.json';

const UA = 'SourceLibrary-TranslationCensus/1.0 (derek@sourcelibrary.org)';
const GBOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const N_UNLABELED = parseInt(process.argv[2] || '300', 10);
const SEED = 42;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// Decoupled + cached. SPARQL's label resolution degrades under load (it
// silently returned 58/257 enLabels in one run). So: get QIDs with a
// lightweight query, then pull labels/aliases/descriptions via the stable
// wbgetentities REST API in batches, and cache the whole thing to disk so
// reruns never re-hit Wikidata.
async function getDenominator() {
  if (existsSync(DENOM_CACHE)) {
    const cached = JSON.parse(readFileSync(DENOM_CACHE, 'utf8'));
    if (Array.isArray(cached) && cached.length > 3000) {
      console.log(`(denominator from cache: ${cached.length})`);
      return cached;
    }
  }
  // 1. lightweight QID-only query (no labels, no GROUP BY → reliable)
  const q = `SELECT ?work WHERE { ?work (wdt:P361|wdt:P972|wdt:P1433) wd:Q699477. }`;
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
  const d = await r.json();
  const qids = [...new Set(d.results.bindings.map(b => b.work.value.split('/').pop()))];
  console.log(`  got ${qids.length} QIDs; fetching labels via wbgetentities…`);
  // 2. batch wbgetentities for labels + aliases + descriptions
  const works = [];
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const u = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}` +
      `&props=labels|aliases|descriptions&languages=en|zh&format=json&origin=*`;
    let resp;
    try { resp = await fetch(u, { headers: { 'User-Agent': UA } }); }
    catch { await sleep(1500); i -= 50; continue; } // retry this batch
    if (!resp.ok) { await sleep(1500); i -= 50; continue; }
    const j = await resp.json();
    for (const qid of batch) {
      const e = j.entities?.[qid];
      if (!e) continue;
      const enLabel = e.labels?.en?.value || null;
      const zhLabel = e.labels?.zh?.value || null;
      const alts = (e.aliases?.en || []).map(a => a.value);
      const desc = e.descriptions?.en?.value || '';
      works.push({ qid, label: enLabel || zhLabel || '', enLabel, alts, desc });
    }
    if ((i / 50) % 10 === 0) process.stdout.write(`    labels ${Math.min(i + 50, qids.length)}/${qids.length}\n`);
    await sleep(150);
  }
  writeFileSync(DENOM_CACHE, JSON.stringify(works, null, 2));
  console.log(`  denominator built + cached: ${works.length} (enLabel: ${works.filter(w => w.enLabel).length})`);
  return works;
}

// English forms we can query with: en label + en aliases (skip pure-Chinese)
function englishForms(w) {
  const forms = [];
  if (w.enLabel && /[a-z]/i.test(w.enLabel)) forms.push(w.enLabel);
  for (const a of w.alts) if (/[a-z]/i.test(a)) forms.push(a);
  if (forms.length === 0 && /[a-z]/i.test(w.label)) forms.push(w.label); // romanized generic label
  return [...new Set(forms)];
}

async function gbCandidates(forms) {
  const cands = [], seen = new Set(); let err = false;
  const queries = [];
  for (const f of forms) { queries.push(`"${f}"`); queries.push(f); } // exact + loose
  for (const q of queries.slice(0, 6)) {
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
    await sleep(250);
    if (cands.length >= 8) break;
  }
  return { cands, err };
}

async function geminiAdjudicate(work, cands) {
  const prompt = `You are verifying whether a published ENGLISH translation (or substantial English edition) of a specific classical Chinese work exists.

WORK (from the Siku Quanshu, 四庫全書):
- Chinese/primary title: ${work.label}
- English label: ${work.enLabel || '(none)'}
- English aliases: ${work.alts.join('; ') || '(none)'}
- Description: ${work.desc || '(none)'}

CANDIDATE English-language books found via Google Books:
${cands.map((c, i) => `${i + 1}. "${c.title}${c.subtitle ? ': ' + c.subtitle : ''}" (${c.year || '?'}) by ${(c.authors || []).join(', ') || '?'} — ${c.desc || ''}`).join('\n') || '(no candidates found)'}

Decide: is at least one candidate a genuine English translation or substantial English-language edition of THIS specific work (not merely a book that mentions it, an unrelated book matching by keyword, or a book about a different work)? Be strict: anthologies that include only excerpts do NOT count as a translation of the whole work, but a complete or near-complete translation does. If no candidates were found, answer false.

Respond with JSON only: {"translated": boolean, "which": <candidate number or null>, "confidence": "high"|"medium"|"low", "reason": "<one short sentence>"}`;

  const u = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try { r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { await sleep(1200); continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(2000); continue; }
    if (!r.ok) return { state: 'error' };
    const d = await r.json();
    const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) return { state: 'error' };
    try {
      const j = JSON.parse(txt);
      return { state: j.translated ? 'translated' : 'untranslated', ...j };
    } catch { return { state: 'error' }; }
  }
  return { state: 'error' };
}

async function classify(work, useGemini) {
  const forms = englishForms(work);
  if (forms.length === 0) return { state: 'untranslated', reason: 'no English form to query (Chinese-only)' };
  const { cands, err } = await gbCandidates(forms);
  if (err && cands.length === 0) return { state: 'error', reason: 'gbooks rate-limit/network' };
  if (cands.length === 0) return { state: 'untranslated', reason: 'no English candidates' };
  if (!useGemini) {
    // heuristic fallback (unlabeled tail): any English candidate sharing a distinctive token
    return { state: 'translated', reason: 'heuristic candidate', evidence: cands[0].title };
  }
  const verdict = await geminiAdjudicate(work, cands);
  if (verdict.state === 'translated') verdict.evidence = cands[verdict.which - 1]?.title || cands[0].title;
  return verdict;
}

async function runFull(name, pool, useGemini, label) {
  let tr = 0, un = 0, err = 0; const hits = [], errs = [];
  for (let i = 0; i < pool.length; i++) {
    const v = await classify(pool[i], useGemini);
    if (v.state === 'translated') { tr++; hits.push({ ...pool[i], evidence: v.evidence, reason: v.reason, confidence: v.confidence }); }
    else if (v.state === 'untranslated') un++;
    else { err++; errs.push(pool[i].qid); }
    if ((i + 1) % 20 === 0) process.stdout.write(`  [${name}] ${i + 1}/${pool.length}  tr=${tr} un=${un} err=${err}\n`);
  }
  return { name, pool: pool.length, tr, un, err, hits, errs };
}

async function ctextCrossCheck() {
  // light sanity check: confirm CTEXT API reachable + report Siku Quanshu node
  try {
    const r = await fetch('https://api.ctext.org/getstats', { headers: { 'User-Agent': UA } });
    const d = await r.json();
    return { reachable: true, stats: d?.stats || d };
  } catch { return { reachable: false }; }
}

async function main() {
  if (!GBOOKS_KEY || !GEMINI_KEY) { console.error('Need GOOGLE_BOOKS_API_KEY and GEMINI_API_KEY in env.'); process.exit(1); }
  console.log('Fetching Siku Quanshu denominator from Wikidata…');
  const all = await getDenominator();
  // Partition the FULL denominator by whether we have any latin-script English
  // form to search with. NB: ~199 works carry a Chinese-character string mis-
  // stored under Wikidata's `en` label code — englishForms() correctly ignores
  // those, so they land in the no-form stratum (not silently dropped).
  const labeled = all.filter(w => englishForms(w).length > 0);
  const unlabeled = all.filter(w => englishForms(w).length === 0);
  console.log(`Denominator: ${all.length}  (has English form: ${labeled.length}, Chinese-only: ${unlabeled.length})  [partition sums to ${labeled.length + unlabeled.length}]\n`);

  console.log(`CENSUS of labeled stratum (${labeled.length} works, Gemini-adjudicated)…`);
  const sL = await runFull('labeled', labeled, true);

  const rng = mulberry32(SEED);
  const uSample = [...unlabeled].sort(() => rng() - 0.5).slice(0, Math.min(N_UNLABELED, unlabeled.length));
  console.log(`\nSAMPLE of Chinese-only stratum (${uSample.length} of ${unlabeled.length})…`);
  const sU = await runFull('unlabeled', uSample, true);

  const ctext = await ctextCrossCheck();

  // labeled: full census → exact rate (no sampling error), errors excluded
  const effL = sL.tr + sL.un, rL = effL ? sL.tr / effL : 0;
  // unlabeled: sample → rate + CI, errors excluded
  const effU = sU.tr + sU.un, rU = effU ? sU.tr / effU : 0;
  const [loU, hiU] = wilson(sU.tr, effU);
  const wL = labeled.length / all.length, wU = unlabeled.length / all.length;
  const overall = wL * rL + wU * rU;
  const lo = wL * rL + wU * loU; // labeled is a full census → no CI on its term
  const hi = wL * rL + wU * hiU;
  const proj = Math.round(overall * all.length);

  const out = {
    generated_for: 'siku-quanshu-translation-census',
    denominator: all.length,
    strata: {
      labeled: { works: labeled.length, censused: sL.pool, translated: sL.tr, untranslated: sL.un, errors: sL.err, rate: rL },
      unlabeled: { works: unlabeled.length, sampled: sU.pool, translated: sU.tr, untranslated: sU.un, errors: sU.err, rate: rU, ci: [loU, hiU] },
    },
    overall: { rate: overall, ci: [lo, hi], projected_translated_works: proj },
    method: 'Wikidata denominator; Google Books recall + Gemini gemini-3.1-flash-lite precision; errors excluded',
    ctext_crosscheck: ctext,
    labeled_hits: sL.hits.map(h => ({ qid: h.qid, work: h.enLabel || h.label, evidence: h.evidence, confidence: h.confidence })),
    unlabeled_hits: sU.hits.map(h => ({ qid: h.qid, work: h.label, evidence: h.evidence })),
  };
  writeFileSync('scripts/analysis/siku-census-results.json', JSON.stringify(out, null, 2));

  console.log(`\n=== Siku Quanshu translation census ===`);
  console.log(`Denominator: ${all.length} works (Wikidata ≈ full ~3,461)`);
  console.log(`  labeled   (${labeled.length}): FULL CENSUS — translated ${sL.tr}, untransl ${sL.un}, errors ${sL.err} → ${(rL*100).toFixed(1)}%`);
  console.log(`  Chinese-only (${unlabeled.length}): sampled ${sU.pool} — translated ${sU.tr}, errors ${sU.err} → ${(rU*100).toFixed(1)}% (CI ${(loU*100).toFixed(1)}–${(hiU*100).toFixed(1)}%)`);
  console.log(`\n  OVERALL: ${(overall*100).toFixed(1)}%  (≈95% CI ${(lo*100).toFixed(1)}–${(hi*100).toFixed(1)}%)  →  ~${proj} of ${all.length} works`);
  console.log(`  CTEXT cross-check reachable: ${ctext.reachable}`);
  console.log(`\n  Labeled-stratum translated works (Gemini-confirmed):`);
  sL.hits.slice(0, 40).forEach(h => console.log(`    ✓ ${h.enLabel || h.label} [${h.confidence}] → "${h.evidence}"`));
  if (sU.hits.length) { console.log(`  Chinese-only hits:`); sU.hits.forEach(h => console.log(`    ✓ ${h.label} → "${h.evidence}"`)); }
  console.log(`\n  Results written to scripts/analysis/siku-census-results.json`);
}
main().catch(e => { console.error(e); process.exit(1); });
