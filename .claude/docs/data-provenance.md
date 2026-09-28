# Data Provenance — How Every Piece of AI Output Traces Back to Its Source

Every OCR transcription and translation written since the #4613 writers went live carries a record
of **what produced it**: the engine and model (and the served model version), the API path, the
writer (`call_site`), the prompt **by content** (hash of the exact text sent, beside the stored
template's hash), the generation settings **as sent** (with the model's defaults filled in and
named), the run (job id, code version, host, time), the input (the image fetched, or the OCR text
translated — by hash), and a content hash of the output. Summaries, indexes and image extraction
carry the older, thinner record (model, prompt version, source). This document explains the chain
and where it is thinner than that.

> **Status, 2026-09-28 (#4613).** Before this date no Gemini writer recorded temperature, thinking
> budget, max output tokens or media resolution; realtime OCR recorded neither prompt text, run nor
> input image; translations did not say which OCR text they were made from; `ocr.source: 'ai'`
> named no call site. Two production OCR paths ran the *same model and prompt* at temperature
> **1.0** (Lambda, unset → model default) and **0.1** (Hetzner), and the #4581 A/B measured only
> **74%** word agreement (Latin) / **43%** character agreement (Classical Chinese) between
> thinking-on and thinking-off reads of the same images — different populations that `model` +
> `prompt_version` could not tell apart.
>
> **Rows written BEFORE the writers went live are not backfilled and carry no `engine` block.**
> Their settings were not kept and are not guessed (rule 3 below). For a page with no `engine`,
> `source` is the only proxy for the call path (`ai` → Lambda or a realtime script, `batch_api`
> → batch, `pipeline_preview` → the orchestrator's preview pool), and any agreement or calibration
> figure over `page_revisions` that spans 2026 carries the unrecorded-config confound. The floor
> date per writer is the merge date of the PR that wired it (#5227 for OCR, #5229 for
> translation) plus Hetzner's next hourly pull; `scripts/audit/provenance-coverage.mjs --since`
> measures from any date you name.

> **Last full audit:** 2026-05-05. See `.claude/handoffs/2026-05-05-provenance-audit.md` for the audit report and the gaps closed.

## The Provenance Chain

```
Page Image (IIIF source)
  → Prompt (DB-stored; full reference fetched at submission)
    → Gemini Model
      → Page Text  ocr / translation: { data, source, model, prompt_version (label),
                                        content_hash, engine: { … see §1 … } }
        → Prior version snapshotted to page_revisions (with its content_hash + engine)
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
- `type` is one of: `ocr`, `translation`, `summary`, `image_extraction`, `english_modernization`
- **Exactly one row per `type` has `is_default: true`** — not per `(type, name)`. Every lookup in the codebase is `findOne({ type, is_default: true })` (17 call sites; most pass no sort at all), so a second default makes the choice depend on natural order rather than intent. Enforced by a unique partial index on `{ type: 1 }` where `is_default: true`, so a duplicate now fails with E11000 instead of silently forking provenance (#3614).
- **`version` is a NUMBER, never a string.** `'v1'` and `1` coexisting made every `sort({ version: -1 })` follow BSON type order, and printed defaults as `vundefined` and `vv1`. Pre-versioning rows from 2025-12 carry `version: 0`.
- Old versions are NEVER deleted — they're the audit trail

**Inline prompts** for index/summary generation are versioned via the `INDEX_PROMPT_VERSION` constant in `src/app/api/books/[id]/index/route.ts` (and the tenant variant) and the corresponding constant in `scripts/workers/enrich-worker.mjs`. Bump these when the prompt strings in those files change. The version is logged to `gemini_usage.prompt_version` and stored on the resulting `book.summary.prompt_version`.

### What a page carries — the `engine` block (#4613)

The legacy label fields are still written, because readers and filters use them:

```javascript
page.ocr.source            // who produced the words — see the enum in §2. 'ai' names NO call path.
page.ocr.model             // the model id requested
page.ocr.prompt_version    // a LABEL. realtime-ocr.mjs stamps the constant 'v5.2026-02' while sending
                           // whatever the DB default prompt is (v16 at the time of writing); the batch
                           // collectors stamp the DB version. Do not compare across writers.
page.ocr.prompt_id / prompt_hash / prompt_name   // batch writers only; RARE on realtime rows
```

The **record** is beside them, built only by `geminiEngine()` in `scripts/lib/write-provenance.mjs`
(twin: `src/lib/write-provenance.ts`) — never assembled by hand, so a writer cannot store a partial
one. The shape is the Yigdzin block (the Tibetan lane, `ocr.source: 'bdrc'`) generalised to Gemini:

```javascript
page.ocr.content_hash        // sha256(data), 16 hex — the same function as translation.content_hash
page.ocr.engine = {
  schema: 'gemini-engine/1',
  name: 'gemini',
  model: 'gemini-3.1-flash-lite',
  model_version: '3.1-flash-lite-05-2026',     // from the response when returned, else the models
  model_version_source: 'response' | 'GET /v1beta/models/<id> <date>' | 'not_recorded',
  api: 'batch' | 'realtime',
  call_site: 'scripts/batch/realtime-ocr.mjs', // the writer, repo-relative
  prompt: {
    id, name, version,                          // the stored prompt (prompts collection)
    hash: '0203c264…',                          // prompts.content_hash of the TEMPLATE (md5, 32 hex)
    sent_hash: '9f1c…',                         // sha256-16 of the EXACT text sent, after substitution
    sent_chars: 4123,                           //   and any prefix (spread instructions, document context)
  },
  generation: {
    temperature: 0.1, top_p: 0.95, top_k: 64, max_output_tokens: 16384,
    thinking_budget: 0,                          // or thinking_level, or thinking: 'model_default_dynamic'
    media_resolution: 'model_default',
    sent: { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },  // verbatim
    defaulted: ['top_p', 'top_k', 'media_resolution'],      // effective values that came from the model's
    defaults_source: 'GET /v1beta/models/gemini-3.1-flash-lite 2026-09-28',  //   defaults, not the request
  },
  run: { job_id | batch_job_id, code_version: 'd45e716', host: 'hetzner-1', at: Date,
         submitted_at?, collected_by?, collected_at? },      // the batch halves, when it was a batch
  input: { image_url, image_mime?, image_bytes?, resized_to_px? }          // OCR: the image the model saw
       | { source_field: 'ocr', source_text_hash, source_text_chars,      // translation: WHICH text
           source_updated_at?, context: { previous_translation, prev_ocr, next_ocr, page_break, block, seam } },
  recorded_by: 'scripts/lib/write-provenance.mjs',
}
page.translation.content_hash / page.translation.engine   // same shape; input is the source-text form
```

Three rules the builder enforces (read the header of `write-provenance.mjs` for the incidents):

1. **It records what was SENT, not what was meant.** `generation` is built from the
   `generationConfig` object the call sent. A setting the request did not carry resolves to the
   model's published default and is **named** in `defaulted` — `translate-worker.mjs` sets no
   temperature, and its pages say `temperature: 1, defaulted: ['temperature']`. An unknown model
   gets `null` and a `not_recorded` source, never a guess.
2. **The prompt is identified by the text sent.** `prompt.sent_hash` ≠ `prompt.hash` by design; a
   cross-book batch job sends a per-book document-context suffix, so the sent hash is per page.
3. **Absence is never a value.** What a writer cannot know is the explicit marker
   `{ status: 'not_recorded', reason }` (or the string `'not_recorded'` in a scalar slot): a batch job
   submitted before its submitter recorded settings, a restore of text whose origin is not on
   record. A checker can then tell "predates the writer" from "the writer forgot". The builder
   **throws** on a missing required input rather than emit a partial block.

Specialist lanes keep their own `engine` shape (`name: 'kraken' | 'Yigdzin' | …`, weights, revision,
licence, run) plus `content_hash` and, for Kraken, `engine.input.image_url`; the Internet Archive
lane records the Archive's engine in `ocr.ia` plus `ocr.content_hash` and `ocr.ia.ingest_run` (which
run of ours copied it). `src/lib/types/page.ts` has the types (`GeminiEngine`, `SpecialistEngine`).

### How the record gets there

**Realtime writers** build the block at the write from the values they just sent
(`geminiEngine(...)`) and spread `ocrProvenance(text, engine)` / `translationProvenance(text,
engine)` into the subdocument. **The translation doors** (`writePageTranslation` in
`scripts/lib/translate-core.mjs` and `src/lib/translate-write.ts`) refuse a model-output write that
carries neither a `call` record nor an `engine`.

**Batch writers** split the record: the submitter stores `batchJobProvenance(...)` on the
`batch_jobs` row as `provenance` (prompt by content, settings, run) and each page's
`page_sources[]` entry carries `source_url` + `prompt_sent_hash` (OCR) or `source_text_hash` +
`prompt_sent_hash` (translation); the collector completes it per page with
`engineFromBatchJob(job, { input, batch_job_id, collected_by })`. A job with no `provenance` (submitted
before #4613) collects into explicit markers.

For the inline index/summary prompts there is no DB row, so `prompt_id = 'hardcoded'` and
`prompt_version = INDEX_PROMPT_VERSION`; those book-level fields do not yet carry an `engine` block.

### How to create a new prompt version

1. Query max version: `db.prompts.find({ type: 'TYPE', name: 'NAME' }).sort({ version: -1 }).limit(1)`
2. Insert new doc with `version: max + 1` **as a number**, `is_default: true`, and a `content_hash`
3. Set `is_default: false` on the old default FIRST — the unique index rejects the insert otherwise
4. VERIFY: `db.prompts.countDocuments({ type: 'TYPE', is_default: true })` must be exactly 1
5. Save the prompt content to `prompts/` directory in git
6. Update the table below, or `doc-enum-drift.mjs` will fail the next run
7. **NEVER edit or delete old versions**

Prefer the API (`POST /api/prompts`, `PATCH /api/prompts/[id]`, `POST /api/prompts/[id]` to set default) — it does steps 2–4 for you, including the version arithmetic that a hand-rolled insert got wrong twice.

### Current defaults

Verified against production by `node scripts/audit/doc-enum-drift.mjs` — this table is checked, not remembered. Last confirmed 2026-09-02.

| Type | Name | Version | Key features |
|------|------|---------|-------------|
| `ocr` | Standard OCR | v15 | `<script>` tag, calibrated `<unclear>` (5-15%), manuscript rules |
| `translation` | Standard Translation | v12 | XML tags (`<note>`, `<term>`, `<gloss>`), no brackets, multilingual |
| `summary` | Standard Summary | v1 | Page-level 3–5 sentence summary, `<meta>` continuity marker |
| `image_extraction` | Image Extraction | v2 | Illustration detection + museum-style metadata |
| `english_modernization` | English Modernization | v1 | English books are modernized, not translated |

Non-default prompts are selected by book language, not by the flag above (`LANGUAGE_OCR_PROMPT_NAMES` / `LANGUAGE_TRANSLATION_PROMPT_NAMES` in `src/lib/prompts.ts`): Latin OCR (Neo-Latin) v4, German OCR (Fraktur) v5, Hebrew OCR v1, Arabic OCR v1, Latin Translation (Neo-Latin) v2, German Translation (Early Modern) v3, Hebrew Translation v1, Arabic Translation v1, Cuneiform OCR/Translation v1.

| Type | Name | Version | Key features |
|------|------|---------|-------------|
| Index/Summary | Inline | INDEX_PROMPT_VERSION = 'inline-2026-05' | Themes/quotes/people/places/concepts batch extraction |

That last one is not in `prompts` at all — it is a constant in the route/worker, so it has no `is_default` and the audit cannot cover it. Bump it by hand.

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
          "maintenance" | "mineru" | "ia_djvu" | "realtime_api_sequential" | "unknown" | null |
          // "ia_djvu" (2026-09-11): the Internet Archive's own per-leaf OCR (`<id>_djvu.xml`,
          // ABBYY/Tesseract — engine in ocr.model as `ia-ocr/<ocr_module_version>`), written by
          // scripts/import/ia-ocr-ingest.mjs ONLY to pages with no ocr.data, and only for books
          // whose 25-page Gemini sample agrees with the IA text at a word-sequence median ≥ 0.85
          // (ocr.agreement_ref). NOT model output: exclude from any Gemini quality measurement.
          "<sweep-label>",   // ad-hoc, e.g. "shift-repair-erara-2026-07",
                             // "reocr-download-failure-fix-2026-07"
  model: "gemini-3-flash-preview",
  prompt_version: "v10",
  job_id: "job_abc123",
  original_date: Date,  // when this content was originally WRITTEN  (a reading clock)
  created_at: Date,     // when it was SUPERSEDED (a snapshot clock — see below)
  content_hash: "…",    // #4613: the superseded text's own hash, when the writer stamped one
  engine: { … },        // #4613: the superseded text's engine block, when it had one — a snapshot
                        //   without these cannot be cited; named columns, kept on every revision
  meta: { … }           // every OTHER key of the field, when the writer opted in (keepMeta) because
                        //   it replaces the whole provenance block (#4722)
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

> Any code path that writes model output to `ocr.data` or `translation.data` MUST stamp `content_hash`
> and an `engine` block **through `scripts/lib/write-provenance.mjs` / `src/lib/write-provenance.ts`**
> (#4613). Never hand-assemble the block. `tests/unit/text-writers-use-provenance-builder.test.ts`
> fails a writer file that imports neither twin; `scripts/audit/provenance-coverage.mjs` fails a
> page in production that lacks a required field.

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

// Current content + what produced it (#4613). A page written before the writers went live has
// no `engine`; say so rather than reading the label fields as if they were the record.
const page = await db.collection('pages').findOne({ id: 'XYZ' });
const e = page.ocr.engine;
if (!e) console.log('OCR: pre-#4613 row — source', page.ocr.source, 'model', page.ocr.model, 'label', page.ocr.prompt_version);
else console.log('OCR:', e.call_site, e.model, e.model_version, e.api, 'prompt', e.prompt.version, e.prompt.sent_hash,
                 'generation', e.generation, 'run', e.run, 'input', e.input);
const t = page.translation?.engine;
if (t) console.log('Translation from OCR text', t.input.source_text_hash,
                   t.input.source_text_hash === page.ocr.content_hash ? '(the current OCR)' : '(NOT the current OCR — orphaned by a re-OCR)');

// All previous versions
const ocrHistory = await db.collection('page_revisions')
  .find({ page_id: 'XYZ', field: 'ocr' })
  .sort({ created_at: -1 }).toArray();

// The stored template by its hash; the text actually sent differs by substitution/prefix and is
// pinned by engine.prompt.sent_hash (re-derive it from the template + the writer's substitutions
// to verify — the sent text itself is not stored).
const prompt = await db.collection('prompts')
  .findOne({ content_hash: page.ocr.engine?.prompt.hash ?? page.ocr.prompt_hash });

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

## 8. Known Gaps (as of 2026-09-28)

- **Historical rows.** Everything written before the #4613 writers went live has no `engine`
  block and is not backfilled (rule 3: unknown settings are not guessed). Two content-hash
  formats also exist on old rows: the Vercel routes wrote a 64-hex SHA-256 until #5227/#5229;
  the convention is 16 hex (`contentHash` in write-provenance).
- **Dormant Vercel/Lambda paths** behind `src/lib/ai.ts` (`src/workers/*`, `/api/process`,
  `/api/batch-save`, `/api/books/[id]/stitch-translations`): 0 usage rows in the 30 days before
  2026-09-28; listed as PENDING in the writer-guard test until `ai.ts` returns the call record.
  The Lambda bundle (`scripts/aws-lambda/*`) also has no CI deploy — "merged" is not "in effect".
- **MinerU lane** (`scripts/workers/mineru-ocr-worker.mjs`, `source: 'mineru'`) writes no engine
  block; a specialist lane outside #4613's Gemini scope, wants the Kraken/Yigdzin shape.
- **`ocr.prompt_version` is a label, not a version** on realtime-OCR rows (`'v5.2026-02'`); the
  DB version is in `engine.prompt.version`. 24 files read the label, so it stays.
- **Book-level fields** (`summary`, `reading_summary`, `index`, `chapters`) carry model +
  prompt_version + source only — no settings, no run.
- **`/api/books/[id]/batch-ocr-async` collect stamps `ocr.updated_at` as an ISO string** (#5228);
  a string compares against a Date by BSON type, which misleads the staleness clock and any
  `$gte` window on that field.
- **Archive workers** (`scripts/workers/archive-*.mjs`) don't log to `gemini_usage` — correct,
  they don't run AI. They write `archive_metadata` per page, which is the right provenance for
  image archival.
- **Manual UI edits** are not audit-logged with the editing user's identity in `audit_log` (only
  `edited_by` on the page).

## 8a. Rows before the floor — what can be INFERRED, and what cannot

Nothing was recorded on pages written before 2026-09-28T16:21Z and nothing is backfilled. But
the settings were constants in code, git dates the constants, and two fields old rows do carry
(`source`, and whether `code_version` was stamped) narrow the writer. So for most of history the
settings can be stated as an **inference with a named basis** — usable for segmenting
`page_revisions` measurements, showable to a reader as "inferred", and impossible to mistake for an
observation. The table is `scripts/lib/provenance-history.json`; the reader is
`inferHistoricalGeneration(field, sub)` in `scripts/lib/write-provenance.mjs`, pinned by
`tests/unit/write-provenance.test.ts`. It returns `observed` (a real block), `inferred` (rule,
writer, settings, git commits, caveat) or `not_recorded` (writer ambiguous). **Never write its
result onto a page as `engine`.**

| rows | window (UTC, half-open) | inferred settings | basis |
|---|---|---|---|
| OCR `batch_api` / `pipeline_preview` | 2026-02-19 → floor | temperature 0.1, cap 16,384, thinking off | orchestrator 5e1f1d3d6; batch-ocr-async 8ca2d4fd3 (multi-page requests: cap 4,096 × pages) |
| OCR `ai`, **no** `code_version` (realtime scripts) | 2026-06-01 → 2026-09-15 | 0.1, 16,384, off | realtime-ocr created ea0d2adeb; Lambda began stamping `code_version` 39068ef96 |
| OCR `ai`, no `code_version` | 2026-09-15 → floor | 0.1, **cap unknown** (a flag), off | d3f373a55 |
| OCR `ai`, **with** `code_version` (Lambda) | 2026-06-01 → 2026-09-03 | **temperature 1, cap 65,536, thinking ON** (all model defaults) | ai.ts set no config until ee6804c89 (#4591) — the #4581 population |
| OCR `ai`, with `code_version` | 2026-09-03 → floor | 1, 65,536, off | ee6804c89 |
| OCR `ai` | before 2026-06-01 | **not recorded** — Lambda and the realtime script stamped identical fields | per-page: Mongo `gemini_usage` endpoint `scripts/realtime-ocr.mjs` |
| translation `batch_api` | 2026-02-19 → floor | 0.1, 16,384, off | eef05ed9c |
| translation `ai` | 2026-03-22 → 2026-08-09 | temperature **not inferred** (worker 1.0 vs realtime-translate script 0.2), cap 65,536, thinking ON | translate-worker created with no config e91d2252f |
| translation `ai` | 2026-08-09 → 2026-09-04 | temperature not inferred, cap per page, thinking ON | f1a5e0bcb |
| translation `ai` | 2026-09-04 → floor | temperature not inferred, cap per page, thinking off (retranslate-pages.mjs excepted) | a5134cc8b |

Two consequences worth stating plainly. First, every `page_revisions` pair that straddles
2026-09-03/04 compares a thinking-on read with a thinking-off one, and the #4581 A/B says those
differ by a quarter of the words on Latin pages: segment before quoting. Second, the Lambda OCR
population ran at temperature 1.0 for its whole life; the realtime and batch populations at 0.1.
Whether to ALSO write these inferences onto the rows (as an explicitly `inferred` block, never as
`engine`) is a decision, not a default — it is a 20-million-row write to a store the workers read.

## 9. Audit Verification

The standing check is `scripts/audit/provenance-coverage.mjs`: it samples the pages written in a
window **per writer** (`engine.call_site`, else `source`), runs `missingProvenance()` from
write-provenance on each, and exits 1 on any missing field, 2 when it could not measure. Markers
(`not_recorded`) are reported separately and fail only with `--strict`; a marker stream that does
not dry up within a week of a writer going live is a writer that is still not recording.

```bash
node --env-file=.env.production.local scripts/audit/provenance-coverage.mjs --days=2          # the table
node --env-file=.env.production.local scripts/audit/provenance-coverage.mjs --since=2026-10-01 --strict --json
```

The same checker runs in CI on synthetic pages — each required field removed from a complete block
must read as MISSING (`tests/unit/write-provenance.test.ts`, "proven red") — and
`tests/unit/text-writers-use-provenance-builder.test.ts` fails a writer file that bypasses the
builder. Run on Hetzner from the crontab once the writers are live (the live crontab is the source of
truth; add the line there, then `crontab -l > scripts/workers/crontab.production` and PR it).

To trace one recent page by hand, use §6; the assertions that used to live here (`prompt_id` /
`prompt_hash` present) are subsumed by `missingProvenance()`.
