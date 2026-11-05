#!/usr/bin/env node
/**
 * Second-gate check for an acquisition survey (#7294): how often does the
 * holdings check disagree with `candidate-tier-survey.ts` about a survivor?
 *
 * PRIOR ART: scripts/import/check-holdings.ts — the single-item command-line door
 * to `checkHoldings()`; this runs the same function over a random sample of a
 * survey's survivor file and tallies survey verdict → holdings verdict, so the
 * disagreement rate between the two gates is a number, not an impression.
 *
 * Read-only. Writes nothing to the database.
 *
 * Usage:
 *   npx tsx --env-file=.env.production.local scripts/audit/candidate-gate-check.ts <label>-survivors-AB.jsonl.gz [n=100] [verdicts=NEW,OTHER_ED]
 *   … PARTIAL,SPELLING   to see how many unresolved matches are real duplicates
 */

import { MongoClient } from 'mongodb';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { checkHoldings } from '../../src/lib/holdings-check';

async function main() {
  const [file, nStr, verdicts] = process.argv.slice(2);
  if (!file) { console.error('give a <label>-survivors-AB.jsonl.gz from candidate-tier-survey.ts'); process.exit(1); }
  const want = new Set((verdicts || 'NEW,OTHER_ED').split(','));
  const rows: Array<Record<string, any>> = [];
  for await (const l of createInterface({ input: createReadStream(file).pipe(createGunzip()) })) {
    const r = JSON.parse(l);
    if (want.has(r.verdict) && r.dated) rows.push(r);
  }
  // Fisher–Yates, then take the head: a uniform sample of the dated rows.
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  const sample = rows.slice(0, parseInt(nStr || '100', 10));
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db('bookstore');
  const tally: Record<string, number> = {};
  const examples: string[] = [];
  for (const r of sample) {
    const res = await checkHoldings(db, {
      title: r.title,
      author: r.author && r.author !== 'Unknown' ? r.author : undefined,
      year: r.year,
      url: r.manifest_url || r.source_url || undefined,
    });
    const k = `${r.verdict}->${res.verdict}`;
    tally[k] = (tally[k] || 0) + 1;
    if (!['new', 'related_title', 'other_edition'].includes(res.verdict) && examples.length < 10) {
      examples.push(`${k}: ${r.year} ${String(r.author).slice(0, 25)} | ${String(r.title).slice(0, 70)} || held: ${res.candidates[0]?.title?.slice(0, 60)} ${res.candidates[0]?.year ?? ''}`);
    }
  }
  await client.close();
  console.log(JSON.stringify({ sampled: sample.length, of: rows.length, tally }));
  for (const e of examples) console.log(`  ${e}`);
}

main().catch(e => { console.error(e); process.exit(1); });
