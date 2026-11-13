#!/usr/bin/env node
/**
 * Automatic checks on this trial's pending candidates (source = batch-2026-11). DRY-RUN by default:
 * prints what fails and a random sample of 30 for a person to read. --execute marks failures
 * summary_candidate.status = 'needs_review' (promote-summaries.mjs only promotes 'pending').
 *
 *   node --env-file=.env.production.local scripts/summaries-batch/5-check.mjs [--execute] [--sample=30]
 *
 * Checks: banned phrases and em dashes (book-summary-writing-rules.md), length (brief 20-90 words),
 * opens with the label ("X is a …"), and grounding: every capitalised name and every year in the
 * brief must appear in the book's text or catalogue record, else it is unsupported.
 */
import { MongoClient } from 'mongodb';
import { SOURCE, BANNED, bookText, recordText, RECORD_FIELDS, arg, flag } from './lib.mjs';

const EXECUTE = flag('execute');
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set (see README: credentials)'); process.exit(2); }
const client = new MongoClient(process.env.MONGODB_URI, { readPreference: EXECUTE ? 'primary' : 'secondaryPreferred' });
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const fold = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const STOP = new Set(['The', 'A', 'An', 'In', 'It', 'Its', 'This', 'His', 'Her', 'Their', 'He', 'She', 'They', 'Written', 'Printed', 'Each', 'One', 'Two', 'Three']);

const cands = await books.find({ 'summary_candidate.source': SOURCE, 'summary_candidate.status': 'pending' }, { projection: { ...RECORD_FIELDS, summary_candidate: 1 } }).toArray();
let failed = 0;
const passed = [];
for (const b of cands) {
  const brief = b.summary_candidate.brief || '';
  const problems = [];
  for (const re of BANNED) if (re.test(brief)) problems.push(`banned: ${re}`);
  const words = brief.split(/\s+/).filter(Boolean).length;
  if (words < 20 || words > 90) problems.push(`length ${words} words`);
  if (/^\s*[^.]{0,120}\bis an? (\w+ )?(treatise|work|book|text|collection|manual|novel|poem)\b/i.test(brief)) problems.push('opens with the label');
  const { text } = await bookText(db, b, 400000);
  const hay = fold(`${text}\n${recordText(b)}`);
  const names = [...brief.matchAll(/\b\p{Lu}[\p{L}'’-]{2,}(?:\s+\p{Lu}[\p{L}'’-]{2,})*/gu)].map((m) => m[0]).filter((n) => !STOP.has(n.split(/\s+/)[0]));
  const years = [...brief.matchAll(/\b(1[0-9]{3}|[1-9][0-9]{2})\b/g)].map((m) => m[0]);
  const unsupported = [...names, ...years].filter((x) => !x.split(/\s+/).some((w) => hay.includes(fold(w))));
  if (unsupported.length) problems.push(`not in text or record: ${[...new Set(unsupported)].join(', ')}`);
  if (problems.length) {
    failed++;
    console.log(`NEEDS REVIEW ${b.id} · ${problems.join(' · ')}\n  ${brief}`);
    if (EXECUTE) await books.updateOne({ id: b.id, 'summary_candidate.status': 'pending' }, { $set: { 'summary_candidate.status': 'needs_review', 'summary_candidate.check_problems': problems } });
  } else passed.push(b);
}
console.log(`\n${cands.length} candidates · ${failed} need review · ${passed.length} pass the automatic checks`);
const n = Number(arg('sample', 30));
console.log(`\nRandom ${Math.min(n, passed.length)} that passed, for a person to read:`);
for (const b of passed.sort(() => Math.random() - 0.5).slice(0, n)) console.log(`\n— ${b.display_title || b.title} (${b.author || 'no author'}, ${b.published || 'no date'}) /book/${b.id}\n  ${b.summary_candidate.brief}`);
if (!EXECUTE) console.log('\nDRY-RUN. No statuses changed. Pass --execute to mark failures needs_review.');
await client.close();
