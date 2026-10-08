# Second-reader calibration (#6338), Latin-script round — brief for a headless job on the main Hetzner box

<!--
PRIOR ART: scripts/audit/spend-weekly-brief.md (the shape of a claude-job.sh brief). The steps are RUNBOOK.md's, for
the parts that can run on this box. Started by hand from any session with access:
  cd /root/sourcelibrary && git fetch -q origin eval/second-reader-6338 \
    && git show FETCH_HEAD:scripts/eval/second-reader/JOB-latin.md > /root/claude-jobs/second-reader-latin-6338.txt \
    && /root/bin/claude-job.sh start second-reader-latin-6338 /root/claude-jobs/second-reader-latin-6338.txt
(fetch + show never moves the main checkout off main.)
-->

Job: run the Latin-script round of the second-reader calibration (#6338) **up to the Gemini reads**, which cannot
run here (they need `agy`, signed in on Derek's laptop). Report as ONE comment on #6338. No PR, no other issue.

**Read before anything else:** `scripts/eval/PREREGISTRATION-second-reader-6338.md` (the design you must not
change) and `scripts/eval/second-reader/RUNBOOK.md` (the commands). Where this brief and the preregistration
disagree, the preregistration wins and you say so in the comment.

## Hard rules
- **Read-only on Mongo.** `draw.mjs` only reads. Nothing in this job writes to Mongo, Supabase or R2.
- **Never change the design.** Not the sample size, seed, languages, planted share, briefs or decision rule. If a
  step cannot run as written, stop and report; do not improvise a substitute.
- **The run directory stays OUTSIDE the repository:** `R=/root/claude-jobs/second-reader-6338/latin`. It holds the
  planted-error key; no reader may be able to reach it, and nothing from it is committed by this job.
- **Spend:** Opus reads on the subscription only (`claude -p`, via `run-readers.sh`). $0 API. Cap: if
  `run-cost.py`-style totals (sum of `total_cost_usd` in `R/readers/*/meta/*.jsonl`) pass **$60** API-equivalent,
  stop and report.
- **Stay under 60 tool calls.** Long steps: detach with `nohup … &` and wait with an `until` loop, as in
  `scripts/audit/spend-weekly-brief.md`.

## Steps

0. **Code.** In your job worktree (a fresh origin/main): `git fetch -q origin eval/second-reader-6338 && git checkout
   -q FETCH_HEAD`. Record `git rev-parse HEAD`: that is the preregistration commit this run is under. If
   `scripts/eval/PREREGISTRATION-second-reader-6338.md` is missing, stop.
1. **Preconditions.** All three must hold, else stop and report which failed:
   - `claude --help | grep -q -- --restricted` (the sealed reader needs it; `run-readers.sh` refuses without it).
   - The corpus mirror exists: `ls ~/sl-corpus/books | head -1`.
   - The #6338 pilot (`second-reader-pilot-6338`) has finished: its done file or log under `/root/claude-jobs/`, or a
     pilot result comment on #6338 (`gh issue view 6338 --comments`). Read what it says about pages per call. **If it
     has not finished: do steps 2–3 (frame and draw need no packet size), then stop and report** — packets must not
     be cut before the call format is known, because every reader must read the same packets.
2. **Frame inputs** (RUNBOOK step 0). `node scripts/audit/page-integrity.mjs --calibrate --out=/root/pi-6338` (the
   truncation flag needs it), then `node scripts/audit/page-integrity.mjs --out=/root/pi-6338` (fresh dir; long:
   detach). Record the run date in `$R/README.md`. Then
   `node scripts/eval/second-reader/second-reader.mjs flagged --run $R --from /root/pi-6338` and
   `node scripts/eval/second-reader/second-reader.mjs exclude --run $R`.
3. **Draw** (step 1).
   `node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/second-reader/draw.mjs --out $R --script latin --languages "Latin,German,French,Italian,Dutch,Spanish,Portuguese" --n 100 --seed 20261009 --flagged $R/flagged.json --exclude $R/exclude.json`.
   Check: 100 picks, both strata drawn, acceptance rates recorded, `ls $R/images | wc -l` = 100.
4. **Packets** (step 2). `--per-packet 5`, or `1` if the pilot found a Gemini call cannot hold 5 single-page books.
   Write the choice and its reason in `$R/README.md` BEFORE step 5.
5. **Opus reads** (step 3), one reader after the other:
   `bash scripts/eval/second-reader/run-readers.sh $R opus-a claude opus`, then the same with `opus-b`.
6. **Collect and audit** (step 5) for each: `node scripts/eval/second-reader/second-reader.mjs collect --run $R --reader opus-a`
   (and `opus-b`). A packet with a READ outside the sealed folder: delete that packet's review and re-run that reader
   once (the script skips packets already done). Twice for one reader: stop and report.
7. **Stop here.** The Gemini reads (step 4), clustering, adjudication and scoring follow on a machine with `agy`.
   `touch` your done file.

## The comment on #6338, this shape
```
**Latin-script round, Opus reads done (job second-reader-latin-6338, code <sha>).** Next: Gemini reads on a machine with agy (RUNBOOK step 4), run dir `/root/claude-jobs/second-reader-6338/latin`.

- Frame: <N> books (<F> flagged), <excluded> excluded; drawn 100 (<f> flagged / <u> unflagged), acceptance <a_f> / <a_u>; images 100/100.
- Planted: <k> pages <class counts>; packets: <n> × <size> (<reason>).
- opus-a: <returned>/100 pages, <missing> missing, reads outside the folder: <0 or list>, $<cost>.
- opus-b: same.
- Anything that did not go as the preregistration says: <none, or what and why you stopped>.
```
Report counts only: no planted-error details, no page text (the key must stay unread until the Gemini reads are done).
