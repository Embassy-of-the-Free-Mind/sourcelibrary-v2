#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/repair-bare-name-variants-4318.mjs (literal moves off a wrong doc, plus variant pulls;
 * the shape copied here, but its list is closed and it never looks at dead ids), backfill-author-canonical-links.mjs
 * (fills a MISSING author_id, so it skips a book whose id points at nothing), scripts/audit/thesaurus-variant-shape.mjs
 * (reports variant shapes, not links).
 *
 * repair-author-links-8035 — two kinds of wrong `books.author_id`, found reading Chinese bylines (#8035).
 *
 * 1. DEAD. `authorUrl()` prefers author_id, so a book whose id names no doc links its byline to a 404: 177 volumes of
 *    朱熹 went to /author/zhu-xi-2. An id that still resolves through another doc's slug or variant_slugs is not dead,
 *    because the author page redirects it; it is left alone. A book moves only when exactly one live doc lists its exact
 *    author string as a variant. Anything else is reported, not guessed.
 * 2. WRONG PERSON. A hand-read list. Each one reads as a real link to a real name, so no detector would catch it.
 *    Pinyin collisions, per author-identity.md: 蕭吉 on Emperor Yuan of Liang, 張華 on Zhang Li, 錢時 on Wu Qian. Books
 *    are unlinked, not re-attached, unless the right doc is certain: the byline stays, and the wrong page stops
 *    claiming them. The variant comes off the doc too, or the author page's union query would keep claiming them.
 *
 * Every write logs to sweep_log first, with the old values (sweep repair-author-links-8035).
 *
 *   node --env-file=.env.production.local scripts/maintenance/repair-author-links-8035.mjs           dry run
 *   ... --apply
 *   ... --check     exit 1 if any book's author_id neither names a doc nor resolves through one (report only)
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'repair-author-links-8035';
const SCRIPT = 'scripts/maintenance/repair-author-links-8035.mjs';
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');

/** author string + wrong id → the right id, or null to unlink. `pull` takes the string off the wrong doc. */
const WRONG = [
  { author: 'Xiao Ji', from: 'li-xiaojiang', to: null, pull: true, why: '五行大義 is by 蕭吉 (Sui); li-xiaojiang is an emperor of Liang, 508-553' },
  { author: 'Zhang Hua (張華, 232-300 CE)', from: 'zhang-li', to: null, pull: true, why: '張華 is not Zhang Li (張理, 易象圖說)' },
  { author: '姚球 (Yao Qiu)', from: 'lu-zhiyi-2', to: null, pull: false, why: '本草經解要 is attributed to 姚球 or 葉桂, not 盧之頤' },
  { author: 'Wang Xi', from: 'wang-gai', to: null, pull: true, why: 'wang-gai is the painter 王概, 1645-1710; 太乙金鏡式經 is Tang' },
  { author: '王朴', from: 'wang-gai', to: null, pull: true, why: '王朴 (太清神鑑) is Five Dynasties, not the painter 王概' },
  { author: '錢時', from: 'wu-qian', to: null, pull: true, why: '錢時 is not Wu Qian (吳謙, 御纂醫宗金鑑)' },
];

/** The stored byline itself is a typo. Read against the title: 張子全書 is 張載's. */
const BYLINE = [{ author: '張戴', to: '張載', title: /^張子全書/, why: '張子全書 is by 張載' }];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');

/** author_ids that name no doc and that no doc answers to, so the author page would 404. */
async function deadIds() {
  const ids = (await books.distinct('author_id')).filter((x) => typeof x === 'string' && x);
  const named = new Set();
  for (let i = 0; i < ids.length; i += 2000) {
    const docs = await authors.find({ _id: { $in: ids.slice(i, i + 2000) } }, { projection: { _id: 1 } }).toArray();
    for (const d of docs) named.add(d._id);
  }
  const missing = ids.filter((x) => !named.has(x));
  const answered = new Set();
  for (const d of await authors.find({ $or: [{ variant_slugs: { $in: missing } }, { slug: { $in: missing } }] }, { projection: { variant_slugs: 1, slug: 1 } }).toArray()) {
    for (const s of [...(d.variant_slugs || []), d.slug]) answered.add(s);
  }
  return { missing, dead: missing.filter((x) => !answered.has(x)) };
}

async function live(doc) {
  let d = doc;
  for (let hop = 0; d?.merged_into && hop < 5; hop++) d = await authors.findOne({ _id: d.merged_into });
  return d;
}

/** The one live doc listing this exact string as a variant, or null if none or several. */
async function target(author) {
  const trimmed = author.trim();
  const docs = await authors.find({ variants: { $in: [author, trimmed] } }, { projection: { merged_into: 1, is_person: 1, canonical_name: 1 } }).toArray();
  const resolved = new Map();
  for (const d of docs) {
    const r = await live(d);
    if (r) resolved.set(r._id, r);
  }
  return resolved.size === 1 ? [...resolved.values()][0] : null;
}

async function moveBook(b, to, why, action) {
  const bookId = String(b.id ?? b._id);
  if (!APPLY) return 0;
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action, detail: { author: b.author, before: b.author_id, before_entity: b.author_entity_id ?? null, after: to, why }, script: SCRIPT });
  const update = to ? { $set: { author_id: to } } : { $unset: { author_id: '' } };
  const r = await books.updateOne({ _id: b._id, author_id: b.author_id }, update);
  return r.modifiedCount;
}

const { missing, dead } = await deadIds();
if (CHECK) {
  const n = dead.length ? await books.countDocuments({ author_id: { $in: dead } }) : 0;
  console.log({ ids_with_no_doc: missing.length, dead_ids: dead.length, books_on_dead_ids: n, sample: dead.slice(0, 10) });
  await client.close();
  process.exit(dead.length ? 1 : 0);
}

// 0. Typos first, so the dead-link step matches the corrected string.
let bylines = 0;
for (const f of BYLINE) {
  for (const b of await books.find({ author: f.author, title: f.title }, { projection: { id: 1, author: 1, title: 1 } }).toArray()) {
    console.log(`byline ${f.author} -> ${f.to}: ${String(b.title).slice(0, 24)}`);
    if (!APPLY) continue;
    await recordSweepAction(db, { sweep: SWEEP, book_id: String(b.id ?? b._id), action: 'correct-byline', detail: { before: f.author, after: f.to, why: f.why }, script: SCRIPT });
    bylines += (await books.updateOne({ _id: b._id, author: f.author }, { $set: { author: f.to } })).modifiedCount;
  }
}

// 1. Dead links.
console.log(`\nids with no doc ${missing.length}, of which dead (404) ${dead.length}`);
let moved = 0, unresolved = 0;
const rows = await books.aggregate([
  { $match: { author_id: { $in: dead } } },
  { $group: { _id: { id: '$author_id', author: '$author' }, n: { $sum: 1 }, ids: { $push: '$_id' } } },
  { $sort: { n: -1 } },
]).toArray();
for (const r of rows) {
  const author = r._id.author ?? '';
  // In a dry run the typo above has not been written yet.
  const corrected = BYLINE.find((f) => f.author === author)?.to ?? author;
  const t = author ? await target(corrected) : null;
  console.log(`${String(r.n).padStart(4)}  ${r._id.id}  [${author}] -> ${t ? `${t._id} (${t.canonical_name})` : 'NO SINGLE DOC, left'}`);
  if (!t) { unresolved += r.n; continue; }
  for (const _id of r.ids) {
    const b = await books.findOne({ _id }, { projection: { id: 1, author: 1, author_id: 1, author_entity_id: 1 } });
    moved += await moveBook(b, t._id, `dead id; exactly one doc lists "${corrected}"`, 'repoint-dead-author-id');
  }
}

// 2. Wrong person.
console.log('\nwrong person');
let unlinked = 0, pulled = 0;
for (const w of WRONG) {
  const from = await authors.findOne({ _id: w.from }, { projection: { entity_ids: 1 } });
  const to = w.to ? await authors.findOne({ _id: w.to }, { projection: { canonical_name: 1, variants: 1 } }) : null;
  if (w.to && !to) { console.log(`SKIP ${w.author}: target ${w.to} does not exist`); continue; }
  const rows2 = await books.find({ author: w.author, author_id: w.from }, { projection: { id: 1, title: 1, author: 1, author_id: 1, author_entity_id: 1 } }).toArray();
  console.log(`${rows2.length} [${w.author}] ${w.from} -> ${w.to ?? 'unlinked'}: ${[...new Set(rows2.map((b) => String(b.title).slice(0, 14)))].join(' | ')}`);
  for (const b of rows2) {
    unlinked += await moveBook(b, w.to, w.why, 'correct-wrong-author-id');
    // The page's union also matches author_entity_id, so an entity shared with the wrong doc must go too.
    if (APPLY && b.author_entity_id && (from?.entity_ids || []).map(String).includes(String(b.author_entity_id))) {
      await books.updateOne({ _id: b._id }, { $unset: { author_entity_id: '' } });
    }
  }
  if (w.pull) {
    if (APPLY) {
      await recordSweepAction(db, { sweep: SWEEP, book_id: `author:${w.from}`, action: 'pull-variant', detail: { variant: w.author, why: w.why }, script: SCRIPT });
      pulled += (await authors.updateOne({ _id: w.from }, { $pull: { variants: w.author } })).modifiedCount;
    }
    if (w.to && APPLY) await authors.updateOne({ _id: w.to }, { $addToSet: { variants: w.author } });
  }
}

console.log({ apply: APPLY, bylines, moved, unresolved, unlinked, pulled });
await client.close();
