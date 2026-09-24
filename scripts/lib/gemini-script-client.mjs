#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/lib/runners.mjs (`runGemini`) — already wraps the raw REST
 * call with a thinking default, key rotation, and a `logUsage` call. It is NOT the
 * one-import answer for a hand-run maintenance/enrichment/analysis script: it is an
 * EVAL HARNESS built to compare arms across providers (Claude, Mistral OCR/chat,
 * Scaleway, MuleRouter, Google Vision, Replicate), so importing it into a one-off
 * script drags in five providers' worth of dispatch logic the script will never use,
 * its `opts.endpoint` defaults to `'eval/runner'` (wrong label for a non-eval
 * caller), and its image handling is OCR-shaped (an array of page buffers with
 * `mediaResolution`/`thinkingLevel` knobs an ordinary text-or-one-image call site
 * doesn't need). Also checked scripts/workers/lib/supabase-usage-logger.mjs — it is
 * the Supabase WRITER this file calls (`logUsage`, `outputTokensFrom`), not a Gemini
 * caller, and has no thinking default at all: something has to set the request
 * config, and that's the gap this file fills. Also checked src/lib/gemini-client.ts —
 * the equivalent chokepoint for src/, but it wraps the `@google/generative-ai` SDK
 * and is TypeScript; scripts/ is plain Node .mjs and most hand-run scripts here call
 * Gemini over raw `fetch`, not the SDK, so its wrapping approach doesn't transplant.
 *
 * gemini-script-client — the one import for a hand-run script that calls Gemini.
 *
 * WHY THIS EXISTS (#3685, #4599). Gemini 2.5+/3.x thinks by default and bills the
 * hidden reasoning at the output rate. Production paths are now safe by construction
 * (the SDK chokepoint in src/lib/gemini-client.ts, the worker-stack fix behind
 * #4599). What's left is every one-off script a developer or an AI session writes at
 * a terminal — call Gemini directly, forget the thinking budget, forget to log
 * usage. On 2026-09-14 one such run billed 7.0M output tokens against 0.4M input on
 * gemini-2.5-flash ($17.45) and wrote no usage row at all.
 *
 * The safe path has to be the SHORTEST path, so this is ONE function:
 *
 *   import { callGemini } from '../lib/gemini-script-client.mjs';
 *   const { text } = await callGemini({
 *     model: 'gemini-3.1-flash-lite',
 *     prompt: 'Summarize this page.',
 *     endpoint: 'scripts/maintenance/my-one-off.mjs',   // required — who is spending
 *   });
 *
 * WHAT IT DOES BY DEFAULT
 *   - `thinkingBudget: 0` on any model that accepts the field (checked with
 *     `acceptsZeroThinking` from ./model-pricing.mjs — the same allow-list the SDK
 *     chokepoint and the standing guard use). A model that doesn't accept the field
 *     (2.0/1.5/pro/embedding/etc) is left untouched, same reasoning as the guard.
 *   - Reasoning ON is opt-in, never accidental: pass a number for `thinkingBudget`
 *     (e.g. 8192) to request a specific budget, or `allowThinking: true` to leave the
 *     model's own default in place. Silence always means OFF.
 *   - Output tokens are counted as GOOGLE BILLS THEM — `candidatesTokenCount PLUS
 *     thoughtsTokenCount` — via `outputTokensFrom` from supabase-usage-logger.mjs,
 *     never `candidatesTokenCount` alone.
 *   - Every call writes a `gemini_usage` row through `logUsage`, tagged with the
 *     `endpoint` you pass (required — that's the label the next spend report groups
 *     by; omitting it is a caller bug, not a silent default, so it throws before any
 *     network call is made).
 *   - Logging NEVER throws past this function. If the Supabase write fails, this
 *     warns to stderr and returns/throws based on the ACTUAL Gemini call outcome —
 *     a metering failure must never turn a working call into a crash, and a failed
 *     call must still surface to the caller even if its failure row didn't write.
 *
 * Usage: needs GEMINI_API_KEY (or GEMINI_API_KEY_2.. for rotation across parallel
 * runs) and, to actually log, SUPABASE_SERVICE_ROLE_KEY — same env as every other
 * script here (`set -a; source .env.production.local; set +a`).
 */

import { logUsage, outputTokensFrom } from '../workers/lib/supabase-usage-logger.mjs';
import { acceptsZeroThinking } from './model-pricing.mjs';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function loadKeys() {
  const keys = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GEMINI_API_KEY') && v) keys.push(v);
  }
  return keys;
}

let keyIndex = 0;
function nextKey() {
  const keys = loadKeys();
  if (!keys.length) throw new Error('gemini-script-client: no GEMINI_API_KEY* env var set');
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return key;
}

/**
 * Normalize an image input to a Gemini `inline_data` part.
 * Accepts a Buffer (assumed JPEG unless mimeType given), or an already-shaped
 * `{ mimeType, data }` pair where `data` is a Buffer or base64 string.
 */
function toImagePart(image) {
  if (Buffer.isBuffer(image)) {
    return { inline_data: { mime_type: 'image/jpeg', data: image.toString('base64') } };
  }
  const mimeType = image?.mimeType || 'image/jpeg';
  const data = Buffer.isBuffer(image?.data) ? image.data.toString('base64') : image?.data;
  return { inline_data: { mime_type: mimeType, data } };
}

/**
 * Call Gemini's `generateContent`, safely by default, and record what it cost.
 *
 * @param {object} opts
 * @param {string} opts.model - e.g. 'gemini-3.1-flash-lite'
 * @param {string} opts.prompt - the text prompt
 * @param {string} opts.endpoint - REQUIRED. Who is spending (script path or module name).
 * @param {(Buffer|{mimeType:string,data:Buffer|string})[]|Buffer} [opts.imageParts] - zero, one, or several images
 * @param {number} [opts.thinkingBudget] - explicit budget; overrides the zero default
 * @param {boolean} [opts.allowThinking] - leave the model's own thinking default in place
 * @param {number} [opts.temperature=0]
 * @param {number} [opts.maxOutputTokens=8000]
 * @param {string} [opts.type='other'] - gemini_usage `type` column
 * @param {string} [opts.bookId]
 * @param {string[]} [opts.pageIds]
 * @param {string} [opts.promptVersion]
 * @param {string} [opts.triggeredBy='manual']
 * @param {string} [opts.apiKey] - override key rotation
 * @param {object[]} [opts.safetySettings] - passed through verbatim (the translation lanes need BLOCK_NONE, translate-worker SAFETY_SETTINGS)
 * @returns {Promise<{text:string, model:string, inputTokens:number, outputTokens:number, thinkingTokens:number, finishReason:string, raw:object}>}
 */
export async function callGemini(opts = {}) {
  const {
    model,
    prompt,
    endpoint,
    imageParts,
    thinkingBudget,
    allowThinking = false,
    temperature = 0,
    maxOutputTokens = 8000,
    type = 'other',
    bookId,
    pageIds,
    promptVersion,
    triggeredBy = 'manual',
    apiKey,
    safetySettings,
  } = opts;

  if (!endpoint) throw new Error('gemini-script-client: `endpoint` is required — label who is spending');
  if (!model) throw new Error('gemini-script-client: `model` is required');
  if (!prompt) throw new Error('gemini-script-client: `prompt` is required');

  const key = apiKey || nextKey();
  const images = imageParts == null ? [] : (Array.isArray(imageParts) ? imageParts : [imageParts]);
  const parts = [{ text: prompt }, ...images.map(toImagePart)];

  const generationConfig = { temperature, maxOutputTokens };
  if (typeof thinkingBudget === 'number') {
    generationConfig.thinkingConfig = { thinkingBudget };
  } else if (!allowThinking && acceptsZeroThinking(model)) {
    // Silence means OFF (#4581, #4599) — a call site has to ask for reasoning,
    // never get it by omission.
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const start = Date.now();
  let data;
  let callError;
  try {
    const resp = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig, ...(safetySettings ? { safetySettings } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 300)}`);
    }
    data = await resp.json();
  } catch (err) {
    callError = err;
  }
  const durationMs = Date.now() - start;

  const usage = data?.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = outputTokensFrom(usage);
  const thinkingTokens = usage?.thoughtsTokenCount || 0;
  const candidateParts = data?.candidates?.[0]?.content?.parts || [];
  const text = candidateParts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');

  // Logging must never turn a working call into a crash, and a failed call must
  // still surface even if its own failure row didn't make it to Supabase.
  try {
    await logUsage({
      type,
      mode: 'realtime',
      model,
      book_id: bookId,
      page_ids: pageIds,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      status: callError ? 'failed' : 'success',
      error_message: callError ? String(callError.message || callError).slice(0, 500) : undefined,
      duration_ms: durationMs,
      endpoint,
      triggered_by: triggeredBy,
      prompt_version: promptVersion,
    });
  } catch (logErr) {
    console.warn(`[gemini-script-client] usage logging failed (${logErr.message}) — call itself ${callError ? 'also failed' : 'succeeded'}`);
  }

  if (callError) throw callError;

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    thinkingTokens,
    finishReason: data?.candidates?.[0]?.finishReason || 'unknown',
    raw: data,
  };
}
