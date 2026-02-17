# Handoff: Chapter Navigation & Structured Books

**Date:** 2026-02-17
**Context:** Added chapter dropdown to reader, rebuilt chapter extraction with AI, mapped the full summary/index pipeline.

## What Was Built Today

### 1. Chapter Dropdown in Reader (shipped, deployed)
- **`src/components/reader/ChapterDropdown.tsx`** — new component. Compact trigger in Row 1, desktop dropdown + mobile bottom sheet. Amber highlight on current chapter, 3-level indentation, page numbers.
- **`src/components/pipeline/TranslationEditor.tsx`** — integrated in read-mode header between title and page navigator. Computes current chapter via `reduce` over sorted chapters array.
- **`src/app/api/books/[id]/route.ts`** — added `chapters: 1` to nav projection. Note: `display_brightness` was removed from projection by a separate linter change.

### 2. AI-Powered Chapter Extraction (shipped, deployed)
- **`src/app/api/books/[id]/extract-chapters/route.ts`** — completely rewritten. Was: naive markdown heading scraper (1,902 raw headings for Fludd). Now: feeds raw headings + detected TOC pages to Gemini, which identifies real structural divisions.
- Tested on Fludd's *Utriusque Cosmi* (1,036 pages): 1,902 raw headings → 75 clean chapters with correct Tractatus > Pars > Liber hierarchy. Cost: $0.02.
- Logs to `gemini_usage` (type: `other`).

### 3. Fludd Book State
- Book ID: `6952dac677f38f6761bc683a`
- OCR: 1036/1036 (Feb 16, gemini-3-flash-preview) — fresh
- Translation: 1033/1036 (Jan 2, gemini-2.5-flash) — **stale**, needs re-translation
- Chapters: 75 extracted (Feb 17) — fresh
- Index: exists with 6 thematic sections — stale (pre-chapter, pre-new-OCR)
- Summary (`reading_summary`): never generated

---

## Pipeline Architecture (Current State)

```
IMPORT → SPLIT → ARCHIVE → OCR → TRANSLATION → CHAPTERS → INDEX → SUMMARY
                                                    ↑              ↑
                                              (new, AI)    (uses chapters
                                                            if available)
```

### What each step produces

| Step | Input | Output | Model |
|------|-------|--------|-------|
| OCR | page image | `page.ocr.data` (markdown + XML tags) | gemini-3-flash-preview |
| Translation | `page.ocr.data` + prev page | `page.translation.data` (English + `<summary>` + `<keywords>`) | gemini-3-flash-preview |
| Chapters | all OCR headings + TOC pages | `book.chapters[]` (title, pageId, pageNumber, level) | gemini-3-flash-preview |
| Index | all translations (MapReduce) + chapters | `book.index` (sectionSummaries, people, places, concepts, bookSummary) | gemini-3-flash-preview |
| Summary | separate route | `book.reading_summary` (overview, themes, quotes) | gemini-3-flash-preview |

### Key prompt files
- OCR/Translation/Summary page-level prompts: `src/lib/types/prompts/defaults.ts`
- DB prompt lookup: `src/lib/prompts.ts` (getOcrPrompt, getTranslationPrompt, getSummaryPrompt)
- Index batch extraction + book summary synthesis: `src/app/api/books/[id]/index/route.ts` (inline prompts at lines 119-145 and 627-689)
- Chapter extraction: `src/app/api/books/[id]/extract-chapters/route.ts` (inline prompt)

---

## Proposed Improvements

### Priority 1: Harvest Translation Metadata (low effort, high value)

Every translated page already ends with `<summary>` and `<keywords>` tags, but **nothing reads them**. The index route re-extracts this information from scratch at book level.

**Fix:** After translation, parse and persist these to page-level fields:
```
page.translation_summary  — 1-2 sentences (from <summary> tag)
page.translation_keywords — string[] (from <keywords> tag)
```

**Impact:** The index route can use these directly instead of re-reading all translation text. Page-level summaries become available for search snippets, ToC previews, and chapter-level rollups. Saves tokens on index generation.

### Priority 2: Unify Sections (medium effort, high value)

Three overlapping concepts exist:
- `book.chapters[]` — structural divisions extracted from OCR headings (Tractatus/Liber/Caput)
- `book.index.sectionSummaries[]` — AI-generated thematic groupings (5-8 sections)
- `book.reading_sections[]` — defined in the type but never populated

**Proposal:** Make chapters the structural truth, and sections the reading-level summary:
- `book.chapters` = fine-grained structure from OCR (what the author wrote)
- `book.sections` = coarser reading-level groupings, each with a summary, quotes, concepts
- Index generation should **group chapters into sections** rather than inventing its own groupings
- Populate `reading_sections` from the index output so it's a first-class field, not buried in `book.index`

### Priority 3: Chapter-Aware Translation (medium effort, high value)

Currently translation has no awareness of book structure. Each page is translated independently (batch API) or with only the previous page's translation (realtime).

**Proposal:** When chapters exist, inject chapter context into the translation prompt:
```
You are translating page 350 of "Utriusque Cosmi" by Robert Fludd.
This page is in: Tractatus II > Pars I: De Arithmetica Universali > Liber IV: De Arithmetica Geometrica
```

This helps the model:
- Disambiguate terms (e.g., "proportio" means different things in music vs. geometry)
- Maintain consistent terminology within a chapter
- Understand what the text is discussing even without surrounding context

**Implementation:** Modify `getTranslationPrompt()` or the batch job builder to accept optional chapter context. The `book.chapters` array + current page number is enough to determine the chapter path.

### Priority 4: Smarter Index Sections from Chapters (low effort)

The index synthesis prompt (line 664) says "Use the detected chapter structure" when chapters exist, but doesn't specify how to map N chapters into sections. For Fludd's 75 chapters, the AI has to decide whether to produce 75 sections or 6.

**Fix:** The prompt should specify: "Group the chapters into 8-15 reading sections. Each section should cover a coherent topic and span multiple chapters. Use the chapter hierarchy — top-level divisions (Tractatus, Parts) are natural section boundaries."

### Priority 5: Re-Translation Pipeline (operational, no code needed)

For books like Fludd where OCR has been refreshed but translation is stale:
1. Extract chapters (done)
2. Re-translate with batch-translate-async (uses fresh OCR, 50% cheaper)
3. Re-generate index (now has chapters for better section structure)
4. Generate reading_summary

Could be a single "reprocess" button or a pipeline step.

### Priority 6: Page Summary Route (low effort, nice-to-have)

The page-level summary prompt exists (`DEFAULT_PROMPTS.summary`) but is almost never used — the index route does bulk summarization at book level. Individual page summaries could power:
- Tooltip previews when hovering chapter items in the dropdown
- Search result snippets
- Reading progress summaries ("You stopped in the chapter about geometric arithmetic")

Low priority since the `<summary>` tag in translations covers most of this if harvested (Priority 1).

---

## Files Modified This Session

| File | Status | What changed |
|------|--------|-------------|
| `src/app/api/books/[id]/route.ts` | Modified | Added `chapters: 1` to nav projection; `display_brightness` removed separately |
| `src/components/reader/ChapterDropdown.tsx` | New | Trigger + dropdown/bottom-sheet component |
| `src/components/pipeline/TranslationEditor.tsx` | Modified | Import + render ChapterDropdown in Row 1 |
| `src/app/api/books/[id]/extract-chapters/route.ts` | Rewritten | AI-powered chapter extraction replacing naive heading scraper |

## Uncommitted State

All changes are uncommitted and on `main`. Ready to commit.

## Test Commands

```bash
# Extract chapters for any book
curl -X POST https://sourcelibrary.org/api/books/BOOK_ID/extract-chapters

# Check chapters
curl https://sourcelibrary.org/api/books/BOOK_ID/extract-chapters

# Test reader with chapters
# Open: https://sourcelibrary.org/book/6952dac677f38f6761bc683a/page/6952dac677f38f6761bc6867
```
