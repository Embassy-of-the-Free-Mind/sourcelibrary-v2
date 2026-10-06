#!/usr/bin/env node
// #6012 by-eye checks: builds the packets a reader opens. Two kinds.
//   title  20 matched books per source: our title-page image beside the typed text's catalogue line and
//          its own transcription of the title page. Question: same edition, same work, or neither?
//   leaf   aligned pages: our page image (whole + 3 strips) beside the typed text of the span the
//          aligner chose. Question: is this the text printed on this leaf?
// Packets go to scratch (they hold typed text and page images; never committed). Verdicts are written
// by the readers into verdicts.jsonl beside them and summarised by eye-score.mjs.
// READ-ONLY on Mongo. $0.
//
// PRIOR ART: scripts/eval/xlref-t1/crop.mjs (one image into strips; reused here as a function would
//   need a refactor of a CLI, so the three sharp calls are repeated); ground-truth-5935/floor.mjs (packets
//   of DIFFERENCES for the 30 worst pages per reference, a different question); #5126's leaf check
//   (job-local). Page image source: scripts/lib/page-image-url.mjs getPageSource.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/typed-refs-6012/eye-packets.mjs --kind=title|leaf --source=dta|camena|eebo-tcp --n=20

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { bodyText } from '../ground-truth-5935/lib.mjs';
import { titleTokens } from '../../lib/work-identity-match.mjs';
import { argOf, UA } from './lib.mjs';

const KIND = argOf('kind'), SOURCE = argOf('source'), N = Number(argOf('n', '20'));
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const dirOf = { dta: 'dta', camena: 'camena', 'eebo-tcp': 'eebo' }[SOURCE];
const DIR = path.join(WORK, dirOf), OUT = path.join(WORK, 'eye', KIND, SOURCE);
fs.mkdirSync(OUT, { recursive: true });
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const h = (s) => parseInt(createHash('sha256').update(`6012|${KIND}|${s}`).digest('hex').slice(0, 12), 16);
const manifest = new Map(readJsonl(`${DIR}/manifest.jsonl`).map((m) => [m.source_id, m]));
const shardCache = new Map();
function refPages(sourceId) {
  const m = manifest.get(sourceId);
  if (!shardCache.has(m.derived_shard)) { shardCache.clear(); shardCache.set(m.derived_shard, new Map(zlib.gunzipSync(fs.readFileSync(`${DIR}/derived/${m.derived_shard}`)).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.source_id, r.pages]; }))); }
  return shardCache.get(m.derived_shard).get(sourceId);
}
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const pagesCol = client.db('bookstore').collection('pages'), booksCol = client.db('bookstore').collection('books');
async function saveImage(page, prefix, strips = 0) {
  const url = getPageSource(page);
  if (!url) return null;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  await sharp(buf).resize({ width: 1500, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(`${prefix}-full.jpg`);
  const files = [`${prefix}-full.jpg`];
  for (let i = 0; i < strips; i++) {
    const hh = Math.ceil(meta.height / strips), ov = Math.round(hh * 0.08), top = Math.max(0, i * hh - ov), height = Math.min(meta.height - top, hh + 2 * ov);
    await sharp(buf).extract({ left: 0, top, width: meta.width, height }).resize({ width: 1800, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(`${prefix}-s${i + 1}.jpg`);
    files.push(`${prefix}-s${i + 1}.jpg`);
  }
  return files;
}
const IMG = { page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1, 'ocr.data': 1 };
const index = [];

if (KIND === 'title') {
  // one pair per matched book (same-edition wins, then most aligned pages), seeded order
  const best = new Map();
  for (const p of readJsonl(`${DIR}/pairs.jsonl`).filter((x) => x.kind)) { const b = best.get(p.book_id); if (!b || (p.kind === 'same-edition') > (b.kind === 'same-edition') || (p.kind === b.kind && p.aligned_pages > b.aligned_pages)) best.set(p.book_id, p); }
  const draw = [...best.values()].sort((a, b) => h(a.book_id) - h(b.book_id));
  for (const p of draw) {
    if (index.length >= N) break;
    const m = manifest.get(p.source_id), book = await booksCol.findOne({ id: p.book_id }, { projection: { title: 1, author: 1, published: 1, language: 1 } });
    const first = await pagesCol.find({ book_id: p.book_id, page_number: { $lte: 14 } }, { projection: IMG }).hint({ book_id: 1, page_number: 1 }).toArray();
    const want = new Set(titleTokens(`${m.title || ''} ${book?.title || ''}`));
    const score = (t) => { const ts = new Set(titleTokens(t)); let n = 0; for (const w of want) if (ts.has(w)) n++; return n; };
    const tp = first.map((pg) => ({ pg, s: score(bodyText(pg.ocr?.data || '')) + (/<page-type>\s*title/i.test(pg.ocr?.data || '') ? 3 : 0) })).sort((a, b) => b.s - a.s || a.pg.page_number - b.pg.page_number)[0];
    if (!tp || tp.s < 2) continue;
    const id = String(index.length + 1).padStart(2, '0');
    const files = await saveImage(tp.pg, `${OUT}/${id}`, 0).catch(() => null);
    if (!files) continue;
    const rp = refPages(p.source_id) || [];
    const rt = rp.slice(0, 10).map((x) => ({ x, s: score(x.text) })).sort((a, b) => b.s - a.s)[0];
    fs.writeFileSync(`${OUT}/${id}.txt`, [`PACKET ${id} (${SOURCE})`, `OUR BOOK ${p.book_id}, page ${tp.pg.page_number}: image ${files[0]}`, `Our catalogue: ${book?.title} / ${book?.author} / ${book?.published}`,
      '', `TYPED TEXT ${p.source_id}`, `Its catalogue line: ${m.author || ''}: ${m.title || ''}. ${m.place || ''} ${m.printer || ''} ${m.year || ''}`.trim(), m.citation ? `Citation: ${m.citation}` : '',
      '', 'The typed text\'s own transcription of its title page (line breaks as typed):', '-----', (rt?.x.text || '(none found in its first leaves)').slice(0, 2500), '-----'].join('\n'));
    index.push({ id, source: SOURCE, source_id: p.source_id, book_id: p.book_id, page_number: tp.pg.page_number, claimed_kind: p.kind, confidence: p.confidence, tier: p.tier, packet: `${OUT}/${id}.txt`, image: files[0] });
  }
} else {
  // aligned pages: one page per book first (seeded), same-edition and other-edition in the share they occur
  const rows = readJsonl(`${DIR}/aligned-pages.jsonl`);
  const perBook = new Map();
  for (const r of rows) { const b = perBook.get(r.book_id); if (!b || h(`${r.book_id}|${r.page_number}`) < h(`${b.book_id}|${b.page_number}`)) perBook.set(r.book_id, r); }
  const draw = [...perBook.values()].sort((a, b) => h(a.book_id) - h(b.book_id));
  for (const r of draw) {
    if (index.length >= N) break;
    const pg = await pagesCol.findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: IMG });
    if (!pg) continue;
    const id = String(index.length + 1).padStart(2, '0');
    const files = await saveImage(pg, `${OUT}/${id}`, 3).catch(() => null);
    if (!files) continue;
    const rp = refPages(r.source_id);
    const span = rp.slice(r.ref_page_idx[0], r.ref_page_idx[1] + 1).map((x) => `[typed page ${x.n ?? '?'}]\n${x.text}${x.notes.length ? `\n[its notes]\n${x.notes.join('\n')}` : ''}`).join('\n\n');
    fs.writeFileSync(`${OUT}/${id}.txt`, [`PACKET ${id} (${SOURCE})`, `OUR PAGE: book ${r.book_id}, page ${r.page_number}. Images: ${files.join(', ')}`, `The aligner placed this leaf on typed page(s) ${r.ref_pb.join(' to ')} of ${r.source_id}. (Its kind and score are withheld from the reader.)`,
      '', 'TYPED TEXT of those page(s):', '-----', span.slice(0, 9000), '-----'].join('\n'));
    index.push({ id, source: SOURCE, source_id: r.source_id, book_id: r.book_id, page_number: r.page_number, claimed_kind: r.kind, congruent: r.congruent, overlap: r.overlap, ref_page_idx: r.ref_page_idx, span: r.span, engine: r.engine, packet: `${OUT}/${id}.txt`, images: files });
  }
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
console.log(KIND, SOURCE, index.length, 'packets in', OUT);
await client.close();
