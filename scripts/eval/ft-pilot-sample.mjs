#!/usr/bin/env node

/**
 * Draw one ROUND of the #2880 expanding stratified pilot.
 *
 * RETIRES `ft-pilot-sample-r4.mjs` (deleted in the same commit) — that script
 * hard-coded round 4's output path, its exclusion list and its per-stratum
 * count, so every round needed a new copy. This is the same draw, generalized:
 * the round number is an argument and prior rounds are excluded by reading
 * their manifests off disk. Mechanism budget per #3881 pass 6: one instrument
 * in, one out.
 *
 * THE FRAME (unchanged from rounds 1-4, so samples stay poolable)
 * Pool = books a first-translation claim can even be ABOUT: live (`visible` +
 * `pages_count > 0`), source language not English, and we hold a translation
 * (`pages_translated > 0`). Strata = badged x western/non-western — the two
 * axes that actually moved measured accuracy in rounds 1-4.
 *
 * WHY STRATIFY AT ALL
 * A pure-random draw over this pool is ~36% Latin and ~64% unbadged; its
 * headline would be a Latin-and-unbadged number wearing a corpus label. We
 * sample within strata and weight back to corpus proportions at scoring time
 * (`src/lib/first-translation/inference.ts`, Wilson + finite-population
 * correction).
 *
 * PRE-REGISTRATION (this is the point of drawing the escalation subsets HERE)
 * The round runs three tiers of verification, and the books that go to the
 * expensive tiers are chosen NOW, from a seeded shuffle, before anyone has seen
 * a single result:
 *
 *   tier 1  gemini grounded search   — every book in the draw (the estimator)
 *   tier 2  unprimed Claude subagent — a random slice (the oracle)
 *   tier 3  manual read by Claude    — a random slice OF TIER 2 (the auditor)
 *
 * Tier 3 is a strict subset of tier 2 so all three tiers judge the same books
 * and three-way agreement is measurable. If the escalation sets were chosen
 * after seeing tier-1 output, "the oracle agreed with Gemini" would be a
 * statement about which books we chose to check, not about the instruments.
 *
 * READ-ONLY on the database. Writes a manifest + an ids file.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-pilot-sample.mjs --round=5 \
 *     --targets=badged.western:299,badged.nonwestern:265,unbadged.western:314,unbadged.nonwestern:287 \
 *     --tier2-per=15 --tier3-per=4
 */

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const argVal = (name, dflt) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? dflt;

const ROUND = parseInt(argVal('round', '0'), 10);
if (!ROUND) { console.error('--round=<N> is required'); process.exit(1); }
const PER = parseInt(argVal('per', '0'), 10);
const TIER2_PER = parseInt(argVal('tier2-per', '15'), 10);
const TIER3_PER = parseInt(argVal('tier3-per', '4'), 10);
const SEED = parseInt(argVal('seed', String(20260831 + ROUND)), 10);
const RESULTS_DIR = 'scripts/eval/results';
const DATE = new Date().toISOString().slice(0, 10);
const OUT = argVal('out', `${RESULTS_DIR}/ft-pilot-sample-r${ROUND}-${DATE}.json`);

/**
 * Per-stratum draw sizes, e.g. "badged.western:299,unbadged.non-western:287".
 * Keys are matched on alphanumerics only, so "nonwestern", "non-western" and
 * "non western" all address the same stratum — an unmatched target silently
 * drawing zero books is exactly the kind of quiet miss that invalidates a round.
 */
const strataKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const TARGETS = new Map(
  (argVal('targets', '') || '')
    .split(',').filter(Boolean)
    .map((pair) => {
      const [k, v] = pair.split(':');
      return [strataKey(k), parseInt(v, 10)];
    }),
);

// Region split, verbatim from the rounds 1-4 sampler so strata stay comparable.
const WESTERN = new Set(['latin', 'german', 'french', 'greek', 'ancient greek', 'italian',
  'dutch', 'spanish', 'portuguese', 'russian', 'polish', 'english', 'latin-german',
  'latin-english', 'czech', 'swedish', 'danish', 'hungarian']);
const isWestern = (l) => {
  const n = (l || '').toLowerCase().trim();
  return WESTERN.has(n) || WESTERN.has(n.split(/[-/, ]/)[0]);
};

/** Seeded Fisher-Yates — the draw must be reproducible from the manifest. */
function shuffle(arr, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Every id already judged in an earlier round. Poolability depends on this:
 * re-drawing a book would double-count it in the cumulative estimate.
 */
function priorRoundIds() {
  const ids = new Set();
  if (!fs.existsSync(RESULTS_DIR)) return ids;
  for (const f of fs.readdirSync(RESULTS_DIR)) {
    if (!/^ft-pilot-sample(-r\d+)?-\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
    if (f === path.basename(OUT)) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
    // rounds 1-4 wrote {manifest:[{id}]}; later rounds write {manifest:[{stratum,sampled:[{id}]}]}
    for (const row of doc.manifest ?? []) {
      if (row.id) ids.add(String(row.id));
      for (const b of row.sampled ?? []) if (b.id) ids.add(String(b.id));
    }
  }
  return ids;
}

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const books = client.db('bookstore').collection('books');

const EXCLUDE = priorRoundIds();
console.error(`Excluding ${EXCLUDE.size} ids drawn in earlier rounds.`);

const EN = ['English', 'english', 'en', 'eng'];
const POOL = {
  visible: true,
  pages_count: { $gt: 0 },
  pages_translated: { $gt: 0 },
  language: { $nin: [...EN, null] },
};

const strata = new Map();
let poolN = 0;
const cursor = books.find(POOL, {
  projection: { id: 1, title: 1, author: 1, language: 1, is_first_translation: 1, work_id: 1 },
});
for await (const b of cursor) {
  poolN++;
  const id = String(b.id || b._id);
  if (EXCLUDE.has(id)) continue;
  const key = `${b.is_first_translation === true ? 'badged' : 'unbadged'} | ${isWestern(b.language) ? 'western' : 'non-western'}`;
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push({
    id, title: b.title, author: b.author, language: b.language,
    work_id: b.work_id ?? null,
    badged: b.is_first_translation === true,
    stratum: key,
  });
}

const manifest = [];
const tier2 = [];
const tier3 = [];
const matchedTargets = new Set();
let seed = SEED;
for (const [key, members] of [...strata.entries()].sort()) {
  const target = TARGETS.get(strataKey(key)) ?? PER;
  if (!target) { console.error(`  (no target for "${key}" — skipped)`); continue; }
  matchedTargets.add(strataKey(key));
  const shuffled = shuffle([...members], seed++);
  const sampled = shuffled.slice(0, Math.min(target, shuffled.length));
  // Escalation subsets: pre-registered, tier3 a strict subset of tier2.
  const t2 = sampled.slice(0, Math.min(TIER2_PER, sampled.length));
  const t3 = t2.slice(0, Math.min(TIER3_PER, t2.length));
  const t2ids = new Set(t2.map((b) => b.id));
  const t3ids = new Set(t3.map((b) => b.id));
  for (const b of sampled) {
    b.tier2 = t2ids.has(b.id);
    b.tier3 = t3ids.has(b.id);
  }
  manifest.push({ stratum: key, available: members.length, drawn: sampled.length, sampled });
  tier2.push(...t2); tier3.push(...t3);
}

// A target that matched no stratum means a whole cell drew ZERO books while the
// run still reported success — the round would be silently unstratified. Fail.
const unmatched = [...TARGETS.keys()].filter((k) => !matchedTargets.has(k));
if (unmatched.length) {
  console.error(`\nFATAL: ${unmatched.length} --targets key(s) matched no stratum: ${unmatched.join(', ')}`);
  console.error(`Strata present in the pool: ${[...strata.keys()].sort().join(' / ')}`);
  await client.close();
  process.exit(1);
}

const drawn = manifest.reduce((a, m) => a + m.drawn, 0);
console.error(`\nPool: ${poolN} books`);
for (const m of manifest) {
  console.error(`  ${m.stratum.padEnd(24)} available=${String(m.available).padStart(5)}  drawn=${m.drawn}`);
}
console.error(`\nDrawn this round: ${drawn}`);
console.error(`  tier 2 (unprimed Claude subagent): ${tier2.length}`);
console.error(`  tier 3 (manual read, subset of tier 2): ${tier3.length}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  round: ROUND, built: new Date().toISOString(), seed: SEED,
  pool_definition: 'visible + pages_count>0 + pages_translated>0 + language not English',
  pool_size: poolN, excluded_prior_rounds: EXCLUDE.size,
  drawn, tier2_ids: tier2.map((b) => b.id), tier3_ids: tier3.map((b) => b.id),
  manifest,
}, null, 2));
console.error(`\nManifest: ${OUT}`);

const idsFile = OUT.replace(/\.json$/, '-ids.txt');
fs.writeFileSync(idsFile, manifest.flatMap((m) => m.sampled.map((b) => b.id)).join('\n') + '\n');
console.error(`Ids (for ft-ladder --ids): ${idsFile}`);

await client.close();
