# Scripts

Utility scripts organized by purpose. All require MongoDB access via `.env.production.local`.

## Running Scripts

```bash
# Node scripts (.mjs)
set -a; source .env.production.local; set +a; node scripts/batch/bulk-reocr-local.mjs --limit=5

# TypeScript scripts (.ts)
set -a; source .env.production.local; set +a; npx tsx scripts/maintenance/fix-ia-page-counts.ts --book-id=XXX

# Or with secret-lover (foreground only)
secret-lover run -- node scripts/batch/collect-batch-results.mjs --concurrency 15
```

## Directories

| Directory | Purpose | Examples |
|-----------|---------|---------|
| `analysis/` | Data inspection, reporting, audits | pipeline-stats, work-coverage |
| `aws-lambda/` | Lambda worker build & deploy | build-lambda.sh, package-lambda.sh, deploy-lambda.sh |
| `batch/` | Bulk OCR, translation, chapter extraction | bulk-reocr-local, collect-batch-results, run-bulk-reocr.sh |
| `custom-prompts/` | Custom OCR prompt text files | kircher.txt, zohar.txt |
| `enrichment/` | Metadata enrichment & backfill | enrich-from-catalogs, normalize-languages, backfill-year |
| `import/` | Batch book importing | batch-import-new-thought, import-thirukkural |
| `maintenance/` | Fixes, cleanup, archiving | fix-ia-page-counts, cleanup-gemini-files, archive-images-fast |
| `one-off/` | Historical scripts (already ran) | generate-brand-kit, ocr-cosmogony-realtime |
| `thumbnails/` | Image thumbnail generation | generate-thumbnails-fast, generate-thumbnails |
