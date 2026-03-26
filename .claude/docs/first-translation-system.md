# First Translation Identification System

## Overview

Source Library identifies books that represent the **first known English translation** of a historical text. This is a key scholarly claim — many pre-1800 Latin, German, Arabic, Hebrew, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy have never been translated into English.

The system uses a **two-stage AI verification pipeline**:
1. **Stage 1 (lightweight):** OCR-based classification during metadata enrichment — fast, uses existing page text
2. **Stage 2 (deep):** Gemini function-calling verification with real catalog searches — the model actively searches 4 databases, evaluates results semantically, and makes an evidence-based determination

As of March 9, 2026: **2,446 verified first translations** across 4,041 verified non-English books.

**Blog post:** https://sourcelibrary.org/blog/first-translation-methodology

---

## How "First Translation" Is Defined

### Source Language Matters

A first translation claim is specific to the **source text in our library**, not the underlying work. Many books are Latin translations of Greek originals. If the Greek has been translated to English but the Latin text hasn't, our Latin text is still a first translation.

**Example:** Iamblichus' *De Mysteriis* in Ficino's Latin rendering. Taylor (1821) and Clarke (2003) translated the Greek original to English, but Ficino's Latin version — which has its own scholarly value as a Renaissance interpretation — has never been translated. This counts as a **first translation**.

The prompt explicitly instructs the model: *"A translation from a different source language (e.g. Greek→English when we have the Latin text) does NOT count."*

### Five Disposition Categories

The system recognizes that "first translation" isn't binary. A book can be:

| Disposition | Meaning | `is_first_translation` | Example |
|-------------|---------|----------------------|---------|
| `confirmed_first` | No English translation of any kind exists | `true` | A Latin alchemical text never translated |
| `first_complete_translation` | Partial translations or excerpts exist, but no complete translation | `true` | Paracelsus work where only excerpts appear in anthologies |
| `first_modern_translation` | Old/antiquated translations exist (typically pre-1900), but no modern scholarly translation | `true` | Text with a 1649 English version but no modern critical translation |
| `translation_found` | A complete, modern English translation already exists | `false` | Text with a Penguin Classics edition |
| `needs_review` | Evidence is conflicting or inconclusive | `false` | Tool searches failed (API errors) or evidence is ambiguous |

All three "first" categories set `is_first_translation: true` because each represents genuine scholarly value — being the first complete translation, or the first modern translation, is still significant.

### Partial and Related Translations

The `first_complete_translation` disposition handles the most common nuanced case:

- **Anthologized excerpts:** Individual sections translated in collected volumes (e.g., excerpts from Theatrum Chemicum appearing in Waite's *Hermetic and Alchemical Writings*)
- **Selected passages:** Academic articles quoting/translating key passages but not the full work
- **Partial translations:** A translator started but never finished (common with long Latin texts)

The model lists these partial translations in `translations_found` with `completeness: 'partial'` or `'excerpts'`, then sets `first_complete_translation` because no full version exists.

**Real example from the DB:** *"On Presages, Divination, and Astrological Fragments"* (Latin, 1569) — partial translations exist in *The Hermetic and Alchemical Writings of Paracelsus* (local_catalogs) but no complete translation of this specific compilation by Gerhard Dorn.

### Old vs. Modern Translations

The `first_modern_translation` disposition handles cases where:

- A 17th-century English translation exists but is archaic and unreliable
- An old translation was made from a different recension or intermediate language
- The existing translation lacks critical apparatus, notes, or scholarly context

**Real example:** *"Know Thyself: Astrology Theologized"* (German) — Robert Turner translated from Latin in 1649, and Anna Kingsford reprinted in 1886, but both are from the Latin version, not the German original. Our translation from the original German is the first modern direct translation.

---

## Data Storage

### Book-Level Fields

| Field | Type | Set By | Description |
|-------|------|--------|-------------|
| `ai_metadata.first_translation` | Object | Stage 1 (enrichment) | `{ status, reasoning, known_translations[], confidence }` |
| `is_first_translation` | boolean | Stage 2 (overrides Stage 1) | Derived from disposition — `true` for confirmed/first_complete/first_modern |
| `translation_verification` | Object | Stage 2 (verification) | Full evidence chain with disposition, translations found, tools called, reasoning |
| `field_provenance.is_first_translation` | Object | Stage 1 | AI source info (model, date, confidence, pages_checked) |

### Stage 1 Object (`ai_metadata.first_translation`)

```typescript
{
  status: 'confirmed_first' | 'likely_first' | 'uncertain' | 'has_partial' | 'has_translation' | 'not_applicable';
  reasoning: string;
  known_translations: string[];
  confidence: 'high' | 'medium' | 'low';
}
```

### Stage 2 Object (`translation_verification`)

```typescript
interface TranslationVerification {
  disposition: 'confirmed_first' | 'first_complete_translation' | 'first_modern_translation' | 'translation_found' | 'needs_review';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  translations_found: Array<{
    english_title: string;
    translator?: string;
    pub_year?: string;
    publisher?: string;
    completeness: 'complete' | 'partial' | 'excerpts' | 'unknown';
    evidence_source: 'local_catalogs' | 'open_library' | 'google_books' | 'ustc';
    url?: string;
  }>;
  tools_called: string[];   // e.g. ['search_local_catalogs', 'search_open_library', 'make_determination']
  verified_at: Date;
  model: string;            // 'gemini-3-flash-preview'
  cost_usd: number;         // ~$0.01/book
  source: 'catalog_and_llm';
  stage: 2;
}
```

---

## Stage 1: AI Metadata Enrichment

**When:** Pipeline Phase 3.5 (`metadata_enriched` state), runs automatically.

**How:** Reads first 25 OCR pages + metadata, asks Gemini to classify `first_translation` alongside other metadata (language, categories, description, display_title). This is a lightweight text-only check — no catalog searches.

**Implementation:** `enrichBookMetadata()` in `src/lib/metadata-enrichment.ts`

**Cost:** ~$0.002/book (included in metadata enrichment cost).

**What it writes:**
- `ai_metadata.first_translation` — classification object
- `is_first_translation` — derived boolean (overridden by Stage 2 when it runs)
- `field_provenance.is_first_translation` — AI source tracking

Stage 1 is a preliminary screen. It catches obvious cases (English books → `not_applicable`, well-known translated works → `has_translation`) but has no access to catalogs. Stage 2 provides the authoritative determination.

---

## Stage 2: Gemini Function-Calling Verification

**When:** Pipeline Phase 3.7 (`ft_verifying` → `ft_verified` state), or via backfill script.

**How:** Multi-turn Gemini conversation where the model calls tools to search real catalogs, evaluates results semantically, then makes an evidence-based determination. This is the first use of Gemini function calling in the codebase.

**Implementation:** `verifyFirstTranslation()` in `src/lib/verify-first-translation.ts`

**Model:** `gemini-3-flash-preview`, temperature 0.1, max 6 rounds.

**Cost:** ~$0.01/book (2-4 Gemini rounds with tool calls).

### Five Tools Available to the Model

| Tool | Source | What it searches | URL in results? |
|------|--------|-----------------|----------------|
| `search_local_catalogs` | MongoDB `translation_catalogs` (~12k records) | UNESCO Index Translationum, Loeb, Brill, Penguin, CUA/Paulist, Godwin, HathiTrust catalogs | No (catalog records) |
| `search_open_library` | Open Library API | Modern editions with ISBNs, publishers, dates | Yes (openlibrary.org links) |
| `search_google_books` | Google Books API | Academic press translations, older editions | Yes (books.google.com links) |
| `search_ustc` | USTC via Supabase | Verifies the original work exists, finds variant titles | No (catalog records) |
| `make_determination` | Terminal tool | Final verdict — model must call this to end | N/A |

### How It Works

1. Model receives book metadata (title, author, language, year) + first 3 pages of OCR + Stage 1 assessment
2. Model calls `search_local_catalogs` first (instant, free, high signal from 12k+ scholarly catalog records)
3. If inconclusive, model calls `search_open_library` and/or `search_google_books`
4. Model may call `search_ustc` to verify the original work or find alternate titles
5. Model calls `make_determination` with disposition + reasoning + list of translations found
6. If model doesn't call `make_determination` after 6 rounds, a nudge message is injected

### Key Design: LLM Evaluates, Doesn't Regex

The model evaluates search results for **semantic relevance**, not string matching. When Open Library returns "Ficino: Platonic Theology," it's the model that decides whether that's a translation of *this specific work* or a different one by the same author. This solves the false-positive problem that plagued earlier regex-based approaches.

### Evidence Grounding (March 9, 2026)

The prompt constrains `translations_found` entries to only include translations actually found via tool calls. Evidence sources are an enum (`local_catalogs`, `open_library`, `google_books`, `ustc`), not free text. URLs from Open Library and Google Books are included when the tools return them. If the model believes a translation exists but couldn't find it via tools, it sets `needs_review` with reasoning instead of fabricating evidence.

### What It Writes

- `translation_verification` — full evidence chain (tools called, translations found with URLs, confidence, reasoning)
- `is_first_translation` — updated boolean (overrides Stage 1)
- Logged to `gemini_usage` with type `ft_verification`
- Metadata changelog entry for audit trail

### The `translation_catalogs` Collection

~12,000 records imported from scholarly translation catalogs via `scripts/enrichment/import-translation-catalogs.mjs`:

| Source | Records | Coverage |
|--------|---------|----------|
| UNESCO Index Translationum | ~7,500 | Most comprehensive — translations across all languages |
| Loeb Classical Library | varies | Greek and Latin classics |
| Brill | varies | Academic translations |
| Penguin Classics | varies | Major trade translations |
| CUA/Paulist Press | varies | Patristic texts |
| Godwin | varies | Specialist esoteric texts |
| HathiTrust | varies | Historical translations pre-1979 |

Schema: `source`, `author`, `author_normalized`, `english_title`, `original_title`, `translator`, `pub_year`, `publisher`, `series`. Text-indexed on author + titles.

---

## Pipeline Integration

Both stages run automatically in the post-import pipeline:

```
... → ocr_complete → metadata_enriched (Stage 1) → ft_verifying → ft_verified (Stage 2) → translate_submitted → ...
```

- **English books** skip Stage 2 entirely (already `not_applicable`)
- **Already-verified books** (with `tools_called` field) skip unless `--force` is used
- **Non-blocking:** On persistent failure after 3 retries, books skip ahead to `ft_verified` — verification doesn't block translation

Phase 3.7 processes up to 10 books per cron run, at ~$0.01/book.

**Backfill script:** `scripts/enrichment/cleanup-first-translation-claims.mjs`
- `--all` — verify all non-English books without tool-calling verification
- `--all --force` — re-verify ALL non-English books (even already verified)
- `--apply` — persist results (default is dry-run)
- `--book-id=ID` — verify a single book

---

## Current Numbers (March 26, 2026)

| Metric | Count |
|--------|-------|
| Total `is_first_translation: true` | **5,212** |
| Total with FT verification | 7,688 |

### Disposition Breakdown

| Disposition | Count | % of verified |
|-------------|-------|--------------|
| `confirmed_first` | 4,368 | 56.7% |
| `translation_found` | 2,190 | 28.5% |
| `first_complete_translation` | 734 | 9.5% |
| `needs_review` | 289 | 3.8% |
| `first_modern_translation` | 162 | 2.1% |

### Stage 1 Breakdown (for reference)

| Status | Count |
|--------|-------|
| `has_translation` | 1,510 |
| `not_applicable` | 823 |
| `likely_first` | 707 |
| `has_partial` | 384 |
| `uncertain` | 282 |
| `confirmed_first` | 38 |

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

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/verify-first-translation.ts` | Core Stage 2 verification (Gemini function calling, 5 tools) |
| `src/lib/metadata-enrichment.ts` | Stage 1 classification (part of metadata enrichment) |
| `scripts/enrichment/cleanup-first-translation-claims.mjs` | Backfill script (--all, --apply, --force, --book-id flags) |
| `scripts/enrichment/import-translation-catalogs.mjs` | Imports CSV catalogs into MongoDB `translation_catalogs` collection |
| `src/lib/types/pipeline.ts` | Pipeline states including `ft_verifying`, `ft_verified` |
| `src/app/api/cron/post-import-pipeline/route.ts` | Phase 3.7 integration |

---

## Known Limitations

1. **Absence ≠ evidence:** Stage 2 can verify that a translation **exists** (by citing specific translator, publisher, year) but cannot prove one **doesn't exist**. `confirmed_first` means "no translation found in our catalogs" — a strong signal but not absolute proof.

2. **Catalog coverage gaps:** The `translation_catalogs` collection has ~12k records from major scholarly catalogs, but doesn't cover every publisher. Obscure translations from small presses or dissertations may be missed. Open Library and Google Books partially fill this gap.

3. **Partial translation boundaries:** The line between "excerpt" and "partial translation" is fuzzy. A 10-page excerpt in an anthology is clearly partial, but what about a 100-page selection from a 200-page work? The model uses judgment.

4. **Multi-volume works:** Each volume is assessed independently. Volume 1 of Theatrum Chemicum might be `confirmed_first` while individual treatises within Volume 5 have been translated in anthologies.

5. **English books:** Books already in English get `not_applicable` from Stage 1 and skip Stage 2 entirely.

6. **`needs_review` from API failures:** Some books get `needs_review` because Google Books returned HTTP 429 (rate limit), not because the evidence is genuinely ambiguous. These can be re-verified later.

7. **LLM knowledge leakage:** Despite prompt guardrails, the model may occasionally use its training knowledge to inform dispositions rather than relying solely on tool results. The evidence_source enum constraint (added March 9, 2026) mitigates but doesn't eliminate this.

---

## Historical Context

### Evolution of the System

1. **Pre-Feb 2026:** Single weak Gemini prompt during metadata enrichment. No catalog lookups, no evidence. ~180 books misclassified.
2. **Feb 2026:** Stage 1 added to metadata enrichment. Lightweight but no catalog access.
3. **March 7-8, 2026:** Stage 2 built — Gemini function calling with 5 real tools. First use of function calling in the codebase. UNESCO + other catalogs imported to MongoDB.
4. **March 7-9, 2026:** Full backfill of 4,041 non-English books. Discovered ~1,450 new first translations (up from ~994 flagged).
5. **March 9, 2026:** Prompt tightened to constrain evidence to tool results only (evidence_source enum, no LLM knowledge in translations_found). Remaining 1,277 unverified books processed.

### Data Quality Fix (March 7-9, 2026)

Three pre-March-2026 scripts wrote `translation_verification` records with buggy disposition logic, non-standard field names, and no `stage` marker. All 2,156 old records were cleared and re-verified with the new pipeline. See `.claude/handoffs/2026-03-07-first-translation-verification-backfill.md` for details.

---

## Querying

```javascript
// All first translations (includes confirmed, first_complete, first_modern)
db.books.find({ is_first_translation: true })

// Disposition breakdown
db.books.aggregate([
  { $match: { 'translation_verification.disposition': { $exists: true } } },
  { $group: { _id: '$translation_verification.disposition', count: { $sum: 1 } } },
])

// Books still unverified (no tool-calling verification)
db.books.find({
  language: { $nin: ['English', 'english', null, ''] },
  'translation_verification.tools_called': { $exists: false },
})

// First-complete translations with their partial evidence
db.books.find(
  { 'translation_verification.disposition': 'first_complete_translation' },
  { title: 1, display_title: 1, 'translation_verification.translations_found': 1, 'translation_verification.reasoning': 1 }
)

// Books needing review (API failures, ambiguous evidence)
db.books.find({ 'translation_verification.disposition': 'needs_review' })
```
