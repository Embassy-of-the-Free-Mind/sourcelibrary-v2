/**
 * QA-Eval Model Runners
 *
 * Unified execution wrappers for Gemini and Claude models.
 * Handles key rotation, cost tracking, and normalizes output.
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Pricing (per 1M tokens, USD) ───────────────────────────────────

const PRICING = {
  'gemini-3-flash-preview':       { input: 0.50, output: 3.00 },
  'gemini-3.1-flash-lite': { input: 0.075, output: 0.30 },
  'gemini-3.1-pro-preview':       { input: 2.50, output: 15.00 },
  'gemini-2.5-flash':             { input: 0.15, output: 0.60 },
  'claude-fable-5':               { input: 10.00, output: 50.00 },
  'claude-opus-4-8':              { input: 5.00, output: 25.00 },
  'claude-sonnet-5':              { input: 3.00, output: 15.00 },
  'claude-opus-4-6':              { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':            { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001':    { input: 0.80, output: 4.00 },
  'mistral-medium-latest':        { input: 1.50, output: 7.50 },
  'mistral-small-latest':         { input: 0.15, output: 0.60 },
  default:                        { input: 0.50, output: 3.00 },
};

function calcCost(model, inputTokens, outputTokens) {
  const p = PRICING[model] || PRICING.default;
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
  const p = PRICING[model] || PRICING.default;
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

export async function runGemini(model, imageBuffer, prompt, opts = {}) {
  const { temperature = 0, maxTokens = 8000, thinking = false, mediaResolution } = opts;
  const apiKey = getNextGeminiKey();
  const b64 = imageBuffer.toString('base64');

  const genConfig = { temperature, maxOutputTokens: maxTokens };
  if (mediaResolution) {
    const resMap = { low: 'MEDIA_RESOLUTION_LOW', medium: 'MEDIA_RESOLUTION_MEDIUM', high: 'MEDIA_RESOLUTION_HIGH' };
    genConfig.mediaResolution = resMap[mediaResolution] || mediaResolution;
  }

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: b64 } },
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

// ── Unified runner ─────────────────────────────────────────────────

const MODEL_ALIASES = {
  'flash': 'gemini-3-flash-preview',
  'flash-lite': 'gemini-3.1-flash-lite',
  'lite': 'gemini-3.1-flash-lite',
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
  return runGemini(resolved, imageBuffer, prompt, opts);
}

// ── Image fetching helper ──────────────────────────────────────────

export async function fetchImage(url, timeoutMs = 30000) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}
