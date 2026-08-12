# Suda–SOL parallel benchmark pipeline

Tooling for the Suda On Line alignment benchmark — issue **#3884**, research note
[/blog/suda-benchmark](https://sourcelibrary.org/blog/suda-benchmark).

Aligns our AI translation of Bekker's 1854 *Suidae Lexicon* (book
`69a99ce86c7545e2236e12de`) with the Suda On Line's ~31k scholar-vetted entries,
producing per-entry Adler IDs, cross-family fidelity gold labels, and a
categorical quality census.

## Data location

All scripts read/write `$SOL_DATA_DIR` (default `scripts/output/sol-harvest/`,
untracked). The data is NOT in this repo: the SOL mirror and every file derived
from it carry SOL's **CC BY-NC-SA** license and must not be committed to this
AGPL repository. Snapshot backup: `root@46.224.122.120:/root/backups/sol-harvest-2026-08-11.tar.gz`.

## Pipeline (run in order; each stage is resumable/idempotent)

| stage | script | output | notes |
|---|---|---|---|
| 1. mirror SOL | `harvest.mjs` (nohup, ~9h @3req/s) | `raw/<letter>/<n>.html` | polite crawl, skips existing files |
| 2. parse | `parse-sol.py` | `sol.jsonl` | Betacode→Unicode; incl. Adler's Greek per entry |
| 3. segment | `segment-bekker.mjs` (needs `MONGODB_URI`) | `bekker-entries.jsonl` | paragraph candidates from page OCR |
| 4. align | `align.py` | `aligned.jsonl`, `align-report.json` | see invariants below |
| 5. gold pilot | `make-pilot.mjs` → Claude subagents per `judge-instructions.md` → `summarize-pilot.py` | `pilot/`, `gold-labels-merged.jsonl` | cross-family judges ONLY (see below) |
| 6. judge validation | `validate-lite.mjs` (needs `GEMINI_API_KEY`) | `lite-verdicts/` | κ vs gold before trusting any cheap judge |
| 7. census | `census.mjs` (needs both keys) | `census-verdicts/`, `census.jsonl` | categorical checks only, grouped per page (~$1) |

## Invariants learned the hard way (don't relearn them)

- **Bekker alphabetized; Adler/SOL is antistoichic.** The aligner must re-sort SOL
  alphabetically or the αι/ει/οι letter-groups score 0%.
- **Adler numbers do not follow Bekker's print order within homonym groups**
  (seven consecutive Δίδυμος entries). Disambiguate by trigram similarity against
  Adler's Greek, never by order.
- **Never grade fidelity against SOL's English directly** — Bekker≠Adler edition
  differences appeared in 42/49 sampled entries. Both Greek texts must arbitrate.
- **Never use a judge from the translator's model family for fidelity.** Measured
  κ=0.107 (both gemini-lite and gemini-flash-preview miss ~90% of catalogued
  Gemini-translation errors, zero false positives). Same-family models validated
  only for categorical flags (misalignment, recitation), and every flag they
  raise is a candidate requiring cross-family verification.
- **maxOutputTokens + responseMimeType json**: page-grouped census calls must
  assert the returned array length equals the entry count; two pages needed a
  retry for shape/JSON errors.

Full evaluation trail, numbers, and release plan: #3884.
