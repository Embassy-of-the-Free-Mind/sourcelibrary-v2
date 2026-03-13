# Claude Code Guidelines for Source Library

## Development Workflow — CRITICAL
- **Work on the `dev/prototype` branch.** All changes go here, NOT on `main`.
- **NEVER run `vercel --prod` from this branch.** The CLI deploys whatever is on disk — it ignores the Vercel production branch setting. This has caused accidental production deploys before. Use `vercel` (no `--prod`) for preview deploys only.
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
- Production database: `bookstore` (5,355 books), NOT `sourcelibrary_research`

## AI Models — IMPORTANT
- Summary/Index generation: ALWAYS use `gemini-3-flash-preview`. This was a recurring issue — do not use older models.
- OCR/Translation: check batch-ocr and translate routes for current models
- Reference: https://ai.google.dev/gemini-api/docs/models

## Domain Context
Detect the work domain from the user's prompt and load the right context automatically:
- **Pipeline/cron/Lambda/OCR/translation work:** read `memory/pipeline-ops.md` (or invoke `/pipeline-context` for full context)
- **UI/frontend/navigation:** read `memory/ui-navigation.md` (or `/ui-context`)
- **Data fixes/maintenance/stuck books:** read `memory/data-quality.md` (or `/maintenance`)
- **Book acquisition:** `/curator` or `/library-curator`
- **Quality auditing:** `/qa-audit`
- **Batch processing:** `/batch-translate`
- **MCP server/CLI:** read `memory/mcp-server.md`
- **Handoffs:** `.claude/handoffs/` (read by date/topic)
- **Reference docs:** `.claude/docs/` (read on demand, never all at once)

## Knowledge Maintenance
- **After fixing a non-trivial bug**, proactively update the relevant memory file following the `/lesson` workflow. Don't wait to be asked.
- When reading memory files, flag anything that contradicts the current codebase and fix it.
- Memory entries with dates >14 days old: verify before trusting stats/counts.

## Compaction Instructions
When compacting (`/compact`), ALWAYS preserve:
- List of files modified this session
- Current task state and what was agreed with the user
- Any test results, errors, or deployment outcomes
- Which domain memory files were already read (avoid re-reading)
