#!/usr/bin/env node
// PRIOR ART: scripts/eval/experiments/2026-10-02-are-the-facts-translation-notes-add-right-5624.md (#5624) fact-checked
// stored notes without the image and without a second arm; scripts/batch/claude-ocr.mjs claudeCall (the sealed
// `claude -p` with only the Read tool, used here unchanged) is how an Opus reader sees a page image.
/**
 * #5942 Part B (d): are the notes right? One Opus call per page, with the page image, judging every note of arms T
 * and S pooled and shuffled (arm hidden). $0 (subscription). Resumable.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-layer-5942/notes-judge.mjs [--parallel 2]
 *
 * Writes $W/notes/items.json (note id → arm, kept apart from the prompt), $W/notes/out.jsonl, $W/img/<uid>.jpg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { claudeCall } from '../../batch/claude-ocr.mjs';
import { unwrapRead } from '../../lib/agy-cli.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { W, readJsonl, layersOf, COMMENTARY_TYPES } from './arms.mjs';

const PAR = Number(process.argv[process.argv.indexOf('--parallel') + 1] || 2) || 2;
const pages = JSON.parse(fs.readFileSync(`${W}/pages.json`, 'utf8'));
const out = Object.fromEntries(['T', 'S'].map((a) => [a, new Map(readJsonl(`${W}/out/${a}.jsonl`).filter((r) => r.text).map((r) => [r.uid, r]))]));
fs.mkdirSync(`${W}/img`, { recursive: true });
fs.mkdirSync(`${W}/notes`, { recursive: true });

// Page images (read-only Mongo).
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
for (const p of pages) {
  const f = `${W}/img/${p.uid}.jpg`;
  if (fs.existsSync(f)) continue;
  const doc = await c.db('bookstore').collection('pages').findOne({ id: p.page_id }, { projection: { cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1 } });
  const url = doc ? getPageSource(doc) : null;
  if (!url) { console.log('NO IMAGE', p.uid); continue; }
  const r = await fetch(url);
  if (r.ok) fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); else console.log('IMAGE FAIL', p.uid, r.status);
}
await c.close();

const around = (text, s, e) => {
  const a = Math.max(0, text.lastIndexOf('\n', s - 1) + 1, s - 220), b = Math.min(text.length, (text.indexOf('\n', e) + 1 || text.length + 1) - 1, e + 220);
  return `${text.slice(a, s)}⟦${text.slice(s, e)}⟧${text.slice(e, b)}`;
};

const PROMPT = `You are checking the editorial notes a translator added to an English translation of ONE page of a historical book.
The page image is the file ./page.jpg in the current folder: open it with the Read tool and look at it. The OCR
transcription of the page is given below; the image is the authority where they differ.

Each note below is shown with the words it is attached to, marked ⟦like this⟧ inside the translated sentence around
them. Notes come from more than one translation of the page, in random order; judge each on its own.

For each note decide:
 verdict   "right"    — true, and it says something about these words or this page that a reader can rely on;
           "wrong"    — it misreads the page (wrong word, wrong original, wrong reading of the image) or states a fact
                        that is false;
           "invented" — it asserts a quotation, an original-language word, a citation, a name, a date or a fact that
                        has no basis on the page and that you cannot confirm (a plausible-sounding addition);
 attached  true if the note is about the marked words; false if it is right but belongs to other words of the page.
 why       one short line (quote ≤ 12 words of the source or note).
A definition that is correct in general but wrong for this context is "wrong". An "original:" note must match the
source's words (allow OCR spelling variants). An image description must match the image.

Output ONE JSON object, {"verdicts": {"N1": {"verdict": "...", "attached": true, "why": "..."}, ...}}, covering every
note id, between two marker lines, <<<BEGIN>>> and <<<END>>>. Nothing outside the markers. Do not write any file.
`;

const rng = makeRng(5942 + 13);
const items = {};
const todo = [];
for (const p of pages) {
  if (!out.T.has(p.uid) || !out.S.has(p.uid)) continue;
  const notes = [];
  for (const arm of ['T', 'S']) {
    const L = layersOf(arm, out[arm].get(p.uid).text);
    const text = arm === 'S' ? L.text : L.body;
    for (const a of L.annotations) {
      if (a.kind !== 'commentary' || a.malformed || !COMMENTARY_TYPES.has(a.type)) continue;
      const s = a.anchor?.start, e = a.anchor?.end;
      const ctx = s != null && e != null ? around(text, s, e) : '(attached to no words of the text)';
      notes.push({ arm, type: a.type, body: a.body, exact: a.anchor?.exact ?? '', resolved: arm === 'S' ? !!a.resolved : true, ctx });
    }
  }
  for (let i = notes.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [notes[i], notes[j]] = [notes[j], notes[i]]; }
  notes.forEach((n, i) => { n.id = `N${i + 1}`; });
  items[p.uid] = notes;
  if (!notes.length || !fs.existsSync(`${W}/img/${p.uid}.jpg`)) continue;
  const list = notes.map((n) => `${n.id} [${n.type}] note: ${n.body}\n   attached to: ${n.ctx}`).join('\n\n');
  todo.push({ uid: p.uid, prompt: `${PROMPT}\nOCR TRANSCRIPTION:\n${p.ocr}\n\nNOTES:\n${list}\n` });
}
fs.writeFileSync(`${W}/notes/items.json`, JSON.stringify(items, null, 1));
const OUT = `${W}/notes/out.jsonl`;
const done = new Set(readJsonl(OUT).filter((r) => r.verdicts).map((r) => r.uid));
const queue = todo.filter((t) => !done.has(t.uid));
console.log(`${todo.length} pages with notes, ${done.size} done, ${queue.length} to run`);
async function run(t) {
  const ws = fs.mkdtempSync(path.join(process.env.JOB_SCRATCH, 'nj-'));
  fs.copyFileSync(`${W}/img/${t.uid}.jpg`, path.join(ws, 'page.jpg'));
  const r = await claudeCall(t.prompt, 'opus', ws);
  fs.rmSync(ws, { recursive: true, force: true });
  if (r.cls === 'usage_limit') { console.error('usage limit: stopping'); queue.length = 0; return; }
  const { text } = unwrapRead(r.text);
  let verdicts = null;
  try { verdicts = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')).verdicts; } catch { /* left null */ }
  fs.appendFileSync(OUT, JSON.stringify({ uid: t.uid, verdicts, raw: verdicts ? undefined : r.text, problem: r.cls, usage: r.usage, secs: r.secs }) + '\n');
  console.log(`  ${t.uid} ${verdicts ? Object.keys(verdicts).length + ' verdicts' : 'NO PARSE ' + (r.cls || '')} ${Math.round(r.secs)}s`);
}
await Promise.all(Array.from({ length: PAR }, async () => { while (queue.length) await run(queue.shift()); }));
