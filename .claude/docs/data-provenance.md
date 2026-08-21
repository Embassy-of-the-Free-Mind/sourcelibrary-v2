# Data Provenance — How Every Piece of AI Output Traces Back to Its Source

Every OCR transcription, translation, summary, index, chapter extraction, and image extraction in Source Library can be traced back to the exact prompt, model, trigger, and job that produced it. This document explains the full chain.

> **Last full audit:** 2026-05-05. See `.claude/handoffs/2026-05-05-provenance-audit.md` for the audit report and the gaps closed.

## The Provenance Chain

```
Page Image (IIIF source)
  → Prompt (DB-stored; full reference fetched at submission)
    → Gemini Model
      → Page Text (with prompt_id + prompt_hash + prompt_name + prompt_version + source)
        → Prior version snapshotted to page_revisions
        → Gemini call logged to Supabase gemini_usage
            (with triggered_by, book_id, prompt_version, endpoint)
              → Index/Summary derived from translated pages
                → Book Field (summary | reading_summary | index | chapters)
                  → Prior version snapshotted to book_revisions
```

## 1. Prompts — What Instructions Produced This Output?

### Where prompts live

**Git (source of truth for content):** `prompts/` directory
```
prompts/
├── ocr/                  ← versioned (current: v10)
├── translation/          ← versioned (current: v8 default; per-language variants)
├── summary/              ← (also see inline INDEX_PROMPT_VERSION below)
├── modernization/        ← English Early Modern → Modern
├── transliteration/      ← Non-Latin → Latin characters
├── image-extraction/     ← Museum metadata for illustrations
├── metadata-enrichment/  ← Title/year/language from OCR
├── chapter-extraction/   ← TOC/structure analysis
├── collection-relevance/ ← Thematic classification
├── faceted-tagging/      ← 6-facet Llullian classification
├── cover-selection/      ← Best cover image
├── quality-scoring/      ← Book quality rating
├── split-detection/      ← 2-page spread detection
└── book-index/           ← Batch page analysis (entities, themes)
```

**MongoDB `prompts` collection (source of truth for which version is active):**
- Each prompt has: `name`, `type`, `version`, `is_default`, `content`, `content_hash`
- Only one prompt per `(type, name)` should have `is_default: true`
- Old versions are NEVER deleted — they're the audit trail

**Inline prompts** for index/summary generation are versioned via the `INDEX_PROMPT_VERSION` constant in `src/app/api/books/[id]/index/route.ts` (and the tenant variant) and the corresponding constant in `scripts/workers/enrich-worker.mjs`. Bump these when the prompt strings in those files change. The version is logged to `gemini_usage.prompt_version` and stored on the resulting `book.summary.prompt_version`.

### How pages reference prompts

Every page record stores all four fields, written together at the time of every overwrite:

```javascript
page.ocr.prompt_version    // "v10"
page.ocr.prompt_id         // ObjectId-string of the prompt document, or 'hardcoded' / 'custom'
page.ocr.prompt_hash       // md5 of prompt content (cryptographic verifier)
page.ocr.prompt_name       // "Standard OCR" | "Latin OCR (Neo-Latin)" | etc
page.ocr.source            // see the full enum below — 16 values, not 5
page.translation.prompt_version
page.translation.prompt_id
page.translation.prompt_hash
page.translation.prompt_name
page.translation.source
```

Books store the same shape on AI-generated fields:

```javascript
book.summary = { data, model, prompt_version, source, generated_at, ... }
book.reading_summary = { overview, detailed, themes, quotes, model, prompt_version, source, generated_at }
book.index = { ...generatedAt, pagesCovered, totalPages, vocabulary, keywords, people, places, concepts, sectionSummaries, bookSummary }
book.chapters = [...]   // chapters_extracted_at marks the run
```

### How the four fields get there

The route or worker that calls Gemini fetches a `PromptLookupResult` from `getOcrPrompt() / getTranslationPrompt() / getSummaryPrompt() / getImageExtractionPrompt()`. That result is:

```ts
{
  text: string;
  reference: { id, name, version, content_hash };
}
```

For batch jobs the four fields are stamped on the `batch_jobs` row at submission, and the result-collector copies them onto each page. For realtime calls they're written directly. For the inline index/summary prompts there is no DB row, so `prompt_id = 'hardcoded'` and `prompt_version = INDEX_PROMPT_VERSION`.

### How to create a new prompt version

1. Query max version: `db.prompts.find({ type: 'TYPE', name: 'NAME' }).sort({ version: -1 }).limit(1)`
2. Insert new doc with `version: max + 1`, `is_default: true`
3. Set `is_default: false` on the old version
4. VERIFY: `db.prompts.countDocuments({ type: 'TYPE', name: 'NAME', is_default: true })` must be exactly 1
5. Save the prompt content to `prompts/` directory in git
6. **NEVER edit or delete old versions**

### Current defaults (as of audit)

| Type | Name | Version | Key features |
|------|------|---------|-------------|
| OCR | Standard OCR | v10 | `<script>` tag, calibrated `<unclear>` (5-15%), manuscript rules |
| Translation | Standard Translation | v8 | XML tags (`<note>`, `<term>`, `<gloss>`), no brackets, multilingual |
| Translation | Latin | v2 | Neo-Latin specific |
| Translation | German | v2 | Early Modern German specific |
| Translation | Cuneiform | v1 | Sumerian/Akkadian specific |
| Index/Summary | Inline | INDEX_PROMPT_VERSION = 'inline-2026-05' | Themes/quotes/people/places/concepts batch extraction |

## 2. Page Revisions — What Was on This Page Before?

### How it works

`page_revisions` collection stores every previous version of OCR and translation content. Before any overwrite, `createRevision(pageId, field, jobId?)` saves the current content.

**File:** `src/lib/page-revisions.ts` (Lambda/Next.js routes) and inline `saveRevisionBeforeOverwrite()` in each Hetzner worker (`scripts/workers/batch-collector.mjs`, `translate-worker.mjs`, `pipeline-orchestrator.mjs`).

### What's stored per revision

```javascript
{
  id: "nanoid",
  page_id: "...",
  book_id: "...",
  field: "ocr" | "translation",
  data: "the full previous text content",
  source: "batch_api" | "ai" | "pipeline_preview" | "manual" | "skip" | "system" |
          "maintenance" | "mineru" | "realtime_api_sequential" | "unknown" | null |
          "<sweep-label>",   // ad-hoc, e.g. "shift-repair-erara-2026-07",
                             // "reocr-download-failure-fix-2026-07"
  model: "gemini-3-flash-preview",
  prompt_version: "v10",
  job_id: "job_abc123",
  original_date: Date,  // when this content was originally WRITTEN  (a reading clock)
  created_at: Date      // when it was SUPERSEDED (a snapshot clock — see below)
}
```

### The live `pages.{ocr,translation}.source` enum

Exact counts, 2026-08-04, `node scripts/audit/doc-enum-drift.mjs`. **Guarded** —
that script fails when production carries a value this doc does not mention, so
the list below stays true or the audit says so.

| `pages.ocr.source` | rows | | `pages.translation.source` | rows |
|---|---|---|---|---|
| `batch_api` | 4,159,051 | | `ai` | 5,153,668 |
| `ai` | 2,070,501 | | `system` | 92,420 |
| `pipeline_preview` | 210,527 | | `batch_api` | 82,826 |
| `corpus` | 5,749 | | `corpus` | 5,759 |
| `mineru` | 2,586 | | `skip` | 1,153 |
| `system` | 775 | | `realtime_api_sequential` | 62 |
| `spread-split` | 277 | | `manual` | 21 |
| `ia-ocr-repair` | 191 | | `manual-backfill` | 12 |
| `reocr-contamination-repair-3362` | 93 | | `broadsheet-ocr` | 2 |
| `batch_api_recovery` | 74 | | `songshi-juan56` | 1 |
| `manual` | 33 | | `AI generated` | 1 |
| `wikisource` | 21 | | | |
| `ai-repair-sync` | 11 | | | |
| `broadsheet-ocr` | 2 | | | |
| `songshi-juan56` | 1 | | | |
| `AI generated` | 1 | | | |

Three things in that table are load-bearing:

- **`wikisource` (21 pages) is not model output at all.** Neither is `corpus`
  (~5.7K on each field). Any metric that treats `pages.ocr` as "what the model
  read" is wrong on those rows, and no field other than `source` says so.
- **Repair sweeps write here too**, exactly as they do on `page_revisions`:
  `ia-ocr-repair`, `reocr-contamination-repair-3362` (the #3362 shared-key
  contamination), `spread-split`, `ai-repair-sync`. Text carrying one of these
  was *relocated or rewritten*, not read from the page in front of it.
- **`songshi-juan56` and `AI generated` (1 row each) are junk labels** — a book
  slug and a free-text string that leaked into an enum. Left documented rather
  than silently ignored, because the alternative is an audit that has to be
  taught to lie.

**`source` is the mechanism label, and it is the first thing to read when asking
what a set of revisions actually records.** Measured 2026-08-01 (`node
scripts/audit/ocr-revision-provenance.mjs`), it cleanly separates real OCR passes
from bulk maintenance:

| source | ocr rows | translation rows | leaf-shifted (ocr) |
|---|---|---|---|
| `batch_api` | 109,982 | 6,584 | 3.8% |
| `shift-repair-erara-2026-07` | 56,413 | 55,272 | **99.0%** |
| `pipeline_preview` | 12,949 | — | 0.8% |
| `ai` | 8,622 | 68,988 | 0% |

A **sweep label** like `shift-repair-erara-2026-07` is written by a one-off
maintenance script rather than the pipeline. Keep writing them — that label is the
only reason the #3357 text-shift population is separable from genuine re-OCR at
all (#3473). Two rules follow:

- **Any bulk script that overwrites `ocr` or `translation` must set a distinctive
  `source`**, not inherit `ai`/`batch_api`. A sweep that borrows a pipeline label
  is indistinguishable from real model output forever after.
- **Add the label here when you write it.** This enum had drifted to 5 documented
  values against 12 in production, and the undocumented ones covered 111,685 rows
  — so an audit inferred the mechanism from page-number arithmetic and scan images
  that a `distinct('source')` would have answered in one query.

**The two dates are not interchangeable.** `created_at` is when the row was
*snapshotted*, so it is later than the text it holds — the live `pages.ocr.updated_at`
is older than it on ~84% of pairs, and inversion against it proves nothing.
`original_date` (91.8% of rows) is the reading clock: on pairs whose model
demonstrably changed it precedes the live `ocr.updated_at` 99.3% of the time.

### Where createRevision() is called

- Lambda OCR worker (`ocr-processor-logic.ts`)
- Lambda translation worker (`translation-processor-logic.ts`)
- Lambda write worker (`write-processor-logic.ts`)
- Realtime API: `/api/process` (autoSave path)
- Batch OCR (`/api/books/[id]/batch-ocr-async` GET, both tenant and non-tenant)
- Batch translation (`/api/books/[id]/batch-translate-async` GET)
- Batch save (`/api/batch-save`)
- Translation stitching (`/api/books/[id]/stitch-translations`)
- Manual page edits (`/api/pages/[id]` and tenant variant)
- Community contributions (`/api/contribute/process`)
- Hetzner workers: `batch-collector.mjs` (per-result), `translate-worker.mjs` (per-page write **including blank/safety/recitation marker overwrites — fixed 2026-05-05**), `pipeline-orchestrator.mjs`

### Restoring a previous version

```javascript
import { restoreRevision } from '@/lib/page-revisions';
await restoreRevision(revisionId, 'admin@sourcelibrary.org');
// Saves current content as new revision first, then restores old content
```

### Querying history

```javascript
// All revisions for a page's OCR
db.page_revisions.find({ page_id: pageId, field: 'ocr' }).sort({ created_at: -1 })

// All revisions for a page's translation
db.page_revisions.find({ page_id: pageId, field: 'translation' }).sort({ created_at: -1 })
```

## 3. Book Revisions — What Was on This Book Before?

`book_revisions` collection stores prior values of book-level AI-generated fields when they're regenerated. Without this, the `/api/books/[id]/index` route would silently destroy summary and index content on every regeneration.

**Module:** `src/lib/book-revisions.ts` (Next.js side) and `scripts/workers/lib/book-revisions.mjs` (Hetzner side).

### Tracked fields

- `book.summary` (the brief)
- `book.reading_summary` (overview/detailed/themes/quotes)
- `book.index` (the full structured index)
- `book.chapters[]` (extracted chapter list)

### When createBookRevision() is called

- `GET /api/books/[id]/index` (and tenant variant) — before writing the regenerated index/summary
- `POST /api/books/[id]/index` — before clearing the cache (so even `$unset` is recoverable)
- Hetzner enrich-worker Phase 6 (summary write) and Phase 7 (chapter extraction)

### What's stored

The full prior value, plus any provenance metadata that was on it (model, prompt_version, prompt_id, prompt_hash, prompt_name, generated_at). Reads provenance off the existing field's shape — no caller burden.

### Restoring

```javascript
import { restoreBookRevision } from '@/lib/book-revisions';
await restoreBookRevision(revisionId, 'admin@sourcelibrary.org');
// Snapshots current value as new revision, then restores old
```

## 4. Gemini Usage — What Model, When, and Triggered by What?

`gemini_usage` is the single source of truth for AI cost/usage tracking. **Primary store is Supabase Postgres** (since 2026-04-10, issue #567 Phase 3). The MongoDB collection of the same name is a near-empty stub kept only as a build-time fallback when `SUPABASE_SERVICE_ROLE_KEY` is unset.

### Schema

```javascript
{
  id: "gu_<timestamp>_<rand>",
  timestamp: Date,
  type: "ocr" | "translation" | "transliterate" | "summary" | "extract_images"
        | "extract_chapters" | "index" | "ft_verification" | "other",
  mode: "realtime" | "batch",
  model: "gemini-3.1-flash-lite-preview" | "gemini-3-flash-preview" | ...,

  // Context
  book_id: "...",
  book_title: "...",
  page_ids: ["..."],
  page_count: 12,

  // Batch tracking
  batch_job_id: "...",
  gemini_job_name: "...",

  // Usage
  input_tokens: 1500,
  output_tokens: 800,
  cost_usd: 0.00047,

  // Result
  status: "success" | "failed" | "pending" | "submitted",
  error_message: "...",
  error_category: "rate_limit" | "timeout" | "safety_block" | ...,

  // Provenance
  prompt_version: "v10" | "inline-2026-05" | "stitch-inline-2026-05" | ...,
  endpoint: "/api/[tenant]/books/[id]/batch-ocr-async",  // route or 'worker/<name>'
  triggered_by: "cron" | "manual" | "auto_recovery" | "worker" | "unknown",

  // Performance
  duration_ms: 2340,
  job_id: "...",  // links to MongoDB jobs collection
}
```

### How `triggered_by` is set

- **Routes** call `getTriggerSource(request)` from `src/lib/cron-auth.ts`. It returns `'cron'` for Vercel-managed cron (`User-Agent: vercel-cron/*`) or external cron that authenticated with `CRON_SECRET` bearer; otherwise `'manual'`.
- **Cron-only admin routes** (`bulk-reocr`, `bulk-ocr-new`) hardcode `triggered_by: 'cron'` because they're gated by `verifyCronAuth`.
- **Lambda workers** and **Hetzner workers** set `TRIGGER_SOURCE=worker` (or `auto_recovery` for re-runners) in their environment. `gemini-logger.ts` picks that up as the default when `triggered_by` is unset on a call.
- **lib/ helpers** (cover-selection, metadata-enrichment, quality-scoring, etc.) accept `triggered_by` as an optional parameter and forward to the logger.
- **Contributor flow** (`/api/contribute/process`) hardcodes `triggered_by: 'manual'` (and the per-page log carries the contributor's identity in audit_log).

### Where `gemini_usage` is read

- `/api/books/[id]/history` (timeline) — via `src/lib/book-history.ts`. Supabase primary, MongoDB merge.
- `/admin/health`, `/admin/realtime`, `/api/usage`, `/admin/processing-dashboard`, `/admin/processing-overview`, `/admin/dashboard` — all migrated to Supabase as primary on 2026-05-05 (PR following this audit).

## 5. The Rules

### Page-level (ocr.data, translation.data)

> Any code path that overwrites `ocr.data` or `translation.data` MUST call `createRevision(pageId, field, jobId?)` first.

This is non-negotiable. It applies to placeholder writes (blank-page markers, safety/recitation block markers) too — what looks like a no-op overwrite can clobber a real prior value on retry.

### Book-level (summary, reading_summary, index, chapters)

> Any code path that overwrites `book.summary`, `book.reading_summary`, `book.index`, or `book.chapters` MUST call `createBookRevision(bookId, field)` first.

For multiple fields use `createBookRevisions(bookId, fields)` to fan out in parallel.

### gemini_usage

> Any AI call that produces or modifies stored content MUST log a `gemini_usage` row.

Cost-only events that produce no stored output (eg. dry-run validations) can skip — but if it produced data, log it. Always include `book_id`, `triggered_by`, and `prompt_version` when known.

## 6. Tracing a Specific Page

To reconstruct the full history of page `XYZ`:

```javascript
const db = await getDb();

// Current content + which prompt produced it
const page = await db.collection('pages').findOne({ id: 'XYZ' });
console.log('OCR prompt:', page.ocr.prompt_version, page.ocr.prompt_id, page.ocr.prompt_hash);
console.log('Translation prompt:', page.translation.prompt_version, page.translation.prompt_id);
console.log('OCR model:', page.ocr.model, 'source:', page.ocr.source);
console.log('Translation model:', page.translation.model, 'source:', page.translation.source);

// All previous versions
const ocrHistory = await db.collection('page_revisions')
  .find({ page_id: 'XYZ', field: 'ocr' })
  .sort({ created_at: -1 }).toArray();

// Find the exact prompt content by hash
const prompt = await db.collection('prompts')
  .findOne({ content_hash: page.ocr.prompt_hash });

// Gemini API calls for this page (Supabase)
const { data: apiCalls } = await supabaseAdmin
  .from('gemini_usage')
  .select('*')
  .contains('page_ids', ['XYZ'])
  .order('timestamp', { ascending: false });
```

## 7. Tracing a Specific Book

```javascript
// Current AI-generated content
const book = await db.collection('books').findOne({ id: 'BOOK_ID' });

// Prior versions of summary/index/reading_summary/chapters
const bookHistory = await db.collection('book_revisions')
  .find({ book_id: 'BOOK_ID' })
  .sort({ created_at: -1 }).toArray();

// All AI calls scoped to this book (Supabase, primary store)
const { data: bookCalls } = await supabaseAdmin
  .from('gemini_usage')
  .select('*')
  .eq('book_id', 'BOOK_ID')
  .order('timestamp', { ascending: false });
```

## 8. Known Gaps (as of audit)

None for the AI text content trail. Remaining items are either out of scope or already covered by other systems:

- **Archive workers** (`scripts/workers/archive-*.mjs`) don't log to `gemini_usage` — correct, they don't run AI. They write `archive_metadata` per page (source_url, original_url, archived_at, bytes), which is the right provenance for image archival.
- **Manual UI edits** are not currently audit-logged with the editing user's identity in `audit_log` (only `edited_by` on the page). Out of scope of this audit; would require auth context propagation to PATCH routes.
- **30-day windows** in `/api/usage` and `/admin/processing-overview` cap at 50,000 rows from Supabase. At current volume (~hundreds of rows/hour) that's comfortable headroom; at 10× volume those would need pagination.

## 9. Audit Verification

To verify the discipline is being held end-to-end on a recent batch job:

```javascript
// Pick a page that was processed in the last hour
const page = await db.collection('pages').findOne({ 'ocr.updated_at': { $gte: new Date(Date.now() - 3600_000) } });

// 1. All four prompt fields populated?
console.assert(page.ocr.prompt_id, 'missing prompt_id');
console.assert(page.ocr.prompt_hash, 'missing prompt_hash');
console.assert(page.ocr.prompt_name, 'missing prompt_name');
console.assert(page.ocr.prompt_version, 'missing prompt_version');

// 2. A revision was saved (only fails on first-write pages, which is fine)
const revs = await db.collection('page_revisions').find({ page_id: page.id, field: 'ocr' }).toArray();

// 3. A gemini_usage row in Supabase
const { data: rows } = await supabaseAdmin.from('gemini_usage')
  .select('*').contains('page_ids', [page.id]).limit(5);
console.assert(rows && rows.length > 0, 'no gemini_usage row');
console.assert(rows[0].triggered_by, 'no triggered_by');
console.assert(rows[0].book_id, 'no book_id');
console.assert(rows[0].prompt_version, 'no prompt_version');
```
