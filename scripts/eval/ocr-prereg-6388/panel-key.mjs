// PRIOR ART: scripts/eval/ocr-prereg-6388/score.mjs — this IS its key and scorer, moved out unchanged so the
// daily served-text trend (#6429, scripts/eval/quality-dashboard/trends.mjs) and the monthly production re-run
// (rerun-config.mjs) score exactly as the #6388 results did. score.mjs imports it back.
/**
 * The #6388 leave-one-out AI-consensus key and the capped CER against it. $0, no network, no Mongo.
 * Rules (README "Scoring"): plurality per aligned column, ties accept every tied reading; error = edit distance
 * to the key / mean normalised key length, capped at 1.0; a refusal or empty output on a page with text = 1.0.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { normalizeForScript, normalizeCJK } from '../lib/metrics.mjs';
import { mean } from '../lib/paired-stats.mjs';

export const HERE = path.dirname(new URL(import.meta.url).pathname);
export const MAX_CHARS = 6000;
export const STRATA = ['latin-print', 'zh-manuscript', 'english-print'];

// reads/<arm>.jsonl while the reads run; the committed copy is reads/<arm>.jsonl.gz.
export const readJsonl = f => {
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : fs.existsSync(`${f}.gz`) ? zlib.gunzipSync(fs.readFileSync(`${f}.gz`)).toString('utf8') : '';
  return text.split('\n').filter(Boolean).map(l => JSON.parse(l));
};
export const readSample = () => JSON.parse(fs.readFileSync(path.join(HERE, 'sample.json'), 'utf8')).rows;
export const readArm = arm => new Map(readJsonl(path.join(HERE, 'reads', `${arm}.jsonl`)).map(r => [r.uid, r]));

const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|blocked by Gemini's filters|^#{2,3} Summary\b|overview and summary of the text/im;
const BLOCK_FINISH = ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'];
export const isZh = st => st === 'zh-manuscript';
export const norm = (t, st, spaces) => {
  if (isZh(st)) return [...normalizeCJK(t || '')].slice(0, MAX_CHARS);
  const s = normalizeForScript(t || '', 'latin');
  return [...(spaces ? s : s.replace(/ /g, ''))].slice(0, MAX_CHARS);
};
// outcome: 'text' | 'refusal' | 'failed' | 'empty' | 'missing'
export function outcomeOf(r, chars) {
  // missing = no read exists (no Archive leaf, arm not run). A read that errored or timed out is a failed read: 'empty'.
  if (!r || r.skipped || r.error === 'not run') return 'missing';
  // claude -p returns its filter refusal as the result text with is_error set ("Output blocked by content filtering policy").
  if (r.blocked || r.is_error || BLOCK_FINISH.includes(r.finishReason) || REFUSAL.test(r.text || '') || /Output blocked by content filtering/i.test(r.text || '')) return 'refusal';
  if (r.error && !(r.text || '').trim()) return 'failed';  // timeout, denied tool: scored 1.0, never in a key
  if (!chars.length) return 'empty';
  return 'text';
}

// ── the consensus network ────────────────────────────────────────────────────
// cols[i] = array of symbols, one per reader added so far (null = gap). Progressive profile alignment.
function addToNetwork(cols, k, s) {
  if (k === 0) return s.map(c => [c]);
  const n = cols.length, m = s.length, Wd = m + 1;
  const back = new Uint8Array((n + 1) * Wd); // 1 = diag, 2 = up (reader gap), 3 = left (new column)
  let prev = new Int32Array(Wd), cur = new Int32Array(Wd);
  for (let j = 0; j <= m; j++) { prev[j] = j; back[j] = 3; }
  for (let i = 1; i <= n; i++) {
    const col = cols[i - 1];
    cur[0] = i; back[i * Wd] = 2;
    for (let j = 1; j <= m; j++) {
      const d = prev[j - 1] + (col.includes(s[j - 1]) ? 0 : 1), u = prev[j] + 1, l = cur[j - 1] + 1;
      if (d <= u && d <= l) { cur[j] = d; back[i * Wd + j] = 1; } else if (u <= l) { cur[j] = u; back[i * Wd + j] = 2; } else { cur[j] = l; back[i * Wd + j] = 3; }
    }
    [prev, cur] = [cur, prev];
  }
  const out = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const b = i === 0 ? 3 : j === 0 ? 2 : back[i * Wd + j];
    if (b === 1) { out.push([...cols[i - 1], s[j - 1]]); i--; j--; }
    else if (b === 2) { out.push([...cols[i - 1], null]); i--; }
    else { out.push([...Array(k).fill(null), s[j - 1]]); j--; }
  }
  return out.reverse();
}
export const buildNetwork = strings => strings.reduce((cols, s, k) => addToNetwork(cols, k, s), []);
// Plurality per column over the key readers; a tie accepts every tied reading.
function accepted(cols) {
  return cols.map(col => {
    const v = new Map();
    for (const x of col) v.set(x, (v.get(x) || 0) + 1);
    const top = Math.max(...v.values());
    const acc = [...v].filter(([, c]) => c === top).map(([x]) => x);
    return { acc: acc.filter(x => x !== null), eps: acc.includes(null) };
  });
}
// Edit distance of a hypothesis to the key network.
function distToKey(key, h) {
  const m = h.length;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (const { acc, eps } of key) {
    const skip = eps ? 0 : 1;
    cur[0] = prev[0] + skip;
    for (let j = 1; j <= m; j++) {
      const d = prev[j - 1] + (acc.includes(h[j - 1]) ? 0 : 1), u = prev[j] + skip, l = cur[j - 1] + 1;
      cur[j] = d < u ? (d < l ? d : l) : (u < l ? u : l);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

// ── per-page keys and scores ─────────────────────────────────────────────────
// keyArms → { status: 'ok'|'blank'|'unscorable', key, denom, used }
export function makeKey(page, keyArms) {
  const live = keyArms.map(a => ({ a, ...page.arm[a] })).filter(x => x.outcome !== 'missing');
  const hasText = live.some(x => x.outcome === 'text' && x.chars.length >= 20);
  const used = live.filter(x => x.outcome === 'text' || (!hasText && x.outcome === 'empty'));
  if (!used.length) return { status: 'unscorable', used: [] };
  if (used.every(x => !x.chars.length)) return { status: 'blank', used: used.map(x => x.a) };
  const key = accepted(buildNetwork(used.map(x => x.chars)));
  return { status: 'ok', key, denom: mean(used.map(x => x.chars.length)), used: used.map(x => x.a) };
}
export function scoreArm(page, k, arm) {
  const r = page.arm[arm];
  if (!r || r.outcome === 'missing') return null;
  if (k.status === 'unscorable') return null;
  if (k.status === 'blank') return r.chars.length ? 1 : 0;
  if (r.outcome !== 'text') return 1;                      // refusal or empty output on a page with text
  if (r.chars.length > 3 * k.denom) return 1;              // at least 2× the key's length in insertions alone
  return Math.min(1, distToKey(k.key, r.chars) / k.denom);
}

/** One sample row + its reads (Map per arm) → the page shape makeKey/scoreArm take. */
export function pageOf(s, readsByArm) {
  const arm = {};
  for (const [a, m] of Object.entries(readsByArm)) {
    const r = m.get(s.uid);
    const chars = norm(r?.text, s.stratum, false);
    arm[a] = { outcome: outcomeOf(r, chars), chars, raw: r?.text || '' };
  }
  return { ...s, arm };
}

/** The key readers per stratum: every non-production reader (Kraken does not read Chinese manuscript). */
export const READERS = st => (isZh(st) ? ['G', 'S'] : ['G', 'S', 'O']);
