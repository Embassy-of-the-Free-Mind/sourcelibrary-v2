# Archived 2026-02 cohort of zero-reference one-off scripts (2026-07 hygiene)

Ad-hoc analysis/batch/fix scripts from the Feb 2026 pipeline-triage era
(H13 outage, IA page-count bug, post-1930 403 sweep, OCR-model backfills,
Leonardo facsimile prompt). All were last touched **2026-02-15/19** (≥4
months untouched as of this archive) and had **zero live references** —
verified by grepping each file's basename (with and without extension)
across `scripts/`, `src/`, `.github/`, `package.json`,
`scripts/workers/crontab.production`, `.claude/docs`, `.claude/skills`,
and `memory/`, excluding `.claude/worktrees` and `node_modules`. This is a
**move, not a delete** — full history and logic stay recoverable via
`git mv` / `git log --follow`.

Two scripts (`fix-stuck-jobs.mjs`, `fix-inflated-page-counts.mjs`) turned
up as **illustrative example text** in the admin system-map page
(`src/app/admin/system-map/page.tsx` and its `platform/(protected)`
twin) — not a functional dependency, matching the same pattern the
2026-06-ft-cleanup archive hit. Those example lists were updated to
reference still-live scripts (`fix-conflicting-visibility.mjs`,
`fix-covers.mjs`) in the same PR. `leonardo-ocr-prompt.ts` was also
listed in `scripts/README.md`'s directory table; that row was removed
since the whole `scripts/leonardo/` directory is archived (it contained
only this one file).

| Script | Was | Why dead |
|---|---|---|
| `analysis/analyze-403-gaps.mjs` | find unenriched books with `failed:` archived_photo, post-1930 filter | one-shot triage query for the Feb 2026 403/access-restricted sweep; superseded by later gap-audit tooling |
| `analysis/analyze-reocr-candidates.mjs` | rank opened books by read_count to prioritize re-OCR | one-shot prioritization pass; not re-run since |
| `analysis/assess-retranslation.mjs` | find books needing re-translation (stale translation vs. re-OCR'd text, or old OCR model) | one-shot audit ahead of a re-OCR/re-translate batch push |
| `analysis/audit-blob.ts` | list/audit Vercel Blob storage contents with retry-on-rate-limit | one-shot blob storage audit from the pre-R2 era |
| `analysis/audit-data-infrastructure.mjs` | audit index coverage, entity quality, metadata cleanliness, text availability for MCP readiness | one-shot pre-MCP-launch audit |
| `analysis/check-h13-pipeline-status.mjs` | check pipeline status of the 35 H13-outage books still needing OCR | one-shot check tied to the Feb 19 H13 incident |
| `analysis/check-images.mjs` | find mid-size archive-complete books with zero OCR pages | one-shot triage query |
| `analysis/check-ocr-needs.js` | aggregate provider OCR coverage per book | one-shot coverage check, CJS-era script |
| `analysis/check-skipped.mjs` | list large unenriched books skipped by the enrichment sort/limit window | one-shot enrichment-queue debugging |
| `analysis/cross-reference-translations.mjs` | cross-reference our Latin books against the UNESCO Latin translations census (7,542 records) | one-shot external-catalog cross-reference |
| `analysis/curate-beta-100.mjs` | select top 100 books for beta launch by translation coverage + diversity | one-shot beta-launch curation, beta long since shipped |
| `analysis/find-h13-gaps.mjs` | find pages from the Feb 19 H13 outage where OCR succeeded but the Mongo save failed | one-shot incident-recovery query, tied to a specific outage window |
| `analysis/generate-reprocessing-csv.mjs` | export a CSV of books needing re-OCR/re-translation | one-shot report generator, predates the current triage dashboards |
| `analysis/investigate-complete-gaps.mjs` | investigate books marked "complete" with 0 OCR pages or low translation % | one-shot data-quality investigation |
| `analysis/list-403-books.mjs` | list unenriched books where all pages 403 | one-shot triage list, part of the same 403 sweep as `analyze-403-gaps.mjs` |
| `analysis/list-post1930-403.mjs` | list post-1930 unenriched books with failed archived_photo | one-shot triage list, narrower variant of `list-403-books.mjs` |
| `batch/batch-reocr-large-books.mjs` | submit Gemini Batch API OCR jobs for large books stuck on old OCR models | one-shot model-upgrade batch, ran to completion |
| `batch/reocr-old-models.mjs` | submit Lambda OCR jobs for pages not on `gemini-3-flash-preview` | one-shot model-upgrade batch, superseded by later model migrations |
| `batch/reprocess-old-ocr.mjs` | re-OCR pages still on `gemini-2.5-flash` via Lambda, retranslate where stale | one-shot model-upgrade batch, same era as the two above |
| `enrichment/tag-bible-works.mjs` | tag Bible-related books with `work_id` for WEMI-style grouping | one-shot work-id backfill, predates the general `resolve-work-ids*.mjs` resolvers |
| `import/import-cosmogony-texts.ts` | import a curated batch of Genesis/cosmogony creation-narrative texts | one-shot acquisition batch, ran to completion |
| `maintenance/batch-fix-ia-page-counts.ts` | batch-trim excess pages where DB page count exceeds the IA IIIF manifest count | one-shot IA page-count bugfix, same bug family as `fix-inflated-page-counts.mjs`/`fix-remaining-inflated.ts` |
| `maintenance/fix-chinese-language.mjs` | relabel `language: Unknown` books with CJK-character titles | one-shot language-mistag fix, predates the broader IA non-Latin mistag cleanup |
| `maintenance/fix-false-complete.mjs` | reset books falsely marked "complete" with 0 OCR pages back to `archive_complete` | one-shot pipeline-state repair |
| `maintenance/fix-inflated-page-counts.mjs` | delete excess pages (invalid image URLs) where DB count > IIIF manifest count | one-shot IA import-bug fix |
| `maintenance/fix-remaining-inflated.ts` | scan all IA books and fix any remaining inflated page counts | follow-up sweep for the same IA import bug, ran to completion |
| `maintenance/fix-stuck-jobs.mjs` | fix processing jobs stuck at `completed + failed = total - 1` from a blank-page edge case | one-shot job-state repair; the underlying completion-check bug was fixed at the source |
| `leonardo/leonardo-ocr-prompt.ts` | custom OCR prompt for Leonardo da Vinci facsimiles (mirror writing, drawings, mixed facsimile/commentary) | one-off prompt for a single manuscript batch; the whole `scripts/leonardo/` directory only ever held this one file |

**Verification method:** re-grepped every file's basename (with and without
extension) across `scripts/`, `src/`, `.github/`, `package.json`,
`scripts/workers/crontab.production`, `.claude/docs`, `.claude/skills`,
and `memory/` (excluding `.claude/worktrees` and `node_modules`) on
2026-07-03, immediately before archiving — not just trusting the prior
audit's candidate list. All 27 files had zero functional references; the
two system-map mentions and the `scripts/README.md` leonardo row were
doc/example text, not imports or execution paths, and were updated
alongside this move.
