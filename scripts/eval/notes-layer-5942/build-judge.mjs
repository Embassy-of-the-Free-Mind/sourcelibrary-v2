#!/usr/bin/env node
// PRIOR ART: scripts/eval/plain-6728/build-packet.py (#6728) — one item per call, candidates shuffled per page,
// a planted control; it judges against a published reference, which these pages do not have, so the prompt is
// JUDGE-PROMPT.md (#6545's rubric with the reference cut) and the packet is built here from Part B's arms.
/**
 * #5942 Part B (a): blind fidelity packets. $0, no database.
 *   node scripts/eval/notes-layer-5942/build-judge.mjs
 * Reads $W/pages.json and $W/out/{T,S,P}.jsonl. Writes $W/judge/{opus,gemini}.jsonl (request rows for
 * plain-6728/run-arm.mjs) and $W/judge/key.json (label → arm, plants). Bodies: arms.mjs layersOf (Part A's parser).
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeRng } from '../lib/paired-stats.mjs';
import { W, readJsonl, layersOf } from './arms.mjs';
import { md5 } from '../plain-6728/prompts.mjs';

const SEED = 5942;
const JUDGE = fs.readFileSync(new URL('./JUDGE-PROMPT.md', import.meta.url), 'utf8').replace(/^<!--[\s\S]*?-->\n/, '');
const pages = JSON.parse(fs.readFileSync(`${W}/pages.json`, 'utf8'));
const out = Object.fromEntries(['T', 'S', 'P'].map((a) => [a, new Map(readJsonl(`${W}/out/${a}.jsonl`).filter((r) => r.text).map((r) => [r.uid, r]))]));
const PLANT_PAGES = new Set(pages.filter((p) => /-(1|2)$/.test(p.uid)).map((p) => p.uid));

// Plants: one error in a copy of the T body (the arm is irrelevant; the judge must find the error).
const plantIn = pages.filter((p) => PLANT_PAGES.has(p.uid) && out.T.has(p.uid)).map((p, i) => ({ key: p.uid, text: layersOf('T', out.T.get(p.uid).text).body, kinds: [['negation', 'number', 'name', 'clause'][i % 4]], seed: SEED + i }));
const planted = new Map(JSON.parse(execFileSync('node', [new URL('../pro-translate-6545/plant.mjs', import.meta.url).pathname], { input: JSON.stringify(plantIn) }).toString()).filter((x) => x.plants.length).map((x) => [x.key, x]));

const rng = makeRng(SEED);
const key = {};
const rows = [];
let missing = 0;
for (const p of pages) {
  if (!['T', 'S', 'P'].every((a) => out[a].has(p.uid))) { missing++; continue; }
  const cands = ['T', 'S', 'P'].map((a) => ({ arm: a, text: layersOf(a, out[a].get(p.uid).text).body }));
  if (planted.has(p.uid)) cands.push({ arm: 'PLANT', text: planted.get(p.uid).text });
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  const labels = Object.fromEntries(cands.map((c, i) => [`T${i + 1}`, c.arm]));
  key[p.uid] = { labels, plant: planted.get(p.uid)?.plants ?? null };
  const item = { id: p.uid, source: p.ocr, source_prev_tail: p.prev_tail || undefined, source_next_head: p.next_head || undefined, translations: Object.fromEntries(cands.map((c, i) => [`T${i + 1}`, c.text])) };
  const prompt = `${JUDGE}\n\nITEM:\n${JSON.stringify(item)}\n`;
  rows.push({ uid: p.uid, lang: p.lang, prompt, prompt_hash: md5(prompt) });
}
// The Gemini half: a seeded 20, 5 per language.
const r2 = makeRng(SEED + 7);
const gem = [];
for (const lang of ['Latin', 'German', 'Greek', 'Chinese']) {
  const l = rows.filter((r) => r.lang === lang);
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  gem.push(...l.slice(0, 5));
}
fs.mkdirSync(`${W}/judge`, { recursive: true });
fs.writeFileSync(`${W}/judge/opus.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${W}/judge/gemini.jsonl`, gem.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${W}/judge/key.json`, JSON.stringify(key, null, 1));
console.log(`${rows.length} items (${missing} pages missing an arm), ${planted.size} planted, gemini half ${gem.length}`);
