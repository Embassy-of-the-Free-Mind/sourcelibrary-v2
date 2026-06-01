#!/usr/bin/env node
/**
 * Run audit-collision-pairs vision verification across every BPH book with
 * page_number collisions. Output a master JSON listing each collision pair
 * and Gemini's verdict. Does NOT apply anything — purely reads.
 *
 * Subsequent script `apply-confirmed-collision-dedup.mjs` (separate) can read
 * this output and hide only vision-confirmed SAME pairs.
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1 || process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function fetchAsInlineData(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } };
}

async function visionSame(urlA, urlB) {
  try {
    const [a, b] = await Promise.all([fetchAsInlineData(urlA), fetchAsInlineData(urlB)]);
    const r = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [a, b, { text: 'Two scanned pages from a book. SAME printed page content (possibly slight crop/brightness diff) or DIFFERENT? One word: SAME, DIFFERENT, or UNSURE.' }] }],
    });
    const t = (r.text || '').trim().toUpperCase();
    if (t.startsWith('SAME')) return 'same';
    if (t.startsWith('DIFF')) return 'different';
    return 'unsure';
  } catch (e) { return 'error:' + e.message.slice(0, 60); }
}

const audit = JSON.parse(readFileSync(resolve(REPO_ROOT, '.claude/docs/bph-archive-mismatch.json'), 'utf8'));
const collisionBooks = audit.filter(r => r.pagenum_collisions > 0).sort((a, b) => b.pagenum_collisions - a.pagenum_collisions);
console.log(`Books with collisions: ${collisionBooks.length}, total collision pairs: ${collisionBooks.reduce((s, r) => s + r.pagenum_collisions, 0)}`);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

const results = [];
const outPath = resolve(REPO_ROOT, '.claude/docs/all-collision-vision-audit.json');

for (let bi = 0; bi < collisionBooks.length; bi++) {
  const b = collisionBooks[bi];
  // Load all visible pages, group by page_number
  const pages = await db.collection('pages').find(
    { book_id: b.id, page_number: { $gt: 0 } },
    { projection: { _id: 1, page_number: 1, page_type: 1, cropped_photo: 1, photo: 1 } }
  ).toArray();
  const groups = new Map();
  for (const p of pages) {
    if (!groups.has(p.page_number)) groups.set(p.page_number, []);
    groups.get(p.page_number).push(p);
  }
  const collisions = [...groups.entries()].filter(([_, v]) => v.length > 1);

  const bookEntry = { id: b.id, slug: b.slug, total_collisions: collisions.length, pairs: [] };
  for (const [pgNum, docs] of collisions) {
    // Sort by _id ascending → earliest first
    docs.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    const [a, dup] = docs;
    const ua = a.cropped_photo || a.photo;
    const ub = dup.cropped_photo || dup.photo;
    const verdict = await visionSame(ua, ub);
    bookEntry.pairs.push({
      page_number: pgNum,
      keep_id: String(a._id),     // earlier doc
      dup_id: String(dup._id),    // later doc — candidate to hide if SAME
      keep_url: ua, dup_url: ub,
      verdict,
    });
  }
  const counts = { same: 0, different: 0, unsure: 0, error: 0 };
  for (const p of bookEntry.pairs) counts[p.verdict.startsWith('error') ? 'error' : p.verdict]++;
  results.push(bookEntry);
  console.log(`[${bi + 1}/${collisionBooks.length}] ${(b.slug || '').slice(0, 50).padEnd(50)} | total=${collisions.length} same=${counts.same} diff=${counts.different} unsure=${counts.unsure}`);
  if ((bi + 1) % 10 === 0) writeFileSync(outPath, JSON.stringify(results, null, 2));
}
writeFileSync(outPath, JSON.stringify(results, null, 2));

const totals = results.reduce((s, r) => {
  for (const p of r.pairs) s[p.verdict.startsWith('error') ? 'error' : p.verdict] = (s[p.verdict.startsWith('error') ? 'error' : p.verdict] || 0) + 1;
  return s;
}, {});
console.log(`\nTotals across all collision pairs: ${JSON.stringify(totals)}`);
console.log(`Report: ${outPath}`);
await c.close();
