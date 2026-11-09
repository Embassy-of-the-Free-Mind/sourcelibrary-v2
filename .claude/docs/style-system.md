# Style System

## Overview

All brand colors are defined as CSS custom properties in `src/app/globals.css` and exposed as Tailwind utilities via `@theme inline`. Component-level color maps (entity types, processing actions, etc.) live in `src/lib/style-constants.ts` — the single source of truth for repeated style patterns.

## Typography Minimums

- **Prose / text blocks:** `text-base` (16px) minimum. Never use `text-sm` (14px) or smaller for multi-sentence reading content. This is the browser default and WCAG accessibility baseline.
- **Labels, badges, metadata:** `text-xs` (12px) or `text-sm` (14px) is fine for short strings like dates, language badges, status labels.
- **Reading content** (translations, OCR, page text): `text-base` or larger. The reader uses `font-body` (Newsreader) at 16px+.

## Design Tokens (globals.css)

### Palette

| Token | Value | Tailwind class | Usage |
|-------|-------|---------------|-------|
| `--bg-cream` | `#fdfcf9` | `bg-cream` | Default page background |
| `--bg-warm` | `#f5f0e8` | `bg-warm` | Card/section backgrounds |
| `--bg-dark` | `#1a1612` | `bg-dark` | Dark sections (hero, footer) |
| `--accent-rust` | `#9e4a3a` | `text-accent-rust`, `bg-accent-rust` | Primary accent, CTAs, person entities |
| `--accent-gold` | `#c9a86c` | `text-accent-gold`, `bg-accent-gold` | Gold highlights, image extraction |
| `--accent-sage` | `#8b9a7d` | `text-accent-sage`, `bg-accent-sage` | Nature/place entities, OCR status |
| `--accent-violet` | `#7c5db5` | `text-accent-violet`, `bg-accent-violet` | Concepts, terms, glosses |
| `--accent-sage-dark` | `#5e6d52` | `text-accent-sage-dark` | Sage text on light backgrounds (higher contrast) |
| `--accent-gold-dark` | `#9e7c3c` | `text-accent-gold-dark` | Gold text on light backgrounds (higher contrast) |

### Text Colors (WCAG AA compliant)

| Token | Value | Ratio on cream | Usage |
|-------|-------|---------------|-------|
| `--text-primary` | `#1a1612` | 15.8:1 | Body text |
| `--text-secondary` | `#444` | 9.7:1 | Subheadings, labels |
| `--text-muted` | `#6b6560` | 5.2:1 | Secondary info |
| `--text-faint` | `#8a8480` | 4.5:1 | Tertiary info (minimum AA) |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `--border-light` | `#e8e4dc` | Card borders, dividers |
| `--border-medium` | `#d4cfc4` | Emphasized borders |

### Typography (fonts)

| Token | Tailwind | Usage |
|-------|---------|-------|
| `--font-sans` | `font-sans` | UI text (Inter) |
| `--font-serif` | `font-serif` | Headings (Cormorant Garamond) |
| `--font-body` | `font-body` | Reading text (Newsreader) |
| `--font-display` | `font-display` | Display headings (Playfair Display) |

### Status Colors

Semantic tokens for success/error/warning/info states. Use these instead of hardcoded green/red/amber/blue Tailwind classes.

| Token | Value | Tailwind class | Usage |
|-------|-------|---------------|-------|
| `--status-success` | `#16a34a` | `text-status-success`, `bg-status-success` | Completed states, positive indicators |
| `--status-error` | `#dc2626` | `text-status-error`, `bg-status-error` | Failed states, destructive actions |
| `--status-warning` | `#d97706` | `text-status-warning`, `bg-status-warning` | Pending states, caution indicators |
| `--status-info` | `#2563eb` | `text-status-info`, `bg-status-info` | Neutral info, links, active states |

```tsx
// Status badges
<span className="bg-status-success/15 text-status-success">Completed</span>
<span className="bg-status-error/15 text-status-error">Failed</span>

// Borders
<div className="border-status-success/30">
```

## Use What Exists (component inventory)

Before drawing any control, use the one the site already has. A new page does not get its own pagination, dropdown, search bar or card. If something here doesn't fit, change it here (additive props) so every page moves together.

| Need | Use | Where it's live |
|---|---|---|
| Search bar + Ask the librarian | `search-kit/SearchAskBars` | /library, /gallery |
| Any dropdown (sort, subject, language, order) | `search-kit/SortSelect` (optional `label` for its accessible name) | /library, /gallery |
| Filter chips under a search | `search-kit/FilterChips` | /library |
| Stat boxes, printed-years chart, share bar | `search-kit/StatParts` (`statBox`, `PrintedBox`, `ShareBox`) | /library, /gallery |
| Pagination | `collections/CatalogPagination` with `variant="search"` | /library |
| On/off filter pills | the `pill` class in `gallery/GalleryControls` (`h-[30px] px-3 border text-[13px]`, black when on) | /gallery |
| Grid / list switch | the bordered two-button group in `catalog/explorer/CatalogExplorer` (`bg-warm` when on) | /library |
| Book card | `CollectionBookCard`, 5 per row on desktop | collections, /library |
| Image grid | `GalleryMasonry`, pictures at their own proportions | /gallery, collections |
| Dark hero over pictures | `HeroScrim`, or the revamp's `PlateWall` tint | book page, /about |
| Buttons | black fill, see Buttons below | everywhere |



Fields and controls show focus by darkening their own border, not with the rust outline.

- **Text fields, search bars, selects:** border `border-border-medium` at rest; on focus `border-primary` plus a 1px `ring-primary` (Tailwind: `focus-within:border-primary focus-within:ring-1 focus-within:ring-primary` on the wrapper, or `focus:` on the field). The input itself has no outline. This is the `[data-catalog-bar]` pattern used by /library and /gallery.
- **Buttons, links, boxes reached by keyboard:** `outline: 2px solid var(--text-primary)` with `outline-offset: 2px`. Keyboard focus must stay visible; only the colour changes from rust to near-black.
- **Hover on boxes and cards:** border to `border-primary`. No colour change on text, no underline inside a box.

Status: applied inside `/revamp` only (`src/app/revamp/layout.tsx`). Making it site-wide means changing the global `:focus-visible` rule in `globals.css`, which also changes the BPH embed, so it needs its own PR and BPH sign-off.

## Buttons and Dropdowns (proposed, collections revamp)

- **Buttons are black.** Any action button (See all, Show more, Search, Ask, Sign in to start): `bg-primary text-cream`, square corners, `h-11 px-5 text-sm font-medium`, hover `opacity-90`. No white outlined buttons, no rounded corners. Rust stays only where the site header already uses it (Sign in).
- **Dropdowns look like /library's sort.** A bordered white box with the current choice and a small chevron (`search-kit/SortSelect`; `revamp/_components/Pick` adds a label). The real `<select>` sits invisibly on top so phones get their own picker and it keeps 16px text so iOS doesn't zoom. No native-looking selects.

## Using Tailwind Tokens

Tailwind v4 generates utility classes from `@theme inline` tokens. Use them directly:

```tsx
// Background with opacity
<div className="bg-accent-rust/8">   // 8% opacity
<div className="bg-accent-sage/12">  // 12% opacity

// Text color
<span className="text-accent-rust">
<span className="text-accent-sage-dark">  // higher contrast on light bg

// Borders
<div className="border-accent-violet/20">

// Hover
<button className="hover:bg-accent-rust/15">
```

### When to use `style=` vs `className=`

- **`className=`** — use for static Tailwind token classes (preferred)
- **`style={{ color: 'var(--accent-rust)' }}`** — use when the color is dynamic (e.g., computed from a variable at runtime). ~170 occurrences across 17 files use this pattern legitimately.

## Shared Constants (style-constants.ts)

Import from `@/lib/style-constants` instead of defining local color maps.

### Entity Types

```tsx
import { ENTITY_TYPE_STYLES, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/style-constants';

// Labels: { person: 'Person', place: 'Place', concept: 'Concept' }
<span>{ENTITY_TYPE_LABELS[entity.type as EntityType]}</span>

// Badge (bg tint + text color)
<span className={ENTITY_TYPE_STYLES[type].badge}>Person</span>

// Badge with border
<span className={`${ENTITY_TYPE_STYLES[type].badgeBordered} border`}>Place</span>

// Icon color only
<Icon className={ENTITY_TYPE_STYLES[type].iconColor} />

// Hover on pills/links
<a className={ENTITY_TYPE_STYLES[type].pillHover}>...</a>
```

Color mapping: **person → rust**, **place → sage**, **concept → violet**.

### Search Index Types

Extends entity types with `quote`, `vocabulary`, `keyword`:

```tsx
import { SEARCH_TYPE_STYLES, type SearchIndexType } from '@/lib/style-constants';

<span className={SEARCH_TYPE_STYLES[result.type as SearchIndexType].badge}>
```

### Annotation Types

Six annotation types with badge styles:

```tsx
import { ANNOTATION_TYPE_STYLES, type AnnotationType } from '@/lib/style-constants';

// Returns className string like 'bg-accent-gold/15 text-accent-gold-dark'
<span className={ANNOTATION_TYPE_STYLES[annotation.type as AnnotationType]}>
```

| Type | Colors |
|------|--------|
| comment | stone |
| context | gold |
| reference | violet |
| correction | rust |
| etymology | sage |
| question | gold |

### Processing Actions

For `ProcessingPanel` and `JobStatusBanner`:

```tsx
import {
  PROCESSING_ACTION_LABELS,
  PROCESSING_ACTION_CSS_COLORS,
  type ProcessingAction,
} from '@/lib/style-constants';

// Labels: { ocr: 'OCR', translation: 'Translation', ... }
// CSS colors (for style=): { ocr: 'var(--accent-sage)', ... }
<div style={{ backgroundColor: PROCESSING_ACTION_CSS_COLORS[action] }}>
  {PROCESSING_ACTION_LABELS[action]}
</div>
```

| Action | Color |
|--------|-------|
| ocr | sage |
| translation | rust |
| summary | violet |
| image_extraction | gold |

### History Events

For `BookHistory` timeline:

```tsx
import {
  HISTORY_EVENT_LABELS,
  HISTORY_EVENT_CSS_COLORS,
  type HistoryEventType,
} from '@/lib/style-constants';
```

Superset of processing actions plus `imported` (stone), `archived` (warning), `index` (gold), `edition_published` (sage), `admin_action` (error).

### Note Tag Styles

For `NotesRenderer` inline XML annotations:

```tsx
import { NOTE_TAG_STYLES } from '@/lib/style-constants';

<span className={`${NOTE_TAG_STYLES.term} px-1.5 py-0.5 rounded text-sm`}>
```

| Tag | Style |
|-----|-------|
| term | violet tint |
| margin | sage with left border |
| gloss | violet tint |
| insert | sage tint |
| note | gold |
| pageType | gold |
| blockquote | rust border + tint |
| keywords | violet text |

## What NOT to Change

- **`var(--accent-*)` in `style=` attributes** — ~170 occurrences across 17 files. These use CSS variables correctly for dynamic coloring. Leave as-is.
- **OG image files** — Satori (OG image generator) doesn't support CSS variables or Tailwind. Raw hex values are required.
- **Brand/mockups pages** — hex values are documentation content, not styling.
