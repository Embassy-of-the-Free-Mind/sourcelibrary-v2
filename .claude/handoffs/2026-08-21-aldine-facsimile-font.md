# A font traced from our own scans, and books read in it — 2026-08-20/21

Derek asked for "a font based on the Aldine Press font." It ended as **Aldine Aetna**, a
public-domain facsimile of the roman Francesco Griffo cut for Aldus Manutius, traced
glyph by glyph from our own scans — plus fifteen early Aldines that now render their
transcription *and* their English translation in it.

Live: <https://sourcelibrary.org/specimen/aldine> ·
<https://sourcelibrary.org/book/de-aetna-dialogus-bembo/page/6a06d1f39a48d51399960d1c>

## Shipped (11 PRs, all merged)

| PR | What |
|----|------|
| #4081 | v0.1 — the font, the pipeline, the specimen page, Cardo helper |
| #4084 | v0.2 — `&`, `(`, the fused `Qu` sort, from the 1497 Aldines |
| #4085 | v0.3 — capital I and a lone Q from Lascaris 1495; per-set scale calibration |
| #4088 | v0.4 — 15 composed accents, `ę`, the `ſt` fix, f/ſ overhang kerning |
| #4091 | v0.5 — K X Y Z; full A–Z minus J U W |
| #4092 | v0.6 — figures 0–9 from the 1499 *Cornucopiae*; J U W reconstructed |
| #4096 | v0.7 — baseline anchoring, `calt` variation, real z, j k v w, J redesigned |
| #4097 | English pangrams + a `calt` on/off comparison on the specimen |
| #4099 | v0.8 — j, k and 9 rebuilt |
| #4100 | v0.9 — cleaner C and T impressions |
| #4135 | Reader pilot: *De Aetna* read in its own type |
| #4155 | Type toggle in the reader + all fifteen early Aldines |

**136 glyphs**, CC0/public domain. Everything is a real impression except eight
reconstructed sorts (J U W j k v w, and the 9), each flagged as such on the specimen page.

## Where things are

- `public/fonts/aldine-aetna/` — `.ttf`, `.woff2`, `LICENSE.txt`, `specimen.png`
- `scripts/fonts/aldine-aetna/` — the whole pipeline and its README, which is the real
  documentation: fetch → binarise → segment → cluster → label → potrace → fontTools
- `src/lib/fonts/aldine.ts` — `next/font` faces (facsimile + Cardo) and the stacks
- `src/lib/fonts/aldine-fount.ts` — book id → fount, and the deliberate exclusions
- `src/app/specimen/aldine/page.tsx` — the specimen
- `src/hooks/useReaderPreferences.ts` — `fount` preference beside size and theme
- `src/app/globals.css` — `.aldine-fount` rules, gated on `[data-reader-fount="original"]`

## What cost time, so it doesn't cost it again

**Use the OCR as an index for rare sorts.** Three blind sweeps failed to find K X Y Z.
`scripts/fonts/aldine-aetna/find_chars.mjs` greps `pages.ocr.data` of the fount-bearing
books for a letter and prints page numbers; fetch only those leaves. K was in *De Aetna*
all along ("Kalendis"); X Y Z were in Lascaris' Greek alphabet tables, where Aldus set the
Greek majuscules from the roman case. Same trick found the figures in the *Cornucopiae*
index and proved the negatives: every OCR "U"/"J"/"W" hit is a normalised V/I or a modern
cataloguer's note, and every digit hit outside that index is a folio label — the fount has
no arabic numerals.

**Never estimate a baseline you can derive.** Glyphs sat visibly off until the per-line
ink-projection estimate was replaced with facts: a glyph without a descender stands on its
own bottom edge (round letters overshoot 3 %); a descending glyph is anchored by its known
*top*. Only punctuation still uses the line estimate.

**Judge an impression in context, never on a contact sheet.** Sheets scale each glyph to
its cell, which made a lowercase `c` look like `C` and hid that every "f-shaped" cluster
was really ſ. `context.py` boxes a candidate inside its printed word; it settled f vs ſ,
the C and T swaps, and caught an `o` masquerading as a `6`.

**Ink weight varies by copy.** The Lascaris and the second De Aetna are inked harder than
the main scan; K and C needed a one-pixel erosion to sit at the same weight as their
neighbours. And after stripping a stray speck, re-crop — the anchoring uses the bounding
box, so a stripped speck left the T floating 70 px.

**Preview deployments 403 book content to anonymous visitors** (by design,
`alias-host-scope.ts`, documented in `invariants/crawler-access-gate.md`). Verify a reader
change against the CSS bundle on the preview, then against prod after merge.

**Don't reuse a feature branch after its PR was squash-merged** — the branch still carries
the pre-squash commit and every later PR from it conflicts. Cherry-pick onto a fresh
branch from `origin/main`.

## Deliberately not done

- **No ſ substitution.** The font has a real long s and a `hist`-style rule could swap it
  on screen, but the same panels render English ("ſo"), and silently changing letters in a
  citable transcription is a trap. If wanted, it belongs behind its own toggle beside TYPE.
- **The Hypnerotomachia** (4 copies) is Griffo's 1499 *recut* — the Poliphilus type. Close
  enough to fool a date-based guess, so it is excluded with the reason written down.
- **The Greek editions** are set in Aldus's Greek types; the facsimile has no Greek at all.
- **Firmicus 1499 and Ficino 1497**: plausible, but their scans would not pull at a
  resolution that settles the fount.

## Open threads

- **#4083** is delivered for these books; the ſ question above is what remains of it.
- **#4089** — `books.language` is a single string, so our two copies of the bilingual
  Lascaris disagree (Greek vs Latin). Proposal: `languages: string[]`, backfilled from the
  per-page `<language>` tags the OCR already carries.
- **#4090** — Cardo as the reading face for original-text panels and as the embedded font
  in PDF/EPUB exports (`src/lib/pdf-fonts.ts` currently bundles Noto Serif).
- **The 1501 Virgil italic** — the first italic ever cut, same pipeline, and we hold the
  octavos. The obvious sequel.
- **104 missing BNCF Aldines**, all 1501–99 (we hold 635 of 739). Id list:
  `~/sourcelibrary-ops/missing_bnc_ids.json`.
