#!/usr/bin/env node
/**
 * Backfill structured `duplicate_of` pointers from prose hidden_reason strings.
 * (#3102, step 1)
 *
 * ~4,900 hidden books carry `hidden_reason: "duplicate of <keeper-id>"` — the
 * dedup knowledge exists but only as free text. This parses the keeper id out,
 * verifies it resolves to a real book, and writes `duplicate_of: <keeper.id>`
 * (the string `id` field, NOT Mongo _id — matching the existing 15
 * fingerprint_duplicate pointers and the id-space the MCP/API layer keys on).
 *
 * Touches NOTHING else: hidden_reason, visible, and hidden stay exactly as
 * they are. Skips docs that already have duplicate_of. Idempotent.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-duplicate-of.mjs             # dry-run
 *   node scripts/maintenance/backfill-duplicate-of.mjs --apply     # write
 *
 * Outputs (both modes) under scripts/output/ (gitignored):
 *   backfill-duplicate-of-report-<date>.ndjson  — one row per source doc
 *   backfill-duplicate-of-backup-<date>.json    — pre-write state of docs
 *                                                  that would be modified
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

const stamp = new Date().toISOString().slice(0, 10);
const outDir = path.join(process.cwd(), 'scripts', 'output');
fs.mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, `backfill-duplicate-of-report-${stamp}.ndjson`);
const backupPath = path.join(outDir, `backfill-duplicate-of-backup-${stamp}.json`);
const report = fs.createWriteStream(reportPath);

// Parse: "duplicate of <target>" with an optional trailing "(title …)" note.
// Targets in the wild are book SLUGS (most) or 24-hex string ids (some).
// Anything else after the prefix is flagged unparseable rather than guessed at.
function parseTarget(reason) {
  const m = /^duplicate of\s+(\S+)(?:\s*\(.*\))?\s*$/i.exec(reason || '');
  return m ? m[1].replace(/[.,;]+$/, '') : null;
}

const cursor = books.find(
  { hidden_reason: /^duplicate of /i, duplicate_of: { $exists: false } },
  { projection: { id: 1, title: 1, hidden_reason: 1, visible: 1, hidden: 1 } }
);

const tally = { scanned: 0, resolved: 0, keeperHidden: 0, notFound: 0, unparseable: 0, selfPointer: 0 };
const writes = [];
const backup = [];
const keeperCache = new Map(); // target id -> keeper doc | null

for await (const doc of cursor) {
  tally.scanned++;
  const target = parseTarget(doc.hidden_reason);
  const row = { _id: String(doc._id), id: doc.id, hidden_reason: doc.hidden_reason, target };

  if (!target) {
    tally.unparseable++;
    report.write(JSON.stringify({ ...row, outcome: 'unparseable' }) + '\n');
    continue;
  }
  if (target === doc.id) {
    tally.selfPointer++;
    report.write(JSON.stringify({ ...row, outcome: 'self-pointer' }) + '\n');
    continue;
  }

  let keeper = keeperCache.get(target);
  if (keeper === undefined) {
    // Prose targets are slugs (most) or string ids; duplicate_of always stores
    // the keeper's stable string `id` (slugs can be renamed).
    keeper = await books.findOne({ $or: [{ slug: target }, { id: target }] }, { projection: { id: 1, visible: 1, hidden: 1 } });
    keeperCache.set(target, keeper);
  }

  if (!keeper) {
    tally.notFound++;
    report.write(JSON.stringify({ ...row, outcome: 'keeper-not-found' }) + '\n');
    continue;
  }

  // Keeper exists — pointer is valid regardless of keeper visibility, but a
  // hidden keeper means the whole cluster is dark; flag it for the orphan queue.
  const outcome = keeper.visible ? 'resolved' : 'resolved-keeper-hidden';
  if (keeper.visible) tally.resolved++; else tally.keeperHidden++;
  report.write(JSON.stringify({ ...row, outcome }) + '\n');
  backup.push({ _id: String(doc._id), id: doc.id, hidden_reason: doc.hidden_reason });
  writes.push({ updateOne: { filter: { _id: doc._id, duplicate_of: { $exists: false } }, update: { $set: { duplicate_of: keeper.id } } } });
}
report.end();
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 1));

console.log(`scanned ${tally.scanned} | would-write ${writes.length} (visible keeper ${tally.resolved}, hidden keeper ${tally.keeperHidden})`);
console.log(`skipped: keeper-not-found ${tally.notFound}, unparseable ${tally.unparseable}, self-pointer ${tally.selfPointer}`);
console.log(`report  -> ${reportPath}`);
console.log(`backup  -> ${backupPath}`);

if (!APPLY) {
  console.log('\nDRY RUN — no writes. Re-run with --apply to set duplicate_of.');
} else if (writes.length) {
  let modified = 0;
  for (let i = 0; i < writes.length; i += 1000) {
    const r = await books.bulkWrite(writes.slice(i, i + 1000), { ordered: false });
    modified += r.modifiedCount;
  }
  console.log(`\nAPPLIED: modified ${modified} of ${writes.length} planned`);
  const remaining = await books.countDocuments({ hidden_reason: /^duplicate of /i, duplicate_of: { $exists: false } });
  console.log(`verify: prose-duplicate docs still missing duplicate_of: ${remaining} (parse-skips expected)`);
}
await mc.close();
