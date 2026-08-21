#!/usr/bin/env node
/**
 * Draw a BLINDED, within-book matched sample for the repeat-instability study.
 * Design and predictions: scripts/eval/PREREGISTRATION-repeat-instability.md (#3473).
 *
 * The question: pages where the same model + same prompt read the same leaf
 * twice and DISAGREED — are they visibly harder to read than pages the same
 * book transcribed stably? If yes, repeat instability is a deployable page
 * quality signal and needs no ground truth to be useful.
 *
 * Matching is WITHIN BOOK on purpose. Across books, "harder" would be confounded
 * by language, typeface, era and scan source all at once; within a book those
 * are held constant and only the page varies.
 *
 * Blinding is the point of this script. Images land under opaque names with arm
 * assignment randomised per pair, and the key goes to a SEPARATE file that the
 * judge must not open until every verdict is written down. A study whose judge
 * can see the arm is an impression, not a test.
 *
 * Reads the per-pair JSONL from revision-agreement-corpus.mjs. Free — Mongo +
 * local only, no model calls.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/repeat-instability-draw.mjs <corpus.jsonl> --out=DIR [--pairs=12] [--seed=7]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { rowIsMaintenance } from './lib/revision-source.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const JSONL = process.argv.slice(2).find(a => !a.startsWith('--'));
const OUT = args.out || './repeat-instability';
const PAIRS = parseInt(args.pairs || '12');
const UNSTABLE_MAX = parseFloat(args['unstable-max'] || '0.85');
const STABLE_MIN = parseFloat(args['stable-min'] || '0.97');
const MIN_WORDS = parseInt(args['min-words'] || '80');

// Deterministic RNG — the draw must be reproducible from the seed alone, and
// Math.random() is unavailable in some of this repo's runners anyway.
let seed = parseInt(args.seed || '7');
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

async function main() {
  if (!JSONL || !fs.existsSync(JSONL)) throw new Error('pass the corpus JSONL path');
  fs.mkdirSync(OUT, { recursive: true });

  // ── select the true-repeat population ────────────────────────────
  const byBook = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL) });
  for await (const line of rl) {
    const x = JSON.parse(line);
    if (x.eligibility !== 'eligible') continue;
    // A bulk maintenance sweep (e.g. shift-repair-erara-2026-07) writes a
    // revision for every page it relocates, so the pair holds two DIFFERENT
    // pages' text and nothing was re-read. The stored `source` label says so
    // directly, and unlike `leaf_shift` it also classifies pairs that print no
    // page number (#3473). Checked FIRST because it is the stronger test.
    if (rowIsMaintenance(x)) continue;
    if (x.leaf_shift !== false) continue;                       // same leaf only
    if (!x.prior_model || x.prior_model !== x.current_model) continue;
    if (!x.prior_prompt || x.prior_prompt !== x.current_prompt) continue;
    // Model failures, not page difficulty. Including them would confirm the
    // hypothesis for the wrong reason.
    if (x.prior_degenerate || x.current_degenerate) continue;
    if (x.prior_refusal || x.current_refusal) continue;
    if (x.prior_meta || x.current_meta) continue;
    if (x.near_zero_overlap) continue;
    if (Math.min(x.body_words_prior, x.body_words_current) < MIN_WORDS) continue;
    const arm = x.agreement_primary < UNSTABLE_MAX ? 'unstable'
      : x.agreement_primary >= STABLE_MIN ? 'stable' : null;
    if (!arm) continue;
    if (!byBook.has(x.book_id)) byBook.set(x.book_id, { unstable: [], stable: [], slug: x.book_slug, language: x.language, year: x.year });
    byBook.get(x.book_id)[arm].push(x);
  }

  const eligible = [...byBook.entries()].filter(([, v]) => v.unstable.length && v.stable.length);
  console.log(`books with BOTH arms: ${eligible.length}`);
  if (eligible.length < PAIRS) console.log(`  (only ${eligible.length} available — drawing that many)`);

  // One pair per book, so no single book dominates the sample.
  const shuffled = eligible.map(e => [rand(), e]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
  const chosen = shuffled.slice(0, PAIRS).map(([book_id, v]) => ({
    book_id, slug: v.slug, language: v.language, year: v.year,
    unstable: v.unstable[Math.floor(rand() * v.unstable.length)],
    stable: v.stable[Math.floor(rand() * v.stable.length)],
  }));

  // ── resolve images ───────────────────────────────────────────────
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const ids = chosen.flatMap(p => [p.unstable.page_id, p.stable.page_id]);
  const pages = await db.collection('pages').find({ id: { $in: ids } },
    { projection: { id: 1, page_number: 1, display_photo: 1, archived_photo: 1, photo: 1 } }).toArray();
  await c.close();
  const imgById = new Map(pages.map(p => [p.id, p.display_photo || p.archived_photo || p.photo]));

  // ── write blinded manifest + key ─────────────────────────────────
  const manifest = [], key = [];
  for (let i = 0; i < chosen.length; i++) {
    const p = chosen[i];
    const tag = String(i + 1).padStart(2, '0');
    const flip = rand() < 0.5;                     // which arm gets label A
    const A = flip ? p.unstable : p.stable;
    const B = flip ? p.stable : p.unstable;
    for (const [label, row] of [['A', A], ['B', B]]) {
      const url = imgById.get(row.page_id);
      if (!url) { console.log(`  pair ${tag} ${label}: NO IMAGE, skipping pair`); continue; }
      const file = path.join(OUT, `page-${tag}-${label}.jpg`);
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) { console.log(`  pair ${tag} ${label}: HTTP ${res.status}`); continue; }
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    manifest.push({ pair: tag, a: `page-${tag}-A.jpg`, b: `page-${tag}-B.jpg` });
    key.push({
      pair: tag, book: p.slug, language: p.language, year: p.year,
      A_arm: flip ? 'unstable' : 'stable', B_arm: flip ? 'stable' : 'unstable',
      unstable_page_id: p.unstable.page_id, unstable_agreement: p.unstable.agreement_primary,
      stable_page_id: p.stable.page_id, stable_agreement: p.stable.agreement_primary,
    });
    console.log(`  pair ${tag}: ${p.slug?.slice(0, 44)}`);
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    design: 'scripts/eval/PREREGISTRATION-repeat-instability.md',
    seed: parseInt(args.seed || '7'), pairs: manifest.length,
    thresholds: { unstable_max: UNSTABLE_MAX, stable_min: STABLE_MIN, min_body_words: MIN_WORDS },
    task: 'For each pair, looking ONLY at the images: which page is harder to read? A / B / indistinguishable. Record a reason. Write every verdict to verdicts.json BEFORE opening key.json.',
    manifest,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 2));
  console.log(`\n${manifest.length} pairs → ${OUT}`);
  console.log(`  manifest.json (blinded)   key.json (DO NOT OPEN until verdicts.json is written)`);
}

main().catch(e => { console.error(e); process.exit(1); });
