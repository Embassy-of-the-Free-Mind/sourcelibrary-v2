#!/usr/bin/env node
// PRIOR ART: scripts/eval/notes-layer-5942/notes-judge.mjs (#5942 Part B: one Opus call per page with the image, every
// note of both arms pooled with the arm hidden, verdict right / wrong / invented + attached) — the item shape and the
// verdict words are kept; the claim classes are widened to #5647's (wrong / partly-wrong / correct / unverifiable) plus
// "unsupported" and a separate "restates" flag, which #7965 measures. route-judge-6740/judge.mjs opusCall (Opus, image
// in the workspace, Read only, API keys stripped) and lane-judge-sampler.mjs claudeMeter/paceBlock are imported.
/**
 * #7965 step 3, the judge. Blind: each item is one page; its note lists (arm a = v21 inline, a2 = v21 again on the floor
 * pages, b = the notes step) are shuffled under letters, the key kept apart. Nothing here writes to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-step-7965/judge.mjs items --engine flash38|lite
 *   ... judge.mjs images --engine E
 *   ... judge.mjs run --engine E [--parallel 2] [--limit N]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { opusCall } from '../route-judge-6740/judge.mjs';
import { claudeMeter, paceBlock } from '../lane-judge-sampler.mjs';
import { unwrapRead } from '../../lib/agy-cli.mjs';
import { splitAnnotations } from '../../lib/annotation-layer.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { parseNotes, inlineNotes, md5 } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = process.env.BENCH7499 || `${process.env.JOB_SCRATCH}/bench7499`;
const W = process.env.NOTES_W || `${process.env.JOB_SCRATCH}/w`;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ENGINE = arg('engine');
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '../bench-translation/manifest.json'), 'utf8'));
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const SEED = 7965;
export const PLANTS_PER_ENGINE = 20;
export const LITE_EXTRA = 68;   // lite judged pages = the #6545 132 + 68 drawn from the other 233 (seed 7965)

export const JUDGE_PROMPT = `You are checking the editorial notes attached to an English translation of ONE page of a historical book.
The page image is the file ./page.jpg in the current folder: open it with the Read tool and look at it. The page's
transcription (OCR) is given below; the image is the authority where they differ.

The notes come from more than one editor. They are grouped in lists, each list labelled with a letter; the order of
the lists is random and tells you nothing. Each note is shown with the words of the translation it is attached to.
Judge every note on its own.

For each note give:
 claim     "correct"      what it says is true of this page and of the world, as far as you can tell;
           "wrong"        it misreads the page (a wrong word, an "original:" quote that is not on the page, a wrong
                          reading of the image) or states a false fact (a misidentified person, place, work or term, a
                          wrong date, a wrong equivalent in another language, a definition wrong for this context);
           "partly_wrong" one part is true and another part is wrong;
           "unsupported"  it asserts a specific quotation, original-language word, name, date, source, attribution or
                          interpretation that nothing on the page supports AND that you doubt, or a speculation stated
                          as fact (a plausible-sounding addition);
           "unverifiable" a specific factual claim you cannot check from the page or your knowledge, with no reason to
                          doubt it;
           "no_claim"     the note asserts nothing checkable.
 restates  true if the note only says again what the translation's own words already say (a paraphrase of the
           sentence, the same word again, an English "definition" of a word that is already plain English), so a
           reader gains nothing from it; false otherwise.
 attached  true if the note is about the words it is attached to (or, attached to no words, about the page); false if
           it belongs to other words of the page.
 kind      "image" (describes an illustration) | "original" (gives the source's words) | "definition" (what a term
           means) | "context" (background: who, what, when, where, a reference explained) | "clarification" (words
           supplied to make the sentence clear).
 why       one short line, at most 15 words.

Output ONE JSON object, {"verdicts": {"<note id>": {"claim": "...", "restates": false, "attached": true, "kind": "...", "why": "..."}, ...}},
covering every note id, between two marker lines, <<<BEGIN>>> and <<<END>>>. Nothing outside the markers. Do not write any file.
`;
export const JUDGE_PROMPT_MD5 = md5(JUDGE_PROMPT);

/** The notes of one arm's read of a page, in the one display shape every arm gets. */
function armNotes(arm, raw, plainText) {
  if (arm === 'b') {
    const p = parseNotes(raw, plainText);
    return p.annotations.map((a) => ({ anchor: a.anchor.exact, body: a.body, type: a.type, how: a.how }));
  }
  return inlineNotes(raw).notes.map((a) => ({ anchor: a.anchor?.exact || '', body: String(a.body).trim(), type: a.type, how: 'parser' }));
}

// Plants (prereg §controls): an EXTRA note in one list, never a real note changed. Half shift a number in a copy of a
// real note of that list (a year or count moved), half carry a real note of another book's page (wrong for this page).
function plantFor(list, other, rnd) {
  const withNum = list.filter((n) => /\b\d{2,4}\b/.test(n.body));
  if (withNum.length && rnd() < 0.5) {
    const n = withNum[Math.floor(rnd() * withNum.length)];
    const body = n.body.replace(/\b(\d{2,4})\b/, (m) => String(Number(m) + (Number(m) >= 1000 ? 170 : Number(m) >= 100 ? 300 : 7)));
    return { anchor: n.anchor, body, plant: 'number' };
  }
  const o = other[Math.floor(rnd() * other.length)];
  const host = list.length ? list[Math.floor(rnd() * list.length)].anchor : '';
  return { anchor: host, body: o.body, plant: 'foreign', from: o.uid };
}

function items() {
  const reads = (a) => new Map(jl(path.join(W, 'arms', `${ENGINE}-${a}.jsonl`)).filter((r) => r.text).map((r) => [r.uid, r.text]));
  const A = reads('v21'), A2 = reads('v21b'), Bn = reads('notes');
  const plain = new Map(jl(`${B}/arms/${ENGINE}-plain.jsonl`).filter((r) => r.text).map((r) => [r.uid, splitAnnotations(r.text).text]));
  const p6545 = manifest.pages.filter((p) => p.p6545);
  const rest = manifest.pages.filter((p) => !p.p6545);
  const judged = ENGINE === 'lite' ? [...p6545, ...shuffle(rest, makeRng(SEED)).slice(0, LITE_EXTRA)] : p6545;
  const rnd = makeRng(SEED + (ENGINE === 'lite' ? 1 : 2));
  const plantAt = new Set(shuffle(judged.map((p) => p.id), rnd).slice(0, PLANTS_PER_ENGINE));
  const pool = [];   // foreign notes for plants: real arm-a notes of other books
  for (const p of judged) if (A.has(p.id)) for (const n of armNotes('a', A.get(p.id))) pool.push({ ...n, uid: p.id, book: p.book_id });
  const out = [], key = {}, missing = [];
  for (const p of judged) {
    if (!A.has(p.id) || !Bn.has(p.id) || !plain.has(p.id)) { missing.push(p.id); continue; }
    const lists = [['a', armNotes('a', A.get(p.id))], ['b', armNotes('b', Bn.get(p.id), plain.get(p.id))]];
    if (p.floor && A2.has(p.id)) lists.push(['a2', armNotes('a2', A2.get(p.id))]);
    let plant = null;
    if (plantAt.has(p.id)) {
      const li = Math.floor(rnd() * lists.length);
      plant = { arm: lists[li][0], ...plantFor(lists[li][1], pool.filter((n) => n.book !== p.book_id), rnd) };
    }
    const letters = shuffle(['A', 'B', 'C'].slice(0, lists.length), rnd);
    const shown = [];
    const k = { uid: p.id, lists: {} };
    lists.forEach(([arm, notes], i) => {
      const L = letters[i];
      const all = notes.map((n) => ({ ...n }));
      if (plant && plant.arm === arm) all.splice(Math.floor(rnd() * (all.length + 1)), 0, { anchor: plant.anchor, body: plant.body, plant: plant.plant });
      k.lists[L] = { arm, notes: all.map((n, j) => ({ id: `${L}${j + 1}`, type: n.type ?? null, how: n.how ?? null, plant: n.plant ?? null })) };
      shown.push([L, all]);
    });
    shown.sort((x, y) => x[0].localeCompare(y[0]));
    key[p.id] = k;
    out.push({ uid: p.id, book_id: p.book_id, page_number: p.page_number, lang: p.lang, group: p.group, floor: !!p.floor, lists: shown.map(([L, all]) => ({ letter: L, notes: all.map((n, j) => ({ id: `${L}${j + 1}`, anchor: n.anchor, body: n.body })) })) });
  }
  const dir = path.join(W, 'judge', ENGINE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 1));
  const nNotes = out.reduce((s, it) => s + it.lists.reduce((t, l) => t + l.notes.length, 0), 0);
  console.log(`${ENGINE}: ${out.length} items (${missing.length} missing a read: ${missing.slice(0, 5).join(', ')}), ${nNotes} notes shown, plants ${Object.values(key).filter((k) => Object.values(k.lists).some((l) => l.notes.some((n) => n.plant))).length}; judge prompt md5 ${JUDGE_PROMPT_MD5}`);
}

export function itemPrompt(it, ocr) {
  const lists = it.lists.map((l) => `List ${l.letter}:\n${l.notes.length ? l.notes.map((n) => `${n.id} · on "${n.anchor || '(no words: the page)'}": ${n.body}`).join('\n') : '(no notes)'}`).join('\n\n');
  return `${JUDGE_PROMPT}\nLanguage of the page: ${it.lang}\n\nTranscription (OCR):\n"""\n${ocr}\n"""\n\n${lists}\n`;
}

const ocrOf = () => {
  const m = new Map();
  for (const r of jl(`${B}/records.jsonl`)) m.set(r.id, r.ocr_text);
  return m;
};

async function images() {
  const its = JSON.parse(fs.readFileSync(path.join(W, 'judge', ENGINE, 'items.json'), 'utf8'));
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  let n = 0, fail = 0;
  try {
    for (const it of its) {
      const f = path.join(W, 'img', `${it.uid}.jpg`);
      if (fs.existsSync(f)) { n++; continue; }
      const doc = await c.db('bookstore').collection('pages').findOne({ book_id: it.book_id, page_number: it.page_number }, { projection: { cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1 } });
      const url = doc ? getPageSource(doc) : null;
      if (!url) { console.log('NO IMAGE', it.uid); fail++; continue; }
      const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7965 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60e3) }).catch((e) => ({ ok: false, status: e.message }));
      if (!r.ok) { console.log('IMAGE FAIL', it.uid, r.status); fail++; continue; }
      let buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 4e6) { const { default: sharp } = await import('sharp'); buf = await sharp(buf).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); }
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); n++;
    }
  } finally { await c.close(); }
  console.log(`images: ${n} ready, ${fail} failed`);
}

export function parseVerdicts(raw, ids) {
  const t = unwrapRead(raw).text || raw;
  const m = String(t).match(/\{[\s\S]*\}/);
  try { const v = JSON.parse(m[0]).verdicts; const got = ids.filter((id) => v?.[id]?.claim); return got.length === ids.length ? v : null; } catch { return null; }
}

async function run() {
  const dir = path.join(W, 'judge', ENGINE);
  const its = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8'));
  const file = path.join(dir, 'out.jsonl');
  const done = new Set(jl(file).filter((r) => r.verdicts).map((r) => r.uid));
  const tries = new Map(); for (const r of jl(file)) if (!r.verdicts) tries.set(r.uid, (tries.get(r.uid) ?? 0) + 1);
  const ocr = ocrOf();
  const limits = await import('../../lib/model-limits.mjs');
  const state = {};
  const todo = its.filter((it) => !done.has(it.uid) && (tries.get(it.uid) ?? 0) < 3 && fs.existsSync(path.join(W, 'img', `${it.uid}.jpg`)));
  const LIMIT = Number(arg('limit', Infinity));
  console.log(`${ENGINE}: ${its.length} items, ${done.size} judged, ${todo.length} to judge`);
  let stop = null, calls = 0;
  const one = async (it) => {
    if (stop || calls >= LIMIT) return;
    if (Date.now() - (state.at ?? 0) > 5 * 60e3) { state.meter = await claudeMeter(limits); state.at = Date.now(); }
    const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 }) || paceBlock(state.meter, { weeklyMax: 85, sessionMax: 95 });
    if (b) { stop = typeof b === 'string' ? b : b.reason; return; }
    calls++;
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ns7965-'));
    try {
      fs.copyFileSync(path.join(W, 'img', `${it.uid}.jpg`), path.join(ws, 'page.jpg'));
      const ids = it.lists.flatMap((l) => l.notes.map((n) => n.id));
      const prompt = itemPrompt(it, ocr.get(it.uid));
      const t0 = Date.now();
      const r = ids.length ? await opusCall(prompt, ws) : { text: '<<<BEGIN>>>{"verdicts":{}}<<<END>>>', cls: null, model: null, usage: null };
      if (r.cls === 'quota') { stop = 'quota reply'; return; }
      const verdicts = parseVerdicts(r.text, ids);
      fs.appendFileSync(file, JSON.stringify({ uid: it.uid, verdicts, cls: r.cls, model: r.model, usage: r.usage, prompt_md5: md5(prompt), judge_md5: JUDGE_PROMPT_MD5, secs: Math.round((Date.now() - t0) / 1000), raw: verdicts ? null : String(r.text).slice(0, 600), date: new Date().toISOString() }) + '\n');
      console.log(`  ${it.uid} ${verdicts ? 'ok' : `UNPARSED ${r.cls || ''}`} ${ids.length} notes ${Math.round((Date.now() - t0) / 1000)}s`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const PAR = Math.min(3, Number(arg('parallel', 2)));
  const queue = [...todo];
  await Promise.all(Array.from({ length: PAR }, async () => { while (queue.length && !stop && calls < LIMIT) await one(queue.shift()); }));
  console.log(`${ENGINE}: ${stop ? `STOPPED: ${stop}` : 'done'} (${calls} calls)`);
  process.exit(stop ? 4 : 0);
}

const stage = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!['flash38', 'lite'].includes(ENGINE) && stage !== 'md5') { console.error('--engine flash38|lite'); process.exit(2); }
  if (stage === 'items') items();
  else if (stage === 'images') await images();
  else if (stage === 'run') await run();
  else if (stage === 'md5') console.log(JUDGE_PROMPT_MD5);
  else { console.error('stage: items | images | run | md5'); process.exit(2); }
}
