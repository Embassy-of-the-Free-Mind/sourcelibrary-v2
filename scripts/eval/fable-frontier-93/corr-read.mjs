#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs namesPrompt/names (an image-grounded, character-level check of
// named spans against the leaf). It does not fit: it checks names in candidate transcriptions; this asks, for one
// word, which of two readings the leaf prints, blind to who proposed which.
/**
 * #93 correction check, step 2 of 2. For each kept correction (corr-extract.mjs) and each planted false correction, a
 * reader with the page image sees the OCR line around the word and two readings in random order, A and B, and answers:
 * the leaf has A, has B, has neither, or cannot be read. Blind: no arm name, no word on which reading is the OCR's.
 * Plants: a clearly printed word of the OCR set against a copy with one letter changed; the right answer is the OCR's.
 *
 *   node scripts/eval/fable-frontier-93/corr-read.mjs plant --out=DIR            # DIR/corr/plants.json (no model)
 *   node scripts/eval/fable-frontier-93/corr-read.mjs read  --out=DIR --reader=opus|fable [--concurrency=2]
 * Images: the new set's DIR/img/<uid>.jpg; stage 1's are fetched to DIR/img-s1/<uid>.jpg from the pages' Mongo record
 * (`fetch-s1`, needs the env file). Appends DIR/corr/reads-<reader>.jsonl.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { call, meterStop, MODELS } from './judge-run.mjs';

const STAGE = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out'), READER = arg('reader');
const h = (s) => crypto.createHash('sha256').update(`f93r:${s}`).digest('hex');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const C = (f) => path.join(OUT, 'corr', f);
const SCRIPT = { Persian: /\p{Script=Arabic}/u, Sanskrit: /\p{Script=Devanagari}/u, 'Classical Chinese': /\p{Script=Han}/u, Chinese: /\p{Script=Han}/u, Greek: /\p{Script=Greek}/u, Hebrew: /\p{Script=Hebrew}/u };

/** The OCR line(s) holding the reading: the reader's pointer to where on the leaf to look. */
function context(ocr, reading) {
  const lines = String(ocr).split('\n');
  const flat = (s) => s.normalize('NFC').replace(/\s+/g, '');
  let i = lines.findIndex((l) => l.includes(reading));
  if (i < 0) i = lines.findIndex((l) => flat(l).includes(flat(reading)));
  if (i < 0) return null;
  let line = lines[i].replace(/<[^>]+>/g, '').trim();
  if (line.length > 240) { const j = Math.max(0, line.indexOf(reading) - 100); line = (j ? '…' : '') + line.slice(j, j + 240) + '…'; }
  return { line, line_no: i + 1, of: lines.length };
}

const readerPrompt = (it, imageRef) => `You are checking one word on a page of a historical ${it.lang} book against the page image. The image is the only authority.

The page image is attached: ${imageRef}

The word is in this passage (a transcription of the page, roughly line ${it.ctx.line_no} of ${it.ctx.of}; the transcription may itself be wrong at this word):
"""
${it.ctx.line}
"""

Two readings of the word are proposed:
A: ${it.A.text}${it.A.gloss ? `   (${it.A.gloss})` : ''}
B: ${it.B.text}${it.B.gloss ? `   (${it.B.gloss})` : ''}

Find the word on the leaf and read it yourself, closely, letter by letter. Which does the page print?
- "A": the page prints reading A
- "B": the page prints reading B
- "neither": the page clearly prints something else (say what)
- "unreadable": you cannot make out the word on the image (damaged, too small, not found)
Differences of spelling convention that do not change the word (vowel points, accents, variant forms of one character) do not count; a different letter or character that makes a different word does.

Answer with one JSON object only: {"answer": "A" | "B" | "neither" | "unreadable", "page_has": "what you read on the leaf", "confidence": "high" | "medium" | "low"}`;

function items() {
  const out = [];
  for (const set of ['new', 's1']) {
    const f = C(`notes-${set}.json`); if (!fs.existsSync(f)) continue;
    const pages = new Map((set === 'new' ? jsonl(path.join(OUT, 'pages.jsonl')).map((r) => [r.uid, r.ocr]) : jsonl('/root/pareto-6182/xl/records.jsonl').map((r) => [r.id, r.ocr_text])));
    for (const n of JSON.parse(fs.readFileSync(f, 'utf8')).kept) {
      const ctx = context(pages.get(n.uid), n.transcription_reading); if (!ctx) continue;
      const prop = n.proposed_reading && n.proposed_reading.trim() !== n.transcription_reading.trim() ? n.proposed_reading : `(a word meaning "${n.proposed_gloss}")`;
      out.push({ cid: `c${h(`${set}:${n.uid}:${n.arm}:${n.note_k}:${n.sub}`).slice(0, 10)}`, kind: 'correction', set, uid: n.uid, lang: n.lang, arm: n.arm, ctx, ocr_r: { text: n.transcription_reading, gloss: n.transcription_gloss && n.transcription_gloss !== 'nonsense' ? n.transcription_gloss : null }, arm_r: { text: prop, gloss: n.proposed_reading ? n.proposed_gloss : null }, prop_in_script: !!n.proposed_reading });
    }
  }
  if (fs.existsSync(C('plants.json'))) for (const p of JSON.parse(fs.readFileSync(C('plants.json'), 'utf8'))) {
    const ocr = jsonl(path.join(OUT, 'pages.jsonl')).find((r) => r.uid === p.uid).ocr;
    out.push({ cid: p.cid, kind: 'plant', set: 'new', uid: p.uid, lang: p.lang, arm: 'PLANT', ctx: context(ocr, p.word), ocr_r: { text: p.word, gloss: null }, arm_r: { text: p.fake, gloss: null }, prop_in_script: true });
  }
  return out.map((it) => (h(`ab:${it.cid}`)[0] < '8' ? { ...it, A: it.ocr_r, B: it.arm_r, ocr_is: 'A' } : { ...it, A: it.arm_r, B: it.ocr_r, ocr_is: 'B' }));
}

if (STAGE === 'plant') {
  // 4 per language: a word of >= 4 letters of the page's script (Chinese: 2 Han) that occurs once in the OCR, on a
  // line of >= 20 such letters; one letter replaced by another letter of the same page. Pages drawn by hash.
  const pages = jsonl(path.join(OUT, 'pages.jsonl'));
  const plants = [];
  for (const lang of [...new Set(pages.map((p) => p.lang))]) {
    const re = SCRIPT[lang];
    const cand = pages.filter((p) => p.lang === lang).sort((a, b) => h(`pl:${a.uid}`).localeCompare(h(`pl:${b.uid}`)));
    for (const p of cand) {
      if (plants.filter((x) => x.lang === lang).length >= 4) break;
      const body = p.ocr.replace(/<(meta|note|header|page-num|sig|footer|summary|keywords|image-desc|lang|language|page-type)\b[^>]*>[\s\S]*?<\/\1>/g, '');
      const lines = body.split('\n').filter((l) => [...l].filter((ch) => re.test(ch)).length >= 20);
      if (!lines.length) continue;
      const line = lines[parseInt(h(`ln:${p.uid}`).slice(0, 6), 16) % lines.length];
      const words = lang.includes('Chinese') ? [...line.matchAll(/\p{Script=Han}{2}/gu)].map((m) => m[0]) : line.split(/[\s,.;:·()[\]"']+/).filter((w) => [...w].length >= 4 && [...w].every((ch) => re.test(ch)));
      const uniq = words.filter((w) => p.ocr.split(w).length === 2);
      if (!uniq.length) continue;
      const word = uniq[parseInt(h(`w:${p.uid}`).slice(0, 6), 16) % uniq.length];
      const letters = [...new Set([...body].filter((ch) => re.test(ch)))];
      const chars = [...word]; const at = parseInt(h(`at:${p.uid}`).slice(0, 4), 16) % chars.length;
      const pool = letters.filter((ch) => ch !== chars[at]);
      chars[at] = pool[parseInt(h(`ch:${p.uid}`).slice(0, 6), 16) % pool.length];
      const fake = chars.join('');
      if (p.ocr.includes(fake)) continue;
      plants.push({ cid: `p${h(`plant:${p.uid}`).slice(0, 10)}`, uid: p.uid, lang, word, fake });
    }
  }
  fs.mkdirSync(path.join(OUT, 'corr'), { recursive: true });
  fs.writeFileSync(C('plants.json'), JSON.stringify(plants, null, 1));
  console.log(`${plants.length} planted false corrections`, plants.map((p) => `${p.lang}: ${p.word} -> ${p.fake}`));
} else if (STAGE === 'fetch-s1') {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const uids = [...new Set(JSON.parse(fs.readFileSync(C('notes-s1.json'), 'utf8')).kept.map((n) => n.uid))];
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = await c.db('bookstore').collection('pages').find({ id: { $in: uids } }, { projection: { id: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray();
  await c.close();
  fs.mkdirSync(path.join(OUT, 'img-s1'), { recursive: true });
  for (const p of pages) {
    const f = path.join(OUT, 'img-s1', `${p.id}.jpg`); if (fs.existsSync(f)) continue;
    const u = getPageSource(p); if (!u) { console.log(`  ${p.id}: no image`); continue; }
    const res = await fetch(u); if (!res.ok) { console.log(`  ${p.id}: HTTP ${res.status}`); continue; }
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    if (fs.statSync(f).size > 3.5e6) spawnSync('python3', ['-c', `from PIL import Image; im=Image.open('${f}').convert('RGB'); im.thumbnail((2400,2400)); im.save('${f}', quality=88)`]);
  }
  console.log(`${uids.length} stage-1 pages with corrections; images in img-s1/: ${fs.readdirSync(path.join(OUT, 'img-s1')).length}`);
} else if (STAGE === 'read') {
  if (!MODELS[READER]) { console.error('--reader=opus|fable'); process.exit(2); }
  const all = items();
  fs.writeFileSync(C('read-items.json'), JSON.stringify(all, null, 1));
  const file = C(`reads-${READER}.jsonl`);
  const rows = jsonl(file), done = new Set(rows.filter((r) => r.v).map((r) => r.cid)), tries = new Map();
  for (const r of rows) if (!r.v) tries.set(r.cid, (tries.get(r.cid) ?? 0) + 1);
  const img = (it) => path.join(OUT, it.set === 's1' ? 'img-s1' : 'img', `${it.uid}.jpg`);
  const todo = all.filter((it) => !done.has(it.cid) && (tries.get(it.cid) ?? 0) < 3 && fs.existsSync(img(it))).sort((a, b) => h(`ord:${a.cid}`).localeCompare(h(`ord:${b.cid}`)));
  console.log(`${READER}: ${all.length} items, ${todo.length} to read`);
  let stop = null, i = 0, calls = 0;
  const one = async (it) => {
    if (calls++ % 10 === 0 && meterStop()) { stop = meterStop(); return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `f93r-${READER}-`));
    try {
      fs.copyFileSync(img(it), path.join(ws, 'page.jpg'));
      const r = await call(readerPrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws, MODELS[READER]);
      if (r.cls === 'quota') { stop = 'quota'; return; }
      let v = null; try { v = JSON.parse(String(r.text).match(/\{[\s\S]*\}/)[0]); if (!['A', 'B', 'neither', 'unreadable'].includes(v.answer)) v = null; } catch { v = null; }
      fs.appendFileSync(file, JSON.stringify({ cid: it.cid, reader: READER, models: r.models, v, raw: v ? undefined : String(r.text).slice(0, 300), usage: r.usage, list_usd: r.cost }) + '\n');
      console.log(`  ${it.cid} ${it.kind}: ${v?.answer ?? 'unparsed'} (${v?.confidence ?? ''})`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency') || 2) }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`STOPPED: ${stop}`); process.exit(3); }
  console.log('done');
} else { console.error('stages: plant | fetch-s1 | read'); process.exit(2); }
