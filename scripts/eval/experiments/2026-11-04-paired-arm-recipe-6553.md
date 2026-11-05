---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The paired-arm-judge recipe (paired-arm.mjs and a skill) re-derives a stored test's published figures exactly: on router-tests-2026-10-28, 20 of 20 arm k/n match its score.json and the write-up. On the near-blank gate (#5274, #8029) it reproduces the published 17/30 and 26/30 against stored 0/30 and 3/30. Its checks flag what neither test had: router-tests' latin-gpu cell drew 4 pages from each of 8 books (R1), and neither test had a noise floor (R4). The near-blank gate also had no wrong-page control (R3). The gate failed at 26/30 against a bar of 27/30, with no measure of how much the judge's own count varies."
status: adopted
decision: "Use paired-arm.mjs check before any paired judge spend, and name `Skill: paired-arm-judge` in a brief that asks which arm is better. claude-job.sh prints a `Skill:` line into the job prompt. The near-blank gate result stands as rejected; a rerun should add a wrong-page control and ≥5 repeat rows before reading 26 vs 27 as a miss."
feeds: [guard]
landed: ["scripts/eval/route-judge-6740/paired-arm.mjs", ".claude/skills/paired-arm-judge/SKILL.md"]
superseded_by: null
issue: [6553]
router_evidence: "none — re-scores stored results; no new judging, no router cell changed"
defect_rates: "none — no output judged; the re-score reuses stored verdicts"
---
## 2026-11-04 · A paired-arm judge recipe, checked against two stored tests (#6553)

PRIOR ART: `scripts/eval/route-judge-6740/judge.mjs` (draw, packet, judge, score) and `defect-rate.py`. The recipe
keeps their file format (`key.json`, `verdicts-<judge>.jsonl`, `packet.json`) and adds only the rules prose could not
enforce. `2026-11-04-experiment-kinds-6553.md` §6 found that 94 of 137 paired-arm runs rebuilt their own judge script.

### What it is

- `node scripts/eval/route-judge-6740/paired-arm.mjs init --out=DIR` writes `recipe.json`, the design stated before judging.
- `check --out=DIR` applies R1–R6: one page per book per arm, blind arm names, a wrong-page control per arm, a noise
  floor (≥5 repeat rows or a named earlier measurement), batch size stated (tested if >1 page a call), and for a
  which-leaf question, the neighbouring scans. Exit 1 if any rule fails without a waiver.
- `score --out=DIR [--compare=score.json]` gives accept and wrong-text k/n per judge × cell × arm, with Wilson and
  by-book intervals, controls and noise floor. With `--compare` it exits 1 on any k/n mismatch.
- `skeleton --out=DIR --slug=S` writes a write-up with a valid header (`feeds`, `router_evidence`, `defect_rates`).
- `.claude/skills/paired-arm-judge/SKILL.md` says when to use it and when not.
- `claude-job.sh` takes an optional `Skill: <name>` brief line and prints it into the job prompt. The census found that
  jobs use a skill only when their brief names it.

### Verification 1: re-scoring router-tests-2026-10-28

`paired-arm.mjs score --out=<copy> --compare=score.json` matched **20 of 20** k/n. The figures agree with
`2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md`:

| cell | k/n |
|---|---|
| zh-dice | 19/29 |
| latin-gpu | 22/26 |
| hebrew | 7/30, 7/28 |
| arabic | 10/30, 13/29 |
| chinese | 7/30, 6/30 |
| zh-frame | 5/9, 19/30 |

`check` on the same directory: latin-gpu is 8 books × 4 pages (R1 fail; its by-book interval is the honest one).
There was no `recipe.json` and no noise floor (R4). Output: `scripts/eval/results/paired-arm-recipe-6553/router-tests-2026-10-28-rescore.json`.

### Verification 2: the near-blank gate (#5274, PR #8029)

`wrong-leaf-fix-5021.mjs` judged its gate in its own format. The adapter `near-blank-to-key.mjs` converts it to
`key.json` and verdicts. The recipe is reconstructed after the fact (marked so in `recipe.json`), not preregistered.

| rule | result |
|---|---|
| R1 one page per book | ok (30 books per gate) |
| R2 blind arm names | ok (X/Y order) |
| R3 wrong-page control | **fail**, none |
| R4 noise floor | **fail**, none |
| R5 batch | ok (1 page per call) |
| R6 neighbouring leaves | ok (n−1, n+1 scans) |

Score matches the published figures: gate 1 new 17/30, stored 0/30; gate 2 new 26/30, stored 3/30. The gate needed
≥27/30 and got 26/30, with no noise floor. That is the case R4 exists for: one page's difference is inside any judge's
repeat variance until that variance is measured. Fidelity in this gate is synthetic (the runner maps clean/not clean to
5/3), so the fidelity mean is not comparable with judge.mjs runs. Output: `scripts/eval/results/paired-arm-recipe-6553/near-blank-gate/`.

### The real experiment the brief named

The brief asked to use the recipe on context-bleed-find-fix-5274's fix gate if it had not run yet. At 2026-11-04 that
job was live on cloudlayer (`box.sh cloudlayer status`: running `wrong-leaf-fix-5021.mjs`), and its runner was judging
its own gate. The mesh has no `note` verb to steer it, so I did not run a second, duplicate gate on the same pages.
Instead the recipe was used on that job's predecessor gate (Verification 2). The next fix gate on that runner should
start from `paired-arm.mjs init` and add a wrong-page control and repeat rows.

### Recipes still to write

cer-vs-reference, screen-with-controls, apply-gated-repair (listed in the skill). sample-and-review is already
`spot-check-round` and `shelf-overview`.
