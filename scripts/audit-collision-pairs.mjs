#!/usr/bin/env node
/**
 * For a given book id, find every digital page_number that has >1 page doc.
 * For each collision pair, run a Gemini-vision check ("same printed page? yes/
 * no/unsure"). Output JSON + HTML preview.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const BOOK = args[args.indexOf('--book') + 1];
const SKIP_VISION = args.includes('--no-vision');
if (!BOOK) { console.error('--book <id> required'); process.exit(1); }

const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1 || process.env.GOOGLE_API_KEY;
const ai = (apiKey && !SKIP_VISION) ? new GoogleGenAI({ apiKey }) : null;

async function fetchBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } };
}

async function visionCompare(urlA, urlB) {
  if (!ai) return { decision: 'skip' };
  try {
    const [a, b] = await Promise.all([fetchBase64(urlA), fetchBase64(urlB)]);
    const r = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [a, b, { text: 'These are two scanned pages from a book. Are they showing the SAME printed page content, or DIFFERENT printed page content? Reply with one word: SAME, DIFFERENT, or UNSURE.' }] }],
    });
    const t = (r.text || '').trim().toUpperCase();
    if (t.startsWith('SAME')) return { decision: 'same' };
    if (t.startsWith('DIFFERENT') || t.startsWith('DIFF')) return { decision: 'different' };
    return { decision: 'unsure', raw: t };
  } catch (e) { return { decision: 'error', err: e.message }; }
}

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const book = await db.collection('books').findOne({ id: BOOK }, { projection: { id: 1, slug: 1, title: 1 } });
if (!book) { console.error('book not found'); process.exit(1); }

const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gt: 0 } }, { projection: { _id: 1, page_number: 1, page_type: 1, cropped_photo: 1, photo: 1, archived_photo: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
// Group by page_number
const groups = new Map();
for (const p of pages) {
  if (!groups.has(p.page_number)) groups.set(p.page_number, []);
  groups.get(p.page_number).push(p);
}
const collisions = [...groups.entries()].filter(([_,v]) => v.length > 1);
console.log(`${book.slug}: ${collisions.length} collision pairs`);

const out = { book_id: BOOK, slug: book.slug, title: book.title, collisions: [] };
let i = 0;
for (const [pgNum, docs] of collisions) {
  i++;
  // Take first 2 docs only (most collisions are pairs)
  const a = docs[0], b = docs[1];
  const ua = a.cropped_photo || a.photo;
  const ub = b.cropped_photo || b.photo;
  const v = await visionCompare(ua, ub);
  out.collisions.push({
    page_number: pgNum,
    docs: docs.length,
    a: { _id: String(a._id), url: ua, page_type: a.page_type, ocr_snip: (a.ocr?.data || '').replace(/\s+/g, ' ').slice(0, 100) },
    b: { _id: String(b._id), url: ub, page_type: b.page_type, ocr_snip: (b.ocr?.data || '').replace(/\s+/g, ' ').slice(0, 100) },
    vision: v.decision,
  });
  if (i % 5 === 0) console.log(`  ${i}/${collisions.length}…`);
}

const outDir = resolve(REPO_ROOT, '.claude/docs');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, `collision-pairs-${BOOK}.json`), JSON.stringify(out, null, 2));

// HTML preview
const htmlPath = `/tmp/collision-${BOOK}.html`;
const html = `<!doctype html><meta charset=utf8><title>${book.slug} collision pairs</title>
<style>
body { font-family: system-ui; background: #1a1a1a; color: #ddd; padding: 1rem; max-width: 1500px; margin: 0 auto; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; padding: 1rem; background: #2a2a2a; border-radius: 8px; }
.pair img { width: 100%; max-height: 600px; object-fit: contain; background: #fff; }
.meta { font-size: 0.85rem; margin-bottom: 0.5rem; color: #aaa; }
.same { color: #6c6; } .different { color: #f88; } .unsure { color: #fc6; } .skip { color: #888; }
.ocr { font-size: 0.7rem; background: #1a1a1a; padding: 0.3rem; margin-top: 0.3rem; color: #888; font-family: monospace; }
</style>
<h1>${book.title || book.slug} — ${out.collisions.length} colliding page_numbers</h1>
<p>Each pair shares the same digital page_number. Vision verdict tells you whether they're the same physical page (= dupe) or different (= reassignment needed).</p>
${out.collisions.map(c => `
<h3>Digital pg ${c.page_number} — <span class="${c.vision}">vision: ${c.vision}</span></h3>
<div class="pair">
  <div><div class="meta">${c.a.page_type || '?'}</div><img src="${c.a.url}" loading="lazy"><div class="ocr">${(c.a.ocr_snip || '').replace(/</g, '&lt;')}</div></div>
  <div><div class="meta">${c.b.page_type || '?'}</div><img src="${c.b.url}" loading="lazy"><div class="ocr">${(c.b.ocr_snip || '').replace(/</g, '&lt;')}</div></div>
</div>`).join('')}
`;
writeFileSync(htmlPath, html);
const counts = { same: 0, different: 0, unsure: 0, error: 0, skip: 0 };
for (const c of out.collisions) counts[c.vision] = (counts[c.vision] || 0) + 1;
console.log(`Vision: same=${counts.same}, different=${counts.different}, unsure=${counts.unsure}, error=${counts.error}, skip=${counts.skip}`);
console.log(`Preview: file://${htmlPath}`);
await c.close();
