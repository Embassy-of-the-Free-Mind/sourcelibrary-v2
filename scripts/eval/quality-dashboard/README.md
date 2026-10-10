# Quality dashboard — https://sourcelibrary.org/admin/quality

PRIOR ART: the ops repo's `costs/spend-dashboard/` (same data-document pattern) and `scripts/eval/benchmark-dashboard-data.mjs` (the OCR half's builder, whose output this reads) — see the header of `build.mjs` for why neither is reused as code.

**Who reads it:** Derek, at his desk or on his phone, about 30 seconds once a day: *better or worse since last week, and did anything break yesterday?* Section 1 (four trend lines) answers that; the rest is for whoever is working on OCR or translation quality that week. Read only.

## Refresh (no deploy)

Daily at 06:30 UTC on the main Hetzner box (`infrastructure/hetzner-crontab`, log `/var/log/sourcelibrary/quality-dashboard.log`). By hand, from a checkout of `main` with production env:

    node --env-file=.env.production.local scripts/eval/quality-dashboard/build.mjs --push

It appends today's trend points (below), prints one line per trend and the headline lines, writes `quality-dashboard.json` to `$JOB_SCRATCH` or `scripts/output/` (untracked), and upserts `bookstore.ops_reports` `_id: 'quality-dashboard'`. The page reads that document on every request. Flags: `--no-mongo` (skip reader signals and the history store), `--no-github` (skip issue states and pending branches), `--out-dir <dir>`. Cost: $0 — no model call.

## The four trend lines (#6429)

History store: `bookstore.ops_reports`, one document per UTC day, `_id: quality-history-YYYY-MM-DD`, `type: quality_history_daily`, one field per series, each point dated by the day it MEASURES. A re-run replaces that day's point for that series only; no other day is touched. `trends.mjs` writes and reads it; `buildTrends()` turns it into the four charts and their one-line statements.

| Chart | Series | Source | Cadence |
|---|---|---|---|
| Served-text quality | `served_text_stored` (1a): the 90-page #6388 panel's text as served today (`pages.ocr.data`), mean capped CER per stratum against the panel key | `trends.mjs measureStoredText` + `ocr-prereg-6388/panel-key.mjs` | daily, $0 |
| | `served_text_config` (1b): the same pages re-read with today's OCR prompt on `gemini-3.1-flash-lite` | `ocr-prereg-6388/rerun-config.mjs --max-usd 0.50 --apply`, by hand | about monthly, ~$0.20 |
| Reach | `reach`: live books in the `readable_in_english` view, and their pages with English text (translated pages; OCR'd pages for English originals). Not written when < 99% of live books carry `translation_state` | `trends.mjs measureReach` | daily, $0 |
| Cost per page | `efficiency`: $ per 1,000 pages written for OCR and translation, waste % — copied from `paid-vs-got-<day>` | `scripts/audit/paid-vs-got.mjs` | daily (ledger day = yesterday) |
| Bill coverage | `bill`: metered ÷ billed per week — copied from the paid-vs-got bill check (carried copies skipped) | same | weekly (Mondays) |

Backfill: efficiency and bill from every stored paid-vs-got doc (from 2026-10-01; bill weeks from 2026-09-06); the panel's first points from the #6388 files (`reads/P` for 1a, `reads/L1` for 1b, 2026-10-10). Reach starts on 2026-10-10: the counters keep no history.

The key is the #6388 **AI-consensus key** (two or three AI readers agreeing, no human). When `adjudicate-6388` lands a model-adjudicated key, change `PANEL_KEY` in `trends.mjs` and the key file `panel-key.mjs` builds from; the label on the page follows.

1a moves only when panel pages are re-read; the statement says how many were since the week-earlier point. Cost statements pool seven ledger days, because a single low-volume day's $/1,000 is noisy.

## What it reads

| Section | Instrument | File |
|---|---|---|
| 1 | the four trend lines | `ops_reports` `quality-history-*` (above) |
| 2, 3, 4 | translation corpus audit (Opus judge; baseline, monthly, chained) | `scripts/eval/results/translation-corpus-audit-*/report.json` |
| 2 | OCR evidence (median CER vs reference, production engine, by script) | `src/data/ocr-benchmark-evidence.json` |
| 2 | Nālandā readiness (Tibetan OCR vs Derge, Sanskrit translation) | `scripts/eval/results/nalanda-readiness-2026-09-30.json` |
| 3 | monthly draws not yet judged | `git ls-remote origin 'eval/tca-*'` |
| 4 | taxonomy classes and their issues | `.claude/docs/page-error-taxonomy.md` + `gh issue view` |
| 5 | reader page reports (last 30 days) | Mongo `feedback` rows with `page_report` |

Removed 2026-10-10 (#6429): "Lanes under test" (speed-test gate windows; last window 2026-10-01, and its ops-repo ledger is not on the box the daily build runs on) and "Quality round 1" (#5438; never run, the panel only said so).

## Rules

- The renderer (`src/app/admin/quality/`) holds no figure, date, name or issue number; `tests/unit/quality-page-literals.test.ts` sweeps it.
- A run whose controls failed is listed but never becomes the headline. A missing instrument is `null` / `not_run` → "no measurement", never zero (`tests/unit/quality-dashboard-build.test.ts`).
- Every rate samples one page per book. A judge rating is not accuracy; only the OCR rows have a ground-truth reference.
- The flag → taxonomy-class mapping (`FLAG_TO_TAXONOMY` in `build.mjs`) is a judgement made in code review; change it there.
- If a new instrument should appear, add a reader in `build.mjs`, a type in `src/lib/quality-report.ts`, and a section in the page — never a figure in the page.
