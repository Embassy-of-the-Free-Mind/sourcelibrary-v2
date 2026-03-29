---
name: Gallery collection dedup by work_id
description: Collection galleries deduplicate images across editions of the same work, preserving multi-volume sets
type: project
---

Gallery collection seeding (`POST /api/admin/seed-collections`) deduplicates images from multiple editions of the same work (shared `work_id`). Keeps only the best-quality edition's images.

**How it works:** `deduplicateByWorkId()` in `src/app/api/admin/seed-collections/route.ts`:
1. Looks up `book_id` → `work_id` for all candidate images
2. Groups books by `work_id`, normalizes titles via `baseTitle()` to detect volumes vs editions
3. If all books in a group share the same base title → multi-volume set → keep all
4. If titles differ → true editions → keep group with highest avg `gallery_quality`

**Volume detection** (`baseTitle()`): strips Vol/Tome/Band/Part + numbers, CJK volume markers (一二三...十), Chinese juan markers (卷上, 卷下之中). Examples:
- `三才圖會(三十)` → `三才圖會` (volume, preserved)
- `Herbarium Amboinense Vol. 3` → `herbarium amboinense` (volume, preserved)
- `Splendor Solis` vs `Aureum Vellus` → different base titles (editions, deduped)

**Why:** Same engravings/woodcuts appeared multiple times in collection galleries from different editions of the same work. ~335 duplicates removed across 20+ collections.

**How to apply:** Dedup runs automatically during `seed-collections`. To re-seed: `POST /api/admin/seed-collections?force=true` (visual) and `?mode=thematic&force=true` (thematic). PR #489.

**Note:** `gallery_images` does NOT have `work_id` — the join happens at seed time against the `books` collection.
