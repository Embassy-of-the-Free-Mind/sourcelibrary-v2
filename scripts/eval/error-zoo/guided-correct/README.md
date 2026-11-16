# Does telling the corrector what the audit found make the correction better? (guided correction)

PRIOR ART: `../repair-pilot/` (the 35-page German set this reuses, its blind Opus corrections, `finding-check.py`) and
`scripts/batch/ocr-convergence/correct.mjs` (the corrector, unchanged). Every repair route so far (#7809 pilot, #8632
decision 1, v3#199 fix jobs) corrects blind: the audit's findings choose the page, but the corrector never sees them.

## Design

Same 35 pages, same frozen draft (the pilot's `stored/`), Opus on the subscription, one page a call, fresh, nothing
written to the database.

- **A, blind**: `correct.mjs` as the pilot ran it.
- **B, guided**: the same, with `--instruction-file` holding the page's audit findings, framed as reports that may be
  wrong and must be checked against the image, plus one planted false report (a decoy) in random position.
  Decoys (`build.py`): a word that the stored text and the blind correction read the same, reported as a variant.
  15 are plausible modernisations (`heylet` → `heilet`, `ausgetheilet` → `ausgeteilet`), the kind of wrong report a
  normalising reader makes; 20 are visual non-words (`gewaltig` → `gcwaltig`).

Scored by `score.py` with no model: audit findings fixed (finding-check's rules), decoys applied, share of the text
changed, outcome per page.

    python3 build.py <pilot set> <out>; (repo root) CLAUDE_CONFIG_DIR=… bash run.sh <out> 3; python3 score.py <out> <pilot findings.jsonl> result.json

## Result

See `result-2026-11-14.json` and the experiment entry `scripts/eval/experiments/2026-11-14-guided-correction-244.md`.
