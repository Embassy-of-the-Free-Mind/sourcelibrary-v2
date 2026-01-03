# Internet Archive Page Count Bug Report

**Date:** 2026-01-02
**Status:** Documented, partial fix applied
**Affected Books:** 160 of 847 IA imports

## Executive Summary

Books imported from Internet Archive before December 30, 2025 may have incorrect page counts due to a bug in the import code. This results in either:
- **Junk pages** (calibration targets, Google disclaimers) appearing after real content
- **Missing content** where the import stopped short of the actual book length

## Root Cause

### The Bug (Fixed Dec 30, 2025)

The IA import code (`src/app/api/import/ia/route.ts`) used a flawed page counting algorithm:

1. Look for individual `.jp2` files (most IA items bundle them in a zip)
2. Look for `scandata.xml` (but IA uses `{identifier}_scandata.xml` naming)
3. **Fallback: Estimate from jp2.zip size** using `size / 500,000 bytes`
4. **Final fallback:** Default to 100 pages

### Why This Failed

- **Overestimate:** Large jp2.zip files produced inflated page counts
  - Example: Atalanta fugiens jp2.zip = 203MB → estimated 407 pages (actual: 232)

- **Underestimate:** When all methods failed, defaulted to 100 pages
  - Example: Works of Jacob Behmen got 100 pages (actual: 574)

### The Fix

Commit `152a953` (Dec 30, 2025) added `imagecount` check as first priority:
```javascript
if (iaMetadataRaw.imagecount) {
  pageCount = parseInt(iaMetadataRaw.imagecount, 10);
}
```

## Visual Verification

### TOO MANY Pages - Junk Content Types

**Calibration Targets (Atalanta fugiens page 240):**
- Oregon Rule Co. color checker card
- Ruler for scale reference
- Black background
- Used by digitization staff for color accuracy

**Google Books Disclaimer (Plotini page 600+):**
- Standard Google Books terms page
- Returned for any page number beyond actual content
- All pages 545-2403 were identical

### TOO FEW Pages - Missing Real Content

**Works of Jacob Behmen (pages 100-574):**
- Pages 100+ contain real book text
- "Signatura Rerum" Chapter II visible on page 100
- "Of the Origin of Man" Chapter 5 visible on page 200
- 474 pages of actual content missing from our import

## Audit Results

### Summary Statistics

| Metric | Count |
|--------|-------|
| Total IA books audited | 847 |
| Books with discrepancies | 160 |
| Books with fetch errors | 204 |
| Books OK | 483 |

### Books with TOO MANY Pages (Top 10)

| Book | Current | Correct | Excess | Status |
|------|---------|---------|--------|--------|
| Plotini Opera Omnia | 2403 | 544 | +1859 | ✅ Fixed |
| Six Books of Proclus | 1764 | 517 | +1247 | Pending |
| Hypnerotomachia Poliphili | 1624 | 469 | +1155 | Pending |
| Comfortable words for Christ's lovers | 1122 | 146 | +976 | Pending |
| Divini Platonis Opera omnia | 1873 | 920 | +953 | Pending |
| Biblia Hebraica | 2683 | 1766 | +917 | Pending |
| Regole generali di architettura | 1022 | 160 | +862 | Pending |
| Magia Naturalis | 1501 | 716 | +785 | Pending |
| Le Opere Italiane | 1182 | 409 | +773 | Pending |
| Magnes | 1828 | 1064 | +764 | Pending |

### Books with TOO FEW Pages (Examples)

| Book | Current | Correct | Missing |
|------|---------|---------|---------|
| L'opere della serafica santa Caterina | 100 | 858 | -758 |
| Septuaginta (Greek Old Testament) | 100 | 741 | -641 |
| Pistis Sophia | 100 | 695 | -595 |
| Le stanze, Le Orfeo e Le rime | 100 | 583 | -483 |
| Works of Jacob Behmen | 100 | 574 | -474 |

Note: Many "100 page" books hit the fallback default.

## Fix Strategy

### For TOO MANY Pages (Safe - Preserves OCR)

```bash
# Single book
npx tsx scripts/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY

# Dry run to see what would be deleted
npx tsx scripts/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY --dry-run
```

**What it does:**
1. Deletes pages where `page_number > correct_count`
2. Updates `book.pages_count`, `pages_ocr`, `pages_translated`
3. Preserves all OCR/translation on valid pages

### For TOO FEW Pages (Destructive - Loses OCR)

```bash
curl -X POST https://sourcelibrary.org/api/books/{id}/reimport \
  -H "Content-Type: application/json" \
  -d '{"mode":"full"}'
```

**What it does:**
1. Deletes ALL existing pages
2. Fetches fresh `imagecount` from IA
3. Creates new page records with correct count
4. ⚠️ All OCR and translation work is lost

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/audit-ia-page-counts.ts` | Compare all IA books against IA metadata |
| `scripts/fix-ia-page-counts.ts` | Fix individual or batch books |
| `scripts/fix-atalanta-excess-pages.ts` | Original fix template (Atalanta-specific) |

## Books Fixed

### Batch Fix - 2026-01-03

**TOO MANY Pages (Trim Operation):**
- Fixed 77 books with excess pages
- Deleted 22,917 junk pages total
- All OCR/translation work preserved

**TOO FEW Pages (Reimport Operation):**
- Reimported 64 books without OCR work
- Skipped 21 books with existing OCR/translations (would lose work)

### Initial Fixes - 2026-01-02

| Book | Date | Before | After | Method |
|------|------|--------|-------|--------|
| Atalanta fugiens | 2026-01-02 | 407 | 232 | Trim |
| Plotini Opera Omnia | 2026-01-02 | 2403 | 544 | Trim |

### Books Skipped (Have OCR Work)

The following 21 books need manual decision - reimporting would lose existing OCR/translation:

| Book | OCR Pages | Translated |
|------|-----------|------------|
| De Arte Cabalistica | 456 | 0 |
| De vitis, dogmatis et apophthegmatis | 451 | 3 |
| Opera Omnia | 439 | 0 |
| Miracula et mysteria chymico-medica | 332 | 0 |
| Musaeum Hermeticum | 325 | 0 |
| De revolutionibus orbium coelestium | 209 | 209 |
| De architectura libri decem | 198 | 68 |
| Summa perfectionis magisterii | 187 | 0 |
| Pansophiae Diatyposis | 148 | 148 |
| De Mysteriis Aegyptiorum | 145 | 0 |
| Manly Palmer Hall Alchemical Manuscripts | 118 | 0 |
| Lumen de Lumine | 81 | 0 |
| Aula Lucis | 60 | 0 |
| Platonis Opera a Marsilio Ficino traducta | 43 | 0 |
| The Hermetic Museum (Vol. 1) | 43 | 0 |
| Astronomia Nova | 40 | 0 |
| Tetragonismus idest circuli quadratura | 34 | 34 |
| Marsilij Ficini Platonica theologia | 33 | 0 |
| Marsilij Ficini Opera | 10 | 0 |
| Opera Latine Conscripta | 10 | 10 |
| De Triplici Minimo et Mensura | 9 | 9 |

## Recommendations

1. **Immediate:** Run trim fixes on all TOO MANY books (safe, preserves work)
2. **Evaluate:** Review TOO FEW books - prioritize those without OCR work for reimport
3. **Prevention:** New imports use fixed code with `imagecount` priority

## Technical Details

### IA Metadata Fields

```json
{
  "metadata": {
    "imagecount": "232",        // Authoritative page count
    "identifier": "atalantafugiensh00maie"
  },
  "files": [
    {"name": "atalantafugiensh00maie_jp2.zip", "size": 203839812},
    {"name": "atalantafugiensh00maie_scandata.xml"}
  ]
}
```

### IA BookReader Behavior

When requesting pages beyond actual content:
- Returns placeholder images (Google disclaimer, last scanned image, etc.)
- Does NOT return 404 errors
- This is why excess pages contain junk instead of failing

### Scandata XML Structure

```xml
<book>
  <pageData>
    <page leafNum="0"><pageType>Color Card</pageType></page>
    <page leafNum="1"><pageType>Cover</pageType></page>
    <!-- ... actual book pages ... -->
    <page leafNum="230"><pageType>Cover</pageType></page>
    <page leafNum="231"><pageType>Color Card</pageType></page>
  </pageData>
</book>
```

Note: `imagecount` (232) includes color cards and covers in the count.
