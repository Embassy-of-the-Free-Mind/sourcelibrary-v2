#!/usr/bin/env node
// PRIOR ART: none — searched scripts/eval/paddle-zh-qa-6388/ and scripts/eval/lib/ for a check of a reviewer's
// error attribution against the texts; the qa3 scorer only counts verdicts. $0, no model, no Mongo.
// For every material OCR/BOTH error in the final lists of the random-arm pages: does the Chinese the reviewer quotes
// (its longest Han run, folded) occur in the Paddle reading but NOT in the superseded one? That is what "the old
// reading was wrong here and the new one is right" predicts, so it checks the attribution mechanically.
//   node scripts/eval/paddle-stale-english-6388/attribution-check.mjs   → prints counts; adds attribution to results.json
import fs from 'node:fs';
import path from 'node:path';
import { bodyText, foldHan } from '../ground-truth-5935/lib.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const res = JSON.parse(fs.readFileSync(path.join(HERE, 'results.json'), 'utf8'));
const texts = new Map(JSON.parse(fs.readFileSync(path.join(process.env.JOB_SCRATCH, 'draw-texts.json'))).map(t => [t.page_id, t]));
const draw = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8')).items.map(d => [d.book_id, d.page_id]));
const tally = { errors: 0, quoted: 0, in_new_not_old: 0, in_both: 0, in_old_only: 0, in_neither: 0 };
const pagesWith = new Set();
for (const p of res.pages.filter(p => p.arm === 'random' && p.ocr_material)) {
  const t = texts.get(draw.get(p.book_id));
  const o = foldHan(bodyText(t.old)), n = foldHan(bodyText(t.paddle));
  for (const e of p.material_errors.filter(e => /OCR|BOTH/i.test(e.cause))) {
    tally.errors++;
    const run = (foldHan(String(e.image_says || '').split(/[—–-]/)[0]).match(/\p{Script=Han}{2,}/gu) || []).sort((a, b) => b.length - a.length)[0];
    if (!run) continue;
    tally.quoted++;
    const inN = n.includes(run), inO = o.includes(run);
    const k = inN && !inO ? 'in_new_not_old' : inN && inO ? 'in_both' : inO ? 'in_old_only' : 'in_neither';
    tally[k]++;
    if (k === 'in_new_not_old') pagesWith.add(p.qid);
  }
}
tally.pages_ocr_material = res.pages.filter(p => p.arm === 'random' && p.ocr_material).length;
tally.pages_with_a_confirmed_error = pagesWith.size;
res.attribution_check = tally;
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(res, null, 1) + '\n');
console.log(tally);
