#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/ai-exposure-r2-6038.mjs (branch eval/ai-exposure-r2-6038, PR #6089) — run 2 measured
 * RECALL (author from title) on the same 500; this run adds three layers that do not rely on self-report and
 * reads run 2's per-work labels as input. Its helpers live on an unmerged branch, so the few needed here
 * (Wilson, bootstrap, κ) are re-written small rather than imported. Also checked scripts/eval/cloze-probe.mjs
 * (image cloze, a different instrument) and #5549's fingerprint test (continuation, unpowered).
 *
 * #6038 run 3 — preregistration: scripts/eval/PREREGISTRATION-ai-exposure-r3-6038.md
 *   A  crawl presence: exact passage counts in infini-gram mini (CC 2025 ×7, DCLM, Pile) + infini-gram
 *      (Dolma 1.7, OLMo-2 mix, RedPajama), with web-sourced positives and shuffled negatives;
 *   B  content knowledge: closed-book questions from translated pages (Gemini; Opus via subagents);
 *   C  public machine-readable text by source.
 *
 * Stages (`--stage=`):
 *   inputs            run-2 labels → results/r2-labels.jsonl
 *   a-passages        our-OCR passages for the 500 (Mongo pages.ocr.data, READ-ONLY) + negatives
 *   a-controls        P-web (site texts), P-ours (our OCR of the same works), P-IA (_djvu.txt)
 *   a-query           count every passage in every index (resumable)
 *   a-prov            retrieve docs for a seeded 40 hits (private) for the by-eye provenance check
 *   b-pages, b-gen, b-open, b-guess, b-closed, b-judge, b-opus-packets, b-opus-ingest
 *   c-check           public e-text per work by source
 *   report
 *
 * Private material (passages, query strings, questions, answers): PRIVATE dir, never committed.
 * Mongo is read-only (find with projection + maxTimeMS only).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const stage = args.stage;
export const PRIVATE = process.env.AIEXP3_PRIVATE || '/root/claude-jobs/ai-exposure-r3-6038-private';
const R1_TEXTS = '/root/claude-jobs/ai-exposure-6038-private/texts';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'results', 'ai-exposure-r3-6038');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PRIVATE, { recursive: true });
export const ENDPOINT = 'eval/ai-exposure-r3';
const UA = 'SourceLibrary-eval/1.0 (https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6038)';

export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const appendJsonl = (f, row) => fs.appendFileSync(f, JSON.stringify(row) + '\n');
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- seeded randomness ----------
export function rng(seedStr) {
  let a = parseInt(crypto.createHash('sha256').update(String(seedStr)).digest('hex').slice(0, 8), 16) >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(arr, seedStr) { const r = rng(seedStr); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- stats ----------
export function wilson(k, n, z = 1.96) {
  if (!n) return { k, n, p: null, lo: null, hi: null };
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}
/** ratio estimate sum(w·y)/sum(w) with a percentile bootstrap over units */
export function ratioBoot(rows, yf, wf, iters = 4000, seed = '6038-boot') {
  const r = rng(seed); const n = rows.length; if (!n) return { p: null, lo: null, hi: null, n };
  const est = (idx) => { let a = 0, b = 0; for (const i of idx) { const w = wf(rows[i]); a += w * (yf(rows[i]) ? 1 : 0); b += w; } return b ? a / b : 0; };
  const p = est([...Array(n).keys()]); const bs = [];
  for (let t = 0; t < iters; t++) { const idx = Array.from({ length: n }, () => Math.floor(r() * n)); bs.push(est(idx)); }
  bs.sort((x, y) => x - y); return { p, lo: bs[Math.floor(iters * 0.025)], hi: bs[Math.floor(iters * 0.975)], n };
}
export function meanBoot(vals, iters = 4000, seed = '6038-mboot') {
  const r = rng(seed); const n = vals.length; if (!n) return { mean: null, lo: null, hi: null, n };
  const m = (a) => a.reduce((s, x) => s + x, 0) / a.length; const bs = [];
  for (let t = 0; t < iters; t++) bs.push(m(Array.from({ length: n }, () => vals[Math.floor(r() * n)])));
  bs.sort((x, y) => x - y); return { mean: m(vals), lo: bs[Math.floor(iters * 0.025)], hi: bs[Math.floor(iters * 0.975)], n };
}
export function kappa2(pairs) { // pairs of booleans
  const n = pairs.length; if (!n) return null; let a = 0, b = 0, c = 0, d = 0;
  for (const [x, y] of pairs) { if (x && y) a++; else if (x && !y) b++; else if (!x && y) c++; else d++; }
  const po = (a + d) / n, pe = ((a + b) * (a + c) + (c + d) * (b + d)) / (n * n);
  return { n, both: a, onlyA: b, onlyB: c, neither: d, agree: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
}

// ---------- run-2 inputs ----------
function gitShow(p) {
  for (const br of ['origin/eval/ai-exposure-r2-6038', 'origin/eval/ai-exposure-6038']) {
    try { return execSync(`git show ${br}:${p}`, { maxBuffer: 1 << 28 }).toString(); } catch { /* next */ }
  }
  throw new Error(`cannot read ${p} from the run-2/run-1 branches`);
}
export function loadR2() {
  const f = path.join(OUT, 'r2-labels.jsonl');
  if (fs.existsSync(f)) return readJsonl(f);
  const works = gitShow('scripts/eval/results/ai-exposure-r2-6038/works.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const pw = new Map(gitShow('scripts/eval/results/ai-exposure-r2-6038/per-work.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.id, x]));
  const rows = works.map((w) => { const p = pw.get(w.id); return {
    id: w.id, lang: w.lang, century: w.century, genre: w.genre, visible: w.visible, provider: w.provider,
    volumes: w.volumes, pages: w.pages, in_W: !!p.in_W, R: p.in_W ? !p.no_V2_union : null, R_any: !p.no_V2_union,
  }; });
  writeJsonl(f, rows); return rows;
}
const loadWorks = () => gitShow('scripts/eval/results/ai-exposure-r2-6038/works.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---------- text cleaning (prereg, layer A) ----------
/** tokens in a line: words, or CJK characters, or Tibetan syllables — whichever is most (unspaced scripts) */
const lineTokens = (l) => Math.max(l.split(' ').length, (l.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length, l.split('\u0F0B').length);
const ONE_LINE_ELEMENT = /^\s*<([a-z][a-z0-9-]*)(\s[^>]*)?>[^\n]*<\/\1>\s*$/gim;
/** returns cleaned text with '\n' kept at source line breaks (amendment 1) */
export function cleanForPassages(raw, { dropEdgeLines = true } = {}) {
  let t = String(raw || '').normalize('NFC').replace(/ſ/g, 's').replace(/­/g, '');
  t = t.replace(/<header>[\s\S]*?<\/header>/gi, '\n').replace(/<footer>[\s\S]*?<\/footer>/gi, '\n').replace(ONE_LINE_ELEMENT, '');
  t = t.replace(/<[^>\n]{0,200}>/g, ' ');
  let lines = t.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  lines = lines.filter((l) => !/^[\d\s.,:;()\-–—]+$/.test(l) && lineTokens(l) > 2);
  if (dropEdgeLines && lines.length) lines = lines.slice(1, -1);
  lines = lines.map((l) => l.replace(/\[[^\]]{0,300}\]/g, ' ').replace(/[#*_>|`]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let j = lines.join('\n');
  j = j.replace(/([\p{L}])[-¬⸗]\n(?=\p{L})/gu, '$1');
  return j.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

const RE_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const RE_TIB = /[ཀ-ྼ]/u;
export function scriptOf(text) {
  let cjk = 0, tib = 0, other = 0;
  for (const ch of text.slice(0, 20000)) { if (RE_CJK.test(ch)) cjk++; else if (RE_TIB.test(ch)) tib++; else if (/\p{L}/u.test(ch)) other++; }
  if (tib > other && tib > cjk) return 'tibetan';
  if (cjk > other * 0.5 && cjk > 30) return 'cjk';
  return 'words';
}
const MINLEN_SHORT = /[\p{Script=Devanagari}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Bengali}]/u;
const WORD_OK = /^[\p{L}\p{M}'’·.,;:]+$/u;
const PUNCT = /[.,;:·]/;

/** candidate windows on one cleaned page: [{sp, nl, start}] ; sp = space-joined, nl = with source line breaks */
export function windowsOf(clean, script) {
  const out = [];
  if (script === 'words') {
    // tokens with the separator that FOLLOWS each token
    const toks = []; const re = /(\S+)(\s*)/g; let m;
    while ((m = re.exec(clean))) toks.push({ w: m[1], sep: m[2].includes('\n') ? '\n' : ' ', at: m.index });
    const skip = clean.length >= 150 ? clean.length * 0.2 : 0;
    for (let i = 0; i + 8 <= toks.length; i++) {
      if (toks[i].at < skip) continue;
      const win = toks.slice(i, i + 8);
      if (!win.every((x) => WORD_OK.test(x.w) && /\p{L}/u.test(x.w))) continue;
      const sp = win.map((x) => x.w).join(' ');
      const minLen = MINLEN_SHORT.test(sp) ? 30 : 40;
      if (sp.length < minLen) continue;
      const nl = win.map((x, k) => x.w + (k < 7 ? x.sep : '')).join('');
      out.push({ sp, nl, start: toks[i].at, end: toks[i + 7].at + toks[i + 7].w.length, punct: PUNCT.test(sp) });
    }
  } else if (script === 'cjk') {
    const chars = [...clean]; let pos = 0; const idx = [];
    for (const ch of chars) { idx.push(pos); pos += ch.length; }
    const skip = clean.length >= 30 ? clean.length * 0.2 : 0;
    // runs of CJK characters, allowing a line break inside (amendment 1)
    for (let i = 0; i < chars.length; i++) {
      if (idx[i] < skip) continue;
      const take = []; let nl = ''; let j = i;
      while (j < chars.length && take.length < 10) {
        const ch = chars[j];
        if (RE_CJK.test(ch)) { take.push(ch); nl += ch; j++; } else if (ch === '\n' && take.length) { nl += '\n'; j++; } else break;
      }
      if (take.length === 10) out.push({ sp: take.join(''), nl: nl.replace(/\n$/, ''), start: idx[i], end: idx[j - 1] + 1, punct: false });
    }
    // sp for CJK has no separator: a line break simply disappears; nl keeps it
  } else {
    // Tibetan: clauses = maximal runs of Tibetan letters/marks and tsheg, no shad, no space
    const re = /[ཀ-ྼ་\n]+/gu; let m;
    const skip = clean.length >= 72 ? clean.length * 0.2 : 0;
    while ((m = re.exec(clean))) {
      if (m.index < skip) continue;
      const clause = m[0].replace(/^\n+|\n+$/g, '');
      const sylls = clause.split('་').filter((s) => s.length);
      for (let i = 0; i + 8 <= sylls.length; i++) {
        const win = sylls.slice(i, i + 8);
        const nl = win.join('་'); const sp = nl.replace(/\n/g, '');
        if (sp.length < 24) continue;
        out.push({ sp, nl, start: m.index, end: m.index + clause.length, punct: false });
      }
    }
  }
  return out;
}

/** choose up to k passages from an ordered list of {page, raw} using the prereg rules */
export function choosePassages(pages, k, seedBase, opts = {}) {
  const chosen = []; const used = new Map();
  const pickFrom = (pg, round) => {
    const clean = cleanForPassages(pg.raw, opts); if (!clean) return null;
    const script = scriptOf(clean);
    let wins = windowsOf(clean, script).filter((w) => !(used.get(pg.page) || []).some(([s, e]) => w.start < e && w.end > s));
    wins = wins.filter((w) => !chosen.some((c) => c.sp === w.sp));
    if (!wins.length) return null;
    const pf = wins.filter((w) => !w.punct); const pool = pf.length ? pf : wins;
    const r = rng(`${seedBase}-${pg.page}-${round}`); const w = pool[Math.floor(r() * pool.length)];
    used.set(pg.page, [...(used.get(pg.page) || []), [w.start, w.end]]);
    return { page: pg.page, script, sp: w.sp, nl: w.nl };
  };
  for (const pg of pages) { if (chosen.length >= k) break; const p = pickFrom(pg, 0); if (p) chosen.push(p); }
  if (chosen.length < k && chosen.length) { // fewer than k usable pages: second, non-overlapping passage per page
    for (const pg of pages) { if (chosen.length >= k) break; if (!chosen.some((c) => c.page === pg.page)) continue; const p = pickFrom(pg, 1); if (p) chosen.push(p); }
  }
  return chosen;
}
export function negativeOf(p, seedStr) {
  let toks; let joiner;
  if (p.script === 'words') { toks = p.sp.split(' '); joiner = ' '; } else if (p.script === 'cjk') { toks = [...p.sp]; joiner = ''; } else { toks = p.sp.split('་'); joiner = '་'; }
  for (let t = 0; t < 10; t++) { const s = shuffle(toks, `${seedStr}-${t}`).join(joiner); if (s !== p.sp) return { ...p, sp: s, nl: s }; }
  return null;
}

// ---------- Mongo (READ-ONLY) ----------
async function mongo() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  return { c, db: c.db('bookstore') };
}
async function bodyPages(db, bookId, seedStr, need = 12) {
  const nums = (await db.collection('pages').find({ book_id: bookId, 'ocr.data': { $exists: true } }, { projection: { page_number: 1 }, maxTimeMS: 60000 }).toArray()).map((p) => p.page_number).filter((n) => n != null).sort((a, b) => a - b);
  let body = nums;
  if (nums.length > 10) { const lo = nums[Math.floor(nums.length * 0.10)], hi = nums[Math.min(nums.length - 1, Math.floor(nums.length * 0.95))]; body = nums.filter((n) => n >= lo && n <= hi); }
  const order = shuffle(body, seedStr);
  const out = [];
  for (let i = 0; i < order.length && out.length < need * 3; i += 8) {
    const batch = order.slice(i, i + 8);
    const ps = await db.collection('pages').find({ book_id: bookId, page_number: { $in: batch } }, { projection: { page_number: 1, 'ocr.data': 1 }, maxTimeMS: 60000 }).toArray();
    const byN = new Map(ps.map((p) => [p.page_number, p.ocr?.data || '']));
    for (const n of batch) out.push({ page: n, raw: byN.get(n) || '' });
    // stop early once enough pages have usable windows
    const usable = out.filter((p) => { const c = cleanForPassages(p.raw); return c && windowsOf(c, scriptOf(c)).length; }).length;
    if (usable >= need) break;
  }
  return { pages: out, nOcr: nums.length };
}

// ---------- stage: inputs ----------
async function stageInputs() { const r = loadR2(); console.log('r2 labels', r.length, 'W', r.filter((x) => x.in_W).length, 'R in W', r.filter((x) => x.R).length); }

// ---------- stage: a-passages ----------
async function stageAPassages() {
  const works = loadWorks(); const { c, db } = await mongo();
  const priv = path.join(PRIVATE, 'passages-main.jsonl'); const done = new Set(readJsonl(priv).map((p) => p.id));
  let n = 0;
  for (const w of works) {
    if (done.has(w.id)) continue;
    const { pages, nOcr } = await bodyPages(db, w.id, `6038-A-${w.id}`, 5);
    let ps = choosePassages(pages, 5, `6038-A-${w.id}`);
    let src = 'mongo';
    if (!ps.length) {
      const f = path.join(R1_TEXTS, `${w.id}.txt`);
      if (fs.existsSync(f)) { const txt = fs.readFileSync(f, 'utf8'); const chunks = txt.split(/\n{2,}(?=\S)/).reduce((a, s) => { if (!a.length || a[a.length - 1].length > 2500) a.push(s); else a[a.length - 1] += '\n\n' + s; return a; }, []); ps = choosePassages(chunks.map((raw, i) => ({ page: `r1-${i}`, raw })), 5, `6038-A-${w.id}`); src = 'run1-text'; }
    }
    const neg = ps.length ? negativeOf(ps[0], `6038-N-${w.id}`) : null;
    appendJsonl(priv, { id: w.id, src, n_ocr_pages: nOcr, passages: ps, negative: neg });
    if (++n % 25 === 0) console.log('passages', n);
  }
  await c.close();
  const all = readJsonl(priv);
  console.log('works', all.length, 'with ≥1 passage', all.filter((x) => x.passages.length).length, 'with 5', all.filter((x) => x.passages.length === 5).length, 'fallback', all.filter((x) => x.src !== 'mongo').length);
}

// ---------- stage: a-controls ----------
const PWEB = [
  { work: 'Iliad', ours: '697e23cbcb3f7c9faa3f06a8', src: 'perseus', url: 'https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/tlg0012/tlg001/tlg0012.tlg001.perseus-grc2.xml' },
  { work: 'Odyssey', ours: '69937949b0a84a57639645df', src: 'perseus', url: 'https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/tlg0012/tlg002/tlg0012.tlg002.perseus-grc2.xml' },
  { work: 'Phaedo', ours: '69937767b0a84a57639639fe', src: 'perseus', url: 'https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/tlg0059/tlg004/tlg0059.tlg004.perseus-grc2.xml' },
  { work: 'Euclid, Elements', ours: '6993881574305116d72cef37', src: 'perseus', url: 'https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/tlg1799/tlg001/tlg1799.tlg001.perseus-grc2.xml' },
  { work: 'Marcus Aurelius', ours: '6953ce4d77f38f6761be36fb', src: 'perseus', url: 'https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/tlg0562/tlg001/tlg0562.tlg001.perseus-grc2.xml' },
  { work: 'Genesis (Hebrew)', ours: '6952e4bc77f38f6761bc7db1', src: 'sefaria', refs: ['Genesis.1', 'Genesis.2', 'Genesis.3', 'Genesis.4', 'Genesis.5', 'Genesis.6'] },
  { work: 'Vulgate Genesis', ours: '6952e4c677f38f6761bc882d', src: 'html', url: 'https://www.thelatinlibrary.com/bible/genesis.shtml' },
  { work: 'Aeneid', ours: '69b3e5f9304c1c6b3950aace', src: 'html', url: 'https://www.thelatinlibrary.com/vergil/aen1.shtml' },
  { work: 'Ovid, Metamorphoses', ours: '69b2214608069e96e842f2a2', src: 'html', url: 'https://www.thelatinlibrary.com/ovid/ovid.met1.shtml' },
  { work: 'Caesar, De bello Gallico', ours: '69b221c408069e96e84310d0', src: 'html', url: 'https://www.thelatinlibrary.com/caesar/gall1.shtml' },
  { work: 'Cicero, De officiis', ours: '69aec50d3b6ebce5e0ee87d0', src: 'html', url: 'https://www.thelatinlibrary.com/cicero/off1.shtml' },
  { work: 'Bacon, Novum organum', ours: '69529492b184004c526a1963', src: 'html', url: 'https://www.thelatinlibrary.com/bacon/bacon.liber1.shtml' },
  { work: 'De imitatione Christi', ours: '69f331a6876dd827cbc4927d', src: 'wiki', wiki: 'la', pages: ['De imitatione Christi/I'] },
  { work: 'Newton, Principia', ours: '15c5d8e4-cea3-4b5b-9859-f3528660ecc8', src: 'wiki', wiki: 'la', pages: ['Philosophiae Naturalis Principia Mathematica/Definitiones', 'Philosophiae Naturalis Principia Mathematica/Axiomata, sive Leges Motus', 'Philosophiae Naturalis Principia Mathematica/Liber I/Sect. I. DE Methodo rationum primarum & ultima rum.'] },
  { work: 'Chymische Hochzeit', ours: '695933aab282844d7b277612', src: 'wiki', wiki: 'de', search: 'Chymische Hochzeit Christiani Rosencreütz' },
  { work: 'Il Principe', ours: '69aea59e57ed98c21d25a62a', src: 'wiki', wiki: 'it', pages: ['Il Principe/Capitolo I', 'Il Principe/Capitolo II', 'Il Principe/Capitolo III', 'Il Principe/Capitolo XVIII'] },
  { work: 'Divina Commedia', ours: '69b2212608069e96e842ec85', src: 'wiki', wiki: 'it', pages: ['Divina Commedia/Inferno/Canto I', 'Divina Commedia/Inferno/Canto III', 'Divina Commedia/Inferno/Canto V'] },
  { work: 'Bhagavad Gita', ours: '69e13a120dae29249d20b73f', src: 'wiki', wiki: 'sa', pages: ['भगवद्गीता/अर्जुनविषादयोगः', 'भगवद्गीता/साङ्ख्ययोगः', 'भगवद्गीता/कर्मयोगः'] },
  { work: 'Analects', ours: '69e8b24d2ff2a8dc09e77295', src: 'wiki', wiki: 'zh', pages: ['論語/學而第一', '論語/爲政第二', '論語/里仁第四', '論語/述而第七'] },
  { work: 'Daodejing', ours: '69e8b25c2ff2a8dc09e7773b', src: 'wiki', wiki: 'zh', pages: ['道德經 (王弼本)'] },
  { work: 'Mencius', ours: '69e8b2562ff2a8dc09e774b0', src: 'wiki', wiki: 'zh', pages: ['孟子/梁惠王下', '孟子/告子上', '孟子/離婁上'] },
  { work: 'Zhuangzi', ours: '69e72c60a409200ea79f46f6', src: 'wiki', wiki: 'zh', pages: ['莊子/逍遙遊', '莊子/齊物論'] },
  { work: 'Augustine, Confessions', ours: '69ac9bb499d9a0170d090bb2', src: 'gutenberg', url: 'https://www.gutenberg.org/cache/epub/3296/pg3296.txt' },
  { work: 'Boethius (tr. I.T.)', ours: '6955943d7bd6d2cd1d61d196', src: 'gutenberg', url: 'https://www.gutenberg.org/cache/epub/14328/pg14328.txt' },
  { work: 'Descartes, Discours', ours: '6953e51c77f38f6761befc93', src: 'gutenberg', url: 'https://www.gutenberg.org/cache/epub/13846/pg13846.txt' },
  { work: 'Hobbes, Leviathan', ours: '69906623ef12272ffdc952c7', src: 'gutenberg', url: 'https://www.gutenberg.org/cache/epub/3207/pg3207.txt' },
  { work: 'More, Utopia', ours: 'c01d8a64-b9de-4012-9af9-e4a85e340722', src: 'gutenberg', url: 'https://www.gutenberg.org/cache/epub/2130/pg2130.txt' },
  { work: 'Lucretius', ours: '69924f3609c5da0cf50d73fb', src: 'gutenberg', url: 'https://www.gutenberg.org/cache/epub/785/pg785.txt' },
];
async function fetchText(url, json = false) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) }); if (r.ok) return json ? await r.json() : await r.text(); if (r.status === 404 || r.status === 403) return null; } catch { /* retry */ }
    await sleep(2000 * (t + 1));
  }
  return null;
}
const htmlToText = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<(br|p|div|l|lb|li|tr|h\d)\b[^>]*>/gi, '\n').replace(/<\/(p|div|l|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"');
/** remove every <div>/<table>/<span> whose class or id marks site chrome (headers, licence banners, nav, sister links) */
const CHROME = /(noprint|noexport|license|licence|header|navbox|metadata|sister|interproject|toc|reference|catlinks|pagenum|mw-editsection|wst-|ws-|mw-heading|plainlinks)/i;
function stripChrome(html) {
  let s = html;
  for (const tag of ['div', 'table', 'span']) {
    for (let guard = 0; guard < 500; guard++) {
      const re = new RegExp(`<${tag}\\b[^>]*(class|id)="[^"]*"[^>]*>`, 'gi'); let m; let found = null;
      while ((m = re.exec(s))) { const attrs = m[0].match(/(?:class|id)="([^"]*)"/gi).join(' '); if (CHROME.test(attrs)) { found = m; break; } }
      if (!found) break;
      // find the matching close tag by depth counting
      const open = new RegExp(`<${tag}\\b`, 'gi'), close = new RegExp(`</${tag}>`, 'gi'); let depth = 0; let pos = found.index; let end = s.length;
      const tok = new RegExp(`<${tag}\\b|</${tag}>`, 'gi'); tok.lastIndex = pos; let t;
      while ((t = tok.exec(s))) { if (t[0][1] === '/') { depth--; if (depth === 0) { end = t.index + t[0].length; break; } } else depth++; }
      void open; void close;
      s = s.slice(0, found.index) + ' ' + s.slice(end);
    }
  }
  return s;
}
async function wikiText(wiki, page) {
  const j = await fetchText(`https://${wiki}.wikisource.org/w/api.php?action=parse&format=json&prop=text&formatversion=2&page=${encodeURIComponent(page)}`, true);
  if (!j?.parse?.text) return null;
  return htmlToText(stripChrome(j.parse.text).replace(/<sup[\s\S]*?<\/sup>/g, ''));
}
/** split a long text into ~page-sized chunks on line boundaries and keep the 10–95% body */
function chunkBody(text, size = 2500) {
  const lines = text.split('\n'); const chunks = []; let cur = '';
  for (const l of lines) { cur += l + '\n'; if (cur.length > size) { chunks.push(cur); cur = ''; } }
  if (cur.trim()) chunks.push(cur);
  if (chunks.length > 10) return chunks.slice(Math.floor(chunks.length * 0.10), Math.ceil(chunks.length * 0.95));
  return chunks;
}
async function webTextOf(c) {
  if (c.src === 'perseus') { const x = await fetchText(c.url); if (!x) return null; const body = x.split(/<body>/i)[1] || x; return htmlToText(body.replace(/<note[\s\S]*?<\/note>/g, '').replace(/<(l|p|lb)\b/g, '\n<$1')); }
  if (c.src === 'html') { const x = await fetchText(c.url); return x ? htmlToText(x) : null; }
  if (c.src === 'gutenberg') { const x = await fetchText(c.url); if (!x) return null; const a = x.split(/\*\*\* ?START OF[^\n]*\n/)[1] || x; return a.split(/\*\*\* ?END OF/)[0]; }
  if (c.src === 'sefaria') { let s = ''; for (const r of c.refs) { const j = await fetchText(`https://www.sefaria.org/api/v3/texts/${r}?version=hebrew`, true); const v = j?.versions?.[0]?.text; if (Array.isArray(v)) s += v.map((x) => htmlToText(String(x)).replace(/[֑-ֽֿ֯׀׃׆]/g, '')).join('\n') + '\n'; } return s || null; }
  if (c.src === 'wiki') {
    let pages = c.pages;
    if (!pages && c.search) { const j = await fetchText(`https://${c.wiki}.wikisource.org/w/api.php?action=query&list=search&format=json&srlimit=10&srsearch=${encodeURIComponent(c.search)}`, true); pages = (j?.query?.search || []).map((x) => x.title).filter((t) => /hochzeit/i.test(t)).slice(0, 3); }
    let s = ''; for (const p of pages || []) { const t = await wikiText(c.wiki, p); if (t) s += t + '\n'; await sleep(500); }
    return s || null;
  }
  return null;
}
async function stageAControls() {
  const { c, db } = await mongo();
  // P-web and P-ours
  const fweb = path.join(PRIVATE, 'passages-pweb.jsonl'); const fours = path.join(PRIVATE, 'passages-pours.jsonl');
  const doneW = new Set(readJsonl(fweb).map((x) => x.work)); const doneO = new Set(readJsonl(fours).map((x) => x.work));
  for (const ctl of PWEB) {
    if (!doneW.has(ctl.work)) {
      const txt = await webTextOf(ctl);
      let ps = [];
      if (txt) { const chunks = chunkBody(txt).map((raw, i) => ({ page: i, raw })); ps = choosePassages(shuffle(chunks, `6038-W-${ctl.work}`), 5, `6038-W-${ctl.work}`); }
      appendJsonl(fweb, { work: ctl.work, src: ctl.src, fetched: !!txt, chars: txt ? txt.length : 0, passages: ps });
      console.log('P-web', ctl.work, txt ? txt.length : 'FETCH FAILED', ps.length);
    }
    if (!doneO.has(ctl.work)) {
      const { pages } = await bodyPages(db, ctl.ours, `6038-A-${ctl.ours}`, 5);
      const ps = choosePassages(pages, 5, `6038-A-${ctl.ours}`);
      appendJsonl(fours, { work: ctl.work, id: ctl.ours, passages: ps });
      console.log('P-ours', ctl.work, ps.length);
    }
  }
  writeJsonl(path.join(OUT, 'controls-A.jsonl'), PWEB.map((x) => ({ work: x.work, ours: x.ours, src: x.src, url: x.url || null, wiki: x.wiki || null, pages: x.pages || x.refs || null })));
  // P-IA: seeded 60 IA-sourced works of the 500
  const books = JSON.parse(fs.readFileSync(path.join(PRIVATE, 'books500.json'), 'utf8'));
  const iaWorks = shuffle(books.filter((b) => b.ia).map((b) => b.id).sort(), '6038-IA').slice(0, 60);
  const fia = path.join(PRIVATE, 'passages-pia.jsonl'); const doneI = new Set(readJsonl(fia).map((x) => x.id));
  for (const id of iaWorks) {
    if (doneI.has(id)) continue;
    const b = books.find((x) => x.id === id);
    const meta = await fetchText(`https://archive.org/metadata/${encodeURIComponent(b.ia)}`, true);
    const f = (meta?.files || []).find((x) => /_djvu\.txt$/.test(x.name));
    let ps = []; let chars = 0;
    if (f) {
      const txt = await fetchText(`https://archive.org/download/${encodeURIComponent(b.ia)}/${encodeURIComponent(f.name)}`);
      if (txt) { chars = txt.length; const pages = txt.includes('\f') ? txt.split('\f') : chunkBody(txt, 2500); const body = pages.length > 10 ? pages.slice(Math.floor(pages.length * 0.1), Math.ceil(pages.length * 0.95)) : pages; ps = choosePassages(shuffle(body.map((raw, i) => ({ page: i, raw })), `6038-IA-${id}`), 5, `6038-IA-${id}`); }
    }
    appendJsonl(fia, { id, ia: b.ia, djvu: f?.name || null, chars, passages: ps });
    console.log('P-IA', id, f ? chars : 'no djvu', ps.length);
    await sleep(300);
  }
  await c.close();
}

// ---------- stage: a-query ----------
// amendment 2: 4 of the 7 CC snapshots (rate limit); the other three stay listed for the provenance step only
export const MINI = ['v2_cc-2025-05', 'v2_cc-2025-13', 'v2_cc-2025-21', 'v2_cc-2025-30', 'v2_dclm_all', 'v2_piletrain'];
export const MINI_ALL = [...MINI, 'v2_cc-2025-08', 'v2_cc-2025-18', 'v2_cc-2025-26'];
export const IG = ['v4_dolma-v1_7_llama', 'v4_olmo-mix-1124_llama', 'v4_rpj_llama_s4'];
// Both APIs sit behind AWS API Gateway and answer 403 ForbiddenException when a client is too fast
// (observed 2026-10-06 at ~8 requests in flight; lifted after ~1 min). Adaptive per-host token bucket:
// on 403, pause the host 90 s and cut its rate by 30%; after 300 clean calls, raise it by 10%.
const HOSTS = { mini: { url: 'https://api.infini-gram-mini.io/', rate: Number(args.rate || 2), next: 0, pauseUntil: 0, ok: 0, blocks: 0 }, ig: { url: 'https://api.infini-gram.io/', rate: Number(args.rate || 2), next: 0, pauseUntil: 0, ok: 0, blocks: 0 } };
async function takeToken(h) {
  for (;;) { const now = Date.now(); const at = Math.max(h.next, h.pauseUntil, now); if (at <= now) { h.next = now + 1000 / h.rate; return; } h.next = Math.max(h.next, h.pauseUntil); await sleep(at - now); }
}
async function countQ(index, query) {
  const h = MINI_ALL.includes(index) ? HOSTS.mini : HOSTS.ig;
  for (let t = 0; t < 6; t++) {
    await takeToken(h);
    try {
      const r = await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ index, query_type: 'count', query }), signal: AbortSignal.timeout(90000) });
      if (r.status === 403 || r.status === 429) { h.blocks++; h.pauseUntil = Date.now() + 90000; h.rate = Math.max(0.3, h.rate * 0.7); console.log(`[${h === HOSTS.mini ? 'mini' : 'ig'}] ${r.status}: pause 90 s, rate → ${h.rate.toFixed(2)}/s`); continue; }
      if (r.ok) { const j = await r.json(); if (typeof j.count === 'number') { if (++h.ok % 300 === 0) h.rate = Math.min(6, h.rate * 1.1); return j.count; } }
    } catch { /* retry */ }
    await sleep(1500 * (t + 1));
  }
  return -1; // error, never 0
}
function allQueries() {
  const q = [];
  const add = (set, id, k, p) => { if (!p) return; q.push({ set, id, k, h: sha(p.sp), text: p.sp }); if (p.nl && p.nl !== p.sp) q.push({ set, id, k, h: sha(p.nl), text: p.nl, variant: 'nl' }); };
  for (const x of readJsonl(path.join(PRIVATE, 'passages-pweb.jsonl'))) x.passages.forEach((p, k) => add('pweb', x.work, k, p));
  for (const x of readJsonl(path.join(PRIVATE, 'passages-pours.jsonl'))) x.passages.forEach((p, k) => add('pours', x.work, k, p));
  for (const x of readJsonl(path.join(PRIVATE, 'passages-main.jsonl'))) { x.passages.forEach((p, k) => add('main', x.id, k, p)); add('neg', x.id, 0, x.negative); }
  for (const x of readJsonl(path.join(PRIVATE, 'passages-pia.jsonl'))) x.passages.forEach((p, k) => add('pia', x.id, k, p));
  return q;
}
async function stageAQuery() {
  const sets = String(args.sets || 'pweb,pours,neg,main,pia').split(',');
  const fcount = path.join(OUT, 'counts.jsonl'); // public: hash + counts only
  const have = new Map(readJsonl(fcount).map((r) => [r.h, r]));
  const todo = []; const seen = new Set();
  for (const s of sets) for (const q of allQueries().filter((x) => x.set === s)) { if (seen.has(q.h)) continue; seen.add(q.h); const prev = have.get(q.h); const need = [...MINI, ...IG].filter((ix) => !prev || prev.counts[ix] == null || prev.counts[ix] < 0); if (need.length) todo.push({ ...q, need, prev }); }
  console.log('queries to run', todo.length, 'index calls', todo.reduce((s, x) => s + x.need.length, 0));
  const conc = Number(args.conc || 8); let i = 0, doneN = 0; const t0 = Date.now();
  async function worker() {
    while (i < todo.length) {
      const q = todo[i++]; const counts = { ...(q.prev?.counts || {}) };
      // infini-gram v4 indexes are fast; mini indexes ~0.75 s each, issued in sequence per passage
      await Promise.all([q.need.filter((ix) => MINI_ALL.includes(ix)), q.need.filter((ix) => !MINI_ALL.includes(ix))].map(async (ixs) => { for (const ix of ixs) counts[ix] = await countQ(ix, q.text); }));
      appendJsonl(fcount, { h: q.h, set: q.set, counts });
      if (++doneN % 100 === 0) console.log(`${doneN}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  // compact: last row per hash wins
  const rows = new Map(readJsonl(fcount).map((r) => [r.h, r])); writeJsonl(fcount, [...rows.values()]);
  console.log('done', rows.size);
}

// ---------- stage: a-prov ----------
async function stageAProv() {
  const counts = new Map(readJsonl(path.join(OUT, 'counts.jsonl')).map((r) => [r.h, r.counts]));
  const hits = allQueries().filter((q) => q.set === 'main').filter((q) => { const c = counts.get(q.h); return c && Object.values(c).some((n) => n > 0); });
  const byWork = new Map(); for (const h of hits) if (!byWork.has(h.id)) byWork.set(h.id, h); // one hit per work
  const pick = shuffle([...byWork.values()].sort((a, b) => a.h.localeCompare(b.h)), '6038-PROV').slice(0, Number(args.n || 40));
  const out = path.join(PRIVATE, 'prov-docs.jsonl'); const done = new Set(readJsonl(out).map((x) => x.h));
  for (const q of pick) {
    if (done.has(q.h)) continue;
    const c = counts.get(q.h); const ix = MINI.find((x) => c[x] > 0 && x.startsWith('v2_cc')) || MINI.find((x) => c[x] > 0);
    let doc = null;
    if (ix) {
      try {
        const f = await (await fetch('https://api.infini-gram-mini.io/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: ix, query_type: 'find', query: q.text }), signal: AbortSignal.timeout(90000) })).json();
        const seg = (f.segment_by_shard || []).findIndex(([a, b]) => b > a);
        if (seg >= 0) doc = await (await fetch('https://api.infini-gram-mini.io/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: ix, query_type: 'get_doc_by_rank', s: seg, rank: f.segment_by_shard[seg][0], max_ctx_len: 600 }), signal: AbortSignal.timeout(90000) })).json();
      } catch (e) { doc = { error: String(e.message) }; }
    }
    appendJsonl(out, { h: q.h, id: q.id, index: ix || 'v4-only', counts: c, passage: q.text, doc: doc ? { text: String(doc.text || '').slice(0, 1500), meta: doc.metadata || doc.doc_meta || null, error: doc.error || null } : null });
    console.log('prov', q.id, ix);
  }
}

// ---------- dispatch (layers B, C and the report: ai-exposure-r3-6038-bc.mjs) ----------
export const STAGES = { inputs: stageInputs, 'a-passages': stageAPassages, 'a-controls': stageAControls, 'a-query': stageAQuery, 'a-prov': stageAProv };
export const ctx = { args, OUT, PRIVATE, mongo, fetchText, wikiText, htmlToText, loadR2, loadWorks, allQueries, UA };
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  if (!STAGES[stage]) { console.error('--stage=' + Object.keys(STAGES).join('|') + '  (layers B, C and report: scripts/eval/ai-exposure-r3-6038-bc.mjs)'); process.exit(1); }
  await STAGES[stage]();
}
