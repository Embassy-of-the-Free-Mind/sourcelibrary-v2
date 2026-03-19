# Pipeline Preview System — 2026-03-19

## What Was Built
Preview pipeline that OCRs and translates the first 25 pages of books via Lambda/Vercel API, giving readers content within minutes instead of waiting for the full pipeline (hours).

### New Pipeline Phases (Hetzner orchestrator)
- **Phase 1.5** — Preview OCR: sends first 25 pages to Lambda OCR via SQS. Only queues pages with `archived_photo` or `cropped_photo` (Lambda can't reliably fetch from archive.org).
- **Phase 1.7** — Preview Translation: calls `/api/process` inline for each OCR'd page. Bypasses the 222K-deep SQS translation queue. ~2.5min per book.

### Priority System
Both phases prioritize:
1. Confirmed `is_first_translation: true` books
2. Non-English language books (Latin, Arabic, Chinese, etc. — likely first translations)
3. English books last

## What's Working
- Preview OCR: 25+ books processed, 15 at 100% completion
- Preview translation: 5 books translated inline, zero errors
- Hetzner pipeline picks up both phases every 5-min cycle
- All German alchemical texts (Paracelsus, Crollius, Turba Philosophorum) now have first 25 pages readable

## What's Broken / Blocked
1. **Gemini Batch API OCR (#256)** — returning 0 pages for days. Phase 2 disabled. This is the main OCR path for full books — only 4 books at `ocr_submitted`. ~5,800 books stuck at `archive_complete`.
2. **Writer Lambda needs redeployment** — IAM user `sourcelibrary` only has `lambda:UpdateFunctionCode` for `sourcelibrary-ocr-processor`. Needs permission for all 4 functions (`write-processor`, `translation-processor`, `image-extraction-processor`). Without this, the Vercel import flow can't auto-trigger preview translation.
3. **222K SQS translation backlog** — Phase 4 dispatched full-book translations. Lambda processing at ~2,500 pages/hr but backlog will take ~89 hours to clear.

## Key Files
- `scripts/workers/pipeline-orchestrator.mjs` — Phases 1.5, 1.7, and disabled Phase 2
- `src/lib/preview-ocr.ts` — Vercel-side preview OCR (import flow)
- `src/lib/preview-translate.ts` — Vercel-side preview translation (auto-trigger from job-completion)
- `src/lib/job-completion.ts:155-163` — Writer Lambda auto-trigger (needs Lambda redeploy)
- Lambda builds: `dist/packages/*.zip` (rebuilt 2026-03-19, not all deployed)

## Branch State
- Changes are on `dev/prototype` (Hetzner runs this)
- Feature branch `feat/pipeline-preview-ocr` was created but incomplete — changes ended up on dev/prototype
- Per new CLAUDE.md: future work should use feature branches off `main`

## Next Steps
1. Fix #256 (Batch API) — re-enable Phase 2 for full-book OCR
2. Update IAM policy → deploy all 4 Lambdas
3. Consider: dedicated high-priority SQS queue for preview translations (avoids inline API calls)
4. Run Phase 1.5 + 1.7 in a loop to process more preview books while Batch API is down
