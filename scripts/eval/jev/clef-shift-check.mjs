// For each page Clef flagged as "text does not match image", test the neighbours: does the image match the text of
// page N−1 or N+1, or does the text match the image of N−1 or N+1? That separates a SHIFT (and its direction) from a
// page that matches nothing near it (bad OCR, missing text, a different source) — before any by-eye check or repair.
// PRIOR ART: scripts/eval/jev/clef-leaf-match.mjs — produces the flags (rows with clef.same < 0.5) this script reads.
// Run: FLAGS=<flags.json> OUT=<dir> node --env-file=<.env.production.local> scripts/eval/jev/clef-shift-check.mjs
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT || '.';
const flags = JSON.parse(fs.readFileSync(process.env.FLAGS));
const Q = { same_page: { type: 'noul', instructions: 'The text in the state is a transcription of the page shown in the image (the same page, not a neighbouring page or a different book).' } };
const tmp = fs.mkdtempSync(path.join(OUT, 'shift-'));
let k = 0, spent = 0;
const ocrText = (p) => (typeof p?.ocr === 'object' ? p.ocr?.data : p?.ocr) || '';
async function img(p) {
  const url = p?.cropped_photo || p?.display_photo || p?.archived_photo;
  if (!url) return null;
  const i = k++, raw = path.join(tmp, `${i}.src`), jpg = path.join(tmp, `${i}.jpg`);
  const r = await fetch(url); if (!r.ok) return null;
  fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '1024', raw, '--out', jpg], { stdio: 'ignore' });
  return 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64');
}
async function ask(image, text) {
  if (!image || text.length < 100) return null;
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/eb0562555fd5ce2a4ec0f29b6df10e7b/ai/run/@cf/cloudflare/clef', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'clef', images: [image], state: text.slice(0, 4000), questions: Q }),
  });
  const j = (await r.json()).result; if (!j) return null;
  spent += (j.usage.input_tokens * 0.24) / 1e6;
  return +j.answers.same_page.noul.toFixed(3);
}
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const proj = { projection: { page_number: 1, ocr: 1, cropped_photo: 1, display_photo: 1, archived_photo: 1 } };
const out = [];
for (const f of flags) {
  const [prev, cur, next] = await Promise.all([f.page - 1, f.page, f.page + 1].map((n) => pages.findOne({ book_id: f.book_id, page_number: n }, proj)));
  const [iPrev, iCur, iNext] = await Promise.all([prev, cur, next].map(img));
  const row = {
    book_id: f.book_id, page: f.page, title: f.title, language: f.language, flag: f.clef.same,
    img_vs_prev_text: await ask(iCur, ocrText(prev)), img_vs_next_text: await ask(iCur, ocrText(next)),
    text_vs_prev_img: await ask(iPrev, ocrText(cur)), text_vs_next_img: await ask(iNext, ocrText(cur)),
    printed: (ocrText(cur).match(/<page-num>([^<]+)<\/page-num>/) || [])[1] || null,
  };
  const best = Math.max(...['img_vs_prev_text', 'img_vs_next_text', 'text_vs_prev_img', 'text_vs_next_img'].map((x) => row[x] ?? 0));
  row.verdict = best >= 0.7 ? 'shift' : 'no-neighbour-match';
  out.push(row);
  console.log(JSON.stringify(row));
}
await c.close();
fs.writeFileSync(path.join(OUT, 'shift-check.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('shift', out.filter((r) => r.verdict === 'shift').length, 'of', out.length, 'cost $', spent.toFixed(3));
