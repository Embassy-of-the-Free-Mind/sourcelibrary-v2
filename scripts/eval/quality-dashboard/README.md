# Quality dashboard — https://sourcelibrary.org/admin/quality

PRIOR ART: the ops repo's `costs/spend-dashboard/` (same data-document pattern) and `scripts/eval/benchmark-dashboard-data.mjs` (the OCR half's builder, whose output this reads) — see the header of `build.mjs` for why neither is reused as code.

**Who reads it:** Derek, once a day and before a donor or partner conversation, asking *is the text we serve good, and is it getting better?* — and whoever is working on OCR or translation quality that week, checking whether a fix moved the served defect rate. Read only.

## Refresh (no deploy)

From a checkout of `main` with production env and the ops repo at `~/sourcelibrary-ops`:

    node --env-file=.env.production.local scripts/eval/quality-dashboard/build.mjs --push

It prints the headline lines, writes `scripts/output/quality-dashboard.json` (untracked) and upserts `bookstore.ops_reports` `_id: 'quality-dashboard'`. The page reads that document on every request. Flags: `--ops <dir>`, `--no-mongo` (skip reader signals), `--no-github` (skip issue states and pending branches). Cost: $0 — no model call.

Refresh after any instrument lands a new result on `main` (a monthly corpus audit, a speed-test window in the ops ledger, quality round 1's results file, a new OCR benchmark).

## What it reads

| Section | Instrument | File |
|---|---|---|
| 1, 2, 5 | translation corpus audit (Opus judge; baseline, monthly, chained) | `scripts/eval/results/translation-corpus-audit-*/report.json` |
| 1 | OCR evidence (median CER vs reference, production engine, by script) | `src/data/ocr-benchmark-evidence.json` |
| 1 | Nālandā readiness (Tibetan OCR vs Derge, Sanskrit translation) | `scripts/eval/results/nalanda-readiness-2026-09-30.json` |
| 2 | monthly draws not yet judged | `git ls-remote origin 'eval/tca-*'` |
| 3 | speed-test gate windows | ops repo `costs/speed-test-a-quality.jsonl` |
| 4 | quality round 1 (#5438) | `scripts/eval/results/quality-round-1-YYYY-MM.json` (absent → "not yet run") |
| 5 | taxonomy classes and their issues | `.claude/docs/page-error-taxonomy.md` + `gh issue view` |
| 6 | reader page reports (last 30 days) | Mongo `feedback` rows with `page_report` |

## Rules

- The renderer (`src/app/admin/quality/`) holds no figure, date, name or issue number; `tests/unit/quality-page-literals.test.ts` sweeps it.
- A run whose controls failed is listed but never becomes the headline. A missing instrument is `null` / `not_run` → "no measurement", never zero (`tests/unit/quality-dashboard-build.test.ts`).
- Every rate samples one page per book. A judge rating is not accuracy; only the OCR rows have a ground-truth reference.
- The flag → taxonomy-class mapping (`FLAG_TO_TAXONOMY` in `build.mjs`) is a judgement made in code review; change it there.
- If a new instrument should appear, add a reader in `build.mjs`, a type in `src/lib/quality-report.ts`, and a section in the page — never a figure in the page.
