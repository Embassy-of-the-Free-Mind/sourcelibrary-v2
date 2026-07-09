#!/usr/bin/env node
/**
 * Reap finished git worktrees.
 *
 * Worktrees accumulate because one can't be removed while its PR is still open,
 * and the PR usually merges AFTER the session that created it has ended — so
 * nothing is left around to remove the now-done worktree. This is the reaper:
 * it removes whatever no living process owns.
 *
 * Safety model (no committed work is ever lost):
 *   - OCCUPANCY, not session-counting. A worktree is "in use" iff some live
 *     process has its cwd inside it, or its git lock names a still-running pid.
 *     Asked per worktree, this is exact — so the reaper can run safely while
 *     other sessions are open, which is what makes a per-window /gnite reap work.
 *   - Removes only worktrees with NO real uncommitted work. Per-machine config
 *     and scratch outputs (.claude/, settings.local.json, scripts/output, _tmp*,
 *     vendor/lamejs-bundle) are treated as benign — not work.
 *   - KEEPS (and lists) any worktree with real uncommitted changes, so stranded
 *     work surfaces for a deliberate commit-or-discard.
 *   - `git worktree remove` leaves the BRANCH intact — commits survive; a removed
 *     worktree is just re-checkout-able. Only the working directory goes.
 *   - Stale locks (lock pid is dead) are unlocked and reaped. Live locks are kept.
 *     `git worktree remove --force` REFUSES a locked worktree (git wants -f -f);
 *     unlocking first is deliberate, so a live lock can never be forced away.
 *   - If occupancy can't be determined (no lsof), falls back to the old
 *     conservative "any other claude session ⇒ refuse" check. --force overrides.
 *
 * Usage:
 *   node scripts/maintenance/reap-worktrees.mjs                 # dry-run (default)
 *   node scripts/maintenance/reap-worktrees.mjs --apply         # remove unoccupied, clean worktrees
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
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * Every live process's cwd, in one call (~0.2s system-wide). Returns null if
 * lsof is unavailable, which the caller treats as "occupancy unknown".
 *
 * Over-inclusion is harmless here: a process whose cwd is not inside a worktree
 * blocks nothing. That's why this replaced counting `ps | grep -i claude` hits —
 * that count reached 34 on a machine with 3 real sessions (it matched the desktop
 * app, the dashboard, and MCP helpers), so --apply always refused and the habit
 * became --force, which is the actually dangerous flag.
 */
function liveCwds() {
  const out = sh('lsof -d cwd -Fpn 2>/dev/null');
  if (!out.trim()) return null;
  const cwds = [];
  let pid = null;
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid !== process.pid) cwds.push(line.slice(1));
  }
  return cwds;
}

// Fallback only: how many claude CLI sessions look active (excluding this script)?
function activeSessions() {
  const ps = sh('ps -eo command');
  const hits = ps.split('\n').filter((l) => /\bclaude\b/i.test(l) && !/reap-worktrees/.test(l) && !/\bgrep\b/.test(l));
  return Math.max(0, hits.length - 1);
}

// A worktree is occupied if a live cwd is at or beneath its path.
const cwds = liveCwds();
const occupiedBy = (p) => cwds && cwds.some((c) => c === p || c.startsWith(p + '/'));

// Parse `git worktree list --porcelain` into {path, branch, locked, lockPid}. The
// FIRST entry is always the primary checkout (the main working tree) — never reap
// it. (Don't use `git rev-parse --show-toplevel`: from inside a worktree it
// returns that worktree.) EnterWorktree writes its session pid into the lock
// reason, so a dead pid means the owning session ended and the lock is stale.
sh('git worktree prune');
const allWts = sh('git worktree list --porcelain').trim().split('\n\n').map((b) => {
  const lock = b.match(/^locked ?(.*)$/m);
  const lockPid = lock ? Number((lock[1].match(/pid (\d+)/) || [])[1]) : NaN;
  return {
    path: (b.match(/^worktree (.+)$/m) || [])[1],
    branch: (b.match(/^branch refs\/heads\/(.+)$/m) || [])[1],
    bare: /^bare$/m.test(b),
    locked: !!lock,
    lockReason: lock ? lock[1].trim() : '',
    lockPid: Number.isFinite(lockPid) ? lockPid : null,
  };
});
const main = allWts[0]?.path;
const wts = allWts.filter((w) => w.path && w.path !== main && !w.bare);

const keepInUse = [];     // a live process owns it — never touch
const keepReal = [];      // real uncommitted work — never auto-remove
const keepOpenPr = [];    // clean but PR still open (only when --merged-only)
let removable = [];

for (const w of wts) {
  const liveLock = w.locked && w.lockPid && alive(w.lockPid);
  if (w.path === here || occupiedBy(w.path) || liveLock) {
    keepInUse.push({ ...w, why: w.path === here ? 'current dir' : liveLock ? `lock held by live pid ${w.lockPid}` : 'live process cwd inside' });
    continue;
  }
  const st = sh('git status --porcelain', w.path).trim();
  const files = st ? st.split('\n').map((l) => l.slice(3)) : [];
  const real = files.filter((f) => !isBenign(f));
  if (real.length) keepReal.push({ ...w, real });
  else removable.push(w);
}

if (MERGED_ONLY) {
  const next = [];
  for (const w of removable) {
    // A detached worktree has no branch to look a PR up by — `gh pr list --head ""`
    // would match every open PR. Never infer "merged" from that; keep it.
    if (!w.branch) { keepOpenPr.push({ ...w, state: 'detached' }); continue; }
    const state = sh(`gh pr list --head "${w.branch}" --state all --json state --jq '.[0].state // "NONE"'`).trim();
    if (state === 'MERGED' || state === 'CLOSED') next.push(w);
    else keepOpenPr.push({ ...w, state });
  }
  removable = next;
}

const name = (p) => p.split('/').pop();
const ref = (w) => w.branch || 'detached';   // --detach worktrees have no branch
const staleLocked = removable.filter((w) => w.locked).length;
console.log(`worktrees: ${wts.length}  |  removable: ${removable.length}${staleLocked ? ` (${staleLocked} stale-locked)` : ''}  |  keep(in use): ${keepInUse.length}  |  keep(real work): ${keepReal.length}${MERGED_ONLY ? `  |  keep(open/no PR): ${keepOpenPr.length}` : ''}`);

if (cwds === null) console.log('\n· lsof unavailable — occupancy unknown, falling back to session-count check.');

if (keepInUse.length) {
  console.log('\n· KEEP — in use by a live process:');
  for (const k of keepInUse) console.log(`  ${name(k.path)} [${ref(k)}] (${k.why})`);
}
if (keepReal.length) {
  console.log('\n⚠ KEEP — real uncommitted work (commit/push or discard before reaping):');
  for (const k of keepReal.sort((a, b) => b.real.length - a.real.length))
    console.log(`  ${name(k.path)} [${ref(k)}] → ${k.real.slice(0, 4).join(', ')}${k.real.length > 4 ? ` +${k.real.length - 4} more` : ''}`);
}
if (keepOpenPr.length) {
  console.log('\n· KEEP — clean but PR still open / none (left for iteration):');
  for (const k of keepOpenPr) console.log(`  ${name(k.path)} [${ref(k)}] (${k.state})`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN — would remove ${removable.length} worktree(s) (branches ${PRUNE_BRANCHES ? 'deleted' : 'preserved'}):`);
  for (const w of removable) console.log(`  ${name(w.path)} [${ref(w)}]${w.locked ? ' (stale lock — will unlock)' : ''}`);
  console.log('\nRe-run with --apply to remove.');
  process.exit(0);
}

// Occupancy is exact, so it stands on its own. Only the no-lsof fallback needs
// the old blunt refusal.
if (cwds === null) {
  const active = activeSessions();
  if (active > 0 && !FORCE) {
    console.error(`\n✋ occupancy unknown and ${active} other claude session(s) appear active — refusing to reap (could yank a live working dir). Run when sessions are closed, or pass --force.`);
    process.exit(1);
  }
}

let removed = 0;
const keptBranches = [];
for (const w of removable) {
  // git refuses to remove a locked worktree even with --force (it wants -f -f).
  // Unlock explicitly — only stale locks reach here, live ones were kept above.
  if (w.locked) sh(`git worktree unlock "${w.path}"`);
  sh(`git worktree remove --force "${w.path}"`);
  if (!sh('git worktree list --porcelain').includes(w.path)) {
    removed++;
    console.log(`  removed ${name(w.path)}`);
    if (PRUNE_BRANCHES && w.branch) {
      // -D only where `gh` confirmed the PR merged/closed: squash-merges leave the
      // branch tip unreachable from main, so a plain -d would refuse them. Without
      // that confirmation, -d is the only safe delete — it declines unmerged work.
      const flag = MERGED_ONLY ? '-D' : '-d';
      sh(`git branch ${flag} "${w.branch}"`);
      if (sh(`git branch --list "${w.branch}"`).trim()) keptBranches.push(w.branch);
    }
  } else {
    console.log(`  FAILED  ${name(w.path)} (still present)`);
  }
}
sh('git worktree prune');
console.log(`\nReaped ${removed} worktree(s). Branches ${PRUNE_BRANCHES ? 'deleted where safe' : 'preserved (re-checkout any time)'}. Stale metadata pruned.`);
if (keptBranches.length) {
  console.log(`\n· ${keptBranches.length} branch(es) kept — not merged into main, so -d declined them:`);
  for (const b of keptBranches) console.log(`  ${b}`);
  console.log('  Re-run with --merged-only to delete the ones whose PR is merged, or delete by hand.');
}
