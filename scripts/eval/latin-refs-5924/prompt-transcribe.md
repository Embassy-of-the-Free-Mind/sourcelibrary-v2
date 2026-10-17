# latin-refs-5924 — reader prompt, passes A and B (convention latin-refs-5924@1)

You are making a REFERENCE transcription of early-modern printed pages for an OCR benchmark. Accuracy to the
printed leaf is the only goal. You work alone: no other transcription of these pages exists for you, and you
must not look for one (no web, no database, no other files than the ones named below).

For each page slug listed in the task:
1. Open EVERY image in `{WORK}/img/<slug>/` with the Read tool: `0-full.jpg` (the whole leaf, for layout) and
   `1-band.jpg`, `2-band.jpg`, … (overlapping horizontal strips of the same leaf at higher resolution, top to
   bottom; overlaps repeat a few lines — transcribe each printed line once).
2. Decide whether the leaf is usable. REJECT it if it is: blank or nearly blank (fewer than 6 printed lines);
   a full-page illustration, map or plate; a title page; an index, register, errata list or a table of mostly
   numbers; mostly NOT Latin (Greek, Hebrew or a vernacular making up more than half the text); handwriting; or
   too damaged/blurred to read most words. A rejected page gets a file containing exactly one line:
   `REJECT <reason>`.
3. Otherwise transcribe it diplomatically to `{WORK}/pass/{PASS}/<slug>.txt` (Write tool), following the
   convention below exactly. Then write `{WORK}/pass/{PASS}/<slug>.meta.json`:
   `{"typeface": "roman|italic|gothic|mixed-roman-italic|mixed-gothic-roman", "gothic_kind": null|"textura"|"rotunda"|"schwabacher"|"fraktur",
     "layout": "single|two-column|commentary|verse|spread", "illegible_words": <n>, "greek_words": <n>, "notes": "<one line>"}`
   (for rejected pages: `{"reject": true, "reason": "..."}`).

## Convention latin-refs-5924@1 (diplomatic)
- Everything printed on the leaf, in reading order: running head (with its page/folio number) on the first
  line; then the text; then footnotes; then MARGINAL NOTES (side-notes), top to bottom, each printed line on its own
  line; then the signature mark and/or catchword at the foot, as printed, on the last line.
- One output line per printed line. Blank line between paragraphs/blocks. No markup of any kind (no italics,
  no headings, no brackets around marginalia, no commentary).
- Two columns: the whole left column, then the whole right column. A spread (two pages in one image): left page, then right page.
- Long s is `ſ` (U+017F); round s is `s`. Never modernise: keep u/v and i/j exactly as printed (`vt`, `iam`, `Vnde`).
- `æ` `œ` `Æ` `Œ` as single characters when printed as ligatures (and `ae`/`oe` when printed as two letters).
  Other ligatures (ct, st, ff, fi, ſſ, ſt, …) as their plain letters.
- Abbreviations exactly as printed, never expanded: a stroke over a letter → the letter + combining macron
  U+0304 (`ā`, `ē`, `ī`, `ō`, `ū`, `m̄`, `n̄`, `q̄`, `p̄`); a printed tilde → combining tilde U+0303 (`ã`, `õ`, `q̃`);
  `ꝑ` per/par, `ꝓ` pro, `ꝗ` quod/qui (q with stroke), `ꝯ` con/com, `ꝰ` superscript -us, `ꝫ` -et, `q;` and `b;` when printed with a
  semicolon-like mark, `&` for the ampersand, `⁊` for the Tironian et, `&c.` as printed.
- Accents as printed (`à`, `è`, `ò`, `ù`, `â`, `é`, `ę` e-caudata).
- Line-end hyphens of any shape (`-`, `=`, `⸗`) are written `-` at the end of the line; the word continues on the next line as printed.
- Punctuation as printed, including the virgule `/` (gothic comma), `:` and `.` positions; a raised point `·` as `.`.
- Text of a NEIGHBOURING leaf that shows at an edge of the image (a strip of the facing page, show-through from
  the verso) is omitted: transcribe only the leaf the image is of.
- Drop capitals: the initial is the first letter of its word, not a separate line. Ornaments, rules, fleurons and
  text inside illustrations are omitted.
- Greek and Hebrew as Greek/Hebrew letters (accents best effort). Numbers and Roman numerals as printed (`cap. iij.`, `MDCXX`).
- A word you cannot read because the leaf is damaged, blotted or cut off: `[?]` for that word (one per word). Do NOT
  use `[?]` for a word that is merely hard: look at the band image again and give your best reading.
- Small capitals are written as capitals. Superscript note markers (`a`, `b`, `2`, `*`) are written inline as plain
  characters where they stand. Response/versicle signs as `℟` / `℣`; the section sign as `§`. Precomposed or
  combining forms of the same mark are equivalent (the text is NFC-normalised afterwards).
- Do not correct the printer's errors: a misprint is transcribed as printed.

Work carefully line by line against the band images; the full view is only for layout. Before you finish each
page, re-check its first and last lines and every marginal note against the image.
When done with all pages, reply with one line per page: `<slug> ok|reject <lines> lines <typeface>`.
