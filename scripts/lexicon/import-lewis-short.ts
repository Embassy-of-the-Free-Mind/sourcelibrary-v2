/**
 * Import Lewis & Short (1879) into Mongo for the parsing reader (#3823).
 *
 * Source: the lewis-short-json conversion of Perseus's TEI digitisation
 * (https://github.com/IohannesArnold/lewis-short-json, CC BY-SA — text itself
 * is public domain). Download the ls_*.json letter files first and pass the
 * directory with --dir (default: _tmp-ls-json/ next to the repo root).
 *
 * Writes two collections in the `bookstore` db:
 *   lexicon_entries   — one doc per L&S entry (~51.6K), with normalized keys
 *   lexicon_lemma_map — generated inflected form → entry keys, built from
 *                       each entry's own declension/genitive/principal parts
 *                       via src/lib/lexicon/latin-morph.ts
 *
 * Idempotent: upserts entries by key and rebuilds the lemma map atomically
 * (writes to lexicon_lemma_map_new, then renames over the old one).
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/lexicon/import-lewis-short.ts --dir _tmp-ls-json
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, AnyBulkWriteOperation, Document } from 'mongodb';
import { normalizeLatin, looseKey } from '../../src/lib/lexicon/normalize';
import { nounForms, adjectiveForms, verbForms, principalPartStems } from '../../src/lib/lexicon/latin-morph';

interface RawEntry {
  entry_type: string;
  key: string;
  main_notes: string;
  part_of_speech: string;
  senses?: unknown[];
  declension?: number;
  gender?: string;
  title_genitive?: string;
  title_orthography?: string;
  alternative_orthography?: string[];
  alternative_genative?: string;
  greek_word?: string;
}

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const DIR = dirFlag >= 0 ? args[dirFlag + 1] : '_tmp-ls-json';
const MAX_KEYS_PER_FORM = 12;

function parseVerbParts(headNorm: string, notes: string): { conjs: Array<1 | 2 | 3 | 4>; perfect: string[]; supine: string[] } {
  // Typical shape: "ămo, āvi, ātum, 1, v. a. (…" — principal parts as
  // abbreviated tokens, then a bare conjugation digit. Many entries truncate
  // before the digit ("vŏco, āvi, ātum ("), so when it's absent we infer the
  // conjugation from the principal-part signature / headword shape — and when
  // genuinely ambiguous we generate the UNION of candidate paradigms (every
  // form still maps to the right entry; see over-generation note in
  // latin-morph.ts).
  const headChunk = notes.slice(0, 120).split('(')[0];
  const conjMatch = headChunk.match(/,\s*([1-4])\s*[,.;)\s]/);
  const perfect: string[] = [];
  const supine: string[] = [];
  let sawAvi = false;
  let sawIvi = false;
  for (const rawTok of headChunk.split(',').slice(1)) {
    for (const tok of rawTok.split(/\s+or\s+/)) {
      const t = normalizeLatin(tok.trim());
      if (!t || /^[1-4]$/.test(tok.trim())) continue;
      if (t.endsWith('i') && !t.endsWith('ari') && !t.endsWith('eri') && !t.endsWith('iri') && t.length >= 2) {
        if (t.endsWith('aui')) sawAvi = true;
        if (t.endsWith('iui') || t === 'ii') sawIvi = true;
        for (const s of principalPartStems(headNorm, t.replace(/i$/, ''))) perfect.push(s);
      } else if (t.endsWith('um') || t.endsWith('us')) {
        for (const s of principalPartStems(headNorm, t.replace(/(um|us)$/, ''))) supine.push(s);
      }
    }
  }
  let conjs: Array<1 | 2 | 3 | 4>;
  if (conjMatch) conjs = [Number(conjMatch[1]) as 1 | 2 | 3 | 4];
  else if (sawAvi) conjs = [1];
  else if (headNorm.endsWith('eo') || headNorm.endsWith('eor')) conjs = [2];
  else if (headNorm.endsWith('io') || headNorm.endsWith('ior')) conjs = sawIvi ? [4] : [3, 4];
  else conjs = [1, 3];
  return { conjs, perfect: [...new Set(perfect)].slice(0, 4), supine: [...new Set(supine)].slice(0, 4) };
}

function generateForms(e: RawEntry, headNorm: string): string[] {
  if (e.entry_type !== 'main' && e.entry_type !== 'hapax') return [];
  const pos = (e.part_of_speech || '').toLowerCase();
  const gen = e.title_genitive ? normalizeLatin(e.title_genitive) : undefined;

  if (e.declension && (e.gender || gen)) {
    return nounForms(headNorm, e.declension, gen);
  }
  if (pos.includes('adj') || pos === 'p. a.') {
    return adjectiveForms(headNorm);
  }
  if (pos.includes('v') && (headNorm.endsWith('o') || headNorm.endsWith('or'))) {
    const { conjs, perfect, supine } = parseVerbParts(headNorm, e.main_notes || '');
    const forms = new Set<string>();
    for (const c of conjs) for (const f of verbForms(headNorm, c, perfect, supine)) forms.add(f);
    return [...forms];
  }
  return [];
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'bookstore';
  if (!uri) throw new Error('MONGODB_URI not set — source .env.production.local first.');

  const files = fs.readdirSync(DIR).filter((f) => /^ls_[A-Z]\.json$/.test(f)).sort();
  if (files.length < 20) throw new Error(`Only ${files.length} ls_*.json files in ${DIR} — incomplete download?`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const entriesCol = db.collection('lexicon_entries');

  let entryCount = 0;
  let formCount = 0;
  const lemmaMap = new Map<string, Set<string>>();

  for (const file of files) {
    const raw: RawEntry[] = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const ops: AnyBulkWriteOperation<Document>[] = [];
    for (const e of raw) {
      if (!e.key) continue;
      const headword = e.key.replace(/\d+$/, '');
      const keyNorm = normalizeLatin(headword);
      if (!keyNorm) continue;
      const altNorm = [...new Set((e.alternative_orthography || []).map(normalizeLatin).filter((a) => a && a !== keyNorm))];
      ops.push({
        updateOne: {
          filter: { key: e.key },
          update: {
            $set: {
              dict: 'lewis-short',
              key: e.key,
              headword,
              key_normalized: keyNorm,
              key_loose: looseKey(keyNorm),
              alt_normalized: altNorm,
              entry_type: e.entry_type,
              part_of_speech: e.part_of_speech || null,
              gender: e.gender ?? null,
              declension: e.declension ?? null,
              title_genitive: e.title_genitive ?? null,
              title_orthography: e.title_orthography ?? null,
              greek_word: e.greek_word ?? null,
              main_notes: e.main_notes ?? null,
              senses: e.senses ?? [],
              imported_at: new Date(),
            },
          },
          upsert: true,
        },
      });

      // Greek-script entries get no Latin paradigm.
      if (!e.greek_word) {
        for (const form of generateForms(e, keyNorm)) {
          if (form === keyNorm) continue;
          const set = lemmaMap.get(form) ?? new Set<string>();
          if (set.size < MAX_KEYS_PER_FORM) set.add(e.key);
          lemmaMap.set(form, set);
        }
        for (const alt of altNorm) {
          const set = lemmaMap.get(alt) ?? new Set<string>();
          if (set.size < MAX_KEYS_PER_FORM) set.add(e.key);
          lemmaMap.set(alt, set);
        }
      }
    }
    const res = await entriesCol.bulkWrite(ops, { ordered: false });
    entryCount += res.upsertedCount + res.modifiedCount + res.matchedCount - res.modifiedCount;
    console.log(`${file}: ${ops.length} entries upserted (running total ${entryCount})`);
  }

  // Rebuild lemma map atomically: write _new, create indexes, rename over.
  const newMap = db.collection('lexicon_lemma_map_new');
  await newMap.drop().catch(() => {});
  const mapDocs: Document[] = [];
  for (const [form, keys] of lemmaMap) {
    mapDocs.push({ form, form_loose: looseKey(form), keys: [...keys] });
  }
  console.log(`lemma map: ${mapDocs.length} distinct generated forms`);
  const BATCH = 20000;
  for (let i = 0; i < mapDocs.length; i += BATCH) {
    await newMap.insertMany(mapDocs.slice(i, i + BATCH), { ordered: false });
    formCount += Math.min(BATCH, mapDocs.length - i);
    if (formCount % 100000 < BATCH) console.log(`  inserted ${formCount}/${mapDocs.length}`);
  }
  await newMap.createIndex({ form: 1 }, { unique: true });
  await newMap.createIndex({ form_loose: 1 });
  await newMap.rename('lexicon_lemma_map', { dropTarget: true });

  await entriesCol.createIndex({ key: 1 }, { unique: true });
  await entriesCol.createIndex({ key_normalized: 1 });
  await entriesCol.createIndex({ key_loose: 1 });
  await entriesCol.createIndex({ alt_normalized: 1 });

  const finalEntries = await entriesCol.countDocuments();
  const finalForms = await db.collection('lexicon_lemma_map').countDocuments();
  console.log(`DONE: lexicon_entries=${finalEntries}, lexicon_lemma_map=${finalForms}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
