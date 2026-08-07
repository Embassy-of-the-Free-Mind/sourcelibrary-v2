#!/usr/bin/env node
/**
 * Screen the first-translation DEMOTE queue before spending agent time on it.
 *
 * The queue is the books badged `is_first_translation: true` whose own verdict
 * reads `not_first` — 59 of them as of 2026-08-07 (#3687). Sixteen were verified
 * one at a time by independent Claude subagents, each chosen *because* it looked
 * like an obvious demote, and **13 of the 16 badges turned out to be correct**.
 *
 * So the expensive step should not run first. This ranks the queue by how likely
 * the DEMOTE is to be wrong, using signals already present in the data, and the
 * detectors are pinned against those 16 verified outcomes
 * (`tests/unit/ft-demote-screen.test.ts`).
 *
 * READ-ONLY. Writes nothing, flips nothing. A signal is a reason to look.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/ft-demote-queue-screen.mjs
 *   node --env-file=.env.production.local scripts/audit/ft-demote-queue-screen.mjs --json out.json
 */
import fs from 'fs';
import { MongoClient } from 'mongodb';
import { screenDemoteCandidate, KNOWN_LIMITS } from '../lib/ft-demote-screen.mjs';

const jsonOut = (() => {
  const i = process.argv.indexOf('--json');
  return i === -1 ? null : process.argv[i + 1];
})();

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');

const rows = await books.find(
  { is_first_translation: true, visible: true, 'first_translation.verdict': 'not_first' },
  {
    projection: {
      _id: 0, id: 1, title: 1, author: 1, language: 1, year: 1, text_role: 1,
      'first_translation.resolver': 1, 'first_translation.evidence_strength': 1,
      'translation_verification.translations_found': 1,
    },
  },
).toArray();

const screened = [];
for (const b of rows) {
  const att = await attempts.find({ book_id: b.id }).sort({ date: -1 }).limit(6).toArray();
  const priors = [];
  for (const a of att) for (const p of (a.priors ?? [])) if (p.english_title) priors.push(p);
  for (const p of (b.translation_verification?.translations_found ?? [])) {
    if (p.english_title) priors.push(p);
  }
  const seen = new Set();
  const uniq = priors.filter((p) => {
    const k = `${p.english_title}|${p.translator ?? ''}|${p.pub_year ?? ''}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const result = screenDemoteCandidate(b, uniq);
  screened.push({ ...b, priorCount: uniq.length, ...result });
}

screened.sort((a, b) => b.riskScore - a.riskScore);

const byCode = {};
for (const s of screened) for (const sig of new Set(s.signals.map((x) => x.code))) byCode[sig] = (byCode[sig] ?? 0) + 1;

const flagged = screened.filter((s) => s.riskScore > 0);
const clean = screened.filter((s) => s.riskScore === 0);

console.log(`\nFIRST-TRANSLATION DEMOTE QUEUE — screened ${screened.length} candidates\n`);
console.log(`  flagged (demote likely unsafe) : ${flagged.length}`);
console.log(`  no signal                      : ${clean.length}`);
console.log(`\n  signal frequency:`);
for (const [k, v] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(26)} ${String(v).padStart(3)}`);
}

console.log(`\n─── FLAGGED — verify before demoting ${'─'.repeat(28)}`);
for (const s of flagged) {
  console.log(`\n  [${s.riskScore}] ${s.id}  [${s.language}] ${String(s.author ?? '?').slice(0, 26)}`);
  console.log(`      ${String(s.title).slice(0, 78)}`);
  for (const sig of s.signals) console.log(`      · ${sig.code}`);
}

console.log(`\n─── NO SIGNAL — demote is plausible, still needs verification ${'─'.repeat(8)}`);
for (const s of clean) {
  console.log(`  ${s.id}  [${s.language}] ${String(s.author ?? '?').slice(0, 24)} — ${String(s.title).slice(0, 52)}`);
}

console.log(`\n⚠ A zero score is NOT a clearance — ${KNOWN_LIMITS.blind_spot}.`);
console.log(`  Recall on the gold set: ${KNOWN_LIMITS.gold_set_recall}. Upstream fix: ${KNOWN_LIMITS.upstream_fix}.\n`);

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(screened, null, 1));
  console.log(`Wrote ${jsonOut}\n`);
}

await client.close();
