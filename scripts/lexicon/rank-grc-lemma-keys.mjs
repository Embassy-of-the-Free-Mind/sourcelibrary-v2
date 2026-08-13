/**
 * Rank lexicon_lemma_map_grc candidate keys by lemma popularity (#3823).
 *
 * Problem (live-API spot-check): multi-candidate rows list morphologically
 * valid but lexically absurd cohabitants first — ἐστίν surfaced εἴλω before
 * εἰμί. Popularity = sum of corpus counts of forms attributable to exactly
 * one key (unambiguous attribution, same discipline as the blog figure).
 * Rows with >1 key get their keys re-sorted by that popularity, descending.
 *
 * Run: set env; node scripts/lexicon/rank-grc-lemma-keys.mjs
 * Needs scripts/lexicon/output/greek-forms.tsv (corpus enumeration).
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';

const G2A = { 'ὰ': 'ά', 'ὲ': 'έ', 'ὴ': 'ή', 'ὶ': 'ί', 'ὸ': 'ό', 'ὺ': 'ύ', 'ὼ': 'ώ', 'ἃ': 'ἅ', 'ἓ': 'ἕ', 'ἳ': 'ἵ', 'ὃ': 'ὅ', 'ὓ': 'ὕ', 'ὣ': 'ὥ', 'ἂ': 'ἄ', 'ἒ': 'ἔ', 'ἲ': 'ἴ', 'ὂ': 'ὄ', 'ὒ': 'ὔ', 'ὢ': 'ὤ', 'ᾲ': 'ᾴ', 'ῂ': 'ῄ', 'ῲ': 'ῴ' };
const norm = (r) => [...r.normalize('NFD').replace(/[̄̆]/g, '').normalize('NFC').toLowerCase()].map((c) => G2A[c] ?? c).join('').replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}]/gu, '');

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const col = db.collection('lexicon_lemma_map_grc');

const counts = new Map();
const rl = readline.createInterface({ input: fs.createReadStream('scripts/lexicon/output/greek-forms.tsv') });
for await (const line of rl) {
  const [raw, c] = line.split('\t');
  const f = norm(raw ?? '');
  if (f) counts.set(f, (counts.get(f) ?? 0) + Number(c));
}
console.log(`counts loaded: ${counts.size}`);

const pop = new Map();
const multi = [];
for await (const d of col.find({})) {
  const keys = [...new Set(d.keys)];
  if (keys.length === 1) {
    const c = counts.get(d.form) ?? 0;
    if (c) pop.set(keys[0], (pop.get(keys[0]) ?? 0) + c);
  } else {
    multi.push({ _id: d._id, keys: d.keys });
  }
}
console.log(`popularity for ${pop.size} keys; ${multi.length} multi-key rows to re-rank`);

let updated = 0;
for (let i = 0; i < multi.length; i += 2000) {
  const ops = multi.slice(i, i + 2000).map((d) => ({
    updateOne: {
      filter: { _id: d._id },
      update: { $set: { keys: [...d.keys].sort((a, b) => (pop.get(b) ?? 0) - (pop.get(a) ?? 0)) } },
    },
  }));
  const r = await col.bulkWrite(ops, { ordered: false });
  updated += r.modifiedCount;
  if (i % 40000 < 2000) console.log(`  ${i}/${multi.length}`);
}
console.log(`RANKED: ${updated} rows re-sorted`);
await client.close();
