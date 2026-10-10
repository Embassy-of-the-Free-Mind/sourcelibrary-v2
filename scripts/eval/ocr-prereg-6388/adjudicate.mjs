#!/usr/bin/env node
// PRIOR ART: score.mjs + network.mjs in this directory (the spans, the normalisation and the scoring rule; reused
// through network.mjs so the spans here are byte-for-byte the ones in adjudication-<stratum>.jsonl.gz);
// reads.mjs `runClaude` (the `claude -p` call shape, copied with --model opus / fable); ../run-cli-arm.py (the
// `agy -p` call shape: plan mode, JSON output, one nudge on a denied tool, the shared call log; copied into node
// because a call here attaches the page plus its tiles and run-cli-arm attaches one file). Nothing in scripts/eval
// adjudicates spans with models under a family rule (Amendment 2 on #6388).
/**
 * adjudicate.mjs — #6388 Amendment 2: model adjudication of the reader disagreements, then Q1–Q3 again.
 * Every number it prints is on a **model-adjudicated key (no human)**. $0: subscription CLIs only. No Mongo writes.
 *
 *   node adjudicate.mjs build                       → adjudication/pages.json (spans, planted controls, option order)
 *   node adjudicate.mjs run <opus|gpro|fable> <control|main|repeat|transcribe|tiebreak> [--parallel N]
 *   node adjudicate.mjs gate                        → planted-span catch rate per adjudicator
 *   node adjudicate.mjs score                       → adjudication/results.json, results.md
 *
 * Images and tiles live under $JOB_SCRATCH/adj; the raw replies land in adjudication/raw/<who>-<set>.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { buildNetwork, isZh, norm, outcomeOf } from './network.mjs';
import { makeRng, bootstrapCI, resetSeed, mean } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'adjudication');
const RAW = path.join(OUT, 'raw');
const SCRATCH = path.join(process.env.JOB_SCRATCH || '/tmp', 'adj');
const SRC_IMG = '/mnt/HC_Volume_105839809/jobs/ocr-prereg-6388/work/img';
const PROMPTS = '/mnt/HC_Volume_105839809/jobs/ocr-prereg-6388/work';
const SEED = 6388, BOOT_SEED = 6386, MIN_EFFECT = 0.01, PLANTED_PER_PAGE = 5, REPEAT_PAGES = 8;
const MODELS = { opus: 'opus', fable: 'fable', gpro: 'gemini-3.1-pro-high' };
const STRATA = ['latin-print', 'zh-manuscript', 'english-print'];
const READERS = st => (isZh(st) ? ['G', 'S'] : ['G', 'S', 'O']);
const ARMS = ['P', 'L1', 'L2', 'G', 'S', 'O', 'IA'];
const LABEL = 'model-adjudicated key (no human)';

const fnv1a = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const rngFor = s => makeRng((SEED ^ fnv1a(s)) >>> 0);
const shuffle = (xs, r) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const strip = s => s.replace(/ /g, '');
const safe = uid => uid.replace(/[^\w.-]/g, '_');
const readJsonl = f => {
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : fs.existsSync(`${f}.gz`) ? zlib.gunzipSync(fs.readFileSync(`${f}.gz`)).toString('utf8') : '';
  return text.split('\n').filter(Boolean).map(l => JSON.parse(l));
};
const append = (f, row) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(row) + '\n'); };

// ── pages and spans, exactly as score.mjs builds the adjudication lists ─────────────────────────────────────────
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'sample.json'), 'utf8')).rows;
const reads = Object.fromEntries(ARMS.map(a => [a, new Map(readJsonl(path.join(HERE, 'reads', `${a}.jsonl`)).map(r => [r.uid, r]))]));
// lib/metrics.mjs cleanMarkup strips tags with /<[^>]*>/, which also eats everything from a `<-` that closes one
// ->centered<- line to the `->` that opens the next. Reads are scored as preregistered (`chars`); `charsFixed`, with
// the centring arrows removed first, is the sensitivity check, and new text (transcriptions, write-ins) uses it.
const uncenter = t => (t || '').replace(/->|<-/g, ' ');
const pages = sample.map(s => {
  const arm = {};
  for (const a of ARMS) {
    const r = reads[a].get(s.uid);
    const chars = norm(r?.text, s.stratum, false);
    arm[a] = { outcome: outcomeOf(r, chars), chars, charsFixed: norm(uncenter(r?.text), s.stratum, false), raw: r?.text || '' };
  }
  return { ...s, arm };
});
const control = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'control-set.json'), 'utf8')).uids);

// The network over the key readers with text (spaces kept) plus P; every merged span, classified.
function analyse(p) {
  const st = p.stratum, voters = READERS(st).filter(a => p.arm[a].outcome === 'text');
  if (voters.length < 2) return { voters, transcribe: true };
  const strs = voters.map(a => norm(p.arm[a].raw, st, true));
  const withP = p.arm.P.outcome === 'text' ? [...strs, norm(p.arm.P.raw, st, true)] : strs;
  const cols = buildNetwork(withP), nv = voters.length;
  const dis = cols.map(c => { const v = c.slice(0, nv); return v.some(x => x !== v[0]); });
  const merged = [];
  for (let i = 0; i < cols.length; i++) {
    if (!dis[i]) continue;
    const last = merged[merged.length - 1];
    if (last && i - last[1] <= 3) last[1] = i; else merged.push([i, i]);
  }
  const read = (a, b, idx) => cols.slice(a, b + 1).map(c => c[idx] ?? '').join('');
  const ctx = (a, b) => cols.slice(Math.max(0, a), b).map(c => c.slice(0, nv).find(x => x !== null) ?? '').join('');
  let si = 0;
  const spans = merged.map(([a, b]) => {
    const readings = Object.fromEntries(voters.map((v, i) => [v, read(a, b, i)]));
    const kinds = new Set(voters.map(v => strip(readings[v])));
    const spaceOnly = kinds.size === 1;
    const krakenOnly = !spaceOnly && voters.includes('O') && voters.includes('G') && voters.includes('S') && strip(readings.G) === strip(readings.S);
    const sp = { a, b, readings, spaceOnly, krakenOnly, si: spaceOnly ? null : si++, before: ctx(a - 30, a), after: ctx(b + 1, b + 31) };
    // candidates: the distinct readings (spacing ignored), first spelling kept
    const seen = new Map();
    for (const v of voters) { const k = strip(readings[v]); if (!seen.has(k)) seen.set(k, readings[v].trim()); }
    sp.cands = [...seen.values()];
    return sp;
  });
  return { voters, nv, cols, dis, spans, ctx, withP };
}

// ── planted controls ────────────────────────────────────────────────────────────────────────────────────────────
const LATIN_LOOKALIKE = { c: 'e', e: 'c', n: 'u', u: 'n', m: 'n', r: 't', t: 'r', i: 'l', l: 'i', a: 'o', o: 'a', h: 'b', b: 'h', s: 'f', f: 's', p: 'q', q: 'p', d: 'a' };
const ZH_LOOKALIKE = [['己', '已'], ['已', '巳'], ['日', '曰'], ['土', '士'], ['人', '入'], ['未', '末'], ['天', '夭'], ['戊', '戌'], ['大', '太'], ['王', '玉'], ['刀', '力'], ['千', '干'], ['今', '令'], ['母', '毋'], ['失', '矢'], ['夫', '天'], ['免', '兔'], ['析', '折'], ['苦', '若'], ['侯', '候'], ['微', '徵'], ['傅', '傳'], ['于', '干'], ['小', '少'], ['子', '孑'], ['木', '本'], ['白', '自'], ['目', '日'], ['口', '曰'], ['之', '乏'], ['為', '焉'], ['而', '面'], ['其', '共'], ['以', '似'], ['也', '巳'], ['不', '下'], ['有', '右'], ['者', '著'], ['所', '斯'], ['無', '舞'], ['上', '止'], ['中', '申'], ['生', '主'], ['作', '佐'], ['書', '晝'], ['言', '信'], ['卷', '券'], ['義', '議'], ['氏', '民'], ['是', '足']];
const ZH_MAP = new Map(ZH_LOOKALIKE.map(([a, b]) => [a, b]));
// Plus the one-character substitutions the readers themselves made on the Chinese pages: real confusions, so plausible.
let zhObserved = null;
function zhConfusions() {
  if (zhObserved) return zhObserved;
  zhObserved = new Map();
  for (const p of pages.filter(x => isZh(x.stratum))) {
    const an = analyse(p);
    if (an.transcribe) continue;
    for (const s of an.spans) {
      const rs = Object.values(s.readings).map(strip);
      if (rs.length === 2 && [...rs[0]].length === 1 && [...rs[1]].length === 1 && rs[0] !== rs[1]) {
        if (!zhObserved.has(rs[0])) zhObserved.set(rs[0], rs[1]);
        if (!zhObserved.has(rs[1])) zhObserved.set(rs[1], rs[0]);
      }
    }
  }
  return zhObserved;
}
function plant(p, an) {
  const { cols, dis } = an, n = cols.length, r = rngFor(`plant|${p.uid}`);
  const unan = cols.map(c => c.every(x => x !== null && x === c[0]));
  // Chinese pages are dense with disputes, so the planted stretch keeps 1 agreed character clear of one, not 4.
  const W = isZh(p.stratum) ? 1 : 4, gap = isZh(p.stratum) ? 12 : 40;
  const nearDis = i => { for (let k = Math.max(0, i - W); k <= Math.min(n - 1, i + W); k++) if (dis[k]) return true; return false; };
  const cand = [];
  if (isZh(p.stratum)) {
    for (let i = 1; i < n - 1; i++) {
      if (![i - 1, i, i + 1].every(k => unan[k] && !nearDis(k))) continue;
      const to = ZH_MAP.get(cols[i][0]) ?? zhConfusions().get(cols[i][0]);
      if (to) cand.push({ a: i - 1, b: i + 1, pos: 1, to });
    }
  } else {
    let s = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n && cols[i][0] !== ' ') continue;
      const a = s, b = i - 1; s = i + 1;
      if (b - a + 1 < 4 || b - a + 1 > 10) continue;
      if (![...Array(b - a + 1).keys()].every(k => unan[a + k] && !nearDis(a + k))) continue;
      const word = cols.slice(a, b + 1).map(c => c[0]).join('');
      const opts = [...word].map((ch, k) => (LATIN_LOOKALIKE[ch] ? k : -1)).filter(k => k >= 0);
      if (!opts.length) continue;
      const pos = opts[Math.floor(r() * opts.length)];
      cand.push({ a, b, pos, to: LATIN_LOOKALIKE[word[pos]] });
    }
  }
  const picked = [];
  for (const c of shuffle(cand, r)) {
    if (picked.length === PLANTED_PER_PAGE) break;
    if (picked.some(x => Math.abs(x.a - c.a) < gap)) continue;
    picked.push(c);
  }
  return picked.map(c => {
    const orig = cols.slice(c.a, c.b + 1).map(x => x[0]).join('');
    const chars = [...orig]; chars[c.pos] = c.to;
    return { a: c.a, b: c.b, planted: true, original: orig, cands: [orig, chars.join('')], before: an.ctx(c.a - 30, c.a), after: an.ctx(c.b + 1, c.b + 31) };
  });
}

// ── build ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function prepareImages(uid) {
  const dir = path.join(SCRATCH, 'img', safe(uid));
  const manifest = path.join(dir, 'files.json');
  if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, 'utf8'));
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(SRC_IMG, `${safe(uid)}.jpg`);
  const { width: w, height: h } = await sharp(src).metadata();
  await sharp(src).resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(path.join(dir, 'page.jpg'));
  const files = ['page.jpg'];
  if (Math.max(w, h) > 2000) {
    // No line boxes are stored, so the 2× span crops become a grid of overlapping tiles at up to native resolution.
    const rows = h > 2000 ? 3 : 1, colsN = w > 2600 ? 2 : 1;
    const th = Math.ceil(h / rows), tw = Math.ceil(w / colsN), oy = Math.round(th * 0.12), ox = Math.round(tw * 0.08);
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < colsN; c++) {
      const top = Math.max(0, r * th - oy), left = Math.max(0, c * tw - ox);
      const height = Math.min(h - top, th + 2 * oy), width = Math.min(w - left, tw + 2 * ox);
      const f = `tile-${++k}.jpg`;
      await sharp(src).extract({ left, top, width, height }).resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(path.join(dir, f));
      files.push(f);
    }
  }
  const out = { dir, files, rows: Math.max(w, h) > 2000 ? (h > 2000 ? 3 : 1) : 0, cols: w > 2600 ? 2 : 1, width: w, height: h };
  fs.writeFileSync(manifest, JSON.stringify(out));
  return out;
}

async function build() {
  // Cross-check: the spans rebuilt here must be the committed adjudication lists.
  const committed = new Map();
  for (const st of STRATA) for (const r of readJsonl(path.join(HERE, `adjudication-${st}.jsonl`))) if (r.span != null) committed.set(`${r.uid}#${r.span}`, r);
  let checked = 0;
  const out = [];
  for (const p of pages) {
    const an = analyse(p);
    const imgs = await prepareImages(p.uid);
    if (an.transcribe) { out.push({ uid: p.uid, stratum: p.stratum, mode: 'transcribe', control: control.has(p.uid), voters: an.voters, files: imgs.files, tile_grid: [imgs.rows, imgs.cols] }); continue; }
    for (const sp of an.spans) if (sp.si != null) {
      const c = committed.get(`${p.uid}#${sp.si}`);
      if (!c || JSON.stringify(c.readings) !== JSON.stringify(sp.readings)) throw new Error(`span mismatch ${p.uid} #${sp.si}`);
      checked++;
    }
    const real = an.spans.filter(s => !s.spaceOnly && !s.krakenOnly);
    const planted = control.has(p.uid) ? plant(p, an) : [];
    const items = [...real.map(s => ({ a: s.a, b: s.b, si: s.si, cands: s.cands, before: s.before, after: s.after })), ...planted].sort((x, y) => x.a - y.a);
    items.forEach((it, i) => {
      it.n = i + 1;
      it.order = shuffle(it.cands.map((_, k) => k), rngFor(`opts|${p.uid}|${it.a}`));
    });
    out.push({ uid: p.uid, stratum: p.stratum, mode: 'spans', control: control.has(p.uid), voters: an.voters, files: imgs.files, tile_grid: [imgs.rows, imgs.cols], n_real: real.length, n_planted: planted.length, items });
  }
  // Repeat set: REPEAT_PAGES of the pages with real spans, seeded.
  const withSpans = out.filter(x => x.mode === 'spans' && x.n_real > 0).map(x => x.uid).sort();
  const repeat = shuffle(withSpans, makeRng(SEED)).slice(0, REPEAT_PAGES);
  for (const x of out) x.repeat = repeat.includes(x.uid);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify({ issue: 6388, amendment: 2, seed: SEED, label: LABEL, pages: out }, null, 1) + '\n');
  const sum = st => { const xs = out.filter(x => x.stratum === st); return { pages: xs.length, with_real: xs.filter(x => x.n_real > 0).length, real: xs.reduce((n, x) => n + (x.n_real || 0), 0), planted: xs.reduce((n, x) => n + (x.n_planted || 0), 0), transcribe: xs.filter(x => x.mode === 'transcribe').length }; };
  console.log(`spans cross-checked against the committed lists: ${checked}`);
  for (const st of STRATA) console.log(st, JSON.stringify(sum(st)));
  console.log('repeat pages:', repeat.length, 'control pages:', out.filter(x => x.control).length);
}

// ── prompts ─────────────────────────────────────────────────────────────────────────────────────────────────────
const KIND = { 'latin-print': 'a printed Latin book (1500–1800)', 'english-print': 'a printed English book (1500–1900)', 'zh-manuscript': 'a Chinese manuscript' };
function filesLine(pg) {
  const t = pg.files.length - 1;
  if (!t) return 'The image is page.jpg (the whole page).';
  const [r, c] = pg.tile_grid;
  return `The images are page.jpg (the whole page, reduced) and ${pg.files.slice(1).join(', ')}: the same page cut into ${r} row${r > 1 ? 's' : ''}${c > 1 ? ` × ${c} columns` : ''} of overlapping tiles, numbered left to right, top to bottom, at higher resolution. Use the tiles to read small letters.`;
}
const NORM_NOTE = {
  latin: 'The text is shown NORMALISED: lower case, letters a–z only (no punctuation, digits or accents), v written as u, j as i, w as uu, long s as s, æ as ae, & as et. Spaces are word breaks; spacing differences do not matter. The transcription convention expands abbreviations into full words (q̃ → que, ā → am, ꝑ → per), so judge an abbreviated word by its correct expansion. Running heads, page numbers, signatures, catchwords and marginal notes count as page text.',
  zh: 'The text is shown NORMALISED: Chinese characters only (punctuation, spaces, digits and Latin letters removed). Read in the page\'s order: columns top to bottom, right to left. Small double-line commentary counts as page text. A few variant forms are folded (爲→為, 靑→青, 敎→教).',
};
const letter = k => String.fromCharCode(65 + k);
function spansPrompt(pg, items, forClaude) {
  const zh = isZh(pg.stratum);
  const lines = items.map(it => {
    const opts = it.order.map((k, j) => `   ${letter(j)}. ${it.cands[k] === '' ? '(nothing: the stretch is empty)' : it.cands[k]}`).join('\n');
    return `${it.n}. …${it.before}⟦?⟧${it.after}…\n${opts}`;
  });
  const how = forClaude ? `${filesLine(pg)} They are files in the current directory: open them with the Read tool (the only tool you may use).` : filesLine(pg);
  return [
    `You are adjudicating disagreements between OCR transcriptions of a page from ${KIND[pg.stratum]}. ${how}`,
    '',
    `The transcriptions disagree at the ${items.length} numbered places below. Each place shows the agreed text just before and after it, with the disputed stretch marked ⟦?⟧, then the candidate readings for that stretch. Look at the page and decide what it actually shows at that place. The candidates come from different transcribers, in random order; none is privileged.`,
    '',
    zh ? NORM_NOTE.zh : NORM_NOTE.latin,
    '',
    'Answer every place, one line each, in exactly one of these forms:',
    '  7: B                      (candidate B is what the page shows)',
    '  7: none: <text>           (no candidate is right; write what the page shows there, in the same normalised form; write "none:" with nothing after it if the stretch is empty on the page)',
    '  7: illegible              (the image does not let you decide)',
    'Output only these lines, nothing else.',
    '',
    ...lines,
  ].join('\n');
}
function transcribePrompt(pg, forClaude) {
  if (forClaude) {
    const base = fs.readFileSync(path.join(PROMPTS, 'prompt-lite.txt'), 'utf8');
    return `${base}\n\n${filesLine(pg)} They are files in the current directory. Open them with the Read tool (that is the only tool you may use), then transcribe the WHOLE page. Output only the transcription in the format above, with no preamble and no commentary.`;
  }
  const base = fs.readFileSync(path.join(PROMPTS, 'prompt-cli.txt'), 'utf8').replace(/ The page image is attached:\s*$/, '');
  return `${base}\n\n${filesLine(pg)} Transcribe the WHOLE page. The images are attached:`;
}
function parseVerdicts(text, items) {
  const byN = new Map(items.map(it => [it.n, it]));
  const v = {};
  for (const line of String(text).split('\n')) {
    const m = line.trim().replace(/^[*`\-\s]+|[*`\s]+$/g, '').match(/^(\d+)\s*[:.)]\s*(.*)$/);
    if (!m || !byN.has(+m[1])) continue;
    const it = byN.get(+m[1]), ans = m[2].trim();
    let r;
    if (/^illegible\b/i.test(ans)) r = { kind: 'illegible' };
    else if (/^none\b/i.test(ans)) r = { kind: 'write', text: ans.replace(/^none\s*[:\-—]?\s*/i, '').replace(/^["“'(]+|["”')]+$/g, '') };
    else if (/^[A-Z]\b/.test(ans) && ans.charCodeAt(0) - 65 < it.order.length) r = { kind: 'pick', letter: ans[0], text: it.cands[it.order[ans.charCodeAt(0) - 65]] };
    else continue;
    if (!(it.n in v)) v[it.n] = r;
  }
  return v;
}

// ── CLI runners ($0 subscriptions; no API key may reach them) ────────────────────────────────────────────────────
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function sh(cmd, args, cwd, env, timeoutMs) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd, env });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', code => { clearTimeout(timer); resolve({ out, err, code, secs: (Date.now() - t0) / 1000 }); });
  });
}
function workspace(pg, tag) {
  const ws = path.join(SCRATCH, 'ws', `${tag}-${safe(pg.uid)}`);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  const dir = path.join(SCRATCH, 'img', safe(pg.uid));
  for (const f of pg.files) fs.copyFileSync(path.join(dir, f), path.join(ws, f));
  return ws;
}
async function callClaude(who, pg, prompt) {
  const ws = workspace(pg, who);
  const r = await sh('claude', ['-p', prompt, '--model', MODELS[who], '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task,Glob,Grep', '--max-turns', String(pg.files.length + 4)], ws, claudeEnv(), 900000);
  fs.rmSync(ws, { recursive: true, force: true });
  let j = {}; try { j = JSON.parse(r.out); } catch { /* not json */ }
  const quota = /usage limit|rate limit|limit reached|resets at/i.test(`${j.result || ''} ${r.err}`) && !!j.is_error;
  return { text: j.is_error ? '' : (j.result || ''), num_turns: j.num_turns ?? null, model_id: Object.keys(j.modelUsage || {}).join(',') || null, secs: r.secs, exit: r.code, error: r.code === 0 && !j.is_error ? null : `${j.subtype || ''} ${(j.result || r.err || r.out).slice(-300)}`, quota };
}
const AGY_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const AGY_QUOTA = ['RESOURCE_EXHAUSTED', 'quota reached', 'Quota reached', 'quota exceeded', 'exhausted your'];
const NUDGE = 'Running commands is not available here. Answer directly from the attached files now, following the instructions above exactly.';
async function callAgy(pg, prompt) {
  const ws = workspace(pg, 'gpro');
  const full = `${prompt}\n\n${pg.files.map(f => `@./${f}`).join(' ')}`;
  let res = null, conv = null, secs = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const args = conv ? ['-p', NUDGE, '--conversation', conv] : ['-p', full];
    const r = await sh('agy', [...args, '--model', MODELS.gpro, '--mode', 'plan', '--print-timeout', '840s', '--output-format', 'json'], ws, process.env, 900000);
    secs += r.secs;
    let j = {}; try { j = JSON.parse(r.out); } catch { /* not json */ }
    const text = (j.response || '').trim();
    const blob = `${r.out}\n${r.err}`;
    const cls = AGY_QUOTA.some(q => blob.includes(q)) ? 'quota' : r.code === null || r.code < 0 ? 'timeout' : r.code !== 0 ? `exit_${r.code}` : !text ? ((j.denied_actions || []).length ? 'denied_tool' : 'empty') : null;
    try { fs.appendFileSync(AGY_LOG, JSON.stringify({ ts: new Date().toISOString(), job: 'adjudicate-6388', model: MODELS.gpro, kind: 'adjudicate', seconds: Math.round(r.secs), ok: !cls, error_class: cls }) + '\n'); } catch { /* log is best effort */ }
    res = { text, model_id: j.model || MODELS.gpro, secs, exit: r.code, error: cls ? `${cls}: ${(r.err || r.out).slice(-300)}` : null, quota: cls === 'quota', nudged: !!conv };
    if (cls === 'denied_tool' && j.conversation_id && !conv) { conv = j.conversation_id; continue; }
    break;
  }
  fs.rmSync(ws, { recursive: true, force: true });
  return res;
}
const callModel = (who, pg, prompt) => (who === 'gpro' ? callAgy(pg, prompt) : callClaude(who, pg, prompt));

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const loadPages = () => JSON.parse(fs.readFileSync(path.join(OUT, 'pages.json'), 'utf8')).pages;
const rawFile = (who, set) => path.join(RAW, `${who}-${set}.jsonl`);
const latest = (who, set) => { const m = new Map(); for (const r of readJsonl(rawFile(who, set))) m.set(r.uid, r); return m; };

// The spans Opus and Gemini Pro disagree on, with every written-in reading added as a candidate (for Fable).
function tiebreakItems(pg, vo, vg) {
  const items = [];
  for (const it of pg.items.filter(x => !x.planted)) {
    const a = vo[it.n], b = vg[it.n];
    if (verdictKey(a) === verdictKey(b)) continue;
    const cands = [...it.cands];
    for (const v of [a, b]) if (v?.kind === 'write' && !cands.some(c => strip(c) === strip(normText(v.text, pg.stratum)))) cands.push(normText(v.text, pg.stratum, true));
    items.push({ ...it, cands, order: shuffle(cands.map((_, k) => k), rngFor(`fable|${pg.uid}|${it.a}`)) });
  }
  items.forEach((it, i) => { it.orig_n = it.n; it.n = i + 1; });
  return items;
}
const normText = (t, st, spaces = false) => norm(uncenter(t), st, spaces).join('');
function verdictKey(v) {
  if (!v) return 'missing';
  if (v.kind === 'illegible') return 'illegible';
  return `t:${strip(v.kind === 'write' ? (v.textNorm ?? '') : v.text)}`;
}

async function run(who, set, parallel) {
  const all = loadPages();
  let todo, mk;
  if (set === 'control') { todo = all.filter(p => p.control && p.mode === 'spans'); mk = p => ({ items: p.items }); }
  else if (set === 'main') { todo = all.filter(p => !p.control && p.mode === 'spans' && p.n_real > 0); mk = p => ({ items: p.items }); }
  else if (set === 'repeat') { todo = all.filter(p => p.repeat); mk = p => ({ items: p.items }); }
  else if (set === 'transcribe') { todo = all.filter(p => p.control || p.mode === 'transcribe'); mk = () => ({ transcribe: true }); }
  else if (set === 'tiebreak') {
    const vo = verdictsOf('opus'), vg = verdictsOf('gpro');
    todo = []; const its = new Map();
    for (const p of all.filter(x => x.mode === 'spans')) { const items = tiebreakItems(p, vo.get(p.uid) || {}, vg.get(p.uid) || {}); if (items.length) { todo.push(p); its.set(p.uid, items); } }
    mk = p => ({ items: its.get(p.uid) });
  } else throw new Error(`unknown set ${set}`);
  const done = latest(who, set);
  todo = todo.filter(p => !done.get(p.uid)?.ok);
  console.log(`${who} ${set}: ${todo.length} pages to run (${MODELS[who]})`);
  let stop = false, i = 0, ok = 0, failed = 0;
  const worker = async () => {
    while (!stop && i < todo.length) {
      const pg = todo[i++];
      const job = mk(pg);
      const prompt = job.transcribe ? transcribePrompt(pg, who !== 'gpro') : spansPrompt(pg, job.items, who !== 'gpro');
      let best = null;
      for (let attempt = 1; attempt <= 2 && !stop; attempt++) {
        const r = await callModel(who, pg, prompt);
        if (r.quota) { stop = true; console.log(`QUOTA ${who} on ${pg.uid}: ${r.error}`); best = { ...r, attempt }; break; }
        const verdicts = job.transcribe ? null : parseVerdicts(r.text, job.items);
        const answered = verdicts ? Object.keys(verdicts).length : (r.text ? 1 : 0);
        const need = job.transcribe ? 1 : Math.ceil(job.items.length * 0.9);
        const row = { ...r, attempt, answered, verdicts };
        if (!best || answered > best.answered) best = row;
        if (answered >= need) break;
      }
      const isOk = !best.quota && (best.verdicts ? best.answered >= Math.ceil(job.items.length * 0.9) : !!best.text);
      append(rawFile(who, set), { uid: pg.uid, who, set, model: MODELS[who], model_id: best.model_id, date: new Date().toISOString(), ok: isOk, n_items: job.items?.length ?? null, answered: best.answered, attempts: best.attempt, num_turns: best.num_turns ?? null, secs: Math.round(best.secs), error: best.error, nudged: best.nudged || false, items: job.items ? job.items.map(it => ({ n: it.n, orig_n: it.orig_n ?? it.n, a: it.a })) : undefined, verdicts: best.verdicts, text: best.text });
      if (isOk) ok++; else failed++;
      console.log(`  ${pg.uid} ${isOk ? 'ok' : 'FAILED'} ${best.answered}/${job.items?.length ?? 1} ${Math.round(best.secs)}s${best.error ? ' ' + best.error.slice(0, 120) : ''}`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  console.log(`${who} ${set}: ok ${ok}, failed ${failed}${stop ? ', STOPPED on quota' : ''}`);
  if (stop) process.exit(3);
}

// verdicts per page for one adjudicator, keyed by the page item number n (main + control; the first good row wins)
function verdictsOf(who, sets = ['control', 'main']) {
  const all = loadPages(), byUid = new Map(all.map(p => [p.uid, p]));
  const m = new Map();
  for (const set of sets) for (const [uid, r] of latest(who, set)) {
    if (!r.verdicts) continue;
    const pg = byUid.get(uid), v = {};
    for (const [n, x] of Object.entries(r.verdicts)) {
      const it = r.items.find(y => y.n === +n);
      const N = it.orig_n;
      v[N] = x.kind === 'write' ? { ...x, textNorm: normText(x.text, pg.stratum) } : x;
    }
    if (!m.has(uid)) m.set(uid, v);
  }
  return m;
}

// ── gate ────────────────────────────────────────────────────────────────────────────────────────────────────────
function gate(who) {
  const all = loadPages(), v = verdictsOf(who, ['control']);
  let n = 0, caught = 0, chosePlant = 0, other = 0;
  for (const pg of all.filter(p => p.control && p.mode === 'spans')) {
    for (const it of pg.items.filter(x => x.planted)) {
      n++;
      const x = v.get(pg.uid)?.[it.n];
      const t = x?.kind === 'pick' ? strip(x.text) : x?.kind === 'write' ? x.textNorm : null;
      if (t === strip(it.original)) caught++; else if (t === strip(it.cands[1])) chosePlant++; else other++;
    }
  }
  return { who, planted: n, caught, chose_corruption: chosePlant, other_or_missing: other, rate: n ? caught / n : null, pass: n > 0 && caught / n >= 0.9 };
}

// ── score ───────────────────────────────────────────────────────────────────────────────────────────────────────
// A key is a list of slots; each slot is a list of alternative strings. Edit distance to the best path.
function latticeDist(slots, h) {
  const m = h.length;
  let row = new Int32Array(m + 1); for (let j = 0; j <= m; j++) row[j] = j;
  const step = (prev, c) => {
    const cur = new Int32Array(m + 1); cur[0] = prev[0] + 1;
    for (let j = 1; j <= m; j++) { const d = prev[j - 1] + (h[j - 1] === c ? 0 : 1), u = prev[j] + 1, l = cur[j - 1] + 1; cur[j] = d < u ? (d < l ? d : l) : (u < l ? u : l); }
    return cur;
  };
  for (const alts of slots) {
    let best = null;
    for (const alt of alts) {
      let r = row; for (const c of alt) r = step(r, c);
      if (!best) best = r === row ? Int32Array.from(r) : r; else for (let j = 0; j <= m; j++) if (r[j] < best[j]) best[j] = r[j];
    }
    row = best;
  }
  return row[m];
}
const keyLen = slots => slots.reduce((n, alts) => n + mean(alts.map(a => [...a].length)), 0);
const uniq = xs => [...new Set(xs)];

// keyType: 'opus' | 'gpro' | 'cons' (agreed + Fable) | 'neutral' (agreed; a disagreement accepts either)
function buildKey(p, keyType, V) {
  const an = analyse(p);
  if (an.transcribe) {
    const t = w => (V.tr[w].get(p.uid)?.text ? normText(V.tr[w].get(p.uid).text, p.stratum) : null);
    if (keyType === 'opus' || keyType === 'gpro') { const s = t(keyType); return s == null ? null : [[s]]; }
    const a = t('opus'), b = t('gpro');
    if (a == null || b == null) return null;
    return buildNetwork([[...a], [...b]]).map(c => uniq(c.map(x => x ?? '')));
  }
  const pg = V.pageByUid.get(p.uid), byA = new Map((pg.items || []).filter(x => !x.planted).map(x => [x.a, x]));
  const slots = [];
  let lit = '';
  const flush = () => { if (lit) { slots.push([lit]); lit = ''; } };
  const spanAt = new Map(an.spans.map(s => [s.a, s]));
  for (let i = 0; i < an.cols.length;) {
    const s = spanAt.get(i);
    if (!s) { const c = an.cols[i].slice(0, an.nv).find(x => x !== null); if (c && c !== ' ') lit += c; i++; continue; }
    i = s.b + 1;
    if (s.spaceOnly || s.krakenOnly) { lit += strip(s.readings[an.voters.includes('G') ? 'G' : an.voters[0]]); continue; }
    const it = byA.get(s.a), all = uniq(s.cands.map(strip));
    const read = v => (!v || v.kind === 'illegible' ? null : strip(v.kind === 'write' ? v.textNorm : v.text));
    const vo = V.opus.get(p.uid)?.[it.n], vg = V.gpro.get(p.uid)?.[it.n];
    let alts;
    if (keyType === 'opus') alts = read(vo) == null ? all : [read(vo)];
    else if (keyType === 'gpro') alts = read(vg) == null ? all : [read(vg)];
    else {
      const agree = verdictKey(vo) === verdictKey(vg);
      if (agree) alts = read(vo) == null ? all : [read(vo)];
      else if (keyType === 'neutral') alts = uniq([read(vo) ?? all, read(vg) ?? all].flat());
      else {
        const vf = V.fable.get(p.uid)?.[it.n];
        alts = vf ? (read(vf) == null ? all : [read(vf)]) : uniq([read(vo) ?? all, read(vg) ?? all].flat());
      }
    }
    if (alts.length === 1) lit += alts[0]; else { flush(); slots.push(alts); }
  }
  flush();
  return slots;
}
function scoreArm(p, slots, arm, fixed = false) {
  const r = p.arm[arm];
  if (!r || r.outcome === 'missing' || !slots) return null;
  const chars = fixed ? r.charsFixed : r.chars;
  const L = keyLen(slots);
  if (L === 0) return chars.length ? 1 : 0;
  if (r.outcome !== 'text') return 1;
  if (chars.length > 3 * L) return 1;
  return Math.min(1, latticeDist(slots, chars) / L);
}
// The family rule: which key scores which arm on which page.
function familyKey(p, arm) {
  if (arm === 'S') return 'gpro';
  if (arm === 'G' || arm === 'L1' || arm === 'L2') return 'opus';
  if (arm === 'P') { const m = p.stored_ocr_model || ''; return /gemini/i.test(m) ? 'opus' : /claude|sonnet/i.test(m) ? 'gpro' : 'cons'; }
  return 'cons'; // O (Kraken), IA (Archive), stored Paddle
}

function paired(rows, base, x) {
  const ds = rows.filter(r => r[base] != null && r[x] != null).map(r => r[base] - r[x]);
  resetSeed(BOOT_SEED);
  return { n: ds.length, mean_d: ds.length ? mean(ds) : null, ci: bootstrapCI(ds, 10000) };
}
function verdict(ci, margin) {
  if (!ci) return 'not enough pages';
  if (ci[0] > margin) return 'switch';
  if (ci[1] < margin) return 'no change';
  return 'cannot be told apart';
}

// Self-agreement: the repeat run against the first run, per span.
function selfAgreement(who) {
  const first = verdictsOf(who), again = verdictsOf(who, ['repeat']), byUid = new Map(loadPages().map(p => [p.uid, p]));
  let n = 0, same = 0, pagesN = 0;
  for (const [uid, v2] of again) {
    const v1 = first.get(uid); if (!v1) continue;
    pagesN++;
    const planted = new Set(byUid.get(uid).items.filter(x => x.planted).map(x => String(x.n)));
    for (const n_ of Object.keys(v2)) { if (!(n_ in v1) || planted.has(n_)) continue; n++; if (verdictKey(v1[n_]) === verdictKey(v2[n_])) same++; }
  }
  return { who, pages: pagesN, spans: n, same, rate: n ? same / n : null };
}

// Consensus check on the control pages: all original readers agree, both whole-page transcriptions say otherwise.
function consensusCheck(V) {
  const per = {};
  const tot = { unanimous: 0, rejected_by_both: 0, rejected_runs: 0, rejected_in_long_runs: 0, rejected_by_one: 0 };
  for (const p of pages.filter(x => control.has(x.uid))) {
    const voters = READERS(p.stratum).filter(a => p.arm[a].outcome === 'text');
    const to = V.tr.opus.get(p.uid)?.text, tg = V.tr.gpro.get(p.uid)?.text;
    if (voters.length < 2 || !to || !tg) { per[p.uid] = { skipped: true }; continue; }
    const strs = [...voters.map(a => p.arm[a].chars), [...normText(to, p.stratum)], [...normText(tg, p.stratum)]];
    const cols = buildNetwork(strs), nv = voters.length;
    let u = 0, both = 0, one = 0, runs = 0, longRun = 0, run = 0;
    const endRun = () => { if (run) { runs++; if (run >= 10) longRun += run; } run = 0; };
    for (const c of cols) {
      const v = c.slice(0, nv);
      if (!(v[0] !== null && v.every(x => x === v[0]))) { continue; }
      u++;
      const o = c[nv], g = c[nv + 1];
      if (o !== v[0] && g !== v[0] && o === g) { both++; run++; } else { endRun(); if (o !== v[0] || g !== v[0]) one++; }
    }
    endRun();
    per[p.uid] = { stratum: p.stratum, readers: voters, unanimous: u, rejected_by_both: both, rejected_runs: runs, rejected_in_long_runs: longRun, rejected_by_one: one };
    tot.unanimous += u; tot.rejected_by_both += both; tot.rejected_runs += runs; tot.rejected_in_long_runs += longRun; tot.rejected_by_one += one;
  }
  return { label: 'model-keyed, not human', ...tot, rate: tot.unanimous ? tot.rejected_by_both / tot.unanimous : null, rate_excl_long_runs: tot.unanimous ? (tot.rejected_by_both - tot.rejected_in_long_runs) / tot.unanimous : null, per_page: per };
}

function scoreAll() {
  const all = loadPages();
  const V = {
    pageByUid: new Map(all.map(p => [p.uid, p])), opus: verdictsOf('opus'), gpro: verdictsOf('gpro'), fable: verdictsOf('fable', ['tiebreak']),
    tr: { opus: latest('opus', 'transcribe'), gpro: latest('gpro', 'transcribe') },
  };
  const results = { issue: 6388, amendment: 2, label: LABEL, generated_at: new Date().toISOString(), models: {}, controls: {}, strata: {} };
  for (const who of ['opus', 'gpro', 'fable']) results.models[who] = uniq(['control', 'main', 'repeat', 'transcribe', 'tiebreak'].flatMap(s => [...latest(who, s).values()].map(r => r.model_id).filter(Boolean)));
  results.controls.planted = ['opus', 'gpro'].map(gate);
  results.controls.self_agreement = ['opus', 'gpro'].map(selfAgreement);
  results.controls.consensus_check = consensusCheck(V);
  // agreement between the adjudicators, and the Fable load
  const agreeStats = {};
  for (const st of STRATA) {
    let n = 0, agree = 0, fableAns = 0, illeg = { opus: 0, gpro: 0 }, write = { opus: 0, gpro: 0 };
    for (const pg of all.filter(x => x.stratum === st && x.mode === 'spans')) for (const it of pg.items.filter(x => !x.planted)) {
      n++;
      const vo = V.opus.get(pg.uid)?.[it.n], vg = V.gpro.get(pg.uid)?.[it.n];
      for (const [w, v] of [['opus', vo], ['gpro', vg]]) { if (v?.kind === 'illegible') illeg[w]++; if (v?.kind === 'write') write[w]++; }
      if (verdictKey(vo) === verdictKey(vg)) agree++; else if (V.fable.get(pg.uid)?.[it.n]) fableAns++;
    }
    agreeStats[st] = { spans: n, opus_gpro_agree: agree, needed_fable: n - agree, fable_answered: fableAns, illegible: illeg, written_in: write };
  }
  results.adjudication = agreeStats;
  // Family lean: where Sonnet's and the Gemini CLI's readings differ, whose reading does each adjudicator pick?
  const lean = {};
  for (const p of pages) {
    const pg = V.pageByUid.get(p.uid);
    if (pg.mode !== 'spans') continue;
    const bySi = new Map(analyse(p).spans.filter(s => s.si != null).map(s => [s.si, s.readings]));
    for (const it of pg.items.filter(x => !x.planted)) {
      const rd = bySi.get(it.si);
      if (rd?.G == null || rd?.S == null || strip(rd.G) === strip(rd.S)) continue;
      const o = lean[p.stratum] ??= { spans: 0, opus: { S: 0, G: 0, other: 0 }, gpro: { S: 0, G: 0, other: 0 }, fable: { S: 0, G: 0, other: 0 } };
      o.spans++;
      for (const w of ['opus', 'gpro', 'fable']) {
        const v = V[w].get(p.uid)?.[it.n];
        if (!v) continue;
        const t = v.kind === 'pick' ? strip(v.text) : v.kind === 'write' ? v.textNorm : null;
        o[w][t === strip(rd.S) ? 'S' : t === strip(rd.G) ? 'G' : 'other']++;
      }
    }
  }
  results.family_lean = lean;

  const md = [`## #6388 Amendment 2 — ${LABEL}`, ''];
  for (const st of STRATA) {
    const P = pages.filter(p => p.stratum === st);
    const keys = {};
    for (const kt of ['opus', 'gpro', 'cons', 'neutral']) keys[kt] = new Map(P.map(p => [p.uid, buildKey(p, kt, V)]));
    const rowsFam = [], rowsNeu = [], rowsFix = [], rowsNeuFix = [];
    for (const p of P) {
      const f = { uid: p.uid }, n = { uid: p.uid }, x = { uid: p.uid }, nx = { uid: p.uid };
      for (const a of ARMS) {
        const fk = keys[familyKey(p, a)].get(p.uid);
        f[a] = scoreArm(p, fk, a); n[a] = scoreArm(p, keys.neutral.get(p.uid), a); x[a] = scoreArm(p, fk, a, true); nx[a] = scoreArm(p, keys.neutral.get(p.uid), a, true);
      }
      // the AA band is L1 vs L2 on the Opus key (both are Gemini)
      rowsFam.push(f); rowsNeu.push(n); rowsFix.push(x); rowsNeuFix.push(nx);
    }
    const out = { n_pages: P.length, comparisons: [], aa: {}, per_page: { family: rowsFam, neutral: rowsNeu, family_uncentered: rowsFix, neutral_uncentered: rowsNeuFix } };
    const cands = isZh(st) ? ['P', 'G', 'S'] : ['G', 'S', 'O', 'IA'];
    for (const [kname, rows] of [['family', rowsFam], ['neutral', rowsNeu], ['family_uncentered', rowsFix], ['neutral_uncentered', rowsNeuFix]]) {
      const aa = paired(rows, 'L1', 'L2');
      const band = aa.ci ? Math.max(Math.abs(aa.ci[0]), Math.abs(aa.ci[1])) : null;
      out.aa[kname] = { ...aa, band };
      const margin = Math.max(band ?? Infinity, MIN_EFFECT);
      for (const x of cands) for (const base of ['L1', 'P']) {
        if (x === base) continue;
        const r = paired(rows, base, x);
        const both = rows.filter(z => z[x] != null && z[base] != null);
        out.comparisons.push({ key: kname, engine: x, baseline: base, engine_key: !kname.startsWith('neutral') ? uniq(P.map(p => familyKey(p, x))) : ['neutral'], baseline_key: !kname.startsWith('neutral') ? uniq(P.map(p => familyKey(p, base))) : ['neutral'], ...r, mean_cer_engine: mean(both.map(z => z[x])), mean_cer_baseline: mean(both.map(z => z[base])), margin, verdict: verdict(r.ci, margin) });
      }
    }
    results.strata[st] = out;
    const fmt = x => (x == null ? '—' : (100 * x).toFixed(1));
    md.push(`### ${st} (n = ${P.length} works) — ${LABEL}`, '', '| key | engine | baseline | n | CER engine | CER baseline | gap [95% CI] | margin | verdict |', '|---|---|---|---:|---:|---:|---|---:|---|');
    for (const c of out.comparisons) md.push(`| ${c.key} | ${c.engine} (${c.engine_key.join('/')}) | ${c.baseline} (${c.baseline_key.join('/')}) | ${c.n} | ${fmt(c.mean_cer_engine)} | ${fmt(c.mean_cer_baseline)} | ${fmt(c.mean_d)} [${c.ci ? fmt(c.ci[0]) + ', ' + fmt(c.ci[1]) : '—'}] | ${fmt(c.margin)} | ${c.verdict} |`);
    md.push('', ...Object.entries(out.aa).map(([k, a]) => `AA (L1 − L2), ${k} keys: ${fmt(a.mean_d)} [${a.ci?.map(fmt).join(', ')}], band ${fmt(a.band)}.`), '');
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'results.md'), md.join('\n') + '\n');
  console.log(JSON.stringify({ family_lean: lean, models: results.models, controls: { planted: results.controls.planted, self_agreement: results.controls.self_agreement, consensus: { ...results.controls.consensus_check, per_page: undefined } }, adjudication: agreeStats }, null, 1));
  console.log(md.filter(l => /^###|^\| family \| (G|S|O|IA|P) |^AA/.test(l)).join('\n'));
}

const [cmd, a1, a2] = process.argv.slice(2);
const par = +(process.argv.find(x => x.startsWith('--parallel='))?.split('=')[1] || 2);
if (cmd === 'build') await build();
else if (cmd === 'run') await run(a1, a2, par);
else if (cmd === 'gate') console.log(JSON.stringify(['opus', 'gpro'].map(gate)));
else if (cmd === 'score') scoreAll();
else { console.error('usage: build | run <opus|gpro|fable> <set> [--parallel=N] | gate | score'); process.exit(1); }
