// Gemini arm of the text↔image match test: same 60 books and same three conditions as the Clef run, so the two
// instruments are compared on identical pairs.
// PRIOR ART: scripts/eval/jev/clef-leaf-match.mjs — builds the pairs and scores Clef. This script rebuilds the SAME
//   pairs from its rows (book_id + page; "other" = the next row's own text, as there) and asks Gemini instead.
//   Uses scripts/lib/gemini-script-client.mjs (thinking off by default, usage logged).
// Run: ROWS=<clef-leaf-match-rows.jsonl> OUT=<dir> MODEL=gemini-3.1-flash-lite node --env-file=<.env.production.local> scripts/eval/jev/leaf-match-gemini-arm.mjs
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { MODEL_PRICING } from '../../lib/model-pricing.mjs';

const MODEL = process.env.MODEL || 'gemini-3.1-flash-lite';
const OUT = process.env.OUT || '.';
const rows = fs.readFileSync(process.env.ROWS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const books = [...new Map(rows.map((r) => [r.book_id, r])).values()]; // insertion order = sample order
const PROMPT = (text) => `You are checking a digitised book. The image is one scanned page. Below is a stored transcription.
Does the transcription transcribe THIS page (not a neighbouring page, not a different book)?
Answer with JSON only: {"p": <probability 0-100 that it is this page>}

TRANSCRIPTION:
${text.slice(0, 4000)}`;
const ocrText = (p) => (typeof p?.ocr === 'object' ? p.ocr?.data : p?.ocr) || '';

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const tmp = fs.mkdtempSync(path.join(OUT, 'gem-'));
const own = [];
for (const b of books) {
  const [cur, nxt] = await Promise.all([b.page, b.page + 1].map((n) => pages.findOne({ book_id: b.book_id, page_number: n }, { projection: { ocr: 1, cropped_photo: 1, display_photo: 1, archived_photo: 1 } })));
  own.push({ b, cur, nxt });
}
await c.close();

// Resume: rows already in the progress file are kept, and their books skipped.
const PROGRESS = path.join(OUT, `leaf-match-${MODEL}-progress.jsonl`);
const prior = fs.existsSync(PROGRESS) ? fs.readFileSync(PROGRESS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = new Set(prior.map((r) => r.book_id));
const price = MODEL_PRICING?.[MODEL] || { input: 0.25, output: 1.5 };
let cost = 0, inTok = 0;
const out = [...prior];
for (let i = 0; i < own.length; i++) {
  const { b, cur, nxt } = own[i];
  const url = cur?.display_photo || cur?.archived_photo; // same image source as the Clef run
  if (!url) continue;
  if (done.has(b.book_id)) continue;
  const raw = path.join(tmp, `${i}.src`), jpg = path.join(tmp, `${i}.jpg`);
  let img = null;
  for (let a = 0; a < 4 && !img; a++) {
    try {
      fs.writeFileSync(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));
      execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '1024', raw, '--out', jpg], { stdio: 'ignore' });
      img = fs.readFileSync(jpg);
    } catch { await new Promise((s) => setTimeout(s, 5000 * (a + 1))); }
  }
  if (!img) { console.error('image fail', b.book_id); continue; }
  for (const [cond, text] of [['match', ocrText(cur)], ['next', ocrText(nxt)], ['other', ocrText(own[(i + 1) % own.length].cur)]]) {
    const t0 = Date.now();
    let p = null;
    try {
      const r = await callGemini({ model: MODEL, prompt: PROMPT(text), imageParts: [img], endpoint: 'scripts/eval/jev/leaf-match-gemini-arm.mjs', type: 'eval', maxOutputTokens: 50 });
      p = Number((r.text.match(/"p"\s*:\s*([0-9.]+)/) || [])[1]) / 100;
      cost += (r.inputTokens * price.input + r.outputTokens * price.output) / 1e6; inTok += r.inputTokens;
    } catch (e) { console.error(cond, String(e).slice(0, 120)); }
    const row = { book_id: b.book_id, cond, p, ms: Date.now() - t0 };
    out.push(row);
    fs.appendFileSync(PROGRESS, JSON.stringify(row) + '\n'); // a network blip must not lose the run
  }
}
fs.writeFileSync(path.join(OUT, `leaf-match-${MODEL}.jsonl`), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
const auc = (pos, neg) => +(pos.reduce((a, x) => a + neg.reduce((s, y) => s + (x > y) + 0.5 * (x === y), 0), 0) / (pos.length * neg.length)).toFixed(3);
const v = (c) => out.filter((r) => r.cond === c && r.p != null).map((r) => r.p);
const ms = out.map((r) => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({ model: MODEL, n: out.length, failed: out.filter((r) => r.p == null).length, auc_match_vs_next: auc(v('match'), v('next')), auc_match_vs_other: auc(v('match'), v('other')),
  caught_next_at_0_5: `${v('next').filter((x) => x < 0.5).length}/${v('next').length}`, false_alarm_match_at_0_5: `${v('match').filter((x) => x < 0.5).length}/${v('match').length}`,
  cost_usd: +cost.toFixed(4), mean_input_tokens: Math.round(inTok / out.length), median_ms: ms[Math.floor(ms.length / 2)] }));
