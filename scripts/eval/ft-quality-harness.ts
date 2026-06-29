#!/usr/bin/env npx tsx
/**
 * First-Translation QUALITY HARNESS — non-circular eval (issue #2876).
 *
 * The "First Translation" badge is the library's most consequential claim. We
 * have a four-stage pipeline but no MEASURED accuracy for any of it — the one
 * existing eval (`ft-eval.mjs`) seeds "expected" labels from the pipeline's own
 * output, so it grades the pipeline against itself. This harness fixes that: it
 * assembles a gold set from data we ALREADY hold (none of it produced by the
 * production verifier), grades the STORED verdicts against it (~zero token
 * cost), and emits a one-page precision / recall / agreement / calibration
 * report, broken out by stratum, with the non-Western gap reported separately.
 *
 * THREE gold sources (see issue §"We can measure quality from existing assets"):
 *   1. translation_catalogs → RECALL. Each row is a confirmed prior English
 *      translation. Books we match to one are cases where the true answer is
 *      "a prior exists" → measure what fraction each method calls not_first.
 *   2. Human/adversarially-adjudicated batches → a non-circular GOLD set for
 *      PRECISION (the #2564 census promote/demote files, the 462-book Tier-2
 *      study, the 33-case external-API Latin gold). ~900 answers NOT produced
 *      by the production pipeline.
 *   3. The attempt ledger's multiple evidence families per book → AGREEMENT (κ),
 *      label-free. attemptFamily() groups votes; cross-family κ is a quality
 *      signal needing no ground truth; disagreement marks where effort should go.
 *
 * METHODS graded (all STORED — no new model calls):
 *   M1 disposition  — translation_verification.disposition (the path that made
 *                     the public count) → DISPOSITION_TO_VERDICT.
 *   M2 derivation   — resolveFirstTranslation(book).verdict (derive.ts; the new
 *                     single-writer derived read, with its evidence gate).
 *   M3 tier2 stored — book.first_translation.verdict where resolver=tier2_agent.
 *
 * Circularity guards: a method is never graded against gold it could have
 * produced. M2/M3 skip adjudicated-gold rows whose stored verdict was written
 * FROM that adjudication (resolver tier2_agent/human). M1 (the production
 * disposition) is independent of every adjudicated source, so it is graded on
 * all of source 2 — that precision IS the measured fabrication rate the docs
 * have only ever guessed at (~63%).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-quality-harness.ts [--date=YYYY-MM-DD] [--out-dir=scripts/eval/results]
 *
 * Reuses src/lib/first-translation/{inference (Wilson CI), agreement (κ),
 * types, derive, prior-evidence} — no stats are reimplemented here.
 */

import { MongoClient, type Db } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  DISPOSITION_TO_VERDICT,
  FIRST_FAMILY,
  type FirstTranslationVerdict,
  type LegacyDisposition,
} from '../../src/lib/first-translation/types';
import { resolveFirstTranslation } from '../../src/lib/first-translation/derive';
import { attemptFamily } from '../../src/lib/first-translation/prior-evidence';
import { wilsonInterval } from '../../src/lib/first-translation/inference';
import {
  pairwiseKappa,
  kappaBand,
  type RaterLabels,
} from '../../src/lib/first-translation/agreement';
import type { FirstTranslationAttempt } from '../../src/lib/first-translation/attempt-log';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

// ── Env loading (semicolon-source .env.production.local first) ───────────────
function loadEnv() {
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(path.join(REPO, file), 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
        }
      }
      break;
    } catch { /* next */ }
  }
}
loadEnv();

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (k: string, d?: string) =>
  args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const RUN_DATE = getArg('date', new Date().toISOString().slice(0, 10))!;
const OUT_DIR = path.join(REPO, getArg('out-dir', 'scripts/eval/results')!);

// ── Coarse class + strata helpers ────────────────────────────────────────────
type Coarse = 'first' | 'not_first' | 'na';
function coarse(v: FirstTranslationVerdict | null | undefined): Coarse | null {
  if (!v) return null;
  if (FIRST_FAMILY.has(v)) return 'first';
  if (v === 'not_first') return 'not_first';
  return 'na'; // not_applicable | unverifiable | needs_review
}

const WESTERN = new Set([
  'latin', 'greek', 'ancient greek', 'french', 'german', 'italian', 'spanish',
  'english', 'dutch', 'portuguese', 'czech', 'polish', 'russian', 'swedish',
  'danish', 'norwegian', 'hungarian', 'romanian', 'catalan', 'flemish',
  'middle dutch', 'old french', 'church slavonic', 'finnish', 'croatian',
]);
function langIndex(lang?: string | null, orig?: string | null): 'western' | 'non_western' {
  const a = (lang ?? '').toLowerCase().trim();
  const b = (orig ?? '').toLowerCase().trim();
  // Treat as western if EITHER the source or edition language is western.
  for (const l of [b, a]) {
    if (!l) continue;
    if (WESTERN.has(l)) return 'western';
    // compound like "Latin-German"
    if (l.split(/[-/,]/).some((p) => WESTERN.has(p.trim()))) return 'western';
  }
  return 'non_western';
}

const CONTAINER_RE = /\b(opera omnia|opera|florilegium|miscellanea|collected|complete works|gesammelte|samtliche|sammlung|antholog|tomus|tome\b|works of|opuscula)\b/i;
function isContainer(title?: string | null): boolean {
  return !!title && CONTAINER_RE.test(title);
}

function norm(s?: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const STOP = new Set(['de', 'la', 'le', 'el', 'der', 'die', 'das', 'of', 'the', 'and', 'a', 'an', 'in', 'et', 'ad', 'libri', 'liber', 'liber', 'on', 'von', 'di', 'del', 'des', 'eius', 'sive', 'seu', 'cum']);
function tokens(s?: string | null): string[] {
  return norm(s).split(' ').filter((t) => t.length >= 4 && !STOP.has(t));
}

// ── Gold record ──────────────────────────────────────────────────────────────
type GoldProvenance = 'catalog' | 'census' | 'tier2_study' | 'external_33';
interface GoldRecord {
  book_id: string;
  gold_verdict: FirstTranslationVerdict;
  gold_coarse: Coarse;
  provenance: GoldProvenance;
  /** completeness of the prior, when source 1 (catalog) knows it. */
  prior_complete?: boolean;
}

function readJson<T = any>(rel: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8')) as T;
  } catch {
    return null;
  }
}

// result-enum (census files) → graded verdict
const RESULT_TO_VERDICT: Record<string, FirstTranslationVerdict> = {
  complete_prior_found: 'not_first',
  only_partial_exists: 'first_complete',
  none_found: 'first_no_prior',
  not_applicable: 'not_applicable',
};

/** Load source-2 (adjudicated) gold + dedup with precedence. */
function loadAdjudicatedGold(): { gold: Map<string, GoldRecord>; sourceCounts: Record<string, number> } {
  const gold = new Map<string, GoldRecord>();
  const sourceCounts: Record<string, number> = {};
  // Precedence (most → least authoritative): signed-off census > Tier-2 study >
  // external-API 33. Lower-precedence sources only fill book_ids not yet seen.
  const PRECEDENCE: GoldProvenance[] = ['census', 'tier2_study', 'external_33'];

  const candidates: Array<{ prov: GoldProvenance; recs: GoldRecord[] }> = [];

  // #2564 census Tier-2 (ft-verify) adjudication, human-reviewed — distilled to a
  // tracked slim file so the harness is reproducible from the repo (the verbose
  // source artifacts in scripts/output/ are untracked scratch).
  {
    const g = readJson<any>('scripts/eval/ft-gold-census-2026-06-26.json');
    const recs: GoldRecord[] = [];
    for (const r of g?.cases ?? []) {
      const gv = RESULT_TO_VERDICT[r?.result];
      if (!gv || !r?.book_id) continue;
      const c = coarse(gv);
      if (!c) continue;
      recs.push({ book_id: String(r.book_id), gold_verdict: gv, gold_coarse: c, provenance: 'census' });
    }
    candidates.push({ prov: 'census', recs });
  }

  // 462-book Tier-2 study: graded `verdict`.
  {
    const arr = readJson<any[]>('scripts/eval/results/ft-tier2-verdicts-final.json');
    if (Array.isArray(arr)) {
      const recs: GoldRecord[] = [];
      for (const r of arr) {
        const gv = r?.verdict as FirstTranslationVerdict;
        const c = coarse(gv);
        if (!gv || !c || !r?.book_id) continue;
        recs.push({ book_id: String(r.book_id), gold_verdict: gv, gold_coarse: c, provenance: 'tier2_study' });
      }
      candidates.push({ prov: 'tier2_study', recs });
    }
  }

  // 33-case external-API Latin gold: external_verdict (independent of pipeline).
  {
    const g = readJson<any>('scripts/eval/ft-ground-truth.json');
    if (g?.cases) {
      const recs: GoldRecord[] = [];
      for (const r of g.cases) {
        if (!r?.book_id) continue;
        // translation_likely → a prior exists → not_first; else first_no_prior.
        const gv: FirstTranslationVerdict =
          r.external_verdict === 'translation_likely' ? 'not_first' : 'first_no_prior';
        recs.push({ book_id: String(r.book_id), gold_verdict: gv, gold_coarse: coarse(gv)!, provenance: 'external_33' });
      }
      candidates.push({ prov: 'external_33', recs });
    }
  }

  for (const prov of PRECEDENCE) {
    for (const { prov: p, recs } of candidates) {
      if (p !== prov) continue;
      for (const rec of recs) {
        if (!gold.has(rec.book_id)) {
          gold.set(rec.book_id, rec);
          sourceCounts[prov] = (sourceCounts[prov] ?? 0) + 1;
        }
      }
    }
  }
  return { gold, sourceCounts };
}

// ── Source 1: catalog-prior RECALL set ───────────────────────────────────────
interface BookDoc {
  _id: any;
  title?: string;
  author?: string;
  language?: string | null;
  original_language?: string | null;
  work_id?: string | null;
  is_first_translation?: boolean;
  visible?: boolean;
  pages_translated?: number | null;
  translation_verification?: { disposition?: string; translations_found?: unknown[]; source?: string } | null;
  first_translation?: any;
}

/**
 * Build the catalog-prior recall gold: ASSESSED books (any disposition) we can
 * match to a confirmed prior English translation in `translation_catalogs`
 * (author surname overlap + strong title-token containment). A match means a
 * prior exists, so the TRUE answer is `not_first`. Scanning the whole assessed
 * pool (not just badged firsts) gives an honest recall denominator: it includes
 * both the books a method correctly calls not_first AND the ones it badges
 * despite the held prior (the §0 recall failure, measured). The catalog is
 * source_language=Latin only, so this measures the WESTERN/Latin recall slice.
 *
 * Conservative on purpose: high gold precision matters more than volume here.
 */
async function buildCatalogRecallGold(db: Db): Promise<{
  gold: GoldRecord[];
  catalogRows: number;
  badgedScanned: number;
}> {
  const catalog = await db
    .collection('translation_catalogs')
    .find({}, { projection: { author_surname: 1, canonical_author_normalized: 1, author_normalized: 1, canonical_work_normalized: 1, english_title_normalized: 1, original_title: 1, completeness: 1, source_language: 1 } })
    .toArray();

  // Index catalog rows by author surname token for cheap candidate lookup.
  const bySurname = new Map<string, any[]>();
  for (const c of catalog) {
    const surnames = new Set<string>();
    const s1 = norm(c.author_surname);
    if (s1) surnames.add(s1.split(' ')[0]);
    for (const t of tokens(c.canonical_author_normalized ?? c.author_normalized)) surnames.add(t);
    for (const s of surnames) {
      if (!bySurname.has(s)) bySurname.set(s, []);
      bySurname.get(s)!.push(c);
    }
  }

  const badged = await db
    .collection<BookDoc>('books')
    .find(
      { visible: true, 'translation_verification.disposition': { $exists: true, $ne: null } },
      { projection: { title: 1, author: 1, language: 1, original_language: 1, work_id: 1 } },
    )
    .toArray();

  const gold: GoldRecord[] = [];
  for (const b of badged) {
    const authorToks = tokens(b.author);
    if (!authorToks.length) continue;
    // candidate catalog rows sharing any author token
    const cands = new Set<any>();
    for (const t of authorToks) for (const c of bySurname.get(t) ?? []) cands.add(c);
    if (!cands.size) continue;

    const bookTitleToks = new Set(tokens(b.title));
    if (bookTitleToks.size < 1) continue;

    let bestComplete: boolean | undefined;
    let matched = false;
    for (const c of cands) {
      // title containment: ≥2 shared significant tokens, or full coverage of a
      // short catalog work title. Compare against canonical_work / original_title
      // (these stay in the source language, matching our mostly-Latin titles).
      const catToks = tokens(c.canonical_work_normalized ?? c.original_title ?? c.english_title_normalized);
      if (catToks.length < 1) continue;
      const shared = catToks.filter((t) => bookTitleToks.has(t));
      const coverage = shared.length / catToks.length;
      const strong = shared.length >= 2 || (catToks.length <= 3 && coverage >= 0.67 && shared.length >= 1);
      if (!strong) continue;
      matched = true;
      if (c.completeness === 'complete') bestComplete = true;
      else if (bestComplete === undefined) bestComplete = false;
    }
    if (matched) {
      gold.push({
        book_id: String(b._id),
        gold_verdict: 'not_first',
        gold_coarse: 'not_first',
        provenance: 'catalog',
        prior_complete: bestComplete,
      });
    }
  }
  return { gold, catalogRows: catalog.length, badgedScanned: badged.length };
}

// ── Methods under test ───────────────────────────────────────────────────────
function m1Disposition(b: BookDoc): FirstTranslationVerdict | null {
  const d = b.translation_verification?.disposition as LegacyDisposition | undefined;
  if (!d || !(d in DISPOSITION_TO_VERDICT)) return null;
  return DISPOSITION_TO_VERDICT[d];
}
function m2Derivation(b: BookDoc): FirstTranslationVerdict | null {
  return resolveFirstTranslation(b as any)?.verdict ?? null;
}
function m3Tier2(b: BookDoc): FirstTranslationVerdict | null {
  const ft = b.first_translation;
  if (ft?.verdict && ft?.resolver === 'tier2_agent') return ft.verdict as FirstTranslationVerdict;
  return null;
}
/** A book's stored verdict is "self-produced" by adjudication (circular for M2/M3). */
function isAdjudicatedStored(b: BookDoc): boolean {
  const r = b.first_translation?.resolver;
  return r === 'tier2_agent' || r === 'human';
}

interface Method {
  key: 'M1_disposition' | 'M2_derivation' | 'M3_tier2';
  label: string;
  verdict: (b: BookDoc) => FirstTranslationVerdict | null;
  /** Gold provenances this method may NOT be graded against (circular). */
  circularAgainst: GoldProvenance[];
}
const METHODS: Method[] = [
  { key: 'M1_disposition', label: 'Stored disposition (production)', verdict: m1Disposition, circularAgainst: [] },
  { key: 'M2_derivation', label: 'Derived verdict (derive.ts)', verdict: m2Derivation, circularAgainst: ['census', 'tier2_study'] },
  { key: 'M3_tier2', label: 'Tier-2 stored verdict', verdict: m3Tier2, circularAgainst: ['census', 'tier2_study'] },
];

// ── Metric primitives ────────────────────────────────────────────────────────
interface Rate {
  numer: number;
  denom: number;
  rate: number;
  ci: [number, number];
}
function rate(numer: number, denom: number): Rate {
  return { numer, denom, rate: denom ? numer / denom : NaN, ci: wilsonInterval(numer, denom) };
}
const pct = (x: number) => (Number.isNaN(x) ? '  n/a' : `${(x * 100).toFixed(1)}%`);
const ciStr = (r: Rate) =>
  r.denom ? `${pct(r.rate)} [${pct(r.ci[0])}–${pct(r.ci[1])}] (${r.numer}/${r.denom})` : 'n/a (0)';

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  console.error('• Loading adjudicated gold (source 2)…');
  const { gold: adjGold, sourceCounts } = loadAdjudicatedGold();

  console.error('• Building catalog-prior recall gold (source 1)…');
  const catalogRecall = await buildCatalogRecallGold(db);

  // Merge all gold into one map. Adjudicated wins over catalog on conflict
  // (a human/tier2 verdict is stronger than an author+title catalog match).
  const gold = new Map<string, GoldRecord>(adjGold);
  let catalogAdded = 0;
  for (const g of catalogRecall.gold) {
    if (!gold.has(g.book_id)) {
      gold.set(g.book_id, g);
      catalogAdded++;
    }
  }

  // Fetch the book doc for every gold id (the methods read these).
  console.error(`• Fetching ${gold.size} gold book docs…`);
  const ids = [...gold.keys()];
  const { ObjectId } = await import('mongodb');
  const objIds = ids.map((s) => { try { return new ObjectId(s); } catch { return null; } }).filter(Boolean);
  const books = await db
    .collection<BookDoc>('books')
    .find(
      { _id: { $in: objIds as any[] } },
      { projection: { title: 1, author: 1, language: 1, original_language: 1, work_id: 1, is_first_translation: 1, visible: 1, pages_translated: 1, 'translation_verification.disposition': 1, 'translation_verification.translations_found': 1, 'translation_verification.source': 1, first_translation: 1 } },
    )
    .toArray();
  const bookById = new Map(books.map((b) => [String(b._id), b]));

  // ── PRECISION + RECALL per method ──────────────────────────────────────────
  // We compute, per method:
  //   precision_first     — among method=first,     gold=first  (source 2 only)
  //   precision_not_first — among method=not_first,  gold=not_first (1 − fabrication)
  //   recall_not_first    — among gold=not_first,    method=not_first
  // Recall draws on BOTH source 1 (catalog) and the not_first rows of source 2.
  interface MethodEval {
    precFirst: Rate; precNotFirst: Rate; recallNotFirst: Rate;
    coveredFirst: number; coveredNotFirst: number; emitted: number; skippedCircular: number;
    byLang: Record<'western' | 'non_western', { precFirst: Rate; recall: Rate }>;
    byStruct: Record<'single' | 'container', { precFirst: Rate; recall: Rate }>;
  }
  const evals: Record<string, MethodEval> = {};

  for (const m of METHODS) {
    let pfN = 0, pfD = 0, pnfN = 0, pnfD = 0, rN = 0, rD = 0, emitted = 0, skipped = 0;
    const lang = { western: { pfN: 0, pfD: 0, rN: 0, rD: 0 }, non_western: { pfN: 0, pfD: 0, rN: 0, rD: 0 } };
    const struct = { single: { pfN: 0, pfD: 0, rN: 0, rD: 0 }, container: { pfN: 0, pfD: 0, rN: 0, rD: 0 } };

    for (const [bid, g] of gold) {
      const b = bookById.get(bid);
      if (!b) continue;
      // Circularity guard: skip gold the method itself could have produced.
      if (m.circularAgainst.includes(g.provenance) && isAdjudicatedStored(b)) { skipped++; continue; }

      const v = m.verdict(b);
      const c = coarse(v);
      if (c === null) continue; // method has no verdict for this book
      emitted++;

      const li = langIndex(b.language, b.original_language);
      const st = isContainer(b.title) ? 'container' : 'single';

      // PRECISION of the "first" claim — only meaningful on adjudicated gold,
      // where gold can be "first". (Catalog gold is all not_first.)
      if (g.provenance !== 'catalog') {
        if (c === 'first') {
          pfD++; lang[li].pfD++; struct[st].pfD++;
          if (g.gold_coarse === 'first') { pfN++; lang[li].pfN++; struct[st].pfN++; }
        }
        // PRECISION of the not_first claim (fabrication-rate complement).
        if (c === 'not_first') { pnfD++; if (g.gold_coarse === 'not_first') pnfN++; }
      }

      // RECALL of priors — over every gold row whose true answer is not_first.
      if (g.gold_coarse === 'not_first') {
        rD++; lang[li].rD++; struct[st].rD++;
        if (c === 'not_first') { rN++; lang[li].rN++; struct[st].rN++; }
      }
    }

    evals[m.key] = {
      precFirst: rate(pfN, pfD),
      precNotFirst: rate(pnfN, pnfD),
      recallNotFirst: rate(rN, rD),
      coveredFirst: pfD, coveredNotFirst: pnfD, emitted, skippedCircular: skipped,
      byLang: {
        western: { precFirst: rate(lang.western.pfN, lang.western.pfD), recall: rate(lang.western.rN, lang.western.rD) },
        non_western: { precFirst: rate(lang.non_western.pfN, lang.non_western.pfD), recall: rate(lang.non_western.rN, lang.non_western.rD) },
      },
      byStruct: {
        single: { precFirst: rate(struct.single.pfN, struct.single.pfD), recall: rate(struct.single.rN, struct.single.rD) },
        container: { precFirst: rate(struct.container.pfN, struct.container.pfD), recall: rate(struct.container.rN, struct.container.rD) },
      },
    };
  }

  // ── CALIBRATION: does evidence_strength predict correctness? ────────────────
  // Bucket adjudicated-gold books that carry a stored first_translation by its
  // evidence_strength; accuracy = stored verdict's coarse == gold coarse.
  // (Non-circular subset: external_33 + catalog; tier2/census stored verdicts
  // were written from those adjudications, so we exclude them.)
  const calib: Record<string, { correct: number; total: number }> = {};
  for (const [bid, g] of gold) {
    const b = bookById.get(bid);
    if (!b?.first_translation?.evidence_strength) continue;
    if ((g.provenance === 'census' || g.provenance === 'tier2_study') && isAdjudicatedStored(b)) continue;
    const es = b.first_translation.evidence_strength as string;
    const c = coarse(b.first_translation.verdict);
    if (!c) continue;
    calib[es] = calib[es] ?? { correct: 0, total: 0 };
    calib[es].total++;
    if (c === g.gold_coarse) calib[es].correct++;
  }

  // ── AGREEMENT (source 3): cross-family κ from the attempt ledger ────────────
  console.error('• Streaming attempt ledger for cross-family agreement (source 3)…');
  // family → (book_id → 'found' | 'none'), where a family's vote = majority of
  // its attempts on that book (found if found-votes > none-votes).
  const famVotes = new Map<string, Map<string, { found: number; none: number }>>();
  const cur = db.collection<FirstTranslationAttempt>('first_translation_attempts')
    .find({}, { projection: { book_id: 1, method: 1, notes: 1, result: 1, queries: 1 } });
  let attemptsSeen = 0;
  for await (const a of cur) {
    attemptsSeen++;
    const f = attemptFamily(a);
    if (f === 'unknown' || !a.book_id) continue;
    if (!famVotes.has(f)) famVotes.set(f, new Map());
    const fm = famVotes.get(f)!;
    if (!fm.has(a.book_id)) fm.set(a.book_id, { found: 0, none: 0 });
    const v = fm.get(a.book_id)!;
    if (a.result === 'found') v.found++; else v.none++;
  }
  const raters: RaterLabels = {};
  const ledgerBookIds = new Set<string>();
  for (const [fam, fm] of famVotes) {
    const map = new Map<string, string>();
    for (const [bid, v] of fm) {
      map.set(bid, v.found > v.none ? 'found' : 'none');
      ledgerBookIds.add(bid);
    }
    raters[fam] = map;
  }
  const agreementAll = pairwiseKappa(raters);

  // Per-language-indexing κ: fetch language for the multi-family book ids.
  console.error('• Fetching languages for ledger books (per-stratum κ)…');
  const langOf = new Map<string, 'western' | 'non_western'>();
  {
    const idList = [...ledgerBookIds];
    const oids = idList.map((s) => { try { return new ObjectId(s); } catch { return null; } }).filter(Boolean) as any[];
    // batch the $in to keep the query sane
    for (let i = 0; i < oids.length; i += 5000) {
      const batch = oids.slice(i, i + 5000);
      const rows = await db.collection<BookDoc>('books')
        .find({ _id: { $in: batch } }, { projection: { language: 1, original_language: 1 } })
        .toArray();
      for (const r of rows) langOf.set(String(r._id), langIndex(r.language, r.original_language));
    }
  }
  function kappaForLang(target: 'western' | 'non_western') {
    const sub: RaterLabels = {};
    for (const [fam, map] of Object.entries(raters)) {
      const m = new Map<string, string>();
      for (const [bid, lab] of map) if (langOf.get(bid) === target) m.set(bid, lab);
      sub[fam] = m;
    }
    return pairwiseKappa(sub);
  }
  const agreementWestern = kappaForLang('western');
  const agreementNonWestern = kappaForLang('non_western');

  // ── REPORT ──────────────────────────────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonOut = path.join(OUT_DIR, `ft-quality-report-${RUN_DATE}.json`);
  const mdOut = path.join(OUT_DIR, `ft-quality-report-${RUN_DATE}.md`);

  const goldByProv: Record<string, number> = {};
  for (const g of gold.values()) goldByProv[g.provenance] = (goldByProv[g.provenance] ?? 0) + 1;
  const catalogComplete = catalogRecall.gold.filter((g) => g.prior_complete === true).length;

  const report = {
    generated_at: new Date().toISOString(),
    run_date: RUN_DATE,
    db: 'bookstore',
    gold: {
      total_books: gold.size,
      by_provenance: goldByProv,
      adjudicated_source_counts: sourceCounts,
      catalog_recall: {
        catalog_rows: catalogRecall.catalogRows,
        badged_books_scanned: catalogRecall.badgedScanned,
        assessed_books_scanned: catalogRecall.badgedScanned,
        matched_with_prior: catalogRecall.gold.length,
        of_which_complete_prior: catalogComplete,
        added_to_gold: catalogAdded,
      },
    },
    methods: Object.fromEntries(METHODS.map((m) => [m.key, { label: m.label, ...evals[m.key] }])),
    calibration: calib,
    agreement: {
      attempts_seen: attemptsSeen,
      families: Object.fromEntries(Object.entries(raters).map(([f, m]) => [f, m.size])),
      overall: { meanKappa: agreementAll.meanKappa, itemsCompared: agreementAll.itemsCompared, pairs: agreementAll.pairs },
      western: { meanKappa: agreementWestern.meanKappa, itemsCompared: agreementWestern.itemsCompared, pairs: agreementWestern.pairs },
      non_western: { meanKappa: agreementNonWestern.meanKappa, itemsCompared: agreementNonWestern.itemsCompared, pairs: agreementNonWestern.pairs },
    },
  };
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

  // ── Markdown one-pager ──────────────────────────────────────────────────────
  const L: string[] = [];
  L.push(`# First-Translation Quality Report — ${RUN_DATE}`);
  L.push('');
  L.push(`*Non-circular eval (#2876). Grades STORED verdicts against gold we already hold; ~zero token cost. Stats: Wilson 95% CIs (\`inference.ts\`) + Cohen's κ (\`agreement.ts\`).*`);
  L.push('');
  L.push('## Gold set');
  L.push('');
  L.push(`- **${gold.size}** books with a non-pipeline answer.`);
  L.push(`  - Adjudicated (source 2): census ${sourceCounts.census ?? 0} · Tier-2 study ${sourceCounts.tier2_study ?? 0} · external-API 33 ${sourceCounts.external_33 ?? 0}.`);
  L.push(`  - Catalog priors (source 1, Latin slice): ${catalogAdded} added (of ${catalogRecall.gold.length} assessed books matched to a held prior; ${catalogComplete} with a confirmed *complete* prior). Scanned ${catalogRecall.badgedScanned} assessed books against ${catalogRecall.catalogRows} catalog rows.`);
  L.push('');
  L.push('> **Recall lever status:** the catalog confirms a *complete* prior on only ' +
    `${catalogComplete} of ${catalogRecall.gold.length} matched books — not because priors are absent but because \`translation_catalogs.completeness\` is mostly unset. Filling that field is the single highest-leverage unblock for the recall measurement (issue §0 finding, now quantified).`);
  L.push('');
  L.push('## Precision & recall (per method)');
  L.push('');
  L.push('`precision(first)` = of books a method badges first, how many gold confirms · `precision(not_first)` = of claimed priors, how many are real (**1 − fabrication rate**) · `recall(not_first)` = of known priors, how many the method catches.');
  L.push('');
  L.push('| Method | precision(first) | precision(not_first) | recall(not_first) | emitted | skipped (circular) |');
  L.push('|---|---|---|---|---|---|');
  for (const m of METHODS) {
    const e = evals[m.key];
    L.push(`| ${m.label} | ${ciStr(e.precFirst)} | ${ciStr(e.precNotFirst)} | ${ciStr(e.recallNotFirst)} | ${e.emitted} | ${e.skippedCircular} |`);
  }
  L.push('');
  const fab = evals.M1_disposition.precNotFirst;
  if (fab.denom) {
    L.push(`> **Measured fabrication rate (production "prior found"):** ${pct(1 - fab.rate)} of stored \`not_first\` dispositions are NOT confirmed by gold (n=${fab.denom}). The docs' "~63%" is now a measured ${pct(fab.rate)} precision.`);
    L.push('');
  }
  L.push('> **Read precision as a sample-conditional number, not the corpus rate.** The adjudicated gold (Tier-2 study + census) was drawn to probe suspected errors and promote/demote candidates, so it is enriched for hard cases — precision here is a *lower bound* on whole-corpus precision, and recall is measured on the Latin slice the catalog can speak to. The honest fix is the unified sampling pass (#2564 §F): draw the Tier-2 queue AS a stratified random sample so each run\'s gold doubles as a corpus-representative calibration set.');
  L.push('');
  L.push('## Stratified — Western vs non-Western (the recall gap)');
  L.push('');
  L.push('| Method | stratum | precision(first) | recall(not_first) |');
  L.push('|---|---|---|---|');
  for (const m of METHODS) {
    const e = evals[m.key];
    L.push(`| ${m.label} | western | ${ciStr(e.byLang.western.precFirst)} | ${ciStr(e.byLang.western.recall)} |`);
    L.push(`| ${m.label} | non-Western | ${ciStr(e.byLang.non_western.precFirst)} | ${ciStr(e.byLang.non_western.recall)} |`);
  }
  L.push('');
  L.push('## Stratified — single-work vs container');
  L.push('');
  L.push('| Method | stratum | precision(first) |');
  L.push('|---|---|---|');
  for (const m of METHODS) {
    const e = evals[m.key];
    L.push(`| ${m.label} | single-work | ${ciStr(e.byStruct.single.precFirst)} |`);
    L.push(`| ${m.label} | container | ${ciStr(e.byStruct.container.precFirst)} |`);
  }
  L.push('');
  L.push('## Calibration — does `evidence_strength` predict correctness?');
  L.push('');
  const calibTotal = Object.values(calib).reduce((s, c) => s + c.total, 0);
  if (Object.keys(calib).length) {
    L.push('| evidence_strength | accuracy vs gold | n |');
    L.push('|---|---|---|');
    for (const es of ['strong', 'moderate', 'weak']) {
      const c = calib[es];
      if (!c) continue;
      L.push(`| ${es} | ${pct(c.correct / c.total)} | ${c.total} |`);
    }
    if (calibTotal < 30) {
      L.push('');
      L.push(`_n=${calibTotal} is too small to interpret. Almost all graded \`first_translation.evidence_strength\` values today were written from the same adjudications used as gold (excluded as circular). Calibration becomes measurable once tier-1 derivation writes graded verdicts to books OUTSIDE the gold set — re-run then._`);
    }
  } else {
    L.push('_No non-circular books carry a stored `first_translation.evidence_strength` yet (the graded verdicts that exist were written from the same adjudications used as gold). Re-run once tier-1 derivation has written graded verdicts to books outside the gold set._');
  }
  L.push('');
  L.push('## Agreement (source 3, label-free) — cross-family Cohen\'s κ');
  L.push('');
  L.push(`From ${attemptsSeen} attempts in \`first_translation_attempts\`, each book voted per evidence family (catalog / model-knowledge / agent). κ corrects raw agreement for chance.`);
  L.push('');
  L.push(`- **Overall mean κ = ${agreementAll.meanKappa.toFixed(3)}** (${kappaBand(agreementAll.meanKappa)}), over ${agreementAll.itemsCompared} books with ≥2 families.`);
  L.push(`- Western: κ = ${agreementWestern.meanKappa.toFixed(3)} (${kappaBand(agreementWestern.meanKappa)}, n=${agreementWestern.itemsCompared}) · non-Western: κ = ${agreementNonWestern.meanKappa.toFixed(3)} (${kappaBand(agreementNonWestern.meanKappa)}, n=${agreementNonWestern.itemsCompared}).`);
  L.push('');
  L.push('| family pair | κ | raw agree | n |');
  L.push('|---|---|---|---|');
  for (const p of agreementAll.pairs) {
    L.push(`| ${p.raterA} ↔ ${p.raterB} | ${Number.isNaN(p.kappa) ? 'n/a' : p.kappa.toFixed(3)} | ${pct(p.po)} | ${p.n} |`);
  }
  L.push('');
  L.push('## How to read this');
  L.push('');
  L.push('- **High `precision(not_first)` + low `recall(not_first)`** = the cheap catalog path is trustworthy when it fires but misses priors → the recall lever (catalog completeness, work_id clustering) is where to invest, not more verification.');
  L.push('- **A stratum where non-Western recall ≪ Western recall** confirms catalogs don\'t index those scripts → route those books to Tier-2 / alternative authorities, never auto-badge.');
  L.push('- **Calibration that rises strong > moderate > weak** is what makes graded badging trustworthy; flat calibration means `evidence_strength` isn\'t earning its gate.');
  L.push('- Effort routing follows the numbers: spend the ~57k-tokens/book Tier-2 disposer only where cheap tiers are measured unreliable (the ambiguous middle and books about to be publicly badged).');
  L.push('');
  L.push(`*Full machine-readable detail: \`${path.relative(REPO, jsonOut)}\`.*`);

  fs.writeFileSync(mdOut, L.join('\n') + '\n');

  console.error(`\n✓ Wrote ${path.relative(REPO, mdOut)} and ${path.relative(REPO, jsonOut)}\n`);
  // Echo the markdown to stdout so the run is self-documenting.
  console.log(L.join('\n'));

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
