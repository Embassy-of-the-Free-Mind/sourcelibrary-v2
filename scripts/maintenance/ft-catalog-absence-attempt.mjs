#!/usr/bin/env node
/**
 * ft-catalog-absence-attempt.mjs — record the catalog-family ABSENCE vote
 * (#2933 Tier-2 restore path).
 *
 * A Tier-2 agent refutation alone grades `first_no_prior` with `weak` evidence
 * (single family), which the promotion hygiene gate rightly refuses to badge.
 * The designed second vote is a catalog-family membership test: we hold a ~24K-row
 * `translation_catalogs` registry of KNOWN English translations — if a book has
 * NO candidate row there even at the LOOSE match level (author surname + any
 * title-token containment), that bounded negative is durable absence evidence.
 *
 * Counterpart to scripts/eval/ft-catalog-match.mjs, which records FOUND matches;
 * this records the misses. Books with ANY loose candidate are SKIPPED (ambiguous
 * — the match pass owns those), so this can never contradict a found row.
 *
 * Never writes a verdict or flips a flag; only appends `result:'none'` attempts
 * (method tier1_catalog → catalog family in attemptFamily()).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ft-catalog-absence-attempt.mjs --ids=<file>          # dry-run
 *   node scripts/maintenance/ft-catalog-absence-attempt.mjs --ids=<file> --apply
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const IDS_FILE = process.argv.find((a) => a.startsWith('--ids='))?.split('=')[1];
if (!IDS_FILE || !fs.existsSync(IDS_FILE)) {
  console.error('usage: ft-catalog-absence-attempt.mjs --ids=<newline-separated book ids> [--apply]');
  process.exit(1);
}
const ids = fs.readFileSync(IDS_FILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

// ── matching (mirrors ft-catalog-match.mjs loose level) ──────────────────────
const normalise = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the','and','with','from','that','this','for','are','was','been','have','has','its','into','upon','also','very','more','some','such','than','being','over','both','each','only','english','translation','translated','works','text','liber','libri','opus','opera','book','books','volume','tractatus']);
const sigTokens = (s) => normalise(s).split(/\s+/).filter((t) => t.length >= 4 && !STOP.has(t));
const surname = (a) => {
  const n = normalise(a);
  if (!n) return '';
  return n.includes(',') ? n.split(/\s+/)[0] : n.split(/\s+/).pop();
};

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const registry = db.collection('translation_catalogs');
const attempts = db.collection('first_translation_attempts');

const catalog = await registry.find({}, { projection: { english_title: 1, canonical_work: 1, author: 1, author_normalized: 1 } }).toArray();
console.log(`registry rows loaded: ${catalog.length}; books to check: ${ids.length}`);

const date = new Date().toISOString().slice(0, 10);
let absent = 0, ambiguous = 0, missing = 0, already = 0;
for (const id of ids) {
  const b = await books.findOne({ id }, { projection: { id: 1, title: 1, author: 1, language: 1 } });
  if (!b) { missing++; console.log(`  MISSING book ${id}`); continue; }
  const sn = surname(b.author);
  // Prefix-match the surname (first 5 chars) so a spelling variant in either
  // field ("Ficini"/"Ficino", latinized endings) cannot fabricate an absence.
  const snPrefix = sn.slice(0, 5);
  const bt = new Set(sigTokens(b.title));
  // loose candidate: author-surname (prefix) appears in the row's author AND
  // any significant title token overlaps
  const candidates = catalog.filter((r) => {
    const ra = normalise(`${r.author ?? ''} ${r.author_normalized ?? ''}`);
    if (!snPrefix || snPrefix.length < 3 || !ra.includes(snPrefix)) return false;
    const rt = sigTokens(`${r.english_title ?? ''} ${r.canonical_work ?? ''}`);
    return rt.some((t) => bt.has(t));
  });
  if (candidates.length > 0) { ambiguous++; console.log(`  skip (has ${candidates.length} loose candidate(s)): ${b.title?.slice(0, 60)}`); continue; }

  const attempt_id = `${id}:tier1_catalog_absence:${date}`;
  if (await attempts.findOne({ attempt_id })) { already++; continue; }
  absent++;
  console.log(`  ABSENT in registry: ${b.title?.slice(0, 70)} (${b.author ?? '?'})`);
  if (APPLY) {
    await attempts.insertOne({
      attempt_id,
      book_id: id,
      date: new Date().toISOString(),
      method: 'tier1_catalog',
      match_key: 'author_title',
      sources_checked: ['translation_catalogs'],
      queries: [`surname:${sn} + title-token containment over ${catalog.length} registry rows`],
      result: 'none',
      evidence_strength: 'weak',
      independence_score: 0.5,
      notes: `[catalog-absence ${date}] no loose candidate (author-surname + any title token) in translation_catalogs`,
      _src: 'ft-catalog-absence-attempt',
    });
  }
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: absence attempts ${absent}, skipped-ambiguous ${ambiguous}, already-recorded ${already}, missing books ${missing}`);
await mc.close();
