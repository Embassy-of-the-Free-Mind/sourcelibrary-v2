# Claude Code Guidelines for Source Library

## Development Workflow — CRITICAL
- **Work on the `dev/prototype` branch.** All changes go here, NOT on `main`.
- **Never deploy to production** (`vercel --prod`) from this branch. Use `vercel` (no `--prod`) for preview deploys.
- **Never push to main.** When work is ready, open a PR: `gh pr create --base main`.
- **Preview URL:** Push the branch (`git push`) and Vercel auto-deploys a shareable preview. Use that for testing and sharing with the other dev.
- The production site (sourcelibrary.org) stays untouched until a PR is reviewed and merged.

## Data Protection — CRITICAL
- **NEVER** delete books, pages, or source material without explicit confirmation
- **NEVER** batch delete — list items first, wait for approval
- `deleted_books` collection has recoverable items: `POST /api/books/restore/[id]`
- Assume all books are valuable, even without IA identifiers

## Security — CRITICAL
- Reading `.env*` files is OK for understanding what variables exist
- **NEVER** embed secrets in code — use `process.env.VAR` with no fallback
- Review scripts for hardcoded credentials before committing

## Stack
- Next.js 16, MongoDB Atlas, Gemini AI, Vercel deployment
- Production database: `bookstore` (1,200+ books), NOT `sourcelibrary_research`

## AI Models — IMPORTANT
- Summary/Index generation: ALWAYS use `gemini-3-flash-preview`. This was a recurring issue — do not use older models.
- OCR/Translation: check batch-ocr and translate routes for current models
- Reference: https://ai.google.dev/gemini-api/docs/models

## Audit Trail
All AI calls logged to `gemini_usage` collection via `logGeminiCall()` in `src/lib/gemini-logger.ts`.
- Book history timeline: `GET /api/books/[id]/history` (assembles from 6 collections)
- Dashboard: `GET /api/admin/processing-dashboard?provider=ia`
- Error classification: `src/lib/errors.ts` → `classifyError(error)`
- `cost_tracking` collection is DEPRECATED — use `gemini_usage` for all cost queries

## QA Audit Workflow
- Check 20-30 pages per book, compare catalog metadata vs title page OCR, align to USTC
- Save reports to `QAreport.md`, keep auditing until told to stop

## IA Page Count Bug
Books imported before Dec 30, 2025 may have wrong page counts. See `docs/ia-page-count-bug-report.md`.
- Too many pages: `npx tsx scripts/maintenance/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY`
- Too few pages: reimport via `POST https://sourcelibrary.org/api/books/{id}/reimport`

## Reference Docs
- Import APIs (Gallica, IA, MDZ, Wellcome, e-rara): @.claude/docs/import-apis.md
- Image archiving & provenance: @.claude/docs/image-archiving.md
- Observability & audit trail: @.claude/docs/observability.md
- Page processing lifecycle: @.claude/docs/page-lifecycle.md
- Lambda worker architecture: @.claude/docs/worker-architecture.md
- Batch processing (Gemini Batch API): @.claude/docs/batch-processing.md
- Edition publishing & DOI minting: @.claude/docs/editions.md
- Social media system: @.claude/docs/social-media.md
- Analytics & engagement: @.claude/docs/analytics.md
- Search system: @.claude/docs/search.md
- Schema.org structured data: @.claude/docs/structured-data.md
- Style system (colors, tokens, shared constants): @.claude/docs/style-system.md
- Full processing pipeline (states, crons, prompts, costs): @.claude/docs/pipeline.md
- First translation identification system: @.claude/docs/first-translation-system.md
- Thumbnails & cover selection: @.claude/docs/thumbnails.md
