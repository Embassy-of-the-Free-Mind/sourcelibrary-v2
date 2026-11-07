#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/correct.mjs (correctInstruction, splitAnswers, parseAnswer, imported: the #7568
// Opus correction, whose main() needs a driver.mjs set dir and groups pages by book), scripts/eval/gpu-flash-vs-opus-7263/
// o-read.mjs (one page per sealed claudeCall on files), scripts/eval/correction-pass-7818/lib.mjs correctionRead (the
// agy correct call, imported), scripts/eval/flash-reread-5924/fc-prompt.mjs (the agy template, run to make P3's prompt).
/**
 * run-arms.mjs — P2-r2, P2-ia, P3-ia, the mark counter. Files only, nothing written to Mongo.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-ditto-restore-5274/run-arms.mjs <P2-r2|P2-ia|P3-ia|counter> [--conc=3]
 * Reads $JOB_SCRATCH/w/pages.json; writes $JOB_SCRATCH/w/<arm>/<slug>.json. Re-running skips answered pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { correctInstruction, splitAnswers, parseAnswer } from '../../batch/ocr-convergence/correct.mjs';
import { claudeCall, languageInstruction } from '../../batch/claude-ocr.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { correctionRead } from '../correction-pass-7818/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = path.join(process.env.JOB_SCRATCH, 'w');
const ARM = process.argv[2]; const CONC = Number(process.argv.find((a) => a.startsWith('--conc='))?.slice(7) || 3);
const pages = JSON.parse(fs.readFileSync(path.join(W, 'pages.json'), 'utf8'));
const OUT = path.join(W, ARM); fs.mkdirSync(OUT, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export const DITTO = `\n\n**Ditto marks (this work).** This dictionary quotes each entry's headword inside its citations as a thin vertical stroke, one stroke per character of the headword. Restore each ditto mark 丨 (U+4E28) where the leaf has one, one per headword character, at its place in the column. Do not expand a mark into the headword, do not leave a gap where one stands, and do not add one where the leaf has none. A column ruling line is not a mark.\n`;
export const COUNTER = `The file ./p01.jpg is a page of a Chinese rhyme or word dictionary of the Qing court. Open it with the Read tool. In this kind of book each entry's headword is repeated inside its citations as a ditto mark: a short thin vertical stroke standing alone in a character cell, one stroke per character of the headword. The ruling lines between columns are NOT marks, and the strokes of a character are NOT marks.

Go through the body columns from right to left and count the ditto marks in each column. Ignore the 版心 margin (the book title, juan and leaf number). Reply with one JSON object and nothing else:
{"columns":[<marks in column 1 from the right>,<column 2>,...],"total":<the sum>,"runs":<how many separate runs of adjacent marks>,"legible":true|false}`;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const { base, ref } = await liveOcrPrompt(c.db('bookstore'), languageInstruction('Chinese')); await c.close();
const imgOf = (p) => path.join(W, 'img', /r2$/.test(ARM) ? 'r2' : 'ia', `${p.slug}.jpg`);
const draftOf = (p) => fs.readFileSync(path.join(W, 'p0', `${p.slug}.txt`), 'utf8');

let agyTpl = null;
if (ARM === 'P3-ia') {
  const f = path.join(OUT, 'fc-correct-prompt.txt');
  const r = spawnSync('node', ['--env-file=/root/sourcelibrary/.env.production.local', path.join(HERE, '../flash-reread-5924/fc-prompt.mjs'), f], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  console.log(r.stdout.trim());
  agyTpl = fs.readFileSync(f, 'utf8').replace('\nDRAFT START\n{draft}', `${DITTO}\nDRAFT START\n{draft}`);
}

async function opusCorrect(p) {
  const sent = base + correctInstruction(1) + DITTO;
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'zhd-'));
  fs.copyFileSync(imgOf(p), path.join(dir, 'p01.jpg')); fs.writeFileSync(path.join(dir, 'd01.txt'), draftOf(p));
  const r = await claudeCall(sent, 'opus', dir);
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.cls === 'usage_limit') return { stop: r.err };
  const a = r.cls ? { outcome: 'no-answer', reason: r.cls } : parseAnswer(splitAnswers(r.text, 1).answers?.[0]);
  return { outcome: a.outcome, reason: a.reason ?? null, text: a.outcome === 'unchanged' ? draftOf(p) : a.text ?? '', model: r.model, usage: r.usage, secs: r.secs, sent_hash: sha(sent), prompt_ref: ref, raw: a.outcome === 'no-answer' ? String(r.text).slice(0, 2000) : undefined };
}
async function counter(p) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'zhd-'));
  fs.copyFileSync(imgOf(p), path.join(dir, 'p01.jpg'));
  const r = await claudeCall(COUNTER, 'opus', dir);
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.cls === 'usage_limit') return { stop: r.err };
  let j = null; try { j = JSON.parse(String(r.text).match(/\{[\s\S]*\}/)[0]); } catch { /* left null: no-answer */ }
  return { outcome: j ? 'read' : 'no-answer', count: j, model: r.model, usage: r.usage, secs: r.secs, raw: j ? undefined : String(r.text).slice(0, 1000) };
}
async function agyCorrect(p) {
  const key = p.slug; const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'zhd-'));
  const r = await correctionRead({ template: agyTpl, draft: draftOf(p).trim(), imageBuf: fs.readFileSync(imgOf(p)), ws, key, model: 'gemini-3.8-flash-low' });
  fs.rmSync(ws, { recursive: true, force: true });
  if (r.quota) return { stop: `quota ${r.err}` };
  const a = r.cls || r.wrapper ? { outcome: 'no-answer', reason: r.cls || r.wrapper } : parseAnswer(r.text);
  return { outcome: a.outcome, reason: a.reason ?? null, text: a.outcome === 'unchanged' ? draftOf(p) : a.text ?? '', model: 'gemini-3.8-flash-low', usage: r.usage, calls: r.calls, raw: a.outcome === 'no-answer' ? String(r.raw ?? '').slice(0, 2000) : undefined };
}
const call = ARM === 'counter' ? counter : ARM === 'P3-ia' ? agyCorrect : opusCorrect;
const done = (p) => { try { const o = JSON.parse(fs.readFileSync(path.join(OUT, `${p.slug}.json`), 'utf8')).outcome; return o && o !== 'no-answer'; } catch { return false; } };
const todo = pages.filter((p) => !done(p));
console.log(`${ARM}: ${todo.length} pages, prompt ${ref?.name} v${ref?.version}, ${CONC} at a time`);
let i = 0, stop = null;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < todo.length && !stop) {
    const p = todo[i++];
    let res = await call(p);
    if (res.stop) { stop = res.stop; break; }
    if (res.outcome === 'no-answer') res = (await call(p)) ?? res;   // one retry, as correct.mjs
    if (res.stop) { stop = res.stop; break; }
    fs.writeFileSync(path.join(OUT, `${p.slug}.json`), JSON.stringify({ slug: p.slug, arm: ARM, ...res }, null, 1));
    console.log(p.slug, res.outcome, res.reason ?? '', Math.round(res.secs ?? 0), 's', res.text ? `${(res.text.match(/[丨｜|│┃]/g) || []).length} marks` : (res.count?.total ?? ''));
  }
}));
if (stop) { console.error('STOPPED:', stop); process.exit(3); }
