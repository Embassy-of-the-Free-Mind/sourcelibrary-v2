// PRIOR ART: scripts/eval/benchmark-seal.mjs (isSkqs and BUDDHIST_RE — copied, they are not exported), and
// zh-cohort-5547-draw.mjs (its skqs_shape test is the same rule). Neither draws one Paddle body page per book for a
// text-only arm, so this is the frame-B draw of #8140. READ-ONLY on Mongo.
/**
 * node --env-file=… scripts/eval/zh-punct-8140/draw-b.mjs --priv=DIR
 * Writes <priv>/B/<slug>.input.txt (Paddle body, tags stripped — our own OCR text), <slug>.jpg (the page image) and
 * scripts/eval/zh-punct-8140/draw-B.json (ids only).
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { mulberry32, hanCount, stripForInput } from './lib.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = path.join(argOf('priv'), 'B'); fs.mkdirSync(PRIV, { recursive: true });
const BUDDHIST_RE = /佛|般若|菩薩|陀羅尼|華嚴|法華|楞嚴|楞伽|金剛|阿含|大藏|禪|涅槃|起信|淨土|地藏|藥師|觀音|sutra|sūtra/;
const isSkqs = (b) => !b.contributing_library && /\(vol \d+\)/.test(b.title || '');
// Whole-line furniture Paddle wraps in a tag (running head, juan, folio, language/script lines) goes; the body stays.
export const bodyOf = (t) => stripMarkupTags(String(t || '').split('\n').filter((l) => !/^\s*<(header|footer|language|script|page-num|pagenum|folio|margin|meta|note-margin)[^>]*>.*<\/\1>\s*$/i.test(l) && !/^\s*<(language|script)\b/i.test(l)).join('\n'), '');
const N = 30; const rng = mulberry32(81402);
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const books = (await db.collection('books').find({ language: /^(Chinese|Classical Chinese|Literary Chinese)$/i, visible: true, pages_count: { $gt: 0 }, title: /\(vol \d+\)/ }, { projection: { id: 1, title: 1, contributing_library: 1, 'catalog_metadata.subjects': 1 } }).toArray())
  .filter(isSkqs).filter((b) => !BUDDHIST_RE.test(b.title || '') && !(b.catalog_metadata?.subjects || []).some((s) => /釋家|佛/.test(String(s)))).sort((a, b) => a.id.localeCompare(b.id));
console.log('frame books', books.length);
for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
const rows = []; let looked = 0;
for (const b of books) {
  if (rows.length >= N) break; looked++;
  const ps = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 1 }, 'ocr.source': 'paddle' }, { projection: { page_number: 1, 'ocr.data': 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 }, maxTimeMS: 60000 }).sort({ page_number: 1 }).toArray();
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  const p = ps.find((x) => { const t = x.ocr?.data || ''; return !/<table|<td|\|/i.test(t) && hanCount(bodyOf(t)) >= 100; });
  if (!p) continue;
  const url = getPageSource(p);
  const res = await fetch(url); if (!res.ok) { console.log('image fail', b.id, res.status); continue; }
  const slug = `${b.id.slice(-6)}-p${p.page_number}`;
  fs.writeFileSync(path.join(PRIV, `${slug}.jpg`), Buffer.from(await res.arrayBuffer()));
  const input = stripForInput(bodyOf(p.ocr.data));
  fs.writeFileSync(path.join(PRIV, `${slug}.input.txt`), input);
  rows.push({ slug, book_id: b.id, page_id: String(p._id), page_number: p.page_number, title: b.title, subjects: b.catalog_metadata?.subjects || [], chars: [...input].length, image_url: url });
  process.stdout.write('.');
}
await c.close();
fs.writeFileSync(path.join(here, 'draw-B.json'), JSON.stringify({ issue: 8140, seed: 81402, frame_books: books.length, books_looked: looked, rule: 'Siku (vol N, no contributing library), non-Buddhist; one Paddle page per book, page_number>1, >=100 Han in body, no table', drawn_at: new Date().toISOString(), pages: rows }, null, 1));
console.log('\npicked', rows.length, 'after', looked);
