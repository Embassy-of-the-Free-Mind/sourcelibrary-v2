// PRIOR ART: score.mjs in this directory, where this code was written for #6388; moved here unchanged so that
// adjudicate.mjs (Amendment 2) rebuilds the very same alignment and spans instead of a copy that could drift.
import { normalizeForScript, normalizeCJK } from '../lib/metrics.mjs';

export const MAX_CHARS = 6000;
export const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|blocked by Gemini's filters|^#{2,3} Summary\b|overview and summary of the text/im;
export const BLOCK_FINISH = ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'];
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

/** The #6388 consensus network: progressive character alignment of several readers, plurality key, key distance. */
// ── the consensus network ────────────────────────────────────────────────────
// cols[i] = array of symbols, one per reader added so far (null = gap). Progressive profile alignment.
export function addToNetwork(cols, k, s) {
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
export function accepted(cols) {
  return cols.map(col => {
    const v = new Map();
    for (const x of col) v.set(x, (v.get(x) || 0) + 1);
    const top = Math.max(...v.values());
    const acc = [...v].filter(([, c]) => c === top).map(([x]) => x);
    return { acc: acc.filter(x => x !== null), eps: acc.includes(null) };
  });
}
// Edit distance of a hypothesis to the key network.
export function distToKey(key, h) {
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
