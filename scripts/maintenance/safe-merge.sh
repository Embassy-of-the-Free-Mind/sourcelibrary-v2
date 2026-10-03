#!/usr/bin/env bash
# Merge PRs by hand without repeating the two mistakes that #5711 records.
#
# PRIOR ART: scripts/maintenance/auto-merge.mjs — the machine merge for
# `tier:auto` PRs only (it picks the PR itself, one per run, gated on labels and
# settle time). This is the HUMAN path for the PRs you name, e.g. `tier:hold`
# after Derek reads them. Same interlock and merge style; the retarget step is new.
#
# The two repeat incidents (2026-10-01 and 2026-10-02), each broken twice:
#   1. `gh pr merge --delete-branch` on a PR that another PR is stacked on
#      deletes that PR's base, and GitHub CLOSES the stacked PR (#5587 -> #5589,
#      #5432 -> #5434). So every open PR whose base is the head branch is
#      retargeted to main BEFORE the merge.
#   2. `entities-sweep-active.mjs | tail -1; echo $?` read tail's exit code,
#      not the interlock's, and two PRs were merged into an active sweep. So the
#      interlock runs bare, its own exit code is read, and anything but 0 —
#      including 2, UNKNOWN — refuses.
#
# Per PR, in order (the first refusal stops the whole run, later PRs included):
#   - entities interlock exits 0, re-run for every PR (a sweep can start between)
#   - PR is OPEN, not a draft, has no `blocked` label, and its base is main
#   - mergeable=MERGEABLE and mergeStateStatus=CLEAN; UNKNOWN is waited out,
#     never read as clean (GitHub recomputes lazily after every merge to main).
#     A non-CLEAN state is accepted only when every non-passing check is
#     finished, failed, and named with --allow-check.
#   - open PRs based on the head branch are retargeted to main, and re-listed
#   - squash merge with --delete-branch, pinned to the head sha that was checked
#   - prints the merge sha and the command that shows THAT commit's Vercel build
#
# USAGE
#   scripts/maintenance/safe-merge.sh [--allow-check NAME]... [--dry-run] <pr> [<pr>...]
#   exit 0 = all merged · 1 = refused (nothing after it was touched) · 2 = usage
#
# gh is always called with --repo, which also stops `gh pr merge` from
# checking out main in your local checkout (it skips local-branch cleanup when
# --repo is given) — that would fail in a worktree, and must never happen in
# the shared main directory.
#
# Env: SAFE_MERGE_REPO (default Embassy-of-the-Free-Mind/sourcelibrary-v2),
#      SAFE_MERGE_POLL_SECS (default 5), SAFE_MERGE_POLL_TRIES (default 24).

set -uo pipefail

REPO="${SAFE_MERGE_REPO:-Embassy-of-the-Free-Mind/sourcelibrary-v2}"
POLL_SECS="${SAFE_MERGE_POLL_SECS:-5}"
POLL_TRIES="${SAFE_MERGE_POLL_TRIES:-24}"
INTERLOCK=(node --env-file=.env.production.local scripts/audit/entities-sweep-active.mjs)
VIEW_FIELDS=number,title,state,isDraft,labels,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable,mergeStateStatus,statusCheckRollup

usage() { sed -n '/^# USAGE/,/^# exit/p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

ALLOW=()
DRY=0
PRS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --allow-check) [ $# -ge 2 ] || usage; ALLOW+=("$2"); shift 2 ;;
    --allow-check=*) ALLOW+=("${1#*=}"); shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown flag: $1" >&2; usage ;;
    *) [[ "$1" =~ ^[0-9]+$ ]] || { echo "not a PR number: $1" >&2; usage; }; PRS+=("$1"); shift ;;
  esac
done
[ ${#PRS[@]} -gt 0 ] || usage

# The interlock path and its env file are relative to the repo root.
cd "$(dirname "$0")/../.." || exit 2

refuse() { echo "REFUSED #$1: $2" >&2; echo "stopping; nothing after #$1 was touched." >&2; exit 1; }

# Decide from one `gh pr view` JSON: prints "OK <head> <sha> <cross> <note>",
# "WAIT <why>" or "REFUSE <why>". Allowed check names arrive one per line.
judge() {
  node -e '
    const pr = JSON.parse(process.argv[1]);
    const allowed = new Set(process.argv[2].split("\n").filter(Boolean));
    const out = (s) => { console.log(s); process.exit(0); };
    if (pr.state !== "OPEN") out(`REFUSE state=${pr.state}`);
    if (pr.isDraft) out("REFUSE draft");
    if ((pr.labels || []).some((l) => l.name === "blocked")) out("REFUSE has the `blocked` label");
    if (pr.baseRefName !== "main") out(`REFUSE base is ${pr.baseRefName}, not main — merge or retarget its parent first`);
    if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN" || !pr.mergeable)
      out(`WAIT mergeable=${pr.mergeable} mergeStateStatus=${pr.mergeStateStatus}`);
    if (pr.mergeable !== "MERGEABLE") out(`REFUSE mergeable=${pr.mergeable}`);
    const ok = `OK ${pr.headRefName} ${pr.headRefOid} ${pr.isCrossRepository ? 1 : 0}`;
    if (pr.mergeStateStatus === "CLEAN") out(`${ok} clean`);
    const BAD = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
    const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
    const failing = [], pending = [];
    for (const c of pr.statusCheckRollup || []) {
      const name = c.name || c.context;
      const result = c.conclusion || c.state;
      if (c.status && c.status !== "COMPLETED") pending.push(name);
      else if (BAD.has(result)) failing.push(name);
      else if (!PASS.has(result)) pending.push(name);
    }
    const unknown = failing.filter((n) => !allowed.has(n));
    if (pending.length) out(`REFUSE mergeStateStatus=${pr.mergeStateStatus}; checks still running: ${pending.join(", ")}`);
    if (!failing.length) out(`REFUSE mergeStateStatus=${pr.mergeStateStatus} with no failing check (reviews? branch protection?)`);
    if (unknown.length) out(`REFUSE mergeStateStatus=${pr.mergeStateStatus}; failing: ${unknown.join(", ")} (pass --allow-check NAME only for a failure you know is not caused by this PR)`);
    if (!["UNSTABLE", "BLOCKED"].includes(pr.mergeStateStatus)) out(`REFUSE mergeStateStatus=${pr.mergeStateStatus}`);
    out(`${ok} allowed-failures:${failing.join(",")}`);
  ' "$1" "$(printf '%s\n' "${ALLOW[@]+"${ALLOW[@]}"}")"
}

# PR numbers (one per line) of open PRs whose base is $1.
stacked_on() {
  local json
  json=$(gh pr list --repo "$REPO" --base "$1" --state open --limit 100 --json number) || return 1
  node -e 'for (const p of JSON.parse(process.argv[1])) console.log(p.number)' "$json"
}

for pr in "${PRS[@]}"; do
  echo "== #$pr"

  # 1. Interlock — bare. No pipe, so $? is the interlock's own exit code.
  "${INTERLOCK[@]}"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    [ -f .env.production.local ] || echo "(no .env.production.local here — run from the main checkout, where the secrets live)" >&2
    refuse "$pr" "entities interlock exited $rc (0 = clear; 1 = active sweep; 2 = UNKNOWN, which is not clear)"
  fi

  # 2. Mergeability — wait out UNKNOWN, never treat it as clean.
  verdict=""
  for ((i = 1; i <= POLL_TRIES; i++)); do
    json=$(gh pr view "$pr" --repo "$REPO" --json "$VIEW_FIELDS") || refuse "$pr" "gh pr view failed"
    verdict=$(judge "$json") || refuse "$pr" "could not read gh pr view output"
    case "$verdict" in
      WAIT*) echo "  ${verdict#WAIT } — GitHub is still computing; retry $i/$POLL_TRIES in ${POLL_SECS}s"; sleep "$POLL_SECS" ;;
      *) break ;;
    esac
  done
  case "$verdict" in
    OK*) ;;
    WAIT*) refuse "$pr" "mergeability still UNKNOWN after $POLL_TRIES tries" ;;
    REFUSE*) refuse "$pr" "${verdict#REFUSE }" ;;
    *) refuse "$pr" "unexpected verdict: $verdict" ;;
  esac
  read -r _ head sha cross note <<<"$verdict"
  echo "  mergeable ($note), head $head @ ${sha:0:12}"

  # 3. Retarget everything stacked on the head branch BEFORE deleting it.
  #    A fork PR's head branch lives in the fork; --delete-branch cannot touch it.
  if [ "$cross" = 0 ]; then
    children=$(stacked_on "$head") || refuse "$pr" "could not list PRs based on $head"
    for child in $children; do
      if [ "$DRY" = 1 ]; then echo "  [dry-run] would retarget #$child: $head -> main"; continue; fi
      gh pr edit "$child" --repo "$REPO" --base main >/dev/null || refuse "$pr" "retargeting #$child to main failed"
      echo "  retargeted #$child: $head -> main"
    done
    if [ "$DRY" = 0 ]; then
      left=$(stacked_on "$head") || refuse "$pr" "could not re-list PRs based on $head"
      [ -z "$left" ] || refuse "$pr" "still based on $head after retarget: $(echo $left)"
    fi
  fi

  # 4. Merge, pinned to the sha that was judged (a later push makes this fail).
  if [ "$DRY" = 1 ]; then echo "  [dry-run] would squash-merge #$pr with --delete-branch"; continue; fi
  gh pr merge "$pr" --repo "$REPO" --squash --delete-branch --match-head-commit "$sha" || refuse "$pr" "gh pr merge failed"

  # 5. The merge sha, and the command that shows THIS commit's build.
  merge_sha=""
  for ((i = 1; i <= POLL_TRIES; i++)); do
    merge_sha=$(node -e 'const p = JSON.parse(process.argv[1]); console.log((p.mergeCommit && p.mergeCommit.oid) || "")' \
      "$(gh pr view "$pr" --repo "$REPO" --json mergeCommit)" 2>/dev/null)
    [ -n "$merge_sha" ] && break
    sleep "$POLL_SECS"
  done
  if [ -n "$merge_sha" ]; then
    echo "merged #$pr as $merge_sha"
    echo "  verify its build: npx vercel ls sourcelibrary-v2 --meta githubCommitSha=$merge_sha"
  else
    echo "merged #$pr, but its merge sha was not reported yet — find it with: gh pr view $pr --repo $REPO --json mergeCommit"
    echo "  then: npx vercel ls sourcelibrary-v2 --meta githubCommitSha=<sha>"
  fi
done
