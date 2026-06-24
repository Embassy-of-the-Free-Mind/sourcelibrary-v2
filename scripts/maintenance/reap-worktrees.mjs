#!/usr/bin/env node
/**
 * Reap finished git worktrees.
 *
 * Worktrees accumulate because one can't be removed while its PR is still open,
 * and the PR usually merges AFTER the session that created it has ended — so
 * nothing is left around to remove the now-done worktree. This is the reaper:
 * run it when sessions are idle and it removes the clutter SAFELY.
 *
 * Safety model (no committed work is ever lost):
 *   - Removes only worktrees with NO real uncommitted work. Per-machine config
 *     and scratch outputs (.claude/, settings.local.json, scripts/output, _tmp*,
 *     vendor/lamejs-bundle) are treated as benign — not work.
 *   - KEEPS (and lists) any worktree with real uncommitted changes, so stranded
 *     work surfaces for a deliberate commit-or-discard.
 *   - `git worktree remove` leaves the BRANCH intact — commits survive; a removed
 *     worktree is just re-checkout-able. Only the working directory goes.
 *   - --apply refuses to run while OTHER claude sessions look active (could yank a
 *     live cwd). Override with --force. Dry-run is always safe.
 *
 * Usage:
 *   node scripts/maintenance/reap-worktrees.mjs                 # dry-run (default)
 *   node scripts/maintenance/reap-worktrees.mjs --apply         # remove clean/benign worktrees
 *   node scripts/maintenance/reap-worktrees.mjs --apply --merged-only   # only those whose PR is merged/closed (keeps open-PR checkouts; needs gh)
 *   node scripts/maintenance/reap-worktrees.mjs --apply --prune-branches # also delete local branches whose worktree was reaped
 */
import { execSync } from 'child_process';

const has = (f) => process.argv.includes(f);
const APPLY = has('--apply');
const FORCE = has('--force');
const MERGED_ONLY = has('--merged-only');
const PRUNE_BRANCHES = has('--prune-branches');

const sh = (cmd, cwd) => { try { return execSync(cmd, { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return e.stdout || ''; } };

// Files that are NOT real work — per-machine config + scratch / generated output.
const BENIGN = [/(^|\/)\.claude\//, /(^|\/)settings\.local\.json$/, /(^|\/)node_modules\//, /(^|\/)scripts\/output\//, /(^|\/)_tmp/, /vendor\/lamejs-bundle\.js$/];
const isBenign = (f) => BENIGN.some((re) => re.test(f));

const here = process.cwd();

// Best-effort: how many claude CLI sessions look active (excluding this script)?
function activeSessions() {
  const ps = sh('ps -eo command');
  const hits = ps.split('\n').filter((l) => /\bclaude\b/i.test(l) && !/reap-worktrees/.test(l) && !/\bgrep\b/.test(l));
  // a single session may spawn helper processes; treat ">1 distinct hit" as "others active"
  return Math.max(0, hits.length - 1);
}

// Parse `git worktree list --porcelain` into {path, branch}. The FIRST entry is
// always the primary checkout (the main working tree) — never reap it. (Don't use
// `git rev-parse --show-toplevel`: from inside a worktree it returns that worktree.)
const allWts = sh('git worktree list --porcelain').trim().split('\n\n').map((b) => ({
  path: (b.match(/^worktree (.+)$/m) || [])[1],
  branch: (b.match(/^branch refs\/heads\/(.+)$/m) || [])[1],
  bare: /^bare$/m.test(b),
}));
const main = allWts[0]?.path;
const wts = allWts.filter((w) => w.path && w.path !== main && !w.bare);

const keepReal = [];      // real uncommitted work — never auto-remove
const keepOpenPr = [];    // clean but PR still open (only when --merged-only)
let removable = [];

for (const w of wts) {
  const st = sh('git status --porcelain', w.path).trim();
  const files = st ? st.split('\n').map((l) => l.slice(3)) : [];
  const real = files.filter((f) => !isBenign(f));
  if (real.length) keepReal.push({ ...w, real });
  else removable.push(w);
}

if (MERGED_ONLY) {
  const next = [];
  for (const w of removable) {
    const state = sh(`gh pr list --head "${w.branch}" --state all --json state --jq '.[0].state // "NONE"'`).trim();
    if (state === 'MERGED' || state === 'CLOSED') next.push(w);
    else keepOpenPr.push({ ...w, state });
  }
  removable = next;
}

const name = (p) => p.split('/').pop();
console.log(`worktrees: ${wts.length}  |  removable: ${removable.length}  |  keep(real work): ${keepReal.length}${MERGED_ONLY ? `  |  keep(open/no PR): ${keepOpenPr.length}` : ''}`);

if (keepReal.length) {
  console.log('\n⚠ KEEP — real uncommitted work (commit/push or discard before reaping):');
  for (const k of keepReal.sort((a, b) => b.real.length - a.real.length))
    console.log(`  ${name(k.path)} [${k.branch}] → ${k.real.slice(0, 4).join(', ')}${k.real.length > 4 ? ` +${k.real.length - 4} more` : ''}`);
}
if (keepOpenPr.length) {
  console.log('\n· KEEP — clean but PR still open / none (left for iteration):');
  for (const k of keepOpenPr) console.log(`  ${name(k.path)} [${k.branch}] (${k.state})`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN — would remove ${removable.length} worktree(s) (branches preserved):`);
  for (const w of removable) console.log(`  ${name(w.path)} [${w.branch}]`);
  const act = activeSessions();
  console.log(`\n${act > 0 ? `⚠ ${act} other claude session(s) appear active — reap when idle. ` : ''}Re-run with --apply to remove.`);
  process.exit(0);
}

const active = activeSessions();
if (active > 0 && !FORCE) {
  console.error(`\n✋ ${active} other claude session(s) appear active — refusing to reap (could yank a live working dir). Run when sessions are closed, or pass --force.`);
  process.exit(1);
}

let removed = 0;
for (const w of removable) {
  if (w.path === here) { console.log(`  skip (current dir): ${name(w.path)}`); continue; }
  sh(`git worktree remove --force "${w.path}"`);
  if (!sh('git worktree list --porcelain').includes(w.path)) {
    removed++;
    console.log(`  removed ${name(w.path)}`);
    if (PRUNE_BRANCHES && w.branch) sh(`git branch -D "${w.branch}"`);
  } else {
    console.log(`  FAILED  ${name(w.path)} (still present)`);
  }
}
sh('git worktree prune');
console.log(`\nReaped ${removed} worktree(s). Branches ${PRUNE_BRANCHES ? 'deleted' : 'preserved (re-checkout any time)'}. Stale metadata pruned.`);
