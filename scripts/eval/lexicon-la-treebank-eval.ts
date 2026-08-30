/**
 * Validate the Latin lemma machinery against the UD Latin-ITTB treebank
 * (Index Thomisticus: Aquinas — medieval Latin, the closest gold standard
 * to our early modern corpus). For each human-verified (form, lemma) token,
 * we ask whether the production confident tiers — exact headword, irregular
 * table, generated-paradigm map — contain the gold lemma.
 *
 * Run: set env; npx tsx scripts/eval/lexicon-la-treebank-eval.ts <conllu>
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { normalizeLatin } from '../../src/lib/lexicon/normalize';
import { irregularLemmas } from '../../src/lib/lexicon/latin-morph';

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const tokens: Array<[string, string]> = [];
for (const line of lines) {
  if (!line || line.startsWith('#')) continue;
  const cols = line.split('\t');
  if (cols.length < 3 || cols[0].includes('-') || cols[0].includes('.')) continue;
  const form = normalizeLatin(cols[1]);
  const lemma = normalizeLatin(cols[2].replace(/[0-9]+$/, ''));
  if (form.length >= 2 && lemma) tokens.push([form, lemma]);
}
console.log(`gold tokens: ${tokens.length}`);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  const distinct = [...new Set(tokens.map((t) => t[0]))];
  console.log(`distinct gold forms: ${distinct.length}`);

  // Fetch map rows and headword-exact hits for all distinct forms.
  const mapKeys = new Map<string, string[]>();
  const isHeadword = new Set<string>();
  for (let i = 0; i < distinct.length; i += 5000) {
    const slice = distinct.slice(i, i + 5000);
    const [maps, heads] = await Promise.all([
      db.collection('lexicon_lemma_map').find({ form: { $in: slice } }).toArray(),
      db.collection('lexicon_entries').find({ key_normalized: { $in: slice } }, { projection: { key_normalized: 1 } }).toArray(),
    ]);
    for (const d of maps) mapKeys.set(d.form as string, d.keys as string[]);
    for (const d of heads) isHeadword.add(d.key_normalized as string);
  }
  const allKeys = [...new Set([...mapKeys.values()].flat())];
  const keyToNorm = new Map<string, string>();
  for (let i = 0; i < allKeys.length; i += 5000) {
    const batch = await db.collection('lexicon_entries').find({ key: { $in: allKeys.slice(i, i + 5000) } }, { projection: { key: 1, key_normalized: 1 } }).toArray();
    for (const d of batch) keyToNorm.set(d.key as string, d.key_normalized as string);
  }

  let covered = 0, agree = 0;
  const disagreements: string[] = [];
  for (const [form, lemma] of tokens) {
    const candidates = new Set<string>();
    if (isHeadword.has(form)) candidates.add(form);
    for (const l of irregularLemmas(form)) candidates.add(l.replace(/[0-9]+$/, ''));
    for (const k of mapKeys.get(form) ?? []) {
      const n = keyToNorm.get(k);
      if (n) candidates.add(n);
    }
    if (!candidates.size) continue;
    covered++;
    if (candidates.has(lemma)) agree++;
    else if (disagreements.length < 15) disagreements.push(`${form}: gold=${lemma} ours=[${[...candidates].slice(0, 3)}]`);
  }
  console.log(`token coverage (confident tiers): ${covered}/${tokens.length} (${((covered / tokens.length) * 100).toFixed(1)}%)`);
  console.log(`lemma agreement on covered: ${agree}/${covered} (${((agree / covered) * 100).toFixed(1)}%)`);
  console.log('sample disagreements:');
  for (const d of disagreements) console.log('  ' + d);
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
