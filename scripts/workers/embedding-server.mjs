#!/usr/bin/env node
/**
 * Local embedding server for semantic search.
 *
 * Runs on Hetzner, serves embeddings via HTTP. Used by:
 *   - embed-translations.mjs (backfill, local calls)
 *   - /api/search/semantic (Vercel, remote calls to Hetzner)
 *
 * Model: multilingual-e5-base (768 dims, ONNX quantized)
 * Cost: $0 (runs locally on Hetzner CPU)
 *
 * Start: node scripts/workers/embedding-server.mjs
 * Health: GET /health
 * Embed:  POST /embed { texts: ["hello world"], task: "query"|"passage" }
 *
 * Port: 3456 (or EMBED_PORT env var)
 */

import http from 'http';
import { pipeline } from '@xenova/transformers';

const PORT = parseInt(process.env.EMBED_PORT || '3456');
const MODEL = 'Xenova/multilingual-e5-base';

console.log('Loading model...');
const t = Date.now();
const embedder = await pipeline('feature-extraction', MODEL, { quantized: true });
console.log(`Model loaded in ${((Date.now() - t) / 1000).toFixed(1)}s`);

const server = http.createServer(async (req, res) => {
  // CORS for Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, model: MODEL, dims: 768 }));
    return;
  }

  if (req.method === 'POST' && req.url === '/embed') {
    try {
      const body = await readBody(req);
      const { texts, task = 'passage' } = JSON.parse(body);

      if (!Array.isArray(texts) || texts.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'texts must be a non-empty array' }));
        return;
      }

      // e5 models expect "query: " or "passage: " prefix
      const prefix = task === 'query' ? 'query: ' : 'passage: ';
      const embeddings = [];
      for (const text of texts) {
        const input = `${prefix}${text.slice(0, 2000)}`;
        const output = await embedder(input, { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(output.data));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embeddings, model: MODEL, dims: 768 }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Embedding server listening on port ${PORT}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
