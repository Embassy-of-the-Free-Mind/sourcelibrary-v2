#!/usr/bin/env node
/**
 * Read-only measurement of the first-translation corpus (issue #2564).
 *
 * Grounds the rebuild numbers against LIVE data before any write logic:
 *  1. Public-first count (visible + pages_translated>0 + is_first_translation).
 *  2. The clean immediate demotions: disposition=translation_found but flagged.
 *  3. needs_review but flagged.
 *  4. Verification-source breakdown (the "weak path" finding).
 *  5. Language-family split (Western vs catalog-blind).
 *  6. Strata sizes for the sampler (disposition x family x work_id presence).
 *
 * NO WRITES. Run: set -a; source .env.production.local; set +a; node scripts/eval/ft-measure.mjs
 */
import { MongoClient } from 'mongodb';

const NON_WESTERN_LANGS = {
  Tibetan: 'tibetan', Chinese: 'cjk', Japanese: 'cjk', Korean: 'cjk',
  Sanskrit: 'indic', Tamil: 'indic', Pali: 'indic',
  Hebrew: 'semitic', Arabic: 'semitic', Syriac: 'semitic', Aramaic: 'semitic',
  Armenian: 'other', "Ge'ez": 'other', Geez: 'other', Coptic: 'other',
  'Egyptian hieroglyphs': 'other', Egyptian: 'other',
};
function family(lang) {
  if (!lang) return 'unknown';
  if (NON_WESTERN_LANGS[lang]) return NON_WESTERN_LANGS[lang];
  return 'western';
}

const PUBLIC = { is_first_translation: true, visible: true, pages_translated: { $gt: 0 } };

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set — source .env.production.local'); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const out = {};

out.raw_flag = await books.countDocuments({ is_first_translation: true });
out.public_firsts = await books.countDocuments(PUBLIC);
out.disposition_confirmed_first = await books.countDocuments({ 'translation_verification.disposition': 'confirmed_first' });

// 2 + 3: contradictions among public firsts
out.public_translation_found = await books.countDocuments({ ...PUBLIC, 'translation_verification.disposition': 'translation_found' });
out.public_needs_review = await books.countDocuments({ ...PUBLIC, 'translation_verification.disposition': 'needs_review' });

// 4: verification source breakdown among public firsts
out.public_by_source = await books.aggregate([
  { $match: PUBLIC },
  { $group: { _id: '$translation_verification.source', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray();

// 4b: disposition breakdown among public firsts
out.public_by_disposition = await books.aggregate([
  { $match: PUBLIC },
  { $group: { _id: '$translation_verification.disposition', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray();

// 5: language family split among public firsts
const byLang = await books.aggregate([
  { $match: PUBLIC },
  { $group: { _id: '$language', n: { $sum: 1 } } },
]).toArray();
const famCounts = {};
for (const { _id, n } of byLang) {
  const f = family(_id);
  famCounts[f] = (famCounts[f] || 0) + n;
}
out.public_by_family = famCounts;
out.public_top_nonwestern_langs = byLang
  .filter((x) => family(x._id) !== 'western' && family(x._id) !== 'unknown')
  .sort((a, b) => b.n - a.n).slice(0, 12);

// 6: work_id coverage among public firsts (the join-key dependency, #2318)
out.public_with_work_id = await books.countDocuments({ ...PUBLIC, work_id: { $exists: true, $ne: null } });

// strata: family x disposition (sampler cells)
const strata = await books.aggregate([
  { $match: PUBLIC },
  { $group: {
    _id: { lang: '$language', disp: '$translation_verification.disposition' },
    n: { $sum: 1 },
  } },
]).toArray();
const cells = {};
for (const { _id, n } of strata) {
  const key = `${family(_id.lang)} | ${_id.disp || 'null'}`;
  cells[key] = (cells[key] || 0) + n;
}
out.strata_family_x_disposition = Object.fromEntries(
  Object.entries(cells).sort((a, b) => b[1] - a[1]),
);

console.log(JSON.stringify(out, null, 2));
await client.close();
