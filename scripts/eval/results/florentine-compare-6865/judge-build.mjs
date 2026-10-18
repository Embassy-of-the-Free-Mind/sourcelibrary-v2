// PRIOR ART: scripts/eval/results/paired-translate-maya-6559/judge-build.mjs, copied; adds '{db-tr}' (the stored translation) and drops
// the {language} slot (one prompt for the Codex). Ran as scripts/.tmp-judge-build-6865.mjs (imports relative to scripts/).
// Build a paired judge packet (both A/B orders) for two arms over a page list. Writes NOTHING to the database.
//   --task=translate|ocr --pages=F (JSON {book_id:[page_id..]} or OCR pages.json) --x=name:dirTemplate --y=name:dirTemplate --out=DIR
// dirTemplate: a path with {book} for the book id; '{db-ocr}' means the page's stored OCR, '{db-tr}' its stored translation. Reads are <dir>/<page_id>.txt.
import { MongoClient } from 'mongodb'; import fs from 'node:fs'; import crypto from 'node:crypto';
import { getPageSource } from './lib/page-image-url.mjs';
import sharp from 'sharp';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const TASK = arg('task'), OUT = arg('out'); const [xn, xd] = arg('x').split(/:(.*)/s), [yn, yd] = arg('y').split(/:(.*)/s);
fs.mkdirSync(`${OUT}/img`, { recursive: true });
const tmpl = fs.readFileSync(arg('prompt'), 'utf8').trim();
const strip = (t) => t.replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(/<keywords>[\s\S]*?<\/keywords>/g, '').trim();
let list = JSON.parse(fs.readFileSync(arg('pages'), 'utf8'));
list = Array.isArray(list) ? list.map((s) => [s.book, s.page]) : Object.entries(list).flatMap(([b, ps]) => ps.map((p) => [b, p]));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const read = (tpl, b, p) => tpl === '{db-ocr}' ? p.ocr.data.trim() : tpl === '{db-tr}' ? strip(p.translation.data) : strip(fs.readFileSync(`${tpl.replace('{book}', b)}/${p.id}.txt`, 'utf8'));
const h = (s) => crypto.createHash('sha256').update(s).digest();
const K = [[], []], Rq = [[], []];
for (const [bookId, pid] of list) {
  const b = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, language: 1 } });
  const p = await db.collection('pages').findOne({ id: pid });
  const x = read(xd, bookId, p), y = read(yd, bookId, p);
  if (!x || !y) { console.error('missing read', bookId, pid, x.length, y.length); process.exit(1); }
  const src = getPageSource(p); const res = await fetch(src); if (!res.ok) throw new Error(`img ${res.status} ${src}`);
  // The Codex scans are ~5,400 × 7,500 px, 11 MB: past what a judge reads whole. 2,400 px on the long side.
  const buf = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 2400, height: 2400, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  const xFirst = h(`${xn}:${yn}:${pid}`)[0] % 2 === 0;
  for (const swap of [0, 1]) {
    const xA = swap ? !xFirst : xFirst;
    const uid = h(`${xn}:${yn}:${pid}:${swap}`).toString('hex').slice(0, 8);
    fs.writeFileSync(`${OUT}/img/${uid}.jpg`, buf);
    const lang = b.language;
    const prompt = TASK === 'ocr'
      ? `${tmpl.replace('{language}', lang)}\n\n\nTRANSCRIPTION A:\n${xA ? x : y}\n\nTRANSCRIPTION B:\n${xA ? y : x}\n\nThe page image:`
      : `${tmpl.replace('{language}', lang)}\n\n\nSOURCE TRANSCRIPTION (OCR of the page):\n${p.ocr.data.trim()}\n\nTRANSLATION A:\n${xA ? x : y}\n\nTRANSLATION B:\n${xA ? y : x}\n\nThe page image:`;
    K[swap].push({ uid, book_id: bookId, title: b.title, language: lang, page_id: pid, page_number: p.page_number, A: xA ? xn : yn, B: xA ? yn : xn, image_url: src });
    Rq[swap].push({ uid, prompt, image: `${OUT}/img/${uid}.jpg` });
  }
}
fs.writeFileSync(`${OUT}/key.json`, JSON.stringify(K[0], null, 1)); fs.writeFileSync(`${OUT}/key-swap.json`, JSON.stringify(K[1], null, 1));
fs.writeFileSync(`${OUT}/requests.jsonl`, Rq[0].map((r) => JSON.stringify(r)).join('\n') + '\n'); fs.writeFileSync(`${OUT}/requests-swap.jsonl`, Rq[1].map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(OUT, 'built', Rq[0].length, '+', Rq[1].length);
await c.close();
