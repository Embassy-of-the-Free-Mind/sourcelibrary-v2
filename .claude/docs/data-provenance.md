# Data Provenance — How Every Piece of AI Output Traces Back to Its Source

Every OCR transcription, translation, summary, index, chapter extraction, and image extraction in Source Library can be traced back to the exact prompt, model, trigger, and job that produced it. This document explains the full chain.

> **Last full audit:** 2026-05-05. See `.claude/handoffs/2026-05-05-provenance-audit.md` for the audit report and the gaps closed.

> **Scope — there are TWO provenance layers.** This document covers the **AI-output** layer: what a model produced, from which prompt, when. The sibling layer is **bibliographic provenance** (`books.field_provenance`) — where a book's *title, author, year, publisher and holding library* came from. That layer backs every citation the library makes and is rendered to readers; it is documented in §10 below. The two are independent: a page can have flawless prompt provenance while the book's year is an unattributed guess.

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
page.ocr.source            // 'ai' | 'batch_api' | 'manual' | 'contributor' | 'skip'
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
  source: "ai" | "manual" | "batch_api" | "contributor" | "skip",
  model: "gemini-3-flash-preview",
  prompt_version: "v10",
  job_id: "job_abc123",
  original_date: Date,  // when this content was originally written
  created_at: Date      // when it was superseded
}
```

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

## 10. Bibliographic Provenance (`books.field_provenance`)

The other half. Where the sections above answer *"what did the model produce, from which prompt"*, this answers *"where did this bibliographic claim come from"* — title, author, year, publisher, place, holding library. It is the provenance behind every citation, and `BibliographicInfo.tsx` renders it to readers.

It is a much younger system than the AI chain and was undocumented until 2026-07-30 (#3445, follow-up #3471).

### The write rule

> Any code path that writes a bibliographic field on `books` MUST stamp it via `provenanceUpdate()` — in the **same** update as the value.

`src/lib/field-provenance.ts` (scripts twin: `scripts/lib/field-provenance.mjs`, regenerate with `scripts/lib/regen-field-provenance-twin.py`):

```javascript
const prov = provenanceUpdate('contributing_library', {
  source: 'ia_metadata_harvest',                 // required
  script: 'scripts/maintenance/harvest-holding-libraries.mjs',
  method: 'archive.org/metadata contributor',
  previous_value: book.image_source?.contributing_library ?? null,  // required; null is a valid answer, absence is not
});
await books.updateOne({ _id }, {
  $set: { 'image_source.contributing_library': next, updated_at: new Date(), ...prov.$set },
  $push: prov.$push,   // append-only field_provenance_history
});
```

Never write the value and the stamp in two operations — the second can fail, and a stamp describing a value it did not produce is worse than no stamp. Note `updated_at`: without it the write never reaches Supabase and no reader ever sees it (see `.claude/docs/supabase.md`, Known Sync Gap A).

### Why the discipline matters here specifically

**A wrong stamp is worse than a missing one** — it reads as authority and stops anyone looking. Measured 2026-07-30 across 19,420 visible books: 1,124 asserted `method: 'ia_metadata'` while storing "Internet Archive" as the holding library, a value IA's contributor field never returns for a library-scanned book. The records looked sourced, which is plausibly why that placeholder problem survived four months undetected.

When a stamp's true provenance is **unrecoverable**, mark it `disputed` with a reason rather than inventing a plausible source. The audit counts disputed separately from still-asserting claims, so honest remediation moves the number instead of looking permanently broken.

### Auditing

```bash
set -a; source .env.production.local; set +a
node scripts/audit/field-provenance.mjs           # coverage / shape / contradicted / history
node scripts/audit/field-provenance.mjs --strict  # non-zero on unmarked contradictions
```

Baseline at first audit (2026-07-30): 92.5% of visible books carried some stamp, but per field most values were unattributed — `published` 78.1% unprovenanced, `title`/`author` 74.1%, `contributing_library` 52.7%. Of 134,488 stamps written by **81 independent writers**, there were 164 distinct key-shapes; only 23.7% named their script and 16.1% recorded `previous_value`. Migrating the remaining writers to the helper is tracked in #3471.
