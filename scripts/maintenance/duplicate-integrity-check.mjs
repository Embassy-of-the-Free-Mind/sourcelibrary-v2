#!/usr/bin/env node
/**
 * Duplicate-relation integrity check (#3102, step 5).
 *
 * Read-only. Validates the `duplicate_of` graph and reports the metrics that
 * should trend down as dedup machinery matures:
 *
 *   1. orphan pointers      — duplicate_of targets that no longer resolve to a
 *                             book `id` (keeper deleted or id changed)
 *   2. hidden keepers       — pointer target exists but isn't visible, split
 *                             into chains (keeper itself has duplicate_of —
 *                             mechanically flattenable) vs keeper hidden for
 *                             some other reason (needs a human)
 *   3. prose tail           — hidden_reason mentions "duplicate" but no
 *                             structured duplicate_of pointer (bucketed)
 *   4. flag inconsistency   — VISIBLE books carrying a duplicate hidden_reason
 *   5. both-visible same-edition clusters — normalized title+author+year with
 *                             >1 visible copy (the reader-facing metric;
 *                             baseline 270 clusters / ~460 extra books,
 *                             measured 2026-07-09 on #3102)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/duplicate-integrity-check.mjs           # report
 *   node scripts/maintenance/duplicate-integrity-check.mjs --strict  # exit 1
 *                                          # if orphans or flag drift exist
 *   node scripts/maintenance/duplicate-integrity-check.mjs --json    # summary
 *                                          # as one JSON line (for crons)
 *
 * Detail rows land in scripts/output/duplicate-integrity-<date>.ndjson.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

const stamp = new Date().toISOString().slice(0, 10);
const outDir = path.join(process.cwd(), 'scripts', 'output');
fs.mkdirSync(outDir, { recursive: true });
const detailPath = path.join(outDir, `duplicate-integrity-${stamp}.ndjson`);
const detail = fs.createWriteStream(detailPath);
const row = (obj) => detail.write(JSON.stringify(obj) + '\n');

// ---- 1+2: pointer graph ----------------------------------------------------
const holders = await books
  .find({ duplicate_of: { $exists: true } }, { projection: { id: 1, duplicate_of: 1, visible: 1 } })
  .toArray();
const targetIds = [...new Set(holders.map((h) => String(h.duplicate_of)))];

const keepers = new Map();
for (let i = 0; i < targetIds.length; i += 500) {
  const chunk = targetIds.slice(i, i + 500);
  const docs = await books
    .find({ id: { $in: chunk } }, { projection: { id: 1, slug: 1, title: 1, visible: 1, duplicate_of: 1 } })
    .toArray();
  for (const d of docs) keepers.set(d.id, d);
}

const orphanTargets = targetIds.filter((t) => !keepers.has(t));
// Orphans may be soft-deleted (restorable) — say which.
const deletedBooks = db.collection('deleted_books');
const softDeleted = new Set();
for (let i = 0; i < orphanTargets.length; i += 500) {
  const chunk = orphanTargets.slice(i, i + 500);
  const docs = await deletedBooks.find({ id: { $in: chunk } }, { projection: { id: 1 } }).toArray();
  for (const d of docs) softDeleted.add(d.id);
}

let pointersToOrphans = 0;
let chainPointers = 0; // keeper itself points at another keeper — flattenable
let hiddenKeeperPointers = 0; // keeper hidden, no onward pointer — human call
for (const h of holders) {
  const keeper = keepers.get(String(h.duplicate_of));
  if (!keeper) {
    pointersToOrphans++;
    row({ check: 'orphan-pointer', id: h.id, target: h.duplicate_of, targetSoftDeleted: softDeleted.has(String(h.duplicate_of)) });
  } else if (keeper.visible !== true) {
    if (keeper.duplicate_of) {
      chainPointers++;
      row({ check: 'chain', id: h.id, keeper: keeper.id, keeperPointsAt: keeper.duplicate_of });
    } else {
      hiddenKeeperPointers++;
      row({ check: 'hidden-keeper', id: h.id, keeper: keeper.id, keeperSlug: keeper.slug, keeperTitle: keeper.title });
    }
  }
}

// ---- 3: prose tail ---------------------------------------------------------
const tail = await books
  .find(
    { hidden_reason: /duplicate/i, duplicate_of: { $exists: false } },
    { projection: { id: 1, slug: 1, hidden_reason: 1, visible: 1 } }
  )
  .toArray();
const tailBuckets = {};
for (const b of tail) {
  const hr = String(b.hidden_reason);
  const key = /^duplicate of\s/i.test(hr) ? 'duplicate-of-<unresolvable-ref>' : hr.slice(0, 40);
  tailBuckets[key] = (tailBuckets[key] || 0) + 1;
  row({ check: 'prose-tail', id: b.id, hidden_reason: hr.slice(0, 120) });
}

// ---- 4: visible books flagged as duplicates --------------------------------
const visibleFlagged = await books
  .find({ hidden_reason: /duplicate/i, visible: true }, { projection: { id: 1, slug: 1, hidden_reason: 1 } })
  .toArray();
for (const b of visibleFlagged) row({ check: 'visible-with-dupe-reason', id: b.id, slug: b.slug, hidden_reason: b.hidden_reason });

// ---- 5: both-visible same-edition clusters ---------------------------------
// Same normalization spirit as src/lib/dedup.ts normalizeTitle/normalizeAuthor
// (trend metric — approximate by design; books only, artworks have their own
// sha1/CLIP lane).
const normTitle = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|el|los|las)\s+/, '')
    .replace(/\s*[([:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[)\]]?\s*$/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const surname = (a) => {
  const s = String(a || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\([\d\s\-–,?.]+\)\s*/g, '')
    .replace(/[^\w\s,]/g, '')
    .trim();
  if (!s) return '';
  return s.includes(',') ? s.split(',')[0].trim() : s.split(/\s+/).pop();
};

// Volume-aware: normTitle strips "vol. N" markers, so two volumes of one set
// collapse to the same title — extract the volume from the RAW title (mjs port
// of src/lib/dedup.ts extractVolume) so they key apart instead of reading as
// duplicate copies.
const LATIN_ORDINALS = { primus: 1, secundus: 2, tertius: 3, quartus: 4, quintus: 5, sextus: 6, septimus: 7, octavus: 8, nonus: 9, decimus: 10, prima: 1, secunda: 2, tertia: 3, quarta: 4, quinta: 5, sexta: 6, septima: 7, octava: 8, nona: 9, decima: 10 };
const romanToInt = (s) => {
  const vals = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let out = 0;
  for (let i = 0; i < s.length; i++) {
    const v = vals[s[i]];
    if (!v) return null;
    out += v < (vals[s[i + 1]] || 0) ? -v : v;
  }
  return out;
};
const extractVolume = (title) => {
  if (!title) return null;
  const t = String(title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const KW = '(?:vol(?:ume)?|tom(?:us|o|e)?|band|part|pt|liber|deel|teil)\\.?\\s*\\(?\\s*';
  let m = t.match(new RegExp(`\\b${KW}(\\d{1,3})\\b`));
  if (m) return parseInt(m[1], 10);
  m = t.match(new RegExp(`\\b${KW}(${Object.keys(LATIN_ORDINALS).join('|')})\\b`));
  if (m) return LATIN_ORDINALS[m[1]] ?? null;
  m = t.match(new RegExp(`\\b${KW}([ivxlcdm]{1,6})\\b`));
  if (m) return romanToInt(m[1]);
  return null;
};

const visible = books.find(
  { visible: true, content_type: { $ne: 'artwork' } },
  { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1 } }
);
const clusters = new Map();
for await (const b of visible) {
  const t = normTitle(b.title);
  if (!t) continue;
  const year = typeof b.year === 'number' && b.year > 0
    ? b.year
    : (String(b.published || '').match(/\b(\d{3,4})\b/) || [])[1] ?? '';
  const vol = extractVolume(b.display_title) ?? extractVolume(b.title) ?? '';
  const key = `${t}|${surname(b.author)}|${year}|v${vol}`;
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push({ id: b.id, slug: b.slug });
}
let editionClusters = 0;
let extraVisibleCopies = 0;
for (const [key, members] of clusters) {
  if (members.length < 2) continue;
  editionClusters++;
  extraVisibleCopies += members.length - 1;
  row({ check: 'both-visible-same-edition', key, members: members.map((m) => m.id) });
}

detail.end();

const summary = {
  date: stamp,
  pointers: holders.length,
  distinctKeepers: targetIds.length,
  orphanTargets: orphanTargets.length,
  orphanTargetsSoftDeleted: softDeleted.size,
  pointersToOrphans,
  chainPointers,
  hiddenKeeperPointers,
  proseTail: tail.length,
  proseTailBuckets: tailBuckets,
  visibleWithDupeReason: visibleFlagged.length,
  bothVisibleSameEditionClusters: editionClusters,
  extraVisibleCopies,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary));
} else {
  console.log('duplicate-relation integrity —', stamp);
  console.log(`  pointers: ${summary.pointers} (→ ${summary.distinctKeepers} keepers)`);
  console.log(`  orphan keepers: ${summary.orphanTargets} (${summary.orphanTargetsSoftDeleted} soft-deleted; ${summary.pointersToOrphans} pointers affected)`);
  console.log(`  chains (keeper→keeper, flattenable): ${summary.chainPointers}`);
  console.log(`  hidden keepers (cluster dark, human call): ${summary.hiddenKeeperPointers}`);
  console.log(`  prose tail (no pointer): ${summary.proseTail} ${JSON.stringify(tailBuckets)}`);
  console.log(`  VISIBLE books with dupe hidden_reason: ${summary.visibleWithDupeReason}`);
  console.log(`  both-visible same-edition clusters: ${summary.bothVisibleSameEditionClusters} (+${summary.extraVisibleCopies} extra copies; baseline 270/+460 on 2026-07-09)`);
  console.log(`  detail -> ${detailPath}`);
}

await mc.close();
if (STRICT && (summary.pointersToOrphans > 0 || summary.visibleWithDupeReason > 0)) process.exit(1);
