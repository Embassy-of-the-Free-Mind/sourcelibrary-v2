#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/judge.mjs (runQueue's pace guard and resume-from-file; imageFor's fetch-once
// and resize over 4 MB — restated here because that file runs its stage dispatch on import). The instruments are
// imported unchanged: correction-pass-7818 judgeAbsolute (= route-judge-6740 judgePrompt task 'ocr', Opus, claude -p,
// image in the workspace: the #7866 bar) and route-judge-6740 judgePrompt task 'tr' + opusCall + parseVerdict (the
// same judge's translation form, so OCR and English defects carry the same severities). The form/script read is new:
// #7947 had reviewers state the form inside REVIEWER.md; this study's judges are #7866's and do not report it.
/**
 * #7991 stage 2: judging. Blind — a call sees the language, one text and the image, never the stratum, the
 * catalogue form, the engine or the other lane's verdict. Nothing here writes to Mongo.
 *
 *   node scripts/eval/sa-gr-served-7991/judge.mjs images | form | ocr | tr   [--concurrency=3] [--max-calls=N]
 *
 * OUT/form.jsonl, OUT/verdicts-ocr.jsonl, OUT/verdicts-tr.jsonl (one row a page; a reply that does not parse is tried
 * again, at most 3 times).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { judgeAbsolute, paceCheck, sha } from '../correction-pass-7818/lib.mjs';
import { judgePrompt, opusCall, parseVerdict } from '../route-judge-6740/judge.mjs';
import { OUT, arg } from './lib.mjs';

const sample = JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const MAX_IMAGE_BYTES = 4e6, RESIZE_PX = 3000;

async function imageFor(it) {
  const f = path.join(OUT, 'img', `${it.page_id}.jpg`);
  let buf = fs.existsSync(f) ? fs.readFileSync(f) : null;
  if (!buf) {
    const r = await fetch(it.image, { headers: { 'User-Agent': 'SourceLibrary-eval/7991 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw new Error(`image HTTP ${r.status} ${it.image.slice(0, 100)}`);
    buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    const { default: sharp } = await import('sharp');
    fs.renameSync(f, `${f}.orig`);
    buf = await sharp(buf).resize(RESIZE_PX, RESIZE_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    fs.writeFileSync(f, buf);
  }
  return buf;
}

const FORM_PROMPT = (lang) => `Open the file ./page.jpg in your working directory with Read. It is a photograph of one page of a ${lang} book.
Look only at the image and answer three questions about the MAIN text block:
- form: "print" (set in type, including lithograph and photo-reproduction of print), "manuscript" (written by hand, including a lithographed or photographed manuscript), or "mixed" (a printed page with substantial handwritten text, or the reverse).
- script: the script of the main text, one of "Devanagari", "Sarada", "Bengali", "Grantha", "Telugu", "Malayalam", "Nandinagari", "Newari", "Greek", "Latin" (romanised), or "other: <name>".
- note: one line, what you see (e.g. "palm-leaf, 7 lines, Śāradā with Devanāgarī marginal note"; "printed polytonic Greek with Latin facing column").
Answer with one JSON object only: {"form": "...", "script": "...", "note": "..."}`;

async function formJob(it) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f7991-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), await imageFor(it));
    const r = await opusCall(FORM_PROMPT(it.language), ws);
    let v = null; try { v = JSON.parse(String(r.text).match(/\{[\s\S]*\}/)[0]); if (!['print', 'manuscript', 'mixed'].includes(v.form)) v = null; } catch { v = null; }
    return { page_id: it.page_id, verdict: v, cls: r.cls, model: r.model, usage: r.usage, raw: String(r.text).slice(0, 300) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}
async function ocrJob(it) {
  const r = await judgeAbsolute({ lang: it.language, text: it.ocr }, await imageFor(it));
  return { page_id: it.page_id, text_sha: sha(it.ocr.trim()).slice(0, 16), ...r };
}
async function trJob(it) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 't7991-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), await imageFor(it));
    const prompt = judgePrompt({ task: 'tr', lang: it.language, source: it.ocr, text: it.translation }, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
    const t0 = Date.now(), r = await opusCall(prompt, ws);
    return { page_id: it.page_id, text_sha: sha(it.translation.trim()).slice(0, 16), verdict: r.cls === 'quota' ? null : parseVerdict(r.text), cls: r.cls, model: r.model,
      usage: r.usage, list_usd: r.cost, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), raw: String(r.text).slice(0, 400) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

async function run(file, job) {
  const rows = jsonl(file), have = new Set(rows.filter((r) => r.verdict).map((r) => r.page_id));
  const tries = new Map(); for (const r of rows) if (!r.verdict) tries.set(r.page_id, (tries.get(r.page_id) ?? 0) + 1);
  const todo = sample.filter((it) => !have.has(it.page_id) && (tries.get(it.page_id) ?? 0) < 3);
  console.log(`${path.basename(file)}: ${todo.length} pages to judge`);
  const limits = await import('../../lib/model-limits.mjs');
  const state = {}, max = Number(arg('max-calls') ?? Infinity), conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  let i = 0, calls = 0, stop = null;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < todo.length && calls < max) {
      let why = await paceCheck(limits, state);
      // An unreadable meter still blocks every call (fail closed), but it is often a busy usage endpoint: wait and
      // read it again, up to 30 times, before giving up.
      for (let w = 0; why && /meter unreadable/.test(why) && w < 30 && !stop; w++) {
        await new Promise((r) => setTimeout(r, 60e3 + Math.random() * 30e3));
        state.at = 0; why = await paceCheck(limits, state);
      }
      if (why) { stop = why; break; }
      if (i >= todo.length) break;
      const it = todo[i++]; calls++;
      let rec; try { rec = await job(it); } catch (e) { rec = { page_id: it.page_id, verdict: null, err: String(e.message || e).slice(0, 200) }; }
      if (rec.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(rec.raw || '').slice(0, 200) }); stop = 'quota reply'; break; }
      fs.appendFileSync(file, JSON.stringify({ ...rec, at: new Date().toISOString() }) + '\n');
      const v = rec.verdict;
      console.log(`  ${it.language} ${it.page_id}: ${v ? (v.form ? `${v.form} ${v.script}` : `accept=${v.accept} f${v.fidelity} d${(v.defects || []).length}`) : rec.err ? `ERR ${rec.err}` : 'unparsed'}`);
    }
  }));
  console.log(`${calls} calls; ${stop ? `STOPPED: ${stop}` : 'queue done'}`);
}

const stages = {
  images: async () => { for (const it of sample) await imageFor(it); console.log(`images: ${sample.length}`); },
  form: () => run(path.join(OUT, 'form.jsonl'), formJob),
  ocr: () => run(path.join(OUT, 'verdicts-ocr.jsonl'), ocrJob),
  tr: () => run(path.join(OUT, 'verdicts-tr.jsonl'), trJob),
};
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
