# Article EPUB v2: plan

Derek's review of v1 (2026-11-12, on Apple Books): main text good; too much italic and hard-to-read small
text; the headings look like a sans-serif; links show blue; it should open with Source Library's purpose,
not "About this edition"; give a TL;DR and a summary; add printer's ornaments, flourishes and diagrams in a
Renaissance manner. Goal: a book you look forward to opening, still honest to the sources.

## Principles
1. **One face, one accent.** EB Garamond throughout, headings included. Oxblood `#9e4a3a` (the site's
   accent-rust) for headings and links, gold `#9e7c3c`/`#c9a86c` for rules and ornaments. Nothing else coloured.
2. **Italic is for titles only.** Book titles and foreign words. Captions, subtitles and notes are roman,
   one size step down. No small italic text anywhere.
3. **Ornament from the books themselves.** Initials, headpieces and tailpieces are real woodcuts from the
   library's gallery (3,294 `decorative` crops at quality ≥ 0.6, many historiated initials), not generated
   imitations. Generated only what no book supplies: the printer's device and the diagrams.
4. **Every page earns its place.** Open with why, then the gist, then the essay, then the sources.

## Book order
1. **Cover** (full page, as now).
2. **Title page**, with the logo (as now), subtitle roman not italic.
3. **Source Library** (one page, replaces "About this edition"): the purpose in ~120 words, drawn from the
   About page ("We translate the books that were left behind"): the untranslated majority of what was
   written before 1800, the Embassy of the Free Mind, read the originals beside an honest translation.
   Then one line on this book: an essay and every page it cites, with the scans. *Copy needs Derek's OK
   once; then it is shared by every article EPUB.*
4. **In brief**: a 2–3 sentence TL;DR in larger type, a one-paragraph summary, then each chapter as a
   one-line "what you'll find" with its link. Drafted per article (LLM), stored in `briefs.json`, reviewed by
   eye before build. Facts only from the essay.
5. **Contents.**
6. **The essay**, chapters as now, each opening with: headpiece ornament → chapter numeral → heading →
   chosen picture → a historiated woodcut initial of the right letter as the drop cap → text. Tailpiece
   ornament at the end of each chapter.
7. **Diagrams where the essay needs them** (generated SVG, rendered to PNG for Kindle):
   - Sea Road: a route map, Guangzhou → Quanzhou → Champa → Malacca → Quilon/Calicut → Muscat → Siraf/Hormuz →
     Basra, in an engraved-map style (hatched sea, cartouche title, compass rose).
   - Hyperborea: the timeline the web article already has (`HyperboreaTimeline`), redrawn as a plate.
8. **The Sources**, book by book (as now), each book opening with its own frontispiece/title-page crop when
   the gallery has one, and a small fleuron between pages.
9. **Colophon** with a **printer's device**: the Source Library rings inside a Renaissance cartouche or
   anchor-and-dolphin style frame (generated SVG, one design, reused), set like an Aldine colophon:
   "Printed for the reader by Source Library, Amsterdam, MMXXVI."

## Work
1. **Typography fixes (small, first).**
   - Headings: set `font-family` explicitly on h1–h3 and the title page; replace variable-weight `font-weight:
     500` with 400 (the woff2 subset may lack the axis, and Books falls back). Check Apple Books
     "Original fonts", and add the `ibooks:specified-fonts` meta in the OPF as well as the display-options file.
   - Links: oxblood with `-webkit-text-fill-color` too and `color` on `a:link, a:visited`; Apple Books paints
     links blue when only `a` is styled. Test in Books light, sepia and night themes.
   - Italic audit: captions, subtitle, intro, "This page online", "In Source Library's English translation" →
     roman. Raise the smallest size from 0.8em to 0.9em.
2. **Ornament library** (`ornaments.mjs`): query `gallery_images` `type: 'decorative'`, books with
   `imageAccessFor` 'open'; classify by description into initials (by letter), headpieces (wide), tailpieces
   and fleurons (small); crop with pictures.ts, clean to 1-bit for e-ink, keep a sepia tint for colour. Pick
   by eye a house set (one headpiece, one tailpiece, initials A–Z) so every book looks of a piece; store in
   `ornaments.json`. Credit them in the colophon ("Ornaments from …").
3. **Front matter**: `purpose.html` (shared copy) and `briefs.json` (per article), with an LLM draft step
   that writes the brief from the rendered essay and stops for review.
4. **Diagrams**: `diagrams/<slug>.ts` returning SVG, rasterised by sharp at 1600 px; placed by chapter
   heading like openers.json.
5. **Printer's device**: one SVG in `ornaments/device.svg`, drawn once and checked by eye.
6. **Proofing loop**: render every XHTML page in headless Chromium at phone and Kindle sizes into a contact
   sheet; run epubcheck; send Kindle through Send-to-Kindle once to see what KF8 drops (no JS anyway).
7. **Rebuild both articles**, colour and e-ink; point posts.ts at them; one PR.

## Later (Apple Books only, if wanted)
Pop-up glosses (epub:type noteref, works on Kindle too), an original ↔ translation toggle on each source page
(JavaScript), and a tappable route map. Kindle keeps the static edition.

## Needs Derek
- The Source Library purpose text (once).
- Approve the house ornament set and the printer's device design (contact sheet).
