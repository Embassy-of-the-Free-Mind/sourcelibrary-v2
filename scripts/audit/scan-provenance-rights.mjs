#!/usr/bin/env node
/**
 * scan-provenance-rights.mjs — rights SCREEN on where public scans came from, plus a
 * regex for burned-in notices in OCR. READ-ONLY; hides nothing. (#6056, #4809)
 *
 * PRIOR ART: scripts/audit/rights-notice-screen.mjs reads OCR of the first/last pages for
 *   modern copyright notices (head 15 + tail 10); scripts/audit/rights-spot-check.mjs compares
 *   our stored licence with the holding library's manifest, one book per provider. Neither
 *   looks at PROVENANCE CLUSTERS: the 2026-10-23 spot check found a "Copyright (c) 2010
 *   ProQuest LLC" stamp burned into every IMAGE of 6a06f2fbf27801273413e9c6 (Lettere volgari,
 *   1549) that is NOT in the OCR, so a text screen cannot see it. The stamp travels with the
 *   scan source (Internet Archive "early-european-books" = ProQuest/EEB scans), so the
 *   question is how many public books share that source. This answers that, and adds a
 *   cross-corpus OCR regex (spread sample, not head/tail) for stamps that DO reach the text.
 *
 * Whether scan-provenance licence matters for public-domain works is Derek's call
 * (rule: US-PD works stay published unless there is a complaint). This only counts.
 *
 * Output (stdout, counts + <=5 examples per pattern; --out FILE gets full JSON):
 *   a) the reference book's provenance fields
 *   b) public books (visible:true, pages_count>0) by provenance cluster: IA collection
 *      "early-european-books", "europeanlibraries", the ia_identifier shape of the reference
 *      (<3-letter>-<lib>-...), and a breakdown by contributing_library
 *   c) OCR regex /Copyright\s*(c)|(c)\s*(19|20)\d\d|All rights reserved|ProQuest|Gale Cengage|EEBO/i
 *      over <= 8 pages per book (1,2,3, 25/50/75%, last-1, last), matched SERVER-side
 *
 * Usage (full walk on Hetzner): node --env-file=.env.production.local \
 *     scripts/audit/scan-provenance-rights.mjs [--ref BOOK_ID] [--limit N] [--out FILE.json]
 * Positive control: --ref 6a06f2fbf27801273413e9c6 must report collection early-european-books.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const REF = opt('ref', '6a06f2fbf27801273413e9c6');
const LIMIT = Number(opt('limit', 0));
const OUT = opt('out', null);
const STAMP = /Copyright\s*©|©\s*(19|20)\d\d|All rights reserved|ProQuest|Gale Cengage|EEBO/i;
const KINDS = { copyright_sign: /Copyright\s*©/i, circle_c_year: /©\s*(19|20)\d\d/, all_rights: /All rights reserved/i, proquest: /ProQuest/i, gale: /Gale Cengage/i, eebo: /EEBO/i };

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const PUBLIC = { visible: true, pages_count: { $gt: 0 } };

// (a) reference provenance
const ref = await books.findOne({ id: REF }, { projection: { title: 1, ia_identifier: 1, image_source: 1, 'catalog_metadata.collections': 1, 'catalog_metadata.source': 1 } });
const prefix = ref?.ia_identifier?.match(/^[a-z]{3}-[a-z0-9]+-/i)?.[0] ?? null;
const out = { reference: { id: REF, title: ref?.title, ia_identifier: ref?.ia_identifier, provider: ref?.image_source?.provider, source_url: ref?.image_source?.source_url, license: ref?.image_source?.license, contributing_library: ref?.image_source?.contributing_library, ia_collections: ref?.catalog_metadata?.collections, id_prefix: prefix } };

// (b) provenance clusters
const count = (q) => books.countDocuments({ ...PUBLIC, ...q });
out.public_total = await count({});
out.clusters = {
  ia_collection_early_european_books: await count({ 'catalog_metadata.collections': 'early-european-books' }),
  ia_collection_europeanlibraries: await count({ 'catalog_metadata.collections': 'europeanlibraries' }),
  ia_identifier_same_prefix_as_reference: prefix ? await count({ ia_identifier: { $regex: '^' + prefix.replace(/[^a-z0-9-]/gi, '') } }) : null,
  ia_provider_total: await count({ 'image_source.provider': 'internet_archive' }),
};
out.early_european_books_by_library = await books.aggregate([
  { $match: { ...PUBLIC, 'catalog_metadata.collections': 'early-european-books' } },
  { $group: { _id: '$image_source.contributing_library', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }]).toArray();
out.early_european_books_by_license = await books.aggregate([
  { $match: { ...PUBLIC, 'catalog_metadata.collections': 'early-european-books' } },
  { $group: { _id: '$image_source.license', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();

// (c) OCR regex, spread sample
let cur = books.find(PUBLIC, { projection: { id: 1, title: 1, pages_count: 1 } });
if (LIMIT) cur = cur.limit(LIMIT);
const all = await cur.toArray();
const pagesOf = (n) => [...new Set([1, 2, 3, Math.ceil(n * 0.25), Math.ceil(n * 0.5), Math.ceil(n * 0.75), n - 1, n].filter((p) => p >= 1 && p <= n))];
const hitBooks = new Map();
for (let i = 0; i < all.length; i += 150) {
  const batch = all.slice(i, i + 150);
  const rows = await db.collection('pages').aggregate([
    { $match: { $or: batch.map((b) => ({ book_id: b.id, page_number: { $in: pagesOf(b.pages_count) } })) } },
    { $match: { 'ocr.data': { $regex: STAMP.source, $options: 'i' } } },
    { $project: { book_id: 1, page_number: 1, hit: { $regexFind: { input: '$ocr.data', regex: new RegExp('.{0,40}(' + STAMP.source + ').{0,40}', 'is') } } } },
  ], { allowDiskUse: true }).toArray();
  for (const r of rows) {
    const snippet = (r.hit?.match ?? '').replace(/\s+/g, ' ');
    if (!hitBooks.has(r.book_id)) hitBooks.set(r.book_id, []);
    hitBooks.get(r.book_id).push({ page: r.page_number, snippet });
  }
}
const titles = new Map(all.map((b) => [b.id, b.title]));
const byKind = {};
for (const [id, hits] of hitBooks) for (const k of Object.keys(KINDS)) if (hits.some((h) => KINDS[k].test(h.snippet))) (byKind[k] ??= []).push({ id, title: titles.get(id), ...hits.find((h) => KINDS[k].test(h.snippet)) });
out.ocr_regex = { books_sampled: all.length, books_with_any_hit: hitBooks.size, by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { books: v.length, examples: v.slice(0, 5) }])), reference_book_hits_in_ocr: (hitBooks.get(REF) ?? []).length };
if (OUT) writeFileSync(OUT, JSON.stringify({ ...out, all_hits: Object.fromEntries(hitBooks) }, null, 1));
console.log(JSON.stringify(out, null, 1));
await client.close();
