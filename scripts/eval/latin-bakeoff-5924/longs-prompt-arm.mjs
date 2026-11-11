#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/gemini-arm.mjs (the L arm of the bake-off: same model, temperature 0,
// thinking 0, 16,000-token cap, same fed images; it ran the GENERIC prompt, this runs production's LIVE prompt);
// scripts/eval/lib/production-prompt.mjs (the live prompt, read from Mongo as the pipeline reads it);
// scripts/lib/ocr-long-s-retry.mjs (LONG_S_LINE and its anchor, used unchanged); scripts/eval/long-s-tcp-ab.mjs
// (the English A/B of that line, #5488). This adds the explicit-rule and visual-example arms for Latin (#5924).
//   node --env-file=.env.production.local longs-prompt-arm.mjs <img dir> <out.jsonl> --arm L0|L0b|L1|L2|L3|L4
//        [--examples <dir with roman.jpg, italic.jpg>] [--parallel 8] [--max-cost 3] [--dump-prompt]
// Arms (PREREGISTRATION-longs-prompt-5924.md): L0 live prompt; L0b = L0 again (noise floor); L1 = L0 + LONG_S_LINE;
// L2 = L1 + LONG_S_RULE; L3 = L2 + two example crops (roman, italic) sent before the page; L4 = L2, thinking 1,024.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';
import { LONG_S_LINE, LONG_S_ANCHOR, withLongSLine } from '../../lib/ocr-long-s-retry.mjs';

export const LONG_S_RULE = '**How to tell ſ from f:** ſ is a tall letter with no crossbar on the right of the stem (at most a small nub on the left); in f the crossbar crosses the stem on both sides. ſ never ends a word: a word-final s is always the short s. ſ is common in the ligatures ſſ, ſt, ſp, ſi, ſl, ſb, ſh, ſk: "eſſe", "eſt", "ſpiritus", "ipſi" — not "effe", "eft", "fpiritus", "ipfi". When unsure between ſ and f, check whether the result is a Latin word.';
export const EXAMPLES_LINE = '**Example images:** The first two images are NOT the page. They are crops from another book of the period, shown only so you can see ſ next to f; do not transcribe them. Transcribe only the LAST image, the page.\n- Image 1 (roman type) reads: "centos philippæos pro iis poſtulaverit, & ob pretii magnitu- / dinem à rege fuerit deriſa, tres de iis combuſſerit, & cùm / idem pretium pro ſex reliquis peteret, denuò à rege inſu-". Compare the f of "fuerit" with the ſ of "deriſa", "combuſſerit", "ſex".\n- Image 2 (italic type) reads: "Magnus ab integro ſeclorum naſcitur ordo; / Iam redit & virgo, redeunt ſaturnia regna, / Iam nova progenies cælo demittitur alto, / Tu modò naſcenti puero, quo ferrea primum / Deſinet, & toto ſurget gens aurea mundo,". Compare the f of "ferrea" with the ſ of "ſeclorum", "naſcitur", "ſurget".';

const [imgs, out] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ARM = arg('arm', 'L0');
const model = 'gemini-3.1-flash-lite';
const parallel = Number(arg('parallel', '8'));
const MAX_COST = Number(arg('max-cost', '3'));
const PRICE = { in: 0.25e-6, out: 1.5e-6 };   // gemini-3.1-flash-lite, $/token (output includes thinking)

const mongo = new MongoClient(process.env.MONGODB_URI); await mongo.connect();
const live = await getProductionOcrPrompt(mongo.db(process.env.MONGODB_DB || 'bookstore'));
await mongo.close();
const withRule = (t) => t.replace(LONG_S_ANCHOR, `${LONG_S_RULE}\n\n${LONG_S_ANCHOR}`);
let prompt;
if (ARM === 'L0' || ARM === 'L0b') prompt = live.text;
else if (ARM === 'L1') prompt = withLongSLine(live.text);
else if (ARM === 'L2' || ARM === 'L4') prompt = withRule(withLongSLine(live.text));
else if (ARM === 'L3') prompt = withRule(withLongSLine(live.text)).replace(LONG_S_ANCHOR, `${EXAMPLES_LINE}\n\n${LONG_S_ANCHOR}`);
else throw new Error(`unknown arm ${ARM}`);
if (ARM !== 'L0' && ARM !== 'L0b' && !prompt.includes(LONG_S_LINE)) throw new Error('LONG_S_LINE not sited');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
if (process.argv.includes('--dump-prompt')) { console.log(prompt); console.error(live.version, live.name, sha(prompt)); process.exit(0); }

const examples = ARM === 'L3' ? ['roman.jpg', 'italic.jpg'].map((f) => fs.readFileSync(path.join(arg('examples'), f))) : [];
const thinkingBudget = ARM === 'L4' ? 1024 : undefined;
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((r) => !r.error).map((r) => r.page_id) : []);
const todo = fs.readdirSync(imgs).filter((f) => f.endsWith('.jpg')).sort().filter((f) => !done.has(f.slice(0, -4)));
let inTok = 0, outTok = 0, thinkTok = 0, cost = 0;
const t0 = Date.now();
async function worker() {
  while (todo.length) {
    if (cost > MAX_COST) { console.error(`cost cap $${MAX_COST} reached`); return; }
    const f = todo.shift();
    const rec = { page_id: f.slice(0, -4) };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await callGemini({ model, prompt, imageParts: [...examples, fs.readFileSync(path.join(imgs, f))].map((data) => ({ mimeType: 'image/jpeg', data })),
          temperature: 0, maxOutputTokens: 16000, ...(thinkingBudget != null ? { thinkingBudget } : {}),
          endpoint: 'scripts/eval/latin-bakeoff-5924/longs-prompt-arm.mjs', type: 'ocr', pageIds: [rec.page_id], promptVersion: `${live.version}+${ARM}` });
        Object.assign(rec, { text: r.text, finish: r.finishReason, in_tok: r.inputTokens, out_tok: r.outputTokens, think_tok: r.thinkingTokens });
        delete rec.error; inTok += r.inputTokens; outTok += r.outputTokens; thinkTok += r.thinkingTokens;
        cost += r.inputTokens * PRICE.in + r.outputTokens * PRICE.out;
        break;
      } catch (e) { rec.error = String(e.message).slice(0, 300); await new Promise((s) => setTimeout(s, 5000 * (attempt + 1))); }
    }
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  }
}
await Promise.all(Array.from({ length: parallel }, worker));
const run = { arm: ARM, model, temperature: 0, thinkingBudget: thinkingBudget ?? 0, live_prompt_version: live.version, live_prompt_name: live.name,
  live_prompt_hash: live.content_hash, prompt_sha256: sha(prompt), examples_sha256: examples.map(sha), wall_secs: (Date.now() - t0) / 1000,
  in_tok: inTok, out_tok: outTok, think_tok: thinkTok, cost_usd: Math.round(cost * 10000) / 10000 };
fs.writeFileSync(out + '.run.json', JSON.stringify(run, null, 1));
console.log(JSON.stringify(run));
