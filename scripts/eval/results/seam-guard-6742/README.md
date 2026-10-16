# seam-guard-6742 — results (#6742)

Write-up: `scripts/eval/experiments/2026-10-16-seam-guard-all-joins-6742.md`. Code: `scripts/maintenance/seam-repair-6742/guard.mjs`, `lean.mjs`.

| file | what |
|---|---|
| `guard-replay.json` | B: the dry replay of a 39-page CLI translation run (book 6acc3dbd230e9a56175cd616): joins, calls, accepted, would write |
| `guard-replay-joins.jsonl.gz` | B: one row per join the guard checked: label, refusal, repair, seconds |
| `all-joins-candidates.jsonl.gz` | C: the 420 sampled prose joins of the top 20 books (25 per book), with their windows and tranche signals |
| `all-joins-repairs.jsonl.gz` | C: Gemini's label and repair per join |
| `all-joins-verify.jsonl.gz` | C: the blind Opus sample, both orders, A/A |
| `all-joins-apply-refusals.jsonl.gz` | C: placed repairs refused at the stored text (dry run) |
| `all-joins-run.json` | C: the run tally (placement refusals, sample, would-write) |
| `all-joins-books.jsonl`, `all-joins-readership.json` | C: the 20 books, their joins, and the readership instrument |
