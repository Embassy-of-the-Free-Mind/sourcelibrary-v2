#!/usr/bin/env node
// PRIOR ART: scripts/eval/notes-layer-5942/notes-judge.mjs — the sealed Opus `claude -p` reader with the page image
// (claudeCall from scripts/batch/claude-ocr.mjs, getPageSource from page-image-url.mjs), used here unchanged. That one
// asks whether a NOTE is right; this one asks where each tagged or bracketed SPAN comes from — printed on the page, or
// the model's — so the notes-layer parser's split can be scored for leaks (model words left in the text) and losses
// (printed words removed from it). agy-cli.mjs gatedImageCall is the second, independent reader.
/**
 * #5942 legacy syntaxes — the image-grounded spot check (Derek's inbox note of 2026-10-29). Subscription quota only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-legacy-5942/spot-judge.mjs \
 *     --in $JOB_SCRATCH/draw.jsonl.gz --in $JOB_SCRATCH/topup-*.jsonl.gz --work $JOB_SCRATCH/spot \
 *     [--per 8] [--parallel 3] [--second 30]
 *
 * Writes <work>/pages.json (the draw), <work>/img/<page>.jpg, <work>/opus.jsonl, <work>/agy.jsonl. Resumable.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { claudeCall } from '../../batch/claude-ocr.mjs';
import { gatedImageCall, unwrapRead } from '../../lib/agy-cli.mjs';
import { splitAnnotations } from '../../lib/annotation-layer.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { versionOf } from './syntaxes.mjs';

const args = process.argv.slice(2);
const all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const opt = (k, d) => all(k)[0] ?? d;
const W = opt('--work');
const PER = Number(opt('--per', 8));
const PAR = Number(opt('--parallel', 3));
const SECOND = Number(opt('--second', 30));
fs.mkdirSync(`${W}/img`, { recursive: true });

/** The spans of one syntax on a page, from the parser's own split. kept: the words stay in `text`. */
export const SPOT = {
  '<note>': (a) => a.tag === 'note' && !a.malformed,
  '<image-desc>': (a) => a.tag === 'image-desc' && !a.malformed,
  '<margin>': (a) => a.kind === 'mark' && a.type === 'margin' && !a.tag && !a.malformed,
  '<gloss> (printed)': (a) => a.kind === 'mark' && a.type === 'gloss' && !a.tag && !a.malformed,
  '<gloss> after <term> (definition)': (a) => a.type === 'definition' && a.tag === 'gloss',
  '<insert>': (a) => a.kind === 'mark' && a.type === 'insert' && !a.tag && !a.malformed,
  '<unclear>': (a) => a.kind === 'mark' && a.type === 'unclear' && !a.tag && !a.malformed,
  '<term>': (a) => a.kind === 'mark' && a.type === 'term' && !a.tag && !a.malformed,
  '[[notes:]]': (a) => a.tag === '[[notes]]' || a.tag === '[[note]]',
  '[[margin:]] / [[gloss:]] / [[term:]]': (a) => a.kind === 'mark' && a.tag?.startsWith('[['),
  '[[image:]]': (a) => a.tag === '[[image]]',
  '[[page blocks]] (meta, summary, vocabulary, page number…)': (a) => a.kind === 'page' && a.tag?.startsWith('[['),
  'bracketed image paragraph': (a) => a.tag === '[image]',
  '[interpolation]': (a) => a.type === 'interp',
  'plain Summary: line': (a) => a.tag === 'Summary:',
};
const PER_SYNTAX = { '[interpolation]': PER * 2 };

const spanWords = (text, a) => (a.kind === 'mark' ? text.slice(a.anchor.start, a.anchor.end) : a.body ?? '');
const around = (text, s, e) => `${text.slice(Math.max(0, s - 160), s)}⟦${text.slice(s, e)}⟧${text.slice(e, e + 160)}`;

// ---------- draw ----------
let pages;
if (fs.existsSync(`${W}/pages.json`)) pages = JSON.parse(fs.readFileSync(`${W}/pages.json`, 'utf8'));
else {
  const rows = [];
  for (const f of all('--in')) for (const l of zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n')) if (l.trim()) rows.push(JSON.parse(l));
  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rng = makeRng(5942);
  const usedBooks = new Set();
  pages = [];
  const present = new Map();
  for (const r of byId.values()) {
    const anns = splitAnnotations(r.data).annotations.filter((a) => a.kind !== 'mark' || a.anchor);
    present.set(r.id, new Set(Object.entries(SPOT).filter(([, test]) => anns.some(test)).map(([k]) => k)));
  }
  for (const [syntax] of Object.entries(SPOT)) {
    // Pages with the syntax, grouped by prompt version; round-robin over versions; one page per book overall.
    const groups = new Map();
    for (const r of byId.values()) {
      if (!present.get(r.id).has(syntax)) continue;
      const v = versionOf(r);
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(r);
    }
    for (const g of groups.values()) for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; }
    const vs = [...groups.keys()].sort();
    const want = PER_SYNTAX[syntax] ?? PER;
    let got = 0;
    for (let round = 0; got < want && vs.some((v) => groups.get(v).length); round++) {
      for (const v of vs) {
        if (got >= want) break;
        const g = groups.get(v);
        while (g.length && usedBooks.has(g[0].book_id)) g.shift();
        const r = g.shift();
        if (!r) continue;
        usedBooks.add(r.book_id);
        pages.push({ syntax, id: r.id, book_id: r.book_id, page_number: r.page_number, version: v, data: r.data });
        got++;
      }
    }
    console.log(`${syntax}: ${got} pages over ${vs.length} versions`);
  }
  fs.writeFileSync(`${W}/pages.json`, JSON.stringify(pages, null, 1));
}

// ---------- images + OCR (read-only Mongo) ----------
const c = new MongoClient(process.env.MONGODB_URI, { appName: 'notes-legacy-5942-spot' });
await c.connect();
const db = c.db('bookstore');
const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } }).project({ _id: 0, id: 1, slug: 1, title: 1, language: 1 }).toArray()).map((b) => [b.id, b]));
for (const p of pages) {
  const doc = await db.collection('pages').findOne({ id: p.id }, { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1 } });
  p.ocr = doc?.ocr?.data ?? '';
  p.current = doc?.translation?.data === p.data;
  const b = books.get(p.book_id);
  p.book = b ? { slug: b.slug, title: b.title, language: b.language } : null;
  const f = `${W}/img/${p.id}.jpg`;
  if (fs.existsSync(f)) continue;
  const url = doc ? getPageSource(doc) : null;
  if (!url) { console.log('NO IMAGE', p.id); continue; }
  const r = await fetch(url);
  if (r.ok) fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); else console.log('IMAGE FAIL', p.id, r.status);
}
await c.close();
fs.writeFileSync(`${W}/pages.json`, JSON.stringify(pages, null, 1));

// ---------- the reader ----------
const PROMPT = `You are checking how a machine split ONE page of an English translation of a historical book into the
book's own words and the translator's (a language model's) commentary. The page image is ./page.jpg in the current
folder: open it with the Read tool and look at it closely. The OCR transcription of the page (in the original language)
is given below; the image is the authority where they differ.

Below are numbered SPANS taken from the translation, each shown in its sentence with the span marked ⟦like this⟧ (for a
span the machine REMOVED from the text, the removed words are given as REMOVED TEXT «…»: judge THOSE words, not the
sentence they stood in). For each span decide where its words come from:
  "printed"  the words are on the page: the book's own text in translation, including brackets PRINTED in the
             source (an editor's [ ] in the printed edition), printed marginal notes, printed glosses, printed captions;
  "model"    the translator/model added it: a supplied word, a gloss or definition, an explanation, an image
             description, a label, a page summary, a placeholder ("blank", "illegible") that is not on the page;
  "mixed"    part printed, part added (say which in why);
  "unclear"  you cannot tell from the image.
For bracketed spans say whether the BRACKETS themselves are printed on the page ("brackets_printed": true/false/null).
Also give one page-level verdict: does the translation correspond to THIS page image ("leaf": "yes" | "partly" | "no"),
e.g. "no" if it translates a different page or invents text that is not on the leaf.

Output ONE JSON object between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside the markers:
{"leaf": "yes", "leaf_why": "…", "spans": {"S1": {"origin": "printed", "brackets_printed": null, "why": "≤ 15 words"}, …}}
Cover every span id. Do not write any file.
`;

function spansOf(p) {
  const split = splitAnnotations(p.data);
  const test = SPOT[p.syntax];
  const rng = makeRng(5942 + p.page_number);
  let list = split.annotations.filter((a) => test(a) && (a.kind !== 'mark' || a.anchor));
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  list = list.slice(0, 12);
  return list.map((a, i) => {
    const kept = a.kind === 'mark';
    // A removed span is judged on its REMOVED words; the sentence it hung on is context only (a first pass that showed
    // the anchor marked ⟦…⟧ had the reader judge the anchor, which is printed, instead of the note).
    const ctx = kept ? around(split.text, a.anchor.start, a.anchor.end) : a.anchor ? `REMOVED TEXT: «${a.body}»\n      (it stood after: …${split.text.slice(Math.max(0, a.anchor.end - 120), a.anchor.end)}…)` : `REMOVED TEXT (page-level): «${a.body}»`;
    return { id: `S${i + 1}`, type: a.type, tag: a.tag ?? null, kept, words: spanWords(split.text, a), ctx };
  });
}
const cap = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…[${s.length - n} more characters]` : s);
const promptFor = (p, spans, imageName = './page.jpg') => `${PROMPT.replace('./page.jpg', imageName)}
OCR TRANSCRIPTION:
${cap(p.ocr || '(none stored)', 6000)}

TRANSLATION AS STORED (raw markup):
${cap(p.data, 6000)}

SPANS:
${spans.map((s) => `${s.id} [${s.tag ?? s.type}] ${s.ctx}`).join('\n\n')}
`;
const parse = (text) => {
  const t = unwrapRead(text).text;
  const m = t.match(/<<<BEGIN>>>([\s\S]*?)<<<END>>>/);
  const body = (m ? m[1] : t).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(body); } catch { const j = body.match(/\{[\s\S]*\}/); try { return j ? JSON.parse(j[0]) : null; } catch { return null; } }
};
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const REMOVED_ONLY = args.includes('--removed-only');
const OPUS = REMOVED_ONLY ? `${W}/opus-removed.jsonl` : `${W}/opus.jsonl`;
const doneOpus = new Set(readJsonl(OPUS).filter((r) => r.verdict).map((r) => r.id));
const queue = pages.filter((p) => !doneOpus.has(p.id) && fs.existsSync(`${W}/img/${p.id}.jpg`) && (!REMOVED_ONLY || spansOf(p).some((x) => !x.kept)));
console.log(`${pages.length} pages, ${doneOpus.size} judged, ${queue.length} to run`);
let stop = false;
async function runOpus(p) {
  const spans = spansOf(p);
  const ws = fs.mkdtempSync(path.join(process.env.JOB_SCRATCH || '/tmp', 'spot-'));
  fs.copyFileSync(`${W}/img/${p.id}.jpg`, path.join(ws, 'page.jpg'));
  const r = await claudeCall(promptFor(p, spans), 'opus', ws);
  fs.rmSync(ws, { recursive: true, force: true });
  if (r.cls === 'usage_limit') { console.error('usage limit: stopping'); stop = true; return; }
  const verdict = parse(r.text);
  fs.appendFileSync(OPUS, JSON.stringify({ id: p.id, syntax: p.syntax, spans, verdict, raw: verdict ? undefined : r.text, problem: r.cls, usage: r.usage, secs: r.secs }) + '\n');
  console.log(`  opus ${p.syntax} ${p.id} ${verdict ? 'ok' : 'NO PARSE ' + (r.cls || '')} ${Math.round(r.secs)}s`);
}
await Promise.all(Array.from({ length: PAR }, async () => { while (queue.length && !stop) await runOpus(queue.shift()); }));

// ---------- the second reader on SECOND pages ----------
const AGY = `${W}/agy.jsonl`;
const doneAgy = new Set(readJsonl(AGY).filter((r) => r.verdict).map((r) => r.id));
const rng2 = makeRng(5942 + 2);
const judged = pages.filter((p) => fs.existsSync(`${W}/img/${p.id}.jpg`));
for (let i = judged.length - 1; i > 0; i--) { const j = Math.floor(rng2() * (i + 1)); [judged[i], judged[j]] = [judged[j], judged[i]]; }
for (const p of REMOVED_ONLY ? [] : judged.slice(0, SECOND)) {
  if (doneAgy.has(p.id) || stop) continue;
  const spans = spansOf(p);
  const r = await gatedImageCall((name) => promptFor(p, spans, `./${name}`).replace('open it with the Read tool', 'open it with read_file'), fs.readFileSync(`${W}/img/${p.id}.jpg`), { model: 'gemini-3.8-flash-low', tmp: process.env.JOB_SCRATCH });
  const verdict = parse(r.text || '');
  fs.appendFileSync(AGY, JSON.stringify({ id: p.id, syntax: p.syntax, verdict, raw: verdict ? undefined : String(r.text || '').slice(0, 2000), problem: r.cls ?? null }) + '\n');
  console.log(`  agy ${p.syntax} ${p.id} ${verdict ? 'ok' : 'NO PARSE ' + (r.cls || '')}`);
  if (r.cls === 'quota') break;
}
