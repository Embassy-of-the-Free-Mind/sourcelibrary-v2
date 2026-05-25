#!/usr/bin/env node
/**
 * Triage helper for the 167 UBN-collision records logged during the
 * 2026-05-25 BPH Memorix sync (Step 4 of PR #1975).
 *
 * Background:
 *   Memorix's XML has 163 duplicate UBNs upstream — the same UBN appears
 *   under two different UUIDs. Our `bph_works.ubn` has UNIQUE (required by
 *   the FK from bph_works_revisions), so 167 of the 467 "new printed" rows
 *   would have tripped a unique-constraint violation. Per Derek's call
 *   during the apply, we skipped them and logged the conflicts to:
 *
 *     .claude/docs/bph-memorix-step4-ubn-collisions-2026-05-19.json
 *
 *   This script reads that log, pulls the DB title for each conflicting
 *   row, computes title similarity, and emits a TSV that a librarian
 *   (Jose / Paul / a curator) can edit to decide per UBN.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/bph-memorix-ubn-collision-triage.mjs \
 *     > .claude/docs/bph-memorix-ubn-collision-triage.tsv
 *
 *   # Then open the TSV in a spreadsheet, fill in the `decision` column
 *   # (merge / replace / split / leave), and pass to the apply helper
 *   # (a separate follow-up — not included here, awaits design).
 *
 * Output columns (TSV — tab-separated so titles with commas survive):
 *   ubn                  — the colliding UBN
 *   xml_uuid             — UUID of the Memorix record we skipped
 *   db_uuid              — UUID of the existing DB row that won the UBN
 *   xml_title            — title from the Memorix XML
 *   db_title             — title currently in bph_works under that UBN
 *   title_similarity     — 0.0–1.0 (Jaccard over normalized tokens)
 *   recommendation       — auto-classified: "merge" / "review" / "different"
 *   decision             — left blank for the librarian
 *   notes                — left blank for the librarian
 *
 * Issue: #1992
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    'input': { type: 'string', default: '.claude/docs/bph-memorix-step4-ubn-collisions-2026-05-19.json' },
    'help': { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(readFileSync(import.meta.filename, 'utf8').split('\n').slice(1, 45).join('\n').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ---------- Load the collision log ----------
const log = JSON.parse(readFileSync(args.input, 'utf8'));
const collisions = log.collisions;
process.stderr.write(`Loaded ${collisions.length} collisions from ${args.input}\n`);

// ---------- Fetch DB titles in bulk (chunked uuid IN-list) ----------
const dbUuids = [...new Set(collisions.map(c => c.existingDbUuid))];
const titleByUuid = new Map();
const CHUNK = 100;
for (let i = 0; i < dbUuids.length; i += CHUNK) {
  const slice = dbUuids.slice(i, i + CHUNK).map(encodeURIComponent).join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bph_works?select=uuid,title,parallel_title,uniform_title&uuid=in.(${slice})`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Supabase fetch failed: ${res.status} ${txt.slice(0, 200)}`);
    process.exit(1);
  }
  const rows = await res.json();
  for (const r of rows) {
    titleByUuid.set(r.uuid, r.title || r.parallel_title || r.uniform_title || '');
  }
  process.stderr.write(`  fetched ${Math.min(i + CHUNK, dbUuids.length)}/${dbUuids.length} db titles\r`);
}
process.stderr.write('\n');

// ---------- Title similarity (Jaccard over normalized tokens) ----------
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // strip punctuation
    .split(/\s+/)
    .filter(t => t.length >= 2); // drop 1-char fragments + empties
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'and', 'or', 'on', 'at', 'to', 'for',
  'with', 'by', 'as', 'is', 'das', 'der', 'die', 'des', 'den', 'dem',
  'de', 'la', 'le', 'les', 'un', 'une', 'du', 'et', 'en', 'il', 'lo',
  'van', 'op', 'het', 'om', 'naar', 'uit',
]);

function jaccard(a, b) {
  const A = new Set(normalize(a).filter(t => !STOPWORDS.has(t)));
  const B = new Set(normalize(b).filter(t => !STOPWORDS.has(t)));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

// Hand-classified thresholds — empirically these capture "same work" cases
// well in the 91 same-title sample and flag the 76 different-title cases.
function recommend(sim) {
  if (sim >= 0.85) return 'merge';      // nearly identical titles
  if (sim >= 0.55) return 'review';     // shared core tokens, may be same work with expanded title
  return 'different';                   // disjoint token sets, very likely different works
}

// ---------- Emit TSV ----------
const rows = [];
const counts = { merge: 0, review: 0, different: 0 };
for (const c of collisions) {
  const dbTitle = titleByUuid.get(c.existingDbUuid) || '';
  const sim = jaccard(c.title, dbTitle);
  const rec = recommend(sim);
  counts[rec]++;
  rows.push({
    ubn: c.ubn,
    xml_uuid: c.xmlUuid,
    db_uuid: c.existingDbUuid,
    xml_title: c.title,
    db_title: dbTitle,
    title_similarity: sim.toFixed(2),
    recommendation: rec,
    decision: '',
    notes: '',
  });
}

const HEADERS = ['ubn', 'xml_uuid', 'db_uuid', 'xml_title', 'db_title', 'title_similarity', 'recommendation', 'decision', 'notes'];
console.log(HEADERS.join('\t'));
// Sort by recommendation (review first so the librarian sees the ambiguous ones)
// then by similarity ascending within each bucket so the most uncertain land at the top.
const order = { review: 0, different: 1, merge: 2 };
rows.sort((a, b) => {
  const r = order[a.recommendation] - order[b.recommendation];
  if (r !== 0) return r;
  return parseFloat(a.title_similarity) - parseFloat(b.title_similarity);
});
for (const r of rows) {
  console.log(HEADERS.map(h => String(r[h]).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'));
}

// ---------- Summary to stderr (so it doesn't pollute the TSV) ----------
process.stderr.write(`\nSummary:\n`);
process.stderr.write(`  recommend MERGE     (sim ≥ 0.85): ${counts.merge}\n`);
process.stderr.write(`  recommend REVIEW    (0.55 ≤ sim < 0.85): ${counts.review}\n`);
process.stderr.write(`  recommend DIFFERENT (sim < 0.55): ${counts.different}\n`);
process.stderr.write(`  total: ${rows.length}\n`);
process.stderr.write(`\nNext: open the TSV in a spreadsheet, fill the 'decision' column with one of:\n`);
process.stderr.write(`  merge   — replace the old DB uuid with the XML uuid; keep the existing row\n`);
process.stderr.write(`  replace — delete the old DB row, insert the XML record fresh\n`);
process.stderr.write(`  split   — both are valid; needs schema change (drop UNIQUE on ubn)\n`);
process.stderr.write(`  leave   — DB is correct; XML row is upstream noise, skip the import\n`);
