#!/usr/bin/env node
/**
 * ft-work-registry-pilot.mjs — the work-grain pilot (#3881 north star, phase 1
 * in miniature).
 *
 * THE IDEA UNDER TEST: a first-translation fact belongs to a WORK, not a book.
 * This pilot materializes `work_translation_history` for ~20 works whose facts
 * are ALREADY verified (resolver tier2_agent/human — no new verification, no
 * new spend), then measures what the work-grain model delivers:
 *
 *   fan-out       how many books one verified fact resolves (test 1: >1.5)
 *   consistency   sibling editions that disagree on the badge TODAY, and what
 *                 the join would render instead (test 2: 0 after)
 *   legibility    each entry is a citable sentence a reader could check
 *
 * SAFE BY CONSTRUCTION: writes only the new `work_translation_history`
 * collection, which NOTHING reads yet — no cron, no render path, no derive.
 * (The #3776 rule: before writing to a store, ask what reads it and when it
 * next runs. Answer: nothing, never — until a reviewed PR wires the join.)
 * Dry-run by default; --apply writes; --wipe-pilot removes pilot docs.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/eval/ft-work-registry-pilot.mjs                     # pilot cast, report only
 *   node --env-file=.env.production.local scripts/eval/ft-work-registry-pilot.mjs --apply             # seed the pilot cast
 *   node --env-file=.env.production.local scripts/eval/ft-work-registry-pilot.mjs --all-verified --apply   # phase 1: EVERY verified-layer work
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const APPLY = process.argv.includes('--apply');
const WIPE = process.argv.includes('--wipe-pilot');
const ALL_VERIFIED = process.argv.includes('--all-verified');
const NOW = new Date().toISOString();

/**
 * The pilot cast: verified-layer works chosen for spread (every verdict class,
 * famous + obscure, consistent + currently-contradicting siblings). All carry
 * resolver tier2_agent or human. Chosen 2026-08-11 from the verified layer;
 * see the probe in the #3881 thread.
 */
const PILOT_WORKS = [
  'Q4071312',        // Pymander (Corpus Hermeticum) — not_first (Everard 1650): the flagship example
  'Q134480351',      // Diamond Sutra — first_modern
  'Q28051283',       // Kabbala denudata — first_complete
  'Q18643682',       // Averroes, Colliget — first_no_prior
  'Q138752489',      // Boethius, Consolatione — not_first
  'Q3142427',        // Directorium Inquisitorum — first_no_prior
  'Q2888551',        // De Natura Stirpium — first_no_prior
  'Q318333',         // Daphnis & Chloe — not_first (Loeb parallel text)
  'Q3359785',        // Iamblichus De Mysteriis — not_first
  'Q20949806',       // Apianus, Cosmographicus Liber — siblings DISAGREE today
  'Q1232238',        // Vitruvius teutsch — first_no_prior
  'Q116742463',      // Speculum vitae humanae — first_no_prior
  'zohar',           // Zohar — 10 sibling books, siblings DISAGREE today
  'local:a:micha-sedziwoj:alchemy-light',  // Sendivogius, De Lapide Philosophorum — siblings DISAGREE
  'local:a:dante-alighieri:alessandro-christoforo-con-espositione-et-landino-vellutello', // Landino Commedia — DISAGREE
  'local:a:johann-salomo-semler:collections-history-impartial-rosicrucians', // Semler — DISAGREE
  'symbolum-physicochymicum-henrici-khunrath-lips-de-chao-physi-khunrath',   // Khunrath — DISAGREE
  'Q124745278',      // Catena aurea — not_first
  'Q1943729',        // Fries, Systema Mycologicum — first_no_prior
  'Q42190830',       // Brunfels, Herbarum Vivae Eicones — first_no_prior
];

const VERDICT_TO_STATUS = {
  not_first: 'prior_exists',
  first_no_prior: 'no_prior_known',
  first_modern: 'prior_exists',      // antiquated prior — entries carry the year
  first_complete: 'prior_exists',    // partial prior — entries carry completeness
  first_from_source: 'prior_exists', // different-source-language prior
  not_applicable: 'not_a_single_work',
  needs_review: 'under_review',
  unverifiable: 'under_review',
};

/** What the work-grain JOIN would render on OUR editions of this work. */
function computedBadge(status, entries) {
  if (status === 'no_prior_known') return true;
  if (status !== 'prior_exists') return false;
  // A prior defeats "first" only if COMPLETE, same-text/same-work (the derive
  // rules, applied once at the work grain instead of nightly per book).
  const defeating = entries.some((e) =>
    e.completeness === 'complete'
    && (e.relationship == null || e.relationship === 'same_text' || e.relationship === 'same_work_diff_edition'));
  return !defeating;
}

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');
const registry = db.collection('work_translation_history');

if (WIPE) {
  const res = await registry.deleteMany({ pilot: true });
  console.log(`Wiped ${res.deletedCount} pilot docs from work_translation_history.`);
  await c.close();
  process.exit(0);
}

// Phase 1 (#3881): --all-verified seeds EVERY work with a verified-layer
// resolution, not just the hand-picked cast. Same safety: only the unread
// collection is written; a wrong seed is visible (test 2 canary), not active.
const workList = ALL_VERIFIED
  ? await books.distinct('work_id', {
      'first_translation.resolver': { $in: ['tier2_agent', 'human'] },
      work_id: { $exists: true, $nin: [null, ''] },
    })
  : PILOT_WORKS;
console.log(`Seeding ${workList.length} work(s) (${ALL_VERIFIED ? 'ALL verified-layer' : 'pilot cast'})`);

const report = { generated_at: NOW, works: [], totals: {} };
let totalSiblings = 0;
let disagreeingBefore = 0;
let entriesTotal = 0;
const docs = [];

for (const workId of workList) {
  const siblings = await books.find(
    { work_id: workId, visible: true },
    { projection: { id: 1, title: 1, author: 1, language: 1, is_first_translation: 1, first_translation: 1, pages_translated: 1 } },
  ).toArray();
  if (!siblings.length) {
    console.log(`  SKIP ${workId} — no visible books`);
    continue;
  }
  const verifiedBook = siblings.find((b) =>
    ['tier2_agent', 'human'].includes(b.first_translation?.resolver));
  if (!verifiedBook) {
    console.log(`  SKIP ${workId} — no verified-layer book (pilot seeds ONLY from verified facts)`);
    continue;
  }
  const ft = verifiedBook.first_translation;
  let status = VERDICT_TO_STATUS[ft.verdict] ?? 'under_review';

  // Entries: citable priors from the ledger rows behind the verified verdict.
  const bookIds = siblings.map((b) => b.id);
  const found = await attempts.find({
    book_id: { $in: bookIds },
    result: 'found',
    'priors.0': { $exists: true },
  }).sort({ date: -1 }).limit(20).toArray();
  const seen = new Set();
  const entries = [];
  for (const a of found) {
    for (const p of a.priors ?? []) {
      // Round-1 hygiene rules (card-round-1.md): NO CITATION → NO ENTRY.
      // An entry must be locatable — a citation URL, or at least a named
      // translator with a year. Placeholder prose ("None (complete edition)",
      // "Partial translations of…") is extraction noise, not knowledge.
      const locatable = p.source_url || (p.translator && p.pub_year);
      const placeholder = /^\s*(none\b|no |n\/a|unknown\b|partial translations? of|various\b)/i
        .test(p.english_title ?? '');
      if (!locatable || placeholder) continue;
      const key = `${p.translator ?? ''}|${p.pub_year ?? ''}|${(p.english_title ?? '').slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        kind: 'english_translation',
        year: p.pub_year ?? null,
        translator: p.translator ?? null,
        title: p.english_title ?? null,
        publisher: p.publisher ?? null,
        completeness: p.completeness ?? 'unknown',
        relationship: ft.prior_relationship ?? null,
        citation_url: p.source_url ?? null,
        source_attempt_ids: [a.attempt_id],
        evidence_grade: a.evidence_strength ?? null,
        verified: ['tier2_agent', 'human', 'claude_subagent_verify'].includes(a.method),
      });
    }
  }

  // Round-1 consistency rule: a card's status must be derivable from its own
  // entries. `no_prior_known` with a COMPLETE entry is a contradiction — the
  // Gangtey/Fries class. Partial-only entries may coexist with no_prior_known
  // (they support first-complete, they don't defeat it).
  if (status === 'no_prior_known'
    && entries.some((e) => e.completeness === 'complete')) {
    status = 'under_review';
  }

  const badge = computedBadge(status, entries);
  const badgesToday = new Set(siblings.map((b) => b.is_first_translation === true));
  const disagrees = badgesToday.size > 1;
  if (disagrees) disagreeingBefore++;
  totalSiblings += siblings.length;
  entriesTotal += entries.length;

  docs.push({
    _id: workId,
    work_id: workId,
    work_title: verifiedBook.title,
    author: verifiedBook.author ?? null,
    status,
    entries,
    search: {
      summary: `Verified at book grain by ${ft.resolver}; verdict ${ft.verdict} (${ft.evidence_strength}). Seeded from the attempts ledger.`,
      attempt_count: await attempts.countDocuments({ book_id: { $in: bookIds } }),
      last_searched: found[0]?.date ?? null,
    },
    review: {
      verified_by: ft.resolver,
      verified_at: ft.resolved_at ?? null,
      basis_attempt_id: ft.best_attempt_id ?? null,
      seeded_from_book: verifiedBook.id,
    },
    pilot: !ALL_VERIFIED,
    seeded_from: ALL_VERIFIED ? 'phase1-verified-layer' : 'pilot-cast',
    seeded_at: NOW,
  });

  report.works.push({
    work_id: workId,
    title: String(verifiedBook.title).slice(0, 60),
    verdict: ft.verdict,
    status,
    entries: entries.length,
    siblings: siblings.length,
    siblings_disagree_today: disagrees,
    computed_badge: badge,
    badges_today: siblings.map((b) => ({ id: b.id, badge: b.is_first_translation === true })),
  });
  console.log(`  ${workId.padEnd(28).slice(0, 28)} ${ft.verdict.padEnd(16)} → ${status.padEnd(18)} entries=${entries.length} siblings=${siblings.length}${disagrees ? '  ⚠ SIBLINGS DISAGREE TODAY' : ''}`);
}

report.totals = {
  works: docs.length,
  sibling_books: totalSiblings,
  fanout: +(totalSiblings / Math.max(docs.length, 1)).toFixed(2),
  citable_entries: entriesTotal,
  works_with_disagreeing_siblings_before: disagreeingBefore,
  works_with_disagreeing_siblings_after: 0, // structural: one fact per work
};
console.log('\n── pilot totals ──');
console.log(JSON.stringify(report.totals, null, 2));

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `ft-work-registry-pilot-${NOW.slice(0, 10)}.json`);
fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`Wrote ${outPath}`);

if (APPLY) {
  for (const d of docs) {
    await registry.updateOne({ _id: d._id }, { $set: d }, { upsert: true });
  }
  console.log(`APPLIED — ${docs.length} work_translation_history docs upserted. Nothing reads this collection yet; wiring the join is a separate, reviewed PR.`);
} else {
  console.log('DRY-RUN — no writes. Re-run with --apply to seed work_translation_history.');
}
await c.close();
