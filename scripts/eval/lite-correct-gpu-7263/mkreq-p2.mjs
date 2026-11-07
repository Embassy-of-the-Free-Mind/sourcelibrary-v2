#!/usr/bin/env node
// PRIOR ART: scripts/lib/live-ocr-prompt.mjs (the live OCR prompt), scripts/batch/ocr-convergence/correct.mjs
// correctInstruction (the production correct instruction, written for sealed files in a folder, N pages a call) and
// scripts/eval/stale-correct-6561/prompt-v2.mjs RULE_V2 (keep the page's own forms; no notes). None is a one-page,
// inline-image prompt, so this adapts correctInstruction(1) by asserted string replacements (PREREG amendment 1).
// Usage (READ-ONLY on Mongo): node --env-file=… mkreq-p2.mjs <zh scratch> <tib scratch>
//   writes <zh>/req-p2.jsonl, <tib>/req/p2-corr.jsonl, <tib>/req/p2-corr-anchor.jsonl, and prompt-p2.json beside each
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { correctInstruction } from '../../batch/ocr-convergence/correct.mjs';
import { RULE_V2 } from '../stale-correct-6561/prompt-v2.mjs';
import { sha } from '../paddle-correct-6561/batch/prompt.mjs';

const [, , ZH, TIB] = process.argv;
const swap = (s, from, to) => { if (!s.includes(from)) throw new Error(`correctInstruction drift: no "${from.slice(0, 60)}"`); return s.replace(from, to); };
let ins = correctInstruction(1);
ins = swap(ins, '**This call: correct 1 existing transcription against the page image.** In this folder, p01.jpg with d01.txt. Each image is a page of one book; each .txt file is',
  '**This call: correct an existing transcription against the page image.** The attached image is a page of a book; the draft below, between ===DRAFT=== and ===END DRAFT===, is');
ins = swap(ins, ' Open every image and every draft with the Read tool.', '');
ins = swap(ins, 'For each page, check the draft', 'Check the draft');
ins = ins.replace(/Answer with, for each page in order, a line `===== PAGE pNN =====`[^\n]*\n/, () => 'Output nothing but that answer, and no commentary anywhere.\n');
if (/PAGE pNN|Read tool|\.txt/.test(ins)) throw new Error('correctInstruction drift: a file/marker phrase survived the adaptation');

const c = await MongoClient.connect(process.env.MONGODB_URI);
const { base, ref } = await liveOcrPrompt(c.db('bookstore'));
await c.close();
const prompt = (draft) => `${base}${ins}${RULE_V2}\n===DRAFT===\n${String(draft).trim()}\n===END DRAFT===\n`;
const meta = { ocr_prompt: ref, base_sha: sha(base), instruction_sha: sha(ins), rule_v2_sha: sha(RULE_V2), template_sha: sha(prompt('')), instruction: ins };
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const W = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// Chinese: the drafts the P1 requests carried (sets.json Paddle text; plants from anchors.json)
const sets = JSON.parse(fs.readFileSync(`${ZH}/sets.json`, 'utf8'));
const anchors = JSON.parse(fs.readFileSync(`${ZH}/anchors.json`, 'utf8'));
W(`${ZH}/req-p2.jsonl`, [...sets.map((s) => ({ uid: s.uid, image: s.image, draft: s.paddle, prompt: prompt(s.paddle) })),
  ...anchors.map((a) => { const s = sets.find((x) => x.uid === a.base_uid); return { uid: a.uid, image: s.image, draft: a.draft, prompt: prompt(a.draft) }; })]);
fs.writeFileSync(`${ZH}/prompt-p2.json`, JSON.stringify(meta, null, 1));
// Tibetan: the draft inside each prep.py CORR request
for (const k of ['corr', 'corr-anchor']) {
  W(`${TIB}/req/p2-${k}.jsonl`, readJsonl(`${TIB}/req/${k}.jsonl`).map((q) => { const d = q.prompt.split('\nDraft:\n')[1]; if (!d) throw new Error(`${q.uid}: no draft`); return { uid: q.uid, image: q.image, draft: d, prompt: prompt(d) }; }));
}
fs.writeFileSync(`${TIB}/prompt-p2.json`, JSON.stringify(meta, null, 1));
console.log(`P2: OCR prompt ${ref.name} v${ref.version}; template ${meta.template_sha}; zh ${sets.length + anchors.length}, tib requests written`);
