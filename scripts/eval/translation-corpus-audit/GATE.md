# Speed test A — rolling quality gate, lid-proof (#4681)

PRIOR ART: `CHAINED.md` (one-off Hetzner draw + claude.ai routine judge — this copies its two-stage shape and adds
the return path), `gate-row.mjs` (the numeric ABORT rule, unchanged). Ops handoff:
`handoffs/2026-09-30-chained-quality-sample.md` (private ops repo) — the rule, its amendments and exemptions.

## Why it exists

Speed test A runs the translation line at $300/day until 2026-10-03T22:30Z. Every six hours a window of pages the
chained lane wrote is judged; a bad window must stop the spend. The first gate was a laptop session; it died when
the laptop slept (2026-10-01 ~04:00Z) before judging anything. Nothing in this loop may depend on a laptop:

| step | where | when (UTC) |
|---|---|---|
| draw the window, classify scope (`gate-scope.mjs`, Mongo), publish to branch `eval/speedtest-a-gate-windows` | Hetzner `/etc/cron.d/speedtest-a-gate` → `/root/speedtest-a/gate-cron.sh` → `gate-publish.sh` | :25 after each tick (04/10/16/22) |
| judge (6 Opus subagents), score, hand-read invention candidates, write `gate-row.json`, push | claude.ai routine "Speed test A — window gate judge" | :40 |
| read verdicts back: ABORT → `/root/speedtest-a/ABORT` (the :05 guard drops the dial to $5) + comment #4681; every row → ops `costs/speed-test-a-quality.jsonl`; no verdict 3 h after a draw → STALE comment | Hetzner `gate-poll.sh` | every 10 min |

All three self-disable after the test (draw after 2026-10-03T23:00Z, routine after 2026-10-04T00:00Z, poller after
2026-10-04T06:00Z). $0 API: Mongo reads, git, the claude.ai subscription.

## The routine — what you do

You start with a fresh checkout and no other context. Do exactly this.

1. `date -u`. If it is after 2026-10-04T00:00Z, print `gate over` and stop.
2. `git fetch origin eval/speedtest-a-gate-windows && git checkout -B gate origin/eval/speedtest-a-gate-windows`.
3. Windows to judge: every `scripts/eval/results/speedtest-a-gate/w-*/` holding `manifest.jsonl` but no
   `gate-row.json`, oldest first. None → print `no window to judge` and stop. For each, `$DIR` = that path:
4. Judge exactly as CHAINED.md stage 2 step 3: one Agent-tool subagent per `$DIR/packets/packet-NN.jsonl`,
   `model: "opus"`, at most five at a time, prompt = the full text of `JUDGE-PROMPT.md` minus its leading
   `<!-- … -->` comment, followed by `PACKET_FILE: <abs path>` and `OUTPUT_FILE: <abs path to
   $DIR/verdicts/opus/packet-NN.jsonl>`. Nothing else in the prompt. Do not read packets or the manifest yourself.
5. Completeness: each packet has a verdict file with as many valid JSON lines as the packet. Re-launch once for any
   missing or short packet; after that, leave it and say so in `$DIR/hand-read.md`.
6. Score: `node scripts/eval/translation-corpus-audit/score.mjs --dir $DIR --primary opus --gate` (exit 3 = controls
   failed; continue — gate-row reports NOT_JUDGED).
7. First pass: `node scripts/eval/translation-corpus-audit/gate-row.mjs --dir $DIR --window <since>/<until>` (since,
   until = `frame.since`, `frame.until` in `$DIR/draw-log.json`). Its stderr lists content candidates.
8. Hand-read EVERY candidate yourself: find its `id` in `$DIR/items.jsonl`, read `source` and `translation`. Count
   it as confirmed only if the translation contains at least one WHOLE SENTENCE with no counterpart anywhere in the
   source, or the output echoes the source untranslated / is not English. A sentence completed across a page break,
   a relocated passage that is in the source, or a judge flag you cannot locate is NOT confirmed. Write one line per
   candidate to `$DIR/hand-read.md`: id, url, confirmed yes/no, the quoted span, `read-from-text`.
9. Final: rerun step 7 with `--confirmed-content <N>` (0 if no candidates) and write its stdout (one JSON line) to
   `$DIR/gate-row.json`. Never hand-edit the verdict: the rule lives in gate-row.mjs.
10. `git add $DIR && git commit -s -m "eval(speedtest-a-gate): <window name> judged — <verdict>, major <defective>/<n> (#4681)"`
    and `git push origin HEAD:eval/speedtest-a-gate-windows`; if refused, `git pull --rebase origin
    eval/speedtest-a-gate-windows` and push again (Hetzner may have published the next window meanwhile).
11. Finish with one line per window: `<name> <verdict> major <defective>/<n> controls <swap/drop/repeat>`.

You do not open a PR, comment on issues, or touch the dial: Hetzner's `gate-poll.sh` reads your `gate-row.json` and
acts on it within ten minutes.

## Reading a row

`verdict`: OK · ABORT (rate > 30% on n ≥ 20, ≥ 2 hand-confirmed whole-sentence invention/echo pages, or a scope
violation from `scope.json`) · NOT_JUDGED (controls failed — never read as OK) · HAND_READ_PENDING (should not occur
from the routine). `scope.warn` lists in-flight runs on held books and priority ≥ 90 gap-fill books — reported, not
aborting (see `gate-scope.mjs` header).
