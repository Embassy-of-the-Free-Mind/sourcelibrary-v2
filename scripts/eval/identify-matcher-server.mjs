#!/usr/bin/env node
/**
 * Bench-only image embedding server for the /identify matcher comparison
 * (#3193 Phase 2). Speaks the same HTTP interface as scripts/workers/clip-server.mjs
 * so identify-bench.mjs can rank the same pool through a different model:
 *
 *   POST /embed-image  { base64, mime_type } | { url }  -> { embeddings: { <variant>: [...] } }
 *   POST /embed-images { urls: [...] }                  -> { results: [{ embeddings }|{ error }] }
 *   GET  /health                                        -> { model, dtype, variants, ms_per_image }
 *
 * Models (MATCHER env):
 *   dinov2   onnx-community/dinov2-small-ONNX — self-supervised, instance-level
 *            features. Two variants from one forward pass: `dinov2_cls` (CLS token)
 *            and `dinov2_gem` (GeM p=3 over patch tokens; the usual choice for
 *            instance retrieval).
 *   siglip2  onnx-community/siglip2-base-patch16-224-ONNX vision tower, pooled
 *            output -> `siglip2`.
 *
 * NOT a production server and not a repo dependency: it needs
 * @huggingface/transformers v4, which the repo does not ship (the repo's CLIP
 * server is pinned to @xenova/transformers v2; moving it is #5099). Install it in
 * a scratch dir on the box and point NODE_PATH at it:
 *
 *   mkdir -p /root/matcher-bench && cd /root/matcher-bench && npm i @huggingface/transformers@4
 *   MATCHER=dinov2 PORT=3461 NODE_PATH=/root/matcher-bench/node_modules \
 *     node scripts/eval/identify-matcher-server.mjs
 *
 * Network: downloads model weights from huggingface.co on first start; fetches
 * pool image URLs it is given. No telemetry. Stop it when the bench is done.
 *
 * PRIOR ART: scripts/workers/clip-server.mjs — production CLIP server; not reused
 * because it is pinned to transformers v2 (no SigLIP2) and serves live traffic.
 */

import http from 'http';
import { createRequire } from 'module';

const MATCHER = process.env.MATCHER || 'dinov2';
const PORT = parseInt(process.env.PORT || '3461');
const DTYPE = process.env.DTYPE || 'fp32';
const THREADS = parseInt(process.env.THREADS || '0') || undefined;
const MAX_BODY = 10 * 1024 * 1024;

// NODE_PATH is not honoured by ESM imports; resolve through createRequire so a
// scratch install outside the repo works.
const req = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH.split(':')[0] + '/' : import.meta.url);
const tf = await import(req.resolve('@huggingface/transformers'));
const { AutoProcessor, AutoModel, SiglipVisionModel, RawImage, env } = tf;
if (THREADS && env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = THREADS;

const MODELS = {
  dinov2: 'onnx-community/dinov2-small-ONNX',
  siglip2: 'onnx-community/siglip2-base-patch16-224-ONNX',
};
const MODEL_ID = MODELS[MATCHER];
if (!MODEL_ID) { console.error(`unknown MATCHER=${MATCHER}; one of ${Object.keys(MODELS).join(', ')}`); process.exit(1); }

const t0 = Date.now();
const sessionOptions = THREADS ? { intraOpNumThreads: THREADS, interOpNumThreads: 1 } : undefined;
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const model = MATCHER === 'siglip2'
  ? await SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: DTYPE, session_options: sessionOptions })
  : await AutoModel.from_pretrained(MODEL_ID, { dtype: DTYPE, session_options: sessionOptions });
console.log(`${MODEL_ID} (${DTYPE}) loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const l2 = v => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Array.from(v, x => x / n); };

let embedded = 0, embedMs = 0;
async function embed(image) {
  const t = Date.now();
  const inputs = await processor(image);
  const out = await model(inputs);
  let embeddings;
  if (MATCHER === 'siglip2') {
    embeddings = { siglip2: l2(out.pooler_output.data) };
  } else {
    // last_hidden_state: [1, 1 + patches, dim]; token 0 is CLS.
    const h = out.last_hidden_state;
    const [, n, d] = h.dims;
    const data = h.data;
    const cls = data.slice(0, d);
    const gem = new Float32Array(d);
    for (let i = 1; i < n; i++) for (let j = 0; j < d; j++) gem[j] += Math.pow(Math.max(data[i * d + j], 1e-6), 3);
    for (let j = 0; j < d; j++) gem[j] = Math.cbrt(gem[j] / (n - 1));
    embeddings = { dinov2_cls: l2(cls), dinov2_gem: l2(gem) };
  }
  embedded++; embedMs += Date.now() - t;
  return embeddings;
}

async function loadImage(source) {
  if (source.url) {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org) identify-bench' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`fetch ${res.status} for ${source.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return RawImage.fromBlob(new Blob([buf], { type: res.headers.get('content-type') || 'image/jpeg' }));
  }
  const buf = Buffer.from(source.base64, 'base64');
  return RawImage.fromBlob(new Blob([buf], { type: source.mime_type || 'image/jpeg' }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')));
    req.on('error', reject);
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { model: MODEL_ID, dtype: DTYPE, threads: THREADS || 'default', embedded, ms_per_image: embedded ? Math.round(embedMs / embedded) : null });
    }
    if (req.method === 'POST' && req.url === '/embed-image') {
      const body = await readBody(req);
      return send(res, 200, { embeddings: await embed(await loadImage(body)) });
    }
    if (req.method === 'POST' && req.url === '/embed-images') {
      const { urls = [] } = await readBody(req);
      const results = [];
      for (const url of urls) {
        try { results.push({ embeddings: await embed(await loadImage({ url })) }); } catch (e) { results.push({ error: e.message.slice(0, 200) }); }
      }
      return send(res, 200, { results });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`${MATCHER} bench server on 127.0.0.1:${PORT}`));
