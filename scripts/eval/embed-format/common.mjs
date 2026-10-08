/**
 * PRIOR ART: scripts/eval/orig-lang-recall/gemini-arm.mjs — embeds the #5729 pool
 * with the preview model, plain text, 768 dims, JSON vectors; it has no document
 * or query prefix, no GA model, no dimension above 768 and no billed-token count.
 * scripts/eval/lib/embedding-eval.mjs `embedTexts` — same limits. This module is
 * the shared part of the #6170 arms: one embed call that takes model + format and
 * returns billed tokens, a spend cap, and Float32 vector files (3072-d JSON for
 * ~18K pages would be >1 GB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { usdForTokens, estimateTextTokens, logEmbeddingUsage } from '../../lib/embedding-usage.mjs';

export const MODELS = { preview: 'gemini-embedding-2-preview', ga: 'gemini-embedding-2' };
export const FULL_DIMS = 3072;
export const SEED = 6170;
/** Stop before the $5 cap of the brief; the ledger is cumulative across runs. */
export const CAP_USD = 4.5;
export const ENDPOINT = 'eval/embed-format';

/** The documented in-text task forms (ai.google.dev/gemini-api/docs/embeddings, read 2026-10-07). */
export const QUERY_FORMS = {
  plain: (q) => q,
  search: (q) => `task: search result | query: ${q}`,
  qa: (q) => `task: question answering | query: ${q}`,
};
export const DOC_FORMS = {
  plain: (r) => r.text,
  prefix: (r) => `title: ${(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'none'} | text: ${r.text}`,
};

export const arg = (k, d) => { const a = process.argv.slice(2); const i = a.indexOf(k); return i === -1 ? d : a[i + 1]; };
export const has = (k) => process.argv.slice(2).includes(k);
export const readJsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function ledgerFile(dir) { return path.join(dir, 'spend.json'); }
export function readLedger(dir) {
  return fs.existsSync(ledgerFile(dir)) ? JSON.parse(fs.readFileSync(ledgerFile(dir), 'utf8')) : { tokens: 0, usd: 0, runs: [] };
}

/**
 * Embed `texts` at 3072 dims (768 and 1536 are its renormalised prefixes — checked
 * in compat.mjs). Returns { vectors, tokens } where tokens is the BILLED
 * promptTokenCount when the API returns one, else the script-aware estimate.
 */
export async function embedBatch(model, texts) {
  const body = JSON.stringify({ requests: texts.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] }, outputDimensionality: FULL_DIMS })) });
  for (let attempt = 0; ; attempt++) {
    // usage-ok: metered by the caller through recordSpend → logEmbeddingUsage (endpoint eval/embed-format).
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(120000) }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) {
      const j = await res.json();
      const billed = j.usageMetadata?.promptTokenCount;
      return { vectors: j.embeddings.map((e) => e.values), tokens: billed ?? texts.reduce((s, t) => s + estimateTextTokens(t), 0), billed: billed != null };
    }
    const msg = (await res.text()).slice(0, 300);
    if (attempt >= 6 || ![0, 429, 500, 502, 503, 504].includes(res.status)) throw new Error(`gemini ${res.status}: ${msg}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

/** Add a run to the ledger and write one gemini_usage row. Throws once the cap is reached. */
export async function recordSpend(dir, { model, what, texts, chars, tokens }) {
  const l = readLedger(dir);
  const usd = usdForTokens(tokens);
  l.tokens += tokens; l.usd += usd;
  l.runs.push({ at: new Date().toISOString(), what, model, texts, tokens, usd: Math.round(usd * 1e4) / 1e4 });
  fs.writeFileSync(ledgerFile(dir), JSON.stringify(l, null, 1));
  await logEmbeddingUsage({ texts, chars, tokens }, { model, endpoint: ENDPOINT });
  if (l.usd >= CAP_USD) throw new Error(`spend cap reached: $${l.usd.toFixed(2)} >= $${CAP_USD}`);
  return l;
}

/** Float32 matrix file: rows × dims, row order = pool order. */
export function loadMatrix(file, dims) {
  const buf = fs.readFileSync(file);
  return { data: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), dims, rows: buf.byteLength / 4 / dims };
}
/** Row i cut to `d` dims and renormalised. */
export function rowAt(m, i, d = m.dims) {
  const v = m.data.subarray(i * m.dims, i * m.dims + d);
  let n = 0; for (let k = 0; k < d; k++) n += v[k] * v[k];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(d); for (let k = 0; k < d; k++) out[k] = v[k] / n;
  return out;
}
export function cut(v, d) {
  let n = 0; for (let k = 0; k < d; k++) n += v[k] * v[k];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(d); for (let k = 0; k < d; k++) out[k] = v[k] / n;
  return out;
}
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
