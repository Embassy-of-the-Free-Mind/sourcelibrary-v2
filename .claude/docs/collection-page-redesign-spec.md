# Source Library — Collection Page Template Redesign (build spec)

Handoff for Claude Code. Re-architecture of the **collection page template**, worked example = **Mycology & Fungi**. The same skeleton applies to every collection; only content changes per collection.

A clickable HTML mock of the target exists (`Collection Page.dc.html`) — refer to it for layout and behaviour. This document is the source of truth for **what** to build; the mock's literal CSS values are placeholders.

---

## 0. Hard constraints (read first)

- **Introduce NO new design primitives.** No new typefaces, font sizes/weights, colours, border radii, shadow values, or container/padding/spacing scales. Every visual value must resolve to an **existing Source Library token / Tailwind config / component variant**. The mock hard-codes hex/px values only because it has no access to the token layer — **do not copy those literals**; map each to its existing equivalent.
  - Type → existing serif (collection title / section headings / book titles / body prose) + existing sans (nav, authors, meta, badges, buttons). Same weights and the same size ramp already in use.
  - Colour → existing palette only. Warm paper backgrounds, the two existing band tones, the dark footer/quote tone, primary/secondary/muted text tokens, and the existing rust accent. The status badges reuse existing tones (see §8) — no new badge colours.
  - Spacing → existing container max-width, gutter, and section-rhythm tokens. Do not invent new clamp() ramps; use whatever responsive spacing scale the codebase already defines.
- **Server-rendered.** Keep the page SSR for SEO/AI crawlers. Interactivity (slider, popovers, dropdowns) hydrates on top.
- **Bounded preview + handoff.** The page is a curated landing page. The full catalogue lives on a separate paginated `/browse` page (separate task). No infinite scroll here.
- **Anchor row is not sticky.**

---

## 1. Navbar — variant of the existing global component

**Do not build a new navbar.** Use the existing global navbar component. Add a **semi-transparent, blurred, dark-tinted variant** by extending the component's existing style props/variants — not by forking it.

- Variant behaviour: `position: absolute`, overlaying the top of the hero (not in document flow, not sticky), full-bleed width.
- Background: **dark tint** of an existing dark surface token at reduced opacity (~0.5) + `backdrop-filter: blur` + saturate. Hairline bottom border from an existing light divider token at low opacity.
- Because it sits over the dark hero, the variant renders the logo + links in the existing **light/inverted** text token (the same one the footer already uses on dark). No new colours.
- The hero section must reserve top padding equal to navbar height so the breadcrumb/title clear it.
- Mobile: the navbar's existing condensed/hamburger behaviour. The menu dropdown reuses existing menu/popover styles.

Expose the variant as a prop on the global component (e.g. `variant="overlay-dark"` / `transparent` + `overBlur`), so other pages can reuse it.

---

## 2. Page structure (in this order)

1. Navbar (overlay variant, §1)
2. Header / hero (§3)
3. "On this page" anchor row + Share/Embed actions (§4)
4. Introduction (§5)
5. Featured work (§6)
6. First translations — slider (§7)
7. Illustrations — masonry (§8)
8. Works in this collection — bounded grid + handoff (§9)
9. Quote band (§10)
10. Get involved (§11)
11. Footer (existing global component, unchanged)

Add `id`s for anchors: `#introduction`, `#featured`, `#translations`, `#illustrations`, `#works`, `#involved`.

---

## 3. Header / hero

- Full-bleed, dark surface. Background = a **collage grid of real collection imagery** (book covers, plates, pages) — 7 columns × **3 rows**, tiles filling the band, clipped. Darkened with a left-to-right gradient (existing dark surface token) so the heading stays legible; bottom fade into the page.
- Foreground (left-aligned): breadcrumb/category label ("← Medicine & Natural History"), collection title (existing display serif), one-line tagline (existing sans/secondary), and a **stat line of pills**: total works · N first translations · date range · **full language list** (show every language — it's a feature). Pills use an existing chip/outline style; size steps down on mobile via the existing responsive type scale.
- Height: **60vh on desktop and tablet, 40vh on mobile** (use `min-height` so content can grow). (Tablet = 60vh.)

---

## 4. "On this page" anchor row + actions

A thin, **non-sticky** bar bracketed by hairline rules (existing divider token), directly under the hero. Deletable as a single unit without breaking the page.

- **Left — jump links:** `On this page` label + real `<a href="#…">` anchors to each section: Introduction · Featured · First translations · Illustrations · Works · Get involved. Smooth-scroll on click.
  - **Wrap-aware collapse:** if the inline links would occupy **more than one line** (measure available width vs. intrinsic link width, recompute on resize), replace them with a single **"Jump to ▾" dropdown** containing the same anchors. Inline on wide desktop; dropdown on tablet/mobile/narrow.
- **Right — Share & Embed** (moved here so they never overlap hero text): two neutral buttons matching the existing secondary/ghost button style.
  - **Share** opens a popover: copy-link field + copy button + share targets (X / Bluesky / Email).
  - **Embed** opens a popover: section selector (Whole collection / First translations / Works grid) + a read-only `<iframe>` embed snippet. Embed targets a section of the page.
  - Popovers reuse existing popover/card styling.

---

## 5. Introduction

Combined intro/"why this matters", directly below the anchor row. Replaces the old overlapping "essential/important/notable" prose.

- Two-column on **desktop and tablet** (prose left, media right); stacks on mobile.
- Three short paragraphs (existing body serif): (1) orientation/arc — slightly emphasised in the near-primary text token; (2) why it matters — the foundational texts are untranslated — secondary token; (3) what Source Library adds — scans + first translations — secondary token. Inline work titles use the existing rust accent in italic.
- Right column: a **portrait video placeholder** at social-portrait ratio (9:16) with a play affordance and short caption ("Watch · N min"). Wire to the real walkthrough video when available.

---

## 6. Featured work

One spotlighted work per collection. Existing card surface (one open card; **no inner boxed/tinted panel** around the cover).

- Two-column on desktop and tablet; stacks on mobile.
- Left: the work's **cover** (existing book-cover treatment, soft shadow) + a small **strip of in-book plate thumbnails** + caption ("N of M plates"). Clean — cover and thumbnails sit directly on the card, no surrounding chrome.
- Right: status badge + language, title (serif), author·dates, meta pills (volumes / plates / format), 1–2 description paragraphs, a short **pull-quote** (label it a **curator's note** — do not fabricate a historical quotation), and actions ("Read in full" primary, "Browse all N plates" link).

Mycology example: *Histoire des Champignons de la France*, Pierre Bulliard, 1780–1791.

---

## 7. First translations — slider

- Heading + count ("N titles") + one-line subtitle.
- Portrait book-cover cards, each with a **"First translation"** status badge, language tag, cover, title, author·date. Reuse the existing book card.
- **Cards per view:** 5 (desktop) / **3 (tablet)** / ~1.5 (mobile). Card width computed so exactly that many fit with even gaps; recompute on resize.
- **Arrows advance one item at a time** (not a page). Arrows dim/disable at the start/end. Show a "1–N of TOTAL" position readout.
- **Mobile:** native horizontal scroll-snap (~1.5 cards); arrows hidden.
- **A11y:** advancing moves keyboard focus to the newly revealed card; arrows have aria-labels. Arrow buttons use the existing neutral button style.

---

## 8. Illustrations — masonry

- Heading + a **"View all N →" link to the right of the heading** (no separate boxed "view all" tile) + one-line subtitle.
- **Masonry** layout (CSS columns, varied tile heights) at **5 / 4-or-3 / 3 columns** for desktop / tablet / mobile. Mobile = 3 columns. Tablet = 3.
- Tiles are portrait plate thumbnails using the existing gallery thumbnail styling; last-tile "+more" affordance is **not** needed (the heading link covers it).

---

## 9. Works in this collection — bounded grid + handoff

- Heading + a **"Browse all N →" link to the right of the heading** (mirrors Illustrations). Count shown in the subtitle ("Showing X of N · original source texts first — translations are in the slider above").
- **Capped preview — must NOT grow to thousands.** Show **2 rows**: desktop 5×2 = 10, **tablet 3×2 = 6**. Order **source-texts-first** (translations already have their slider, avoid duplicating them here).
- **Mobile:** render Works as a **1.5-card horizontal scroll-snap slider** (same pattern as First translations), not a grid.
- Each card: status badge ("Source text" / "First translation"), language tag, title, author·date — existing book card.
- Below the grid, a **handoff card**: "N more works in mycology" + primary button **"Browse all N →"** that is a real crawlable `<a href="/browse?collection=mycology">` (not a JS-only button).

---

## 10. Quote band

A dark full-bleed band between Works and Get involved.

- **Quote text must be sourced from within the collection** — a real (translated) passage from one of the collection's works, with correct attribution (work, author, year). Do **not** use an invented or external quotation.
- **Background = a real image from the collection** (a hand-coloured plate / illustration), **image only — no text or title pages**. Pick an illustration plate, not a printed page. Darken it with the existing dark overlay token so the quote stays legible. No generated gradients standing in for imagery.

---

## 11. Get involved

Heading + subtitle + three cards (existing card surface), reflowing 3→2→1 columns by width:

- **Leave feedback** — report errors / missing editions / better translations → "Send feedback →" link.
- **Become a curator** — help select, sequence, annotate → "Apply to curate →" link.
- **Become a patron** — fund scans + first translations → primary "Become a patron →" button (existing primary/rust button).

Each card has a small mono/uppercase kicker label using an existing muted token.

---

## 12. Status badges (replace essential/important/notable entirely)

Two states, mapped to **existing** palette tones — no new colours:

- **First translation** — works Source Library has translated → existing positive/highlight tone (the rust-on-rose pairing already in the system).
- **Source text** — original-language scans only → existing neutral tone (muted text on a light neutral chip).
- (Optional third: **Partial translation**, if needed — map to an existing tone.)

Badge is also a **filter axis**; curation (the ordered reading path / featured + first-translations) is the second axis. These two axes replace the old subjective sections.

---

## 13. Responsive summary

| Element | Desktop | Tablet | Mobile |
|---|---|---|---|
| Navbar | overlay variant, full links | overlay variant, full links | overlay variant, hamburger |
| Hero height | 60vh | 60vh | 40vh |
| Jump links | inline (collapse to dropdown if >1 line) | dropdown | dropdown |
| Intro / Featured | 2-col | 2-col | stacked |
| First translations | 5-up slider | 3-up slider | 1.5 scroll-snap |
| Illustrations masonry | 5 col | 3 col | 3 col |
| Works | grid 5×2 (10) | grid 3×2 (6) | 1.5 scroll-snap |

(Breakpoints in the mock: mobile < 720, tablet < 1024, desktop ≥ 1024 for grids; navbar condenses < 800. Align these to the codebase's existing breakpoints rather than introducing new ones.)

---

## 14. Per-collection data (template inputs)

The template is content-driven. Each collection supplies:

- category label, title, tagline, stat line (total, # first translations, date range, languages[])
- intro paragraphs (3), walkthrough video
- featured work (id + curator note + selected plate thumbnails)
- first-translations list, illustrations list (+ total counts for "view all")
- works list (source-first), total works count (drives "Browse all N")
- quote (passage + attribution) and the chosen background plate image — both from within the collection

---

## 15. Out of scope

- The `/browse` page (separate task) — only the crawlable handoff link is included here.
- Real imagery: the mock uses placeholders; production pulls real cover/plate/page scans from the collection.
