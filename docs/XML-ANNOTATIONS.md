# XML Annotation System

Source Library uses XML-style tags to structure OCR transcriptions and translations. These tags serve as a lightweight scholarly markup layer — extracting metadata, annotating the text, and feeding downstream systems (search, gallery, indexing, citation).

## Table of Contents

1. [Tag Reference](#tag-reference)
2. [Reader Experience](#reader-experience)
3. [Tag Lifecycle](#tag-lifecycle)
4. [System Integration Map](#system-integration-map)
5. [Known Issues](#known-issues)
6. [Data Model](#data-model)
7. [Backward Compatibility](#backward-compatibility)
8. [Prompt Instructions](#prompt-instructions)

---

## Tag Reference

### Metadata Tags (Hidden from readers)

Extracted from text and displayed in the collapsible Page Info panel. Never shown inline.

| Tag | Purpose | Example | Rendered As |
|-----|---------|---------|-------------|
| `<lang>` | Source language of the page | `<lang>Latin</lang>` | Badge in sidebar: "Latin" |
| `<page-num>` | Printed page/folio number | `<page-num>42</page-num>` | Badge: "p. 42" |
| `<folio>` | Folio reference | `<folio>12r</folio>` | Badge: "f. 12r" |
| `<sig>` | Printer's signature mark | `<sig>A2</sig>` | Badge: "sig. A2" |
| `<header>` | Running header | `<header>Chapter III</header>` | **Stripped completely** |
| `<meta>` | Hidden metadata/notes | `<meta>Fraktur script, good quality</meta>` | Listed in "Notes" section |
| `<warning>` | Quality issues | `<warning>damaged page corner</warning>` | **Red banner** at top |
| `<abbrev>` | Abbreviation expansion | `<abbrev>ꝙ → quod</abbrev>` | Monospace in sidebar |
| `<vocab>` | Key terms for indexing (OCR) | `<vocab>azoth, prima materia</vocab>` | Purple tags in sidebar |
| `<summary>` | Page summary (translation) | `<summary>Discusses the Great Work</summary>` | **Amber banner** at top |
| `<keywords>` | English index terms (translation) | `<keywords>alchemy, transmutation</keywords>` | Indigo tags in sidebar |

### Inline Annotation Tags (Visible to readers)

Rendered as colored badges within the text flow. Togglable via the Notes button (except `<term>` which always shows).

| Tag | Purpose | Color | Hover Title | Always Visible? |
|-----|---------|-------|-------------|-----------------|
| `<note>` | Editorial/interpretive note | Amber `bg-amber-100` | "Editorial note" | No (toggle) |
| `<margin>` | Marginal note in original | Teal `bg-teal-100` + left border | "Marginal note in original" | No (toggle) |
| `<gloss>` | Interlinear annotation | Purple `bg-purple-100` | "Gloss/annotation in original" | No (toggle) |
| `<insert>` | Boxed text, later addition | Green `bg-green-100` | "Later insertion" | No (toggle) |
| `<unclear>` | Illegible reading | Stone `bg-stone-200` italic + "?" | "Unclear in original" | No (toggle) |
| `<term>` | Technical vocabulary | Indigo `bg-indigo-100` italic | "Technical term" | **Yes, always** |
| `<image-desc>` | Image description | N/A | N/A | **Never** (edit mode only) |

### Image Detection Block

Separate from the tag system — a JSON block appended to OCR output for pages with illustrations:

```xml
<detected-images>
[{"description": "Alchemical emblem showing a phoenix",
  "type": "emblem",
  "bbox": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.5},
  "gallery_quality": 0.85,
  "museum_rationale": "Striking allegorical emblem"}]
</detected-images>
```

This block is used as a **marker** by the image extraction system to identify pages worth processing. The actual image extraction uses independent Gemini Vision analysis — the JSON coordinates from OCR are not directly consumed.

---

## Reader Experience

### Page Layout

- **Left**: Book scan image (zoomable, pannable, fullscreen viewer)
- **Right**: Text panel with tabs (OCR | Translation | Modernized)
- **Sidebar**: Table of contents, navigation

### Reader Controls

| Control | What It Does |
|---------|--------------|
| **Notes toggle** (MessageSquare icon) | Show/hide inline annotations (note, margin, gloss, insert, unclear). Terms always visible. |
| **Info button** (FileText icon) | Open PageMetadataPanel modal with all extracted metadata |
| **View tabs** | Switch between OCR, Translation, Modernized views |
| **Arrow keys / Swipe** | Navigate between pages |
| **Image click** | Fullscreen viewer with zoom/pan |

### What the Reader Sees

**With Notes ON** (default): Flowing text with colored annotation badges inline. Marginal notes in teal sit before the paragraph they annotate. Terms in indigo identify key vocabulary. Unclear readings in gray show uncertain transcriptions.

**With Notes OFF**: Clean reading text with only terms highlighted. All editorial apparatus hidden.

**Metadata Panel** (Info button): Collapsible sections showing language, page number, folio, quality warnings, summary, vocabulary, keywords. Red warning banner if quality issues. Amber summary banner if page summary exists.

### Tag Visibility by Context

| Context | Inline Annotations | Terms | Metadata Panel | Tags in Text |
|---------|--------------------|-------|----------------|-------------|
| **Reader (notes on)** | Colored badges | Always | Collapsible | Stripped |
| **Reader (notes off)** | Hidden | Always | Collapsible | Stripped |
| **Quote/Share** | Stripped | Stripped | N/A | Stripped |
| **Gallery** | N/A | N/A | Image metadata | N/A |
| **API response** | Raw in text | Raw in text | N/A | **Included raw** |

---

## Tag Lifecycle

### OCR → Storage

```
Image → Gemini Vision → OCR text with all tags → page.ocr.data (raw string)
```

Tags produced by OCR: `<lang>`, `<page-num>`, `<folio>`, `<sig>`, `<header>`, `<meta>`, `<warning>`, `<vocab>`, `<margin>`, `<gloss>`, `<insert>`, `<unclear>`, `<note>`, `<term>`, `<image-desc>`, `<detected-images>`

Stored as raw text in `page.ocr.data`. No structured extraction at write time.

### OCR → Translation

```
page.ocr.data (with tags) → Translation prompt → page.translation.data (with tags)
```

**Worker (realtime) translation**: Prompt explicitly instructs preservation of inline tags (`<note>`, `<margin>`, `<gloss>`, `<insert>`, `<unclear>`, `<term>`) and adds `<summary>` + `<keywords>`.

**Batch API translation**: Uses a simpler prompt that does NOT instruct tag preservation. **Tags may be lost in batch translations.** (See [Known Issues](#known-issues).)

### Translation → Summary

```
page.translation.data (with tags) → Summary prompt → plain text summary
```

Summary generation receives tags in input but does not produce or preserve them.

### OCR → Image Extraction

```
page.ocr.data → check for <detected-images> marker → independent Gemini Vision extraction → page.detected_images[]
```

The `<detected-images>` block in OCR is used only as a signal that the page has images worth extracting. The actual coordinates and metadata come from a separate vision model pass.

### Tags → Book Index

```
page.ocr.data → extractTerms('vocab') → book.index.vocabulary[]
page.translation.data → extractTerms('keywords') → book.index.keywords[]
page.translation.data → extractSummary() → book.index.pageSummaries[]
```

Index generation extracts structured data from tags, then **strips all tags** from text before sending to Gemini for book-level summarization.

### Tags → Reader

```
page.ocr.data or page.translation.data → NotesRenderer
  → extractMetadata() → sidebar panel (lang, page-num, warning, vocab, etc.)
  → preprocessBracketTags() → convert [[bracket]] to <xml> syntax
  → ReactMarkdown + rehype-raw + custom components → styled inline badges
```

All extraction and rendering happens at **display time** in the browser. No structured metadata is pre-computed on the server.

### Tags → Quote/Citation

```
page.translation.data → strip all tags → clean text for sharing
+ structured citation metadata (author, year, page, URL)
```

---

## System Integration Map

```
                    ┌─────────────┐
                    │   OCR       │
                    │  (Gemini)   │
                    └──────┬──────┘
                           │
                    page.ocr.data
                    (raw text + all tags)
                           │
          ┌────────────────┼────────────────┬──────────────────┐
          │                │                │                  │
          ▼                ▼                ▼                  ▼
   ┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐
   │Translation│    │  Image   │    │    Index     │    │  Reader  │
   │ (Worker)  │    │Extraction│    │ Generation   │    │(browser) │
   └─────┬────┘    └─────┬────┘    └──────┬───────┘    └─────┬────┘
         │               │               │                   │
  Preserves:       Uses marker:    Extracts:           Extracts:
  note,margin,     <detected-     <vocab> → vocab[]   All metadata
  gloss,insert,     images>       <keywords> →         + inline
  unclear,term     (JSON not       keywords[]          annotations
  meta              parsed)       <summary> →          for display
                        │          summaries[]
  Adds:                 │               │
  <summary>        page.detected_  book.index.*
  <keywords>        images[]
         │
  page.translation.data
  (raw text + tags)
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 ┌──────┐ ┌──────┐
 │Quote/│ │Reader│
 │Share │ │      │
 └──────┘ └──────┘
 (strips   (renders
  tags)     tags)
```

### What Each System Consumes

| System | Input | Tags Used | Tags Lost |
|--------|-------|-----------|-----------|
| **Translation (worker)** | OCR with all tags | Preserves inline, adds summary/keywords | `<detected-images>`, `<header>` |
| **Translation (batch)** | OCR with all tags | **None instructed** | **Potentially all** |
| **Image Extraction** | OCR text (marker only) | `<detected-images>` as signal | All other tags |
| **Index Generation** | OCR + translation | `<vocab>`, `<keywords>`, `<summary>` | All others (stripped) |
| **Reader/NotesRenderer** | OCR or translation | All tags rendered | None (all displayed) |
| **Quote API** | Translation | None (all stripped) | All |
| **Gallery** | `page.detected_images[]` | N/A (structured data) | N/A |
| **Search** | `translation.data` raw | Tags treated as noise | N/A |
| **Validation** | Any text | All tags checked for well-formedness | None |

---

## Known Issues

### 1. Batch Translation Drops Tags (CRITICAL)

**File**: `src/app/api/books/[id]/batch-translate-async/route.ts`

The batch translation prompt is simpler than the worker prompt and does NOT instruct tag preservation. Books translated via Batch API may lack `<note>`, `<margin>`, `<term>`, `<summary>`, `<keywords>` tags that worker-translated books have.

**Impact**: 116k pages translated via batch_api may be missing annotation tags.

**Fix**: Align batch translation prompt with `DEFAULT_PROMPTS.translation`.

### 2. Language Detection Not Stored Structurally (GAP)

OCR detects language via `<lang>` tag, but this is only extracted at render time in the browser. Never written to:
- `page.ocr.language_detected` (doesn't exist)
- `book.original_language` (never updated from OCR)
- `book.detected_languages` (doesn't exist)

**Impact**: 2,452 books with no `original_language` — OCR can detect it but the data is trapped in raw text.

**Fix**: Extract `<lang>` after OCR and store as structured data. Aggregate to book level.

### 3. No Book-Level Quality Aggregation (GAP)

`<warning>` tags flag quality issues per page, but there's no:
- `book.pages_with_warnings` count
- `book.ocr_quality_score` percentage
- Way to query "which books have quality problems?"

### 4. `<detected-images>` JSON Never Parsed (MINOR)

The JSON array inside `<detected-images>` is stored in OCR text but never parsed programmatically. The image extraction system does independent analysis. The OCR-embedded coordinates could potentially be used for faster image extraction or validation.

### 5. ModernizedReader Doesn't Strip XML Tags (BUG)

`ModernizedReader.tsx` strips legacy `[[bracket]]` syntax but not `<xml>` tags. XML tags may appear as literal text in modernized view.

### 6. Search Treats Tags as Noise (GAP)

Full-text search on `translation.data` matches tag content indiscriminately. No way to search "pages where keyword=alchemy" vs "pages containing the word alchemy".

### 7. Terms Not Cross-Referenced (FUTURE)

`<term>` tags highlight vocabulary beautifully in the reader but don't link to:
- Other pages using the same term
- A glossary or definition
- Cross-book term index

---

## Data Model

### Current: Raw Text Storage

Tags live inside raw text strings:

```typescript
// Page schema (src/lib/types/page.ts)
interface OcrData {
  data: string;         // Raw OCR text WITH all XML tags
  language: string;     // Set from job config, NOT from <lang> detection
  model: string;
  source: string;
  prompt_version: string;
  updated_at: Date;
}

interface TranslationData {
  data: string;         // Raw translation text WITH all XML tags
  language: string;
  model: string;
  source: string;
  prompt_version: string;
  updated_at: Date;
}
```

### Proposed: Structured Extraction Cache

Extract tag data at write time (after OCR/translation completes) for queryability:

```typescript
// Proposed addition to OcrData
interface OcrData {
  // ... existing fields ...
  extracted?: {
    language_detected?: string;      // From <lang> tag
    page_number?: string;            // From <page-num>
    folio?: string;                  // From <folio>
    signature?: string;              // From <sig>
    warnings?: string[];             // From <warning> tags
    vocabulary?: string[];           // From <vocab>
    has_images?: boolean;            // From <detected-images> presence
  };
}

// Proposed addition to TranslationData
interface TranslationData {
  // ... existing fields ...
  extracted?: {
    summary?: string;               // From <summary>
    keywords?: string[];            // From <keywords>
  };
}
```

This enables MongoDB queries like:
- `{ 'ocr.extracted.language_detected': 'Greek' }` — find all Greek pages
- `{ 'ocr.extracted.warnings': { $exists: true } }` — find pages with quality issues
- `{ 'translation.extracted.keywords': 'alchemy' }` — search by keyword

---

## Backward Compatibility

### Dual Syntax Support

The system supports both XML and legacy bracket syntax. All extraction and rendering functions handle both:

| XML Syntax | Legacy Bracket Syntax |
|-----------|----------------------|
| `<note>text</note>` | `[[note: text]]` |
| `<margin>text</margin>` | `[[margin: text]]` |
| `<lang>Latin</lang>` | `[[language: Latin]]` |
| `<page-num>42</page-num>` | `[[page number: 42]]` |
| `<folio>12r</folio>` | `[[folio: 12r]]` |
| `<sig>A2</sig>` | `[[signature: A2]]` |
| `<vocab>term1, term2</vocab>` | `[[vocabulary: term1, term2]]` |
| `<warning>text</warning>` | `[[warning: text]]` |
| `<summary>text</summary>` | `[[summary: text]]` |
| `<keywords>k1, k2</keywords>` | `[[keywords: k1, k2]]` |

### Conversion

`preprocessBracketTags()` in NotesRenderer converts bracket→XML at render time:
```typescript
result = result.replace(/\[\[(notes?):\s*([\s\S]*?)\]\]/gi, '<note>$2</note>');
result = result.replace(/\[\[margin:\s*([\s\S]*?)\]\]/gi, '<margin>$1</margin>');
// ... etc
```

### Three OCR Prompt Generations

Historical pages have tags from different prompt eras:

| Generation | Period | Marker | Tag Style | Pages |
|-----------|--------|--------|-----------|-------|
| Gen 1/2 | Dec 17-21 | `[[language:]]` brackets | `[[bracket]]` notation | ~3,758 |
| Gen 3 | Dec 27+ | `<lang>` XML tags | `<xml>` tags | ~91,159 |
| No markers | Various | Neither | Unknown | ~37,625 |

All are handled by the dual-syntax reader.

---

## Prompt Instructions

### OCR Prompt (Current — v3.2026-02)

The OCR prompt instructs Gemini to produce:
- Markdown-formatted transcription
- Metadata tags: `<lang>`, `<page-num>`, `<header>`, `<sig>`, `<meta>`, `<warning>`, `<vocab>`
- Inline annotations: `<margin>`, `<gloss>`, `<insert>`, `<unclear>`, `<note>`, `<term>`
- Image detection: `<detected-images>` JSON block (if illustrations present)
- Language auto-detection via `{language_instruction}` template (v3+)

### Translation Prompt

The translation prompt instructs Gemini to:
- **Preserve** all inline annotations from OCR
- **Add** `<summary>` (1-2 sentence page summary)
- **Add** `<keywords>` (English terms for indexing)
- Translate content within tags (e.g., translate margin notes to English)
- Use `<meta>` for translator continuity notes

### Validation

`validateTranslation.ts` checks tag well-formedness:

```typescript
const VALID_XML_TAGS = new Set([
  'note', 'margin', 'gloss', 'insert', 'unclear', 'term', 'image-desc',
  'lang', 'page-num', 'folio', 'sig', 'header', 'meta', 'warning',
  'abbrev', 'vocab', 'summary', 'keywords'
]);
```

Catches: unclosed tags, unknown tag types, empty tags, unbalanced nesting.

---

## Key Files

| File | Role |
|------|------|
| `src/lib/types/prompts/defaults.ts` | Prompt text with tag instructions |
| `src/components/reader/NotesRenderer.tsx` | Tag extraction + rendering |
| `src/components/reader/PageMetadataPanel.tsx` | Metadata sidebar display |
| `src/lib/validateTranslation.ts` | Tag validation |
| `src/lib/ai.ts` | OCR/translation with `{language_instruction}` |
| `src/lib/prompts.ts` | Prompt lookup with language substitution |
| `src/app/api/books/[id]/index/route.ts` | Tag extraction for indexing |
| `src/workers/ocr-processor-logic.ts` | OCR worker (stores raw text) |
| `src/workers/translation-processor-logic.ts` | Translation worker (preserves tags) |
