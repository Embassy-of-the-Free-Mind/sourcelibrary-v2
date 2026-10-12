#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-table-pilot-6388/score.mjs and paddle-table-6388/cer.mjs (Kanripo CER via bodyCer,
// the over-count: repeats of characters the leaf prints beyond its own count) — reused; added here: column-order jumps,
// over-correction, planted-error anchoring, the toward-Kanripo edit list for the recitation read-off, and flag signals.
//
// #6561 scoring. Usage (cwd = $JOB_SCRATCH/w): node <repo>/scripts/eval/paddle-correct-6561/score.mjs <pilot-w-dir> [uids.json]
// Reads sets.json, anchors.json, out-*.jsonl (+ the pilot's pil-read-opus.jsonl as set A's redo arm). Writes score.json.
import fs from 'node:fs';
import { bodyText, foldHan, bodyCer, fitAlign, median, mean } from '../ground-truth-5935/lib.mjs';
// Levenshtein over code points (the census.mjs copy in paddle-stale-english-6388 is not importable: the module runs its census).
function lev(a, b) {
  const x = [...a], y = [...b];
  if (!x.length) return y.length; if (!y.length) return x.length;
  let prev = new Int32Array(y.length + 1), cur = new Int32Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}

const [, , PILOT, ONLY] = process.argv;
const only = ONLY ? new Set(JSON.parse(fs.readFileSync(ONLY, 'utf8'))) : null;
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const lastBy = (rows, key = (r) => r.uid) => { const m = new Map(); for (const r of rows) { const k = key(r); const p = m.get(k); if (!p || (!p.text && r.text) || (r.text && p.text && r.date > p.date)) m.set(k, r); } return m; };
const sets = JSON.parse(fs.readFileSync('sets.json', 'utf8')).filter((s) => !only || only.has(s.uid));
const anchors = JSON.parse(fs.readFileSync('anchors.json', 'utf8')).filter((a) => !only || only.has(a.base_uid));

// ── arms ──
const pilotRedo = lastBy(readJsonl(`${PILOT}/pil-read-opus.jsonl`).map((r) => ({ ...r, uid: `A-${r.uid}` })));
const ARMS = {
  'opus-correct': lastBy(readJsonl('out-opus-correct.jsonl')),
  'pro-correct': lastBy(readJsonl('out-pro-correct.jsonl')),
  'flashhigh-correct': lastBy(readJsonl('out-flashhigh-correct.jsonl')),
  'opus-redo': new Map([...lastBy(readJsonl('out-opus-redo.jsonl')), ...pilotRedo]),
};
const second = lastBy(readJsonl('out-flashlow-second.jsonl'));
// The transcription between the sentinels; a reply with text but no sentinel pair is used whole and marked.
export function extract(row) {
  if (!row) return { status: 'missing', text: '' };
  const t = String(row.text || '');
  if (!t.trim()) return { status: 'did-not-read', text: '', why: String(row.error || 'empty').slice(0, 80) };
  const m = t.match(/===TRANSCRIPTION===[ \t]*\n?([\s\S]*?)(?:\n?===END===|$)/);
  if (!m) return { status: 'no-sentinel', text: t };
  return { status: /===END===/.test(t) ? 'ok' : 'cut', text: m[1] };
}
const hanOf = (t) => foldHan(bodyText(t));
const bag = (s) => { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) || 0) + 1); return m; };
const overCount = (q, leaf) => { const W = bag(leaf), Q = bag(q); let oc = 0; for (const [ch, w] of W) oc += Math.max(0, (Q.get(ch) || 0) - w); return oc; };
// Column order: each body line of >= 6 Han is placed in the leaf by fitting alignment (kept if d <= 1/3 of its length);
// a backward jump of more than 2 characters between consecutive placed lines is an order error.
function orderJumps(text, leaf) {
  const starts = [];
  for (const line of bodyText(text).split('\n')) {
    const q = foldHan(line); const n = [...q].length; if (n < 6) continue;
    const a = fitAlign(q, leaf); if (a.d <= n / 3) starts.push({ s: a.start, e: a.end });
  }
  let jumps = 0; for (let i = 1; i < starts.length; i++) if (starts[i].s < starts[i - 1].s - 2) jumps++;
  return { jumps, placed: starts.length };
}
function scoreText(text, leaf) {
  const q = hanOf(text); const n = [...leaf].length;
  const c = bodyCer(q, leaf, { expected: n });
  return { han: [...q].length, cer: +c.cer.toFixed(4), over: overCount(q, leaf), ...orderJumps(text, leaf) };
}

// ── per page ──
const pages = sets.map((s) => {
  const row = { uid: s.uid, stratum: s.stratum, pid: s.pid, title: s.title, has_leaf: !!s.kanripo, leaf_chars: s.kanripo ? [...s.kanripo].length : null, arms: {} };
  const paddleQ = hanOf(s.paddle);
  row.arms.paddle = { status: 'ok', ...(s.kanripo ? scoreText(s.paddle, s.kanripo) : { han: [...paddleQ].length }) };
  for (const [arm, m] of Object.entries(ARMS)) {
    if (arm === 'opus-redo' && !m.has(s.uid)) { row.arms[arm] = { status: 'missing' }; continue; }
    const r = m.get(s.uid); const x = extract(r);
    const o = { status: x.status, secs: r?.secs ?? null, calls: r ? (r.attempts ?? 1) : 0, why: x.why };
    if (x.text.trim() && s.kanripo) Object.assign(o, scoreText(x.text, s.kanripo));
    // edit size vs the Paddle draft (Han, Levenshtein / Paddle length)
    if (x.text.trim()) { const q = hanOf(x.text); o.edit_vs_paddle = +(lev(paddleQ, q) / Math.max(1, [...paddleQ].length)).toFixed(4); }
    row.arms[arm] = o;
  }
  // flag signals (no Kanripo in any of them except qa_dice, which is the lane's own Kanripo screen)
  const sx = extract(second.get(s.uid));
  row.signals = {
    qa_dice: s.qa_dice ?? null,
    stored_second_cer: s.second ? +Math.min(1, lev(hanOf(s.second), paddleQ) / Math.max(1, [...paddleQ].length)).toFixed(4) : null,
    flashlow_second_cer: sx.text.trim() ? +Math.min(1, lev(hanOf(sx.text), paddleQ) / Math.max(1, [...paddleQ].length)).toFixed(4) : null,
    flashlow_status: sx.status,
    flashlow_secs: second.get(s.uid)?.secs ?? null,
  };
  return row;
});

// ── anchoring ──
const anch = [];
for (const a of anchors) {
  for (const arm of ['opus-correct', 'pro-correct', 'flashhigh-correct']) {
    const r = ARMS[arm].get(a.uid); const x = extract(r);
    const t = x.text;
    const res = a.plants.map((p) => {
      if (!t.trim()) return 'did-not-read';
      const L = p.left.replace(/.*\n/s, ''), R = p.right.replace(/\n.*/s, '');
      const find = (ctx, side) => { if ([...ctx].length < 3) return null; const i = t.indexOf(ctx); if (i < 0) return null; return side === 'L' ? [...t.slice(i + ctx.length)][0] : [...t.slice(0, i)].at(-1); };
      const ch = find(L, 'L') ?? find(R, 'R');
      return ch == null ? 'unresolved' : ch === p.now ? 'kept-planted' : ch === p.was ? 'fixed' : 'other';
    });
    // the same three sites in the UNPLANTED correction of the same page (does the arm keep the true character there?)
    anch.push({ uid: a.uid, arm, status: x.status, plants: res });
  }
}

// ── toward-Kanripo edits (input to the recitation read-off) ──
// Each Paddle-vs-leaf disagreement run (fitAlign ops on the Han body); where an arm's text contains before+ref+after
// and the Paddle text does not, the arm moved to the leaf there.
const toward = [];
for (const s of sets) {
  if (!s.kanripo) continue;
  const P = hanOf(s.paddle);
  const runs = fitAlign(P, s.kanripo, { ops: true }).runs.filter((r) => [...r.before].length >= 3 && [...r.after].length >= 3 && [...(r.ours + r.ref)].length <= 6);
  for (const r of runs) {
    const kan = r.before + r.ref + r.after, pad = r.before + r.ours + r.after;
    const by = [];
    for (const arm of ['opus-correct', 'pro-correct', 'flashhigh-correct', 'opus-redo']) {
      const x = extract(ARMS[arm].get(s.uid)); if (!x.text.trim()) continue;
      const q = hanOf(x.text);
      if (q.includes(kan) && !q.includes(pad)) by.push(arm);
    }
    if (by.length) toward.push({ uid: s.uid, stratum: s.stratum, before: r.before, paddle: r.ours, kanripo: r.ref, after: r.after, by });
  }
}

// ── summaries ──
const ARMLIST = ['paddle', ...Object.keys(ARMS)];
const STRATA = { A: (p) => p.stratum === 'A', B: (p) => p.stratum !== 'A', 'B-rand': (p) => p.stratum === 'B-rand', 'B-dis': (p) => p.stratum === 'B-dis' };
const summary = {};
for (const [sn, f] of Object.entries(STRATA)) {
  const P = pages.filter(f); if (!P.length) continue;
  summary[sn] = {};
  for (const arm of ARMLIST) {
    const rows = P.map((p) => ({ p, a: p.arms[arm] })).filter((x) => x.a && x.a.status !== 'missing');
    if (!rows.length) continue;
    const read = rows.filter((x) => x.a.status !== 'did-not-read');
    const scored = read.filter((x) => x.a.cer != null);
    const pad = (x) => x.p.arms.paddle;
    const o = {
      n: rows.length, did_not_read: rows.length - read.length, no_sentinel: read.filter((x) => x.a.status === 'no-sentinel' || x.a.status === 'cut').length,
      scored: scored.length,
      cer_median: scored.length ? +median(scored.map((x) => x.a.cer)).toFixed(4) : null,
      cer_mean: scored.length ? +mean(scored.map((x) => x.a.cer)).toFixed(4) : null,
      over_count: scored.reduce((t, x) => t + x.a.over, 0), pages_over_ge3: scored.filter((x) => x.a.over >= 3).length,
      order_jumps: scored.reduce((t, x) => t + x.a.jumps, 0), pages_with_jump: scored.filter((x) => x.a.jumps > 0).length,
      secs_median: read.length && arm !== 'paddle' ? median(read.map((x) => x.a.secs).filter((v) => v != null)) : null,
      calls_per_page: arm !== 'paddle' ? +(rows.reduce((t, x) => t + (x.a.calls || 0), 0) / rows.length).toFixed(2) : null,
    };
    if (arm !== 'paddle') {
      // paired with Paddle on the pages both scored; a page counts as worse/better if CER moves by > 0.5 pt
      const pr = scored.filter((x) => pad(x).cer != null).map((x) => x.a.cer - pad(x).cer);
      o.paired_n = pr.length; o.delta_cer_mean = pr.length ? +mean(pr).toFixed(4) : null; o.delta_cer_median = pr.length ? +median(pr).toFixed(4) : null;
      o.worse = pr.filter((d) => d > 0.005).length; o.better = pr.filter((d) => d < -0.005).length;
      o.worse_mean_pts = o.worse ? +(100 * mean(pr.filter((d) => d > 0.005))).toFixed(2) : null;
      o.worse_max_pts = o.worse ? +(100 * Math.max(...pr.filter((d) => d > 0.005))).toFixed(2) : null;
      o.edit_vs_paddle_median = read.length ? median(read.map((x) => x.a.edit_vs_paddle).filter((v) => v != null)) : null;
    }
    summary[sn][arm] = o;
  }
}
const anchSum = {};
for (const a of anch) { const o = (anchSum[a.arm] ||= { pages: 0, plants: 0, 'kept-planted': 0, fixed: 0, other: 0, unresolved: 0, 'did-not-read': 0 }); o.pages++; for (const r of a.plants) { o.plants++; o[r]++; } }
const towardSum = {}; for (const t of toward) for (const arm of t.by) towardSum[arm] = (towardSum[arm] || 0) + 1;
fs.writeFileSync('score.json', JSON.stringify({ summary, anchoring: anchSum, toward_kanripo_edits: towardSum, anchors: anch, toward, pages }, null, 1));
console.log(JSON.stringify({ summary, anchoring: anchSum, toward_kanripo_edits: towardSum }, null, 1));
