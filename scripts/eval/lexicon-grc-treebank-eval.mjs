// Validate lexicon_lemma_map_grc against the UD Ancient Greek (Perseus)
// treebank: for each human-verified (form, lemma) token, if the form is in
// our map, does our key set contain the gold lemma's LSJ entry?
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const GRAVE_TO_ACUTE = { 'ὰ': 'ά', 'ὲ': 'έ', 'ὴ': 'ή', 'ὶ': 'ί', 'ὸ': 'ό', 'ὺ': 'ύ', 'ὼ': 'ώ', 'ἃ': 'ἅ', 'ἓ': 'ἕ', 'ἳ': 'ἵ', 'ὃ': 'ὅ', 'ὓ': 'ὕ', 'ὣ': 'ὥ', 'ἂ': 'ἄ', 'ἒ': 'ἔ', 'ἲ': 'ἴ', 'ὂ': 'ὄ', 'ὒ': 'ὔ', 'ὢ': 'ὤ', 'ᾲ': 'ᾴ', 'ῂ': 'ῄ', 'ῲ': 'ῴ' };
function norm(raw) {
  let s = raw.normalize('NFD').replace(/[̄̆]/g, '').normalize('NFC').toLowerCase();
  s = [...s].map((ch) => GRAVE_TO_ACUTE[ch] ?? ch).join('');
  return s.replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}]/gu, '');
}

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const tokens = [];
for (const line of lines) {
  if (!line || line.startsWith('#')) continue;
  const cols = line.split('\t');
  if (cols.length < 3 || cols[0].includes('-') || cols[0].includes('.')) continue;
  const form = norm(cols[1]);
  const lemma = norm(cols[2].replace(/[0-9]+$/, ''));
  if (form.length >= 2 && lemma) tokens.push([form, lemma]);
}
console.log(`gold tokens: ${tokens.length}`);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// distinct forms → batch fetch map + entries
const distinct = [...new Set(tokens.map((t) => t[0]))];
console.log(`distinct gold forms: ${distinct.length}`);
const mapDocs = new Map();
for (let i = 0; i < distinct.length; i += 5000) {
  const batch = await db.collection('lexicon_lemma_map_grc').find({ form: { $in: distinct.slice(i, i + 5000) } }).toArray();
  for (const d of batch) mapDocs.set(d.form, d.keys);
}
// entry headword lookup: key → normalized headword
const allKeys = [...new Set([...mapDocs.values()].flat())];
const keyToHead = new Map();
for (let i = 0; i < allKeys.length; i += 5000) {
  const batch = await db.collection('lexicon_entries_grc').find({ key: { $in: allKeys.slice(i, i + 5000) } }, { projection: { key: 1, key_normalized: 1 } }).toArray();
  for (const d of batch) keyToHead.set(d.key, d.key_normalized);
}

let covered = 0, agree = 0, disagree = 0;
const disagreements = [];
let exactSkip = 0;
for (const [form, lemma] of tokens) {
  const keys = mapDocs.get(form);
  if (!keys) {
    // form not in map — could still hit via exact-headword tier
    exactSkip++;
    continue;
  }
  covered++;
  const heads = new Set(keys.map((k) => keyToHead.get(k)).filter(Boolean));
  if (heads.has(lemma)) agree++;
  else {
    disagree++;
    if (disagreements.length < 15) disagreements.push(`${form}: gold=${lemma} ours=[${[...heads].slice(0, 3)}]`);
  }
}
console.log(`token coverage by lemma map: ${covered}/${tokens.length} (${(covered / tokens.length * 100).toFixed(1)}%)`);
console.log(`lemma agreement on covered tokens: ${agree}/${covered} (${(agree / covered * 100).toFixed(1)}%)`);
console.log(`sample disagreements:`);
for (const d of disagreements) console.log('  ' + d);
await client.close();
