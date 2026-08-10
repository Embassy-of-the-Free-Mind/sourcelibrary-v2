/**
 * Import LSJ (lsj9 JSON, CC BY 4.0) + the Morpheus form→lemma table into
 * Mongo for Greek dictionary lookup (#3823 Phase 3).
 *
 * Writes:
 *   lexicon_entries_grc  — one doc per LSJ headword (~119K): headword,
 *                          normalized key, short def, grammar/etymology
 *   lexicon_lemma_map_grc — corpus form → LSJ entry keys, joined from the
 *                          regenerated Morpheus table (greek-form-lemmas
 *                          .jsonl) with the SAME normalizer on both sides
 *
 * Normalization (normKey): NFD → strip length marks (macron U+0304, breve
 * U+0306) → NFC → lowercase → grave→acute is already applied corpus-side;
 * apply here too so both sides agree. Homograph headwords share a
 * normalized key; the lookup returns all and ranks by having a short def.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/lexicon/import-lsj.mjs --dir _tmp-lsj9
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const DIR = dirFlag >= 0 ? args[dirFlag + 1] : '_tmp-lsj9';
const LEMMA_JSONL = 'scripts/lexicon/output/greek-form-lemmas.jsonl';
const MAX_KEYS_PER_FORM = 8;

const GRAVE_TO_ACUTE = { 'ὰ': 'ά', 'ὲ': 'έ', 'ὴ': 'ή', 'ὶ': 'ί', 'ὸ': 'ό', 'ὺ': 'ύ', 'ὼ': 'ώ', 'ἃ': 'ἅ', 'ἓ': 'ἕ', 'ἳ': 'ἵ', 'ὃ': 'ὅ', 'ὓ': 'ὕ', 'ὣ': 'ὥ', 'ἂ': 'ἄ', 'ἒ': 'ἔ', 'ἲ': 'ἴ', 'ὂ': 'ὄ', 'ὒ': 'ὔ', 'ὢ': 'ὤ', 'ᾲ': 'ᾴ', 'ῂ': 'ῄ', 'ῲ': 'ῴ' };

export function normGreekKey(raw) {
  let s = raw.normalize('NFD').replace(/[̄̆]/g, '').normalize('NFC').toLowerCase();
  s = [...s].map((ch) => GRAVE_TO_ACUTE[ch] ?? ch).join('');
  // Fold final sigma into medial — positional variants of one letter, and the
  // betacode round-trip can emit either in either position (the crunch output
  // contains lemmas like προςέχω; keys must not care).
  return s.replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}]/gu, '');
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  // 1. Entries.
  const headwords = JSON.parse(fs.readFileSync(path.join(DIR, 'lsj9_headwords.json'), 'utf8'));
  const shortDefs = JSON.parse(fs.readFileSync(path.join(DIR, 'lsj9_short_defs.json'), 'utf8'));
  const entriesCol = db.collection('lexicon_entries_grc');
  const keyByNorm = new Map(); // normalized headword (digits stripped) → entry keys
  let ops = [];
  let n = 0;
  for (const h of headwords) {
    const key = `lsj9:${h.id}`;
    const norm = normGreekKey(h.headword);
    if (!norm) continue;
    const arr = keyByNorm.get(norm) ?? [];
    arr.push(key);
    keyByNorm.set(norm, arr);
    ops.push({
      updateOne: {
        filter: { key },
        update: {
          $set: {
            dict: 'lsj9',
            key,
            headword: h.headword,
            key_normalized: norm,
            grammar: h.grammar ?? null,
            etymology: h.etymology ?? null,
            homograph: h.homograph ?? null,
            short_def: shortDefs[h.headword] ?? null,
            imported_at: new Date(),
          },
        },
        upsert: true,
      },
    });
    if (ops.length >= 5000) {
      await entriesCol.bulkWrite(ops, { ordered: false });
      n += ops.length;
      ops = [];
      if (n % 25000 < 5000) console.log(`entries ${n}/${headwords.length}`);
    }
  }
  if (ops.length) { await entriesCol.bulkWrite(ops, { ordered: false }); n += ops.length; }
  console.log(`entries upserted: ${n}`);

  // 2. Lemma map: Morpheus lemma (unicode, maybe trailing homograph digit)
  //    → LSJ keys via the shared normalizer.
  // Dedupe fully in memory (forms collide after normalization — merge key
  // sets), then plain insertMany. Never upsert into an unindexed collection:
  // each upsert filter collection-scans the growing table and the load goes
  // quadratic (~21 docs/s observed the first time).
  const newMap = db.collection('lexicon_lemma_map_grc_new');
  await newMap.drop().catch(() => {});
  const rl = readline.createInterface({ input: fs.createReadStream(LEMMA_JSONL) });
  const byForm = new Map();
  let mapped = 0, unjoined = 0, total = 0;
  const unjoinedSample = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    const { form, lemmas } = JSON.parse(line);
    const normForm = normGreekKey(form);
    if (!normForm) continue;
    const keys = byForm.get(normForm) ?? new Set();
    for (const lemma of lemmas) {
      const bare = lemma.replace(/[0-9]+$/, '');
      for (const k of keyByNorm.get(normGreekKey(bare)) ?? []) {
        if (keys.size < MAX_KEYS_PER_FORM) keys.add(k);
      }
    }
    if (!keys.size) {
      unjoined++;
      if (unjoinedSample.length < 20) unjoinedSample.push(`${form} → ${lemmas.join(',')}`);
      continue;
    }
    mapped++;
    byForm.set(normForm, keys);
  }
  const allDocs = [...byForm.entries()].map(([form, keys]) => ({ form, keys: [...keys] }));
  console.log(`lemma map: ${allDocs.length} distinct normalized forms (${mapped} joined / ${unjoined} unjoined of ${total})`);
  for (let i = 0; i < allDocs.length; i += 20000) {
    await newMap.insertMany(allDocs.slice(i, i + 20000), { ordered: false });
    if (i % 100000 < 20000) console.log(`  inserted ${Math.min(i + 20000, allDocs.length)}/${allDocs.length}`);
  }
  await newMap.createIndex({ form: 1 }, { unique: true });
  await newMap.rename('lexicon_lemma_map_grc', { dropTarget: true });

  await entriesCol.createIndex({ key: 1 }, { unique: true });
  await entriesCol.createIndex({ key_normalized: 1 });

  console.log(`unjoined lemma samples:\n  ${unjoinedSample.join('\n  ')}`);
  console.log(`DONE: entries=${await entriesCol.countDocuments()} mapForms=${await db.collection('lexicon_lemma_map_grc').countDocuments()} joined=${mapped}/${total} (${((mapped / total) * 100).toFixed(1)}%)`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
