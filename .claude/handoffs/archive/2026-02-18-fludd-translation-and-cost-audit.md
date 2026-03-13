# Handoff: Fludd Translation Complete & Cost Tracking Audit

**Date:** 2026-02-18
**Previous session:** 2026-02-17-chapter-navigation-and-structured-books.md

## What Happened This Session

### 1. Fludd Translation Complete
- Job `kfRCG8qIetxj` — 1,036/1,036 pages, zero failures
- Lambda FIFO translation (sequential with cross-page context), took ~5 hours
- **Cost:** $0.56 (1.97M input / 0.91M output tokens)
- Translation metadata harvesting working: 866 of 1,036 pages have `translation_summary` + `translation_keywords` (remaining ~170 are blank/illustration pages)

### 2. Chapters Re-Extracted
- Re-ran chapter extraction on Fludd with fresh translations
- 25 clean chapters (down from 74 in previous noisy run — better, cleaner structure)
- Tractatus > Liber > Pars hierarchy with English titles
- Cost: ~$0.02

### 3. Cost Tracking Audit
User asked about cost data organization. Findings:

**What works:**
- `gemini_usage` is single source of truth — 714k records
- 99.7% have `book_id` — per-book cost rollups work
- Every record has `type`, `mode`, `model`, `endpoint`
- `input_tokens` + `output_tokens` on 92% of records

**Gaps:**
| Issue | Severity | Detail |
|-------|----------|--------|
| `cost_usd` unreliable | Medium | Only 282k of 714k records have it. Batch jobs log `cost_usd: 0` at submission, actual tokens in separate collection record. Must compute from tokens. |
| Batch `page_ids` bloat | Low | Batch records store full page_ids array inline (500+ IDs per record). Wasteful but not breaking. |
| Missing `job_id` on 26% | Low | Lambda worker records link to jobs, but batch API and realtime `/api/process` records often don't. |
| One top book missing title | Low | Book `699209c4bed8f4b5ff5b2c6b` — $18.58 spent, 15k calls, no `book_title` in usage records. Older logging. |
| `status` inconsistency | Low | Batch records use `"submitted"` instead of `"success"`/`"failed"`. |

**Top 10 books by cost (all-time):**
1. $18.58 — (untitled, 15k calls)
2. $6.32 — De secretis mulierum
3. $4.81 — Opera Mathematica Vol. 3
4. $4.80 — Schutzschrift Rosenkreutzer
5. $4.64 — Les secrets les plus cachés
6-10. $2.90-$3.74 range

**Aggregate spend:** $241.40 in last 7 days (608k calls). Feb 17 alone: $37.06, dominated by OCR campaign ($36.31).

### 4. Wider TOC Dropdown
- Width: `w-[34rem]` (up from `w-[26rem]`)
- Font sizes bumped across the board: headers, chapter titles, subtitles, page numbers
- Deployed to Vercel

## Fludd Book State (Final)

Book ID: `6952dac677f38f6761bc683a`

| Step | Status | Detail |
|------|--------|--------|
| OCR | 1036/1036 | Feb 16, gemini-3-flash-preview |
| Translation | 1036/1036 | Feb 17, gemini-3-flash-preview, FIFO Lambda |
| Chapters | 25 extracted | Feb 18, with English titles |
| Metadata | 866 pages | translation_summary + translation_keywords |
| Index | Stale | Pre-chapter, pre-new-translation. Needs re-generation. |
| reading_summary | Missing | Never generated. |

## Global Stats

| Metric | Value |
|--------|-------|
| Total translated pages | 81,538 |
| Pages with translation_summary | 46,057 (56.5%) |
| Pages with translation_keywords | 46,057 (56.5%) |

## Commits

4. (no new commit this session — only dropdown width change, can be bundled with next work)

Previous commits from Feb 17:
1. `a3381a5` — Chapter navigation dropdown + AI chapter extraction
2. `adf8602` — English translations for chapter titles
3. `759dbf3` — Harvest `<summary>` + `<keywords>` from translations
4. `7847a4c` — Update handoff with remaining work

## Lambda Workers

Translation worker deployed by colleague on Feb 17 — metadata harvesting is live and working (confirmed by 866 Fludd pages with metadata).

## Next Steps

1. **Fludd enrichment:** Re-generate index (now has chapters + fresh translations), generate `reading_summary`
2. **Cost tracking cleanup:** Consider computing and storing `cost_usd` reliably on all `gemini_usage` records (or just always compute from tokens at read time and drop the field)
3. **Remaining work from previous handoff:** Unify sections, better index grouping, surface metadata in UI
4. **Commit** the dropdown width change (trivial, can bundle)
