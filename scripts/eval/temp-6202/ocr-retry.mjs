#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1 — reused (the metered, files-only arm runner). scripts/eval/kraken-refused-4686/ sealed the 20 RECITATION-refused pages used here (benchmark/refused-en-4686.json) and scored non-Gemini engines on them; #4686 reports the refusal at temperature 0 and 1 from a 5-page probe. No script has run a rising-temperature ladder over a sealed refused set.
/** Optional OCR arm of #6202: does a rising temperature (0, 0.4, 0.8) get an answer out of pages Gemini refuses as RECITATION? Files only; metered as temp-6202. */
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/temp-6202/ocr-retry.mjs [--work /data/scratch/sl/temp-6202] [--models lite,flash] [--cap-usd 1]
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { OCR_MODEL_FLASH, OCR_MODEL_LITE } from '../../lib/ocr-routing.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/temp-6202'); const CAP = Number(opt('cap-usd', 1));
const MODELS = opt('models', 'lite,flash').split(','); const MODEL = { lite: OCR_MODEL_LITE, flash: OCR_MODEL_FLASH };
const LADDER = [0, 0.4, 0.8];
const pages = JSON.parse(fs.readFileSync('scripts/eval/benchmark/refused-en-4686.json', 'utf8')).pages;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const p = await c.db(process.env.MONGODB_DB || 'bookstore').collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
await c.close();
if (!p?.content) throw new Error('no default OCR prompt');
// realtime-ocr.mjs getOcrPrompt, verbatim
const prompt = p.content.replace('{language_instruction}', '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).').replace('{language}', '');
const outf = path.join(WORK, 'ocr-retry.jsonl');
const done = new Set(fs.existsSync(outf) ? fs.readFileSync(outf, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return `${j.model_key}|${j.slug}|${j.temperature}`; }) : []);
let spent = 0;
for (const pg of pages) {
  const r = await fetch(pg.image_url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) { console.log(`${pg.slug}: image HTTP ${r.status}`); continue; }
  const image = { mimeType: 'image/jpeg', data: Buffer.from(await r.arrayBuffer()) };
  for (const m of MODELS) for (const temperature of LADDER) {
    if (done.has(`${m}|${pg.slug}|${temperature}`)) continue;
    if (spent > CAP - 0.02) throw new Error(`CAP $${CAP}`);
    let res = null; let err = null;
    for (let a = 1; a <= 4 && !res; a++) { try { res = await callGemini({ model: MODEL[m], prompt, imageParts: [image], endpoint: 'scripts/eval/temp-6202/ocr-retry.mjs', thinkingBudget: 0, temperature, maxOutputTokens: 16384, type: 'eval', bookId: 'temp-6202', pageIds: [pg.page_id], promptVersion: `ocr-v${p.version}`, triggeredBy: `temp-6202:ocr-retry-${m}` }); } catch (e) { err = String(e.message).slice(0, 160); await new Promise((ok) => setTimeout(ok, 5000 * a)); } }
    const usd = res ? costOf(MODEL[m], res.inputTokens, res.outputTokens) : 0; spent += usd;
    const text = res?.text || ''; const loop = text.length >= 300 ? loopVerdict(text) : null;
    fs.appendFileSync(outf, JSON.stringify({ slug: pg.slug, book_short: pg.book_short, page_number: pg.page_number, model_key: m, model: MODEL[m], temperature, finishReason: res?.finishReason || null, error: res ? null : err, chars: text.length, loop: loop ? !!(loop.loop ?? loop.isLoop ?? loop.refuse) : null, in: res?.inputTokens || 0, out: res?.outputTokens || 0, usd }) + '\n');
    fs.appendFileSync(path.join(WORK, 'ledger.jsonl'), JSON.stringify({ kind: 'ocr-retry', model: m, arm: `OCR-T${temperature}`, id: pg.slug, in: res?.inputTokens || 0, out: res?.outputTokens || 0, thinking: res?.thinkingTokens || 0, usd, finish: res?.finishReason || 'error', at: new Date().toISOString() }) + '\n');
  }
}
const rows = fs.readFileSync(outf, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
for (const m of MODELS) {
  const mine = rows.filter((x) => x.model_key === m); const slugs = [...new Set(mine.map((x) => x.slug))];
  const ok = (x) => x.chars >= 200 && !x.loop;
  const per = Object.fromEntries(LADDER.map((t) => [t, mine.filter((x) => x.temperature === t && ok(x)).length]));
  const ladder = slugs.filter((s) => mine.some((x) => x.slug === s && ok(x))).length;
  console.log(`${m}: ${slugs.length} pages; answered at T ${JSON.stringify(per)}; answered by the ladder ${ladder}; finish ${JSON.stringify(mine.reduce((a, x) => { const k = `${x.temperature}:${x.finishReason}`; a[k] = (a[k] || 0) + 1; return a; }, {}))}`);
}
console.log(`spent $${spent.toFixed(4)}`);
