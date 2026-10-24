#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/units.mjs — production's one-page request (buildTranslationPrompt +
// PAGE_BREAK_SCOPED, no context) from a pinned v13 copy on the main box. This builds the same request from the live
// default prompt (loadTranslationPrompts, v13 today) for #6948's 60 sample pages; it checks the version is still 13.
/**
 * requests.mjs — read-only, $0. Writes $JOB_SCRATCH/req.jsonl {uid, prompt, prompt_ref} (the agy arms, byte for byte)
 * and $JOB_SCRATCH/req-opus.jsonl (the same prompt + #6545's TRANSLATE_SUFFIX, for claude-arm.py).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';

const S = process.env.JOB_SCRATCH;
const TRANSLATE_SUFFIX = '\n\nDo not open, read or write any file and do not use any tool: the text is above. Write the translation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.\n';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const prompts = await loadTranslationPrompts(c.db('bookstore'));
await c.close();
if (Number(prompts.translation.ref.version) !== 13) throw new Error(`default translation prompt is v${prompts.translation.ref.version}, prereg says v13`);
const pages = fs.readFileSync(`${S}/sample-pages.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const req = [], op = [];
let leaf = 0;
for (const p of pages) {
  if (!p.book || !p.ocr) throw new Error(`${p.id}: no book or no text`);
  const r = buildTranslationPrompt({ prompts, book: p.book, ocrText: p.ocr, pageBreak: PAGE_BREAK_SCOPED });
  if (r.pageBreak?.leafSeams) leaf++;
  req.push({ uid: p.id, prompt: r.prompt, prompt_ref: r.promptRef });
  op.push({ uid: p.id, prompt: r.prompt + TRANSLATE_SUFFIX });
}
fs.writeFileSync(`${S}/req.jsonl`, req.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(`${S}/req-opus.jsonl`, op.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(req.length, 'requests; prompt', JSON.stringify(prompts.translation.ref), '; leaf rule on', leaf, '; chars', req.reduce((s, x) => s + x.prompt.length, 0));
