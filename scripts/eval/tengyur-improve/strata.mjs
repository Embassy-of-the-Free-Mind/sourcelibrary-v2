#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/overview-draw.mjs takes a strata.json but builds none; the 2026-10-07 overview
// drew the Tengyur as ONE stratum (frame 213). tengyur-characterize/common.mjs `sectionOf` is the section map reused here.
/**
 * strata.mjs — read-only, $0. Step 1 of #6141: the Derge Tengyur split into the six section strata the issue names,
 * for overview-draw.mjs. Hidden books are included (the Tengyur is about to be published); /rights/ excluded.
 *   node --env-file=… scripts/eval/tengyur-improve/strata.mjs > strata.json
 */
import { MongoClient } from 'mongodb';
import { sectionOf } from '../tengyur-characterize/common.mjs';

const STRATA = [
  ['pramana', 'Derge Tengyur, Pramāṇa (tshad ma) volumes', ['Pramāṇa']],
  ['madhyamaka', 'Derge Tengyur, Madhyamaka (dbu ma) volumes', ['Madhyamaka']],
  ['vinaya', 'Derge Tengyur, Vinaya (\'dul ba) volumes', ['Vinaya']],
  ['tantra-commentary', 'Derge Tengyur, tantra commentary (rgyud \'grel) volumes', ['Tantra commentary']],
  ['sutra-citta-abhidharma', 'Derge Tengyur, sūtra commentary + Cittamātra + Abhidharma volumes', ['Sūtra commentary', 'Cittamātra', 'Abhidharma']],
  ['jataka-misc', 'Derge Tengyur, Jātaka + Miscellaneous (sna tshogs) volumes', ['Jātaka', 'Miscellaneous']],
];
const c = await MongoClient.connect(process.env.MONGODB_URI);
const books = await c.db('bookstore').collection('books').find(
  { 'catalog_ids.derge_tengyur_volume': { $exists: true }, pages_translated: { $gte: 8 }, hidden_reason: { $not: /rights/i } },
  { projection: { _id: 0, id: 1, title: 1 } }).toArray();
await c.close();
const out = STRATA.map(([name, desc, secs]) => ({ name, desc, ids: books.filter((b) => secs.includes(sectionOf(b.title))).map((b) => b.id).sort() }));
const left = books.filter((b) => !STRATA.some(([, , secs]) => secs.includes(sectionOf(b.title))));
console.error(out.map((s) => `${s.name}: ${s.ids.length}`).join(', ') + ` | outside the six strata: ${left.length} (${[...new Set(left.map((b) => sectionOf(b.title)))].join(', ')})`);
console.log(JSON.stringify(out, null, 1));
