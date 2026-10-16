#!/usr/bin/env node
/**
 * PRIOR ART: g4-hard-6707/classify.mjs + analyze.py (#6707) — the ONE FAILURE RULE on run-cli-arm.py rows
 * (scripts/lib/read-failure.mjs + cli-chatter.mjs extractTranscription, used as is) and the seeded page bootstrap /
 * paired-Δ decision rule; lib/edition-window.mjs alignTrimWindow (Greek window trim) and lib/sefaria-fit.mjs
 * buildStream/buildIndex/locate (Hebrew locate), used as is. Neither scores a read against a Sefaria passage that is
 * one block of a multi-block page, which needs the LOCAL alignment below.
 *
 * #6731 scoring (PREREGISTRATION-hard-hands-6731.md). Reads $JOB_SCRATCH/hh/{greek,rashi}-units.json and the raw arm
 * files; writes $JOB_SCRATCH/hh/scored-<script>.json (per page: reference letters, every arm's CER or failure) and
 * prints the analysis. No network, no DB.
 *
 *   node score.mjs greek|rashi|memo [--arms G4L,C38L,OPUS]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFailure } from '../../lib/read-failure.mjs';
import { extractTranscription } from '../../lib/cli-chatter.mjs';
import { alignTrimWindow, stripTags } from '../lib/edition-window.mjs';
import { buildStream, buildIndex, locate, spanText, normHe } from '../../lib/sefaria-fit.mjs';
import { hardCer, normRead } from './hard-cer.mjs';
import { sefariaSegments } from './prepare.mjs';

const args = process.argv.slice(2);
const val = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const S = path.join(process.env.JOB_SCRATCH || '/tmp', 'hh');
const ARMS = (val('arms', 'G4L,C38L,OPUS')).split(',');
const u = (s) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 12), 16) / 2 ** 48;

// ── arm rows → per-uid {text, failure, secs, gate_denials} (last row per uid wins) ──
function armRows(arm, panel) {
  // Amendment 1: the OPUS arm's reads came through the Claude CLI (run-claude-arm.py), kept in their own file
  const f = path.join(S, 'raw', arm === 'OPUS' ? `${arm}-${panel}.claude.jsonl` : `${arm}-${panel}.jsonl`);
  const by = new Map();
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); by.set(r.uid, r); }
  return by;
}
function classify(r) {
  if (!r) return { failure: 'missing', text: '' };
  const fl = readFailure({ text: r.text || '', extracted: extractTranscription(r.text || '').text, cli: true, blocked: !!r.blocked, error: r.error });
  return { failure: fl?.kind ?? null, why: fl?.why ?? null, text: r.text || '', secs: r.secs, gate_denials: r.gate_denials || 0, gate_calls: r.gate_calls || [], nudged: !!r.nudged, wrapper: r.wrapper };
}
// A unit's read: one row, or the L and R halves of a spread joined (a failed half fails the unit).
function unitRead(by, unit) {
  if (unit.images.length === 1) return classify(by.get(unit.uid));
  const L = classify(by.get(`${unit.uid}#L`)), R = classify(by.get(`${unit.uid}#R`));
  const bad = [L, R].find((x) => x.failure);
  return { failure: bad?.failure ?? null, why: bad?.why ?? null, text: `${L.text}\n${R.text}`, secs: (L.secs || 0) + (R.secs || 0),
    gate_denials: (L.gate_denials || 0) + (R.gate_denials || 0), gate_calls: [...(L.gate_calls || []), ...(R.gate_calls || [])], nudged: L.nudged || R.nudged, halves: [L.secs, R.secs] };
}

// ── Greek: edition span (fit ± 1 line), trimmed to what the reads align to ──
const GREEK_FOLD = (c) => normRead(c, 'greek');
function scoreGreek(units) {
  const rows = Object.fromEntries(ARMS.map((a) => [a, armRows(a, 'greek')]));
  return units.map((x) => {
    const reads = {};
    for (const a of ARMS) reads[a] = unitRead(rows[a], x);
    reads.PROD = { failure: x.production.text ? null : 'empty', text: x.production.text, model: x.production.model };
    reads.KRAKEN = { failure: x.kraken ? null : 'missing', text: x.kraken || '' };
    const usable = Object.fromEntries(Object.entries(reads).filter(([, r]) => !r.failure).map(([k, r]) => [k, r.text]));
    const t = alignTrimWindow(x.reference, usable, {
      isLetter: (ch) => GREEK_FOLD(ch).length > 0, refFold: (ch) => GREEK_FOLD(ch),
      hypLetters: (txt) => [...normRead(txt, 'greek').replace(/ /g, '')],
    });
    const cells = {};
    for (const [k, r] of Object.entries(reads)) cells[k] = r.failure ? { failure: r.failure, why: r.why ?? null, secs: r.secs ?? null, gate_denials: r.gate_denials ?? 0 } : { ...hardCer(r.text, t.window, 'greek'), secs: r.secs ?? null, gate_denials: r.gate_denials ?? 0, nudged: r.nudged ?? false };
    return { uid: x.uid, work: x.work, book: x.book, page: x.page, fit: x.fit, prod_model: x.production.model, trim: t.note, kept: true, cells };
  });
}

// ── Rashi: locate each read in the mapped Sefaria stream, local alignment, median span ──
// Smith–Waterman (match +1, mismatch/gap −1) between a read's letters and the window's letters: the best-matching
// stretch of each. A read carries the page's other blocks (Bible text, other commentaries), so neither side can be
// consumed whole. Returns { ws, we, edits, matches } in window letters; edits = matches − score on the path.
export function localAlign(read, win) {
  const n = read.length, m = win.length; if (!n || !m) return null;
  let H = new Int32Array(m + 1), Hp = new Int32Array(m + 1), M = new Int32Array(m + 1), Mp = new Int32Array(m + 1), W = new Int32Array(m + 1), Wp = new Int32Array(m + 1);
  let best = 0, bw0 = 0, bw1 = 0, bM = 0;
  for (let i = 1; i <= n; i++) {
    H[0] = 0; M[0] = 0; W[0] = 0; const c = read.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const d = Hp[j - 1] + (c === win.charCodeAt(j - 1) ? 1 : -1), up = Hp[j] - 1, lf = H[j - 1] - 1;
      let h = 0, mm = 0, w = j;
      if (d >= up && d >= lf && d > 0) { h = d; mm = Mp[j - 1] + (c === win.charCodeAt(j - 1) ? 1 : 0); w = Hp[j - 1] > 0 ? Wp[j - 1] : j - 1; }
      else if (up >= lf && up > 0) { h = up; mm = Mp[j]; w = Wp[j]; }
      else if (lf > 0) { h = lf; mm = M[j - 1]; w = W[j - 1]; }
      H[j] = h; M[j] = mm; W[j] = w;
      if (h > best) { best = h; bw0 = w; bw1 = j; bM = mm; }
    }
    [H, Hp] = [Hp, H]; [M, Mp] = [Mp, M]; [W, Wp] = [Wp, W];
  }
  return best > 0 ? { ws: bw0, we: bw1, matches: bM, edits: bM - best, score: best } : null;
}
const heLetters = (t) => normHe(stripTags(t)).replace(/ /g, '');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const STREAMS = new Map();
async function streamFor(titles) {
  const key = titles.join('|');
  if (!STREAMS.has(key)) { const segs = []; for (const t of titles) segs.push(...await sefariaSegments(t)); const st = buildStream(segs); STREAMS.set(key, { st, index: buildIndex(st.letters, 7) }); }
  return STREAMS.get(key);
}
async function scoreRashi(units) {
  const rows = Object.fromEntries(ARMS.map((a) => [a, armRows(a, 'rashi')]));
  const out = [];
  for (const x of units) {
    const reads = {};
    for (const a of ARMS) reads[a] = unitRead(rows[a], x);
    // #5560 wrote Sefaria's own text into some pages that OCR failed (ocr.model "sefaria/<title>"): that is the
    // reference itself, not a reading, so it is neither scored nor allowed to shape the reference.
    const prodIsSefaria = /^sefaria/i.test(x.production.model || '');
    reads.PROD = { failure: prodIsSefaria ? 'not_ocr' : x.production.text ? null : 'empty', why: prodIsSefaria ? `stored text is ${x.production.model} (#5560), not an OCR` : null, text: x.production.text, model: x.production.model };
    const { st, index } = await streamFor(x.sefaria);
    const L = Object.fromEntries(Object.entries(reads).filter(([, r]) => !r.failure).map(([k, r]) => [k, heLetters(r.text).slice(0, 12000)]));
    // 1. consensus position: the cluster (±3,000 letters) located by the most reads, ties by summed share
    const loc = Object.entries(L).map(([k, q]) => ({ k, ...locate(q, index, { slack: 8 }) })).filter((r) => r.pos != null && r.share > 0);
    let best = null;
    for (const r of loc) { const near = loc.filter((o) => Math.abs(o.pos - r.pos) <= 3000); const v = [near.length, near.reduce((s, o) => s + o.share, 0)]; if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && v[1] > best.v[1])) best = { pos: r.pos, v, by: near.map((o) => o.k) }; }
    const rec = { uid: x.uid, work: x.work, book: x.book, page: x.page, prod_model: x.production.model, sefaria: x.sefaria, located: loc.map((r) => ({ k: r.k, pos: r.pos, share: +r.share.toFixed(3) })) };
    if (!best) { out.push({ ...rec, kept: false, dropped: 'no read locates in the Sefaria text', cells: failCells(reads) }); continue; }
    // 2. window; 3. each read's local alignment
    const maxLen = Math.max(...Object.values(L).map((q) => q.length));
    const w0 = Math.max(0, best.pos - 3000), w1 = Math.min(st.letters.length, best.pos + maxLen + 3000);
    const win = st.letters.slice(w0, w1);
    const spans = {};
    for (const [k, q] of Object.entries(L)) {
      // Band for speed: the stretch of the read whose 7-grams hit inside the window (± 400 letters), aligned to the
      // stretch of the window they hit (± 800). Smith–Waterman over a whole page against the whole window is
      // 10^8–10^9 cells per read; the band is ~10^7 and holds the same best local alignment unless the block is
      // scattered beyond the pad. A read with no hit in the window has no band and does not align.
      const hitsR = [], hitsW = [];
      for (let j = 0; j + 7 <= q.length; j++) { const ps = index.idx.get(q.slice(j, j + 7)); if (!ps || ps.length >= 64) continue; for (const p of ps) if (p >= w0 && p < w1) { hitsR.push(j); hitsW.push(p - w0); } }
      if (hitsR.length < 3) continue;
      const qs = (a, f) => { const t = [...a].sort((x, y) => x - y); return t[Math.floor(f * (t.length - 1))]; };
      const r0 = Math.max(0, qs(hitsR, 0.02) - 400), r1 = Math.min(q.length, qs(hitsR, 0.98) + 400);
      const b0 = Math.max(0, qs(hitsW, 0.02) - 800), b1 = Math.min(win.length, qs(hitsW, 0.98) + 800);
      const a = localAlign(q.slice(r0, r1), win.slice(b0, b1));
      if (a) { const len = a.we - a.ws; spans[k] = { ws: w0 + b0 + a.ws, we: w0 + b0 + a.we, len, cer: +(a.edits / Math.max(1, len)).toFixed(3), aligns: len >= 80 && a.edits / len < 0.5 }; }
    }
    const al = Object.entries(spans).filter(([, s]) => s.aligns);
    rec.spans = spans;
    if (!al.length) { out.push({ ...rec, kept: false, dropped: 'no read aligns (letter CER < 0.5 over >= 80 letters)', cells: failCells(reads) }); continue; }
    // 4. reference span: median of the aligning reads' spans when >= 3 align, else their union
    const a = al.length >= 3 ? Math.round(median(al.map(([, s]) => s.ws))) : Math.min(...al.map(([, s]) => s.ws));
    const b = al.length >= 3 ? Math.round(median(al.map(([, s]) => s.we))) : Math.max(...al.map(([, s]) => s.we));
    if (b - a < 150) { out.push({ ...rec, kept: false, dropped: `reference ${b - a} letters < 150`, ref_span: [a, b], cells: failCells(reads) }); continue; }
    const ref = spanText(st, a, b);
    const s0 = st.segments[st.seg[a]].ref, s1 = st.segments[st.seg[b - 1]].ref;
    const cells = {};
    for (const [k, r] of Object.entries(reads)) cells[k] = r.failure ? { failure: r.failure, why: r.why ?? null, secs: r.secs ?? null, gate_denials: r.gate_denials ?? 0 } : { ...hardCer(r.text, ref, 'hebrew', { refIsSefaria: true }), secs: r.secs ?? null, gate_denials: r.gate_denials ?? 0, nudged: r.nudged ?? false };
    out.push({ ...rec, kept: true, ref_span: [a, b], ref_rule: al.length >= 3 ? 'median' : 'union', aligning: al.map(([k]) => k), ref_refs: [s0, s1], ref_text_sha: createHash('sha256').update(ref).digest('hex').slice(0, 12), cells });
    fs.writeFileSync(path.join(S, 'refs', `${x.uid.replace(/[^\w-]/g, '_')}.txt`), ref);
  }
  return out;
}
const failCells = (reads) => Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, r.failure ? { failure: r.failure } : { unscored: 'page dropped' }]));

// ── memorisation control: arm recall (no image) vs the same reference ──
function scoreMemo(scored) {
  const out = [];
  for (const arm of ARMS) {
    const by = armRows(arm, `memo-${arm}`);
    for (const [uid, r] of by) {
      const p = scored.find((x) => x.uid === uid.replace(/^memo\|/, '')); if (!p) continue;
      const ref = fs.readFileSync(path.join(S, 'refs', `${p.uid.replace(/[^\w-]/g, '_')}.txt`), 'utf8');
      const c = classify(r);
      out.push({ uid: p.uid, arm, work: p.work, refs: p.ref_refs, recall: c.failure ? { failure: c.failure, why: c.why } : hardCer(c.text, ref, 'hebrew', { refIsSefaria: true }), image: p.cells[arm] });
    }
  }
  return out;
}

// ── analysis ──
const seed = (...k) => { let x = parseInt(createHash('sha256').update(k.join('|')).digest('hex').slice(0, 8), 16) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; }; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const pct = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
function boot(xs, f, rnd, B = 2000) { const bs = []; for (let i = 0; i < B; i++) { const r = []; for (let j = 0; j < xs.length; j++) r.push(xs[Math.floor(rnd() * xs.length)]); bs.push(f(r)); } bs.sort((a, b) => a - b); return [pct(bs, 0.025), pct(bs, 0.975)]; }
const signP = (w, l) => { const n = w + l; if (!n) return null; let c = 0, b = 1; for (let i = 0; i <= Math.min(w, l); i++) { c += b; b = b * (n - i) / (i + 1); } return Math.min(1, (2 * c) / 2 ** n); };
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
export function analyze(script, scored, { floor = 0.01, exclude = null } = {}) {
  const pages = scored.filter((p) => p.kept && (!exclude || !exclude(p)));
  const arms = [...new Set(pages.flatMap((p) => Object.keys(p.cells)))];
  const res = { script, n_pages: pages.length, n_works: new Set(pages.map((p) => p.work)).size, arms: {}, paired: {} };
  for (const a of arms) {
    const sc = pages.filter((p) => p.cells[a]?.cer != null).map((p) => p.cells[a].cer);
    const fails = {}; for (const p of pages) { const f = p.cells[a]?.failure; if (f) fails[f] = (fails[f] || 0) + 1; }
    const secs = pages.map((p) => p.cells[a]?.secs).filter((x) => x != null).sort((x, y) => x - y);
    res.arms[a] = { n_scored: sc.length, accuracy: sc.length ? r4(1 - mean(sc)) : null, ci95: sc.length ? boot(sc, (r) => 1 - mean(r), seed(script, a, 'acc')).map(r4) : null,
      median_cer: sc.length ? r4(median(sc)) : null, failures: fails, secs_median: secs.length ? median(secs) : null, secs_iqr: secs.length ? [pct(secs, 0.25), pct(secs, 0.75)] : null,
      gate_denials: pages.reduce((s, p) => s + (p.cells[a]?.gate_denials || 0), 0), pages_with_denials: pages.filter((p) => (p.cells[a]?.gate_denials || 0) > 0).length };
  }
  for (const o of arms.filter((a) => a !== 'G4L')) {
    const both = pages.filter((p) => p.cells.G4L?.cer != null && p.cells[o]?.cer != null);
    if (!both.length) continue;
    const d = both.map((p) => p.cells.G4L.cer - p.cells[o].cer);
    const w = d.filter((v) => v < 0).length, l = d.filter((v) => v > 0).length;
    const md = median(d), ci = boot(d, median, seed(script, 'G4L', o));
    res.paired[o] = { n: both.length, wins: w, losses: l, ties: d.length - w - l, median_delta: r4(md), ci95: ci.map(r4), mean_delta: r4(mean(d)), sign_p: r4(signP(w, l)),
      verdict: ci[1] < 0 && Math.abs(md) > floor ? 'better' : ci[0] > 0 && Math.abs(md) > floor ? 'worse' : 'same' };
  }
  return res;
}

async function main() {
  const which = args[0];
  fs.mkdirSync(path.join(S, 'refs'), { recursive: true });
  if (which === 'greek') {
    const scored = scoreGreek(JSON.parse(fs.readFileSync(path.join(S, 'greek-units.json'), 'utf8')));
    fs.writeFileSync(path.join(S, 'scored-greek.json'), JSON.stringify(scored, null, 1));
    const res = { all: analyze('greek', scored), without_flash_fit: analyze('greek', scored, { exclude: (p) => p.fit !== 'kraken' }) };
    fs.writeFileSync(path.join(S, 'analysis-greek.json'), JSON.stringify(res, null, 1));
    console.log(JSON.stringify(res.all, null, 1));
  } else if (which === 'rashi') {
    const scored = await scoreRashi(JSON.parse(fs.readFileSync(path.join(S, 'rashi-units.json'), 'utf8')));
    fs.writeFileSync(path.join(S, 'scored-rashi.json'), JSON.stringify(scored, null, 1));
    const res = { all: analyze('rashi', scored), dropped: scored.filter((p) => !p.kept).map((p) => ({ uid: p.uid, work: p.work, dropped: p.dropped })) };
    fs.writeFileSync(path.join(S, 'analysis-rashi.json'), JSON.stringify(res, null, 1));
    console.log(JSON.stringify(res, null, 1));
  } else if (which === 'memo') {
    const scored = JSON.parse(fs.readFileSync(path.join(S, 'scored-rashi.json'), 'utf8'));
    const m = scoreMemo(scored);
    fs.writeFileSync(path.join(S, 'scored-memo.json'), JSON.stringify(m, null, 1));
    for (const arm of ARMS) {
      const xs = m.filter((r) => r.arm === arm);
      const rc = xs.filter((r) => r.recall.cer != null), both = rc.filter((r) => r.image?.cer != null);
      console.log(arm, 'n', xs.length, 'recall acc', rc.length ? r4(1 - mean(rc.map((r) => r.recall.cer))) : null, 'image acc (same pages)', both.length ? r4(1 - mean(both.map((r) => r.image.cer))) : null,
        'recall acc (same pages)', both.length ? r4(1 - mean(both.map((r) => r.recall.cer))) : null, 'failures', xs.filter((r) => r.recall.failure).map((r) => r.recall.failure).join(','));
    }
  } else if (which === 'memo-requests') {
    // 15 kept pages, seeded, Rashi on Torah / Talmud first (prereg); the refs the reference spans
    const scored = JSON.parse(fs.readFileSync(path.join(S, 'scored-rashi.json'), 'utf8')).filter((p) => p.kept);
    const pref = (p) => (p.ref_refs[0].startsWith('Rashi on ') ? 0 : 1);
    const pick = scored.sort((a, b) => pref(a) - pref(b) || u(`hardhands-6731|memo|${a.uid}`) - u(`hardhands-6731|memo|${b.uid}`)).slice(0, 15);
    const title = (r) => r.replace(/ [\d:]+$/, ''), loc = (r) => (r.match(/ ([\d:]+)$/) || [, ''])[1];
    // flattenVersion numbers Talmud sections 1, 2, 3 … (Sefaria's 1a, 1b, 2a …; Sukkah has 112 = 56b): give the model the daf.
    const TALMUD = /^Rashi on (Berakhot|Shabbat|Eruvin|Pesachim|Yoma|Sukkah|Beitzah|Rosh Hashanah|Taanit|Megillah|Moed Katan|Chagigah) (\d+) ([\d:]+)$/;
    const human = (r) => { const m = r.match(TALMUD); if (!m) return r; const n = +m[2]; return `Rashi on ${m[1]} ${Math.floor((n - 1) / 2) + 1}${n % 2 ? "a" : "b"}, comment ${m[3]}`; };
    const rows = pick.map((p) => { const a = human(p.ref_refs[0]), b = human(p.ref_refs[1]);
      return { uid: `memo|${p.uid}`, refs: [a, b], prompt: `From memory, without any image, write out in Hebrew the text of ${a} through ${b}, exactly as it is printed in a traditional edition. Write the text only, with no translation and no notes.` }; });
    for (const arm of ARMS) fs.writeFileSync(path.join(S, 'req', `memo-${arm}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(rows.map((r) => r.prompt).join('\n'));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) await main();
