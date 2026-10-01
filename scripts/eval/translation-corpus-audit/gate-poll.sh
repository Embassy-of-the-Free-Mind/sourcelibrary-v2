#!/usr/bin/env bash
# PRIOR ART: /root/speedtest-a/tick.mjs's hourly guard reads /root/speedtest-a/ABORT; nothing WROTE that file without
# a laptop session. This is the return half of the lid-proof gate (GATE.md): it reads the verdicts the claude.ai
# routine pushed to eval/speedtest-a-gate-windows and acts on them on the box itself —
#   ABORT       → writes /root/speedtest-a/ABORT (the :05 guard drops the dial to $5) + comments on #4681
#   every row   → appends to costs/speed-test-a-quality.jsonl in the private ops repo, commit by path, push
#   no verdict 3 h after a draw → one STALE comment on #4681 (the routine did not run; nothing is aborted by silence)
# Cron: */10 via /etc/cron.d/speedtest-a-gate. Self-disables after 2026-10-04T06:00Z. $0 API.
set -uo pipefail
END=2026-10-04T06:00:00Z
[ "$(date -u +%s)" -gt "$(date -u -d $END +%s)" ] && exit 0
ROOT=/root/speedtest-a
REPO=$ROOT/gate-repo
OPS=$ROOT/ops-repo
BRANCH=eval/speedtest-a-gate-windows
SLUG=Embassy-of-the-Free-Mind/sourcelibrary-v2
OPS_SLUG=Embassy-of-the-Free-Mind/sourcelibrary-ops
ROWS=costs/speed-test-a-quality.jsonl
GIT_AUTH=(-c "credential.helper=" -c "credential.helper=!gh auth git-credential")
say() { echo "$(date -u +%FT%TZ) [poll] $*"; }
comment() { gh issue comment 4681 --repo "$SLUG" --body "$1" >/dev/null 2>&1 || say "WARN issue comment failed"; }

[ -d "$REPO/.git" ] || { say "no $REPO yet (gate-publish.sh creates it on the first draw)"; exit 0; }
git -C "$REPO" "${GIT_AUTH[@]}" fetch --quiet origin "$BRANCH" && git -C "$REPO" reset --quiet --hard "origin/$BRANCH" || { say "WARN fetch failed"; exit 0; }

append_ops() {  # $1 = one JSON line
  if [ ! -d "$OPS/.git" ]; then
    git "${GIT_AUTH[@]}" clone --quiet --filter=blob:none --no-checkout "https://github.com/$OPS_SLUG.git" "$OPS"
    git -C "$OPS" sparse-checkout set --no-cone /costs/
    git -C "$OPS" checkout --quiet main
  fi
  for attempt in 1 2 3; do
    git -C "$OPS" "${GIT_AUTH[@]}" fetch --quiet origin main && git -C "$OPS" reset --quiet --hard origin/main
    printf '%s\n' "$1" >> "$OPS/$ROWS"
    git -C "$OPS" add -- "$ROWS"
    git -C "$OPS" -c user.name="Hetzner" -c user.email="ops@sourcelibrary.org" commit --quiet -m "speed test A gate: $2 row ($3)" -- "$ROWS"
    git -C "$OPS" "${GIT_AUTH[@]}" push --quiet origin HEAD:main && return 0
    sleep 5
  done
  say "WARN ops push failed for $2"; return 1
}

for d in "$REPO"/scripts/eval/results/speedtest-a-gate/w-*/; do
  w=$(basename "$d"); local_dir=$ROOT/gate/$w
  mkdir -p "$local_dir"
  [ -e "$local_dir/.applied" ] && continue
  [ -e "$d/gate-row.json" ] || continue
  row=$(tr -d '\n' < "$d/gate-row.json")
  verdict=$(node -e 'const r=JSON.parse(process.argv[1]);console.log(r.verdict)' "$row")
  reasons=$(node -e 'const r=JSON.parse(process.argv[1]);console.log((r.reasons||[]).join("; "))' "$row")
  cp "$d/gate-row.json" "$local_dir/gate-row.json"
  say "$w verdict $verdict ${reasons}"
  if [ "$verdict" = "ABORT" ]; then
    if [ ! -e "$ROOT/ABORT" ]; then echo "quality gate $w: $reasons (routine verdict, GATE.md)" > "$ROOT/ABORT"; say "WROTE $ROOT/ABORT"; fi
    comment "ABORT — speed test A quality gate, window $w: $reasons. /root/speedtest-a/ABORT written on Hetzner by gate-poll.sh; the :05 guard drops the dial to \$5. Row: scripts/eval/results/speedtest-a-gate/$w/gate-row.json on $BRANCH."
  elif [ "$verdict" != "OK" ]; then
    comment "Speed test A quality gate, window $w: $verdict — not an OK and not an ABORT; a person should read scripts/eval/results/speedtest-a-gate/$w/ on $BRANCH. ${reasons}"
  fi
  append_ops "$row" "$w" "$verdict" && touch "$local_dir/.applied"
done

# Trend WARN (requested by sourcelibrary-c0, 2026-10-01): two judged windows running above the 6.9% baseline
# (chained-lane sample 2026-10-01, PR #5423) by more than this judge's A/A floor (2.8 pp, EXPERIMENTS.md 2026-09-30
# restraint A/B) → one #4681 comment per window. Not an ABORT: the 30% bound in gate-row.mjs still decides that.
BASE=0.069; FLOOR=0.028
trend=$(node -e '
const fs=require("fs"),p=require("path"),d=process.argv[1];
const rows=fs.readdirSync(d).filter(w=>w.startsWith("w-")&&fs.existsSync(p.join(d,w,"gate-row.json"))).sort()
  .map(w=>({w,...JSON.parse(fs.readFileSync(p.join(d,w,"gate-row.json"),"utf8"))})).filter(r=>r.rate!=null&&r.verdict!=="NOT_JUDGED");
const [a,b]=rows.slice(-2), lim=+process.argv[2]+ +process.argv[3];
if(a&&b&&a.rate>lim&&b.rate>lim) console.log(`${b.w}\t${a.w} ${(a.rate*100).toFixed(1)}% (${a.defective}/${a.n}), ${b.w} ${(b.rate*100).toFixed(1)}% (${b.defective}/${b.n})`);
' "$REPO/scripts/eval/results/speedtest-a-gate" "$BASE" "$FLOOR")
if [ -n "$trend" ]; then
  tw=${trend%%$'\t'*}; detail=${trend#*$'\t'}
  if [ ! -e "$ROOT/gate/$tw/.trend-warned" ]; then
    mkdir -p "$ROOT/gate/$tw"; touch "$ROOT/gate/$tw/.trend-warned"
    say "TREND WARN $detail"
    comment "WARN (trend, not ABORT) — speed test A quality gate: two windows running above the chained-lane baseline of 6.9% major defects (PR #5423) by more than the judge's A/A floor (2.8 pp): $detail. The 30% ABORT bound holds. Note sampling noise at n≈55 is ±~7 pp (2 SE at 6.9%); the final report should explain the gap (seam share, longer books, the #5426 fix landing)."
  fi
fi

# Silence is not a verdict: a window drawn 3 h ago with no row means the routine did not run.
for m in "$ROOT"/gate/w-*/manifest.jsonl; do
  [ -e "$m" ] || continue
  ld=$(dirname "$m"); w=$(basename "$ld")
  [ -e "$ld/.applied" ] || [ -e "$ld/.stale" ] || [ -e "$ld/.judged-by-session" ] && continue
  age=$(( $(date -u +%s) - $(stat -c %Y "$m") ))
  if [ "$age" -gt 10800 ]; then
    touch "$ld/.stale"
    say "STALE $w: no verdict $((age / 60)) min after the draw"
    comment "STALE — speed test A quality gate window $w was drawn $((age / 60)) min ago and the judge routine has pushed no verdict. Spend continues unjudged; check the routine's runs (GATE.md). Nothing was aborted."
  fi
done
