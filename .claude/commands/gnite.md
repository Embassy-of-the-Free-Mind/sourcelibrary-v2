---
description: "Wrap up the session: commit, push, reap, hand off."
# Wrap-up is routine; don't spend scarce Fable quota on it. Applies to this command's turn only.
model: opus
---
Wrap up the session: commit, push, reap, hand off.

"gnite" means **this window is closing** — not that every window is. Other Claude
sessions are usually still running, and that's fine: every step below is safe to run
concurrently with them. No new work, no questions, no strategic advice.

**Closing the window kills everything that lives only in it.** Finishing is the point of
gnite: work in flight is either done, or handed to something that outlives the window,
before you say goodnight. "No new work" means don't *start* anything — not "stop mid-task".

## 0. Inventory what is in flight — nothing dies silently

List every open loop this window owns, then settle each one:

- **Background tasks and monitors started here** (`run_in_background` Bash, Monitor, a
  build/CI watcher, a `/loop`). They die with the window. If the result matters, get it
  now if it's minutes away (a build finishing, a check going green); otherwise move it to
  something durable — `claude --bg`, a Hetzner cron, a scheduled agent — that writes its
  result to an issue or file, never to this chat.
- **Promises made in this chat** ("I'll tell you when CI is green", "I'll ping when the
  build is Ready"). Keep it now, or turn it into a durable owner and say who that is.
- **Half-done work**: an open PR not yet green (babysit it to green or hand it off),
  a merge whose production build isn't verified, a data push not read back, a
  paid job not reconciled.
- **Background sessions (`claude --bg`) keep running — never stop, reap, or wait on them.**
  List them (`claude agents`) and name each in the goodnight with where it reports.

Then give every loose end exactly **one** owner — a handoff file alone is not one
(September 2026: 214 ops handoffs, 98 saying "not run / blocked / awaiting", and 81
background sessions dead mid-task that nobody noticed; inventory #5354):

- **Finish it now** if it is under ~15 minutes (merge the green PR, apply the label,
  run the one command). This is the default.
- **An active issue** — open or update one, with the definition of done and the next
  command to run, and put `Owner: #<issue>` on any handoff you write.
- **A dispatched session** — `claude --bg "Read <handoff> and execute to done"`, and
  check its `state.json` two minutes later; a `blocked` there is not a dispatch.
- **A decision row** in the ops `DECISIONS-PENDING.md`, with a recommended default,
  if it is above the spend floor or on the hold list.

What you may not do is close with "next steps" in prose and no owner. The goodnight
never hides an open loop.

## 0. Exposure — what closing the tab, sleeping, or powering off would lose

Derek closes the lid a lot, and he decides whether to from this answer, so it comes
FIRST. Run the machine-wide report, then add what only this session can see:

```
bash ~/.claude/scripts/gnite-exposure.sh "$(git rev-parse --show-toplevel)"
```

The script lists background Claude sessions working on this laptop, detached
`nohup` jobs, and every worktree with uncommitted or unpushed work. It cannot see
this session's own background tasks, monitors, or subagents — list those yourself.
Then answer, one line each, with counts:

- **close this tab →** this session's background tasks, monitors and subagents die;
  everything else survives.
- **sleep the laptop →** background sessions stall (the `bg-resume` sweep revives the
  ones that died on sleep, a limit, or the network within ~30 min of waking); detached
  jobs pause, and one holding a remote stream may drop.
- **power off →** every background session and detached job dies; uncommitted files and
  unpushed commits stay on this disk only, invisible to every other machine.

Cloud sessions (`claude --cloud`) and Hetzner sessions are never at risk from the
laptop. If the script is missing (another machine), say so and answer from `claude
agents` and `git status` instead.

## 1. Commit and push whatever is here

- `git status` — if there are uncommitted changes, commit them with a clear message
  and `Signed-off-by: JDerekLomas <j.d.lomas@tudelft.nl>` (the DCO bot blocks PRs without it).
- Push. If this is a worktree with a feature branch and the work is complete,
  open a PR (`gh pr create --base main`).
- **Never leave uncommitted work in a worktree** — it's invisible to every other session,
  and the reaper will keep the worktree around rather than touch it.
- **If this branch's PR carries `needs-rebase`, rebase it before wrapping**:
  `gh pr view --json labels -q '[.labels[].name]'`; if the label is there, `git fetch origin &&
  git rebase origin/main`, resolve (`main` wins every line you did not set out to change, then
  re-read the whole hunk for facts that now disagree with their neighbours), push with
  `--force-with-lease`, and check `npx tsc --noEmit`. If the conflict is in `scripts/eval/EXPERIMENTS.md`
  or `INDEX.md`, take main's version whole and move your entry into a new file under
  `scripts/eval/experiments/` — those two are generated on main now (#5436). A PR that conflicts on the day it is opened is
  the opener's job; left overnight it waits for a sweep, and 32 PRs since August were closed that
  way instead of finished (#5415).

## 2. Reap dead worktrees

Run from the main checkout:

```
node scripts/maintenance/reap-worktrees.mjs --apply --merged-only --prune-branches
```

This is safe with other windows open. The reaper decides by **occupancy**, not by
counting sessions: a worktree is kept if a live process has its cwd inside it, if its
git lock names a running pid, or if it holds real uncommitted work. Everything else is
an orphan whose session ended — which is exactly what accumulates, because a worktree
can't be removed while its PR is open, and the PR merges after the session is gone.

So each `gnite` cleans up after the *dead*, not after the living. One window at a time
is the intended cadence. `--merged-only` additionally keeps any worktree whose PR is
still open, so in-flight work survives even if its session ended.

Show the user what was removed, and surface anything kept for stranded uncommitted
work so they can deal with it. Don't pass `--force` — it exists only for the case
where `lsof` is unavailable and occupancy can't be determined.

## 3. Hand off if the session was complex

Write `.claude/handoffs/YYYY-MM-DD-topic.md` covering: files modified, task state,
test/deploy outcomes, what was agreed. Skip for short or routine sessions.

**This repo is public (AGPL).** Operational and business material — fundraising,
contacts, outreach, budgets, donors, sponsors — goes in the private
`sourcelibrary-ops` repo (`~/sourcelibrary-ops`), never here.

## 4. Reflect — three questions, and the first one is not about docs

This is the point of `gnite` beyond tidying: the session is over, the lesson is fresh,
and nobody will ever be better placed to write it down or throw it away. Ask **all
three**. The doc question alone is why `CLAUDE.md` grew from ~290 lines to 827 in three
months — and, less obviously, why lessons that *were* written down still recurred.

**First — could this lesson be a CHECK instead of a sentence?** A doc is the weakest
layer: it works only if the next person reads it at the moment it applies. Measured on
2026-08-21, three of that session's four findings were classes where the doc already
existed and did not prevent recurrence — `csp-img-hosts.ts` says "one edit, both layers"
and the second resolver still never screened (#4163); #3293 says "validate a counter
against the READ path" and `pages_archived` drifted 4.7× anyway (#4190). So before
writing prose, ask whether the lesson can **fail loudly** instead:

- a test that sweeps a directory and asserts the property — 21 of 214 unit tests already
  do this (`csp-image-hosts.test.ts` over `next.config.ts`,
  `locale-prefix-not-tenant.test.ts` over `src/app/`)
- a detector or cron that files what it finds
- a constructor that throws on bad input (`makeBookDoc()` / `makePageDoc()`)
- a script that refuses to run without its guard

If a check is possible, build it, and let the doc be one line pointing at it.

**But do not reflex into a bad test.** Read `invariants/tests-that-are-not-guards.md`
first: a guard whose only failure mode is "someone deleted this line" is documentation
with a green checkmark. Run the negative control — delete the guarded line, watch the
test go red, restore it — or you have shipped a decoration.

**And know when prose is right.** A guard is the wrong tool when the lesson is about
**judgment** rather than mechanism. "Hand-check the largest cluster before quoting a
rate" and "ask which size tier a surface uses before calling it broken" cannot be
asserted, and both earned their keep the day they were written. The discriminator: if you
can name the file or symbol that must hold the property, it is a check; if the trigger is
a human about to draw a conclusion, it is a doc.

**Up — does `CLAUDE.md` or an invariant doc need something new?** If this session hit a
non-obvious failure that would bite the next person, PR the doc change now. Otherwise
the lesson lives only in the handoff and decays. Decide *which tier*:

- Applies no matter what you're working on → `CLAUDE.md`.
- Fires only when you touch a subsystem → a new or existing
  `.claude/docs/invariants/<name>.md`, with a one-line trigger entry added to the
  routing table in `CLAUDE.md`. **If you can name the file or subsystem that triggers
  the rule, it goes here.**

**Down — is anything in `CLAUDE.md` no longer earning its place?** Do not skip this
because nothing feels wrong; it never feels wrong. Concretely:

- `wc -w CLAUDE.md` — the budget is **~5,500 words** (words, not lines: the line cap was
  gamed by joining essays into single 3,800-char lines). Over it, something must be
  demoted to `invariants/` before anything is added.
- Did this session read a section that turned out to be **conditional**? Demote it.
- Did it hit a rule that **contradicts** another, or a second write-up of the same
  incident under a different aphorism? Merge them — don't append a correction beside the
  thing it corrects.
- Did it find a **stale stat, dead pointer, or fixed-and-closed backlog** stated as
  current? Fix it in place, in this repo *and* in `~/.claude/CLAUDE.md` if it appears
  there too. A rule in two files diverges; check the twin.
- Anything dated more than ~14 days that this session actually depended on: re-measure
  or mark it unverified.

**Then sweep the private memory store.** `~/.claude/projects/<project>/memory/` is
per-machine and gitignored, and it accretes faster than the repo does:

- New entries from this session: is any of it **team knowledge**? Run
  `/promote-lessons` to propose moving it into the repo (or the ops repo). A lesson only
  Claude-on-this-machine knows is one laptop away from being lost.
- `MEMORY.md` is loaded every session — keep it a one-line-per-memory index. Entries
  that have gone cold move down into the `_index-*.md` recall tier rather than being
  deleted.
- Contradictions and superseded entries: delete or correct them. A wrong memory is
  worse than a missing one, because it is trusted.
- `/audit-memory` does this systematically when it's been a while.

Keep this pass short — a couple of minutes. It is a *sweep*, not a project. If it turns
up something big, file an issue rather than starting work.

## 5. Say goodnight

A short summary of where we left off and what's next, plus **what is still running and who
owns it** (from step 0) — or "nothing left in flight". That's all.
