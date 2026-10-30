#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/prep.mjs — builds packets of four shuffled English versions of one page with
// planted controls; here each packet is ONE served English with the previous page's tail, so the judge can see seams.
// Its body() (cut <summary>/<keywords>) is copied: importing that file runs its CLI.
/**
 * #5600 judge packets from draw.json: per page the image (downloaded to DIR/img), the page's OCR, the served English body,
 * the last 2 lines of the previous page's OCR and English, the first 2 lines of the next page's OCR. Packets are named
 * P01…P52 in a seeded order so the arm cannot be read off the name; the name -> page/arm key goes to DIR/key.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/siku-error-types-5600/prep.mjs --scratch=DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = path.resolve(arg('scratch'));
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
fs.mkdirSync(path.join(S, 'img'), { recursive: true });
fs.mkdirSync(path.join(S, 'packets'), { recursive: true });

const body = (t) => String(t || '').replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(/<keywords>[\s\S]*?<\/keywords>/g, '').trim();
const lines = (t) => String(t || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^<(language|script)>/.test(l));
const tail = (t, n = 2) => lines(t).slice(-n).map((l) => (l.length > 400 ? '…' + l.slice(-400) : l)).join('\n') || null;
const head = (t, n = 2) => lines(t).slice(0, n).map((l) => (l.length > 400 ? l.slice(0, 400) + '…' : l)).join('\n') || null;

const all = Object.values(draw.arms).flatMap((a) => a.pages.map((p) => ({ ...p, arm: a.arm })));
const rng = makeRng(56001);
for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const pages = client.db('bookstore').collection('pages');
const key = {};
for (const [i, pg] of all.entries()) {
  const name = `P${String(i + 1).padStart(2, '0')}`;
  const near = await pages.find({ book_id: pg.book_id, page_number: { $in: [pg.page_number - 1, pg.page_number, pg.page_number + 1] } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const at = (n) => near.find((p) => p.page_number === n);
  const img = path.join(S, 'img', `${name}.jpg`);
  if (!fs.existsSync(img)) {
    const r = await fetch(pg.image);
    if (!r.ok) throw new Error(`${pg.page_id}: image ${r.status}`);
    fs.writeFileSync(img, Buffer.from(await r.arrayBuffer()));
  }
  const cur = at(pg.page_number);
  key[name] = { ...pg, english_chars: body(cur.translation?.data).length };
  fs.writeFileSync(path.join(S, 'packets', `${name}.json`), JSON.stringify({
    name, book_title: pg.title, page_number: pg.page_number, image: img,
    ocr: cur.ocr.data, english: body(cur.translation?.data),
    prev_ocr_tail: tail(at(pg.page_number - 1)?.ocr?.data), prev_english_tail: tail(body(at(pg.page_number - 1)?.translation?.data)),
    next_ocr_head: head(at(pg.page_number + 1)?.ocr?.data),
  }, null, 1));
}
await client.close();
fs.writeFileSync(path.join(S, 'key.json'), JSON.stringify(key, null, 1));
console.log(`${all.length} packets in ${S}/packets; key in ${S}/key.json`);
