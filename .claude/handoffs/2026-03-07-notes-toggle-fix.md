# Notes Toggle Fix: Untoggleable Image Descriptions

**Date:** March 7, 2026
**Commits:** af71fe07, 94d8eb9e

## Problem

On pages with illustrations (frontispieces, bookplates, diagrams), toggling "Notes" off didn't hide all AI-generated content. Descriptive text like "A modern printed bookplate is pasted in the center of the page..." remained visible, looking like original manuscript text.

**Example:** https://sourcelibrary.org/book/690989d5cf28baa1b4cae1c9/page/690989e0cf28baa1b4cae1cd

## Root Cause

The issue spans two pipeline stages:

**1. OCR stage** correctly wraps image descriptions in `<image-desc>` tags, which NotesRenderer strips before display. This is correct — the OCR output separates image descriptions from text content.

**2. Translation stage** receives the OCR with `<image-desc>` but the prompt didn't instruct the AI what to do with it. The translator expanded the image description into flowing prose, sprinkling `<note>` tags around contextual annotations but leaving the descriptive text between them untagged:

```
A modern printed bookplate is pasted in the center of the page. It features
an oval scene against a blue background, depicting a **pelican in her piety**
<note>In heraldry and Christian art, a "pelican in her piety" is shown...</note>.
The bird is perched on a nest atop a square pedestal decorated with **four red roses**
<note>The combination of the rose and the cross...</note>. Above the scene,
a golden sun shines with radiating beams, signifying divine light or enlightenment.
```

The `<note>` tags (gold highlighted) toggle correctly. The untagged prose stays visible because NotesRenderer has no way to know it's AI commentary rather than original text.

## Solution: Three Layers

### Layer 1: Rendering fix (immediate, no re-translation needed)

For non-text page types (`frontispiece`, `illustration`, `diagram`, `map`, `blank`), the entire "translation" is AI-generated description — there's no original text to show. Added `pageType` prop to NotesRenderer: when notes are off and the page type is in this set, render a placeholder message instead of content.

**Files:** `NotesRenderer.tsx`, `TranslationEditor.tsx`

This works because the insight is simple: these page types have zero original text. Everything the AI wrote is commentary. The `page_type` field (set by OCR) tells us this reliably.

**Limitation:** Only works for pages with `page_type` set (post-Feb 2026 OCR). Pages OCR'd before the `<page-type>` tag was added won't have it. Also doesn't help for text pages that happen to include image descriptions mixed with real content.

### Layer 2: NotesRenderer `<image-desc>` handler (catch-all for tagged content)

Changed the `<image-desc>` component handler from `() => null` (always hidden) to toggleable like `<note>`. If a translator outputs `<image-desc>` tags directly, they'll render as gold-highlighted notes that hide with the toggle.

**File:** `NotesRenderer.tsx`

### Layer 3: Translation prompt update (prevents future occurrences)

Added explicit instructions to the translation prompt telling the AI to wrap image descriptions in `<note>` tags:

```
**Image descriptions from OCR:**
If the OCR contains <image-desc>...</image-desc>, translate the description and wrap
the ENTIRE paragraph in <note>...</note>. Image descriptions are editorial content,
not original text — they must be toggleable.
```

**File:** `src/lib/types/prompts/defaults.ts`

## Key Insight

The fundamental challenge is that the NotesRenderer can't distinguish AI-generated prose from original manuscript text by looking at the translation alone — both are plain text. The fix uses external metadata (`page_type`) to make this determination rather than trying to detect it heuristically from content patterns.

For text-heavy pages that include occasional `<image-desc>` in the OCR, the prompt fix (Layer 3) is what prevents the problem. For illustration-only pages, the pageType check (Layer 1) is the backstop.

## What Remains

- Existing translations of illustration pages with `page_type` set are fixed by Layer 1 (rendering).
- Existing translations without `page_type` (pre-Feb 2026 OCR) will still show untagged descriptions when notes are off. These will be fixed when re-OCR'd (gets `page_type`) or re-translated (prompt wraps descriptions in `<note>`).
- Future translations benefit from the prompt fix regardless of page type.
