#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/draw.mjs — a run of 4 consecutive Paddle pages from 15 books, not one page
// per book split by translation call site; its seeded stream (makeRng, mulberry32) and getPageSource are reused here.
/**
 * #5600 error-type draw, read only. Siku cohort = books held under siku-translate-lane.mjs HOLD_REASONS.
 *   Arm A (served 1/call lane): 30 books, one page each, translation.engine.call_site scripts/batch/cli-translate.mjs,
 *     model gemini-3.8-flash-low.
 *   Arm B (older block Batch lane): 20 other books, one page each, call_site scripts/lib/translate-batch-chained.mjs.
 *   Seams: the two 圖書編 pages named in the brief, each with its previous page.
 * Eligible page: AI translation (not a human edit), OCR >= 150 chars, isTranslatablePage (not furniture-only).
 * Seed 5600: one shuffle of each arm's book frame, then a seeded pick among the book's eligible pages.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/siku-error-types-5600/draw.mjs [--out=DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { isTranslatablePage } from '../../lib/translate-core.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { HOLD_REASONS } from '../../batch/siku-translate-lane.mjs';

const SEED = 5600;
const ARMS = [
  { arm: 'A', n: 30, call_site: 'scripts/batch/cli-translate.mjs', model: 'gemini-3.8-flash-low' },
  { arm: 'B', n: 20, call_site: 'scripts/lib/translate-batch-chained.mjs', model: null },
];
const SEAMS = [{ title: '圖書編·卷九十五~卷九十六 (vol 77)', page: 30 }, { title: '圖書編·卷二十四 (vol 22)', page: 33 }];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || path.dirname(new URL(import.meta.url).pathname));
const PROJ = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 };

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const pagesC = db.collection('pages');
const cohort = await db.collection('books').find({ 'pipeline_auto.hold.reason': { $in: [...HOLD_REASONS] } }, { projection: { id: 1, title: 1, slug: 1, visible: 1, 'pipeline_auto.hold.reason': 1 } }).toArray();
const byId = new Map(cohort.filter((b) => b.id).map((b) => [b.id, b]));
const eligible = (p) => p.translation?.source === 'ai' && (p.ocr?.data?.length ?? 0) >= 150 && isTranslatablePage(p).ok && !!getPageSource(p);
const row = (b, p) => ({
  book_id: b.id, title: b.title, slug: b.slug ?? null, visible: b.visible ?? null, hold: b.pipeline_auto?.hold?.reason ?? null,
  page_id: p.id, page_number: p.page_number, ocr_chars: p.ocr.data.length, ocr_source: p.ocr.source ?? null,
  call_site: p.translation?.engine?.call_site ?? null, model: p.translation?.model ?? null, translated_at: p.translation?.updated_at ?? null,
  image: getPageSource(p), url: `https://sourcelibrary.org/book/${b.slug || b.id}/page/${p.id}`,
});

const used = new Set(), out = {};
for (const a of ARMS) {
  const m = { book_id: { $in: [...byId.keys()] }, 'translation.engine.call_site': a.call_site, 'translation.data': { $exists: true, $ne: '' } };
  if (a.model) m['translation.model'] = a.model;
  const ids = (await pagesC.distinct('book_id', m)).sort();
  const rng = makeRng(SEED + (a.arm === 'B' ? 1 : 0));
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const picked = [], skipped = [];
  for (const id of ids) {
    if (picked.length >= a.n) break;
    if (used.has(id)) { skipped.push({ id, why: 'in arm A' }); continue; }
    const ps = (await pagesC.find({ ...m, book_id: id }, { projection: PROJ }).sort({ page_number: 1 }).toArray()).filter(eligible);
    if (!ps.length) { skipped.push({ id, why: 'no eligible page' }); continue; }
    const p = ps[Math.floor(rng() * ps.length)];
    used.add(id);
    picked.push(row(byId.get(id), p));
  }
  out[a.arm] = { ...a, frame_books: ids.length, skipped, pages: picked };
  console.log(`arm ${a.arm}: frame ${ids.length} books, picked ${picked.length}, skipped ${skipped.length}`);
}
const seams = [];
for (const s of SEAMS) {
  const b = await db.collection('books').findOne({ title: s.title }, { projection: { id: 1, title: 1, slug: 1, visible: 1, 'pipeline_auto.hold.reason': 1 } });
  if (!b) { console.log(`seam: no book titled ${s.title}`); continue; }
  const p = await pagesC.findOne({ book_id: b.id, page_number: s.page }, { projection: PROJ });
  seams.push(row(b, p));
}
out.S = { arm: 'S', pages: seams };
await client.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, hold_reasons: HOLD_REASONS, drawn_at: new Date().toISOString(), arms: out }, null, 1) + '\n');
for (const a of Object.values(out)) for (const p of a.pages) console.log(`  ${a.arm} ${p.book_id} p${p.page_number} ${p.ocr_chars}ch ${p.ocr_source} ${p.model} ${p.title}`);
