#!/usr/bin/env node
// Dialogue with Plato — local prototype (the wish behind issue #4320).
//
// A frontier model speaks as Plato, GROUNDED in the library's own leaves:
// retrieval over the 22K Platonist page pairs from the training export
// (the dialogues in the Aldine/Clarke/Opera editions, plus Proclus,
// Plotinus, Theon — so "Plato" can tell what he wrote from what his
// successors made of it). Every answer shows the leaves it consulted,
// linking to the real pages. The Socratic mode is in the system prompt:
// he examines the asker as often as he answers.
//
// This is deliberately NOT the tuned flash-lite (a translation reflex, not
// a mind); conversation quality comes from a strong model + grounding.
//
// Prep once: node scripts/eval/plato-dialogue-server.mjs --prepare \
//              --pairs /path/to/pairs-greek.jsonl.gz
// Run:       node --env-file=.env.production.local \
//              scripts/eval/plato-dialogue-server.mjs   → http://localhost:7789
// Needs GEMINI_API_KEY. ~pennies per turn (flash-preview). Local only.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const PORT = 7789;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, 'plato-corpus.json.gz');
const MODEL = 'gemini-3-flash-preview';

// Plato's own words vs his readers — the persona keeps the distinction.
const OWN = /platonis-dialogi|platonis-opera|hapanta-platonos|plato-de-legibus|plato-platon|omnia-platonis|platonos/i;
const CIRCLE = /procli|proclus|plotin|theon-of-smyrna|plethon|diadochus/i;

const readerClean = (t) => t
  .replace(/<(margin|note|insert|footnote|caption|image-desc)>[\s\S]{0,4000}?<\/\1>/gi, '')
  .replace(/<[^<>]{1,60}>/g, '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

async function prepare(pairsPath) {
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(pairsPath).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line);
    const own = OWN.test(r.book_slug);
    if (!own && !CIRCLE.test(r.book_slug)) continue;
    if (r.flags) continue;
    const english = readerClean(r.translation_en);
    if (english.length < 300) continue;
    rows.push({ own, title: (r.title || '').split(/ [:=] /)[0].slice(0, 80), author: r.author, year: r.year, page: r.page_number, url: r.url, english, greek: readerClean(r.source_text).slice(0, 1200) });
  }
  fs.writeFileSync(CORPUS, zlib.gzipSync(JSON.stringify(rows)));
  console.log(`[prepare] ${rows.length} grounded leaves (${rows.filter((r) => r.own).length} of Plato's own) → ${CORPUS}`);
}

// --- tiny BM25 ---------------------------------------------------------------
const tokenize = (s) => (s.toLowerCase().match(/[a-z]{3,}/g) || []);
function buildIndex(rows) {
  const df = new Map(); const docs = [];
  for (const r of rows) {
    const tf = new Map();
    const toks = tokenize(r.title + ' ' + r.english);
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ r, tf, len: toks.length });
  }
  const avg = docs.reduce((a, d) => a + d.len, 0) / docs.length;
  return { search(q, k) {
    const qt = [...new Set(tokenize(q))];
    return docs.map((d) => {
      let s = 0;
      for (const t of qt) {
        const f = d.tf.get(t); if (!f) continue;
        const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
        s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg));
      }
      return { s, r: d.r };
    }).sort((a, b) => b.s - a.s).slice(0, k).filter((x) => x.s > 0).map((x) => x.r);
  } };
}

const PERSONA = `You are Plato of Athens, son of Ariston, speaking across twenty-four centuries with a reader of Source Library — a digital library that holds the very editions of your works excerpted below. Remain Plato throughout: measured, ironic where irony serves, and dialectical. You wrote dialogues because truth is found in examination, not pronouncement — so when the asker's question conceals an unexamined assumption, examine it; ask them what they mean before or instead of answering, as Socrates would. But do not be evasive when a plain answer honors the question.

Ground yourself in the passages provided under CONTEXT. They come from real leaves: your own dialogues (marked PLATO) and the works of your successors — Proclus, Plotinus, Theon (marked LATER). Keep the distinction honest: what you wrote, you may own; what the later Platonists made of it, speak of as their reading, with the affection and distance of an author toward his interpreters. When you draw on a passage, name it in the flow of speech (e.g. "as I have Timaeus say — the leaf is before you"). Quote a short Greek phrase with its English when it earns its place. Cite ONLY leaves given in CONTEXT; if the leaves before you do not speak to the matter, say so plainly rather than invent. Answer in the asker's language. Be substantial but not long-winded: a few paragraphs at most, as in living conversation.`;

async function chat(messages) {
  const key = process.env.GEMINI_API_KEY;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PERSONA }] },
      contents: messages,
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 512 } },
    }),
  });
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? `(error: ${JSON.stringify(j.error || j).slice(0, 300)})`;
}

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dialogue with Plato — Source Library</title>
<style>
  :root { color-scheme: light dark; --accent:#8b5e34; }
  body { font-family: Georgia, serif; max-width: 44rem; margin: 0 auto; padding: 2rem 1.2rem 9rem; }
  h1 { font-size: 1.25rem; margin-bottom: .1rem; } .sub { font-size: .82rem; opacity: .6; margin-bottom: 1.6rem; }
  .turn { margin: 1.1rem 0; line-height: 1.6; white-space: pre-wrap; }
  .you { opacity: .75; } .you b { color: var(--accent); }
  .plato b { color: var(--accent); }
  .leaves { font-size: .75rem; opacity: .65; margin-top: .4rem; line-height: 1.5; }
  .leaves a { color: var(--accent); }
  #bar { position: fixed; bottom: 0; left: 0; right: 0; background: Canvas;
         border-top: 1px solid color-mix(in srgb, CanvasText 15%, transparent); padding: .8rem 1.2rem 1.1rem; }
  #bar .inner { max-width: 44rem; margin: 0 auto; display: flex; gap: .6rem; }
  #q { flex: 1; font: inherit; font-size: 1rem; padding: .55rem .7rem; border-radius: 8px;
       border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: transparent; color: inherit; }
  button { font: inherit; padding: .55rem 1.1rem; border-radius: 8px; border: none; background: var(--accent); color: #fff; cursor: pointer; }
  .thinking { font-style: italic; opacity: .55; }
</style>
<h1>Dialogue with Plato</h1>
<div class="sub">Grounded in the library's own leaves — the Aldine and Clarke editions, Proclus, Plotinus. He may answer your question; he may examine it.</div>
<div id="log"></div>
<div id="bar"><div class="inner"><input id="q" placeholder="Ask him something…" autofocus><button id="go">Speak</button></div></div>
<script>
const log = document.getElementById('log'); const hist = [];
function esc(s){return s.replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function add(cls, who, text){ const d=document.createElement('div'); d.className='turn '+cls; d.innerHTML='<b>'+who+'</b> — '+esc(text); log.appendChild(d); window.scrollTo(0,document.body.scrollHeight); return d; }
async function go(){
  const q=document.getElementById('q').value.trim(); if(!q)return;
  document.getElementById('q').value='';
  add('you','You',q);
  const d=add('plato','Plato',''); d.innerHTML='<b>Plato</b> — <span class="thinking">considers…</span>';
  hist.push({role:'user',parts:[{text:q}]});
  const r=await(await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:hist})})).json();
  hist.push({role:'model',parts:[{text:r.text}]});
  d.innerHTML='<b>Plato</b> — '+esc(r.text);
  if(r.leaves?.length){ const l=document.createElement('div'); l.className='leaves';
    l.innerHTML='leaves consulted: '+r.leaves.map((x)=>'<a target="_blank" href="'+x.url+'">'+esc(x.title)+' · leaf '+x.page+(x.own?'':' ('+esc((x.author||'').split(',')[0])+')')+'</a>').join(' · ');
    d.appendChild(l); }
  window.scrollTo(0,document.body.scrollHeight);
}
document.getElementById('go').onclick=go;
document.getElementById('q').addEventListener('keydown',(e)=>{if(e.key==='Enter')go()});
</script>`;

async function serve() {
  if (!process.env.GEMINI_API_KEY) { console.error('[plato] GEMINI_API_KEY missing — run with --env-file=.env.production.local'); process.exit(1); }
  if (!fs.existsSync(CORPUS)) { console.error(`[plato] ${CORPUS} missing — run --prepare first`); process.exit(1); }
  const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(CORPUS)));
  const index = buildIndex(rows);
  console.log(`[plato] ${rows.length} leaves indexed (${rows.filter((r) => r.own).length} of Plato's own)`);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
      } else if (req.method === 'POST' && req.url === '/chat') {
        let body = '';
        for await (const c of req) body += c;
        const { messages } = JSON.parse(body);
        if (!Array.isArray(messages) || !messages.length) { res.writeHead(400).end('{}'); return; }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.parts?.[0]?.text || '';
        const hits = index.search(lastUser, 8);
        const own = hits.filter((h) => h.own).slice(0, 3);
        const later = hits.filter((h) => !h.own).slice(0, 2);
        const leaves = [...own, ...later];
        const ctx = leaves.map((l) => `[${l.own ? 'PLATO' : 'LATER'}] ${l.title} (${l.author || '?'}, ${l.year || '?'}), leaf ${l.page}:\n${l.english.slice(0, 1500)}`).join('\n\n---\n\n');
        const contents = messages.slice(0, -1).concat([{ role: 'user', parts: [{ text: `CONTEXT — leaves from the library relevant to what follows:\n\n${ctx || '(no leaves matched — say so if the question needs them)'}\n\nTHE READER SAYS:\n${lastUser}` }] }]);
        const text = await chat(contents);
        res.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ text, leaves: leaves.map(({ title, page, url, own, author }) => ({ title, page, url, own, author })) }));
      } else res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e).slice(0, 300) }));
    }
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`dialogue-with-plato → http://localhost:${PORT}`));
}

if (process.argv.includes('--prepare')) {
  await prepare(arg('--pairs', '/Users/dereklomas/sourcelibrary/scripts/output/training-pairs-v1/pairs-greek.jsonl.gz'));
} else {
  await serve();
}
