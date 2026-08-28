#!/usr/bin/env node
// Local side-by-side demo for the tuned Greek translator (issue #4320).
// Serves one page: paste Greek → see the TUNED gemini-2.5-flash-lite
// (sl-greek-translator-v1) next to the BASE model, same prompt as training.
//
// Auth: shells out to `gcloud auth print-access-token` (cached ~45 min).
// The tuned endpoint is resolved from the tuning job at startup and re-checked
// on /status until the job completes. Local only — binds 127.0.0.1.
//
// Run: node scripts/eval/gloss-demo-server.mjs   → http://localhost:7788

import http from 'node:http';
import { execFileSync } from 'node:child_process';

const PORT = 7788;
const PROJECT_NUM = '877864597985';
const LOC = 'us-central1';
const JOB = `projects/${PROJECT_NUM}/locations/${LOC}/tuningJobs/3119880882517704704`;
const BASE_MODEL = `projects/${PROJECT_NUM}/locations/${LOC}/publishers/google/models/gemini-2.5-flash-lite`;
const API = `https://${LOC}-aiplatform.googleapis.com/v1`;
const SYSTEM = 'You are a translator for Source Library, a digital library of historical primary sources. Translate the given text into clear, accurate English, preserving the structure, register, and meaning of the original.';

let tokenCache = { value: null, at: 0 };
function token() {
  if (!tokenCache.value || Date.now() - tokenCache.at > 45 * 60 * 1000) {
    tokenCache = { value: execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim(), at: Date.now() };
  }
  return tokenCache.value;
}

let tuned = { state: 'UNKNOWN', endpoint: null, model: null };
async function refreshTuned() {
  const r = await fetch(`${API}/${JOB}`, { headers: { Authorization: `Bearer ${token()}` } });
  const j = await r.json();
  tuned = {
    state: j.state || 'UNKNOWN',
    endpoint: j.tunedModel?.endpoint || null,
    model: j.tunedModel?.model || null,
    billableTokens: j.tuningDataStats?.supervisedTuningDataStats?.totalBillableTokenCount || null,
  };
  return tuned;
}

async function generate(target, text) {
  const body = {
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `Translate this Ancient Greek text into English:\n\n${text}` }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  };
  const t0 = Date.now();
  const r = await fetch(`${API}/${target}:generateContent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const out = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? JSON.stringify(j.error || j).slice(0, 500);
  return { text: out, ms: Date.now() - t0 };
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>SL Greek Translator — tuned vs base</title>
<style>
  :root { color-scheme: light dark; font-family: Georgia, serif; }
  body { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.2rem; } .tag { font-family: monospace; font-size: .8rem; opacity: .7; }
  textarea { width: 100%; min-height: 140px; font-size: 1.05rem; padding: .6rem; }
  button { font-size: 1rem; padding: .45rem 1.2rem; margin: .6rem 0; cursor: pointer; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .pane { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 8px; padding: .8rem; white-space: pre-wrap; min-height: 8rem; }
  .pane h2 { margin: 0 0 .5rem; font-size: .95rem; } .ms { opacity: .6; font-size: .8rem; }
  #status { font-size: .85rem; opacity: .8; }
</style>
<h1>Source Library Greek translator <span class="tag">sl-greek-translator-v1 vs gemini-2.5-flash-lite</span></h1>
<p id="status">checking tuned model…</p>
<textarea id="src" placeholder="Paste Ancient Greek here…"></textarea><br>
<button id="go">Translate</button>
<div class="cols">
  <div class="pane"><h2>Tuned (trained on 15,332 Source Library pairs) <span class="ms" id="tms"></span></h2><div id="tuned"></div></div>
  <div class="pane"><h2>Base flash-lite <span class="ms" id="bms"></span></h2><div id="base"></div></div>
</div>
<script>
async function status(){const s=await(await fetch('/status')).json();document.getElementById('status').textContent=s.endpoint?('tuned model LIVE — billable training tokens: '+(s.billableTokens||'?')):('tuning job: '+s.state+' — tuned pane will use the base model until it completes');}
status();
document.getElementById('go').onclick=async()=>{
  const text=document.getElementById('src').value.trim(); if(!text)return;
  for(const id of ['tuned','base'])document.getElementById(id).textContent='…';
  const r=await(await fetch('/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})})).json();
  document.getElementById('tuned').textContent=r.tuned.text; document.getElementById('tms').textContent=r.tuned.ms+'ms';
  document.getElementById('base').textContent=r.base.text; document.getElementById('bms').textContent=r.base.ms+'ms';
};
</script>`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
    } else if (req.method === 'GET' && req.url === '/status') {
      if (!tuned.endpoint) await refreshTuned();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(tuned));
    } else if (req.method === 'POST' && req.url === '/translate') {
      let body = '';
      for await (const c of req) body += c;
      const { text } = JSON.parse(body);
      if (!tuned.endpoint) await refreshTuned();
      const tunedTarget = tuned.endpoint || BASE_MODEL;
      const [t, b] = await Promise.all([generate(tunedTarget, text), generate(BASE_MODEL, text)]);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ tuned: t, base: b, tunedIsBase: !tuned.endpoint }));
    } else {
      res.writeHead(404).end();
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e).slice(0, 300) }));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`gloss demo → http://localhost:${PORT}`));
