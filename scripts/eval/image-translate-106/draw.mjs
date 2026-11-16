#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (one page per book, seeded by a hash, interior 15-95%) and the
// #7263 European cell test's frame (2026-11-01-eu-agy-translation-cell-7263.md). Neither fits as is: judge.mjs's draws
// are wired to named OCR/translation cells, and #7263 drew UNTRANSLATED pages only; #106 asks for ordinary pages
// (translated or not) on the live agy translation rows. Read-only.
/**
 * #106 draw. Per language (Latin, German, French): visible books with pages that the live translation table routes to
 * the language's cli agy row (latin-cli-agy4, german-cli-agy4, french-cli-agy4; BPH books excluded by that row's
 * `unless`), not held, not an unsplit spread, minus the books v2#7611 used. Books in seeded-hash order; for each, one
 * page by seeded hash among its pages that are interior (15-95% of the book), translatable (page_type not skipped, not
 * withheld, not health-blocked), with >= 300 characters of OCR and a usable image URL. Writes the ordered candidate
 * list (more books than needed: fetch.mjs drops a page whose image fails and the next book takes its place).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local draw.mjs <out.json> [--per-lang=40] [--reserve=12]
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { translateLaneForBook } from '../../lib/translation-routing.mjs';
import { getPageSource, isUsableImageUrl } from '../../lib/page-image-url.mjs';
import { NOT_HELD, NOT_UNSPLIT_SPREAD } from '../../lib/pipeline-hold.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SEED = 'image-translate-106';
const OUT = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const PER = Number(arg('per-lang', 40)), RESERVE = Number(arg('reserve', 12));
const h = (s) => createHash('sha256').update(`${SEED}:${s}`).digest('hex');
const SKIP = ['blank', 'exlibris', 'bookplate', 'digitizer-notice', 'digitizer-insert'];
const ROWS = { 'latin-cli-agy4': 'Latin', 'german-cli-agy4': 'German', 'french-cli-agy4': 'French' };

const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/lib/translation-routing-table.json'), 'utf8'));
const r7611 = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'scripts/eval/ocr-error-to-translation-7611/results/2026-11-02/pages.jsonl.gz'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const EXCLUDE = new Set(r7611.map((r) => r.book_id));

const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const books = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 0 }, language: /^\s*(latin|german|french)\b/i, ...NOT_HELD, ...NOT_UNSPLIT_SPREAD },
  { projection: { _id: 0, id: 1, title: 1, publisher: 1, language: 1, pages_count: 1, 'image_source.provider': 1 } }).toArray();
const frame = { Latin: [], German: [], French: [] };
for (const b of books) {
  if (!b.id || EXCLUDE.has(b.id)) continue;
  const lane = translateLaneForBook(table, b);
  const lang = lane.channel === 'cli' ? ROWS[lane.row?.id] : null;
  if (lang) frame[lang].push(b);
}
const out = { seed: SEED, drawn_at: new Date().toISOString(), per_lang: PER, excluded_7611_books: EXCLUDE.size, frame_books: {}, pages: [] };
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, translation_withheld: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.model': 1, 'translation.data': 1 };
for (const [lang, bs] of Object.entries(frame)) {
  out.frame_books[lang] = bs.length;
  bs.sort((a, b) => h(`book:${a.id}`).localeCompare(h(`book:${b.id}`)));
  let got = 0;
  for (const b of bs) {
    if (got >= PER + RESERVE) break;
    const lo = Math.ceil(0.15 * b.pages_count), hi = Math.floor(0.95 * b.pages_count);
    const ps = await db.collection('pages').find({ book_id: b.id, ...VISIBLE_PAGE_MATCH, page_number: { $gte: Math.max(1, lo), $lte: hi }, page_type: { $nin: SKIP },
      translation_withheld: { $ne: true }, 'translation.health_blocked': { $exists: false }, 'ocr.data': { $type: 'string' } }, { projection: PROJ }).toArray();
    const ok = ps.filter((p) => p.ocr.data.length >= 300 && isUsableImageUrl(getPageSource(p)));
    if (!ok.length) continue;
    ok.sort((x, y) => h(`page:${x.id}`).localeCompare(h(`page:${y.id}`)));
    const p = ok[0];
    out.pages.push({ lang, rank: got, page_id: p.id, book_id: b.id, page_number: p.page_number, pages_count: b.pages_count, title: b.title, language: b.language,
      provider: b.image_source?.provider ?? null, ocr_model: p.ocr.model ?? null, ocr_chars: p.ocr.data.length, translation_model: p.translation?.model ?? null, has_english: !!p.translation?.data });
    got++;
  }
  console.log(lang, 'frame books', bs.length, 'drawn', got);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
await c.close();
