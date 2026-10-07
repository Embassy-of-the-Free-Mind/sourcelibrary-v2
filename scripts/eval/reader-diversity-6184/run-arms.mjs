// PRIOR ART: /root/tattva-6184/read.mjs (#6184 tie-break third read: Pro only, one read per page) and
// scripts/batch/bulk-reocr-local.mjs (the production Flash/lite request, Batch, writes pages.ocr). This runner
// sends the production request on realtime at chosen temperatures, k samples per arm, and writes FILES only.
// Usage: node --env-file=/root/sourcelibrary/.env.production.local run-arms.mjs <slots-final.json> <out.jsonl> [--execute]
//   [--arms=FP,LP --cap=0.48]  (plain-prompt arms, prereg addendum; default arms F0,F1,L1,P1 and cap 2.8)
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const [slotsFile, outFile] = process.argv.slice(2);
const EXECUTE = process.argv.includes('--execute');
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const CAP_USD = Number(opt('cap', 2.8));
const PRICE = { 'gemini-3-flash-preview': [0.5, 3], 'gemini-3.1-flash-lite': [0.25, 1.5], 'gemini-3.1-pro-preview': [2.5, 15] };
const PRO_PROMPT = 'Transcribe the Sanskrit (Devanagari) text on this printed page exactly as printed, character for character. Do not correct, normalise or emend anything: keep every vowel sign, virāma and avagraha as the print has it. Plain text only, one printed line per line.';
// Same as bulk-reocr-local.mjs SAFETY_SETTINGS.
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));

const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
// Same lookup + language instruction as bulk-reocr-local.mjs getOcrPrompt().
const pr = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;
const OCR_PROMPT = pr.content.replace('{language_instruction}', languageInstruction).replace('{language}', '');
console.log(`OCR prompt: ${pr.name} v${pr.version} (${OCR_PROMPT.length} chars)`);
if (String(pr.version) !== '19.1') throw new Error('default OCR prompt is not v19.1 — prereg assumed v19.1');

const ARMS = [
  { arm: 'F0', model: 'gemini-3-flash-preview', temperature: 0.1, thinkingBudget: 0, prompt: OCR_PROMPT, n: 1 },
  { arm: 'F1', model: 'gemini-3-flash-preview', temperature: 1.0, thinkingBudget: 0, prompt: OCR_PROMPT, n: 5 },
  { arm: 'L1', model: 'gemini-3.1-flash-lite', temperature: 1.0, thinkingBudget: 0, prompt: OCR_PROMPT, n: 5 },
  { arm: 'P1', model: 'gemini-3.1-pro-preview', temperature: 1.0, thinkingBudget: 128, prompt: PRO_PROMPT, n: 2 },
  // Addendum: Pro's plain prompt on Flash and lite at the served temperature — separates model from prompt.
  { arm: 'FP', model: 'gemini-3-flash-preview', temperature: 0.1, thinkingBudget: 0, prompt: PRO_PROMPT, n: 3 },
  { arm: 'LP', model: 'gemini-3.1-flash-lite', temperature: 0.1, thinkingBudget: 0, prompt: PRO_PROMPT, n: 3 },
].filter((a) => opt('arms', 'F0,F1,L1,P1').split(',').includes(a.arm));
const pageIds = [...new Set(JSON.parse(fs.readFileSync(slotsFile, 'utf8')).map((s) => s.page_id))];
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => `${r.page_id}|${r.arm}|${r.sample}`) : []);
let spent = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean).reduce((a, l) => a + JSON.parse(l).usd, 0) : 0;
const jobs = [];
for (const id of pageIds) for (const a of ARMS) for (let s = 0; s < a.n; s++) if (!done.has(`${id}|${a.arm}|${s}`)) jobs.push({ id, a, s });
console.log(`${pageIds.length} pages, ${jobs.length} calls to make, spent so far $${spent.toFixed(3)}`);
if (!EXECUTE) { console.log('dry run'); await c.close(); process.exit(0); }

const imgs = new Map();
async function image(id) {
  if (!imgs.has(id)) {
    const p = await db.collection('pages').findOne({ id }, { projection: { book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1 } });
    const url = getPageSource(p); const r = await fetch(url); if (!r.ok) throw new Error('image ' + r.status);
    imgs.set(id, { p, url, buf: Buffer.from(await r.arrayBuffer()) });
  }
  return imgs.get(id);
}
let stopped = false;
async function one({ id, a, s }) {
  if (spent > CAP_USD) { stopped = true; return; }
  const { p, url, buf } = await image(id);
  for (let t = 0; t < 3; t++) try {
    const r = await callGemini({ model: a.model, endpoint: `reader-diversity-6184/${a.arm}`, imageParts: buf, temperature: a.temperature, thinkingBudget: a.thinkingBudget,
      maxOutputTokens: 16384, safetySettings: a.arm === 'P1' ? undefined : SAFETY, bookId: p.book_id, pageIds: [id], type: 'ocr', prompt: a.prompt });
    if (r.finishReason !== 'STOP' || !r.text) throw new Error('finish ' + r.finishReason);
    const [pi, po] = PRICE[a.model]; const usd = (r.inputTokens * pi + r.outputTokens * po) / 1e6; spent += usd;
    fs.appendFileSync(outFile, JSON.stringify({ page_id: id, book_id: p.book_id, page: p.page_number, arm: a.arm, sample: s, model: a.model, temperature: a.temperature,
      thinking_budget: a.thinkingBudget, prompt: a.prompt === PRO_PROMPT ? 'pro-plain-6184' : `${pr.name} v${pr.version}`, image_url: url, in: r.inputTokens, out: r.outputTokens, think: r.thinkingTokens, usd, at: new Date().toISOString(), text: r.text }) + '\n');
    return;
  } catch (e) { console.error(id, a.arm, s, e.message.slice(0, 140)); await new Promise((z) => setTimeout(z, 4000)); }
}
const q = [...jobs]; let n = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (q.length && !stopped) { await one(q.shift()); if (++n % 25 === 0) console.log(n, '$' + spent.toFixed(3)); } }));
console.log(stopped ? `STOPPED at cap, $${spent.toFixed(3)}` : `done ${n} calls, $${spent.toFixed(3)}`);
await c.close();
