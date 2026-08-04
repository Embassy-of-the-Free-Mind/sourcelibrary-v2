/**
 * QA-Eval Model Runners
 *
 * Unified execution wrappers for Gemini and Claude models.
 * Handles key rotation, cost tracking, and normalizes output.
 */

import Anthropic from '@anthropic-ai/sdk';
// Prices come from the one shared table — this file used to carry its own copy,
// which is how `gemini-3.1-flash-lite` ended up costed 3.3x apart across lanes.
import { priceFor } from '../../lib/model-pricing.mjs';


function calcCost(model, inputTokens, outputTokens) {
  const p = priceFor(model);
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

// Mistral OCR is priced per page, not per token. OCR 4 (what -latest points
// at) is $4 / 1000 pages per mistral.ai/pricing, verified 2026-07-19.
const MISTRAL_OCR_USD_PER_PAGE = 0.004;

export function estimateCost(model, runsPerPage, sampleSize) {
  const calls = runsPerPage * sampleSize;
  if (isMistralOcrModel(resolveModel(model))) {
    return { calls, estimatedUsd: calls * MISTRAL_OCR_USD_PER_PAGE };
  }
  const p = priceFor(model);
  // Rough estimate: ~1500 input tokens (image), ~2000 output tokens per OCR call
  const inputPerCall = 1500;
  const outputPerCall = 2000;
  return {
    calls,
    estimatedUsd: calls * calcCost(model, inputPerCall, outputPerCall),
  };
}

// ── Gemini API key rotation ────────────────────────────────────────

let geminiKeys = [];
let geminiKeyIndex = 0;
const keyCooldowns = new Map(); // key → cooldown expiry timestamp

function loadGeminiKeys() {
  if (geminiKeys.length > 0) return;
  const keys = new Set();
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GEMINI_API_KEY') && v) keys.add(v);
  }
  geminiKeys = [...keys];
  if (geminiKeys.length === 0) throw new Error('No GEMINI_API_KEY* env vars set');
}

function getNextGeminiKey() {
  loadGeminiKeys();
  const now = Date.now();
  // Try each key, skip those in cooldown
  for (let i = 0; i < geminiKeys.length; i++) {
    const idx = (geminiKeyIndex + i) % geminiKeys.length;
    const key = geminiKeys[idx];
    const cooldown = keyCooldowns.get(key);
    if (!cooldown || now > cooldown) {
      geminiKeyIndex = (idx + 1) % geminiKeys.length;
      return key;
    }
  }
  // All keys in cooldown — use the one that expires soonest
  geminiKeyIndex = (geminiKeyIndex + 1) % geminiKeys.length;
  return geminiKeys[geminiKeyIndex];
}

function reportGeminiRateLimit(key) {
  keyCooldowns.set(key, Date.now() + 60_000);
}

// ── Anthropic client (lazy init) ───────────────────────────────────

let anthropicClient = null;

function getAnthropic() {
  if (!anthropicClient) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

// ── Run Gemini ─────────────────────────────────────────────────────

/**
 * `imageBuffer` may be a single Buffer or an ARRAY of Buffers. An array sends
 * several page images in one request, in order, after the prompt — used by the
 * page-grouping arm of the prompt ablation (#3444), since production OCR sends
 * one image per call and therefore has no cross-page context at all.
 */
export async function runGemini(model, imageBuffer, prompt, opts = {}) {
  const { temperature = 0, maxTokens = 8000, thinking = false, mediaResolution } = opts;
  const apiKey = getNextGeminiKey();
  const buffers = Array.isArray(imageBuffer) ? imageBuffer : [imageBuffer];

  const genConfig = { temperature, maxOutputTokens: maxTokens };
  if (mediaResolution) {
    const resMap = { low: 'MEDIA_RESOLUTION_LOW', medium: 'MEDIA_RESOLUTION_MEDIUM', high: 'MEDIA_RESOLUTION_HIGH' };
    genConfig.mediaResolution = resMap[mediaResolution] || mediaResolution;
  }

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        ...buffers.map(b => ({ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } })),
      ],
    }],
    generationConfig: genConfig,
  };

  if (thinking) {
    // Gemini 3.x uses thinkingLevel; 2.5 uses thinkingBudget
    const isGemini3 = model.includes('gemini-3');
    body.generationConfig.thinkingConfig = isGemini3
      ? { thinkingLevel: 'HIGH' }
      : { thinkingBudget: 8192 };
  }

  const start = Date.now();
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

  if (resp.status === 429) {
    reportGeminiRateLimit(apiKey);
    throw new Error(`Rate limited on Gemini key (${apiKey.slice(0, 8)}...)`);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const durationMs = Date.now() - start;

  // Thinking models return multiple parts: thought + text
  const parts = data.candidates?.[0]?.content?.parts || [];
  const textParts = parts.filter(p => p.text && !p.thought);
  const thoughtParts = parts.filter(p => p.thought);
  const text = textParts.map(p => p.text).join('') || parts[0]?.text || '';

  const usage = data.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const thinkingTokens = usage.thoughtsTokenCount || 0;

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    thinkingTokens,
    costUsd: calcCost(model, inputTokens, outputTokens),
    durationMs,
    finishReason: data.candidates?.[0]?.finishReason || 'unknown',
    ...(thinking && thoughtParts.length > 0 && { thoughtText: thoughtParts.map(p => p.thought || p.text).join('') }),
  };
}

// ── Run Claude ─────────────────────────────────────────────────────

// Fable 5 / Opus 4.7+ / Sonnet 5 reject sampling params (400) and have thinking
// always-on or adaptive — the temperature knob only exists on older models.
const NO_SAMPLING_RE = /claude-(fable|mythos)-|claude-opus-4-[78]|claude-sonnet-5/;

export async function runClaude(model, imageBuffer, prompt, opts = {}) {
  const { temperature = 0, maxTokens = 8000 } = opts;
  const client = getAnthropic();
  const b64 = imageBuffer.toString('base64');

  const start = Date.now();
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(NO_SAMPLING_RE.test(model) ? {} : { temperature }),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      ],
    }],
  });

  const durationMs = Date.now() - start;
  // Thinking-capable models may lead with a thinking block — take the text blocks.
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  const inputTokens = resp.usage?.input_tokens || 0;
  const outputTokens = resp.usage?.output_tokens || 0;

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    costUsd: calcCost(model, inputTokens, outputTokens),
    durationMs,
    finishReason: resp.stop_reason || 'unknown',
  };
}

// ── Run Mistral OCR ────────────────────────────────────────────────

// Dedicated document-OCR endpoint, not a chat model: the prompt is ignored,
// there are no sampling knobs, and output is markdown per page.
function getMistralKey() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY not set');
  return key;
}

export async function runMistralOcr(model, imageBuffer, _prompt, _opts = {}) {
  const key = getMistralKey();
  const b64 = imageBuffer.toString('base64');

  const start = Date.now();
  const resp = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      document: { type: 'image_url', image_url: `data:image/jpeg;base64,${b64}` },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Mistral OCR ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const durationMs = Date.now() - start;
  const text = (data.pages || []).map(p => p.markdown || '').join('\n\n');
  const pagesProcessed = data.usage_info?.pages_processed ?? (data.pages?.length || 1);

  return {
    text,
    model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: pagesProcessed * MISTRAL_OCR_USD_PER_PAGE,
    durationMs,
    finishReason: text.trim() ? 'stop' : 'refusal',
  };
}

// ── Run Mistral chat (vision) ──────────────────────────────────────

// mistral-medium / mistral-small vision models via chat completions — these
// DO take our OCR prompt, so they compare apples-to-apples with Gemini/Claude
// (unlike the dedicated OCR endpoint above, which ignores the prompt and has
// no <language>/<page-type> tag contract).
export async function runMistralChat(model, imageBuffer, prompt, opts = {}) {
  const { temperature = 0, maxTokens = 8000 } = opts;
  const b64 = imageBuffer.toString('base64');

  const start = Date.now();
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getMistralKey()}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: `data:image/jpeg;base64,${b64}` },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Mistral ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const durationMs = Date.now() - start;
  const text = data.choices?.[0]?.message?.content || '';
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    costUsd: calcCost(model, inputTokens, outputTokens),
    durationMs,
    finishReason: data.choices?.[0]?.finish_reason || 'unknown',
  };
}

// ── Run via MuleRouter (OpenAI-compatible multi-provider router) ───

// Routes Qwen/DeepSeek/GLM/Kimi/Grok/GPT models through api.mulerouter.ai.
// Needs MULEROUTER_API_KEY (kept in secret-lover, global scope — not in
// .env.production.local). Usage tokens come back OpenAI-style; cost falls
// back to PRICING.default until per-model router prices are confirmed.
const MULE_MODEL_RE = /^(qwen|deepseek|glm|kimi|grok|gpt)-?/;

export function isMuleModel(model) {
  return MULE_MODEL_RE.test(model);
}

export async function runMuleRouter(model, imageBuffer, prompt, opts = {}) {
  const key = process.env.MULEROUTER_API_KEY;
  if (!key) throw new Error('MULEROUTER_API_KEY not set');
  const { temperature = 0, maxTokens = 8000 } = opts;
  const b64 = imageBuffer.toString('base64');

  const start = Date.now();
  // NB: the documented /v1/chat/completions alias 404s on the current
  // deployment — only the vendor-scoped path works (all models, all vendors).
  const resp = await fetch('https://api.mulerouter.ai/vendors/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`MuleRouter ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const durationMs = Date.now() - start;
  const text = data.choices?.[0]?.message?.content || '';
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    costUsd: calcCost(model, inputTokens, outputTokens),
    durationMs,
    finishReason: data.choices?.[0]?.finish_reason || 'unknown',
  };
}

// ── Run via Scaleway Generative APIs ───────────────────────────────

// OpenAI-compatible serverless inference (EU-hosted). Model IDs are prefixed
// `scw:` to disambiguate from the same open models served elsewhere (e.g.
// gemma-3-27b-it exists on both Google's API and Scaleway); the prefix is
// kept in the recorded model name so observations distinguish the serving
// provider. Needs SCALEWAY_SECRET_KEY (secret-lover, makemode project).
export function isScalewayModel(model) {
  return model.startsWith('scw:');
}

export async function runScaleway(model, imageBuffer, prompt, opts = {}) {
  const key = process.env.SCALEWAY_SECRET_KEY;
  if (!key) throw new Error('SCALEWAY_SECRET_KEY not set');
  // Scaleway hard-caps max_completion_tokens at 8192 (400s above it).
  const { temperature = 0 } = opts;
  const maxTokens = Math.min(opts.maxTokens ?? 8000, 8192);
  // Scaleway 400s on large base64 data URIs — pass the remote source URL
  // when available (absent only on width-resized arms, which stay inline).
  const image = opts.imageUrl || `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  const start = Date.now();
  const resp = await fetch('https://api.scaleway.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model.slice(4),
      temperature,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`Scaleway ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

  const data = await resp.json();
  const durationMs = Date.now() - start;
  const text = data.choices?.[0]?.message?.content || '';
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    costUsd: calcCost(model, inputTokens, outputTokens),
    durationMs,
    finishReason: data.choices?.[0]?.finish_reason || 'unknown',
  };
}

// ── Run DeepSeek-OCR via Replicate ─────────────────────────────────

// Community cog port (lucataco/deepseek-ocr) of DeepSeek-OCR — a dedicated
// OCR model like Mistral-OCR: the prompt is ignored. Billed per GPU-second,
// so costUsd is estimated from wall time. Prefers opts.imageUrl (full-res
// source) over uploading the buffer as a data URI.
const REPLICATE_DEEPSEEK_OCR_VERSION = 'cb3b474fbfc56b1664c8c7841550bccecbe7b74c30e45ce938ffca1180b4dff5';
const REPLICATE_L40S_USD_PER_SEC = 0.000975;

export function isReplicateOcrModel(model) {
  return model === 'deepseek-ocr-replicate';
}

export async function runReplicateDeepSeekOcr(_model, imageBuffer, _prompt, opts = {}) {
  const key = process.env.REPLICATE_API_TOKEN;
  if (!key) throw new Error('REPLICATE_API_TOKEN not set');
  const image = opts.imageUrl || `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  const start = Date.now();
  const resp = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Prefer: 'wait=60' },
    body: JSON.stringify({
      version: REPLICATE_DEEPSEEK_OCR_VERSION,
      input: { image, task_type: 'Free OCR', resolution_size: 'Gundam (Recommended)' },
    }),
  });
  if (!resp.ok) throw new Error(`Replicate ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  let pred = await resp.json();

  // Cold starts overrun the sync wait — poll until terminal.
  const deadline = Date.now() + 8 * 60 * 1000;
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() > deadline) throw new Error(`Replicate prediction ${pred.id} timed out (${pred.status})`);
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    pred = await poll.json();
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate ${pred.status}: ${String(pred.error).slice(0, 200)}`);

  const durationMs = Date.now() - start;
  const text = Array.isArray(pred.output) ? pred.output.join('') : (pred.output || '');
  const predictSec = pred.metrics?.predict_time ?? durationMs / 1000;

  return {
    text,
    model: 'deepseek-ocr-replicate',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: predictSec * REPLICATE_L40S_USD_PER_SEC,
    durationMs,
    finishReason: text.trim() ? 'stop' : 'refusal',
  };
}

// ── Unified runner ─────────────────────────────────────────────────

const MODEL_ALIASES = {
  'flash': 'gemini-3-flash-preview',
  'flash-lite': 'gemini-3.1-flash-lite',
  'lite': 'gemini-3.1-flash-lite',
  'lite35': 'gemini-3.5-flash-lite',
  'flash36': 'gemini-3.6-flash',
  'pro': 'gemini-3.1-pro-preview',
  'fable': 'claude-fable-5',
  'opus48': 'claude-opus-4-8',
  'sonnet5': 'claude-sonnet-5',
  'opus': 'claude-opus-4-6',
  'sonnet': 'claude-sonnet-4-6',
  'haiku': 'claude-haiku-4-5-20251001',
  'mistral-ocr': 'mistral-ocr-latest',
  'mistral': 'mistral-medium-latest',
  'mistral-medium': 'mistral-medium-latest',
  'mistral-small': 'mistral-small-latest',
};

export function resolveModel(nameOrAlias) {
  return MODEL_ALIASES[nameOrAlias] || nameOrAlias;
}

export function isClaudeModel(model) {
  return model.startsWith('claude-');
}

export function isMistralOcrModel(model) {
  return model.startsWith('mistral-ocr');
}

export function isMistralModel(model) {
  return model.startsWith('mistral-') || model.startsWith('pixtral-');
}

export async function runModel(model, imageBuffer, prompt, opts = {}) {
  const resolved = resolveModel(model);
  if (isClaudeModel(resolved)) return runClaude(resolved, imageBuffer, prompt, opts);
  if (isMistralOcrModel(resolved)) return runMistralOcr(resolved, imageBuffer, prompt, opts);
  if (isMistralModel(resolved)) return runMistralChat(resolved, imageBuffer, prompt, opts);
  if (isReplicateOcrModel(resolved)) return runReplicateDeepSeekOcr(resolved, imageBuffer, prompt, opts);
  if (isScalewayModel(resolved)) return runScaleway(resolved, imageBuffer, prompt, opts);
  if (isMuleModel(resolved)) return runMuleRouter(resolved, imageBuffer, prompt, opts);
  return runGemini(resolved, imageBuffer, prompt, opts);
}

// ── Image fetching helper ──────────────────────────────────────────

export async function fetchImage(url, timeoutMs = 30000) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}
