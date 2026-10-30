#!/usr/bin/env node
// PRIOR ART: scripts/split-book.mjs parseSpreadOCR — takes the text before a spread's <page-break/> as the LEFT page,
// because the spread prompt asks for it in that order; nothing checks that the model obeyed. On the #7605 gate book
// (6a2032ad…, an Arabic-script codex) it did on frames 3 and 12 and did not on frame 7 (by eye, 2026-10-30): the RIGHT
// page, read first in that script, came first. scripts/batch/claude-ocr.mjs claudeCall is the sealed Opus reader used here.
/**
 * Which half of a spread's OCR is on which leaf (#7605), before split-book.mjs --positions-file cuts the text.
 *
 *   node --env-file=.env.production.local scripts/maintenance/split-text-sides.mjs --out=DIR --book=ID [--concurrency=3]
 *
 * For every frame the proposal cuts (DIR/<book>/proposal.json, after review) whose OCR breaks exactly once, the two
 * leaves are cropped as split-book.mjs will crop them and ONE sealed Opus call (claude -p --restricted --tools Read)
 * is shown both leaf images and both text halves (A = before the break, B = after) and asked which text is on which
 * leaf. Writes DIR/<book>/text-sides.json, the split-book.mjs --text-sides file: { "<page_number>": "lr" | "rl" | null }
 * — lr: A is the left leaf, rl: A is the right leaf, null: unsure or neither, so both leaves are read fresh. Frames
 * kept whole or with no single break are not asked (split-book.mjs gives them no cut text anyway). Each answer is kept
 * in text-sides.jsonl. Writes nothing to Mongo or R2. Resumable.
 *
 * --sample=N (left-to-right books only): ask N evenly spaced frames first. When every one answers lr, the rest take lr
 * on that evidence (logged as `sampled`); any rl or unsure answer and every frame is asked. In a left-to-right book the
 * prompt's order and the reading order agree. In a right-to-left book they pull apart (the gate book's frame 7), so
 * those are always asked frame by frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { cutSpreadText } from '../lib/split-stage.mjs';
import { claudeCall } from '../batch/claude-ocr.mjs';
import { leafBoxes } from './split-spreads-agy.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const EXCERPT = 700;

export const PROMPT = `In this directory are two photographs of manuscript or printed pages, cut from one photograph of an open book: leaf-left.jpg (the left-hand page) and leaf-right.jpg (the right-hand page). Open both with the Read tool.
Below are two transcriptions, A and B. One was made from each page (the ends may be cut short). Decide which transcription is of which page, by comparing headings, the first and last lines, numbers, line shapes and any pictures they mention with what you see. Do not translate anything.

=== A ===
{A}

=== B ===
{B}

Reply with ONLY one line of JSON: {"A": "left" or "right" or "unsure", "B": "left" or "right" or "unsure", "evidence": "at most 15 words"}`;

/** The --text-sides value for one answer: 'lr', 'rl', or null (unsure, both the same side, or unparseable). */
export function sidesFrom(answer) {
  // The last flat JSON object: a reply sometimes states its answer twice.
  // An Arabic comma (U+060C) between keys is the model writing in the page's script, not a refusal.
  const objs = String(answer || '').replace(/\u060C/g, ',').match(/\{[^{}]*\}/g) || [];
  let j;
  try { j = JSON.parse(objs[objs.length - 1] ?? ''); } catch { return null; }
  if (j.A === 'left' && j.B === 'right') return 'lr';
  if (j.A === 'right' && j.B === 'left') return 'rl';
  return null;
}

const clip = (t) => (t.length > EXCERPT ? `${t.slice(0, EXCERPT)}\n[…]` : t);

async function main() {
  const OUT = path.resolve(arg('out'));
  const id = arg('book');
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  if (!arg('out') || !id) { console.error('usage: split-text-sides.mjs --out=DIR --book=ID [--concurrency=3]'); process.exit(2); }
  const dir = path.join(OUT, id);
  const proposal = JSON.parse(fs.readFileSync(path.join(dir, 'proposal.json'), 'utf8'));
  const logFile = path.join(dir, 'text-sides.jsonl');
  const done = new Map((fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).map((r) => [r.page_number, r]));
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const pages = new Map((await db.collection('pages').find({ id: { $in: proposal.frames.map((f) => f.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
  await client.close();
  const cuttable = proposal.frames.filter((f) => typeof f.fold === 'number' && cutSpreadText(pages.get(f.page_id)?.ocr?.data).kind === 'cut');
  const SAMPLE = Number(arg('sample') || 0);
  if (SAMPLE && proposal.page_order !== 'ltr') console.log(`--sample ignored: page order ${proposal.page_order}, every frame is asked`);
  const sampled = SAMPLE && proposal.page_order === 'ltr' && cuttable.length > SAMPLE
    ? Array.from({ length: SAMPLE }, (_, i) => cuttable[Math.floor(((i + 0.5) / SAMPLE) * cuttable.length)])
    : null;
  let ask = sampled || cuttable;
  const wsRoot = path.join(dir, '.sides');
  fs.mkdirSync(wsRoot, { recursive: true });
  let k = 0, stop = false;
  const runAsk = () => Promise.all(Array.from({ length: conc }, async () => {
    while (k < ask.length && !stop) {
      const f = ask[k++];
      if (done.has(f.page_number)) continue;
      const t = cutSpreadText(pages.get(f.page_id).ocr.data);
      if (!t.left || !t.right) { done.set(f.page_number, { page_number: f.page_number, sides: null, why: 'one side of the break is empty' }); continue; }
      const ws = fs.mkdtempSync(path.join(wsRoot, `p${f.page_number}-`));
      const buf = Buffer.from(await (await fetch(f.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      const meta = await sharp(buf).metadata();
      for (const b of leafBoxes(f.fold, meta.width, 'ltr')) {
        await sharp(buf).extract({ left: b.left, top: 0, width: b.width, height: meta.height }).resize({ width: 1100, height: 1500, fit: 'inside' }).jpeg({ quality: 85 }).toFile(path.join(ws, `leaf-${b.side}.jpg`));
      }
      const r = await claudeCall(PROMPT.replace('{A}', clip(t.left)).replace('{B}', clip(t.right)), 'opus', ws);
      fs.rmSync(ws, { recursive: true, force: true });
      if (r.cls === 'usage_limit') { stop = true; console.log(`USAGE LIMIT at p.${f.page_number}: stopping; re-run resumes`); break; }
      const row = { page_number: f.page_number, page_id: f.page_id, sides: r.cls ? null : sidesFrom(r.text), answer: r.text?.slice(0, 400), cls: r.cls, model: r.model, secs: Math.round(r.secs), at: new Date().toISOString() };
      done.set(f.page_number, row);
      fs.appendFileSync(logFile, JSON.stringify(row) + '\n');
      console.log(`  p.${f.page_number}: ${row.sides ?? 'UNSURE'} ${row.answer?.replace(/\s+/g, ' ').slice(0, 140) ?? row.cls}`);
    }
  }));
  await runAsk();
  if (sampled && !stop) {
    if (sampled.every((f) => done.get(f.page_number)?.sides === 'lr')) {
      for (const f of cuttable) if (!done.has(f.page_number)) done.set(f.page_number, { page_number: f.page_number, sides: 'lr', why: `sampled: ${SAMPLE}/${SAMPLE} asked frames lr` });
      console.log(`  sample ${SAMPLE}/${SAMPLE} lr: the other ${cuttable.length - SAMPLE} frames take lr`);
    } else {
      console.log('  sample not all lr: asking every frame');
      ask = cuttable; k = 0;
      await runAsk();
    }
  }
  ask = cuttable;
  fs.rmSync(wsRoot, { recursive: true, force: true });
  const sides = Object.fromEntries(ask.map((f) => [String(f.page_number), done.get(f.page_number)?.sides ?? null]));
  if (stop || ask.some((f) => !done.has(f.page_number))) { console.log('incomplete: text-sides.json not written'); process.exit(3); }
  fs.writeFileSync(path.join(dir, 'text-sides.json'), JSON.stringify(sides));
  const t = {}; for (const v of Object.values(sides)) t[v ?? 'unsure'] = (t[v ?? 'unsure'] || 0) + 1;
  console.log(`${id}: ${ask.length} cut frames with one break asked: ${JSON.stringify(t)} → ${path.join(dir, 'text-sides.json')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
