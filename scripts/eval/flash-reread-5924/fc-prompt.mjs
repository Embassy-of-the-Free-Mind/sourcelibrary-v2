#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/correct.mjs `correctInstruction(n)` (the Opus arm's correction block, #7258)
//   and scripts/eval/tibetan-correct-6560/corr-prompt.txt (the one-page {draft} template cli-ocr.mjs correct mode was
//   built for). Neither is a one-page agy prompt for Latin: this writes one, from the first with the fewest changes.
// fc-prompt.mjs <out-file> — the Flash-correction arm's prompt (#5924, PREREGISTRATION-flash-correct.md): the live OCR
//   prompt (liveOcrPrompt, as correct.mjs sends it) + correctInstruction(1) adapted to one page sent through
//   `cli-ocr.mjs read --correct-prompt`: the draft is inline in the {draft} slot instead of a file, the image is the
//   attachment cli-ocr appends after the template (` @./<page_id>.jpg`) instead of p01.jpg, there is no Read tool to
//   name, and the answer goes between the <<<BEGIN>>>/<<<END>>> markers cli-ocr unwraps. First checks that the live
//   prompt is still the one the Opus arm sent: contentHash(base + correctInstruction(10)) must be its 1e710a51c1fe8355.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import { correctInstruction } from '../../batch/ocr-convergence/correct.mjs';
const out = process.argv[2]; if (!out) { console.error('usage: fc-prompt.mjs <out-file>'); process.exit(2); }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const { base, ref } = await liveOcrPrompt(c.db('bookstore')); await c.close();
const opus = contentHash(base + correctInstruction(10));
if (opus !== '1e710a51c1fe8355') { console.error(`live OCR prompt changed since the Opus arm: ${opus}`); process.exit(1); }
const one = correctInstruction(1)
  .replace('correct 1 existing transcription', 'correct one existing transcription')
  .replace('In this folder, p01.jpg with d01.txt. Each image is a page of one book; each .txt file is the transcription a library currently gives readers for that page, made by an OCR engine.',
    'The image, attached at the end of this message, is a page of one book. The draft, between the lines DRAFT START and DRAFT END below, is the transcription a library currently gives readers for that page, made by an OCR engine.')
  .replace('Open every image and every draft with the Read tool. The IMAGE is the authority.', 'Open the image. The IMAGE is the authority.')
  .replace('For each page, check the draft', 'Check the draft')
  .replace('Answer with, for each page in order, a line `===== PAGE pNN =====` (the image name without .jpg) followed by that page\'s answer. Output nothing before the first marker and no commentary anywhere.',
    `Write your one answer (UNCHANGED, CONTAIN: …, or the corrected transcription) between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.`);
if (one === correctInstruction(1) || /Read tool|PAGE pNN|d01\.txt/.test(one)) { console.error('correctInstruction(1) changed; the adaptation no longer applies'); process.exit(1); }
const tpl = `${base}${one}\nDRAFT START\n{draft}\nDRAFT END\n\nThe page image:`;
fs.writeFileSync(out, tpl);
console.log(JSON.stringify({ out, live_prompt: ref, opus_sent_hash_check: opus, template_hash: contentHash(tpl) }));
