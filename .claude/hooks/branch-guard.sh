#!/usr/bin/env bash
# Branch-safety guard (PreToolUse, matcher: Bash) — see CLAUDE.md "Multi-Session Awareness".
#
# Derek runs ~10 Claude Code sessions sharing the main working directory. A
# `git checkout <branch>` in that directory silently breaks every other session.
# The rule is absolute: the MAIN DIRECTORY STAYS ON `main`; feature work happens
# in worktrees (EnterWorktree / `git worktree add`).
#
# This hook BLOCKS (exit 2) any `git checkout`/`git switch` that would move the
# main directory off `main`. Allowed: switching TO `main`, file restores
# (`git checkout -- <file>` / `git restore`), and anything in a worktree.
#
# Worktrees are unaffected: `git worktree add` is not a checkout/switch, and
# branch switches inside a worktree have cwd != the main directory.
#
# It ALSO blocks, from ANY cwd (worktrees included), commands that force-move
# the shared `main` ref itself: `checkout -B main`, `switch -C main`,
# `branch -f/-D main`, `update-ref refs/heads/main`, `fetch ...:main`.
# On 2026-08-25 and 08-27 a `checkout -B main origin/main` run from a worktree
# moved the ref without updating the main checkout's index, stranding it on a
# 6-day-old tree with a 157-file phantom "staged" mass-revert.
# See .claude/docs/invariants/main-checkout-and-worktrees.md.

MAIN_DIR="/Users/dereklomas/sourcelibrary"

INPUT=$(cat)

# Parse cwd + command from the PreToolUse payload. On any parse failure, fail
# open (exit 0) — a guard must never wedge the whole session.
eval "$(printf '%s' "$INPUT" | python3 -c '
import json, sys, shlex
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cmd = d.get("tool_input", {}).get("command", "") or ""
cwd = d.get("cwd", "") or ""
print("CMD=" + shlex.quote(cmd))
print("CWD=" + shlex.quote(cwd))
' 2>/dev/null)"

[ -z "${CMD:-}" ] && exit 0

# ---- Ref guard: block force-moves of the shared `main` ref from ANY cwd. ----
# Cheap prefilter so we don't spawn python on every Bash call.
if printf '%s' "$CMD" | grep -q "git" && printf '%s' "$CMD" | grep -q "main"; then
  REF_DECISION=$(printf '%s' "$CMD" | python3 -c '
import sys, shlex
cmd = sys.stdin.read()
try:
    toks = shlex.split(cmd)
except Exception:
    print("ALLOW"); sys.exit(0)

def first_nonflag(args):
    return next((a for a in args if not a.startswith("-")), None)

verdict = "ALLOW"
for i, t in enumerate(toks):
    if t != "git":
        continue
    # Skip git-level options to find the subcommand.
    j = i + 1
    while j < len(toks):
        tj = toks[j]
        if tj in ("-C", "-c", "--git-dir", "--work-tree", "--namespace"):
            j += 2; continue
        if tj.startswith("-"):
            j += 1; continue
        break
    if j >= len(toks):
        continue
    sub, args = toks[j], toks[j + 1:]
    if sub in ("checkout", "switch"):
        # -B/-C/--force-create main  (also attached forms -Bmain / -Cmain)
        for k, a in enumerate(args):
            if a in ("-B", "-C", "--force-create") and k + 1 < len(args) and args[k + 1] == "main":
                verdict = "BLOCK"
            if a in ("-Bmain", "-Cmain") or a == "--force-create=main":
                verdict = "BLOCK"
    elif sub == "branch":
        flags = [a for a in args if a.startswith("-")]
        if any(f in ("-f", "--force", "-D", "-d", "--delete", "-M", "-m") for f in flags):
            if first_nonflag(args) == "main":
                verdict = "BLOCK"
    elif sub == "update-ref":
        if any(a in ("refs/heads/main",) for a in args):
            verdict = "BLOCK"
    elif sub == "fetch":
        if any(a.endswith(":main") or a.endswith(":refs/heads/main") for a in args):
            verdict = "BLOCK"
print(verdict)
' 2>/dev/null)
  if [ "$REF_DECISION" = "BLOCK" ]; then
    echo "BLOCKED: refusing to force-move, rename, or delete the shared 'main' ref." >&2
    echo "Moving 'main' from a worktree strands the main checkout: its index still describes the old commit, which surfaces as a phantom mass-revert 'staged' on main (this happened 2026-08-25 and 08-27)." >&2
    echo "To sync a worktree with current main: 'git fetch origin' and branch from 'origin/main'. Never take the 'main' ref itself." >&2
    exit 2
  fi
fi

# Only police commands that act on the main directory: either the session cwd is
# the main dir, or the command explicitly targets it via `git -C <main dir>`.
TARGETS_MAIN=0
[ "${CWD:-}" = "$MAIN_DIR" ] && TARGETS_MAIN=1
printf '%s' "$CMD" | grep -Eq "git[[:space:]]+-C[[:space:]]+$MAIN_DIR" && TARGETS_MAIN=1
[ "$TARGETS_MAIN" -eq 0 ] && exit 0

# Decide whether this is a branch-changing checkout/switch. Done in python so we
# can inspect the actual token sequence rather than guess with a regex.
DECISION=$(printf '%s' "$CMD" | python3 -c '
import sys, shlex
cmd = sys.stdin.read()
try:
    toks = shlex.split(cmd)
except Exception:
    print("ALLOW"); sys.exit(0)

# Find a "git checkout" / "git switch" verb (tolerate "git -C <dir> checkout"
# and other git-level options before the subcommand).
verb = idx = None
for i, t in enumerate(toks[:-1]):
    if t == "git":
        j = i + 1
        while j < len(toks):
            tj = toks[j]
            if tj in ("checkout", "switch"):
                verb, idx = tj, j; break
            if tj in ("-C", "-c", "--git-dir", "--work-tree", "--namespace"):
                j += 2              # option that consumes the next token
                continue
            if tj.startswith("-"):
                j += 1              # standalone git-level flag
                continue
            break                   # some other subcommand (status, log, ...)
    if verb:
        break

if not verb:
    print("ALLOW"); sys.exit(0)

args = toks[idx + 1:]

# File restore forms are fine: `git checkout -- <file>`, `git checkout . `,
# `git checkout <ref> -- <file>`.
if "--" in args:
    print("ALLOW"); sys.exit(0)
if args == ["."]:
    print("ALLOW"); sys.exit(0)

# Creating/switching-and-creating a branch in the main dir is also forbidden.
if any(a in ("-b", "-B", "-c", "-C") for a in args):
    print("BLOCK"); sys.exit(0)

# First non-flag arg is the target branch/ref.
target = next((a for a in args if not a.startswith("-")), None)
if target is None:
    print("ALLOW"); sys.exit(0)   # e.g. bare `git switch` with no branch
if target == "main":
    print("ALLOW"); sys.exit(0)   # returning to main is always safe

print("BLOCK")
' 2>/dev/null)

if [ "$DECISION" = "BLOCK" ]; then
  echo "BLOCKED: refusing 'git checkout/switch' to a non-main branch in the main directory ($MAIN_DIR)." >&2
  echo "The main checkout must stay on 'main' so Derek's other ~10 sessions don't break (see CLAUDE.md > Multi-Session Awareness)." >&2
  echo "Use EnterWorktree (or 'git worktree add') for feature-branch work. To restore a file, use 'git restore <file>' or 'git checkout -- <file>'." >&2
  exit 2
fi

# Not a blocking case. Keep the original advisory: if the main dir is somehow
# already off 'main' (e.g. a non-Claude terminal switched it), warn.
BRANCH=$(git -C "$MAIN_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$BRANCH" != "main" ] && [ -n "$BRANCH" ] && [ "${CWD:-}" = "$MAIN_DIR" ]; then
  echo "WARNING: Main directory is on branch '$BRANCH', not 'main'. Another session may have switched it. Use a worktree for feature-branch work." >&2
fi
exit 0
