#!/usr/bin/env node
/**
 * CLIP image embedding server for visual search.
 *
 * Runs on Hetzner alongside the text embedding server (port 3456).
 * Encodes images and text into a shared 512-dim embedding space,
 * enabling image→image and text→image similarity search.
 *
 * Model: Xenova/clip-vit-base-patch32 (512 dims, ONNX quantized)
 * Cost: $0 (runs locally on Hetzner CPU)
 *
 * Start: node scripts/workers/clip-server.mjs
 * Health: GET /health
 * Embed image:  POST /embed-image { url: "https://..." } or { base64: "...", mime_type: "image/jpeg" }
 * Embed text:   POST /embed-text  { text: "allegory of arithmetic" }
 * Embed batch:  POST /embed-images { urls: ["https://...", ...] }
 *
 * Port: 3457 (or CLIP_PORT env var)
 *
 * Runtime: CLIP_RUNTIME=v2 (default, @xenova/transformers 2.17) or v4
 * (@huggingface/transformers 4.3.0). The two produce DIFFERENT vectors from the
 * same model file and the same image bytes — median cosine 0.993 on the Hetzner
 * box, and half of text→image queries change their top hit when a v4 query meets
 * a v2 corpus (#5099). So a runtime is never switched on its own: the stored
 * clip_embeddings must be re-embedded with the same runtime first. The switch is
 * an env var, not a code change, so an hourly auto-pull of main can never flip
 * the production server by itself. /health reports the runtime; writers stamp it
 * into clip_embeddings.embedding_model so every row says which space it lives in.
 */

import http from 'http';

const PORT = parseInt(process.env.CLIP_PORT || '3457');
const RUNTIME = process.env.CLIP_RUNTIME || 'v2';
if (!['v2', 'v4'].includes(RUNTIME)) throw new Error(`CLIP_RUNTIME must be v2 or v4, got ${RUNTIME}`);
const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DIMS = 512;
// The value writers store in clip_embeddings.embedding_model. v2 keeps the bare
// model id every existing row already carries.
const EMBEDDING_MODEL = RUNTIME === 'v2' ? MODEL_ID : `${MODEL_ID}@transformers-4.3.0-q8`;

const { AutoProcessor, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, AutoTokenizer, RawImage } =
  await import(RUNTIME === 'v2' ? '@xenova/transformers' : '@huggingface/transformers');
// A fresh options object per call: v2's from_pretrained MUTATES it
// (model_file_name), so a shared object makes the text model load the vision session.
const quant = () => (RUNTIME === 'v2' ? { quantized: true } : { dtype: 'q8' });

// Request size limit: 10MB (for base64 images)
const MAX_BODY = 10 * 1024 * 1024;

console.log(`Loading CLIP model (runtime ${RUNTIME})...`);
const t = Date.now();

const [visionModel, textModel, processor, tokenizer] = await Promise.all([
  CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, quant()),
  CLIPTextModelWithProjection.from_pretrained(MODEL_ID, quant()),
  AutoProcessor.from_pretrained(MODEL_ID),
  AutoTokenizer.from_pretrained(MODEL_ID),
]);

console.log(`CLIP model loaded in ${((Date.now() - t) / 1000).toFixed(1)}s`);

/**
 * Encode an image (from URL or base64) into a CLIP embedding.
 */
async function embedImage(source) {
  let image;
  if (source.url) {
    // Fetch the bytes ourselves with a proper User-Agent — RawImage.fromURL
    // sends none, and Wikimedia 429s UA-less clients (13 artworks were
    // permanently unembeddable until 2026-06-05 because of this).
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`fetch ${res.status} for ${source.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    image = await RawImage.fromBlob(new Blob([buf], { type: res.headers.get('content-type') || 'image/jpeg' }));
  } else if (source.base64) {
    const buf = Buffer.from(source.base64, 'base64');
    image = await RawImage.fromBlob(new Blob([buf], { type: source.mime_type || 'image/jpeg' }));
  } else {
    throw new Error('Provide url or base64');
  }

  const inputs = await processor(image);
  const { image_embeds } = await visionModel(inputs);

  // Normalize to unit vector
  const raw = Array.from(image_embeds.data);
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? raw.map(v => v / norm) : raw;
}

/**
 * Encode text into a CLIP embedding (same space as images).
 */
async function embedText(text) {
  const inputs = tokenizer(text, { padding: true, truncation: true, max_length: 77 });
  const { text_embeds } = await textModel(inputs);

  const raw = Array.from(text_embeds.data);
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? raw.map(v => v / norm) : raw;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, model: MODEL_ID, dims: DIMS, runtime: RUNTIME, embedding_model: EMBEDDING_MODEL }));
    return;
  }

  if (req.method === 'POST' && req.url === '/embed-image') {
    try {
      const body = await readBody(req);
      const { url, base64, mime_type } = JSON.parse(body);
      const t0 = Date.now();
      const embedding = await embedImage({ url, base64, mime_type });
      const ms = Date.now() - t0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embedding, dims: DIMS, ms }));
    } catch (e) {
      console.error('[clip] embed-image error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/embed-text') {
    try {
      const body = await readBody(req);
      const { text } = JSON.parse(body);
      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }
      const t0 = Date.now();
      const embedding = await embedText(text);
      const ms = Date.now() - t0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embedding, dims: DIMS, ms }));
    } catch (e) {
      console.error('[clip] embed-text error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/embed-images') {
    try {
      const body = await readBody(req);
      const { urls } = JSON.parse(body);
      if (!Array.isArray(urls) || urls.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'urls must be a non-empty array' }));
        return;
      }
      if (urls.length > 50) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'max 50 URLs per batch' }));
        return;
      }

      const t0 = Date.now();
      const results = [];
      for (const url of urls) {
        try {
          const embedding = await embedImage({ url });
          results.push({ url, embedding, error: null });
        } catch (e) {
          results.push({ url, embedding: null, error: e.message });
        }
      }
      const ms = Date.now() - t0;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        results,
        dims: DIMS,
        ms,
        success: results.filter(r => r.embedding).length,
        failed: results.filter(r => !r.embedding).length,
      }));
    } catch (e) {
      console.error('[clip] embed-images error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`CLIP server (${RUNTIME}) listening on port ${PORT}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
