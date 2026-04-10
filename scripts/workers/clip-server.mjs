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
 */

import http from 'http';
import { AutoProcessor, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, AutoTokenizer, RawImage } from '@xenova/transformers';

const PORT = parseInt(process.env.CLIP_PORT || '3457');
const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DIMS = 512;

// Request size limit: 10MB (for base64 images)
const MAX_BODY = 10 * 1024 * 1024;

console.log('Loading CLIP model...');
const t = Date.now();

const [visionModel, textModel, processor, tokenizer] = await Promise.all([
  CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: true }),
  CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true }),
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
    image = await RawImage.fromURL(source.url);
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
    res.end(JSON.stringify({ ok: true, model: MODEL_ID, dims: DIMS }));
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
  console.log(`CLIP server listening on port ${PORT}`);
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
