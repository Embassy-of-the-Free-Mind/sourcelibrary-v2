#!/usr/bin/env node
/**
 * Regenerate the measured block in ARCHITECTURE.md.
 *
 *   node scripts/audit/architecture-stats.mjs           # print, change nothing
 *   node scripts/audit/architecture-stats.mjs --apply   # rewrite the block in place
 *
 * ## Why this exists
 *
 * `ARCHITECTURE.md` is the document a human opens first, and on 2026-08-08 it
 * had gone **eight months** without a commit while saying the corpus was
 * "primarily pre-1650 works" and that page images live in MongoDB. Neither had
 * been true for a long time.
 *
 * The agent-facing tier next door did not rot, and the reason is structural: an
 * invariant is anchored to an incident, and incidents do not change. An overview
 * is full of counts, and counts change weekly. `doc-staleness.mjs` checks the
 * auto-loaded agent files for exactly this and does not look at the repo root —
 * so the human entry point rotted invisibly, by design.
 *
 * The durable fix is not vigilance. It is to stop typing the numbers: everything
 * between the STATS markers is generated from the live database, so re-running
 * this is the whole maintenance burden.
 *
 * Prose outside the markers is written by hand and this script never touches it.
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = join(ROOT, 'ARCHITECTURE.md');
const BEGIN = '<!-- STATS:BEGIN -->';
const END = '<!-- STATS:END -->';

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const B = db.collection('books');

const [total, visible, withPages, ocrd, translated, live, pages, entities, collections] = await Promise.all([
  B.countDocuments({}),
  B.countDocuments({ visible: true }),
  B.countDocuments({ pages_count: { $gt: 0 } }),
  B.countDocuments({ pages_ocr: { $gt: 0 } }),
  B.countDocuments({ pages_translated: { $gt: 0 } }),
  B.countDocuments({ visible: true, pages_count: { $gt: 0 } }),
  db.collection('pages').estimatedDocumentCount(),
  db.collection('entities').estimatedDocumentCount(),
  db.collection('collections').countDocuments({}),
]);

const langs = await B.aggregate([
  { $match: { visible: true, pages_count: { $gt: 0 } } },
  { $group: { _id: '$language', n: { $sum: 1 } } },
  { $sort: { n: -1 } }, { $limit: 6 },
]).toArray();

const n = (x) => x.toLocaleString('en-US');
const today = new Date().toISOString().slice(0, 10);

const block = `${BEGIN}
*Measured ${today} against production. Regenerate with \`node scripts/audit/architecture-stats.mjs --apply\` — do not hand-edit, and do not quote these elsewhere without re-measuring.*

| | count | what it means |
|---|---|---|
| Books, all records | ${n(total)} | includes acquisition candidates and unprocessed imports |
| — with page images | ${n(withPages)} | the scan actually arrived |
| — with OCR | ${n(ocrd)} | at least one page has been read |
| — with translation | ${n(translated)} | at least one page has been translated |
| — publicly listed | ${n(visible)} | \`visible: true\` |
| **— live** | **${n(live)}** | **\`visible: true\` AND \`pages_count > 0\` — the canonical "readable" filter** |
| Pages | ${n(pages)} | one document per leaf |
| Entities | ${n(entities)} | people, places and things extracted from the text |
| Collections | ${n(collections)} | curated groupings |

Most-held languages among live books: ${langs.map((l) => `${l._id} ${n(l.n)}`).join(' · ')}.

**The gap between ${n(total)} and ${n(live)} is the system**, not a defect: a book is acquired long before it is readable, and each stage below moves some of that difference.
${END}`;

if (!APPLY) {
  console.log(block);
  console.log('\n(dry run — pass --apply to write into ARCHITECTURE.md)');
  await client.close();
  process.exit(0);
}

const doc = readFileSync(DOC, 'utf8');
const start = doc.indexOf(BEGIN);
const stop = doc.indexOf(END);
if (start === -1 || stop === -1) {
  console.error(`markers not found in ${DOC} — add ${BEGIN} / ${END} first`);
  process.exit(1);
}
writeFileSync(DOC, doc.slice(0, start) + block + doc.slice(stop + END.length));
console.log(`rewrote the measured block in ARCHITECTURE.md (${today})`);
await client.close();
