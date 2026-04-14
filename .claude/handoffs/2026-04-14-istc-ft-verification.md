# ISTC First-Translation Verification & Import — 2026-04-14

## What happened

### 1. Built three-tier FT verification for ISTC candidates
Verified all 2,732 in-scope ISTC incunabula for first-translation status using a cheapest-first approach:

**Tier 1: Local catalog cross-ref** (free, instant)
- Matched ISTC candidates against `translation_catalogs` (23,738 records from UNESCO, Loeb, Brill, Penguin, etc.)
- Tightened matching: exact surname + >=2 title keyword hits (or 1 hit if word >=7 chars)
- Result: 575 matched to existing translations

**Tier 2: English language filter** (free, instant)
- Filtered 7 English-language incunabula (already in English, don't need translation)

**Tier 3: Gemini FT verification** ($11.99, ~2 hours)
- Used `gemini-3.1-flash-lite-preview` with function calling to search 7 catalogs
- Tools: local catalogs, Open Library, Google Books, Internet Archive, OpenAlex, Library of Congress, USTC
- 2,099 verified, 22 errors (fetch timeouts)
- Discoveries written back to `translation_catalogs` (closes the knowledge loop)

### 2. Results

| Status | Count | % |
|---|---|---|
| First translations | **1,718** | 63% |
| Has existing translation | 964 | 35% |
| Needs review | 21 | 0.8% |
| English (skipped) | 7 | 0.3% |
| Errors | 22 | 0.8% |

First-translation breakdown:
- 1,504 confirmed first (no translation of any kind)
- 139 first from source (other-language translations exist, but not from this text)
- 58 first complete translation (only partial/excerpts exist)
- 7 first modern translation (only pre-1900 translation exists)

### 3. Imported 18 first-translation incunabula from European libraries

| Library | Books | Method |
|---|---|---|
| TU Darmstadt | 12 | IIIF at `tudigit.ulb.tu-darmstadt.de/iiif/{id}-manifest.json` |
| Vatican Library | 3 | IIIF at `digi.vatlib.it/iiif/{id}/manifest.json` |
| Heidelberg | 2 | IIIF at `digi.ub.uni-heidelberg.de/diglit/iiif/{id}/manifest` |
| Internet Archive | 1 | Direct IA metadata API |

Also linked ISTC catalog IDs to 9 existing books that were duplicates.

### 4. Refactored `verifyFirstTranslation()` for pre-import use
Extracted `verifyFirstTranslationFromMetadata()` — same Gemini tool-calling flow but accepts metadata directly instead of requiring a book in the `books` collection. The existing `verifyFirstTranslation()` is now a thin wrapper.

## Files changed
- `src/lib/verify-first-translation.ts` — extracted `verifyFirstTranslationFromMetadata()`, existing callers unchanged
- `scripts/enrichment/verify-istc-candidates.mjs` — new, three-tier FT verification script

## Key numbers
| Metric | Value |
|---|---|
| ISTC in-scope candidates | 2,732 |
| First translations identified | 1,718 |
| First translations imported | ~302 (284 BSB + 18 European) |
| First translations needing import | ~1,416 |
| Verification cost | $11.99 |
| New `translation_catalogs` entries | ~400+ (write-back from discoveries) |

## What's NOT done

### Import remaining ~1,416 first-translation incunabula
- **~930 BSB books** — already imported yesterday but deleted by warehouse-remove script. Need re-import via `batch-import-istc-bsb.mjs` (reset import_candidates status first)
- **~74 European libraries** without IIIF resolver — need individual manifest URL probing for:
  - Cologne (inkunabeln.ub.uni-koeln.de): 8 books
  - HAB Wolfenbüttel (diglib.hab.de): 12 books — no IIIF found
  - British Library (access.bl.uk): 7 books — API needs auth or different endpoint
  - SLUB Dresden: 2, Stuttgart: 2, Frankfurt: 2, Berlin: 1, Freiburg: 1, etc.
- **Handle.net / NBN resolvers**: 6+ books behind URN resolvers that need redirect following
- **Flickr, BEIC, Spanish libraries**: 6+ books on non-standard platforms

### 21 needs-review candidates
Conflicting or inconclusive evidence. Could manually verify.

### 22 error candidates
Gemini API timeouts. Re-run with `--force` to retry.

## How to use the script

```bash
# Full run (all tiers)
set -a; source .env.production.local; set +a
node scripts/enrichment/verify-istc-candidates.mjs

# Tier 1 only (free cross-ref)
node scripts/enrichment/verify-istc-candidates.mjs --tier=1

# Tier 3 only with custom delay
node scripts/enrichment/verify-istc-candidates.mjs --tier=3 --delay=500

# Force re-verify already-checked candidates
node scripts/enrichment/verify-istc-candidates.mjs --force --limit=50

# Only candidates with digital copies
node scripts/enrichment/verify-istc-candidates.mjs --has-digital
```

## IIIF resolver patterns discovered
```
TU Darmstadt:  /show/{id}  →  /iiif/{id}-manifest.json
Vatican:       /view/{id}  →  /iiif/{id}/manifest.json
Heidelberg:    /diglit/{id} →  /diglit/iiif/{id}/manifest
BSB:           bsb{id}     →  api.digitale-sammlungen.de/iiif/presentation/v2/{id}/manifest
```
