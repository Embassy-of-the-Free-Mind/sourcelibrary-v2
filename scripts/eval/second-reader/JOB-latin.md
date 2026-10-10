# Second-reader calibration (#6338), Latin-script round — brief for a headless job on the main Hetzner box

<!--
PRIOR ART: scripts/audit/spend-weekly-brief.md (the shape of a claude-job.sh brief). The steps are RUNBOOK.md's.
Started by hand from any session with access:
  cd /root/sourcelibrary && git fetch -q origin eval/second-reader-6338 \
    && git show FETCH_HEAD:scripts/eval/second-reader/JOB-latin.md > /root/claude-jobs/second-reader-latin-6338.txt \
    && /root/bin/claude-job.sh start second-reader-latin-6338 /root/claude-jobs/second-reader-latin-6338.txt
(fetch + show never moves the main checkout off main.) Once #6347 is merged, the brief is on main and the fetch can go.
-->

Job: run the Latin-script round of the second-reader calibration (#6338) through every step that needs no person:
draw, the four readers, clustering and both adjudicators. **Stop before the by-eye checks** (RUNBOOK step 8). Report
as ONE comment on #6338. No PR, no other issue.

**Read before anything else:** `scripts/eval/PREREGISTRATION-second-reader-6338.md` (the design you must not
change, amendments 1 and 2 included) and `scripts/eval/second-reader/RUNBOOK.md` (the commands). Where this brief and
the preregistration disagree, the preregistration wins and you say so in the comment.

## Hard rules
- **Read-only on Mongo.** `draw.mjs` only reads. Nothing in this job writes to Mongo, Supabase or R2.
- **Never change the design.** Not the sample size, seed, languages, planted share, briefs, wrappers or decision
  rule. If a step cannot run as written, stop and report; do not improvise a substitute.
- **The run directory stays OUTSIDE the repository:** `R=/root/claude-jobs/second-reader-6338/latin`. It holds the
  planted-error key; no reader may be able to reach it, and nothing from it is committed by this job.
- **Never open the key or the adjudication key yourself, and never read the reviews' contents** beyond the counts
  the steps print. You are running the study, not judging it.
- **Spend:** Opus on the subscription only (`claude -p` via `run-readers.sh`); Gemini through the CLI only
  (`run-cli-arm.py`, $0). $0 API. Cap: if the summed `total_cost_usd` in `R/readers/*/meta/*.jsonl` and
  `R/adjudication/*/meta/*.jsonl` passes **$100** API-equivalent, stop and report. A CLI quota error (run-cli-arm exit
  3) stops the job: report it; a later run resumes where it stopped (every step skips work already done).
- **Stay under 80 tool calls.** Long steps: detach with `nohup … &` and wait with an `until` loop, as in
  `scripts/audit/spend-weekly-brief.md`.

## Steps
0. **Code.** In your job worktree: `git fetch -q origin eval/second-reader-6338 && git checkout -q FETCH_HEAD` (skip if
   `scripts/eval/second-reader/` is already on main). Record `git rev-parse HEAD`.
1. **Preconditions**, else stop and report which failed: `claude --help | grep -q -- --restricted`;
   `ls ~/sl-corpus/books | head -1`; `agy --version`; `python3 scripts/eval/run-cli-arm.py --probe --model gemini-3.8-flash-high --job second-reader-latin-6338`.
2. **Frame inputs.** `node scripts/audit/page-integrity.mjs --calibrate --out=/root/pi-6338`, then the same without
   `--calibrate` (fresh dir; long: detach). Record the date in `$R/README.md`. Then
   `node scripts/eval/second-reader/second-reader.mjs flagged --run $R --from /root/pi-6338` and `… exclude --run $R`.
3. **Draw.** `node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/second-reader/draw.mjs --out $R --script latin --languages "Latin,German,French,Italian,Dutch,Spanish,Portuguese" --n 100 --seed 20261009 --flagged $R/flagged.json --exclude $R/exclude.json`.
   Check: 100 picks, both strata drawn, acceptance recorded, `ls $R/images | wc -l` = 100.
4. **Packets.** `node scripts/eval/second-reader/second-reader.mjs packets --run $R --per-packet 1`.
5. **Opus reads.** `bash scripts/eval/second-reader/run-readers.sh $R opus-a claude opus`, then `opus-b`. Then
   `collect --run $R --reader <name>` for each. A packet with a READ outside the sealed folder: delete that review and
   re-run the reader once (done packets are skipped). Twice for one reader: stop and report.
6. **Gemini reads**, one model after the other (one shared CLI quota): for `gemini-pro` / `gemini-3.1-pro-high`, then
   `gemini-flash` / `gemini-3.8-flash-high`, then `gemini-retest` / `gemini-3.1-pro-high`:
   `second-reader.mjs cli-requests --run $R --reader <name>`; the `run-cli-arm.py` line it prints, with
   `--model <model> --job second-reader-latin-6338 --parallel 2 --attempts 4` (≈ 1–1.5 h each: detach); then
   `second-reader.mjs cli-assemble --run $R --reader <name>`. If a reader has more than 10 of 100 pages without a
   reply, stop and report.
7. **Cluster.** `second-reader.mjs cluster --run $R --readers opus-a,opus-b,gemini-pro,gemini-flash,gemini-retest`.
8. **Adjudicate.** `run-readers.sh $R adj-opus claude opus adjudicate`, then `collect --run $R --reader adj-opus --role adjudicate`;
   `cli-requests --run $R --reader adj-gemini --role adjudicate`, its run-cli-arm line with `--model gemini-3.1-pro-high`,
   `cli-assemble --run $R --reader adj-gemini --role adjudicate`.
9. **Interim look.** `second-reader.mjs score --run $R --primary opus-a --control opus-b --candidates gemini-pro,gemini-flash --adjudicators adj-opus,adj-gemini --retest gemini-pro=gemini-retest --interim`.
   It reports how many items still need the eye; its verdict is provisional until those are settled. Copy only its
   verdict line and the b / c counts into the comment.
10. **Stop.** The by-eye items (`$R/adjudication/by-eye-todo.json` plus every split the interim score lists) need a
    person. `touch` your done file.

## The comment on #6338, this shape
```
**Latin-script round: machine steps done (job second-reader-latin-6338, code <sha>).** Next: the by-eye checks (RUNBOOK step 8) — <n> items and <m> pages, listed in `/root/claude-jobs/second-reader-6338/latin/adjudication/by-eye-todo.json` plus the splits the interim score lists.

- Frame: <N> books (<F> flagged), <excluded> excluded; drawn 100 (<f> / <u>), acceptance <a_f> / <a_u>; images 100/100.
- Planted: <k> pages <class counts>; packets: 100 × 1 page.
- Readers: opus-a <returned>/100 ($<cost>), opus-b …, gemini-pro <returned>/100 (<nudged> nudged, <unread> unread), gemini-flash …, gemini-retest …; reads outside the folder: <0 or list>.
- Clusters: <n>; adjudication items: <n> (adj-opus <done>, adj-gemini <done>).
- Interim (provisional until the eye): <verdict line>; b / c per model: <…>.
- Anything that did not go as the preregistration says: <none, or what and why you stopped>.
```
Report counts only: no page text, no planted-error details.
