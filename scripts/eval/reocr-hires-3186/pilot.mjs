#!/usr/bin/env node
// PRIOR ART: scripts/eval/reocr-lift-5700/pilot.mjs is the same never-write-a-page re-read, but it sends getPageSource
// resized to 1500 px (the pipeline's cap) and reads its page list from a #5695 track file; #3186 asks what the
// UPGRADED master buys at ≤3072 px, on pages it selects itself by distress. scripts/batch/realtime-ocr.mjs and
// bulk-reocr-local.mjs re-OCR page lists but WRITE pages, and a new ocr.updated_at makes the translation stale
// (mark-stale-translations cron → translate-worker), i.e. a retranslation this pilot must not cause.
/** #3186 gated re-OCR pilot: re-read distressed pages of resolution-upgraded books from the new master, write nothing to pages/books. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/reocr-hires-3186/pilot.mjs <stage> [--work <dir>] [--cap-usd 10] [--n 40]
 *
 *   select   Mongo, READ-ONLY. Books: manchester Pali + chester_beatty Arabic with image_resolution_upgraded_at set.
 *            A page is distressed if its stored OCR has ≥3 <unclear>, OR is < 45% of its book's median OCR length,
 *            OR is empty, OR loopVerdict() calls it a repetition loop (#3186 July pilot signals + the brief's two).
 *            One page per book (the most distressed), then round-robin extra pages until --n.   → <work>/pages.jsonl
 *   ocr      paid: one read per page of archived_photo (the upgraded master) downscaled to ≤3072 px long side, on
 *            the live default OCR prompt + document context, gemini-3-flash-preview, temperature 0.1, 16,384 tokens,
 *            thinking off — the production request except the 1500 px cap.                       → <work>/ocr/<id>.json
 *   sheet    render, per page, the master (≤1600 px) plus old vs new OCR side by side for judging by eye  → <work>/sheet/
 *
 * Metering: every call goes through gemini-script-client with bookId `reocr-hires-3186` (a pseudo id no book has),
 * so `allow_scopes.reocr-hires-3186` measures it and opens no real book. Refuses to start without that envelope and
 * stops at min(--cap-usd, envelope).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';
import { docContext, OCR_GENERATION_CONFIG, SAFETY as OCR_SAFETY } from '../ocr-v18-ab.mjs';

const argv = process.argv.slice(2); const STAGE = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const WORK = opt('work', '/root/rearchive-logs/2026-10/reocr-pilot');
const CAP = Number(opt('cap-usd', 10)); const N = Number(opt('n', 40)); const CONC = Number(opt('concurrency', 3));
const MAX_PX = 3072;
const SCOPE = 'reocr-hires-3186'; const PSEUDO_BOOK = 'reocr-hires-3186'; const ENDPOINT = 'scripts/eval/reocr-hires-3186/pilot.mjs';
const MODEL = 'gemini-3-flash-preview';
const F = (...p) => path.join(WORK, ...p);
const rl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const client = new MongoClient(process.env.MONGODB_URI);
let db; const mongo = async () => { if (!db) { await client.connect(); db = client.db('bookstore'); } return db; };

const STRATA = [
  { name: 'manchester-pali', q: { 'image_source.provider': 'manchester', language: /pali/i } },
  { name: 'chester_beatty-arabic', q: { 'image_source.provider': 'chester_beatty', language: /arab/i } },
];
const unclearCount = (t) => (t.match(/<unclear\b/gi) || []).length;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function stageSelect() {
  const d = await mongo(); fs.mkdirSync(WORK, { recursive: true });
  const perBook = [];
  for (const s of STRATA) {
    const books = await d.collection('books').find({ ...s.q, image_resolution_upgraded_at: { $exists: true } }, { projection: { id: 1, title: 1, author: 1, year: 1, published: 1, language: 1, image_resolution_upgraded_at: 1 } }).toArray();
    for (const b of books) {
      const pages = await d.collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.source': 1, 'image_metadata.upgraded_at': 1, 'image_metadata.width': 1 } }).sort({ page_number: 1 }).toArray();
      const withOcr = pages.filter((p) => p.ocr && typeof p.ocr.data === 'string');
      const med = median(withOcr.map((p) => p.ocr.data.length));
      const flagged = [];
      for (const p of withOcr) {
        // Only pages whose image really was upgraded, and whose OCR predates that (it read the low-res image).
        if (!p.image_metadata?.upgraded_at || !p.archived_photo) continue;
        if (p.ocr.updated_at && new Date(p.ocr.updated_at) > new Date(p.image_metadata.upgraded_at)) continue;
        const t = p.ocr.data; const u = unclearCount(t); const loop = loopVerdict(t).refuse;
        const signals = [];
        if (u >= 3) signals.push(`unclear=${u}`);
        if (med && t.length < 0.45 * med) signals.push(`short=${t.length}/${med}`);
        if (t.trim().length < 20) signals.push('empty');
        if (loop) signals.push('loop');
        if (signals.length) flagged.push({ p, u, signals, score: u + (signals.some((x) => x.startsWith('short')) ? 5 : 0) + (loop ? 10 : 0) });
      }
      flagged.sort((a, b) => b.score - a.score);
      perBook.push({ stratum: s.name, b, med, pages: pages.length, ocrPages: withOcr.length, flagged });
    }
  }
  const census = perBook.map((x) => ({ stratum: x.stratum, book: x.b.id, title: x.b.title, pages: x.pages, ocr_pages: x.ocrPages, distressed: x.flagged.length }));
  fs.writeFileSync(F('census.json'), JSON.stringify(census, null, 1));
  const pick = []; const used = new Set();
  for (let round = 0; pick.length < N; round++) {
    let added = 0;
    for (const x of perBook) { const f = x.flagged[round]; if (f && pick.length < N) { pick.push({ x, f }); added++; } }
    if (!added) break;
  }
  const rows = pick.map(({ x, f }) => ({
    id: f.p.id, stratum: x.stratum, book_id: x.b.id, title: x.b.title, author: x.b.author ?? null, year: x.b.year ?? null, page_number: f.p.page_number,
    image: f.p.archived_photo, image_width: f.p.image_metadata?.width ?? null, signals: f.signals, book_median_len: x.med,
    old: { model: f.p.ocr.model ?? null, source: f.p.ocr.source ?? null, updated_at: f.p.ocr.updated_at ?? null, text: f.p.ocr.data },
  })).filter((r) => !used.has(r.id) && used.add(r.id));
  fs.writeFileSync(F('pages.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const s of STRATA) {
    const xs = perBook.filter((x) => x.stratum === s.name);
    console.log(`${s.name}: ${xs.length} upgraded books, ${xs.reduce((a, x) => a + x.ocrPages, 0)} OCR pages, ${xs.reduce((a, x) => a + x.flagged.length, 0)} distressed; picked ${rows.filter((r) => r.stratum === s.name).length} pages from ${new Set(rows.filter((r) => r.stratum === s.name).map((r) => r.book_id)).size} books`);
  }
}

async function envelope() {
  const d = await mongo();
  const control = await d.collection('system_config').findOne({ _id: 'processing_control' });
  const env = control?.allow_scopes?.[SCOPE];
  if (!env?.budget_usd) { console.error(`no ${SCOPE} envelope — create it with set-scope.mjs first`); process.exit(2); }
  const m = await getScopeSpendUsd(d, { ids: [PSEUDO_BOOK], since: new Date(env.created_at) });
  if (m.meterError) { console.error(`envelope meter unreadable (${m.meterError}) — refusing`); process.exit(2); }
  return { budget: Math.min(CAP, env.budget_usd), measured: m.usd };
}

async function imageAt(url, maxPx, quality = 90) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const buf = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  return buf;
}

async function stageOcr() {
  const d = await mongo(); const env = await envelope(); const prompt = await getProductionOcrPrompt(d);
  const pages = rl(F('pages.jsonl'));
  console.log(`ocr: ${pages.length} pages on ${MODEL}, prompt "${prompt.name}" v${prompt.version}, ≤${MAX_PX}px; envelope $${env.measured.toFixed(4)} / $${env.budget}`);
  let spent = 0; const q = [...pages];
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (q.length) {
      const p = q.shift(); const f = F('ocr', `${p.id}.json`); if (fs.existsSync(f)) continue;
      if (env.measured + spent >= env.budget) { console.log('STOP: envelope reached'); return; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      try {
        const img = await imageAt(p.image, MAX_PX);
        const text = `${prompt.text}${docContext({ title: p.title, author: p.author, year: p.year })}`;
        const r = await callGemini({ model: MODEL, prompt: text, imageParts: [{ mimeType: 'image/jpeg', data: img.toString('base64') }], endpoint: ENDPOINT, type: 'eval', bookId: PSEUDO_BOOK, pageIds: [p.id],
          thinkingBudget: 0, temperature: OCR_GENERATION_CONFIG.temperature, maxOutputTokens: OCR_GENERATION_CONFIG.maxOutputTokens, safetySettings: OCR_SAFETY, promptVersion: `ocr-v${prompt.version}`, triggeredBy: SCOPE });
        const cost = costOf(MODEL, r.inputTokens, r.outputTokens); spent += cost;
        fs.writeFileSync(f, JSON.stringify({ id: p.id, model: MODEL, text: r.text, finishReason: r.finishReason, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cost_usd: cost,
          prompt: { name: prompt.name, version: prompt.version, content_hash: prompt.content_hash }, image: p.image, image_bytes_sent: img.length, at: new Date().toISOString() }, null, 1));
        console.log(`  ${p.stratum} ${p.title?.slice(0, 30)} p${p.page_number}: old ${p.old.text.length}ch/${unclearCount(p.old.text)}u → new ${r.text.length}ch/${unclearCount(r.text)}u  $${cost.toFixed(4)}`);
      } catch (e) { fs.writeFileSync(f.replace(/\.json$/, '.failed.json'), JSON.stringify({ id: p.id, error: String(e.message).slice(0, 400) })); console.log(`  FAIL ${p.id}: ${e.message}`); }
    }
  }));
  console.log(`spent this run $${spent.toFixed(4)} realtime; envelope now ≈ $${(env.measured + spent).toFixed(4)}`);
}

async function stageSheet() {
  fs.mkdirSync(F('sheet'), { recursive: true });
  for (const p of rl(F('pages.jsonl'))) {
    const f = F('ocr', `${p.id}.json`); if (!fs.existsSync(f)) continue;
    const n = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(F('sheet', `${p.id}.jpg`), await imageAt(p.image, 1600, 85));
    fs.writeFileSync(F('sheet', `${p.id}.txt`), `${p.stratum} | ${p.title} p${p.page_number} | ${p.signals.join(',')}\n${p.image}\n\n===== OLD (${p.old.model}, ${p.old.updated_at}) =====\n${p.old.text}\n\n===== NEW (${n.model}, ≤${MAX_PX}px) =====\n${n.text}\n`);
  }
  console.log(`sheets in ${F('sheet')}`);
}

try {
  if (STAGE === 'select') await stageSelect();
  else if (STAGE === 'ocr') await stageOcr();
  else if (STAGE === 'sheet') await stageSheet();
  else { console.error('stage: select | ocr | sheet'); process.exitCode = 2; }
} finally { await client.close(); }
