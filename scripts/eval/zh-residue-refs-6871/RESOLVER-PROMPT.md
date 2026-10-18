# Resolver brief (pass C)

Two readers, X and Y, independently transcribed the same Siku Quanshu page from its image under the convention in
`READER-PROMPT.md` (read it first; it is binding, with the three additions below). Their reads disagree. You are the
third reader: produce the **final reference** by deciding every disagreement **from the image**, not by preferring
either reader and not from memory of the text. You may also correct places where X and Y agree but the image shows
both are wrong; record those too.

For each page id: open `$PAIRS/<id>.json` (the two reads), then the images in `$IMG` (`<id>_full.jpg`, halves
`_R`/`_L`, quarters `_R1 _R2 _L1 _L2`). Look at every disputed spot in the crop where it is largest.

## Additions to the convention (apply them even where X and Y did not)
1. **`▣`** = a glyph that is clearly visible and identifiable in shape but has no Unicode character you can name
   with confidence (qin/se tablature composites, a rare character whose code point you cannot confirm). Describe
   its components in `uncertain`. `□` stays for characters you cannot make out at all. If you CAN name the
   character (including CJK Extension B+), write it.
2. **Digits printed side by side inside a table cell**: write them in the order a reader of the table reads them
   (normally left to right as printed), and say so in `layout_note`.
3. **Tables**: keep the reading direction the page itself implies (by column for vertical tables, by row where the
   rows are clearly the unit, e.g. ephemeris tables whose column heads run across the top). State it.
4. **三合切音 / stacked phonetic composites** (two or three small characters fused into one block beside Manchu):
   write the component characters in order large then small (or top then bottom), no brackets.

## Output
Write `$OUT/<id>.json`:
```json
{"page_id":"<id>","page_kind":"…","layout":"…","layout_note":"…","text":"…","margin":"…","foreign":[…],
 "n_han":0,"confidence":0.0,"confidence_note":"…","uncertain":["…"],
 "resolutions":[{"where":"col N / cell …","X":"…","Y":"…","final":"…","basis":"image|convention|unresolvable"}],
 "unresolvable":0}
```
- List every substantive disagreement you settled in `resolutions` (merge long runs, e.g. a whole table read in a
  different order is ONE resolution with basis `convention`). `basis: unresolvable` = the image does not decide it
  at this resolution; then write your best reading in `text` and count it in `unresolvable` (characters).
- `confidence`: your honest estimate of the share of characters in the final `text` that are exactly right.

Reply with one line per page: `<id> resolutions=<n> unresolvable=<chars> conf=<c>`.
