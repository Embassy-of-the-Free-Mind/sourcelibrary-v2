#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-gemini-reocr-7263/arms.mjs (lane-plan, paddle, cheap-setup, cheap-collect: run unchanged on a
// plan.json this file writes; it has no stage that takes the pilot's texts as S and O, and no fresh Opus read).
// scripts/batch/claude-ocr.mjs (the sealed Opus reader on the live prompt: its callInstruction and splitPages are imported, but
// its main records the lane's book list in Mongo and fills the language slot, and this job may not write and the brief names
// the auto-detect prompt cli-ocr.mjs read gets). scripts/batch/ocr-convergence/correct.mjs claudeCall (the stream-json transcript
// that shows the image was opened, imported).
/**
 * #7263 job zh-print-arms-7263: the arms on the pilot's 60 judged pages. Eval only, no Mongo write (readonly-mongo.mjs).
 *   arms.mjs setup --scratch=DIR    DIR/<one|ten>/plan.json, texts/<key>.{lite,served,O}.txt, verdicts.jsonl seeded with the
 *                                   pilot's verdicts of O (so confirm.mjs judge --retest=O gives O a row from this sitting)
 *   arms.mjs fresh --scratch=DIR [--sets=A,B] [--reader=agy]
 *                                   F: Opus reads the image alone, one page a call. Refusal or no answer writes no text
 *                                   (the arm serves nothing there and analyze.mjs counts it not accepted)
 *                                   --reader=agy is FF: Flash 3.8 low, same prompt, same rule (zh-siku-route-matrix-7263)
 */
import '../router-confirm/readonly-mongo.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { bodyCharCount } from '../../lib/paddle-print-lane.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { ocrReadProblem, OCR_SENTINEL_INSTRUCTION } from '../../lib/cli-chatter.mjs';
import { checkWrittenText } from '../../lib/write-text-guard.mjs';
import { callInstruction, splitPages } from '../../batch/claude-ocr.mjs';
import { claudeCall } from '../../batch/ocr-convergence/correct.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SCR = path.resolve(arg('scratch'));
const IN = path.join(HERE, 'input');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha16 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const judged = rj(path.join(IN, 'judged.json'));
const SETS = arg('sets', 'one,ten').split(',');   // zh-siku-route-matrix-7263: --sets=setA,setB, any dir with a plan.json
const READER = arg('reader', 'opus');   // agy: FF, Flash 3.8 low reads the image alone, in the gated workspace cli-ocr.mjs uses
const ARM = READER === 'agy' ? 'FF' : 'F', ROUTE = READER === 'agy' ? 'agy-flash-low-read' : 'opus-read', AGY_MODEL = 'gemini-3.8-flash-low';

function setup() {
  const score = rj(path.join(IN, 'pilot-score.json'));
  for (const set of SETS) {
    const OUT = path.join(SCR, set), rows = new Map(score.sets[set].rows.map((r) => [r.key, r]));
    fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
    const selected = [], seed = [];
    for (const j of judged.filter((x) => x.set === set)) {
      const S = fs.readFileSync(path.join(IN, 'texts', `${j.key}.S.txt`), 'utf8'), O = fs.readFileSync(path.join(IN, 'texts', `${j.key}.O.txt`), 'utf8');
      for (const [a, t] of [['lite', S], ['served', S], ['O', O]]) fs.writeFileSync(path.join(OUT, 'texts', `${j.key}.${a}.txt`), t);
      selected.push({ key: j.key, book_id: j.book_id, title: j.title, page_id: j.page_id, page_number: j.page_number, image: j.image, set, position: j.position, block: [j.page_id], han: bodyCharCount(S) });
      const r = rows.get(j.key), h = sha16(O);
      seed.push({ id: `${j.key}:${h}`, set: 'abs', key: j.key, page_id: j.page_id, text_sha: h, arms: ['O'], pilot: true, verdict: { accept: r.accept, fidelity: r.fidelity, defects: r.defects, reader_note: r.summary }, at: score.at });
    }
    fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify({ at: new Date().toISOString(), cell: `zh-print-arms/${set}`, stratum: 'print', lang_name: 'Chinese', issue: 7263, rule: { within: 0.08, wrong_text_max: 0.04, source: 'rules.json switch' }, arms: [{ arm: 'served', route: 'gemini-stored', kind: 'stored', calls_per_page: 0 }, { arm: 'O', route: `gemini>opus@${set === 'one' ? 1 : 10}`, kind: 'correct', calls_per_page: 1 }], selected }, null, 1));
    const vf = path.join(OUT, 'verdicts.jsonl');
    if (!fs.existsSync(vf)) fs.writeFileSync(vf, seed.map((x) => JSON.stringify(x)).join('\n') + '\n');
    console.log(set, selected.length, 'pages');
  }
}

async function fresh() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const { base, ref } = await liveOcrPrompt(c.db('bookstore'));
  await c.close();
  const agy = READER === 'agy' ? await import('../../lib/agy-cli.mjs') : null;
  const sent = agy ? `${base}\n\nThe page image to transcribe is the file ./image.jpg in this directory. ${agy.OCR_READ_FILE_INSTRUCTION} Then transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n` : base + callInstruction(1);
  const queue = [];
  for (const set of SETS) {
    const OUT = path.join(SCR, set), P = rj(path.join(OUT, 'plan.json'));
    if (!P.arms.some((a) => a.arm === ARM)) { P.arms.push({ arm: ARM, route: ROUTE, kind: 'read', calls_per_page: 1 }); fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(P, null, 1)); }
    const R = path.join(OUT, `set-${ARM}`); fs.mkdirSync(path.join(R, 'transcripts'), { recursive: true });
    fs.writeFileSync(path.join(R, 'prompt.txt'), sent); fs.writeFileSync(path.join(R, 'prompt-ref.json'), JSON.stringify(ref));
    const seen = new Set(fs.existsSync(path.join(OUT, 'arms.jsonl')) ? fs.readFileSync(path.join(OUT, 'arms.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.arm === ARM).map((r) => r.key) : []);
    for (const s of P.selected) if (!seen.has(s.key)) queue.push({ OUT, R, s });
  }
  console.log(`${queue.length} pages to read; prompt ${ref.name} v${ref.version}; ${sent.length} chars`);
  let stop = null;
  const one = async ({ OUT, R, s }) => {
    let img = path.join(OUT, 'img', `${s.key}.jpg`);
    if (!fs.existsSync(img)) { const r = await fetch(s.image, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' } }); if (!r.ok) throw new Error(`image HTTP ${r.status} ${s.key}`); fs.mkdirSync(path.dirname(img), { recursive: true }); fs.writeFileSync(img, Buffer.from(await r.arrayBuffer())); }
    let why = 'no answer', text = null;
    for (let attempt = 0; attempt < 2 && !text && !stop; attempt++) {
      const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zh-fresh-'));
      fs.copyFileSync(img, path.join(dir, agy ? 'image.jpg' : 'p01.jpg'));
      let r, ans;
      if (agy) {
        const log = agy.installToolGate(dir, { task: 'ocr' });
        const a = await agy.agyCall(['-p', sent, '--model', AGY_MODEL, ...agy.CLI_SAFE_ARGS], dir);
        const u = agy.unwrapRead(a.text);
        r = { cls: a.cls === 'quota' ? 'usage_limit' : a.cls || (u.problem && 'wrapper') || null, err: a.err, text: a.text, model: AGY_MODEL, secs: a.secs, usage: agy.agyUsage(a.usage), opened: new Set(agy.gateReads(log).map((f) => path.basename(f)).map((f) => (f === 'image.jpg' ? 'p01.jpg' : f))) };
        ans = r.cls ? null : u.text;
      } else {
        r = await claudeCall(sent, dir, path.join(R, 'transcripts', `${s.key}-${attempt}.jsonl`));
        ans = r.cls ? null : splitPages(r.text, 1)?.[0] ?? null;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      why = r.cls ? r.cls : !ans ? 'markers do not match' : !r.opened.has('p01.jpg') ? 'image not opened' : ocrReadProblem(ans) ? `chatter guard: ${ocrReadProblem(ans)}` : checkWrittenText(ans, { kind: 'ocr' }).verdict === 'truncated' ? 'truncated' : 'written';
      fs.appendFileSync(path.join(R, 'calls.jsonl'), JSON.stringify({ ts: new Date().toISOString(), key: s.key, attempt, model: r.model, secs: Math.round(r.secs), cls: r.cls, why, opened: [...r.opened], usage: r.usage }) + '\n');
      if (r.cls === 'usage_limit') { stop = r.err || 'usage limit'; return; }
      if (why === 'written') text = ans;
    }
    if (stop) return;
    if (text) fs.writeFileSync(path.join(OUT, 'texts', `${s.key}.${ARM}.txt`), text);
    fs.appendFileSync(path.join(OUT, 'arms.jsonl'), JSON.stringify({ key: s.key, arm: ARM, route: ROUTE, written: !!text, why, at: new Date().toISOString() }) + '\n');
    console.log(`  ${s.key}: ${why} ${text ? text.length : ''}`);
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 3)) }, async () => { while (queue.length && !stop) await one(queue.shift()); }));
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}

const stage = process.argv[2];
if (stage === 'setup') setup(); else if (stage === 'fresh') await fresh(); else { console.error('stages: setup | fresh'); process.exit(2); }
