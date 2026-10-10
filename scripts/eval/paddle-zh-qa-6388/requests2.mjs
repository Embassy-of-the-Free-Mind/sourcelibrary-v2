#!/usr/bin/env node
// PRIOR ART: prepare.mjs `packet` (this folder) — the blind R-request packet; this builds the second-round requests from
// the first round's outputs, which that stage cannot (it runs before any reviewer). No model call, no Mongo. $0.
//
// #6388 Paddle zh QA, round 2 requests:
//   import-r3     the first job's Gemini Pro arm (written as "R2" in worktree job-paddle-qa-6388) → reads/R3.jsonl
//   adjudicate    sample pages where R1 and R2 give different verdicts → $JOB_SCRATCH/adj-requests.jsonl (arm A, Opus high)
//                 The two error lists are shown as "Reviewer A"/"Reviewer B" in makeRng(6394 ^ h(uid)) order, no names.
//   xreview       each transcription arm reviewed by the OTHER family (family rule):
//                 TO (Opus) → Gemini 3.8 Flash High, $JOB_SCRATCH/xr-TO-requests.jsonl (arm XTO)
//                 TG (Gemini) → Opus, $JOB_SCRATCH/xr-TG-requests.jsonl (arm XTG)
//                 Opaque ids (x001…, y001…) in makeRng(6395) order; map in xreview-map.json.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH || '/tmp/paddle-qa-6388';
const H = f => path.join(HERE, f);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const hseed = (s, id) => s ^ parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16);
const shuffle = (xs, seed) => { const a = [...xs], r = makeRng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const safe = uid => uid.replace(/[^\w.-]/g, '_');
const img = uid => path.join(SCRATCH, 'img', `${safe(uid)}.jpg`);
const PROMPT = fs.readFileSync(H('prompt.txt'), 'utf8');
// review-opus.mjs parseReview, copied: importing that file would start a run.
function parse(s) {
  const t = String(s || '').replace(/^```(?:json)?\s*|```\s*$/gm, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(t.slice(a, b + 1)); return j && typeof j.verdict === 'string' ? j : null; } catch { return null; }
}
const lastByUid = rows =>new Map(rows.map(r => [r.uid, r]));
// qid → uid for the 60 sample rows (repeats and plants are controls, not adjudicated)
const sampleQ = () => readJson(H('packet-map.json')).items.filter(i => i.role === 'sample');

const stage = process.argv[2];
if (stage === 'import-r3') {
  const src = process.argv[3] || '/mnt/HC_Volume_105839809/worktrees/job-paddle-qa-6388/scripts/eval/paddle-zh-qa-6388/reads/R2.jsonl';
  const rows = readJsonl(src).map(r => ({ ...r, arm: 'R3', arm_as_run: r.arm }));
  writeJsonl(H('reads/R3.jsonl'), rows);
  console.log('R3 rows', rows.length, 'models', [...new Set(rows.map(r => r.model))].join(','));
} else if (stage === 'adjudicate') {
  const r1 = lastByUid(readJsonl(H('reads/R1.jsonl'))), r2 = lastByUid(readJsonl(H('reads/R2.jsonl')));
  const texts = lastByUid(readJsonl(H('texts.jsonl')));
  const reqs = [], map = [];
  for (const it of sampleQ()) {
    const a = r1.get(it.qid)?.json, b = parse(r2.get(it.qid)?.text);
    if (!a || !b) { console.log('missing review', it.qid, !!a, !!b); continue; }
    if (a.verdict === b.verdict) continue;
    const flip = makeRng(hseed(6394, it.uid))() < 0.5;
    const [A, B] = flip ? [b, a] : [a, b];
    const lists = `\n\nTWO EARLIER REVIEWS of this same transcription disagree on the page verdict. They are shown below in random order; either may be wrong, and both may have missed errors. Check every listed error against the image yourself, keep only the real ones, add any they both missed, and give your own final error list and verdict by the definitions above.\n\nREVIEWER A (verdict ${A.verdict}): ${JSON.stringify(A.errors || [])}\n\nREVIEWER B (verdict ${B.verdict}): ${JSON.stringify(B.errors || [])}\n\n`;
    const prompt = PROMPT.replace('{TRANSCRIPTION}', texts.get(it.uid).text).replace(/\n*The page image:\s*$/, lists + 'The page image:');
    const qid = `a${it.qid.slice(1)}`;
    reqs.push({ uid: qid, image: img(it.uid), prompt });
    map.push({ qid, uid: it.uid, review_qid: it.qid, A: flip ? 'R2' : 'R1', B: flip ? 'R1' : 'R2', r1: a.verdict, r2: b.verdict });
  }
  writeJsonl(path.join(SCRATCH, 'adj-requests.jsonl'), reqs);
  fs.writeFileSync(H('adjudication-map.json'), JSON.stringify({ seed: 6394, items: map }, null, 1) + '\n');
  console.log('adjudication requests', reqs.length);
} else if (stage === 'xreview') {
  const out = { seed: 6395, items: [] };
  for (const [arm, pre] of [['TO', 'x'], ['TG', 'y']]) {
    const rows = lastByUid(readJsonl(H(`reads/${arm}.jsonl`)));
    const reqs = [];
    shuffle([...rows.values()].filter(r => r.text && !r.error), 6395).forEach((r, i) => {
      const qid = `${pre}${String(i + 1).padStart(3, '0')}`;
      reqs.push({ uid: qid, image: img(r.uid), prompt: PROMPT.replace('{TRANSCRIPTION}', r.text) });
      out.items.push({ qid, uid: r.uid, arm, text_sha: createHash('sha256').update(r.text).digest('hex').slice(0, 16) });
    });
    writeJsonl(path.join(SCRATCH, `xr-${arm}-requests.jsonl`), reqs);
    console.log(`xreview ${arm}`, reqs.length);
  }
  fs.writeFileSync(H('xreview-map.json'), JSON.stringify(out, null, 1) + '\n');
} else {
  console.log('stages: import-r3 | adjudicate | xreview');
}
