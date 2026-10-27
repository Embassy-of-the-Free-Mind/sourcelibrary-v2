#!/usr/bin/env node
// PRIOR ART: the preregistered online check (a quoted web search per phrase) ran out of its 200-search session budget
// after one pass and found 1 of ~11 canonical Latin pages it searched (Lucan, Cicero, Terence came back empty), so it
// cannot carry a label. This replaces it with exact-phrase lookups that have no session budget (#7570, deviation
// recorded in the experiment file before the pairs were sealed). benchmark-refs.mjs aligns pages to LOCAL corpora;
// none of those covers Latin, Hebrew or Sanskrit, so the lookups here are remote.
/**
 * online.mjs — is this page's text online? Exact-phrase lookups for the #7570 pairs. No model call.
 *
 *   node scripts/eval/read-or-recall-7570/online.mjs [--calibrate=20]
 *
 * Pages: every screened OBSCURE candidate (seal.mjs screen), plus, as the instrument's calibration, the first N
 * screened FAMOUS Greek and Chinese pages (they carry an aligned e-text, so a lookup that misses them measures the
 * instrument's miss rate). Two phrases per page from the blind key, at 25% and 60% of its length: 5 words
 * (Chinese: 8 Han characters), punctuation and bracketed gaps removed.
 * Lookups per phrase:
 *   github   GitHub code search, exact phrase, all public repos (gh api search/code; 10 a minute) — Latin Library,
 *            Perseus, First1KGreek, Kanripo, Sefaria-Export, GRETIL and many corpora are on GitHub;
 *   kanripo  Chinese only: the same, restricted to the kanripo organisation;
 *   wikisource  CirrusSearch phrase search on la / el / zh / he / sa.wikisource;
 *   sefaria  Hebrew only: Sefaria's search API, exact field, slop 0.
 * A hit in this project's own repositories (Embassy-of-the-Free-Mind, JDerekLomas/source-library-texts) or on
 * sourcelibrary.org is labelled `self`; any other hit `etext`.
 * The first-pass web-search results ($JOB_SCRATCH/online/out-*.json) are merged as recorded.
 * Writes results/read-or-recall-7570/online.json (git-ignored: it holds phrases) and online-summary.json (no text).
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '../results/read-or-recall-7570');
const WEB = path.join(process.env.JOB_SCRATCH || '/tmp', 'online');
const CAL = Number((process.argv.find((a) => a.startsWith('--calibrate=')) || '=20').split('=')[1]);
const pools = JSON.parse(fs.readFileSync(path.join(RES, 'pools.json'), 'utf8')).pools;
const keys = new Map();
for (const l of fs.readFileSync(path.join(RES, 'keys.jsonl'), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (!keys.has(r.page_key) || !r.cls) keys.set(r.page_key, r); }
const phrasesFile = JSON.parse(fs.readFileSync(path.join(RES, 'phrases.json'), 'utf8')); // screened pages (seal.mjs phrases)
const OUT = path.join(RES, 'online.json');
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const WS = { latin: 'la', greek: 'el', chinese: 'zh', hebrew: 'he', sanskrit: 'sa' };
// This project's own text: its repos, Derek's text-export repo, and the site.
export const SELF = /Embassy-of-the-Free-Mind|JDerekLomas\/|sourcelibrary\.org/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shortPhrases(text, script) {
  const t = String(text || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (script === 'chinese') {
    const han = [...t].filter((ch) => /\p{Script=Han}/u.test(ch));
    return [0.25, 0.6].map((f) => han.slice(Math.floor(han.length * f), Math.floor(han.length * f) + 8).join(''));
  }
  let w = t.split(' ').map((x) => x.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '')).filter((x) => /\p{L}{2,}/u.test(x));
  if (script === 'hebrew') w = w.map((x) => x.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC'));
  return [0.25, 0.6].map((f) => w.slice(Math.floor(w.length * f), Math.floor(w.length * f) + 5).join(' '));
}

let lastGh = 0;
async function github(phrase, owner = null) {
  const wait = 6500 - (Date.now() - lastGh); if (wait > 0) await sleep(wait);
  lastGh = Date.now();
  const q = `"${phrase}"${owner ? ` org:${owner}` : ''}`;
  for (let i = 0; i < 4; i++) {
    try {
      const j = JSON.parse(execFileSync('gh', ['api', '-X', 'GET', 'search/code', '-f', `q=${q}`, '-f', 'per_page=5'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      return (j.items || []).map((it) => ({ url: it.html_url, repo: it.repository?.full_name }));
    } catch (e) { const m = String(e.stderr || e.message); if (/rate limit|secondary|403|429/i.test(m)) { await sleep(65_000); continue; } return { error: m.slice(0, 200) }; }
  }
  return { error: 'rate limited 4 times' };
}
async function wikisource(phrase, script) {
  const u = `https://${WS[script]}.wikisource.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(`"${phrase}"`)}`;
  try { const j = await (await fetch(u, { headers: { 'User-Agent': 'SourceLibrary-eval/7570 (dereklomas@gmail.com)' }, signal: AbortSignal.timeout(30_000) })).json();
    return (j.query?.search || []).map((s) => ({ url: `https://${WS[script]}.wikisource.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}` })); } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
}
async function sefaria(phrase) {
  try { const r = await fetch('https://www.sefaria.org/api/search-wrapper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ query: phrase, type: 'text', field: 'exact', slop: 0, size: 3 }) });
    const j = await r.json(); return (j.hits?.hits || []).map((h) => ({ url: `https://www.sefaria.org/${encodeURIComponent(h._id)}` })); } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
}

const todo = [];
for (const [k, v] of Object.entries(phrasesFile)) if (v.side === 'obscure') todo.push({ page_key: k, script: v.script, side: v.side });
for (const s of ['greek', 'chinese']) {
  let n = 0;
  for (const c of pools[s].famous) {
    const k = `${c.book_id}:${c.page_number}`, kr = keys.get(k);
    if (!kr || kr.cls || n >= CAL) continue; n++;
    todo.push({ page_key: k, script: s, side: 'famous', calibration: true });
  }
}
const webHits = {};
for (const f of fs.existsSync(WEB) ? fs.readdirSync(WEB).filter((f) => /^out-.*\.json$/.test(f)) : []) {
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(WEB, f), 'utf8')))) webHits[k] = v; } catch { /* a malformed batch file is skipped */ }
}
console.log(`${todo.length} pages (${todo.filter((t) => t.calibration).length} calibration); ${todo.filter((t) => !out[t.page_key]).length} to look up`);
for (const t of todo) {
  if (out[t.page_key]) continue;
  const ph = shortPhrases(keys.get(t.page_key).text, t.script);
  const hits = [], lookups = [];
  for (const p of ph) {
    if (!p || p.length < 6) continue;
    const runs = [['github', () => github(p)], ['wikisource', () => wikisource(p, t.script)]];
    if (t.script === 'chinese') runs.push(['kanripo', () => github(p, 'kanripo')]);
    if (t.script === 'hebrew') runs.push(['sefaria', () => sefaria(p)]);
    for (const [src, fn] of runs) {
      const r = await fn();
      lookups.push({ src, phrase: p, n: Array.isArray(r) ? r.length : null, error: r.error || null });
      if (Array.isArray(r)) for (const h of r) hits.push({ phrase: p, src, label: SELF.test(`${h.repo || ''} ${h.url}`) ? 'self' : 'etext', url: h.url });
    }
  }
  for (const h of webHits[t.page_key]?.hits || []) hits.push({ ...h, src: 'websearch' });
  out[t.page_key] = { script: t.script, side: t.side, calibration: !!t.calibration, checked_at: new Date().toISOString(), phrases: ph, lookups, hits, websearch_searches: webHits[t.page_key]?.searches ?? 0 };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`${t.script}/${t.side}${t.calibration ? '/cal' : ''} ${t.page_key} hits=${hits.filter((h) => h.label === 'etext').length} errors=${lookups.filter((l) => l.error).length}`);
}
// summary without text (labels re-derived with SELF, so rows written before the rule was fixed count the same)
const sum = {};
for (const v of Object.values(out)) {
  for (const h of v.hits) if (SELF.test(h.url || '')) h.label = 'self';
  const g = `${v.script}/${v.side}${v.calibration ? '/calibration' : ''}`; sum[g] ||= { pages: 0, with_etext_hit: 0, lookup_errors: 0, by_source: {} };
  sum[g].pages++; if (v.hits.some((h) => h.label === 'etext')) sum[g].with_etext_hit++;
  sum[g].lookup_errors += v.lookups.filter((l) => l.error).length;
  for (const src of new Set(v.hits.filter((h) => h.label === 'etext').map((h) => h.src))) sum[g].by_source[src] = (sum[g].by_source[src] || 0) + 1;
}
fs.writeFileSync(path.join(RES, 'online-summary.json'), JSON.stringify(sum, null, 1));
console.log(JSON.stringify(sum, null, 1));
