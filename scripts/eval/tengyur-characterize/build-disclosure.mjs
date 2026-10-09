#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-characterize/analyze.py writes analysis.json, the source of every rate
// here; it does not shape them for the reader or carry the #5797 residue lists. src/data/canon-gap-status.json
// is the nearest generated reader-facing file, for holdings, not quality. Searched src/data/, src/lib/ and
// scripts/eval/tengyur-*/ for a per-section quality file: none.
/**
 * build-disclosure.mjs — #6120. $0, offline, no database.
 *
 *   node scripts/eval/tengyur-characterize/build-disclosure.mjs           # write
 *   node scripts/eval/tengyur-characterize/build-disclosure.mjs --check   # exit 1 if the file is stale or hand-edited
 *
 * Writes src/data/tengyur-section-quality.json: what the reader's draft line and /research/canon-quality
 * say about each Derge Tengyur section. Every number is copied from a committed results file, so a
 * re-measure (re-run analyze.py, then this) updates the copy:
 *
 *   results/tengyur-characterize-5829/analysis.json  rates per section, reviewer checks (#5829)
 *   results/tengyur-characterize-5829/counts.json    pages per section, volume → section (from book titles)
 *   results/tengyur-characterize-5829/reviews/*.json the error kinds, ranked per section
 *   results/tengyur-check-2026-10/*.json             the listed, unrepaired residue (#5797)
 *
 * The section a reader's book belongs to is read from its title at render time, with the same table the
 * #5829 sampler used (`SECTIONS` in common.mjs), so the reader and the measurement cannot disagree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SECTIONS, sectionOf } from './common.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const R = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const OUT = 'src/data/tengyur-section-quality.json';
const RES = 'scripts/eval/results/tengyur-characterize-5829';
const CHECK = 'scripts/eval/results/tengyur-check-2026-10';

const analysis = R(`${RES}/analysis.json`);
const counts = R(`${RES}/counts.json`);
const key = R(`${RES}/key.json`);
const residue = R(`${CHECK}/residue-listed-not-repaired.json`);
const unclear = R(`${CHECK}/unclear-words-listed-not-repaired.json`);

/** Below this many sample pages a section gets no rate of its own (#6120). */
const MIN_PAGES = 10;
const KINDS = ['reversal', 'agent', 'term', 'omission', 'addition', 'structure', 'gloss'];

// Error kinds per section, ranked by the mean of the two reviewers' counts. Only the order is published;
// the rates are analysis.json's (either-reviewer, matched), which does not break out every kind by section.
const kindCounts = {};
for (const f of fs.readdirSync(path.join(ROOT, RES, 'reviews')).sort()) {
  for (const item of R(`${RES}/reviews/${f}`)) {
    const k = key[item.id];
    if (!k || k.type !== 'SAMPLE') continue;
    const c = (kindCounts[k.section] ||= Object.fromEntries(KINDS.map((t) => [t, 0])));
    for (const e of item.errors || []) if (e.type in c) c[e.type] += 0.5;
  }
}
const ranked = (section) => {
  const c = kindCounts[section];
  if (!c) return [];
  return KINDS.filter((t) => c[t] > 0).sort((a, b) => c[b] - c[a] || KINDS.indexOf(a) - KINDS.indexOf(b));
};

const r1 = (x) => Math.round(x * 10) / 10;
const pick = (c) => ({ n: c.pages, rev_agent_per100: c.rev_agent_per100_either });
const sections = {};
for (const [name, s] of Object.entries(counts.by_section)) {
  const m = analysis.sample_by_section[name];
  const n = m?.pages ?? 0;
  sections[name] = {
    corpus_pages: s.with_english,
    volumes: s.vols,
    n,
    rated: n >= MIN_PAGES,
    ...(m ? {
      light: m.share_light, work: m.share_work, specialist: m.share_specialist,
      light_ci: m.share_light_ci,
      rev_agent_per100: m.rev_agent.errors_per100_either,
      rev_agent_ci: m.rev_agent.errors_per100_either_ci,
      reversal_per100: m.reversal.errors_per100_either,
      agent_per100: m.agent.errors_per100_either,
      term_per100: m.term.errors_per100_either,
      top_kinds: ranked(name),
    } : {}),
    // The $0 detector that is decisive (#5829 Result 6): Pali offence-class names in this Sanskrit-tradition canon.
    pali_pages: analysis.detectors_corpus[name]?.c_pali ?? 0,
  };
}

const all = analysis.by_item_type.SAMPLE;
const head = analysis.headline_rev_agent_per100.either_strict;
const out = {
  _generated: `by scripts/eval/tengyur-characterize/build-disclosure.mjs from ${RES}/ and ${CHECK}/ — do not edit by hand`,
  measured: counts.measured_at.slice(0, 10),
  method: 'scripts/eval/experiments/2026-10-04-tengyur-characterize-random-sample-5829.md',
  issue: 5829,
  min_pages: MIN_PAGES,
  sample: {
    n: all.pages,
    population: counts.total_with_english,
    light: all.share_light, work: all.share_work, specialist: all.share_specialist,
    light_ci: all.share_light_ci,
    rev_agent_per100_adjusted: head.point,
    rev_agent_ci_adjusted: head.ci,
    rev_agent_pages_pct: all.rev_agent.pages_with_either_pct,
  },
  // Reversal/agent findings per 100 pages (either reviewer) by how much of the page is verse.
  verse: {
    prose: pick(analysis.sample_by_covariate['prose (< 10% verse)']),
    mostly_verse: pick(analysis.sample_by_covariate['verse ≥ 50%']),
  },
  reviewers: {
    who: 'two independent Claude Opus reviewers reading the Tibetan, blind to each other; no human scholar yet',
    precision_pct: Math.round(analysis.spotcheck.all.precision_strict * 100),
    precision_ci: analysis.spotcheck.all.strict_ci,
    planted_recall_pct: analysis.controls.PLANT_recall.by_kind.all.per_review_recall_pct,
    kappa: r1(analysis.agreement.sample.verdict.kappa * 100) / 100,
  },
  // The #5797 residue: listed, not repaired, measured on the 2026-10-04 05:35Z dump.
  defects: {
    measured: '2026-10-04',
    issue: 5797,
    unclear_guess_tags: unclear.count,
    colophon_missing_ending: residue.colophon_side_english_omits_ending.length,
    body_text_in_note: residue.body_text_swallowed_into_note_ge12_words.length,
    tibetan_outside_notes: residue.tibetan_left_outside_notes_ge20.length,
    vinaya_pali_pages: sections.Vinaya?.pali_pages ?? 0,
    vinaya_pali_pct: analysis.detectors_corpus.Vinaya ? r1(analysis.detectors_corpus.Vinaya.c_pali_pct) : 0,
  },
  // Tibetan section word in a volume title → section, the sampler's own table.
  section_words: SECTIONS,
  sections,
};

// The title table must reproduce the sampler's volume → section assignment exactly.
const bad = counts.by_volume.filter((v) => !(v.section in sections));
if (bad.length) throw new Error(`volumes with an unknown section: ${bad.map((v) => v.vol).join(', ')}`);
if (sectionOf('བསྟན་འགྱུར། སྡེ་དགེ། ཚད་མ། ཅེ (Derge Tengyur, vol. 174)') !== 'Pramāṇa') throw new Error('sectionOf drifted');

const text = JSON.stringify(out, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(path.join(ROOT, OUT)) ? fs.readFileSync(path.join(ROOT, OUT), 'utf8') : '';
  if (current !== text) {
    console.error(`${OUT} does not match its inputs. Run: node scripts/eval/tengyur-characterize/build-disclosure.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} is current`);
  process.exit(0);
}
fs.writeFileSync(path.join(ROOT, OUT), text);
console.log(`wrote ${OUT}: ${Object.keys(sections).length} sections, ${Object.values(sections).filter((s) => s.rated).length} rated`);
