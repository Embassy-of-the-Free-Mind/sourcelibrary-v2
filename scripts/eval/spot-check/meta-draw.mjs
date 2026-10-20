#!/usr/bin/env node
/**
 * Metadata spot check (#6056, metadata frame): draw live books stratified by PROVIDER group and by the
 * century of `source_work_dates_meta.edition.year`, and write one packet per book with every catalogue
 * field a reader sees, its provenance, the work/author joins, and the image URLs of the front matter and
 * the last leaves (title page, colophon). Read-only on Mongo, no model calls.
 *
 * PRIOR ART: scripts/eval/spot-check/draw.mjs — the page-text draw (uniform per book, one run of 3
 * translated pages). It samples text runs, not front matter, and does not stratify; this one reuses its
 * seeded order (`bookOrder` from ./lib.mjs) within each stratum and its `pageImageUrl`.
 *
 *   node --env-file=.env.production.local scripts/eval/spot-check/meta-draw.mjs \
 *     --seed 2026101901 --n 40 --out scripts/eval/results/spot-check/meta-2026-10-19-r1
 *
 * Strata: 5 provider groups × 5 century bins. Each provider group gets n/5 books; within a group the
 * books go round-robin over the century bins that are non-empty, so a thin bin still gets a book. The
 * frame size of every cell is written to draw-log.json so the rates can be re-weighted.
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bookOrder, pageImageUrl } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEED = Number(opt('seed', 2026101901));
const N = Number(opt('n', 40));
const OUT = opt('out', 'scripts/eval/results/spot-check/meta-2026-10-19-r1');
const FRONT = 10; // first N reader-reachable pages go in the packet
if (existsSync(join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);

export const GROUPS = {
  internet_archive: ['internet_archive', 'google_books'],
  bavarian: ['mdz', 'bsb'],
  ritman: ['bph', 'allard_pierson'],
  european_iiif: ['bl', 'e-rara', 'harvard', 'sbb', 'gallica', 'goettingen', 'slub_dresden', 'manchester', 'bodleian',
    'leiden', 'laurenziana', 'vatican', 'cambridge', 'loc', 'e-codices', 'wellcome', 'hab', 'morgan', 'princeton',
    'penn_colenda', 'penn', 'tu_delft', 'tartu_dspace', 'chester_beatty', 'iiif'],
  // everything else: BDRC, NDL, ETCSL, Met, SAT, B-NICE, Wikimedia, ORAEC …
};
const groupOf = (p) => Object.entries(GROUPS).find(([, v]) => v.includes(p))?.[0] || 'other';
const BINS = ['<1500', '1500s', '1600s', '1700s', '>=1800'];
const binOf = (y) => (typeof y !== 'number' ? '>=1800' : y < 1500 ? '<1500' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : '>=1800');

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const LIVE = { visible: true, pages_count: { $gt: 0 } };

const all = await books.find(LIVE, { projection: { _id: 0, id: 1, 'image_source.provider': 1, 'source_work_dates_meta.edition.year': 1 } }).toArray();
const cells = {};
for (const b of all) {
  if (!b.id) continue;
  const g = groupOf(b.image_source?.provider), c = binOf(b.source_work_dates_meta?.edition?.year);
  ((cells[g] ||= {})[c] ||= []).push(b.id);
}
const groups = [...Object.keys(GROUPS), 'other'];
const perGroup = Math.floor(N / groups.length);
const picks = [];
for (const g of groups) {
  // One seeded stream per cell, derived from the seed and the cell name, so cells are independent.
  const orders = Object.fromEntries(BINS.filter((c) => cells[g]?.[c]?.length).map((c, i) => [c, bookOrder(cells[g][c], makeRng(SEED + 7919 * (groups.indexOf(g) + 1) + 104729 * (BINS.indexOf(c) + 1)))]));
  const bins = Object.keys(orders);
  let k = 0, guard = 0;
  while (picks.filter((p) => p.group === g).length < perGroup && guard++ < 10000) {
    const c = bins[k++ % bins.length];
    const id = orders[c].next().value;
    if (!id) continue;
    picks.push({ id, group: g, bin: c });
  }
}

const FIELDS = { _id: 0, id: 1, title: 1, display_title: 1, english_title: 1, author: 1, author_id: 1, translator: 1, editor: 1, published: 1, year: 1,
  place_published: 1, publisher: 1, language: 1, original_language: 1, languages: 1, language_multi: 1, text_role: 1, work_id: 1, work_title: 1,
  edition_key: 1, categories: 1, subjects: 1, faceted_tags: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, contributing_library: 1,
  source_work_dates: 1, source_work_dates_meta: 1, 'image_source.provider': 1, 'image_source.source_url': 1, 'image_source.provider_name': 1,
  ia_identifier: 1, catalog_metadata: 1, field_provenance: 1, cover_page_number: 1, content_type: 1, book_class: 1, 'ai_metadata.author': 1,
  'ai_metadata.language': 1, 'ai_metadata.title': 1, 'ai_metadata.date': 1, 'ai_metadata.year': 1 };

const out = [];
for (const p of picks) {
  const b = await books.findOne({ id: p.id }, { projection: FIELDS });
  const nums = (await db.collection('pages').find({ book_id: p.id, page_number: { $gt: 0 } }, { projection: { _id: 0, page_number: 1 } }).toArray()).map((x) => x.page_number).sort((a, b) => a - b);
  const realPages = nums.length;
  const want = [...nums.slice(0, FRONT), ...nums.slice(-2)];
  const pgs = await db.collection('pages').find({ book_id: p.id, page_number: { $in: want } }, { projection: { _id: 0, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const pick = (arr) => arr.map((pg) => ({ page: pg.page_number, image: pageImageUrl(pg), url: `https://sourcelibrary.org/book/${p.id}?page=${pg.page_number}`, ocr_head: String(pg.ocr?.data || '').slice(0, 600) }));
  const work = b.work_id ? await books.find({ work_id: b.work_id, id: { $ne: p.id } }, { projection: { _id: 0, id: 1, title: 1, author: 1, published: 1, language: 1, visible: 1 } }).limit(25).toArray() : [];
  const sameAuthor = b.author_id ? await books.find({ author_id: b.author_id, id: { $ne: p.id }, work_id: { $ne: b.work_id } }, { projection: { _id: 0, id: 1, title: 1, published: 1, work_id: 1, visible: 1 } }).limit(40).toArray() : [];
  const author = b.author_id ? await db.collection('authors').findOne({ _id: b.author_id }, { projection: { canonical_name: 1, wikidata_id: 1, viaf_id: 1, is_person: 1, merged_into: 1 } }) : null;
  const prov = await db.collection('field_provenance').find({ book_id: p.id }).toArray();
  const sweeps = await db.collection('sweep_log').find({ book_id: p.id }, { projection: { _id: 0, sweep: 1, action: 1, timestamp: 1, at: 1 } }).limit(50).toArray();
  out.push({ ...p, book: b, pages_real: realPages, front: pick(pgs.filter((x) => nums.slice(0, FRONT).includes(x.page_number))), back: pick(pgs.filter((x) => nums.slice(-2).includes(x.page_number))),
    work_siblings: work, same_author_other_works: sameAuthor, author_doc: author, field_provenance_rows: prov, sweep_log_rows: sweeps,
    links: { book: `https://sourcelibrary.org/book/${p.id}`, author: b.author_id ? `https://sourcelibrary.org/author/${b.author_id}` : null } });
}

mkdirSync(join(OUT, 'packets'), { recursive: true });
writeFileSync(join(OUT, 'sample.json'), JSON.stringify(out, null, 1));
const cellSizes = Object.fromEntries(groups.map((g) => [g, Object.fromEntries(BINS.map((c) => [c, cells[g]?.[c]?.length || 0]))]));
writeFileSync(join(OUT, 'draw-log.json'), JSON.stringify({ seed: SEED, n: out.length, frame: 'live (visible && pages_count > 0)', frame_size: all.length,
  drawn_at: new Date().toISOString(), groups: GROUPS, bins: BINS, cell_sizes: cellSizes, picks: picks.map(({ id, group, bin }) => ({ id, group, bin })) }, null, 1));
// 8 packets of 5 books, one per reviewer, dealt round-robin so each packet mixes providers.
const NP = Math.ceil(out.length / 5);
for (let i = 0; i < NP; i++) writeFileSync(join(OUT, 'packets', `packet-${i + 1}.json`), JSON.stringify(out.filter((_, j) => j % NP === i), null, 1));
console.log(`drew ${out.length} from ${all.length} live · seed ${SEED}`);
for (const g of groups) console.log(g.padEnd(18), JSON.stringify(cellSizes[g]), picks.filter((p) => p.group === g).map((p) => p.bin).join(','));
await client.close();
