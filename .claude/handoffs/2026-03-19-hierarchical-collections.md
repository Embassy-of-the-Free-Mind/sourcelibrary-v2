# Hierarchical Collections — Session Handoff

**Date:** 2026-03-19
**Branch:** dev/prototype

## What was done

### 1. UI: Generic sub-collection support
- **`src/app/collections/[id]/page.tsx`** — Fetches child collections and renders a sub-collection grid (4-col, image cards) between hero and overview sections
- **`src/app/collections/page.tsx`** — Fetches child counts per parent, shows "N sub-collections" on collection cards (user later reverted the child count display and timeline)
- Sacred-texts custom portal page (`/collections/sacred-texts/page.tsx`) left untouched

### 2. Sub-collections created (56 total, 41 new + 15 pre-existing sacred-texts/buddhism)
Created sub-collections for 12 parent collections with tradition-based divisions:
- **Alchemy** (6): Spiritual, Paracelsian, Rosicrucian, Laboratory, Daoist, Arabic
- **Astrology** (4): Jyotisha/Indian, Horoscopic Western, Chinese, Celestial Divination
- **Classical Philosophy** (4): Neoplatonism, Aristotelian, Stoic, Platonic
- **Natural Philosophy** (11): Natural Magic, Chinese Natural Knowledge, Cosmology, Mathematics, Music & Harmony, Natural History, Experimental Philosophy, Indian, Geography, Mechanical Engineering, Optics, Encyclopedic Works
- **Christian Theology** (5): Philosophical, Mystical, Biblical Exegesis, Theosophical, Reformation (parent renamed from "Theology")
- **Mysticism** (5): German Speculative, Christian, Theosophical/Occult, Sufi/Eastern, Jewish/Kabbalistic
- **Hermetica** (4): Hermetic Revival, Rosicrucian, Paracelsian, Corpus Hermeticum
- **Literature** (4): History/Political, Ancient Epic, Renaissance Letters, Oriental Classics
- **Medicine** (5): Early Modern, Herbals/Botany, Chinese Medicine, Paracelsian, Galenic
- **Magic** (5): Ritual/Ceremonial, Divination, Natural Magic, Chinese/Daoist, Arabic/Islamic

### 3. Classification pipeline
Three-step process:
1. **Rule-based** (categories, language, author) — free, catches ~60%
2. **Gemini classification** — batches of 30, classifies remaining
3. **Gemini audit** — strict "primary subject" prompt, removes cross-references

Key lesson: The audit prompt matters hugely. Original prompt forced classification; improved prompt says "use your knowledge, when in doubt remove, most books should be none."

### 4. Audit results
- 41% removal rate across all sub-collections (2,521 cross-references removed)
- Some over-pruning on smaller collections (Optics went to 4 books)
- Backfill from unassigned parent books recovered 712 books

## Current state

### Thin sub-collections needing imports (< 10 books)
- Daoist Alchemy (~4)
- Shinto (~3)
- Vajrayana (~2), Zen/Chan (~2)
- Manichaeism (~5)
- Jainism (~5)
- Orphism & Mystery Religions (~6)
- Arabic & Islamic Magic (~10)
- Chinese & Daoist Magic (~10)

### Scripts
- `scripts/create-subcollections.mjs` — Original creation + classification
- `scripts/rework-subcollections.mjs` — Added tradition subs, split math/music
- `scripts/audit-subcollections.mjs` — Gemini audit with strict prompt
- `scripts/backfill-thin-subs.mjs` — Fills thin subs from unassigned parent books

### Known issues
- Featured images seeded for new subs (5 each) but could be richer
- `early-modern-medicine-sub` slug is ugly — should be `early-modern-medicine`
- Some sub-collections may still have false positives after audit
- The `collections` array on books has no concept of "primary" vs "cross-reference"

## Next steps
1. **Curator runs** for thin sub-collections (Daoist alchemy, Shinto, Vajrayana, etc.)
2. **Verify preview** — check the sub-collection grids look good
3. **Featured images** — seed richer hero images for sub-collections
4. **Consider** adding a `primary_collection` field to books to distinguish from cross-refs
