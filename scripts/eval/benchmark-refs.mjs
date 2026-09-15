#!/usr/bin/env node
// PRIOR ART: build-ctext-groundtruth.mjs / build-reference-groundtruth.mjs pin a SHORT curated
// passage (a work's opening) to the one page that prints it — they answer "which of our pages
// prints this passage", not "what does THIS sealed page print". This does the inverse for the
// sealed benchmark pages: identify the work from a model's read of the page, fetch the canon
// e-text for that juan, and cut the window that best matches the page. The window-by-n-gram-vote
// idea is `kanjur_align.score_page` (Hetzner, Tibetan/Derge); this is the same move over CBETA
// (full-text search → juan HTML) and Kanripo (catalogue → juan files).
/**
 * benchmark-refs.mjs — build page-level reference windows for the Chinese benchmark pages.
 *
 *   node scripts/eval/benchmark-refs.mjs --root=/path/bench-images --stratum=chinese \
 *        [--probe=gemini-3-flash-preview,gemini-3.1-flash-lite] [--only=slug] [--dry]
 *
 * For each sealed page: take the probe engines' outputs (Han chars only), (1) BUDDHIST sub-stratum:
 * search CBETA with several 8-char phrases, keep a work+juan that ≥2 phrases agree on, fetch the
 * juan; (2) OTHER: match the catalogue title to Kanripo (KR-Catalog), read the juan number(s)
 * from the title, fetch the juan file(s). Then vote 4-gram positions of the probe text against the
 * e-text, cut a window of ~1.3× the probe length around the densest region, and require ≥ 0.35
 * 4-gram overlap or the page gets NO reference (recorded with the reason). Writes
 * scripts/eval/benchmark/refs/<slug>.txt and <slug>.json {source, work, juan, url, overlap}.
 * Never writes to Mongo. CBETA is credited as the source and not re-hosted beyond the window.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root'); const STRATUM = argOf('stratum', 'chinese');
const PROBES = argOf('probe', 'gemini-3-flash-preview,gemini-3.1-flash-lite').split(',');
const ONLY = argOf('only'); const DRY = process.argv.includes('--dry');
const REFS = path.join(__dirname, 'benchmark', 'refs'); fs.mkdirSync(REFS, { recursive: true });
const CATALOG = argOf('kanripo-catalog', '/Users/dereklomas/.claude/jobs/417569c5/tmp/refs/kanripo');
const MIN_OVERLAP = 0.35;

const han = s => [...String(s || '').normalize('NFC')].filter(c => /\p{Script=Han}/u.test(c)).join('');
const grams = (s, n = 4) => { const g = new Map(); for (let i = 0; i + n <= s.length; i++) { const k = s.slice(i, i + n); if (!g.has(k)) g.set(k, []); g.get(k).push(i); } return g; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url) { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function getText(url) { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }

// Best window of the e-text for a probe: vote every probe 4-gram's positions in the e-text,
// smooth over a probe-length window, take the densest start; overlap = distinct probe 4-grams
// found inside the window / distinct probe 4-grams.
function bestWindow(etext, probe) {
  const E = grams(etext), P = grams(probe);
  const L = Math.max(60, Math.round(probe.length * 1.3));
  const votes = new Float64Array(etext.length + 1);
  for (const [g, _] of P) { const pos = E.get(g); if (!pos || pos.length > 50) continue; for (const p of pos) votes[p] += 1 / pos.length; }
  // prefix sums → densest window
  let best = 0, bestAt = 0, run = 0;
  for (let i = 0; i < votes.length; i++) { run += votes[i]; if (i >= L) run -= votes[i - L]; if (run > best) { best = run; bestAt = Math.max(0, i - L + 1); } }
  const start = Math.max(0, bestAt - Math.round(L * 0.15)), end = Math.min(etext.length, bestAt + L + Math.round(L * 0.15));
  const win = etext.slice(start, end);
  const W = grams(win); let hit = 0; for (const g of P.keys()) if (W.has(g)) hit++;
  return { window: win, start, end, overlap: P.size ? hit / P.size : 0 };
}
// Trim the window to the probe: drop e-text at either end that the probe never touches.
function trimWindow(win, probe) {
  const P = grams(probe); let first = -1, last = -1;
  for (let i = 0; i + 4 <= win.length; i++) if (P.has(win.slice(i, i + 4))) { if (first < 0) first = i; last = i + 4; }
  return first < 0 ? win : win.slice(Math.max(0, first - 8), Math.min(win.length, last + 8));
}

// ── CBETA ──
async function cbetaLookup(probe) {
  const phrases = []; const step = Math.max(8, Math.floor(probe.length / 6));
  for (let i = 8; i + 8 <= probe.length && phrases.length < 5; i += step) phrases.push(probe.slice(i, i + 8));
  const votes = new Map();
  for (const ph of phrases) {
    try {
      const j = await getJson(`https://cbdata.dila.edu.tw/stable/search?q=${encodeURIComponent(ph)}&rows=5`);
      const seen = new Set();
      for (const r of (j.results || []).slice(0, 5)) { const k = `${r.work}|${r.juan}`; if (seen.has(k)) continue; seen.add(k); votes.set(k, (votes.get(k) || 0) + 1); }
    } catch (e) { /* phrase not found or API hiccup */ }
    await sleep(300);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2) return null;
  const [work, juan] = ranked[0][0].split('|');
  const j = await getJson(`https://cbdata.dila.edu.tw/stable/juans?work=${work}&juan=${juan}`);
  const html = (j.results || [])[0] || '';
  const text = han(html.replace(/<[^>]+>/g, ''));
  return { source: 'CBETA', work, juan: +juan, url: `https://cbetaonline.dila.edu.tw/${work}_${String(juan).padStart(3, '0')}`, etext: text, votes: ranked[0][1] };
}

// ── Kanripo ──
let catalog = null;
function loadCatalog() {
  if (catalog) return catalog; catalog = [];
  for (const f of fs.readdirSync(CATALOG).filter(f => /^KR\d[a-z]\.txt$/.test(f))) for (const line of fs.readFileSync(path.join(CATALOG, f), 'utf8').split('\n')) {
    const m = line.match(/^\*\*\* (KR\w+) (.+)$/); if (m) catalog.push({ id: m[1], title: m[2].split('-')[0].trim(), full: m[2] });
  }
  return catalog;
}
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnNumber(s) { // 卷十六 → 16 ; 卷一百四十 → 140
  let n = 0, cur = 0;
  for (const c of s) { if (c === '百') { n += (cur || 1) * 100; cur = 0; } else if (c === '十') { n += (cur || 1) * 10; cur = 0; } else if (CN_NUM[c]) cur = CN_NUM[c]; }
  return n + cur;
}
async function kanripoLookup(title) {
  const cat = loadCatalog();
  const base = title.split('·')[0].split('(')[0].split(' ')[0].replace(/[（(].*$/, '').trim();
  const cands = cat.filter(c => c.title === base) .concat(cat.filter(c => c.title !== base && base.length >= 3 && (c.title.startsWith(base) || base.startsWith(c.title))));
  if (!cands.length) return null;
  const juanMatch = title.match(/卷([一二三四五六七八九十百]+)(?:上|中|下)?(?:[~～-]卷?([一二三四五六七八九十百]+))?/);
  let juans = juanMatch ? [cnNumber(juanMatch[1])] : [1];
  if (juanMatch && juanMatch[2]) { const b = cnNumber(juanMatch[2]); for (let j = juans[0] + 1; j <= b && juans.length < 6; j++) juans.push(j); }
  for (const c of cands.slice(0, 3)) {
    let etext = '';
    for (const j of juans) {
      try { etext += han((await getText(`https://raw.githubusercontent.com/kanripo/${c.id}/master/${c.id}_${String(j).padStart(3, '0')}.txt`)).replace(/^#.*$/gm, '').replace(/<pb:[^>]+>/g, '')); }
      catch (e) { /* juan file absent under this witness */ }
    }
    if (etext.length > 200) return { source: 'Kanripo', work: c.id, work_title: c.full, juan: juans.join(','), url: `https://github.com/kanripo/${c.id}`, etext };
  }
  return null;
}

// ── Word-script local corpus (Syriac: Digital Syriac Corpus, CC BY 4.0, flattened by the
// fetch-syriac-corpus.py scratch script into <dir>/<id>.txt + index.json) ──
// Identify the text by shared word BIGRAMS with the best-reading engine, then cut the window by
// word-position voting. Word-level because a Syriac "page" is ~150–300 words.
const SYR_RE = /[܀-ݏ]+/g;
const CORPUS_DIR = argOf('corpus', '/Users/dereklomas/.claude/jobs/417569c5/tmp/refs/syriac');
let corpusIdx = null;
function loadCorpus() {
  if (corpusIdx) return corpusIdx;
  const texts = new Map(); const inv = new Map();
  for (const f of fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.txt'))) {
    const id = f.slice(0, -4); const words = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8').split(' ').filter(Boolean);
    texts.set(id, words);
    for (let i = 0; i + 1 < words.length; i++) { const k = words[i] + ' ' + words[i + 1]; let s = inv.get(k); if (!s) { s = new Set(); inv.set(k, s); } s.add(id); }
  }
  const index = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'index.json'), 'utf8'));
  corpusIdx = { texts, inv, index }; return corpusIdx;
}
function wordWindow(words, probeWords) {
  const P = new Set(); for (let i = 0; i + 1 < probeWords.length; i++) P.add(probeWords[i] + ' ' + probeWords[i + 1]);
  const L = Math.max(40, Math.round(probeWords.length * 1.3));
  const votes = new Float64Array(words.length + 1);
  for (let i = 0; i + 1 < words.length; i++) if (P.has(words[i] + ' ' + words[i + 1])) votes[i] = 1;
  let best = 0, at = 0, run = 0;
  for (let i = 0; i < votes.length; i++) { run += votes[i]; if (i >= L) run -= votes[i - L]; if (run > best) { best = run; at = Math.max(0, i - L + 1); } }
  const s = Math.max(0, at - Math.round(L * 0.15)), e = Math.min(words.length, at + L + Math.round(L * 0.15));
  let first = -1, last = -1; for (let i = s; i + 1 < e; i++) if (P.has(words[i] + ' ' + words[i + 1])) { if (first < 0) first = i; last = i + 2; }
  const win = first < 0 ? words.slice(s, e) : words.slice(Math.max(s, first - 5), Math.min(e, last + 5));
  return { window: win.join(' '), overlap: P.size ? best / P.size : 0, shared: best };
}
async function corpusLookup(probeByEngine) {
  const { texts, inv, index } = loadCorpus();
  let bestHit = null;
  for (const [engine, text] of Object.entries(probeByEngine)) {
    const pw = (text.match(SYR_RE) || []); if (pw.length < 20) continue;
    const counts = new Map();
    for (let i = 0; i + 1 < pw.length; i++) { const ids = inv.get(pw[i] + ' ' + pw[i + 1]); if (!ids || ids.size > 30) continue; for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1); }
    for (const [id, c] of counts) if (!bestHit || c > bestHit.shared) bestHit = { id, shared: c, engine, probeWords: pw };
  }
  if (!bestHit || bestHit.shared < 8) return null;
  const w = wordWindow(texts.get(bestHit.id), bestHit.probeWords);
  return { source: 'Digital Syriac Corpus', work: bestHit.id, work_title: index[bestHit.id]?.title || null, url: `https://syriaccorpus.org/${bestHit.id}`, window: w.window, overlap: w.overlap, probe_engine: bestHit.engine, shared_bigrams: bestHit.shared };
}

// ── main ──
const reg = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark', `${STRATUM}.json`), 'utf8'));
if (STRATUM === 'syriac') {
  const pages = reg.pages.filter(p => (!p.spare || p.promoted) && !p.retired && (!ONLY || p.slug === ONLY));
  const outRoot = path.join(ROOT, STRATUM, 'out');
  const engines = fs.existsSync(outRoot) ? fs.readdirSync(outRoot) : [];
  let built = 0, none = 0;
  for (const p of pages) {
    const outTxt = path.join(REFS, `${p.slug}.txt`), outJson = path.join(REFS, `${p.slug}.json`);
    const probes = {}; for (const e of engines) { const f = path.join(outRoot, e, `${p.slug}.txt`); if (fs.existsSync(f)) probes[e] = fs.readFileSync(f, 'utf8'); }
    const note = { slug: p.slug, substratum: p.substratum, title: p.title, probes: Object.keys(probes) };
    const src = await corpusLookup(probes);
    if (!src || src.overlap < 0.25) { note.reason = src ? `best text ${src.work} overlap ${src.overlap.toFixed(2)} < 0.25` : 'no corpus text shares ≥ 8 word bigrams with any engine output'; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); none++; console.log(`  – ${p.slug}: ${note.reason}`); continue; }
    Object.assign(note, { source: src.source, work: src.work, work_title: src.work_title, url: src.url, overlap: +src.overlap.toFixed(3), probe_engine: src.probe_engine, shared_bigrams: src.shared_bigrams, window_words: src.window.split(' ').length });
    if (!DRY) { fs.writeFileSync(outTxt, src.window); fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); }
    built++; console.log(`  ✓ ${p.slug}: ${src.work} (${src.work_title}) overlap ${src.overlap.toFixed(2)} via ${src.probe_engine}`);
  }
  console.log(`\nsyriac: ${built} references, ${none} without`);
  process.exit(0);
}
const pages = reg.pages.filter(p => (!p.spare || p.promoted) && !p.retired && (!ONLY || p.slug === ONLY));
let built = 0, none = 0;
for (const p of pages) {
  const outTxt = path.join(REFS, `${p.slug}.txt`), outJson = path.join(REFS, `${p.slug}.json`);
  if (fs.existsSync(outJson) && !ONLY) { built++; continue; }
  let probe = '';
  for (const e of PROBES) { const f = path.join(ROOT, STRATUM, 'out', e, `${p.slug}.txt`); if (fs.existsSync(f)) { const t = han(fs.readFileSync(f, 'utf8')); if (t.length > probe.length) probe = t; } }
  const note = { slug: p.slug, substratum: p.substratum, title: p.title, probe_chars: probe.length };
  if (probe.length < 40) { note.reason = 'probe too short (page read as textless by the probe engines)'; fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); none++; console.log(`  – ${p.slug}: ${note.reason}`); continue; }
  let src = null;
  try { src = p.substratum === 'buddhist-canon' ? await cbetaLookup(probe) : await kanripoLookup(p.title || ''); if (!src && p.substratum !== 'buddhist-canon') src = await cbetaLookup(probe); }
  catch (e) { note.error = e.message.slice(0, 120); }
  if (!src) { note.reason = note.reason || 'no work identified (CBETA search / Kanripo catalogue)'; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); none++; console.log(`  – ${p.slug}: ${note.reason} ${note.error || ''}`); continue; }
  const w = bestWindow(src.etext, probe);
  const win = trimWindow(w.window, probe);
  Object.assign(note, { source: src.source, work: src.work, work_title: src.work_title || null, juan: src.juan, url: src.url, etext_chars: src.etext.length, window_chars: win.length, overlap: +w.overlap.toFixed(3) });
  if (w.overlap < MIN_OVERLAP) { note.reason = `overlap ${w.overlap.toFixed(2)} < ${MIN_OVERLAP}: page is not (cleanly) in this e-text`; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); none++; console.log(`  – ${p.slug}: ${note.reason} (${src.source} ${src.work})`); continue; }
  if (!DRY) { fs.writeFileSync(outTxt, win); fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); }
  built++; console.log(`  ✓ ${p.slug}: ${src.source} ${src.work} j${src.juan} overlap ${w.overlap.toFixed(2)} window ${win.length} / probe ${probe.length}`);
}
console.log(`\n${STRATUM}: ${built} references, ${none} without`);
