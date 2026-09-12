#!/usr/bin/env node
// PRIOR ART: scripts/enrichment/dedup-entities.mjs (merges entity NAMES into aliases — it
// types nothing and needs Gemini for phase 2); src/lib/entity-aliases.ts (resolves a name to
// its canonical form, caller supplies the type); src/lib/author-thesaurus.ts (people only,
// read-path). None labels a free term as person/place/concept; #4695.
/**
 * type-page-terms — label every row of the global page-terms table as person | place |
 * concept | unknown by joining its folded term_key against the name tables we already hold
 * (no model call). The logic is scripts/lib/page-terms-type.mjs; this file is the I/O:
 *
 *   1. load name records from Mongo — canonical_entities (name + aliases, type), entities
 *      (name + aliases, type, book_count), authors (canonical_name + variants + aliases,
 *      person unless is_person === false) — and cache them to --names-out so a re-run
 *      needs no database;
 *   2. stream --in (the 4.4 GB global JSONL written by aggregate-page-terms.mjs) and write
 *      a SPARSE overlay to --out: one line per term_key whose verdict is not the default
 *      (concept/unmatched) — {term_key, type, type_source, type_id, type_name, type_weight}.
 *      aggregate-page-terms.mjs --types <overlay> stamps these onto the rows it writes;
 *   3. print a stats line (all rows, and the subset kept by --rule) plus 20 samples per
 *      type, and run the positive controls (--check): aquilius → person, acraephia → place,
 *      prima materia / 三昧 / ذكر → concept. A failed control is REPORTED, not fatal — the
 *      first run found Acraephia in none of the three tables, which is a finding about the
 *      tables, not the join.
 *
 *   node --env-file=.env.production.local scripts/maintenance/type-page-terms.mjs \
 *     --in page-terms-global.jsonl --out page-terms-types.jsonl --rule bridge --check \
 *     --names-out page-terms-names.json
 *   node scripts/maintenance/type-page-terms.mjs --names page-terms-names.json --in … --out …
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { buildNameIndex, typeTerm, typeConfidence } from '../lib/page-terms-type.mjs';
import { KEEP_RULES, RULE_NAMES } from '../lib/page-terms-keep.mjs';

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const IN = getArg('--in');
const OUT = getArg('--out') || 'page-terms-types.jsonl';
const NAMES = getArg('--names');
const NAMES_OUT = getArg('--names-out');
const RULE = getArg('--rule');
const CHECK = args.includes('--check');
const SAMPLES = Number(getArg('--samples') || 20);
if (!IN) { console.error('--in <global.jsonl> is required'); process.exit(1); }
if (RULE && !RULE_NAMES.includes(RULE)) { console.error(`--rule must be one of ${RULE_NAMES.join('|')}`); process.exit(1); }

// ---- name records ----
async function loadNamesFromMongo() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set (or pass --names <cache.json>)'); process.exit(1); }
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const records = [];
  for await (const d of db.collection('canonical_entities').find({}, { projection: { name: 1, aliases: 1, type: 1, book_count: 1 } })) {
    records.push({ source: 'canonical_entities', id: String(d._id), type: d.type, names: [d.name, ...(d.aliases || [])].filter(Boolean), weight: d.book_count || 1 });
  }
  for await (const d of db.collection('entities').find({}, { projection: { name: 1, aliases: 1, type: 1, book_count: 1 } })) {
    records.push({ source: 'entities', id: String(d._id), type: d.type, names: [d.name, ...(d.aliases || [])].filter(Boolean), weight: d.book_count || 1 });
  }
  for await (const d of db.collection('authors').find({ is_person: { $ne: false }, merged_into: { $exists: false } }, { projection: { canonical_name: 1, variants: 1, aliases: 1, book_count: 1 } })) {
    records.push({ source: 'authors', id: String(d._id), type: 'person', names: [d.canonical_name, ...(d.variants || []), ...(d.aliases || [])].filter(Boolean), weight: d.book_count || 1 });
  }
  await client.close();
  return records;
}

const t0 = Date.now();
const records = NAMES ? JSON.parse(fs.readFileSync(NAMES, 'utf8')) : await loadNamesFromMongo();
if (NAMES_OUT) fs.writeFileSync(NAMES_OUT, JSON.stringify(records));
const bySource = {};
for (const r of records) bySource[r.source] = (bySource[r.source] || 0) + 1;
const nameIndex = buildNameIndex(records);
console.log(`names: ${records.length} records ${JSON.stringify(bySource)} → ${nameIndex.keys} folded keys (${nameIndex.indexed} name→key entries) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ---- stream the global table ----
const bucket = () => ({ person: 0, place: 0, concept: 0, unknown: 0 });
const stats = { rows: 0, all: bucket(), allSource: {}, kept: 0, keptType: bucket(), keptSource: {}, keptConfidence: { strong: 0, weak: 0 }, weight1: bucket() };
const samples = { person: [], place: [], concept: [], unknown: [], weight1: [], strong: [], weak: [] };
// Measurement only: would a gloss-shape heuristic recover names the tables miss?
const PLACE_GLOSS = /\b(city|town|village|river|mountain|island|region|province|kingdom|country|port|lake|sea|valley|district|capital)\b/i;
const PERSON_GLOSS = /\b(king|queen|emperor|philosopher|saint|bishop|pope|poet|prophet|son of|daughter of|disciple|abbot|monk|scholar|physician|general|prince|duke|caliph|sultan|rabbi|sage|master|teacher|author)\b/i;
const hint = { place: 0, person: 0, samples: { place: [], person: [] } };
const fmt = (r, t) => `${r.term} [${r.books}b${t.weight ? ` w${t.weight}` : ''}${t.source ? ` ${t.source}` : ''}]${t.name && t.name !== r.term ? ` =${t.name}` : ''} ${(r.glosses || []).slice(0, 2).map((g) => g.gloss).join(' / ')}`.slice(0, 140);
const reservoir = (arr, s, n) => { if (arr.length < SAMPLES) arr.push(s); else if (Math.random() < SAMPLES / n) arr[Math.floor(Math.random() * SAMPLES)] = s; };

const outFd = fs.openSync(OUT, 'w');
let overlay = 0;
const controls = new Map([['aquilius', 'person'], ['acraephia', 'place'], ['prima materia', 'concept'], ['三昧', 'concept'], ['ذكر', 'concept']]);
const controlSeen = new Map();
const rl = readline.createInterface({ input: fs.createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line);
  stats.rows++;
  const t = typeTerm(r.term_key, nameIndex);
  t.confidence = typeConfidence(t, r.books);
  stats.all[t.type]++;
  stats.allSource[t.source] = (stats.allSource[t.source] || 0) + 1;
  if (controls.has(r.term_key)) controlSeen.set(r.term_key, t);
  if (!(t.type === 'concept' && t.source === 'unmatched')) {
    fs.writeSync(outFd, JSON.stringify({ term_key: r.term_key, type: t.type, type_source: t.source, type_confidence: t.confidence, type_id: t.id ?? null, type_name: t.name ?? null, type_weight: t.weight ?? null }) + '\n');
    overlay++;
  }
  const kept = RULE ? KEEP_RULES[RULE](r) : true;
  if (!kept) continue;
  stats.kept++;
  stats.keptType[t.type]++;
  stats.keptSource[t.source] = (stats.keptSource[t.source] || 0) + 1;
  if (t.confidence) { stats.keptConfidence[t.confidence]++; reservoir(samples[t.confidence], fmt(r, t), stats.keptConfidence[t.confidence]); }
  reservoir(samples[t.type], fmt(r, t), stats.keptType[t.type]);
  if ((t.type === 'person' || t.type === 'place') && t.weight === 1) { stats.weight1[t.type]++; reservoir(samples.weight1, fmt(r, t), stats.weight1.person + stats.weight1.place); }
  if (t.source === 'unmatched') {
    const g = (r.glosses || []).map((x) => x.gloss).join(' | ');
    if (PLACE_GLOSS.test(g)) { hint.place++; reservoir(hint.samples.place, fmt(r, t), hint.place); }
    else if (PERSON_GLOSS.test(g)) { hint.person++; reservoir(hint.samples.person, fmt(r, t), hint.person); }
  }
  if (stats.rows % 1000000 === 0) console.log(`${stats.rows} rows · kept ${stats.kept} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
fs.closeSync(outFd);

console.log(JSON.stringify({ ...stats, rule: RULE || 'none', overlay_rows: overlay, seconds: Math.round((Date.now() - t0) / 1000) }));
for (const k of ['person', 'place', 'concept', 'unknown']) console.log(`\n== ${k} (${RULE ? 'kept by ' + RULE : 'all'}) ==\n` + samples[k].map((s) => '  ' + s).join('\n'));
console.log(`\n== person/place decided on weight 1 (single-book entity only) ==\n` + samples.weight1.map((s) => '  ' + s).join('\n'));
for (const k of ['strong', 'weak']) console.log(`\n== person/place with type_confidence=${k} ==\n` + samples[k].map((s) => '  ' + s).join('\n'));
console.log(`\n== gloss-shape hint on UNMATCHED kept rows (measurement only, not applied): place-like ${hint.place}, person-like ${hint.person} ==`);
console.log('  place-like: ' + hint.samples.place.join(' | '));
console.log('  person-like: ' + hint.samples.person.join(' | '));
if (CHECK) {
  console.log('\n== positive controls ==');
  for (const [k, want] of controls) {
    const got = controlSeen.get(k);
    const ok = got && got.type === want;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${k} → ${got ? `${got.type}/${got.source}${got.weight ? ' w' + got.weight : ''}` : 'NOT IN TABLE'} (want ${want})`);
  }
}
console.log(`overlay → ${OUT} (${overlay} rows; every other term_key is concept/unmatched)`);
