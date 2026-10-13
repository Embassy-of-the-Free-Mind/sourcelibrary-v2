#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-stale-english-6388/controls-pick.mjs (#6518 picked control pages outside its draw;
// here the plants go INTO 8 of the step-2 pages, so the stored English the arms and judges see carries them).
// Draws the 8 pages (seed 6570) from the pages that passed step 1 and prints their stored English, so the plants can
// be written by hand into plants.json. No model, no Mongo.
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const fin = JSON.parse(fs.readFileSync(path.join(HERE, 'ocr-final.json'))).filter(r => r.material === false).map(r => r.qid).sort();
const rng = makeRng(6570);
for (let i = fin.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [fin[i], fin[j]] = [fin[j], fin[i]]; }
const pick = fin.slice(0, 8).sort();
console.log(JSON.stringify(pick));
if (process.argv[2] === '--show') {
  const qmap = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'packet-map.json'))).items.map(i => [i.qid, i.page_id]));
  const pages = new Map(JSON.parse(fs.readFileSync(path.join(process.env.JOB_SCRATCH, 'pages.json'))).map(p => [p.page_id, p]));
  for (const q of pick) { const p = pages.get(qmap.get(q)); console.log(`\n######## ${q} ${p.page_id} ${p.bin}\n${p.paddle}\n----\n${p.english}\n---- hunks: ${p.hunks.map(h => h.id + ':' + h.old + '→' + h.new).join(' ')}`); }
}
