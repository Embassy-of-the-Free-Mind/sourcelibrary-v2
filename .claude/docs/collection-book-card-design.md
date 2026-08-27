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

## The `catalog` variant (`/catalog` only)

`CollectionBookCard` takes `variant="catalog"`. Same component, same data, same
claim gates — a different reading of the same card, for a grid of sixty where
the default card's chrome competes with itself:

- **First Translation moves off the cover** and onto the status line, in gold,
  beside OCR and Translated. Same gate (`isPublishedFirstTranslation`), same
  words. A tag over the scan outranks the scan; on the status line it sits where
  the reader is already comparing what each book offers. The DOI tag stays on
  the cover — it is about the record, not the text.
- **Status line drops to micro type** (9px, uppercase, tracked) so all three
  items fit one line at desktop card width. They wrap, in that order, below it.
- **Hover lifts the card** (3px, a soft shadow, a slower 600ms cover zoom)
  instead of recolouring the title. Rust title-on-hover in a grid this size
  reads as sixty warnings. `animate-fade-in-up` is swapped for a plain opacity
  fade, because its `forwards` fill pins `transform` and would out-rank the
  hover lift.

Everything above this section still describes every other surface. If the
catalogue's reading wins, promote it — don't let the two drift by accident.
