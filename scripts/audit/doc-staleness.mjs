#!/usr/bin/env node
/**
 * Doc staleness audit.
 *
 * `.claude/docs/knowledge-layer.md` states the rules this script checks:
 *
 *   - A date in the filename means snapshot, not doctrine — dated docs belong in
 *     `.claude/docs/archive/` once their work is done.
 *   - Undated docs are living: they must describe how the system works *now*.
 *   - Stats older than 14 days are to be verified before use, not quoted.
 *
 * Prose invariants get violated by whoever didn't read the prose, so this is the
 * machine check. It reports three things:
 *
 *   1. ORPHANS      — living docs with zero inbound references from tracked files.
 *   2. ARCHIVE      — dated docs still sitting outside archive/, with their inbound
 *      CANDIDATES     references listed so you can see what would break.
 *   3. STALE STATS  — lines in the auto-loaded files (CLAUDE.md, memory/) that pair
 *                     an old date with a quantity. These are load-bearing because
 *                     they're read into every session's context as if current.
 *
 * ARCHIVING IS A DELETION-CLASS ACTION. This script never moves or deletes a file.
 * An orphan or an archive candidate is a *candidate*, never an instruction: of the
 * eleven dated audits that motivated the convention, five were still referenced by
 * code, and `.claude/docs/bph-cover-audit-2026-05-11.md` is a WRITE TARGET of
 * `scripts/audit/bph-cover-quality.mjs`, not merely a citation. Read the matching
 * lines before you move anything.
 *
 * Reference counting uses `git grep`, never `grep -r`. A plain `grep -r` over
 * `.claude/` descends into the dozens of full repo checkouts under
 * `.claude/worktrees/`, and `grep` on a contributor's machine may be ugrep, whose
 * `--exclude-dir` semantics differ from GNU grep's. The same query returned 134
 * hits, then 0, then 2, during the audit that wrote this convention — and the "0"
 * nearly archived five live docs.
 *
 *   node scripts/audit/doc-staleness.mjs              # human-readable report
 *   node scripts/audit/doc-staleness.mjs --json       # machine-readable
 *   node scripts/audit/doc-staleness.mjs --stat-age 30
 *   node scripts/audit/doc-staleness.mjs --fail-on-findings   # exit 1 if anything found
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failOnFindings = args.includes('--fail-on-findings');
const statAgeDays = Number(
  args.includes('--stat-age') ? args[args.indexOf('--stat-age') + 1] : 14,
);

/**
 * Files an agent is directed to read as binding, so stale stats there mislead by default.
 * `CLAUDE.md` and `memory/` load unconditionally; `.claude/docs/invariants/` is the
 * conditional tier that `CLAUDE.md`'s routing table sends sessions to — it holds most of
 * the dated numbers that used to live in `CLAUDE.md` itself, and dropping it here would
 * have silently un-guarded them the day the split landed.
 */
const AUTO_LOADED = ['CLAUDE.md', 'memory', '.claude/docs/invariants'];
const DOCS_DIR = '.claude/docs';
const ARCHIVE_DIR = '.claude/docs/archive';

/** A date anywhere in the filename: 2026-05-12, 2026-05, or 2026-04. */
const DATED_FILENAME = /\d{4}-\d{2}(-\d{2})?/;

/**
 * The HUMAN tier: documents a person opens to understand the system, rather than
 * documents an agent is routed to mid-task.
 *
 * These rot in a way the auto-loaded tier does not, and the difference is
 * structural. An invariant is anchored to an incident, and incidents do not
 * change. An overview is full of counts and component names, and those change
 * weekly. So the tier above stays true by its nature and this one decays by its
 * nature — and until 2026-08-08 this audit only looked at the tier that was
 * fine. `ARCHITECTURE.md` had gone 8 months without a commit while describing
 * page images as living in MongoDB (they are in R2) and the corpus as
 * "primarily pre-1650 works" (it runs to the 19th century). Nothing flagged it,
 * because nothing was looking.
 */
const HUMAN_TIER = ['ARCHITECTURE.md', 'README.md', '.claude/docs/system-map.md'];

/**
 * How far the code may move under a human-tier doc before it is suspect.
 *
 * Age alone is a poor signal — a doc can be old and perfectly correct. What
 * matters is DRIFT: how much of the thing being described changed while the
 * description sat still. So this counts commits touching `src/` since the doc's
 * own last commit.
 *
 * CALIBRATED FROM MEASUREMENT, not chosen for roundness. This repository lands
 * roughly 14–18 `src/` commits a day, so a threshold of 400 — the first value
 * tried — fires on any doc left alone for a month, which is ordinary and not a
 * defect. A check that cries monthly is how people learn to pass `--force`; the
 * worktree reaper already taught that lesson here.
 *
 * 1,500 is about a quarter's worth. The failure this exists to catch scored
 * **4,122**: that is how many `src/` commits accumulated under `ARCHITECTURE.md`
 * between 2025-12-25 and 2026-08-08 while it described page images as living in
 * MongoDB. A real case should trip a guard by a wide margin, not squeak past it.
 */
const DRIFT_COMMITS = Number(
  args.includes('--drift-commits') ? args[args.indexOf('--drift-commits') + 1] : 1500,
);

function git(...argv) {
  try {
    return execFileSync('git', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // git grep exits 1 on "no matches" — that is a result, not a failure.
    if (err.status === 1) return '';
    throw err;
  }
}

const lines = (s) => s.split('\n').filter(Boolean);

/**
 * Inbound references to a doc, by basename, across tracked files.
 *
 * Excludes the doc itself and the archive: a citation from an archived snapshot
 * does not keep a living doc alive. Returns `file:line:text` so a human can judge
 * whether the reference is a citation or a code dependency.
 */
function inboundRefs(path) {
  const name = basename(path);
  const out = git(
    'grep',
    '-nF',
    name,
    '--',
    ':!' + path,
    ':!' + ARCHIVE_DIR,
  );
  return lines(out);
}

function livingDocs() {
  return lines(git('ls-files', DOCS_DIR + '/*.md')).filter(
    (p) => !p.startsWith(ARCHIVE_DIR + '/'),
  );
}

/**
 * Lines pairing a date older than the threshold with a quantity.
 *
 * A bare date is usually an incident date and stays true forever ("fixed on
 * 2026-05-24"). A date next to a *number* is a measurement, and measurements rot:
 * "~46K total docs, ~29K visible (2026-05-26)" is quoted into every session as
 * though someone re-counted this morning.
 */
function staleStats(cutoff) {
  const paths = lines(git('ls-files', ...AUTO_LOADED));
  const hasQuantity = /(\d[\d,.]*\s*[%KMB]\b)|(~\s*\d)|(\b\d{3,}\b)/;
  const findings = [];

  // Three things look like quantities and never rot: PR/issue refs (#1980), the
  // dates themselves, and digits inside a path (…-2026-05-25-pr1980-split.md).
  // Left in, they bury the ~12 real measurements under ~50 citations, and a report
  // that cries wolf gets muted — which is how the stat went stale in the first place.
  const notAQuantity = [
    /\bPRs?\s*#[\d/#\s]+/gi,
    /\bissues?\s*#[\d/#\s]+/gi,
    /#\d+/g,
    /`[^`]*`/g, // inline code: filenames, field names, commit hashes
    /\[[^\]]*\]\([^)]*\)/g, // markdown links
    /\S*\.(md|json|mjs|ts|tsx|sql|sh|yml)\b/g,
    /\b\d{4}-\d{2}(-\d{2})?\b/g,
  ];

  // A dated past-tense lesson ("Lambda timeout (2026-03-13): books >500 pages
  // exceed the 15min limit") is provenance and stays true. What rots is a line
  // asserting a CURRENT measurement — it is quoted as though someone re-counted
  // this morning. The cue is an as-of marker, so require one.
  const assertsCurrent = /\b(as of|snapshot|currently|at present|today|live count|last (measured|counted|checked))\b/i;

  for (const path of paths) {
    if (!path.endsWith('.md')) continue;
    // Read the WORKING TREE, not HEAD. `git grep` above resolves tracked paths against
    // the working tree, and a check that can't see the fix you just made is a check
    // people stop running.
    const content = readFileSync(path, 'utf8');
    content.split('\n').forEach((text, i) => {
      const dates = text.match(/\b\d{4}-\d{2}(-\d{2})?\b/g);
      if (!dates || !assertsCurrent.test(text)) return;
      const stripped = notAQuantity.reduce((s, re) => s.replace(re, ' '), text);
      if (!hasQuantity.test(stripped)) return;
      // Judge a line by its NEWEST date: "changed in 2026-03, re-measured 2026-07"
      // is current, and flagging it would train people to ignore the report.
      const newest = dates
        .map((d) => new Date(d.length === 7 ? `${d}-01` : d))
        .sort((a, b) => b - a)[0];
      if (Number.isNaN(newest.getTime()) || newest >= cutoff) return;
      findings.push({
        path,
        line: i + 1,
        date: newest.toISOString().slice(0, 10),
        text: text.trim().slice(0, 160),
      });
    });
  }
  return findings;
}

/**
 * Human-tier docs, with how far `src/` moved since each was last touched.
 *
 * Reports every one of them, not only the drifted — a short list a person can
 * read in full is more useful here than a filtered alarm, and seeing a doc sit
 * at zero drift is the reassurance the alarm cannot give.
 */
function humanTierDrift() {
  return HUMAN_TIER.map((path) => {
    const last = git('log', '-1', '--format=%cI', '--', path).trim();
    if (!last) return { path, missing: true, drift: 0, days: 0, last: null };
    // `--since`, not `<date>..HEAD` — a timestamp is not a revision, and git
    // rejects it outright rather than resolving it to the nearest commit.
    const drift = lines(git('log', '--format=%H', `--since=${last}`, 'HEAD', '--', 'src')).length;
    const days = Math.round((Date.now() - new Date(last).getTime()) / 86400_000);
    return { path, missing: false, last: last.slice(0, 10), days, drift, over: drift >= DRIFT_COMMITS };
  });
}

function main() {
  const cutoff = new Date(Date.now() - statAgeDays * 86400_000);

  const docs = livingDocs();
  const orphans = [];
  const archiveCandidates = [];

  for (const path of docs) {
    const refs = inboundRefs(path);
    if (refs.length === 0) orphans.push({ path, refs });
    if (DATED_FILENAME.test(basename(path))) {
      archiveCandidates.push({ path, refs });
    }
  }

  const stats = staleStats(cutoff);
  const humanTier = humanTierDrift();
  const drifted = humanTier.filter((d) => d.over || d.missing);
  const report = {
    generated_from_commit: git('rev-parse', '--short', 'HEAD').trim(),
    living_docs: docs.length,
    archived_docs: lines(git('ls-files', ARCHIVE_DIR + '/*.md')).length,
    stat_age_days: statAgeDays,
    drift_commits_threshold: DRIFT_COMMITS,
    orphans,
    archive_candidates: archiveCandidates,
    stale_stats: stats,
    human_tier: humanTier,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const { living_docs, archived_docs } = report;
    console.log(`\nDoc staleness audit — ${report.generated_from_commit}`);
    console.log(`${living_docs} living docs, ${archived_docs} archived\n`);

    console.log(`ORPHANS — ${orphans.length}/${living_docs} living docs with zero inbound refs`);
    console.log('  Not a delete list. A doc can be young, or linked only from prose a');
    console.log('  human reads. Ask: would the next session find this when they need it?\n');
    for (const { path } of orphans) console.log(`    ${path}`);

    console.log(`\nARCHIVE CANDIDATES — ${archiveCandidates.length} dated docs outside archive/`);
    console.log('  DELETION-CLASS. Read the inbound lines: a reference from a *script* is a');
    console.log('  dependency, not a citation. Moving that file breaks the script.\n');
    for (const { path, refs } of archiveCandidates) {
      console.log(`    ${path}  (${refs.length} inbound)`);
      for (const r of refs.slice(0, 6)) console.log(`        ${r.slice(0, 150)}`);
      if (refs.length > 6) console.log(`        … ${refs.length - 6} more`);
    }

    console.log(`\nSTALE STATS — ${stats.length} lines older than ${statAgeDays}d pairing a date with a number`);
    console.log('  These are read into every session as if current. Re-measure or re-date.\n');
    for (const s of stats) console.log(`    ${s.path}:${s.line}  [${s.date}]  ${s.text}`);

    console.log(`\nHUMAN TIER — docs a person opens to understand the system`);
    console.log(`  Flagged at ${DRIFT_COMMITS}+ commits to src/ since the doc last changed. Age alone`);
    console.log('  says little; drift says how far the thing moved while the description sat still.\n');
    for (const d of humanTier) {
      if (d.missing) { console.log(`    ✗ ${d.path}  — not tracked`); continue; }
      const mark = d.over ? '✗' : '✓';
      console.log(`    ${mark} ${d.path.padEnd(30)} last ${d.last} (${d.days}d)  ${String(d.drift).padStart(5)} src/ commits since`);
    }
    console.log('');
  }

  const total = orphans.length + archiveCandidates.length + stats.length + drifted.length;
  if (failOnFindings && total > 0) process.exit(1);
}

main();
