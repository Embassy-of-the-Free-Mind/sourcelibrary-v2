#!/usr/bin/env node
/**
 * Append-only ledgers conflict by construction — this finds the ones with no treatment.
 *
 * PRIOR ART: scripts/maintenance/pr-needs-rebase.mjs — labels the PRs that ARE
 * conflicting, after the fact, one PR at a time. Nothing looked at the FILES:
 * which paths keep producing those conflicts, and whether each has a merge
 * treatment. scripts/audit/field-sprawl.mjs is the same shape (history scan →
 * "a rule exists, is it followed?") for Mongo fields, not for git paths.
 *
 * WHY (#5436). On 2026-10-01, 6 of the 11 PRs labelled `needs-rebase` conflicted
 * on scripts/eval/EXPERIMENTS.md: every eval PR appended one entry to the same
 * tail, git calls two appends to one tail a conflict, and auto-merge never merges
 * a conflicting PR. The file had 62 commits in 60 days, 60 of them pure
 * insertions. A ledger like that WILL be added again — a "runs log", a
 * "decisions table", a CHANGELOG — and will collide the same way within weeks.
 * The two treatments that work:
 *   1. one file per entry, the ledger generated on main after merge
 *      (scripts/eval/experiments/ → EXPERIMENTS.md; INDEX.md from docstrings), or
 *   2. `merge=union` in .gitattributes (local rebases keep both sides; GitHub's
 *      own mergeability check ignores it, so this is the weaker treatment).
 *
 * WHAT IT FLAGS (history of `main` over --days, default 90):
 *   - a text file with ≥ --min-commits (8) commits of which ≥ --ratio (0.75)
 *     added lines and deleted none ("append-only"), and
 *   - a file whose head carries a GENERATED marker with ≥ --min-commits commits
 *     ("regenerated in every PR"),
 *   unless the path is union-merged in .gitattributes or regenerated on main.
 *
 * MODES
 *   node scripts/audit/append-only-ledgers.mjs            # report (exit 1 if anything is flagged)
 *   node scripts/audit/append-only-ledgers.mjs --pr 5436  # PR gate: a PR may not hand-edit a file
 *                                                         # that main regenerates; exit 1 if it does
 *   --days 90 --min-commits 8 --ratio 0.75 --json
 *
 * The PR gate allows a touched generated file ONLY when it equals the builder's
 * output for the PR's tree — a hand-added entry or a stale regeneration both fail
 * with the one-line fix. Needs full history (fetch-depth: 0) for the report; the
 * PR gate needs `gh` and the PR's tree checked out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const DAYS = Number(val('--days', 90));
const MIN_COMMITS = Number(val('--min-commits', 8));
const RATIO = Number(val('--ratio', 0.75));

/**
 * Files main regenerates after each merge (eval-ledgers-regenerate.yml). Each maps
 * to the command whose --check must pass for the file to be allowed in a PR diff.
 * Keep in step with that workflow: a file listed here and not regenerated there
 * silently goes stale; a file regenerated there and not listed here is flagged.
 */
export const REGENERATED_ON_MAIN = {
  'scripts/eval/EXPERIMENTS.md': ['node', 'scripts/eval/build-experiments.mjs', '--check'],
  'scripts/eval/INDEX.md': ['node', 'scripts/eval/build-index.mjs', '--check'],
};

const TEXT_EXT = /\.(md|mdx|txt|csv|tsv|jsonl|json|ya?ml)$/i;
const SKIP = [/^package(-lock)?\.json$/, /^src\/generated\//, /\/results\//, /^scripts\/eval\/store\//, /^\.claude\/worktrees\//];
const GENERATED_MARK = /<!--\s*GENERATED|^#\s*GENERATED|@generated|DO NOT EDIT|Do not hand-edit/im;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** Patterns from .gitattributes carrying merge=union, as RegExps over repo paths. */
export function unionPatterns(text) {
  return text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
    .filter((l) => /\bmerge=union\b/.test(l))
    .map((l) => l.split(/\s+/)[0])
    .map((pat) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'));
}

/** Per-file commit stats over the window: { commits, appendOnly }. */
export function appendStats(numstatLog) {
  // numstat log format: blank-separated commits, each: "<sha>" then "<added>\t<deleted>\t<path>" lines
  const stats = new Map();
  for (const block of numstatLog.split(/\n(?=[0-9a-f]{40}\n)/)) {
    const lines = block.trim().split('\n').slice(1);
    for (const l of lines) {
      const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const [, add, del, p] = m;
      if (add === '-' || del === '-') continue; // binary
      const s = stats.get(p) || { commits: 0, appendOnly: 0 };
      s.commits++;
      if (Number(del) === 0 && Number(add) > 0) s.appendOnly++;
      stats.set(p, s);
    }
  }
  return stats;
}

export function classify(stats, { tracked, isUnion, isRegenerated, headOf, minCommits = MIN_COMMITS, ratio = RATIO }) {
  const findings = [];
  for (const [p, s] of stats) {
    if (!tracked.has(p) || !TEXT_EXT.test(p) || SKIP.some((re) => re.test(p))) continue;
    if (s.commits < minCommits) continue;
    const treated = isUnion(p) ? 'union' : isRegenerated(p) ? 'regenerated-on-main' : null;
    const frac = s.appendOnly / s.commits;
    const appendOnly = frac >= ratio;
    const generated = GENERATED_MARK.test(headOf(p));
    if (!appendOnly && !generated) continue;
    findings.push({ path: p, commits: s.commits, appendOnly: s.appendOnly, fraction: +frac.toFixed(2), kind: appendOnly ? 'append-only' : 'generated-per-pr', treated });
  }
  return findings.sort((a, b) => b.commits - a.commits);
}

function report() {
  const since = `${DAYS}.days`;
  const log = git('log', `--since=${since}`, '--numstat', '--format=%H', '--no-merges', 'origin/main');
  const stats = appendStats(log);
  const tracked = new Set(git('ls-files').split('\n').filter(Boolean));
  const attrs = fs.existsSync('.gitattributes') ? fs.readFileSync('.gitattributes', 'utf8') : '';
  const union = unionPatterns(attrs);
  const headOf = (p) => { try { return fs.readFileSync(p, 'utf8').slice(0, 600); } catch { return ''; } };
  const findings = classify(stats, {
    tracked, headOf,
    isUnion: (p) => union.some((re) => re.test(p)),
    isRegenerated: (p) => p in REGENERATED_ON_MAIN,
  });
  // A generated ledger the regenerate workflow stopped rebuilding goes quietly stale;
  // nothing else reads the workflow's status, so the weekly report does.
  const stale = [];
  for (const [f, cmd] of Object.entries(REGENERATED_ON_MAIN)) {
    try { execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { stale.push({ path: f, said: (e.stderr || e.stdout || '').toString().trim().split('\n')[0] }); }
  }
  const open = findings.filter((f) => !f.treated);
  if (has('--json')) { console.log(JSON.stringify({ days: DAYS, minCommits: MIN_COMMITS, ratio: RATIO, findings, stale }, null, 2)); }
  else {
    console.log(`append-only-ledgers — last ${DAYS} days of origin/main, ≥ ${MIN_COMMITS} commits, ≥ ${Math.round(RATIO * 100)}% insertion-only\n`);
    if (!findings.length) console.log('no append-only or per-PR-regenerated ledgers found');
    for (const f of findings) {
      console.log(`${f.treated ? 'ok   ' : 'FLAG '} ${f.path}  ${f.commits} commits, ${f.appendOnly} insertion-only (${Math.round(f.fraction * 100)}%)  ${f.kind}${f.treated ? `  [${f.treated}]` : ''}`);
    }
    for (const s of stale) console.log(`STALE ${s.path}  does not match its builder on this tree — ${s.said} (is eval-ledgers-regenerate.yml running?)`);
    if (open.length) {
      console.log(`\n${open.length} untreated. Treatments (#5436): one file per entry + generate on main` +
        ` (scripts/eval/experiments/ is the model), or \`<path> merge=union\` in .gitattributes.`);
    }
  }
  process.exit(open.length || stale.length ? 1 : 0);
}

function prGate(pr) {
  const raw = execFileSync('gh', ['pr', 'view', String(pr), '--json', 'files', '--jq', '[.files[].path]'], { encoding: 'utf8' });
  const files = JSON.parse(raw);
  const touched = files.filter((f) => f in REGENERATED_ON_MAIN);
  if (!touched.length) { console.log(`PR #${pr} touches no generated ledger`); return; }
  let bad = 0;
  for (const f of touched) {
    const cmd = REGENERATED_ON_MAIN[f];
    try {
      execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      console.log(`PR #${pr} touches ${f}, and it equals the builder's output — allowed (but unnecessary: main regenerates it)`);
    } catch (e) {
      bad++;
      console.error(`PR #${pr} edits ${f}, which is GENERATED on main after merge and does not match the builder.`);
      console.error(`  Fix: drop your change to ${f} (git checkout origin/main -- ${f}) and put the entry in its source` +
        (f.endsWith('EXPERIMENTS.md') ? ' — ONE new file under scripts/eval/experiments/ (see its README.md).' : ' — the script docstring build-index.mjs reads.'));
      console.error(`  builder said: ${(e.stderr || e.stdout || '').toString().trim().split('\n')[0]}`);
    }
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (val('--pr')) prGate(val('--pr')); else report();
}
