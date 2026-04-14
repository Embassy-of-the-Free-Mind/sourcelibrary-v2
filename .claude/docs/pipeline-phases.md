# Pipeline Phase Reference

The processing pipeline moves books from import to completion through numbered phases.
Each phase has a corresponding `pipeline_auto.status` value in MongoDB.

## Phase Map

| Phase | Name | Status transition | Worker | Description |
|-------|------|-------------------|--------|-------------|
| **0** | Auto-enroll | `→ queued` | orchestrator | Recently imported books get enrolled in the pipeline |
| **1** | Archive check | `queued → archive_complete` | orchestrator | Verifies page images are archived to R2 |
| **1.25** | Split detection | `archive_complete → split_checked` | orchestrator | Detects two-page spreads via aspect ratio + Gemini vision. Flags `needs_splitting=true` for spread-aware OCR |
| **1.5** | Preview OCR | `split_checked → preview_ocr_complete` | orchestrator (inline) | OCR first 25 pages via inline Gemini (not Batch API). Provides text for AI classification |
| **1.6** | AI metadata | `preview_ocr_complete → metadata_enriched` | orchestrator (inline) | Classifies language, subject, resource type from preview text. Also runs USTC catalog cross-reference |
| **2** | OCR submission | `metadata_enriched → ocr_submitted` | orchestrator → Gemini Batch | Submits full book to Gemini Batch API for OCR. Spread-flagged books get spread-aware prompt |
| **3** | OCR completion | `ocr_submitted → ocr_complete` | orchestrator | Polls Gemini batch jobs. Writes OCR results to pages. Picks initial cover from page types |
| **3.1** | Post-OCR split | `ocr_complete + needs_splitting → split` | orchestrator | For spread books: creates child pages from OCR-detected page boundaries |
| **3.5** | OCR quality gate | `ocr_complete → ...` | orchestrator | Checks OCR quality. Low-quality books can be sent back for re-OCR |
| **3.7** | Transliteration | `ocr_complete → ...` | orchestrator (inline) | Adds Latin transliteration for non-Latin scripts (Hebrew, Arabic, Greek, etc.) |
| **4** | Translation dispatch | `ocr_complete → translate_submitted` | orchestrator → Hetzner | Creates translation jobs. Hetzner `translate-worker.mjs` picks them up (NOT Lambda, NOT Batch API) |
| **5** | Translation check | `translate_submitted → translate_complete` | orchestrator | Polls translation job completion. Recycles incomplete books back to Phase 4 |
| **6** | Summary + Index | `translate_complete → summary_indexed` | enrich-worker | Generates AI summary and keyword index from translated text. Model: `gemini-3.1-flash-lite-preview` |
| **7** | Chapters | `summary_indexed → chapters_complete` | enrich-worker | Extracts chapter structure from OCR text. Model: `gemini-3-flash-preview` |
| **7.5** | Quality scoring | (no status change) | enrich-worker | Assigns quality score (0-1) based on OCR/translation quality, completeness, content richness. Model: `gemini-3-flash-preview` |
| **7.6** | Collection assignment | (no status change) | enrich-worker | Scores book relevance to each collection. Model: `gemini-3.1-flash-lite-preview` |
| **8** | Image extraction | `chapters_complete → images_submitted/complete` | orchestrator → Lambda | Detects and extracts illustrations via AI vision. Submitted to SQS → Lambda |
| **8.5** | Staleness detection | (no status change) | orchestrator | Detects books with stale/outdated processing that need re-running |
| **8.9** | Cover selection | `images_complete → cover_selected` | orchestrator | Picks best cover image using gallery quality scores, page type, position. Hides digitizer pages |
| **9** | Finalize | `cover_selected → complete` | orchestrator | Marks book as fully processed |

## Workers

| Worker | Location | Runs on | Phases |
|--------|----------|---------|--------|
| `pipeline-orchestrator.mjs` | Hetzner | Cron (every 5 min) | 0, 1, 1.25, 1.5, 1.6, 2, 3, 3.1, 3.5, 3.7, 4, 5, 8, 8.5, 8.9, 9 |
| `enrich-worker.mjs` | Hetzner | Cron (every 10 min) | 6, 7, 7.5, 7.6 |
| `translate-worker.mjs` | Hetzner | Cron (every 2 min) | Executes Phase 4 jobs |
| Lambda `sourcelibrary-ocr-processor` | AWS eu-central-1 | SQS trigger | Executes Phase 8 jobs |

## Running Individual Phases

```bash
# Run only one phase
node scripts/workers/pipeline-orchestrator.mjs --phase 2
node scripts/workers/enrich-worker.mjs --phase 7.5

# Dry run (no writes)
node scripts/workers/pipeline-orchestrator.mjs --dry-run
```

## Pausing

```bash
# Pause all phases
POST /api/admin/emergency-stop

# Pause specific phases (by name, not number)
# In system_config.processing_control:
paused_phases: ['ocr', 'translation', 'images']

# Resume
POST /api/admin/emergency-stop?resume=true
```

Note: `paused: true` in `system_config` only stops the orchestrator. Lambda and Hetzner workers with active jobs will continue until their current job finishes. To truly stop processing, cancel jobs in MongoDB.

## Status Flow Diagram

```
import → queued → archive_complete → split_checked → preview_ocr_complete
→ metadata_enriched → ocr_submitted → ocr_complete → translate_submitted
→ translate_complete → summary_indexed → chapters_complete
→ images_submitted → images_complete → cover_selected → complete
```

Branch at Phase 3.1: books with `needs_splitting=true` go through post-OCR split before continuing.
