#!/usr/bin/env node
/**
 * J0 — cheap deterministic "same work? y/n" metadata oracle for the #2885(b)
 * alignment gold.  READ-ONLY (reads the manifest, writes a verdicts file).
 *
 * Judges each pair from the VISIBLE metadata only. It is deliberately
 * CONSERVATIVE: it resolves a pair only when the metadata is decisive, and marks
 * everything else `hard` → deferred to J1 (independent Claude subagents).
 *
 * Crucial asymmetry for LINK pairs: J0 must NOT confirm a Tier-0 link as `same`.
 * The matcher already used surname + title-containment + source-language to MAKE
 * the link, so a J0 `same` from those same signals is circular and adds nothing —
 * it cannot catch the false merge we are trying to measure. So for links J0 only
 * emits `different` on a clear DISQUALIFIER (series mismatch), otherwise `hard`.
 * The false-merge decision is left to the independent judge.
 *
 * For CO-CLUSTER / SPLIT pairs (book ↔ book, no catalog matcher involved) J0 may
 * emit `same` when two of OUR records agree strongly (near-identical title +
 * series match), `different` on a series mismatch, else `hard`.
 *
 * Output: scripts/eval/results/ft-alignment-verdicts-auto-<date>.json
 *   [{ pair_id, same: true|false|null, basis: 'metadata', reason }]
 *   (same:null ⇒ `hard`, route to J1)
 *
 * Usage: node scripts/eval/ft-alignment-judge-auto.mjs [--date YYYY-MM-DD]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalise, sigTokens, bookTitleCoverage, tokenOverlap, extractSurname } from './ft-catalog-match.mjs';
import { sameSeries } from '../lib/work-identity-util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const DATE = (() => { const i = process.argv.indexOf('--date'); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : new Date().toISOString().slice(0, 10); })();

function surnameMatch(a, b) {
  const sa = extractSurname(a || ''); const sb = extractSurname(b || '');
  return sa && sb && sa === sb;
}

// Best book-title coverage against either the catalog english_title or canonical_work.
function linkTitleCoverage(bookTitle, right) {
  return Math.max(
    bookTitleCoverage(bookTitle, right.english_title || ''),
    bookTitleCoverage(bookTitle, right.canonical_work || ''),
  );
}

function judge(pair) {
  const { kind, left, right } = pair;
  if (kind === 'link') {
    // DEFER every link to J1. J0 cannot judge a book↔catalog link safely:
    //  - confirming `same` reuses the matcher's own surname+title+lang signals → circular;
    //  - rejecting `different` on a series-key is UNRELIABLE, because catalog titles carry
    //    the PRIOR's own volume/completeness descriptors ("(complete, 5 vols)", "(Part I)",
    //    "(2:)") that are NOT a distinguisher of our specific item — this produced false
    //    "different" verdicts on genuine same-work demotes (Laozi/Legge, Copernicus,
    //    Rāmāyaṇa, Abhidharmakośa) in the first J0 pass.
    // The false-merge decision is exactly what we do not trust the cheap oracle with.
    return { same: null, basis: 'metadata', reason: 'link precision is the untrusted quantity — defer to independent J1' };
  }

  // SPLIT pairs are DEFERRED wholesale to J1. Split candidates are, by construction,
  // title-family collisions — near-identical AFTER normalisation — so J0's title
  // signal is blind exactly where it matters: normalisation strips the very tokens
  // that distinguish a false split from a real one (the <4-char section marker
  // "ma-rgyud" vs "pa-rgyud"; the Latin ordinal "Tomus Tertius" vs "Quartus" that
  // seriesKey doesn't parse). J0 `same` here is biased toward false-positive false-
  // splits. Recall must be measured by the independent judge, not the metadata screen.
  if (kind === 'split') {
    return { same: null, basis: 'metadata', reason: 'split recall is normalization-blind for J0 — defer to independent J1' };
  }

  // CO-CLUSTER: J0 only auto-resolves the UNAMBIGUOUS `same` (near-identical title +
  // author + no series difference = two copies of one work) as a cheap PRE-SCREEN.
  // Note this is biased toward `same` (it can't see volume-level impurity), so the
  // scorer labels J0-only co-cluster homogeneity PRELIMINARY. Anything with a
  // volume/part/number difference or a divergent title defers to J1.
  const cov = Math.max(bookTitleCoverage(left.title || '', right.title || ''), bookTitleCoverage(right.title || '', left.title || ''));
  const jac = tokenOverlap(left.title || '', right.title || '');
  const series = sameSeries(left.title || '', right.title || '');
  if (series && surnameMatch(left.author, right.author) && cov >= 0.9 && jac >= 0.6) {
    return { same: true, basis: 'metadata', reason: `near-identical title (cov=${cov.toFixed(2)}, jac=${jac.toFixed(2)}) + author + series match` };
  }
  return { same: null, basis: 'metadata', reason: `not unambiguously same (cov=${cov.toFixed(2)}, jac=${jac.toFixed(2)}, series=${series}) — defer to J1` };
}

const goldPath = path.join(RESULTS_DIR, `ft-alignment-gold-${DATE}.json`);
const { manifest } = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
const verdicts = manifest.map((p) => ({ pair_id: p.pair_id, ...judge(p) }));

const outPath = path.join(RESULTS_DIR, `ft-alignment-verdicts-auto-${DATE}.json`);
fs.writeFileSync(outPath, JSON.stringify(verdicts, null, 2));

const tally = verdicts.reduce((m, v) => { const k = v.same === true ? 'same' : v.same === false ? 'different' : 'hard'; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`J0 judged ${verdicts.length} pairs: ${JSON.stringify(tally)}`);
console.log(`  'hard' (${tally.hard || 0}) route to J1 (independent Claude subagents).`);
console.log(`Wrote ${outPath}`);
