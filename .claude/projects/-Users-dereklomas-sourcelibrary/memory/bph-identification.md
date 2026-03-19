---
name: BPH book identification
description: How to identify Embassy of the Free Mind (BPH) books in the database — provider fields, catalog numbers, counts
type: reference
---

## Identifying BPH / Embassy of the Free Mind Books

**976 books** from the BPH (Bibliotheca Philosophica Hermetica) collection at the Embassy of the Free Mind, Amsterdam.

### Query patterns

**Primary:** `image_source.provider === "efm"` (976 books)
**With catalog number:** `dublin_core.dc_source` matches `"BPH Catalogue (UBN: XXXX)"` (966 books)
**By campaign:** `acquisition_campaign === "EFM Bulk Import"` (911 books — misses early imports)

### Fields on BPH books
- `image_source.provider`: `"efm"`
- `image_source.provider_name`: `"Embassy of the Free Mind"`
- `dublin_core.dc_source`: `"BPH Catalogue (UBN: 1987)"` — the UBN is the BPH catalog number
- `dublin_core.dc_identifier`: `"1987"` — just the number
- `field_provenance.*.provider`: `"efm"` on all imported fields
- `acquisition_campaign`: `"EFM Bulk Import"` (most but not all)

### BPH visual identifier
The "Philosophia Hermetica" pelican ex libris stamp appears in gallery_images for ~78 books (detected by image extraction). Not all BPH books have a visible stamp in their scans.

### Cluster distribution of BPH books
- Continental Christian Mysticism: 190 (19%)
- Western Alchemy: 190 (19%)
- Religious Persecution & Toleration: 78 (8%)
- Early Modern Rosicrucianism: 59 (6%)
- Biblical Scholarship: 49 (5%)
- Grimoires & Ceremonial Magic: 39 (4%)
- Christian Kabbalah: 38 (4%)
- Rosicrucian Fraternity Defenses: 36 (4%)

### Other catalogs
- `kloss_catalog` collection: 1,614 entries from the Kloss (Masonic) sub-collection of BPH. Only 230 matched to visible books.
- Full BPH catalog is on **Supabase** (not yet integrated into MongoDB).
