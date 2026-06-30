---
name: promote-lessons
description: Sweep Claude's private per-machine memory for team-relevant operational knowledge and propose moving it into the shared repo (or the private ops repo) as draft PRs. Use to promote lessons that accreted privately, or run on a schedule. Never auto-merges; never leaks.
---

# Promote private lessons into shared knowledge

Operational know-how accretes in Claude's **private, per-machine** auto-memory
(`~/.claude/projects/<project>/memory/`, gitignored). It only reaches teammates
when someone notices and copies it into the shared repo. This skill makes that a
systematic, proposing sweep instead of a reactive one.

It runs weekly via the "Weekly knowledge-promotion sweep" routine, and you can
invoke it any time with `/promote-lessons`.

## The capture-time rule (use this everywhere, not just here)

The test for **repo memory vs private memory** is:

> *Would a teammate's Claude need this to avoid taking a wrong action?*

If yes → it belongs in the shared repo. The pause state, the
selective-unpause-strands-hidden-books gotcha, and real per-book cost all pass.
Derek's preferences, the API-key map, and in-flight scratch do not. Bias
operational facts into repo `memory/` at `/lesson` time so there's less to sweep.

## Procedure

1. **Read the private store.** Open the index at
   `~/.claude/projects/<project>/memory/MEMORY.md` (for this project the path is
   `~/.claude/projects/-Users-dereklomas-sourcelibrary/memory/MEMORY.md`) and
   skim the topic files it points to.

2. **Classify each entry into one of three buckets:**
   - **TEAM-TECHNICAL** — operational facts a teammate's Claude would need to
     avoid a wrong action: pipeline state (e.g. the deliberate pause), footguns
     and gotchas, real costs, data invariants, where-things-live. → candidate
     for the **PUBLIC repo**: `memory/*.md` or `.claude/docs/`.
   - **OPS / BUSINESS** — fundraising, contacts, donors, outreach, budgets, PII,
     secrets, business strategy. → candidate for the **PRIVATE repo**
     `~/sourcelibrary-ops` ONLY. Never the public repo.
   - **PERSONAL / IN-FLIGHT / MACHINE-SPECIFIC** — user preferences, key maps,
     scratch state. → leave private, skip.

3. **Dedupe against what's already shared.** For each TEAM-TECHNICAL candidate,
   `grep` `memory/*.md` and `.claude/docs/*.md`. Skip facts already represented.

4. **Draft the additions.** For genuinely-missing TEAM-TECHNICAL facts, add a
   concise entry to the most relevant existing `memory/` file, or a new
   `.claude/docs/` file when it's a standalone runbook. Group related facts into
   **one** PR. For missing OPS/BUSINESS facts, add a note in `~/sourcelibrary-ops`.

5. **Open DRAFT PRs. Never merge. Never deploy.** Derek reviews and merges.

## Leak guard (hard constraint)

This repo is **public (AGPL)**. Never put secrets, API keys, PII, contacts,
donor/fundraising info, or business strategy into it. When unsure whether
something is shareable, route it to the private ops repo or skip it and flag it
for review. A false "leave private" is cheap; a leak is not.

## Mechanics

- The main checkout stays on `main`. Do all edits in a worktree:
  `git worktree add -b <branch> .claude/worktrees/<name> main`, then copy
  `src/lib/vendor/lamejs-bundle.js` into the worktree's `src/lib/vendor/` before
  the first commit (the pre-commit `check-imports` hook needs it).
- Sign commits off: `Signed-off-by: JDerekLomas <j.d.lomas@tudelft.nl>` (DCO).
- Open PRs with `gh pr create --draft`.

## Finish

Post a short summary: what was promoted (with draft-PR links), what was routed
to ops, and what was left private and why. If nothing qualifies, say so in one
line — a quiet week is a valid outcome.
