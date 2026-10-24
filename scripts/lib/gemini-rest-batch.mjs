/**
 * PRIOR ART: scripts/eval/ocr-v18-ab.mjs stageSubmit / stagePoll — the REST Batch
 * upload → create → collect → logUsage sequence this file lifts. Not importable as
 * is: stageSubmit hardcodes the lite OCR model and an arm/estimate layout, and
 * stagePoll parses `arm:uid:k` keys into reads.jsonl. The pipeline's own batch path
 * (pipeline-orchestrator.mjs, batch-collector.mjs) is OCR/translation-shaped and
 * writes to `pages`. This is the generic version for a script that has N image
 * prompts and wants N text replies back in a local file, at Batch price.
 *
 * Gemini Batch API over REST, for small scripts (#5849 plate captions/ornaments).
 *
 *   const job = await submitBatch({ model, name, lines, issue, note });
 *   const res = await collectBatch(job, { endpoint, bookId });   // null while pending
 *
 * `lines` are `{ key, request }` with `request` a generateContent body
 * ({ contents, generationConfig }). Every submitted job is registered in
 * `batch_jobs` as `external_eval`: an unregistered hand-submitted Batch is an
 * orphan and the sweeper cancels it (#5771). Collection logs one `gemini_usage`
 * row per job at the Batch rate.
 */
import { withMongo } from './mongo.mjs';
import { createThenDeleteInput } from './gemini-batch-input-file.mjs';
import { priceFor, BATCH_MULTIPLIER, acceptsZeroThinking } from './model-pricing.mjs';

const API = 'https://generativelanguage.googleapis.com';

function batchKey() {
  const env = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
  const key = process.env[env];
  if (!key) throw new Error('gemini-rest-batch: no GEMINI_API_KEY_TIER3 or GEMINI_API_KEY');
  return { env, key };
}

/** A generateContent body with the same defaults as callGemini (thinking off unless asked). */
export function buildRequest({ model, prompt, images = [], temperature = 0, maxOutputTokens = 8000, responseMimeType }) {
  const generationConfig = { temperature, maxOutputTokens, ...(responseMimeType ? { responseMimeType } : {}) };
  if (acceptsZeroThinking(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const parts = [{ text: prompt }, ...images.map(b => ({ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } }))];
  return { contents: [{ parts }], generationConfig };
}

/** Upload the requests, create the Batch job, register it. Returns the job record to keep. */
export async function submitBatch({ model, name, lines, issue, note }) {
  if (!lines.length) throw new Error('gemini-rest-batch: nothing to submit');
  const { env, key } = batchKey();
  const body = Buffer.from(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(body.length), 'X-Goog-Upload-Header-Content-Type': 'text/plain' },
    body: JSON.stringify({ file: { displayName: name } }),
  });
  if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
  const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body });
  if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
  const fileName = (await up.json()).file?.name;
  if (!fileName) throw new Error('upload response missing file.name');
  for (let i = 0; i < 30; i++) {
    const st = await (await fetch(`${API}/v1beta/${fileName}?key=${key}`)).json();
    if (st.state === 'ACTIVE') break;
    if (st.state === 'FAILED') throw new Error(`file ${fileName} FAILED`);
    await new Promise(r => setTimeout(r, 2000));
  }
  // thinking-ok: every line is built by buildRequest, which sets thinkingBudget 0 where the model accepts it; usage is logged in collectBatch
  const job = await createThenDeleteInput({ fileName, apiKey: key, create: async () => {
    const res = await fetch(`${API}/v1beta/models/${model}:batchGenerateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: { display_name: name, input_config: { file_name: fileName } } }),
    });
    if (!res.ok) throw new Error(`batch create ${res.status} ${(await res.text()).slice(0, 500)}`);
    return res.json();
  } });
  const rec = { job_name: job.name, model, key_env: env, requests: lines.length, bytes: body.length, submitted_at: new Date().toISOString() };
  await withMongo(db => db.collection('batch_jobs').updateOne({ gemini_job_name: job.name }, { $setOnInsert: {
    id: name, job_name: job.name, gemini_job_name: job.name, status: 'external_eval', type: 'eval', model,
    page_count: lines.length, created_at: new Date(), updated_at: new Date(), issue, note,
  } }, { upsert: true }));
  return rec;
}

/**
 * Poll one job. Returns null while it runs; otherwise
 * { state, rows: [{ key, outcome, text, finish }], cost_usd, in_tokens, out_tokens }.
 * A failed/cancelled/expired job returns its state with no rows.
 */
export async function collectBatch(job, { endpoint, bookId, type = 'image_extraction' } = {}) {
  const key = process.env[job.key_env];
  if (!key) throw new Error(`gemini-rest-batch: ${job.key_env} not set`);
  const data = await (await fetch(`${API}/v1beta/${job.job_name}?key=${key}`)).json();
  const state = data.metadata?.state || data.state;
  if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) return { state, rows: [], cost_usd: 0 };
  const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
  if (!rf) return null;
  const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
  let inTok = 0, outTok = 0;
  const rows = [];
  for (const line of text.split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    const u = r.response?.usageMetadata || {};
    inTok += u.promptTokenCount || 0;
    outTok += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    const cand = r.response?.candidates?.[0];
    const out = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    const finish = cand?.finishReason || null;
    const outcome = r.error || !r.response ? 'error' : !out.trim() ? 'empty' : finish === 'MAX_TOKENS' ? 'truncated' : 'text';
    rows.push({ key: r.key || r.metadata?.key, outcome, text: out, finish, ...(r.error ? { error: JSON.stringify(r.error).slice(0, 300) } : {}) });
  }
  const p = priceFor(job.model);
  const cost = BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
  try {
    const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
    await logUsage({ type, mode: 'batch', model: job.model, book_id: bookId, page_count: rows.length, input_tokens: inTok, output_tokens: outTok, batch_job_id: job.job_name, endpoint, triggered_by: 'manual' });
  } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
  return { state, rows, cost_usd: cost, in_tokens: inTok, out_tokens: outTok };
}
