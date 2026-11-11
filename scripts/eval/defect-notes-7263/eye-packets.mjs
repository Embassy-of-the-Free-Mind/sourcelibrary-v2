// PRIOR ART: scripts/eval/confidence-7866/lib.mjs imageUrl (getPageSource) is the image resolver used here, unchanged;
// scripts/eval/defect-notes-7263/patterns.mjs writes the page lists. No packet builder existed for "is the judge's note right".
/**
 * Build by-eye packets for the #7263 defect-notes check: per pattern, up to N pages (one per book, seeded), each with the
 * page image (long side 1800 px), the stored text as served now, and the judge's notes for that pattern.
 *   node --env-file=... scripts/eval/defect-notes-7263/eye-packets.mjs
 * Writes $JOB_SCRATCH/eye/<pattern>/<k>/{page.jpg,text.txt,source.txt,notes.json}. Read-only on Mongo.
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { imageUrl } from '../confidence-7866/lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
const S = process.env.JOB_SCRATCH;
const P = JSON.parse(fs.readFileSync(`${S}/pattern-pages.json`, 'utf8'));
const PLAN = [
  ['misread_other_script', ['served'], 15], ['misread_latin_ms', ['served'], 12], ['invented_hard_hand', ['served'], 15],
  ['line_dropped', ['served'], 12], ['margin_gloss', ['served'], 12], ['loop', ['served', 'arms'], 15],
  ['long_s', ['served', 'arms'], 15], ['tr_note_invents', ['arms'], 8], ['tr_summary_invents', ['arms'], 7],
];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const usedBooks = new Set(); const index = [];
for (const [pat, frames, n] of PLAN) {
  let list = frames.flatMap((f) => (P[`${f}|${pat}`] || []).map((x) => ({ ...x, frame: f })));
  const rng = makeRng(72630 + pat.length); for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  list.sort((a, b) => (a.frame === 'served' ? 0 : 1) - (b.frame === 'served' ? 0 : 1));
  let k = 0;
  for (const x of list) {
    if (k >= n) break;
    if (usedBooks.has(x.book_id) || !x.page_id) continue;
    const p = await pages.findOne({ id: x.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, photo: 1, display_photo: 1, archived_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1 } });
    if (!p) continue;
    const url = x.image_url || imageUrl(p);
    let buf; try { const r = await fetch(url); if (!r.ok) continue; buf = Buffer.from(await r.arrayBuffer()); } catch { continue; }
    const dir = `${S}/eye/${pat}/${String(k).padStart(2, '0')}`; fs.mkdirSync(dir, { recursive: true });
    await sharp(buf).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(`${dir}/page.jpg`);
    fs.writeFileSync(`${dir}/text.txt`, x.frame === 'served' ? String(p.ocr?.data ?? '') : '(arm output not stored; check the quoted span in notes.json against the image)');
    if (pat.startsWith('tr_')) { fs.writeFileSync(`${dir}/source.txt`, String(p.ocr?.data ?? '')); }
    fs.writeFileSync(`${dir}/notes.json`, JSON.stringify({ pattern: pat, frame: x.frame, lang: x.lang, script: x.script, route: x.route, ocr_updated_at: p.ocr?.updated_at ?? null, notes: x.notes }, null, 1));
    usedBooks.add(x.book_id); index.push({ pattern: pat, dir, row: x.id, book_id: x.book_id, page_id: x.page_id, page_number: x.page_number, frame: x.frame, route: x.route, lang: x.lang }); k++;
  }
  console.log(pat, k);
}
fs.writeFileSync(`${S}/eye/index.json`, JSON.stringify(index, null, 1));
console.log('total', index.length);
await c.close();
