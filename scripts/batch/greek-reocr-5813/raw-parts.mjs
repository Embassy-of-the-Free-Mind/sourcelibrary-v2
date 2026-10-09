#!/usr/bin/env node
// PRIOR ART: scripts/workers/batch-collector.mjs extractResults() downloads the same result files
// but keeps only candidates[0].content.parts[0].text and discards the rest; nothing in the repo
// reads a finished job's raw responses back to audit what the collector wrote.
//
// #5813 — audit the raw Gemini Batch responses of this job's OCR jobs. Gemini sometimes returns one
// page's text in SEVERAL parts; the collectors store parts[0] only, so such a page is written cut
// off. For every response this records the number of text parts, the length of the first and of
// all of them joined, the finish reason and the usage — one JSONL row per page. It calls no model
// and writes nothing to Mongo. Result files are kept by Gemini for about two days.
//   node --env-file=… scripts/batch/greek-reocr-5813/raw-parts.mjs --out=raw-parts.jsonl [--reason=REGEX] [--keep-text=DIR]
// usage-ok: reads batch job status and downloads finished result files; it generates nothing, so
// there is no spend here to record (the batch's own spend is closed by the collector, #3452).
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const reason = new RegExp(arg('reason') || '#5813');
const KEEP = arg('keep-text');
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const keys = [...new Set([process.env.GEMINI_API_KEY_TIER3, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY].filter(Boolean))];
const done = new Set(fs.existsSync(arg('out')) ? fs.readFileSync(arg('out'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).job_id) : []);
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const jobs = await c.db('bookstore').collection('batch_jobs').find(
  { submitted_by: 'scripts/batch/bulk-reocr-local.mjs', initiated_reason: reason, type: 'ocr', job_name: { $exists: true }, results_collected: true },
  { projection: { _id: 0, id: 1, job_name: 1, book_id: 1, page_ids: 1, cost_usd: 1 } },
).toArray();
await c.close();
const out = fs.createWriteStream(arg('out'), { flags: 'a' });
const tally = { jobs: 0, pages: 0, multipart: 0, gone: 0 };
async function responsesOf(job) {
  for (const k of keys) {
    const r = await fetch(`${BASE}/${job.job_name}?key=${k}`);
    if (!r.ok) continue;
    const d = await r.json();
    const file = d.response?.responsesFile;
    if (file) {
      const f = await fetch(`${BASE}/${file}:download?alt=media&key=${k}`);
      if (!f.ok) return null;
      return (await f.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    }
    const inline = d.response?.inlinedResponses?.inlinedResponses || d.response?.inlinedResponses;
    return Array.isArray(inline) ? inline : null;
  }
  return null;
}
for (const job of jobs) {
  if (done.has(job.id)) continue;
  const rows = await responsesOf(job).catch(() => null);
  if (!rows) { tally.gone++; out.write(JSON.stringify({ job_id: job.id, gone: true }) + '\n'); continue; }
  tally.jobs++;
  rows.forEach((r, i) => {
    const cand = r.response?.candidates?.[0];
    const texts = (cand?.content?.parts || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text);
    const u = r.response?.usageMetadata || {};
    const page_id = r.metadata?.key || (job.page_ids.length === rows.length ? null : null);
    const row = { job_id: job.id, book_id: job.book_id, page_id, idx: i, costed: job.cost_usd != null, finish: cand?.finishReason ?? (r.error ? 'error' : 'none'), text_parts: texts.length, first_len: texts[0]?.length ?? 0, joined_len: texts.join('').length, in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
    tally.pages++; if (texts.length > 1) { tally.multipart++; if (KEEP && page_id) fs.writeFileSync(`${KEEP}/${page_id}.txt`, texts.join('')); }
    out.write(JSON.stringify(row) + '\n');
  });
}
await new Promise((r) => out.end(r));
console.log(JSON.stringify(tally));
