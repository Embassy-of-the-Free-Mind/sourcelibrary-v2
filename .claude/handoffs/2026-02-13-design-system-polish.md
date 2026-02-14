# Design System Polish & Footer Cleanup

**Date:** 2026-02-13
**Status:** Complete, deployed to production

## What Changed

### 1. Typography (globals.css)
- `prose-manuscript` and `prose-content` bumped from 17px/1.75 to 18px/1.8
- Improves reading comfort for translated manuscript text

### 2. Book Detail Page (`src/app/book/[id]/page.tsx`)
- Page background: `bg-stone-50` → `bg-cream` (matches design tokens)
- Added gradient bridge between dark header and light content area
- Utility actions (Like, Share, Cite, etc.) grouped in subtle `bg-white/5` container
- "About This Book" and "Index" cards use `.card` utility class instead of inline styles
- Section headings use Cormorant Garamond (design system font)
- Summary text uses `prose-content` class for consistent reading typography

### 3. Pages Grid (`src/components/book/PagesGrid.tsx`)
- "Pages" heading uses Cormorant Garamond
- Status dots (OCR/translation/summary) now sit on dark pill background for visibility
- Empty state uses design system styling

### 4. Global Footer (`src/components/layout/GlobalFooter.tsx`)
- Added "About" link (both SSR fallback and hydrated versions)
- Removed "Research" link
- Final layout: CC0 Public Domain • About • Support • email

### 5. Support Page (`src/app/support/page.tsx`)
- Donate button: DonorPerfect form → https://www.ancientwisdomtrust.org/become-a-patron
- Button text: "Donate Now" → "Become a Patron"

## Orphaned Pages Identified (Not Yet Fixed)

These pages exist but have no or weak inbound links:

| Page | Status | Notes |
|------|--------|-------|
| `/highlights` | Orphaned | No links anywhere |
| `/qa` | Orphaned | No links anywhere |
| `/upload` | Semi-orphaned | Link exists but commented out |
| `/contribute` | Weak | Only linked from one place |
| `/roadmap` | Weak | Only linked from one place |

### Broken Society Mode Links
Society mode navigation references `/apply`, `/library`, `/transparency` — none of these have `page.tsx` files.

## Files Modified
- `src/app/globals.css`
- `src/app/book/[id]/page.tsx`
- `src/components/book/PagesGrid.tsx`
- `src/components/layout/GlobalFooter.tsx`
- `src/app/support/page.tsx`
