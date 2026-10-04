// Can Clef (Cloudflare's multimodal decision model) tell whether a page's text belongs to its image?
// PRIOR ART: scripts/eval/jev/clef-vs-jev-instruction.py — text-only Clef/Jev screen; this is the first image-input test.
//   Wrong-leaf detectors elsewhere compare text to text or image to image (dhash); none asks a vision model per page.
// Design: one page per book (pages in a book are one observation). For each sampled page N we pair its R2 image with
//   (a) its own OCR text — match, (b) page N+1's OCR text — the realistic off-by-one, same typeface and layout,
//   (c) another sampled book's OCR text — the easy control. Labels are constructed, so no judge is involved.
// Run: node --env-file=<.env.production.local> scripts/eval/jev/clef-leaf-match.mjs   (needs MONGODB_URI, CF_ANALYTICS_TOKEN)
//   N_BOOKS=60 OUT=<dir> IMG_PX=768. A 1600px page costs ~170K estimated tokens and is refused (64K window); size not yet calibrated — the Workers free plan ran out first (2026-10-04).
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CF_ACCOUNT = 'eb0562555fd5ce2a4ec0f29b6df10e7b';
const PRICE = { clef: 0.24, 'clef-flash': 0.09 }; // $/M input tokens
const N_BOOKS = Number(process.env.N_BOOKS || 60);
const OUT = process.env.OUT || '.';
const CAP_USD = 2.0;
const QUESTIONS = {
  same_page: { type: 'noul', instructions: 'The text in the state is a transcription of the page shown in the image (the same page, not a neighbouring page or a different book).' },
  relation: {
    type: 'choice',
    instructions: 'How does the transcription in the state relate to the page in the image?',
    criteria: {
      same: 'It transcribes this exact page',
      neighbour: 'It is from the same book (same typeface and layout) but a different page',
      unrelated: 'It is from a different book or document',
    },
  },
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const ocrText = (p) => (typeof p?.ocr === 'object' ? p.ocr?.data : p?.ocr) || '';

const samples = [];
const books = await db.collection('books')
  .aggregate([{ $match: { visible: true, pages_count: { $gt: 30 } } }, { $sample: { size: N_BOOKS * 3 } }, { $project: { id: 1, title: 1, language: 1 } }])
  .toArray();
const seen = new Set();
for (const b of books) {
  if (samples.length >= N_BOOKS) break;
  const bid = b.id || String(b._id);
  if (seen.has(bid)) continue;
  seen.add(bid);
  const pages = await db.collection('pages')
    .find({ book_id: bid, page_number: { $gte: 1 } }, { projection: { page_number: 1, ocr: 1, display_photo: 1, archived_photo: 1 } })
    .sort({ page_number: 1 }).toArray();
  const ok = [];
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i], n = pages[i + 1];
    if (n.page_number !== a.page_number + 1) continue;
    const img = a.display_photo || a.archived_photo;
    if (!img || !/images\.sourcelibrary\.org|r2\./.test(img)) continue;
    if (ocrText(a).length < 500 || ocrText(n).length < 500) continue;
    ok.push([a, n, img]);
  }
  if (!ok.length) continue;
  const [a, n, img] = ok[Math.floor(Math.random() * ok.length)];
  samples.push({ book_id: bid, title: (b.title || '').slice(0, 80), language: b.language, page: a.page_number, img, own: ocrText(a), next: ocrText(n) });
}
await client.close();
console.log('sampled', samples.length, 'books');

const tmp = fs.mkdtempSync(path.join(OUT, 'leaf-'));
async function loadImage(url, i) {
  const raw = path.join(tmp, `${i}.src`), jpg = path.join(tmp, `${i}.jpg`);
  const r = await fetch(url);
  if (!r.ok) return null;
  fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', process.env.IMG_PX || '768', raw, '--out', jpg], { stdio: 'ignore' });
  return 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64');
}

let spent = 0;
async function ask(model, image, text) {
  if (spent >= CAP_USD) throw new Error('cap reached');
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/cloudflare/${model}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, images: [image], state: text.slice(0, 4000), questions: QUESTIONS }),
    });
    if (r.status === 401 || r.status === 403) throw new Error('auth ' + r.status);
    if (!r.ok) { console.error(model, r.status, (await r.text()).slice(0, 200)); await new Promise((s) => setTimeout(s, 2000 * (i + 1))); continue; }
    const j = (await r.json()).result;
    spent += (j.usage.input_tokens * PRICE[model]) / 1e6;
    return { same: j.answers.same_page.noul, rel: j.answers.relation.choice, tokens: j.usage.input_tokens, ms: Date.now() - t0 };
  }
  return null;
}

const rows = [];
for (let i = 0; i < samples.length; i++) {
  const s = samples[i];
  const image = await loadImage(s.img, i).catch(() => null);
  if (!image) { console.error('image fail', s.book_id); continue; }
  const other = samples[(i + 1) % samples.length].own;
  for (const [cond, text] of [['match', s.own], ['next', s.next], ['other', other]]) {
    const row = { book_id: s.book_id, title: s.title, language: s.language, page: s.page, cond };
    for (const model of ['clef-flash', 'clef']) row[model] = await ask(model, image, text);
    rows.push(row);
  }
  if (i % 10 === 9) console.log(i + 1, 'books done, $', spent.toFixed(3));
}
fs.writeFileSync(path.join(OUT, 'clef-leaf-match-rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const auc = (pos, neg) => pos.length && neg.length ? pos.reduce((a, p) => a + neg.reduce((b, q) => b + (p > q) + 0.5 * (p === q), 0), 0) / (pos.length * neg.length) : null;
const summary = { n_books: new Set(rows.map((r) => r.book_id)).size, cost_usd: +spent.toFixed(4) };
for (const model of ['clef-flash', 'clef']) {
  const v = (c) => rows.filter((r) => r.cond === c && r[model]).map((r) => r[model].same);
  const ms = rows.map((r) => r[model]?.ms).filter(Boolean).sort((a, b) => a - b);
  const relAcc = (c, want) => { const R = rows.filter((r) => r.cond === c && r[model]); return `${R.filter((r) => r[model].rel === want).length}/${R.length}`; };
  summary[model] = {
    auc_match_vs_next: auc(v('match'), v('next')),
    auc_match_vs_other: auc(v('match'), v('other')),
    mean_p: { match: +(v('match').reduce((a, b) => a + b, 0) / v('match').length).toFixed(3), next: +(v('next').reduce((a, b) => a + b, 0) / v('next').length).toFixed(3), other: +(v('other').reduce((a, b) => a + b, 0) / v('other').length).toFixed(3) },
    relation_correct: { match: relAcc('match', 'same'), next: relAcc('next', 'neighbour'), other: relAcc('other', 'unrelated') },
    median_ms: ms[Math.floor(ms.length / 2)],
    mean_tokens: Math.round(rows.map((r) => r[model]?.tokens || 0).reduce((a, b) => a + b, 0) / rows.length),
  };
}
const langs = {};
for (const r of rows) (langs[r.language || '?'] ??= new Set()).add(r.book_id);
summary.languages = Object.fromEntries(Object.entries(langs).map(([k, s]) => [k, s.size]));
fs.writeFileSync(path.join(OUT, 'clef-leaf-match-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
