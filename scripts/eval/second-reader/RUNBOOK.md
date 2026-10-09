<!-- PRIOR ART: ../pareto-6182/RUNBOOK-cli38-xl.md (the agy CLI runbook this follows for the Gemini reads) and
.claude/skills/shelf-overview/SKILL.md (the Opus reader runs). This is the sequence for ONE script of the
second-reader calibration (#6338); the design and decision rule are in ../PREREGISTRATION-second-reader-6338.md. -->

# Second-reader calibration (#6338): runbook for one script

On the main Hetzner box, steps 0–3 and 5 for the Latin script run as a headless job: `JOB-latin.md` (its header has
the start command). It runs every step that needs no person: it stops before the by-eye checks (step 8).

`R` is the run directory, OUTSIDE the repository until step 9 (for example `/root/claude-jobs/second-reader-6338/latin`):
the planted-error key in `R/private/` must not be readable by any reader before every read is done. `S` is the
script (`latin`, `han`, `arabic`), with the seed and languages from the preregistration table.

| step | where | command |
|---|---|---|
| 0. frame inputs | box with the corpus mirror | `node scripts/audit/page-integrity.mjs --calibrate --out=/root/pi-6338`, then the same without `--calibrate` (fresh dir), then `node scripts/eval/second-reader/second-reader.mjs flagged --run R --from /root/pi-6338` and `… exclude --run R` |
| 1. draw | Mongo + network (Hetzner) | `node --env-file=.env.production.local scripts/eval/second-reader/draw.mjs --out R --script S --languages "<list>" --n 100 --seed <seed> --flagged R/flagged.json --exclude R/exclude.json` |
| 2. plant + packets | anywhere | `node scripts/eval/second-reader/second-reader.mjs packets --run R --per-packet 1` (one page per call for every reader: amendment 2) |
| 3. Opus reads | claude CLI | `scripts/eval/second-reader/run-readers.sh R opus-a claude opus` then the same with `opus-b` |
| 4. Gemini reads | where `agy` is signed in (the main Hetzner box) | for each of `gemini-pro` (gemini-3.1-pro-high) and `gemini-flash` (gemini-3.8-flash-high): `second-reader.mjs cli-requests --run R --reader <name>`, then the `run-cli-arm.py` line it prints with `--model <model>`, then `second-reader.mjs cli-assemble --run R --reader <name>` |
| 5. collect + audit | anywhere | `node scripts/eval/second-reader/second-reader.mjs collect --run R --reader <name>` for each reader. A READ outside the sealed folder: delete that packet's review and re-run it (stop rule in the preregistration). |
| 6. cluster | anywhere | `node scripts/eval/second-reader/second-reader.mjs cluster --run R --readers opus-a,opus-b,gemini-pro,gemini-flash` |
| 7. adjudicate | claude + agy | `run-readers.sh R adj-opus claude opus adjudicate`, then `collect --run R --reader adj-opus --role adjudicate`; and `cli-requests --run R --reader adj-gemini --role adjudicate`, `run-cli-arm.py … --model gemini-3.1-pro-high`, `cli-assemble --run R --reader adj-gemini --role adjudicate` |
| 8. by eye, interim, score | a person | Fill `R/adjudication/by-eye.json` (template: `by-eye-todo.json`; `score` lists any split still unsettled). Interim: `score … --interim`. Final: `node scripts/eval/second-reader/second-reader.mjs score --run R --primary opus-a --control opus-b --candidates gemini-pro,gemini-flash --adjudicators adj-opus,adj-gemini` |
| 9. commit | worktree | copy `R` (with `private/`) to `scripts/eval/results/second-reader-6338/S/`, minus the images if they exceed the repo's size habits (their sha256 stays in the packets); one experiment file; verdict comment on #6338 |

Notes
- **Both Gemini models are tested** (amendment 1): there is no model choice before scoring. The per-script `score`
  gives each model's *b*, *c* and gain; `export` makes the pooled decision across the scored scripts.
- **The interim look** is after the Latin round: `score … --interim`; stop if both models show *b ≤ c*.
- **The retest** (Latin only): step 4 again as reader `gemini-retest` with gemini-3.1-pro-high, add it to
  `cluster --readers` and pass `--retest gemini-pro=gemini-retest` to `score`.
- **After each script:** commit the run dir, then `second-reader.mjs export` and commit `src/data/second-reader-6338.json`
  in the same PR (CI's `export --check` test fails otherwise).
- **Never commit `R` before step 8 is done.** A reader that could read the repo could read the key; the sealed
  folder is the guard, and committing early removes the reason it holds.
- A packet the CLI refuses outright (content filter) stays missing; it counts as not found, and the report shows
  each reader's missing pages.
