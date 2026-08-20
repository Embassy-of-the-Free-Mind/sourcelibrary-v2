# Aldine Aetna — a facsimile type from the 1496 *De Aetna*

Output: `public/fonts/aldine-aetna/AldineAetna-Regular.{ttf,woff2}` (public domain, CC0).
Shown at https://sourcelibrary.org/specimen/aldine. Loaded in code via
`src/lib/fonts/aldine.ts` (next/font; zero cost on pages that don't import it).

This is a **facsimile**, not a revival: every glyph is one real impression from
Pietro Bembo, *De Aetna dialogus* (Venice: Aldus Manutius, Feb 1496), the roman cut
by Francesco Griffo — the ancestor of Bembo, Garamond and most roman text faces.
Source scan: our book `6a06d1f39a48d51399960d08` (BNCF copy, IA
`ita-bnc-ald-00000673-001`), fetched at full IIIF resolution (4959×6601, ≈100 px
per ascender) because the archived 2254-px copy is too soft to trace.

## Pipeline

Python 3 with numpy, scipy, Pillow, fontTools, brotli; `potrace` on PATH
(`brew install potrace`). Run from this directory; the scripts `chdir` to it.

1. `bash fetch_ia.sh` — pages n19…n51 (the main set); `bash fetch_more.sh` — twelve
   more into `extra/` (used for capitals; kept as a second set so the first set's
   cluster numbering stays stable).
2. `python3 segment.py 5.0` → `glyphs.npz`, `clusters.json`, `sheet_*.png`
   (`GLOB='extra/ia*.jpg' PREFIX=x_ python3 segment.py 5.0` for the second set).
   Otsu binarisation of the text block, line detection by projection, connected
   components merged when they overlap horizontally (i-dots, accents), then
   average-linkage clustering on 24×24 silhouettes + ascender/descender/aspect
   features. Deterministic for identical inputs.
3. Label. `labels.json` maps a character (or ligature glyph name like `c_t`) to
   candidate refs: `17` = cluster 17 of the main set, `x:124` = cluster 124 of the
   extra set, `x#2370` = glyph index 2370 directly. The first ref that resolves is
   used; the glyph is the cluster's **medoid** (most typical impression), so one
   blotchy sort never represents the letter. Helpers for deciding labels:
   - `show.py out.png 17 70 m:17` — medoids (or all members) at full size.
   - `capsheet.py out.png [x_]` — only ascender-height, non-descending glyphs, at
     ONE common scale. **Use this for capitals.** The main contact sheets scale
     every glyph to fit its cell, which makes a lowercase `c` look like `C`; that
     mistake was made here once and cost a round.
   - `context.py out.png [x_] 17 70` — each candidate boxed inside its word on the
     page. This is what settled f vs ſ (every "f-looking" cluster was ſ: *ſoleam*,
     *ſunt*, *ſpectu*; the real f had been absorbed into the ſ cluster and is
     referenced by glyph index).
4. `python3 build_font.py AldineAetna-Regular.ttf` — potrace each chosen mask
   (3× upscaled, black = ink; the first attempt traced the white background and
   produced letter-shaped holes in black boxes), map to font units, assemble with
   `fontTools.fontBuilder`, add a `liga` GSUB for the ligatures present.
   Metrics come from the page: **1 em = median baseline pitch** (165 px → the
   body of the type), x-height measured per line (406 units), and sidebearings =
   half the median gap between neighbouring sorts on a line (21 units).
5. `python3 specimen.py AldineAetna-Regular.ttf spec.png` — quick PIL render
   (no shaping engine, so ligatures don't fire there; they do in browsers).
   woff2: `TTFont(...).flavor='woff2'; save()`.

## Coverage (v0.3)

61 glyphs: a–y minus j k v w z (Aldus sets u for v), ſ, æ, &, the ligatures
ct ſt ſi ſſ ſſi fi ff and Qu (Griffo cast a fused Qu sort for the common case; `Q u` → `Q_u`
via `liga`; a lone Q exists too, from Lascaris), capitals
A B C D E F G H I L M N O P Q R S T V, and . , : ; - ( ) ?.
Third glyph set `y_` = 30 pages of the 1497 Aldines in the same fount
(`fetch_1497.sh`: IA 690/691/692 = Leoniceno, Maiolo ×2), segmented with
`NOCLUSTER=1` (52k glyphs; average-linkage on that many is O(n²) and unnecessary
when you are hunting a handful of capitals — `BOX=1 WMIN=25 capsheet.py` pages
through every cap-height glyph instead).
Fourth set `z_` = 12 pages of Lascaris, *Erotemata* (1495, IA `ita-bnc-ald-00000688-001`,
= book `69b220ccf79d8af0eab7fd3a`) — the Latin side of a Greek grammar, rich in I and Q. That scan
is smaller (4405 px wide), so **`set_scales.json`** carries a per-set multiplier
(z = 1.33, calibrated by matching capital heights: 76–83 px vs 102–108 px). Don't
derive this from the glyph-height histogram — fragment-heavy sets bias it badly.
IA dates `ita-bnc-ald-00000187-001` to 1497 but it is set in italic (later edition): skip.
Poliziano 1498 `A335128` is a 1081-px Sevilla scan — too soft to trace.
Absent: J U W (did not exist in 1490s roman type), K X Y Z and digits (not on the
60 pages read).
`src/lib/fonts/aldine.ts` stacks Cardo behind it for everything missing.

To extend: fetch more pages (the 1501 Virgil would give the first italic), run
`segment.py` into a new prefix, label with the helpers above, add refs to
`labels.json`, rebuild. Don't re-run `segment.py` over the main set with different
inputs — it renumbers the clusters `labels.json` points at.

Data files (`*.jpg`, `*.npz`, `*clusters.json`, sheets) are scratch and not
committed; `labels.json` plus the IA identifiers reproduce them.
