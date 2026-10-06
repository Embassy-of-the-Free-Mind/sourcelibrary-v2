#!/usr/bin/env node
// PRIOR ART: scripts/eval/reocr-lift-5700/pilot.mjs `ocr` stage — the same metered production OCR request under a
// pseudo-book envelope, but one engine (flash) over the #5695 track pages at temperature 0.1, reading from the URL
// each time; scripts/eval/per-language-suitability.mjs runs lite and flash on one page per book through the
// unmetered eval runner and has no refusal retry. This runs BOTH engines on the sealed bytes of #5795.
/** #5795 arms: gemini-3.1-flash-lite and gemini-3-flash-preview on the sealed image bytes, production OCR prompt. Writes nothing to books/pages. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/hidden-flash-5795/arms.mjs [--work <dir>] [--cap-usd 3]
 *
 * Request: live default OCR prompt (+ the production document-context line), temperature 0, thinkingBudget 0,
 * 16,384 output tokens, production safety settings, the sealed JPEG (sha256 checked against the seal). One retry
 * when the answer is a refusal (refusal finishReason, or no text with a non-STOP finishReason); every attempt kept.
 * Metered on pseudo book id `hidden-flash-5795` under the `hidden-flash-5795` envelope; stops at the cap.
 * Resumable: an existing <work>/out/<arm>/<slug>.json is skipped. The prompt hash is pinned in <work>/prompt.json
 * on the first call and asserted on every later start.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { MODEL_FLASH, MODEL_LITE } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';
import { REFUSAL_REASONS } from '../lib/refusals.mjs';
import { docContext, SAFETY } from '../ocr-v18-ab.mjs';

const argv = process.argv.slice(2); const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/hidden-flash-5795-work');
const SEAL = opt('seal', 'scripts/eval/results/hidden-flash-5795/sealed.json');
const CAP = Number(opt('cap-usd', 3)); const CONC = Number(opt('concurrency', 4));
const SCOPE = 'hidden-flash-5795'; const ENDPOINT = 'scripts/eval/hidden-flash-5795/arms.mjs';
const ARMS = { lite: MODEL_LITE, flash: MODEL_FLASH };
const GEN = { temperature: 0, maxOutputTokens: 16384, thinkingBudget: 0 };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
const env = control?.allow_scopes?.[SCOPE];
if (!env?.budget_usd) { console.error(`no ${SCOPE} envelope — create it with set-scope.mjs first`); process.exit(2); }
const meter = await getScopeSpendUsd(db, { ids: [SCOPE], since: new Date(env.created_at) });
if (meter.meterError) { console.error(`envelope meter unreadable (${meter.meterError}) — refusing`); process.exit(2); }
const budget = Math.min(CAP, env.budget_usd);

const prompt = await getProductionOcrPrompt(db);
const pin = { name: prompt.name, version: prompt.version, content_hash: prompt.content_hash ?? null, text_sha256: sha256(prompt.text) };
const pinFile = path.join(WORK, 'prompt.json');
if (fs.existsSync(pinFile)) {
  const was = JSON.parse(fs.readFileSync(pinFile, 'utf8'));
  if (was.text_sha256 !== pin.text_sha256 || was.content_hash !== pin.content_hash) { console.error(`production OCR prompt changed since the first call (${was.version}/${was.text_sha256.slice(0, 12)} → ${pin.version}/${pin.text_sha256.slice(0, 12)}) — refusing`); process.exit(2); }
} else fs.writeFileSync(pinFile, JSON.stringify(pin, null, 1));
console.log(`prompt "${pin.name}" v${pin.version} content_hash ${pin.content_hash} text_sha256 ${pin.text_sha256.slice(0, 16)}; envelope $${meter.usd.toFixed(4)} / $${budget}`);

const sealed = JSON.parse(fs.readFileSync(SEAL, 'utf8')).sealed;
const jobs = sealed.flatMap((p) => Object.keys(ARMS).map((arm) => [arm, p]));
const isRefusal = (r) => REFUSAL_REASONS.test(r.finishReason || '') || (!String(r.text || '').trim() && r.finishReason !== 'STOP');
async function once(model, text, data, slug) {
  for (let a = 1; ; a++) {
    try {
      return await callGemini({ model, prompt: text, imageParts: [{ mimeType: 'image/jpeg', data }], endpoint: ENDPOINT, type: 'eval', bookId: SCOPE, pageIds: [slug],
        thinkingBudget: GEN.thinkingBudget, temperature: GEN.temperature, maxOutputTokens: GEN.maxOutputTokens, safetySettings: SAFETY, promptVersion: `ocr-v${prompt.version}`, triggeredBy: SCOPE });
    } catch (e) { if (a >= 4 || !/Gemini (503|429|500)|timeout|aborted|fetch failed/i.test(String(e.message))) throw e; await new Promise((ok) => setTimeout(ok, 6000 * a)); }
  }
}
let spent = 0, done = 0, stop = false; const q = [...jobs];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (q.length) {
    const [arm, p] = q.shift(); const f = path.join(WORK, 'out', arm, `${p.slug}.json`);
    if (fs.existsSync(f) || stop) continue;
    if (meter.usd + spent >= budget) { stop = true; console.log(`STOP: envelope $${(meter.usd + spent).toFixed(4)} ≥ $${budget}`); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try {
      const buf = fs.readFileSync(path.join(WORK, 'images', `${p.slug}.jpg`));
      if (sha256(buf) !== p.image_sha256) throw new Error('image bytes differ from the seal');
      const text = `${prompt.text}${docContext({ title: p.title, author: p.author, year: typeof p.year === 'number' ? p.year : null })}`;
      const attempts = [];
      for (let i = 0; i < 2; i++) {
        const r = await once(ARMS[arm], text, buf.toString('base64'), p.slug);
        const cost = costOf(ARMS[arm], r.inputTokens, r.outputTokens); spent += cost;
        attempts.push({ text: r.text, finishReason: r.finishReason, inputTokens: r.inputTokens, outputTokens: r.outputTokens, thinkingTokens: r.thinkingTokens ?? 0, cost_usd_realtime: cost, at: new Date().toISOString() });
        if (!isRefusal(r)) break;
      }
      const last = attempts[attempts.length - 1];
      fs.writeFileSync(f, JSON.stringify({ slug: p.slug, arm, model: ARMS[arm], text: last.text, finishReason: last.finishReason, retried: attempts.length > 1, attempts, prompt: pin, generation: GEN, image_sha256: p.image_sha256 }, null, 1));
      done++; if (done % 20 === 0) console.log(`${done} done, $${spent.toFixed(4)} this run`);
    } catch (e) { fs.writeFileSync(f.replace(/\.json$/, '.failed.json'), JSON.stringify({ slug: p.slug, arm, error: String(e.message).slice(0, 400) })); console.log(`${arm} ${p.slug} FAILED ${String(e.message).slice(0, 160)}`); }
  }
}));
console.log(`arms: ${done} new reads, $${spent.toFixed(4)} realtime this run, envelope before $${meter.usd.toFixed(4)}`);
await client.close();
