---
name: maintenance
description: Load context for data fixes, page count corrections, and quality issues. Use when fixing specific books, debugging data problems, or running maintenance scripts.
---

# Maintenance Context

Read these files before proceeding with maintenance work:

1. `memory/data-quality.md` — Known issues by date range
2. `memory/lessons-learned.md` — Postmortem patterns
3. `.claude/docs/thumbnails.md` — Cover selection and thumbnail fixes

## IA Page Count Bug

Books imported before Dec 30, 2025 may have wrong page counts. See `docs/ia-page-count-bug-report.md`.
- Too many pages: `npx tsx scripts/maintenance/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY`
- Too few pages: reimport via `POST https://sourcelibrary.org/api/books/{id}/reimport`

## Common Maintenance Tasks

- **Reset stuck book:** Set `pipeline_auto.status` to `metadata_enriched`, clear `retry_count` and `error`
- **Cancel zombie jobs:** Query `jobs` with `status: 'processing', updated_at: { $lt: 2h ago }`, set to `cancelled`
- **Fix thumbnail:** Use `CoverImagePicker` or `fixStaleThumbnail()` in pipeline cron
- **Restore deleted book:** `POST /api/books/restore/[id]`
- **51 empty shells:** `pipeline_auto.status: 'empty_shell'` — don't delete, may have metadata

## Also Relevant

- Image archiving & provenance: `.claude/docs/image-archiving.md`
- Import APIs (Gallica, IA, MDZ, Wellcome, e-rara): `.claude/docs/import-apis.md`
