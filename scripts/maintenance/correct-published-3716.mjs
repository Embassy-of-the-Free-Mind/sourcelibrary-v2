#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/fill-published-from-title-page-6056.mjs — the write path copied here
// (setCatalogueFields + field_provenance row + sweep_log + books_catalog mirror + revalidate), but it writes only
// where `published` is a placeholder ("Unknown"); these 49 hold a wrong real year, which its judge() refuses.
// scripts/maintenance/align-year-to-title-page-3716.mjs (#3716) writes `year`, never `published`, and produced
// the review list this reads. scripts/maintenance/correct-imprint-from-titlepage.mjs is the one-book CLI.
/**
 * v2#3716 — correct `published` on the books whose own title page contradicts it (decision 2026-11-13, default
 * taken, v3#90). Input: the review list job session-prep-3716 wrote,
 *   scripts/eval/results/year-from-title-page-3716/published-review-2026-11-12.tsv   (49 rows)
 * In each row `year` already equals the title page, and `published` is the field that is wrong: a series start
 * (SBE 1879, Oxford Aristotle 1908), a work date, or a catalogue slip.
 *
 * Writes, per row not excluded with --exclude, and only while `published` still holds the value the list saw:
 *   books.published + field_provenance stamp/history (setCatalogueFields), one `field_provenance` row,
 *   one sweep_log row (sweep correct-published-3716, before the write), books_catalog.published.
 * `year` is never touched. A messy proposal ("Oxford, 1885", "4 July 1500") is written as the plain year (CLEAN).
 *
 * The dry run locates the evidence leaf (the first of pages 1-12 whose OCR holds the quote) and prints the image,
 * for the by-eye check that must come before --apply.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/correct-published-3716.mjs --plan=<out.json>
 *   … --apply --backup=<new path.json> [--exclude=id,id]
 *   … --revert=<backup.json> [--apply]       puts back only rows nobody has edited since
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { setCatalogueFields } from '../lib/catalogue-fields.mjs';
import { loose } from '../lib/date-works.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { revalidateBookPages } from '../lib/revalidate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIST = join(HERE, '..', 'eval', 'results', 'year-from-title-page-3716', 'published-review-2026-11-12.tsv');
const RUN = 'correct-published-3716';
const SCRIPT = 'scripts/maintenance/correct-published-3716.mjs';
const METHOD = 'title-page imprint (dating run #6721), review list v2#3716, checked by eye';
// Proposals that are not a plain year or range: the value to write instead, after the by-eye check.
const CLEAN = {
  '699246adbc722ec0ee810bd9': '1885', // "Oxford, 1885"
  '699246acbc722ec0ee8109a9': '1885', // "Oxford, 1885"
  '69c1b7c78522835be84496d2': '1500', // "4 July 1500" (colophon dated 8 Dhu'l-Hijja 905)
  '699df0823430a1d77dc79205': '1544', // "1544 (printed late 1543 or 1544)" — the calendar for Jiajing 23
  '69b30496b35a461e6a6d7711': '1623', // "1623–1624"; the imprint prints only 1623
  '69944b541ba835137790622e': '1902-1915', // vols 4-6
};
// The leaf the by-eye check found the date on, where the OCR match picked another (or none).
const PAGE = {
  '69c1b7c78522835be84496d2': 1098, // the colophon; p3 is a modern pencil note
  '699209a9bed8f4b5ff5b1fd0': 7, // title page; p5 is a blank flyleaf
  '69ae6681b3b0e7bf712d6201': 5,
  '69ae668db3b0e7bf712d66a9': 5,
};

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const APPLY = 'apply' in args;
const EXCLUDE = new Set(String(args.exclude || '').split(',').filter(Boolean));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function supabaseSet(id, published) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ published, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  return { ok: res.ok, rows: Array.isArray(b) ? b.length : 0 };
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

try {
  if (args.revert) {
    const { entries } = JSON.parse(readFileSync(args.revert, 'utf8'));
    let n = 0, changed = 0;
    const done = [];
    for (const e of entries) {
      const b = await books.findOne({ id: e.book_id }, { projection: { id: 1, slug: 1, published: 1 } });
      if (!b || b.published !== e.after) { changed++; continue; }
      n++;
      if (!APPLY) continue;
      await recordSweepAction(db, { sweep: RUN, book_id: e.book_id, action: 'published-reverted', detail: { from: e.after, to: e.before } });
      const r = await setCatalogueFields(db, e.book_id, { published: e.before }, { source: 'revert', script: SCRIPT, run: RUN, method: `revert of ${RUN}` });
      if (r.modified) { done.push({ id: b.id, slug: b.slug }); await supabaseSet(e.book_id, e.before); }
    }
    if (done.length) await revalidateBookPages(done);
    console.log(`${APPLY ? 'reverted' : 'would revert'} ${n} of ${entries.length}; ${changed} edited since, left alone`);
  } else {
    if (APPLY && (!args.backup || existsSync(args.backup))) { console.error('--backup=<new path> required with --apply'); process.exit(2); }
    const rows = readFileSync(LIST, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'))
      .map(([id, , before, proposed, year, basis, evidence, title]) => ({ id, before, proposed, value: CLEAN[id] ?? proposed, year: +year, basis, evidence, title }));
    const docs = new Map((await books.find({ id: { $in: rows.map((r) => r.id) } }, { projection: { id: 1, slug: 1, published: 1, year: 1, visible: 1, pages_count: 1 } }).toArray()).map((d) => [d.id, d]));
    const pages = await db.collection('pages').find({ book_id: { $in: rows.map((r) => r.id) }, page_number: { $lte: 14 } },
      { projection: { _id: 0, book_id: 1, page_number: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1, text: { $substrCP: ['$ocr.data', 0, 3000] } } }).toArray();
    const plan = [];
    for (const r of rows) {
      const d = docs.get(r.id);
      if (!d) { console.log(`SKIP ${r.id}: not found`); continue; }
      if (String(d.published) !== r.before) { console.log(`SKIP ${r.id}: published is now ${JSON.stringify(d.published)}, list saw ${r.before}`); continue; }
      if (!/^\d{3,4}(-\d{4})?$/.test(r.value)) { console.log(`SKIP ${r.id}: value ${JSON.stringify(r.value)} is not a plain year`); continue; }
      const want = r.basis === 'title_page' ? loose(r.evidence) : null;
      const leaves = pages.filter((p) => p.book_id === r.id).sort((a, b) => a.page_number - b.page_number);
      const hit = want ? leaves.find((p) => loose(stripMarkupTags(stripEditorialWrappers(p.text || '') || '', ' ')).includes(want)) : null;
      plan.push({ ...r, slug: d.slug, visible: !!d.visible, cur_year: d.year, page: PAGE[r.id] ?? hit?.page_number ?? null, image: hit && !PAGE[r.id] ? getPageSource(hit) : null, excluded: EXCLUDE.has(r.id) });
    }
    for (const p of plan) console.log(`${p.excluded ? 'EXCL' : '    '} ${p.id} ${p.before.padEnd(5)} → ${p.value.padEnd(9)} year=${p.cur_year} p${p.page ?? '?'} ${p.title.slice(0, 50)}`);
    const go = plan.filter((p) => !p.excluded);
    console.log(`\nwould write: ${go.length} (excluded ${plan.length - go.length}; list ${rows.length}); evidence page found for ${plan.filter((p) => p.page).length}`);
    if (args.plan) writeFileSync(args.plan, JSON.stringify(plan, null, 1));
    if (!APPLY) console.log('DRY RUN: nothing written.');
    else {
      const at = new Date().toISOString();
      writeFileSync(args.backup, JSON.stringify({ run: RUN, at, entries: go.map((p) => ({ book_id: p.id, before: p.before, after: p.value, page: p.page })) }, null, 1));
      let wrote = 0, sb = 0;
      const done = [], skipped = [];
      for (const p of go) {
        const evidence = { quote: p.evidence, page_number: p.page, basis: p.basis, review: 'v2#3716 published-review-2026-11-12.tsv, by eye 2026-11-13' };
        await recordSweepAction(db, { sweep: RUN, book_id: p.id, action: 'published-from-title-page', detail: { before: p.before, after: p.value, page_number: p.page, evidence: p.evidence } });
        let r;
        try {
          r = await setCatalogueFields(db, p.id, { published: p.value }, { source: 'title_page_imprint', script: SCRIPT, run: RUN, method: METHOD, evidence });
        } catch (e) { skipped.push([p.id, e.message]); continue; }
        if (!r.modified) { skipped.push([p.id, 'nothing to change']); continue; }
        wrote++; done.push({ id: p.id, slug: p.slug });
        await db.collection('field_provenance').insertOne({ book_id: p.id, field: 'published', value: p.value, previous_value: p.before, source: 'title_page_imprint', method: METHOD, run: RUN, evidence, created_at: new Date() });
        const s = await supabaseSet(p.id, p.value);
        if (s.ok && s.rows > 0) sb++;
      }
      console.log(`written ${wrote}; books_catalog mirrored ${sb}; skipped ${skipped.length}`);
      for (const [id, why] of skipped) console.log(`  skipped ${id}: ${why}`);
      if (done.length) await revalidateBookPages(done);
      const back = await books.find({ id: { $in: go.map((p) => p.id) } }, { projection: { id: 1, published: 1 } }).toArray();
      const ok = back.filter((b) => go.find((p) => p.id === b.id)?.value === b.published).length;
      console.log(`readback: ${ok}/${go.length} hold the new value; backup ${args.backup}`);
    }
  }
} finally { await mc.close(); }
