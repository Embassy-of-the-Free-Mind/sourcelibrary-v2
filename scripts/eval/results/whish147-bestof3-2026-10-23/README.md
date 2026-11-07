# Whish 147: best-of-N reads picked by a judge (#7119)

PRIOR ART: ../whish147-stability-recall-2026-10-23/ (PR #7203: repeat reads, the stored reads the gate reuses;
`lib.mjs` and `score_lib.py` are copied from it unchanged) and ../whish147-best-attempt-2026-10-22/ (fresh.mjs's prompt
and crops are imported, not copied; mlym2iast.py and test_mlym.py are used as they are).

1. `judge.mjs --gate` — J-text / J-image over the stability test's reads of the 9 verse leaves -> `gate-picks.json`;
   `score_gate.py` -> `gate-scores.json`. `cands.py` turns a read into Malayalam + IAST rows.
2. `bestof.mjs --plan` (needs `$JOB_SCRATCH/inv.json`, a page inventory) -> `plan.json` (303 leaves, 13 skips with
   reasons); `bestof.mjs [--no-fable]` — the stored fresh read as `reads/opus-1`, 2 more Opus reads, (1 Fable read),
   J-text pick -> `picks.json`. Stops at 85% weekly or on a usage limit.
3. `score_picks.py` -> `pick-scores.json` (every candidate and the pick vs the located edition span).
4. `apply.mjs [--only=A|B] [--apply]` — writes through writePageText -> `apply-result.json`; lists pages whose OCR body
   changed in `translate/bestof-*.ids.json` (+ instructions) for `claude-translate.mjs read` / `cli-translate.mjs
   apply`; `translate-B-result.json` says which translations the write door took.
`reads/` holds every prompt, reply and meta (image SHA-256, model, usage); `reads/calls.jsonl` every call.
