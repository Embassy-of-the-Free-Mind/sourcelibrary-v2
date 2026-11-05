#!/usr/bin/env node
// PRIOR ART: scripts/lib/agy-cli.mjs gatedImageCall (one image, one question, gated workspace — used here unchanged);
// MONTHLY.md stage 2 (the Opus judge: one subagent per 15-item packet, JUDGE-PROMPT.md verbatim). This is the second
// judge of wave 2 (#5274): Gemini through the agy CLI on the subscription, one call per item, the same rubric and the
// same image addendum, so the two families can be compared on the same items. There is NO API fallback: a quota stop
// ends the run (exit 75) and it resumes where it stopped.
//
//   AGY_HOME=/root/.agy-james node scripts/eval/translation-corpus-audit/judge-agy.mjs --dir <run dir> --judge gemini-flash \
//        --model gemini-3.8-flash [--ids ids.txt] [--concurrency 3] [--log $JOB_SCRATCH/agy-calls.jsonl]
// Reads <dir>/items.jsonl and <dir>/images.json; appends verdicts to <dir>/verdicts/<judge>/agy.jsonl (resumable).
// The rubric's file instructions (PACKET_FILE / OUTPUT_FILE / one Write call) are replaced for this one-item call by
// the AGY CALL paragraph below; everything else is JUDGE-PROMPT.md + IMAGE-ADDENDUM.md verbatim.

import fs from 'node:fs';
import path from 'node:path';
import { gatedImageCall } from '../../lib/agy-cli.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir, JUDGE = args.judge || 'gemini-flash', MODEL = args.model || 'gemini-3.8-flash';
// --attempts: agy calls per item at most (default 4: two parse tries × two error retries). A heavy model under the
// box's 40-a-day cap (agy-guard) runs with --attempts 1, so a retry never spends another item's call (#5274).
const ATTEMPTS = Number(args.attempts || 4);
const CONC = Number(args.concurrency || 3), LOG = args.log || path.join(process.env.JOB_SCRATCH || '/tmp', `agy-${JUDGE}.jsonl`);
if (!DIR) { console.error('--dir required'); process.exit(1); }

const HERE = path.dirname(new URL(import.meta.url).pathname);
const strip = (s) => s.replace(/^<!--[\s\S]*?-->\s*/, '');
const RUBRIC = strip(fs.readFileSync(path.join(HERE, 'JUDGE-PROMPT.md'), 'utf8'));
const ADDENDUM = strip(fs.readFileSync(path.join(HERE, 'IMAGE-ADDENDUM.md'), 'utf8'));
export const AGY_CALL = `AGY CALL. This call carries ONE item, given inline below, instead of a PACKET_FILE, and its page image is the file
image.jpg in this directory. Ignore the instructions above about reading PACKET_FILE, writing OUTPUT_FILE and printing
DONE: do not read or write any other file. Open image.jpg first. Then reply with the one JSON line for this item (the
output format above, with the five image keys) between a line <<<BEGIN>>> and a line <<<END>>>, and nothing outside them.`;
const promptFor = (it) => (name) => `${RUBRIC}\n${ADDENDUM}\n${AGY_CALL.replaceAll('image.jpg', name)}\n\nITEM: ${JSON.stringify({ id: it.id, language: it.language, source: it.source, translation: it.translation })}\n`;

/** The verdict object in a reply: the text between the markers (or the whole reply), first `{` to last `}`. */
export function parseVerdict(text) {
  const s = String(text || '');
  const inner = s.includes('<<<BEGIN>>>') ? s.split('<<<BEGIN>>>')[1].split('<<<END>>>')[0] : s;
  const a = inner.indexOf('{'), b = inner.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(inner.slice(a, b + 1)); return typeof v.fidelity === 'number' ? v : null; } catch { return null; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const items = fs.readFileSync(path.join(DIR, 'items.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const images = JSON.parse(fs.readFileSync(path.join(DIR, 'images.json'), 'utf8'));
  const only = args.ids ? new Set(fs.readFileSync(args.ids, 'utf8').split(/\s+/).filter(Boolean)) : null;
  const vdir = path.join(DIR, 'verdicts', JUDGE);
  fs.mkdirSync(vdir, { recursive: true });
  const vfile = path.join(vdir, 'agy.jsonl');
  const done = new Set(fs.existsSync(vfile) ? fs.readFileSync(vfile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } }) : []);
  const todo = items.filter((it) => (!only || only.has(it.id)) && !done.has(it.id) && images[it.id]?.file);
  console.error(`${JUDGE} (${MODEL}): ${todo.length} to judge, ${done.size} already done, AGY_HOME=${process.env.AGY_HOME || '(default)'}`);
  let stop = null, n = 0, failed = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (todo.length && !stop) {
      const it = todo.shift();
      let v = null, r = null, spent = 0;
      for (let attempt = 1; spent < ATTEMPTS && !v && !stop; attempt++) {
        r = await gatedImageCall(promptFor(it), fs.readFileSync(images[it.id].file), { model: MODEL, attempts: Math.min(2, ATTEMPTS - spent), tmp: process.env.TMPDIR || '/tmp' });
        spent += r.calls || 1;
        fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), id: it.id, judge: JUDGE, model: MODEL, attempt, cls: r.cls, secs: r.secs, calls: r.calls, usage: r.usage, err: r.err, text: String(r.text || '').slice(0, 6000) }) + '\n');
        if (r.cls === 'quota') { stop = `quota: ${r.err || r.text}`.slice(0, 300); break; }
        v = parseVerdict(r.text);
      }
      if (v) { v.id = it.id; v.judge_model = MODEL; fs.appendFileSync(vfile, JSON.stringify(v) + '\n'); n++; }
      else if (!stop) { failed++; console.error('no verdict', it.id, r?.cls, String(r?.text || '').slice(0, 200)); }
      if ((n + failed) % 10 === 0) console.error(`${n} judged, ${failed} failed, ${todo.length} left`);
    }
  }));
  console.error(`${JUDGE}: ${n} judged this run, ${failed} without a verdict${stop ? `; STOPPED on ${stop}` : ''}`);
  if (stop) process.exit(75);
}
