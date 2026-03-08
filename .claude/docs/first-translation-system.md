# First Translation Identification System

## Overview

Source Library identifies books that represent the **first known English translation** of a historical text. This is a key scholarly claim — many pre-1800 Latin, German, Arabic, Hebrew, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy have never been translated into English.

The system uses a **multi-stage AI verification pipeline** that progressively increases confidence: lightweight OCR-based classification → LLM deep knowledge check → (future) web search grounding.

**Blog post:** https://sourcelibrary.org/blog/first-translation-methodology

---

## Classification Statuses

The `ai_metadata.first_translation.status` field uses one of six values:

| Status | Meaning | `is_first_translation` |
|--------|---------|----------------------|
| `confirmed_first` | No English translation found, high confidence | `true` |
| `likely_first` | Probably no English translation, but uncertain | `true` |
| `uncertain` | Insufficient evidence to determine | `false` |
| `has_partial` | Partial/excerpt translations exist | `false` |
| `has_translation` | Complete English translation exists | `false` |
| `not_applicable` | Book is already in English | `false` |

The top-level boolean `book.is_first_translation` is derived: `true` for `confirmed_first` or `likely_first`, `false` otherwise.

---

## Data Storage

### Book-Level Fields

| Field | Type | Set By | Description |
|-------|------|--------|-------------|
| `ai_metadata.first_translation` | Object | Stage 1 (enrichment) | `{ status, reasoning, known_translations[], confidence }` |
| `is_first_translation` | boolean | Stage 1 (enrichment) | Derived from status — `true` for confirmed/likely first |
| `translation_verification` | Object | Stage 2 (verification) | Deep verification with `disposition`, `translations[]`, `confidence` |
| `field_provenance.is_first_translation` | Object | Stage 1 | AI source info (model, date, confidence, pages_checked) |

### Stage 1 Object (`ai_metadata.first_translation`)

```typescript
{
  status: 'confirmed_first' | 'likely_first' | 'uncertain' | 'has_partial' | 'has_translation' | 'not_applicable';
  reasoning: string;        // 1-2 sentences
  known_translations: string[];  // Any known English translations
  confidence: 'high' | 'medium' | 'low';
}
```

### Stage 2 Object (`translation_verification`)

```typescript
interface TranslationVerification {
  source: 'catalog_search';
  searched_at: Date;
  has_english_translation: boolean;
  translations?: TranslationEvidence[];
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  search_evidence?: {
    apis_queried: string[];
    total_results: number;
    evidence_strength: 'none' | 'weak' | 'moderate' | 'strong';
  };
  disposition?: 'confirmed_first' | 'translation_found' | 'needs_review';
  disposition_reasoning?: string;
  disposition_at?: Date;
  validated_translations?: TranslationEvidence[];
  llm_knowledge_translations?: TranslationEvidence[];
}
```

Type definitions: `src/lib/types/book.ts` (lines 215-247).

---

## Stage 1: AI Metadata Enrichment

**When:** Pipeline Phase 3.5 (`metadata_enriched` state) or backfill script.

**How:** Reads first 25 OCR pages of a book + metadata, asks Gemini to classify `first_translation` alongside other metadata (language, categories, description, display_title).

**Implementation:** `enrichBookMetadata()` in `src/lib/metadata-enrichment.ts`
- Lines 104-109: Prompt includes `first_translation` JSON schema
- Lines 346-350: Derives `is_first_translation` boolean from status
- Lines 385: Stores field provenance

**Cost:** ~$0.002/book (text-only, ~25 OCR pages as context).

**What it writes:**
- `ai_metadata.first_translation` — the classification object
- `is_first_translation` — derived boolean
- `field_provenance.is_first_translation` — AI source tracking

**Backfill script:** `_tmp-backfill-ft-stage1.mjs` — standalone script for books enriched before the `first_translation` field was added to the prompt (Feb 17, 2026). Queries `{ 'ai_metadata.enriched_at': { $exists: true }, 'ai_metadata.first_translation': { $exists: false } }`.

---

## Stage 2: LLM Deep Knowledge Check

**When:** After Stage 1, as a separate verification pass.

**How:** Text-only Gemini call (no OCR/images) asking: "Has this work EVER been translated into English?" Includes Stage 1 assessment as a hint. Checks academic publishers, specialist presses, older translations, PhD dissertations, journal translations.

**Implementation:** `_tmp-verify-ft-stage2.mjs` (backfill) and `scripts/enrichment/verify-first-translations.mjs` (original Latin-only version).

**Cost:** ~$0.0003/book (text-only, no page content).

**Disposition logic:**
- `found && conf !== 'low'` → `translation_found` (sets `is_first_translation = false`)
- `!found && (conf === 'high' || 'medium')` → `confirmed_first` (sets `is_first_translation = true`)
- Otherwise → `needs_review`

**What it writes:**
- `translation_verification` — full verification object with disposition, translations found, reasoning
- `is_first_translation` — updated if disposition changes the assessment

**API key rotation:** Stage 2 scripts rotate across multiple Gemini API keys for throughput.

---

## Stage 3: Web Search Grounding (Future)

Planned but not yet implemented in the backfill pipeline. Would use Google Search Grounding to verify claims with real web results. Estimated ~$0.014/book.

---

## Pipeline Integration

Stage 1 runs automatically as part of the post-import pipeline cron (Phase 3.5, `metadata_enriched` state). The `enrichBookMetadata()` function handles it — no separate step needed.

Stage 2 runs automatically as Phase 3.7 of the pipeline cron. After metadata enrichment, non-English books go through `verifyFirstTranslation()` before proceeding to translation. English books and already-verified books skip straight through. Non-blocking: failures skip ahead after 3 retries.

**Pipeline flow:**
```
... → ocr_complete → metadata_enriched (Stage 1 runs here) → ft_verifying → ft_verified (Stage 2 runs here) → translate_submitted → ...
```

---

## Where First Translation Data Is Used

### UI Components

| Component | File | Usage |
|-----------|------|-------|
| Book detail page | `src/app/book/[id]/page.tsx` | Shows "First English Translation" badge |
| Book cards | `src/components/book/BookCard.tsx` | Badge on library cards |
| Collection cards | `src/components/CollectionBookCard.tsx` | Badge on collection cards |
| Bibliographic info | `src/components/book/BibliographicInfo.tsx` | Displays `translation_verification` details |
| Blog: first translations | `src/app/blog/first-translations/page.tsx` | List of all first translations |
| Blog: methodology | `src/app/blog/first-translation-methodology/page.tsx` | Public methodology documentation |
| Data exports | `src/app/data/page.tsx`, `src/app/fulldata/page.tsx` | Included in data dumps |

### Search

`GET /api/search` supports `first_translation=true` filter parameter → queries `is_first_translation: true`. Defined in `src/app/api/search/route.ts`.

### KDP Scoring

`src/lib/kdp-scoring.ts` — first translation gives a +5 bonus to the KDP publishing score (out of 100). The `kdp_score_breakdown.first_translation_bonus` field stores this.

### Sitemap

`src/app/sitemap.ts` includes `is_first_translation` in its book projections.

---

## Operational Scripts

| Script | Purpose |
|--------|---------|
| `_tmp-backfill-ft-stage1.mjs` | Backfill Stage 1 for books missing `ai_metadata.first_translation` |
| `_tmp-verify-ft-stage2.mjs` | Backfill Stage 2 verification for all non-English books |
| `scripts/enrichment/verify-first-translations.mjs` | Original Stage 2 (Latin-only) |
| `scripts/enrichment/search-translation-evidence.mjs` | Catalog search for translation evidence |
| `scripts/enrichment/validate-translation-evidence.mjs` | Evidence validation |
| `scripts/maintenance/backfill-first-translation.mjs` | Bulk enrichment runner |

---

## Data Quality Fix (March 7, 2026)

Three pre-March-2026 scripts wrote `translation_verification` records with buggy disposition logic, non-standard field names, and no `stage` marker. These were cleared and re-verified.

### Old Scripts and Their Bugs

**1. `scripts/enrichment/search-translation-evidence.mjs`** (872 records, `source: 'catalog_search'`, no stage)
- Searched Open Library, Google Books, and Internet Archive catalogs
- When all 3 APIs returned 0 results, wrote `has_english_translation: false` — a negative claim based solely on catalog absence
- Disposition was set later by `validate-translation-evidence.mjs`

**2. `scripts/enrichment/validate-translation-evidence.mjs`** (set dispositions on the 872 above)
- **Path B bug:** When catalog AND LLM both found nothing, set `disposition: 'confirmed_first'` without checking Stage 1's assessment. Books where Stage 1 said `has_translation` could still get `confirmed_first`.
- This caused 123 Type B disagreements (Stage 1 = HAS, Stage 2 = FIRST)

**3. `scripts/enrichment/verify-first-translations.mjs`** (458 records, `source: 'gemini_knowledge_lookup'`, no stage)
- Latin-only LLM check using `gemini-2.5-flash`
- Stored raw LLM results without computing disposition
- Some records had no disposition at all

**4. Unknown old script** (826 records, `source: null`)
- Used non-standard disposition values: `first_translation` (744), `translation_exists` (41), `first_full_translation` (31), `translation_found` (16)

### Key Insight

Stage 2 can verify that a translation **exists** (by citing a specific translator, publisher, year) but cannot prove one **doesn't exist**. The old scripts' `confirmed_first` disposition was logically invalid — absence of evidence in catalogs or LLM knowledge is not evidence of absence.

Current Stage 2 dispositions:
- `translation_found` — verified, trustworthy (cites specific translations)
- `confirmed_first` — LLM's best guess, NOT actually confirmed
- `needs_review` — low confidence

### Fix Applied

Script: `_tmp-fix-old-verification.mjs`

1. Identified old records: any `translation_verification` without `stage: 2` (2,156 records)
2. Cleared all old records using `$unset`
3. Reset `is_first_translation` from Stage 1 (`ai_metadata.first_translation.status`):
   - 52 books flipped to `true` (old verification incorrectly set false)
   - 220 books flipped to `false` (old verification incorrectly set true)
   - 1,797 unchanged, 87 had no Stage 1 data
4. Re-ran `_tmp-verify-ft-stage2.mjs` on the 2,156 affected books with fresh Stage 2 data

### Good Records Preserved

923 records with `source: 'gemini_knowledge_lookup'` AND `stage: 2` were kept — these were created by the current `_tmp-verify-ft-stage2.mjs` script with correct disposition logic.

---

## Known Limitations

1. **LLM hallucination risk:** Stage 2 uses Gemini's knowledge — it may claim translations exist that don't, or miss obscure translations. The `needs_review` disposition catches low-confidence cases.
2. **No web search grounding yet:** Stage 3 (Google Search Grounding) would provide real-time verification but isn't implemented in the pipeline.
3. **Partial translations are complex:** A book may have excerpts translated in an anthology but no standalone translation. The `has_partial` status captures this but the boundary is fuzzy.
4. **English books:** Books already in English get `not_applicable` — but some are English translations of non-English works (e.g., Sacred Books of the East). These are correctly classified as `not_applicable` since the book itself is already in English.
5. **Multi-volume works:** Each volume is assessed independently. Volume 1 of Theatrum Chemicum might be `confirmed_first` while Volume 5 is `has_partial` because individual treatises within it have been translated.

---

## Querying

```javascript
// All confirmed first translations
db.books.find({ is_first_translation: true })

// Books needing Stage 1 assessment
db.books.find({
  language: { $nin: ['English', 'english', null, ''] },
  'ai_metadata.enriched_at': { $exists: true },
  'ai_metadata.first_translation': { $exists: false },
})

// Books needing Stage 2 verification
db.books.find({
  language: { $nin: ['English', 'english', null, ''] },
  'ai_metadata.first_translation': { $exists: true },
  'translation_verification': { $exists: false },
  pages_translated: { $gt: 0 },
})

// Stage 2 disposition breakdown
db.books.aggregate([
  { $match: { 'translation_verification.disposition': { $exists: true } } },
  { $group: { _id: '$translation_verification.disposition', count: { $sum: 1 } } },
])
```
