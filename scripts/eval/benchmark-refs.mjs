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
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { foldGreekWord } from './build-greek-corpus.mjs';
import { cleanPageText, pageQuality } from './lib/wikisource-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root'); const STRATUM = argOf('stratum', 'chinese');
const PROBES = argOf('probe', 'gemini-3-flash-preview,gemini-3.1-flash-lite').split(',');
const ONLY = argOf('only'); const DRY = process.argv.includes('--dry');
// --wide: when the title-and-juan lookup finds the work but not the page (a Siku Quanshu volume's
// juan numbering rarely matches Kanripo's file numbering, and a plain title carries no juan),
// list every juan file of the work on its Wenyuange (WYG) witness branch, else master, and take the
// best window over all of them. Same acceptance threshold; a real reference or none.
// --retry-missing: re-attempt pages whose earlier run wrote a JSON without a reference.
const WIDE = process.argv.includes('--wide'); const RETRY = process.argv.includes('--retry-missing');
// --force: rebuild every reference even where a JSON exists (the Greek branch cuts its window with
// the best probe available — a free Tesseract screen read in phase A, the Gemini read in phase B —
// and the phase-B rebuild must replace the phase-A window, not skip it).
const FORCE = process.argv.includes('--force');
const GH_HEADERS = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
const REFS = path.join(__dirname, 'benchmark', 'refs'); fs.mkdirSync(REFS, { recursive: true });
const CATALOG = argOf('kanripo-catalog', '/Users/dereklomas/.claude/jobs/417569c5/tmp/refs/kanripo');
const MIN_OVERLAP = 0.35;
// Same title test as benchmark-seal.mjs's buddhist-canon draw.
const BUDDHIST_RE = /佛|般若|菩薩|陀羅尼|華嚴|法華|楞嚴|楞伽|金剛|阿含|大藏|禪|涅槃|起信|淨土|地藏|藥師|觀音|sutra|sūtra/;

const han = s => [...String(s || '').normalize('NFC')].filter(c => /\p{Script=Han}/u.test(c)).join('');
const grams = (s, n = 4) => { const g = new Map(); for (let i = 0; i + n <= s.length; i++) { const k = s.slice(i, i + n); if (!g.has(k)) g.set(k, []); g.get(k).push(i); } return g; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, headers = {}) { const r = await fetch(url, { headers, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
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
// Variant forms that differ between our catalogue titles and Kanripo's (録/錄, 説/說 …); folded on both sides.
const foldTitle = s => String(s || '').replace(/録/g, '錄').replace(/説/g, '說').replace(/爲/g, '為').replace(/眞/g, '真').replace(/敎/g, '教');
function titleCandidates(title) {
  const cat = loadCatalog();
  const base = foldTitle(title.split('·')[0].split('(')[0].split(' ')[0].replace(/[（(].*$/, '').trim());
  return cat.filter(c => foldTitle(c.title) === base).concat(cat.filter(c => foldTitle(c.title) !== base && base.length >= 3 && (foldTitle(c.title).startsWith(base) || base.startsWith(foldTitle(c.title)))));
}
async function kanripoLookup(title) {
  const base = title.split('·')[0].split('(')[0].split(' ')[0].replace(/[（(].*$/, '').trim();
  const cands = titleCandidates(title);
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
// --wide: every juan file of the work, best window wins. Kanripo keeps one branch per witness;
// WYG is the Wenyuange Siku Quanshu copy, the witness most of our Chinese pages are scans of.
const kanripoHan = t => han(t.replace(/^#.*$/gm, '').replace(/<pb:[^>]+>/g, ''));
async function ghJuanFiles(id, ref) {
  const j = await getJson(`https://api.github.com/repos/kanripo/${id}/contents?ref=${ref}`, GH_HEADERS);
  return (Array.isArray(j) ? j : []).map(x => x.name).filter(n => new RegExp(`^${id}_\\d{3}\\.txt$`).test(n)).sort();
}
async function kanripoSearch(title, probe, log = () => {}) {
  const cands = titleCandidates(title).slice(0, 3);
  if (!cands.length) return null;
  const juanMatch = title.match(/卷([一二三四五六七八九十百]+)/); const hint = juanMatch ? cnNumber(juanMatch[1]) : null;
  let best = null;
  for (const c of cands) {
    let files = [], ref = null;
    for (const r of ['WYG', 'master']) { try { const f = await ghJuanFiles(c.id, r); if (f.length > files.length) { files = f; ref = r; } } catch (e) { /* branch absent or API limit */ } }
    if (!files.length) continue;
    const juanOf = f => +f.match(/_(\d{3})\.txt$/)[1];
    // Hinted juan first (Siku volumes are often off by a few from Kanripo's numbering), then the rest.
    if (hint != null) files.sort((a, b) => Math.abs(juanOf(a) - hint) - Math.abs(juanOf(b) - hint));
    log(`    wide: ${c.id} ${c.full} — ${files.length} juan files on ${ref}${hint != null ? `, hint j${hint}` : ''}`);
    for (let i = 0; i < files.length; i += 6) {
      const batch = files.slice(i, i + 6);
      const texts = await Promise.all(batch.map(f => getText(`https://raw.githubusercontent.com/kanripo/${c.id}/${ref}/${f}`).then(kanripoHan).catch(() => '')));
      for (let k = 0; k < batch.length; k++) {
        if (texts[k].length < 200) continue;
        const w = bestWindow(texts[k], probe);
        if (!best || w.overlap > best.overlap) best = { overlap: w.overlap, source: 'Kanripo', work: c.id, work_title: c.full, juan: juanOf(batch[k]), witness: ref, url: `https://github.com/kanripo/${c.id}/blob/${ref}/${batch[k]}`, etext: texts[k] };
      }
      if (best && best.overlap >= 0.6) return best;
    }
  }
  return best;
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
// `contentMin`: when set, the window is TRIMMED only on bigrams whose words both have ≥ contentMin
// letters. The scorer's CER for a benchmark page is Levenshtein over the WHOLE reference, so an
// over-long window charges every engine for text the page never printed; with the trim on all
// bigrams, Greek windows ran to 1.7× the probe because και/δε/τα bigrams occur everywhere in the
// e-text around the page (measured on the sealed greek stratum, 2026-09-19).
function wordWindow(words, probeWords, contentMin = 0) {
  const P = new Set(); for (let i = 0; i + 1 < probeWords.length; i++) P.add(probeWords[i] + ' ' + probeWords[i + 1]);
  const L = Math.max(40, Math.round(probeWords.length * 1.3));
  const votes = new Float64Array(words.length + 1);
  for (let i = 0; i + 1 < words.length; i++) if (P.has(words[i] + ' ' + words[i + 1])) votes[i] = 1;
  let best = 0, at = 0, run = 0;
  for (let i = 0; i < votes.length; i++) { run += votes[i]; if (i >= L) run -= votes[i - L]; if (run > best) { best = run; at = Math.max(0, i - L + 1); } }
  const s = Math.max(0, at - Math.round(L * 0.15)), e = Math.min(words.length, at + L + Math.round(L * 0.15));
  const content = i => words[i].length >= contentMin && words[i + 1].length >= contentMin;
  let first = -1, last = -1; for (let i = s; i + 1 < e; i++) if (P.has(words[i] + ' ' + words[i + 1]) && content(i)) { if (first < 0) first = i; last = i + 2; }
  const from = first < 0 ? s : Math.max(s, first - 3), to = first < 0 ? e : Math.min(e, last + 3);
  return { window: words.slice(from, to).join(' '), from, to, overlap: P.size ? Math.min(1, best / P.size) : 0, shared: best };
}

// ── Greek (greek, greek-ext; #4925 step 2, #4744): local First1KGreek + Perseus corpus flattened by
// build-greek-corpus.mjs (<id>.txt accented, <id>.fold.txt diacritic-folded), then el.wikisource ──
// The work is identified by a phrase vote: folded word TRIGRAMS of the probe searched with ripgrep
// over every .fold.txt; the file with the most DISTINCT phrase hits wins (≥ 3, and ahead of the
// runner-up). The window is then cut on the folded words by the Syriac word-bigram vote and mapped
// back to the ACCENTED text, which is what the reference is — the fold exists only for matching. An
// edition of the work is not our edition (a 1550 Aldine and a 1908 OCT differ in accents, breathings
// and readings), so the scorer's mismatch demotion is expected to fire on some pages; overlap and
// edition are recorded on every row. Wikisource's search folds diacritics too, so the same phrases
// serve there.
const GREEK_DIR = argOf('greek-corpus', '/Users/dereklomas/.claude/jobs/417569c5/tmp/refs/greek');
const WS_EL = 'https://el.wikisource.org/w/api.php';
const HTML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const htmlDecode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(/^#x/i.test(e) ? e.slice(2) : e.slice(1), /^#x/i.test(e) ? 16 : 10)) : (HTML_ENT[e.toLowerCase()] ?? m));
const GREEK_LETTERS = s => (String(s || '').match(/\p{Script=Greek}/gu) || []).length;
// Tokenise an accented text into words with offsets, folded alongside (empty folds — Latin words,
// numerals — are dropped from BOTH sequences so window indices stay aligned).
function greekWords(text) {
  const words = [], offs = [];
  for (const m of text.matchAll(/[\p{L}\p{M}]+/gu)) { const f = foldGreekWord(m[0]); if (f.length >= 2) { words.push(f); offs.push([m.index, m.index + m[0].length]); } }
  return { words, offs };
}
function greekPhrases(words, max) {
  const tri = [];
  for (let i = 0; i + 2 < words.length; i++) if (words[i].length >= 4 && words[i + 1].length >= 3 && words[i + 2].length >= 4) tri.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  const uniq = [...new Set(tri)]; if (uniq.length <= max) return uniq;
  const step = uniq.length / max; return Array.from({ length: max }, (_, k) => uniq[Math.floor(k * step)]);
}
let greekIndex = null;
function rgVote(phrases) {
  if (!phrases.length) return [];
  const pf = path.join(os.tmpdir(), `greek-pats-${process.pid}.txt`); fs.writeFileSync(pf, phrases.join('\n') + '\n');
  let out = '';
  try { out = execFileSync('rg', ['-F', '-f', pf, '-o', '--no-line-number', '--with-filename', '--no-heading', '-g', '*.fold.txt', GREEK_DIR], { maxBuffer: 256e6 }).toString(); }
  catch (e) { out = e.stdout ? e.stdout.toString() : ''; }   // rg exits 1 when nothing matches
  const byFile = new Map();
  for (const line of out.split('\n')) { const i = line.indexOf(':'); if (i < 0) continue; const id = path.basename(line.slice(0, i), '.fold.txt'); let s = byFile.get(id); if (!s) { s = new Set(); byFile.set(id, s); } s.add(line.slice(i + 1)); }
  return [...byFile.entries()].map(([id, s]) => ({ id, hits: s.size })).sort((a, b) => b.hits - a.hits);
}
function corpusWindow(id, probeWords) {
  const raw = fs.readFileSync(path.join(GREEK_DIR, `${id}.txt`), 'utf8');
  const { words, offs } = greekWords(raw);
  const w = wordWindow(words, probeWords, 4);
  return { ...w, text: raw.slice(offs[w.from][0], offs[w.to - 1][1]), etext_chars: raw.length };
}
// Wikimedia asks for a descriptive User-Agent and answers anonymous bursts with 429; one retry after a pause.
const WS_HEADERS = { 'User-Agent': 'SourceLibrary-OCR-benchmark/1.0 (https://sourcelibrary.org; team@sourcelibrary.org)' };
async function wsJson(url) { try { return await getJson(url, WS_HEADERS); } catch (e) { if (!/^429/.test(e.message)) throw e; await sleep(3000); return getJson(url, WS_HEADERS); } }
async function greekCorpusLookup(probeWords, log) {
  if (!greekIndex) greekIndex = JSON.parse(fs.readFileSync(path.join(GREEK_DIR, 'index.json'), 'utf8'));
  const phrases = greekPhrases(probeWords, 40);
  const votes = rgVote(phrases);
  // A tie only voids the identification when the rival is a DIFFERENT work. Two editions of one
  // work (tlg2018.tlg002.perseus-grc2 vs .1st1K-grc2) tie by construction — Eusebius 1544 was
  // discarded at 32/40 phrase hits for exactly that (found 2026-09-21, #4925 step 2 spot check).
  const workOf = (id) => id.split('.').slice(0, 2).join('.');
  const rival = votes.find(v => workOf(v.id) !== workOf(votes[0]?.id || ''));
  if (!votes.length || votes[0].hits < 3 || (rival && rival.hits >= votes[0].hits)) return { phrases: phrases.length, votes: votes.slice(0, 3) };
  const top = votes[0], meta = greekIndex[top.id] || {};
  const w = corpusWindow(top.id, probeWords);
  log(`    corpus: ${top.id} (${meta.author} — ${meta.title}) ${top.hits}/${phrases.length} phrases, window overlap ${w.overlap.toFixed(2)}`);
  return { phrases: phrases.length, votes: votes.slice(0, 3), src: { source: meta.source || 'local Greek corpus', work: top.id, work_title: [meta.author, meta.title].filter(Boolean).join(' — '), edition: meta.edition || null, url: meta.url || null, phrase_hits: top.hits, etext_chars: w.etext_chars, window: w.text, overlap: w.overlap, window_words: w.to - w.from } };
}
async function wikisourceLookup(probeWords, log) {
  const phrases = greekPhrases(probeWords, 6);
  const counts = new Map();
  for (const ph of phrases) {
    try { const j = await wsJson(`${WS_EL}?action=query&list=search&srsearch=${encodeURIComponent(`"${ph}"`)}&srlimit=5&format=json&utf8=1`); for (const r of j.query?.search || []) counts.set(r.title, (counts.get(r.title) || 0) + 1); }
    catch (e) { log(`    wikisource search error: ${e.message.slice(0, 80)}`); }
    await sleep(600);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 2) return null;
  const j = await wsJson(`${WS_EL}?action=parse&page=${encodeURIComponent(best[0])}&prop=text&format=json&utf8=1&disabletoc=1`);
  const raw = htmlDecode((j.parse?.text?.['*'] || '').replace(/<(style|script)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  const { words, offs } = greekWords(raw);
  if (words.length < 20) return null;
  const w = wordWindow(words, probeWords, 4);
  log(`    el.wikisource: ${best[0]} ${best[1]}/${phrases.length} phrases, window overlap ${w.overlap.toFixed(2)}`);
  return { source: 'el.wikisource', work: best[0], work_title: best[0], edition: null, url: `https://el.wikisource.org/wiki/${encodeURIComponent(best[0])}`, phrase_hits: best[1], etext_chars: raw.length, window: raw.slice(offs[w.from][0], offs[w.to - 1][1]), overlap: w.overlap, window_words: w.to - w.from };
}
// ── Alignment trim (phase B, 2026-09-20; a DEVIATION from the preregistered trim, reported) ──
// The bigram trim above left the window 20–40 % longer than the page on a third of the early-print
// leaves (measured: engine-letters / window-letters down to 0.6 with the engines agreeing with each
// other), and the scorer's whole-window CER charges that overshoot to EVERY engine as deletions —
// the paired verdicts survive it, the absolute "is lite good enough" number does not. So the final
// cut is by alignment: each scored read of the page is aligned to the best SUBSTRING of the window
// (Greek letters only, case-folded; free skip at the window's two ends), reads that align at < 0.5
// CER contribute their span, and the window is cut to the UNION of the spans. No engine is charged
// for text another engine read; a header no engine read is dropped for all of them alike. The
// per-page before/after letter counts and the reads used are recorded on the row.
const GREEK_RE = /\p{Script=Greek}/u;
function alignSpan(hyp, ref) {   // arrays of letters; returns the best span of ref and the edits within it
  const n = hyp.length, m = ref.length; if (!n || !m) return null;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1), ps = new Int32Array(m + 1), cs = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) { prev[j] = 0; ps[j] = j; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; cs[0] = 0;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (hyp[i - 1] === ref[j - 1] ? 0 : 1), del = prev[j] + 1, ins = cur[j - 1] + 1;
      if (sub <= del && sub <= ins) { cur[j] = sub; cs[j] = ps[j - 1]; } else if (del <= ins) { cur[j] = del; cs[j] = ps[j]; } else { cur[j] = ins; cs[j] = cs[j - 1]; }
    }
    [prev, cur] = [cur, prev]; [ps, cs] = [cs, ps];
  }
  let best = Infinity, end = 0; for (let j = 0; j <= m; j++) if (prev[j] < best) { best = prev[j]; end = j; }
  const start = ps[end]; return { start, end, cer: best / Math.max(1, end - start) };
}
function greekReads(p) {   // every scored engine's read of the page (not the classifier, not the screen)
  const outRoot = path.join(ROOT, STRATUM, 'out'); const reads = {};
  if (fs.existsSync(outRoot)) for (const e of fs.readdirSync(outRoot)) { if (e === 'script-class') continue; const f = path.join(outRoot, e, `${p.slug}.txt`); if (fs.existsSync(f)) reads[e] = fs.readFileSync(f, 'utf8'); }
  return reads;
}
function alignTrim(window, reads) {
  const w = window.normalize('NFC'); const pos = [], letters = [];
  for (let i = 0; i < w.length; i++) if (GREEK_RE.test(w[i])) { pos.push(i); letters.push(w[i].toLowerCase()); }
  const CAP = 6000; const refL = letters.slice(0, CAP);
  let lo = Infinity, hi = -Infinity; const used = [];
  for (const [e, text] of Object.entries(reads)) {
    const hypL = [...text.normalize('NFC').toLowerCase().replace(/[^\p{Script=Greek}]+/gu, '')].slice(0, CAP);
    if (hypL.length < 80) continue;
    const a = alignSpan(hypL, refL); if (!a || a.cer >= 0.5 || a.end - a.start < 80) continue;
    lo = Math.min(lo, a.start); hi = Math.max(hi, a.end); used.push(`${e}:${a.cer.toFixed(2)}`);
  }
  const note = { letters_before: letters.length, reads_used: used };
  if (!used.length || refL.length < letters.length) { note.letters_after = letters.length; note.kept = 'whole window (no aligning read, or window over the cap)'; return { window: w, note }; }
  const out = w.slice(pos[lo], pos[hi - 1] + 1); note.letters_after = hi - lo; return { window: out, note };
}
// Probe order for a Greek page: the longer Gemini read (the #4744 convention), else any other
// engine's, else the free Tesseract screen read the seal step cached (phase A only — noisy on
// ligatured type, so its hit rate is a LOWER bound on what the Gemini probe will find).
function greekProbe(p) {
  const outRoot = path.join(ROOT, STRATUM, 'out'); const cands = [];
  if (fs.existsSync(outRoot)) for (const e of fs.readdirSync(outRoot)) { const f = path.join(outRoot, e, `${p.slug}.txt`); if (fs.existsSync(f)) cands.push({ engine: e, text: fs.readFileSync(f, 'utf8') }); }
  const scr = path.join(ROOT, STRATUM, 'screen', `${p.book_id}-p${p.page_number}.txt`);
  if (fs.existsSync(scr)) cands.push({ engine: 'tesseract-screen', text: fs.readFileSync(scr, 'utf8') });
  const rank = c => (c.engine.startsWith('gemini') ? 2 : c.engine === 'tesseract-screen' ? 0 : 1) * 1e6 + GREEK_LETTERS(c.text);
  cands.sort((a, b) => rank(b) - rank(a));
  return cands[0] || null;
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

// ── English (english-1800s, english-1900s; #5182, PREREGISTRATION-english-modern-5182.md) ──
// Sources in order, all free: (1) en.wikisource Page: namespace (ns 104) — a proofread transcription
// of ONE scan page, found by quoted content phrases from the probe; the leaf's neighbours are fetched
// too, so an edition with a different pagination still yields a window; (2) en.wikisource main
// namespace — a whole-work transcription, windowed; (3) Project Gutenberg — Gutendex when it answers
// (it was timing out on 2026-09-26), else the catalogue CSV matched on title words + author surname,
// then the plain text, windowed. The PROBE is the page's stored production read
// (<root>/<stratum>/probe/<slug>.txt, written by benchmark-seal.mjs); it only locates the window
// and is never the reference. IA djvu text is used nowhere here. Every record carries the
// eval-design §4 fields; leaf_check starts `unchecked` and is set by eye afterwards.
const WS_EN = 'https://en.wikisource.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const PG_CATALOG = argOf('pg-catalog', path.join(process.env.HOME || '', '.claude/jobs/496557a4/tmp/pg_catalog.csv'));
const foldEn = s => String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/æ/g, 'ae').replace(/œ/g, 'oe');
// Words with raw offsets; the fold is for matching only, the reference keeps the raw text.
function enWords(text) {
  const words = [], offs = [];
  for (const m of text.matchAll(/\p{L}[\p{L}'’]*/gu)) { const f = foldEn(m[0]).replace(/[^a-z']/g, ''); if (f.length >= 1) { words.push(f); offs.push([m.index, m.index + m[0].length]); } }
  return { words, offs };
}
// Quoted search phrases: 5 consecutive alphabetic words of ≥ 3 letters, spread over the probe.
function enPhrases(words, max) {
  const runs = [];
  for (let i = 0; i + 5 <= words.length; i++) { const r = words.slice(i, i + 5); if (r.every(w => w.length >= 3 && /^[a-z]+$/.test(w)) && r.join('').length >= 22) runs.push(r.join(' ')); }
  const uniq = [...new Set(runs)]; if (uniq.length <= max) return uniq;
  const step = uniq.length / max; return Array.from({ length: max }, (_, k) => uniq[Math.floor(k * step)]);
}
const grams4 = ws => { const s = new Set(); for (let i = 0; i + 4 <= ws.length; i++) s.add(ws.slice(i, i + 4).join(' ')); return s; };
function gramOverlap(refWords, probeWords) { const P = grams4(probeWords), R = grams4(refWords); let hit = 0; for (const g of P) if (R.has(g)) hit++; return P.size ? hit / P.size : 0; }
// Word-4-gram vote → densest probe-length window → edges trimmed to the outermost probe 4-gram
// (±2 words). An edge omission by the probe engine is the one blind spot; the by-eye leaf check
// reads the reference's first and last lines against the image for exactly that.
function enWindow(words, probeWords) {
  const idx = new Map();
  for (let i = 0; i + 4 <= words.length; i++) { const g = words.slice(i, i + 4).join(' '); let a = idx.get(g); if (!a) { a = []; idx.set(g, a); } a.push(i); }
  const P = grams4(probeWords); const votes = new Float64Array(words.length + 1);
  for (const g of P) { const pos = idx.get(g); if (!pos || pos.length > 20) continue; for (const p of pos) votes[p] += 1 / pos.length; }
  const L = Math.max(30, Math.round(probeWords.length * 1.3));
  let best = 0, at = 0, run = 0;
  for (let i = 0; i < votes.length; i++) { run += votes[i]; if (i >= L) run -= votes[i - L]; if (run > best) { best = run; at = Math.max(0, i - L + 1); } }
  const s = Math.max(0, at - Math.round(L * 0.15)), e = Math.min(words.length, at + L + Math.round(L * 0.15));
  let first = -1, last = -1; for (let i = s; i + 4 <= e; i++) if (P.has(words.slice(i, i + 4).join(' '))) { if (first < 0) first = i; last = i + 4; }
  const from = first < 0 ? s : Math.max(s, first - 2), to = first < 0 ? e : Math.min(e, last + 2);
  return { from, to, overlap: gramOverlap(words.slice(from, to), probeWords), votes: best };
}
async function wsSearch(api, ns, phrase) {
  const j = await wsJson(`${api}?action=query&list=search&srsearch=${encodeURIComponent(`"${phrase}"`)}&srnamespace=${ns}&srlimit=5&format=json&utf8=1`);
  return (j.query?.search || []).map(r => r.title);
}
async function wsRevisions(api, titles) {
  const j = await wsJson(`${api}?action=query&prop=revisions&rvprop=content|ids|timestamp&rvslots=main&titles=${encodeURIComponent(titles.join('|'))}&format=json&formatversion=2`);
  const out = {}; for (const p of j.query?.pages || []) { const r = p.revisions?.[0]; if (r) out[p.title] = { text: r.slots.main.content, revid: r.revid, timestamp: r.timestamp, ns: p.ns }; }
  return out;
}
async function wsVote(ns, phrases, log) {
  const counts = new Map();
  for (const ph of phrases) {
    try { for (const t of await wsSearch(WS_EN, ns, ph)) counts.set(t, (counts.get(t) || 0) + 1); }
    catch (e) { log(`    wikisource ns${ns} search error: ${e.message.slice(0, 80)}`); }
    await sleep(500);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
// The scan a Wikisource Index was made from: an archive.org identifier on the Commons (or local)
// File: page. Equal to our book's ia_identifier → edition_match `same` (same scan, same edition).
const fileIaCache = new Map();
async function wsFileIaId(file) {
  if (fileIaCache.has(file)) return fileIaCache.get(file);
  let id = null;
  for (const api of [COMMONS, WS_EN]) {
    try { const revs = await wsRevisions(api, [`File:${file}`]); const r = Object.values(revs)[0]; if (!r) continue; const m = r.text.match(/archive\.org\/(?:details|download|stream)\/([A-Za-z0-9._-]+)/) || r.text.match(/\{\{\s*IA\s*\|\s*([^|}\s]+)/i); id = m ? m[1].trim() : null; break; }
    catch (e) { /* file page absent here */ }
  }
  fileIaCache.set(file, id); return id;
}
async function wsPageLookup(probeWords, meta, log) {
  const phrases = enPhrases(probeWords, 5);
  if (phrases.length < 2) return { reason: 'probe too noisy for search phrases' };
  const ranked = await wsVote(104, phrases, log);
  // Votes per FILE: consecutive pages of one djvu are one candidate — an edition with a different
  // pagination splits our leaf across two of its pages.
  const byFile = new Map();
  for (const [t, c] of ranked) { const m = t.match(/^Page:(.+)\/(\d+)$/); if (!m) continue; let g = byFile.get(m[1]); if (!g) { g = { file: m[1], votes: 0, pages: [] }; byFile.set(m[1], g); } g.votes += c; g.pages.push({ n: +m[2], c }); }
  const top = [...byFile.values()].sort((a, b) => b.votes - a.votes)[0];
  if (!top || top.votes < 2) return { tried: ranked.slice(0, 3).map(([t, c]) => `${t}:${c}`) };
  top.pages.sort((a, b) => b.c - a.c || a.n - b.n); const center = top.pages[0].n;
  const ns = [center - 1, center, center + 1].filter(n => n > 0);
  const revs = await wsRevisions(WS_EN, ns.map(n => `Page:${top.file}/${n}`));
  const parts = []; for (const n of ns) { const r = revs[`Page:${top.file}/${n}`]; if (r) parts.push({ n, revid: r.revid, timestamp: r.timestamp, quality: pageQuality(r.text), text: cleanPageText(r.text) }); }
  const cp = parts.find(p => p.n === center); if (!cp || cp.text.length < 40) return { tried: [`Page:${top.file}/${center} (empty or unfetched)`] };
  const raw = parts.map(p => p.text).join('\n\n'); const { words, offs } = enWords(raw);
  let cursor = 0; const range = new Map(); for (const p of parts) { range.set(p.n, [cursor, cursor + p.text.length]); cursor += p.text.length + 2; }
  const [c0, c1] = range.get(center);
  const w = enWindow(words, probeWords);
  const inCenter = i => offs[i][0] >= c0 && offs[i][0] < c1;
  const centerIdx = []; for (let i = 0; i < words.length; i++) if (inCenter(i)) centerIdx.push(i);
  const winCenter = centerIdx.filter(i => i >= w.from && i < w.to).length;
  const centerShare = winCenter / Math.max(1, w.to - w.from), centerCovered = winCenter / Math.max(1, centerIdx.length);
  let text, unit, overlap;
  if (centerShare >= 0.9 && centerCovered >= 0.8) { text = cp.text; unit = { kind: 'page', chars: text.length }; overlap = gramOverlap(enWords(text).words, probeWords); }
  else { text = raw.slice(offs[w.from][0], offs[w.to - 1][1]); unit = { kind: 'window', chars: text.length, note: `window over Page:${top.file}/${ns[0]}–${ns[ns.length - 1]}; centre page share ${centerShare.toFixed(2)}, covered ${centerCovered.toFixed(2)}` }; overlap = w.overlap; }
  const ia = await wsFileIaId(top.file);
  const same = ia && meta?.ia_identifier && ia.toLowerCase() === meta.ia_identifier.toLowerCase();
  return { src: {
    source: 'en.wikisource', source_url: `https://en.wikisource.org/wiki/${encodeURIComponent(`Page:${top.file}/${center}`)}`, source_revision: `oldid ${cp.revid} (${cp.timestamp})`,
    licence: 'CC-BY-SA-4.0 (Wikisource transcription of a public-domain work)', work: `Index:${top.file}`, work_title: top.file.replace(/\.(djvu|pdf)$/i, ''),
    page_quality: cp.quality, phrase_hits: top.votes, unit, alignment: { method: unit.kind === 'page' ? 'wikisource-page (whole proofread page)' : 'word-4gram-vote+edge-trim over the page and its neighbours', window_words: unit.kind === 'page' ? enWords(text).words.length : w.to - w.from, probe_words: probeWords.length, overlap: +overlap.toFixed(3) },
    edition_match: same ? 'same' : (ia ? 'different' : 'unknown'), edition_match_basis: ia ? `Wikisource scan is archive.org/${ia}; ours is ${meta?.ia_identifier || 'not IA'}` : 'Wikisource File: page names no archive.org item',
    window: text, overlap,
  } };
}
async function wsMainLookup(probeWords, log) {
  const phrases = enPhrases(probeWords, 5);
  if (phrases.length < 2) return null;
  const ranked = (await wsVote(0, phrases, log)).filter(([t]) => !/^(Author|Portal|Index|Page|Wikisource|Translation|Category|Template):/i.test(t));
  const best = ranked[0]; if (!best || best[1] < 2) return ranked.length ? { tried: ranked.slice(0, 3).map(([t, c]) => `${t}:${c}`) } : null;
  const j = await wsJson(`${WS_EN}?action=parse&page=${encodeURIComponent(best[0])}&prop=text|revid&format=json&utf8=1&disabletoc=1`);
  const raw = htmlDecode((j.parse?.text?.['*'] || '').replace(/<(style|script)[\s\S]*?<\/\1>/g, ' ').replace(/<span class="pagenum[^"]*"[^>]*>[\s\S]*?<\/span>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  const { words, offs } = enWords(raw); if (words.length < 30) return null;
  const w = enWindow(words, probeWords); if (w.to <= w.from) return null;
  const text = raw.slice(offs[w.from][0], offs[w.to - 1][1]);
  return { src: {
    source: 'en.wikisource (main namespace)', source_url: `https://en.wikisource.org/wiki/${encodeURIComponent(best[0])}`, source_revision: `revid ${j.parse?.revid} (fetched ${new Date().toISOString().slice(0, 10)})`,
    licence: 'CC-BY-SA-4.0 (Wikisource transcription of a public-domain work)', work: best[0], work_title: best[0], phrase_hits: best[1],
    unit: { kind: 'window', chars: text.length }, alignment: { method: 'word-4gram-vote+edge-trim over the work text', window_words: w.to - w.from, probe_words: probeWords.length, overlap: +w.overlap.toFixed(3) },
    edition_match: 'unknown', edition_match_basis: 'main-namespace transcription; edition not compared', window: text, overlap: w.overlap,
  } };
}
// ── Project Gutenberg ──
function parseCsv(text) {   // RFC 4180: quoted fields may hold commas and newlines
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const TITLE_STOP = new Set(['the', 'and', 'of', 'a', 'an', 'in', 'on', 'to', 'for', 'with', 'vol', 'volume', 'part', 'from', 'by', 'or', 'its', 'edition', 'translated', 'translation', 'tr', 'ed', 'complete', 'works', 'book', 'books', 'new', 'first', 'second', 'third', 'vols', 'series', 'other', 'his', 'her', 'their', 'into', 'english', 'notes', 'introduction', 'with']);
const titleWords = t => [...new Set(foldEn(t).replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !TITLE_STOP.has(w)))];
const nameWords = a => foldEn(a).replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !/^(ed|tr|trans|and|the|of|sir|rev|von|van|der|de)$/.test(w));
let pgCatalog = null;
function loadPg() {
  if (pgCatalog) return pgCatalog;
  if (!fs.existsSync(PG_CATALOG)) { console.log(`  ! Gutenberg catalogue not found at ${PG_CATALOG} (fetch https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv, or --pg-catalog=)`); return (pgCatalog = []); }
  const rows = parseCsv(fs.readFileSync(PG_CATALOG, 'utf8')); const h = rows[0];
  const iId = h.indexOf('Text#'), iType = h.indexOf('Type'), iTitle = h.indexOf('Title'), iLang = h.indexOf('Language'), iAu = h.indexOf('Authors');
  pgCatalog = rows.slice(1).filter(r => r[iType] === 'Text' && /\ben\b/.test(r[iLang] || '')).map(r => ({ id: +r[iId], title: r[iTitle] || '', authors: r[iAu] || '', via: 'pg_catalog.csv' }));
  console.log(`  Gutenberg catalogue: ${pgCatalog.length} English texts`);
  return pgCatalog;
}
function pgCandidates(title, author) {
  const head = titleWords(title.split(/[(—–:|;]/)[0]), full = titleWords(title), au = author ? nameWords(author) : [];
  const scored = [];
  for (const r of loadPg()) {
    const rt = r._tw || (r._tw = titleWords(r.title)); let s = 0;
    for (const w of full) if (rt.includes(w)) s += head.includes(w) ? 2 : 1;
    if (!s) continue;
    const ra = r._au || (r._au = nameWords(r.authors));
    if (au.some(w => ra.includes(w))) s += 3;
    // penalise catalogue titles with many words we never mention (a 12-word title sharing one word)
    s -= Math.max(0, rt.length - full.length) * 0.25;
    scored.push({ ...r, score: s });
  }
  return scored.sort((a, b) => b.score - a.score).filter(c => c.score >= 3).slice(0, 3);
}
async function gutendex(q) {
  try { const r = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(q)}&languages=en`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return null; const j = await r.json(); return (j.results || []).slice(0, 3).map(b => ({ id: b.id, title: b.title, authors: (b.authors || []).map(a => a.name).join('; '), via: 'gutendex' })); }
  catch (e) { return null; }
}
const pgTextCache = new Map();
async function pgText(id) {
  if (pgTextCache.has(id)) return pgTextCache.get(id);
  let got = null;
  for (const u of [`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`]) { try { got = { url: u, text: await getText(u) }; break; } catch (e) { /* next mirror path */ } }
  if (got) { const t = got.text; const s = t.search(/\*\*\* ?START OF TH(E|IS) PROJECT GUTENBERG EBOOK/i), e = t.search(/\*\*\* ?END OF TH(E|IS) PROJECT GUTENBERG EBOOK/i); const from = s >= 0 ? t.indexOf('\n', s) + 1 : 0; got.body = t.slice(from, e > from ? e : t.length); }
  pgTextCache.set(id, got); await sleep(400); return got;
}
async function gutenbergLookup(title, author, probeWords, log) {
  let cands = await gutendex(`${author ? nameWords(author).slice(-1)[0] || '' : ''} ${titleWords(title.split(/[(—–:|;]/)[0]).slice(0, 4).join(' ')}`.trim());
  const via = cands ? 'gutendex' : 'pg_catalog.csv (Gutendex unreachable)';
  if (!cands || !cands.length) cands = pgCandidates(title, author);
  if (!cands.length) return { tried: [], via };
  let best = null; const tried = [];
  for (const c of cands) {
    const g = await pgText(c.id); if (!g || !g.body || g.body.length < 2000) { tried.push(`#${c.id} (no text)`); continue; }
    const { words, offs } = enWords(g.body); const w = enWindow(words, probeWords);
    tried.push(`#${c.id} ${c.title.slice(0, 40)}: ${w.overlap.toFixed(2)}`);
    if (!best || w.overlap > best.overlap) best = { c, g, w, words, offs, overlap: w.overlap };
    if (w.overlap >= 0.7) break;
  }
  if (!best || best.w.to <= best.w.from) return { tried, via };
  const text = best.g.body.slice(best.offs[best.w.from][0], best.offs[best.w.to - 1][1]);
  return { tried, via, src: {
    source: 'gutenberg', source_url: `https://www.gutenberg.org/ebooks/${best.c.id}`, source_revision: `${best.g.url} fetched ${new Date().toISOString().slice(0, 10)}`,
    licence: 'Project Gutenberg License (public-domain text; PG trademark terms)', work: `pg${best.c.id}`, work_title: `${best.c.authors ? best.c.authors + ' — ' : ''}${best.c.title}`, catalogue_via: via,
    unit: { kind: 'window', chars: text.length }, alignment: { method: 'word-4gram-vote+edge-trim over the whole e-text', window_words: best.w.to - best.w.from, probe_words: probeWords.length, overlap: +best.overlap.toFixed(3) },
    edition_match: 'unknown', edition_match_basis: 'Gutenberg rarely records its source edition; counted apart from `same`', window: text, overlap: best.overlap,
  } };
}
async function englishRefs(reg) {
  const target = reg.n;
  const probeDir = path.join(ROOT, STRATUM, 'probe');
  const metaPath = path.join(probeDir, '_meta.json'); const bookMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const tally = { referenced: 0, retired_no_etext: 0, no_probe: 0, by_source: {}, edition: {}, walked: 0 };
  const retiredQueue = [];   // retired slugs awaiting a promoted spare (pairs recorded both ways)
  const regPath = path.join(__dirname, 'benchmark', `${STRATUM}.json`);
  for (const p of reg.pages) {
    if (ONLY && p.slug !== ONLY) continue;
    if (p.retired && !ONLY) { if (!p.spare) retiredQueue.push(p.slug); continue; }
    // Sealed pages are always resolved (reference or recorded skip); spares only while short of the quota.
    if (p.spare && !p.promoted && tally.referenced >= target && !ONLY) break;
    tally.walked++;
    const outTxt = path.join(REFS, `${p.slug}.txt`), outJson = path.join(REFS, `${p.slug}.json`);
    const promoteIfSpare = () => { if (p.spare && !p.promoted) { p.promoted = true; p.promoted_for = 'no-e-text'; const r = retiredQueue.shift(); if (r) { p.replaces = r; const rp = reg.pages.find(x => x.slug === r); if (rp) rp.replaced_by = p.slug; } } };
    if (fs.existsSync(outJson) && !FORCE && !(RETRY && !fs.existsSync(outTxt))) {
      const j = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      if (fs.existsSync(outTxt)) { tally.referenced++; promoteIfSpare(); tally.by_source[j.source] = (tally.by_source[j.source] || 0) + 1; tally.edition[j.edition_match] = (tally.edition[j.edition_match] || 0) + 1; }
      else if (!p.retired) { p.retired = j.skipped || 'no-e-text'; if (!p.spare) retiredQueue.push(p.slug); tally.retired_no_etext++; }
      continue;
    }
    const probeFile = path.join(probeDir, `${p.slug}.txt`);
    const probeText = fs.existsSync(probeFile) ? fs.readFileSync(probeFile, 'utf8') : '';
    const probeWords = enWords(probeText).words;
    const note = { slug: p.slug, substratum: p.substratum, title: p.title, year: p.year, probe: { source: 'stored production read (pages.ocr.data, tags stripped)', words: probeWords.length } };
    if (probeWords.length < 40) { note.skipped = 'no-probe'; note.reason = 'stored read has < 40 words'; tally.no_probe++; p.retired = 'no-probe'; if (!p.spare) retiredQueue.push(p.slug); if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); console.log(`  – ${p.slug}: ${note.reason}`); continue; }
    const meta = bookMeta[p.slug] || {};
    let src = null; const tried = {};
    try {
      const a = await wsPageLookup(probeWords, meta, m => console.log(m)); tried.wikisource_page = a.tried || a.reason || null; if (a.src && a.src.overlap >= MIN_OVERLAP) src = a.src;
      if (!src) { const b = await wsMainLookup(probeWords, m => console.log(m)); tried.wikisource_main = b?.tried || null; if (b?.src && b.src.overlap >= MIN_OVERLAP && (!src || b.src.overlap > src.overlap)) src = b.src; else if (b?.src) tried.wikisource_main = [`${b.src.work}: overlap ${b.src.overlap.toFixed(2)}`]; }
      if (!src) { const c = await gutenbergLookup(p.title || '', meta.author, probeWords, m => console.log(m)); tried.gutenberg = c.tried; tried.gutenberg_via = c.via; if (c.src && c.src.overlap >= MIN_OVERLAP) src = c.src; }
    } catch (e) { note.error = e.message.slice(0, 160); }
    note.tried = tried;
    if (!src) {
      note.skipped = 'no-e-text'; note.reason = `no e-text window reaches ${MIN_OVERLAP} word-4-gram overlap with the probe (en.wikisource Page:/main, Gutenberg)`;
      tally.retired_no_etext++; p.retired = 'no-e-text'; if (!p.spare) retiredQueue.push(p.slug);
      if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2));
      console.log(`  – ${p.slug} (${p.year}, ${(p.title || '').slice(0, 40)}): no e-text ${note.error ? '[' + note.error + ']' : ''}`);
      continue;
    }
    const { window, overlap, ...rest } = src;
    Object.assign(note, rest, {
      leaf_check: { status: 'unchecked', by: null, at: null, note: null },
      canonical: null, memorization_risk: null,   // set with the by-eye classification
      made_by: null, reference_error_rate: null,
      lines: window.split('\n').filter(l => l.trim()).length,
    });
    if (!DRY) { fs.writeFileSync(outTxt, window); fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); }
    tally.referenced++; promoteIfSpare(); tally.by_source[src.source] = (tally.by_source[src.source] || 0) + 1; tally.edition[src.edition_match] = (tally.edition[src.edition_match] || 0) + 1;
    console.log(`  ✓ ${p.slug} (${p.year}, ${(p.title || '').slice(0, 40)}): ${src.source} ${src.work_title.slice(0, 50)} — ${src.unit.kind} ${src.unit.chars} chars, overlap ${overlap.toFixed(2)}, edition ${src.edition_match}${p.spare ? ' [spare promoted]' : ''}`);
  }
  if (!DRY && !ONLY) { reg.reference_walk = { at: new Date().toISOString(), target, referenced: tally.referenced, walked: tally.walked, retired_no_etext: tally.retired_no_etext, no_probe: tally.no_probe, rule: 'draw order walked until `n` pages hold a reference; a page with no e-text is retired `no-e-text` and the next spare promoted (`replaces`/`replaced_by` pair them in order); pages after the quota stay unused spares' }; fs.writeFileSync(regPath, JSON.stringify(reg, null, 2)); }
  console.log(`\n${STRATUM}: ${tally.referenced}/${target} referenced after walking ${tally.walked} pages; ${tally.retired_no_etext} no-e-text, ${tally.no_probe} no-probe; by source ${JSON.stringify(tally.by_source)}; edition ${JSON.stringify(tally.edition)}`);
}

// ── main ──
const reg = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark', `${STRATUM}.json`), 'utf8'));
if (STRATUM.startsWith('english')) { await englishRefs(reg); process.exit(0); }
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
if (STRATUM.startsWith('greek')) {
  const pages = reg.pages.filter(p => (!p.spare || p.promoted) && !p.retired && (!ONLY || p.slug === ONLY));
  const tally = { built: 0, none: 0, work_only: 0, no_probe: 0, by_source: {}, by_sub: {} };
  for (const p of pages) {
    const outTxt = path.join(REFS, `${p.slug}.txt`), outJson = path.join(REFS, `${p.slug}.json`);
    if (fs.existsSync(outJson) && !ONLY && !FORCE && !(RETRY && !fs.existsSync(outTxt))) { if (fs.existsSync(outTxt)) tally.built++; else tally.none++; continue; }
    const probe = greekProbe(p);
    const note = { slug: p.slug, substratum: p.substratum, title: p.title, year: p.year, probe_engine: probe?.engine || null, probe_greek_letters: probe ? GREEK_LETTERS(probe.text) : 0 };
    const words = probe ? greekWords(probe.text).words : [];
    if (words.length < 15) { note.reason = probe ? 'probe has < 15 Greek words (Latin leaf, plate or blank as read)' : 'no probe read for this page yet'; tally.no_probe++; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); console.log(`  – ${p.slug}: ${note.reason}`); continue; }
    let src = null;
    try {
      const c = await greekCorpusLookup(words, m => console.log(m));
      note.corpus_votes = c.votes; note.phrases = c.phrases;
      if (c.src) src = c.src;
      if (!src || src.overlap < MIN_OVERLAP) { const ws = await wikisourceLookup(words, m => console.log(m)); if (ws && (!src || ws.overlap > src.overlap)) src = ws; }
    } catch (e) { note.error = e.message.slice(0, 120); }
    if (!src) { note.reason = 'no work identified (corpus phrase vote < 3 distinct hits or tied; el.wikisource < 2 phrase hits)'; tally.none++; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); console.log(`  – ${p.slug}: ${note.reason} ${note.error || ''}`); continue; }
    Object.assign(note, { source: src.source, work: src.work, work_title: src.work_title, edition: src.edition, url: src.url, phrase_hits: src.phrase_hits, etext_chars: src.etext_chars, window_words: src.window_words, window_chars: src.window.length, overlap: +src.overlap.toFixed(3) });
    if (src.overlap < MIN_OVERLAP) { note.reason = `work identified but window overlap ${src.overlap.toFixed(2)} < ${MIN_OVERLAP} (probe too noisy, or the page is commentary/paratext around the work)`; tally.work_only++; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); console.log(`  ~ ${p.slug}: ${note.reason} (${src.source} ${src.work})`); continue; }
    const trimmed = alignTrim(src.window, greekReads(p)); note.align_trim = trimmed.note; src.window = trimmed.window; note.window_chars = src.window.length;
    if (!DRY) { fs.writeFileSync(outTxt, src.window); fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); }
    tally.built++; tally.by_source[src.source] = (tally.by_source[src.source] || 0) + 1; tally.by_sub[p.substratum] = (tally.by_sub[p.substratum] || 0) + 1;
    console.log(`  ✓ ${p.slug}: ${src.source} ${src.work} (${src.work_title}) overlap ${src.overlap.toFixed(2)} window ${src.window_words} words / probe ${words.length} via ${probe.engine}`);
  }
  console.log(`\n${STRATUM}: ${tally.built} references, ${tally.work_only} work-identified-but-no-window, ${tally.none} no work, ${tally.no_probe} no/too-short probe; by source ${JSON.stringify(tally.by_source)}; by sub-stratum ${JSON.stringify(tally.by_sub)}`);
  process.exit(0);
}
const pages = reg.pages.filter(p => (!p.spare || p.promoted) && !p.retired && (!ONLY || p.slug === ONLY));
let built = 0, none = 0;
for (const p of pages) {
  const outTxt = path.join(REFS, `${p.slug}.txt`), outJson = path.join(REFS, `${p.slug}.json`);
  if (fs.existsSync(outJson) && !ONLY && !(RETRY && !fs.existsSync(outTxt))) { if (fs.existsSync(outTxt)) built++; else none++; continue; }
  let probe = '';
  for (const e of PROBES) { const f = path.join(ROOT, STRATUM, 'out', e, `${p.slug}.txt`); if (fs.existsSync(f)) { const t = han(fs.readFileSync(f, 'utf8')); if (t.length > probe.length) probe = t; } }
  const note = { slug: p.slug, substratum: p.substratum, title: p.title, probe_chars: probe.length };
  if (probe.length < 40) { note.reason = 'probe too short (page read as textless by the probe engines)'; fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); none++; console.log(`  – ${p.slug}: ${note.reason}`); continue; }
  let src = null;
  // CBETA first for Buddhist titles (the `buddhist-canon` sub-stratum, and the Buddhist share of
  // chinese-ext's `woodblock-canon`), Kanripo-by-title first for everything else, the other as fallback.
  const buddhist = p.substratum === 'buddhist-canon' || BUDDHIST_RE.test(p.title || '');
  try { src = buddhist ? await cbetaLookup(probe) : await kanripoLookup(p.title || ''); if (!src) src = buddhist ? await kanripoLookup(p.title || '') : await cbetaLookup(probe); }
  catch (e) { note.error = e.message.slice(0, 120); }
  let w = src ? bestWindow(src.etext, probe) : null;
  if (WIDE && (!src || w.overlap < MIN_OVERLAP)) {
    try {
      const s2 = await kanripoSearch(p.title || '', probe, m => console.log(m));
      if (s2 && (!src || s2.overlap > w.overlap)) { src = s2; w = bestWindow(src.etext, probe); note.witness = s2.witness; note.wide = true; }
    } catch (e) { note.error = (note.error ? note.error + '; ' : '') + e.message.slice(0, 80); }
  }
  if (!src) { note.reason = note.reason || 'no work identified (CBETA search / Kanripo catalogue)'; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); none++; console.log(`  – ${p.slug}: ${note.reason} ${note.error || ''}`); continue; }
  const win = trimWindow(w.window, probe);
  Object.assign(note, { source: src.source, work: src.work, work_title: src.work_title || null, juan: src.juan, url: src.url, etext_chars: src.etext.length, window_chars: win.length, overlap: +w.overlap.toFixed(3) });
  if (w.overlap < MIN_OVERLAP) { note.reason = `overlap ${w.overlap.toFixed(2)} < ${MIN_OVERLAP}: page is not (cleanly) in this e-text`; if (!DRY) fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); none++; console.log(`  – ${p.slug}: ${note.reason} (${src.source} ${src.work})`); continue; }
  if (!DRY) { fs.writeFileSync(outTxt, win); fs.writeFileSync(outJson, JSON.stringify(note, null, 2)); }
  built++; console.log(`  ✓ ${p.slug}: ${src.source} ${src.work} j${src.juan} overlap ${w.overlap.toFixed(2)} window ${win.length} / probe ${probe.length}`);
}
console.log(`\n${STRATUM}: ${built} references, ${none} without`);
