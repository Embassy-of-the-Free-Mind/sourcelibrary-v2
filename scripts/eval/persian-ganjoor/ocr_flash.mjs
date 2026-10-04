// PRIOR ART: scripts/batch/bulk-reocr-local.mjs — its prompt lookup and OCR_GENERATION_CONFIG are copied here
// verbatim, but it cannot be used: its Batch path hands results to batch-collector, which WRITES `pages`. This is a
// measurement (#5525 Stage 1b), so it calls the metered realtime client (scripts/lib/gemini-script-client.mjs) on
// the Stage 1 manuscript page images and writes only a local JSONL. scripts/eval/nalanda-readiness/ocr_ctrl.mjs is
// the same shape for rendered control pages.
//
// Usage (Hetzner; the laptop is geo-blocked for Gemini):
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/persian-ganjoor/ocr_flash.mjs \
//     <persian-sample.jsonl> <strata.json> <imgdir> <out.jsonl> [--variant couplet] [--model gemini-3-flash-preview]
// Output rows have the sample.jsonl shape (id, ganjoor_poets, text, arm …), so persian_align.py scores them unchanged.
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';

const [samplePath, strataPath, imgDir, outPath] = process.argv.slice(2);
const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = flag('model', 'gemini-3-flash-preview');
const VARIANT = flag('variant', 'production');

// bulk-reocr-local.mjs: OCR_GENERATION_CONFIG and SAFETY_SETTINGS (thinking off, temperature 0.1, 16K cap).
const SAFETY_SETTINGS = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY'].map(category => ({ category, threshold: 'BLOCK_NONE' }));

// The one variant instruction under test (Derek, 2026-10-01). Appended, so the rest of the prompt is identical.
const COUPLET = `\n\n**Verse layout:** read column by column per couplet: right hemistich then left hemistich. ` +
  `That is, a couplet (bayt) sits on one row as two hemistichs side by side; transcribe the right hemistich, then ` +
  `the left hemistich of the same row, separated by " | ", one couplet per line, before moving down to the next row.`;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const p = await c.db('bookstore').collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
await c.close();
if (!p?.content) throw new Error('No default OCR prompt found in DB');
const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;
let prompt = p.content.replace('{language_instruction}', languageInstruction).replace('{language}', '');
if (VARIANT === 'couplet') prompt += COUPLET;
else if (VARIANT !== 'production') throw new Error(`unknown --variant ${VARIANT}`);

const strata = JSON.parse(fs.readFileSync(strataPath, 'utf8'));
const rows = fs.readFileSync(samplePath, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  .filter(r => strata[r.id]?.stratum === 'manuscript');
const done = new Set(fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const arm = `${MODEL}${VARIANT === 'production' ? '' : '+' + VARIANT}`;
let inTok = 0, outTok = 0;
for (const r of rows) {
  if (done.has(r.id)) continue;
  const img = fs.readFileSync(path.join(imgDir, `${r.id}.jpg`));
  const res = await callGemini({
    model: MODEL, prompt, endpoint: 'eval/persian-ganjoor-5525-stage1b', type: 'eval', bookId: r.book_id,
    promptVersion: `${p.version}${VARIANT === 'production' ? '' : '+' + VARIANT}`,
    imageParts: [{ mimeType: 'image/jpeg', data: img }], temperature: 0.1, maxOutputTokens: 16384, thinkingBudget: 0,
    safetySettings: SAFETY_SETTINGS,
  });
  inTok += res.inputTokens || 0; outTok += res.outputTokens || 0;
  const { text: _old, ...meta } = r;
  fs.appendFileSync(outPath, JSON.stringify({ ...meta, arm, prompt_version: String(p.version), variant: VARIANT,
    finish: res.finishReason, in_tokens: res.inputTokens, out_tokens: res.outputTokens, text: res.text || '' }) + '\n');
  console.log(r.id, res.finishReason, res.outputTokens, (res.text || '').length);
}
console.log(`prompt ${p.name} v${p.version}; tokens in ${inTok} out ${outTok}`);
