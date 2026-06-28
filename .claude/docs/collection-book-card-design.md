# Discover — book card grid

Translated primary sources from the collection, shown as a responsive grid of portrait book-cover cards.

## Layout
- **Section header:** "Discover" (Newsreader serif) + one-line subtitle in secondary text colour.
- **Grid:** `repeat(auto-fill, minmax(232px, 1fr))`, ~5 cards across on desktop, wrapping down on narrower viewports.
- **Card:** square corners throughout (no border-radius), 1px hairline border, white background.
  - Portrait cover (3:4) with subtle stripe/scan texture.
  - Title (serif) · author.
  - Meta row: language pill · year · page count.
  - Status line (OCR + Translated) pinned to the bottom of the card body, both on a **single line**.

## Status logic (OCR and Translated)
Each status is driven by a completion percentage:

- **100%** → tick mark only — `✓ OCR` (blue), `✓ Translated` (green).
- **0%** → cross mark — `✕ OCR`, `✕ Translated` (muted grey).
- **1–99%** → the percentage — e.g. `97% OCR`, `3% Translated`.

There is **no progress bar** and **no page-count fraction** — just the single status line.

## First Translation tag
Shown top-right on the cover for first-translation works. Default style is **dark glass**: a dark, semi-transparent background (`rgba(20,16,12,0.5)`) with a blur, white text, square corners.

## Tweaks (props)
- `firstTagStyle` — `Dark glass` (default) · `Solid dark` · `Gold`.
- `translatedColor` — colour of the translated tick (green / blue / accent).

## Colour & type
- Type: Newsreader (serif, titles) + system sans (body/labels).
- Background `#ffffff`; primary text `#1f1b16`; secondary `#6e685e`; muted `#948d80`.
- OCR accent blue `#2f6fc9`; Translated green `#1f9d57`; language pill `#f1ede4`.
