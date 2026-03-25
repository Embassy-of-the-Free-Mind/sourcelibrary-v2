# Data Provenance — How Every Piece of AI Output Traces Back to Its Source

Every OCR transcription, translation, summary, and image extraction in Source Library can be traced back to the exact prompt, model, and job that produced it. This document explains the full chain.

## The Provenance Chain

```
Page Image (IIIF source)
  → OCR Prompt (versioned in git + DB)
    → Gemini Model (logged in gemini_usage)
      → OCR Text (stored on page, with prompt_id + prompt_hash)
        → Previous version saved to page_revisions
          → Translation Prompt (versioned in git + DB)
            → Translation Text (stored on page, with prompt_id + prompt_hash)
              → Previous version saved to page_revisions
```

## 1. Prompts — What Instructions Produced This Output?

### Where prompts live

**Git (source of truth for content):** `prompts/` directory
```
prompts/
├── ocr/                  ← 11 versions (v0→v10, current: v10)
├── translation/          ← 10 versions (v0→v8, current: v8)
├── summary/              ← 2 versions
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

### How pages reference prompts

Every page record stores:
```javascript
page.ocr.prompt_version    // String like "v10" or "v5.2026-03"
page.ocr.prompt_id         // ObjectId of the prompt document (added #333)
page.ocr.prompt_hash       // md5 of prompt content (added #333)
page.translation.prompt_version
page.translation.prompt_id
page.translation.prompt_hash
```

### How to create a new prompt version

1. Query max version: `db.prompts.find({ type: 'TYPE', name: 'NAME' }).sort({ version: -1 }).limit(1)`
2. Insert new doc with `version: max + 1`, `is_default: true`
3. Set `is_default: false` on the old version
4. VERIFY: `db.prompts.countDocuments({ type: 'TYPE', name: 'NAME', is_default: true })` must be exactly 1
5. Save the prompt content to `prompts/` directory in git
6. **NEVER edit or delete old versions**

### Current defaults (2026-03-25)

| Type | Name | Version | Key features |
|------|------|---------|-------------|
| OCR | Standard OCR | v10 | `<script>` tag, calibrated `<unclear>` (5-15%), manuscript rules |
| Translation | Standard Translation | v8 | XML tags (`<note>`, `<term>`, `<gloss>`), no brackets, multilingual, tone fix |
| Translation | Latin | v2 | Neo-Latin specific |
| Translation | German | v2 | Early Modern German specific |
| Translation | Cuneiform | v1 | Sumerian/Akkadian specific |

## 2. Revisions — What Was Here Before?

### How it works

`page_revisions` collection stores every previous version of OCR and translation content. Before any overwrite, `createRevision(pageId, field, jobId?)` saves the current content.

**File:** `src/lib/page-revisions.ts`

### What's stored per revision

```javascript
{
  id: "nanoid",
  page_id: "...",
  book_id: "...",
  field: "ocr" | "translation",
  data: "the full previous text content",
  source: "ai" | "manual" | "batch_api" | "contributor",
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
- Batch OCR (`batch-ocr-async`)
- Batch translation (`batch-translate-async`)
- Translation stitching
- Community contributions (`contribute/process`)
- Manual edits (`batch-save`)

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

## 3. Gemini Usage — What Model and When?

`gemini_usage` collection logs every Gemini API call:

```javascript
{
  action: "ocr" | "translation" | "summary" | "image_extraction" | ...,
  model: "gemini-3-flash-preview",
  book_id: "...",
  page_id: "...",
  job_id: "...",
  input_tokens: 1500,
  output_tokens: 800,
  cost_usd: 0.00047,
  status: "success" | "error",
  duration_ms: 2340,
  timestamp: Date
}
```

## 4. The Rule

**Any script that overwrites `ocr.data` or `translation.data` MUST call `createRevision(pageId, field, jobId?)` first.** This is a critical safety rule. Source: MEMORY.md.

## 5. Tracing a Specific Page

To reconstruct the full history of page `XYZ`:

```javascript
const db = await getDb();

// Current content + which prompt produced it
const page = await db.collection('pages').findOne({ id: 'XYZ' });
console.log('OCR prompt:', page.ocr.prompt_version, page.ocr.prompt_hash);
console.log('Translation prompt:', page.translation.prompt_version, page.translation.prompt_hash);
console.log('OCR model:', page.ocr.model);
console.log('Translation model:', page.translation.model);

// All previous versions
const ocrHistory = await db.collection('page_revisions')
  .find({ page_id: 'XYZ', field: 'ocr' })
  .sort({ created_at: -1 }).toArray();

const transHistory = await db.collection('page_revisions')
  .find({ page_id: 'XYZ', field: 'translation' })
  .sort({ created_at: -1 }).toArray();

// Gemini API calls for this page
const apiCalls = await db.collection('gemini_usage')
  .find({ page_id: 'XYZ' })
  .sort({ timestamp: -1 }).toArray();

// Find the exact prompt content by hash
const prompt = await db.collection('prompts')
  .findOne({ content_hash: page.ocr.prompt_hash });
```
