# Step T reader task (blind, three transcriptions), #7568 correct-or-re-read beyond Latin

PRIOR ART: `C-TASK.md` here (the #5924 Step C task: verdict, defect and preference definitions, kept verbatim
below). Step C showed two transcriptions; Step T shows three of the same page, so one reader judges every arm under
the same conditions, and gives the three pairwise preferences.

You are a careful reader of `<LANGUAGE>` printed books. You judge, page by page, three transcriptions of the SAME page,
labelled X, Y and Z, against the page image. You do not know where any of them came from; do not guess. Two of them
may be identical; judge each on its own.

## Input
`<IN>` (a JSON file): the book, `lang_note` (conventions for this language, below), and per page `slug`,
`page_number`, `img` (≤ 2000 px), `full_img` (full resolution), and `X`, `Y`, `Z` (paths to the three transcriptions).
Open the image and all three transcriptions for every page.
To zoom: `node scripts/eval/flash-reread-5924/crop.mjs <full_img> <x0> <y0> <x1> <y1> <out.jpg>` (fractions 0–1 of
width and height), writing the crop under `$JOB_SCRATCH/crops/`. Zoom whenever a word is in doubt: numbers, short
words, abbreviations, marginal notes, small characters. Metadata tags (`<header>`, `<page-num>`, `<margin>`, `<vocab>` …)
are part of a transcription; judge them, but layout and tag differences alone are minor.

## Per transcription: a verdict
- **misleading** — a reader is misled about what the page says: a meaning change (a wrong word, number, name or
  negation that changes the sense), an omitted passage (a line or more of the page's text missing), or another leaf's
  text served as this one's.
- **flawed** — errors, but the gist is right: spelling, single letters, punctuation, normalisation that does not
  change the sense.
- **sound** — faithful to the page.
With the verdict, list the defects: class (`.claude/docs/page-error-taxonomy.md`, e.g. O5 omission, O6 meaning-changing
misread, O7 numerals, O8 normalisation, O11 furniture, O12 marginalia, I4 neighbour strip), the words as transcribed
(`quote`), what the print has (`print`), and `material` (true when it changes or drops meaning).

## Per page: three preferences
For each pair (X vs Y, X vs Z, Y vs Z): which is better, or tie, and whether the loser's defect is **material** (it
changes or drops meaning the other read gets right) or minor (spelling, punctuation, tags, layout).
Also: `not_this_leaf` per transcription (another leaf's text, not a misread); `facing_strip_visible` (a strip of the
facing page shows at the image's edge) and `strip_in` per transcription (that strip's partial words transcribed as content).

## Output
Write `<OUT>`: a JSON array, one object per page, in input order:
```
{"slug": "...",
 "X": {"verdict": "misleading|flawed|sound", "defects": [{"class": "O6", "quote": "...", "print": "...", "material": true}], "not_this_leaf": false, "strip_in": false},
 "Y": {...}, "Z": {...},
 "XY": {"prefer": "X|Y|tie", "loser_material": false}, "XZ": {"prefer": "X|Z|tie", "loser_material": false}, "YZ": {"prefer": "Y|Z|tie", "loser_material": false},
 "why": "<one or two lines, quoting the decisive words>", "facing_strip_visible": false}
```
Judge every page. Write the file even if a page is hard; say so in `why`. Do not read any other file in the job
directory, any key, or any other reader's output.

## lang_note per language (given in the packet)
- **zh** — Classical/literary Chinese, usually vertical columns read top to bottom, right to left. A traditional ↔
  simplified or variant-form (異體字) substitution of the SAME character is O8 (minor). Added modern punctuation is minor.
  A different character that changes the word, a dropped or doubled column, or columns read out of order so the text
  runs in the wrong sequence, is material. Interlinear small-character commentary (雙行小注) dropped is an omission.
- **de** — German, often Fraktur. ſ/s, long-s, ä/aͤ, ů, v/u, j/i, and spelling normalisation are minor unless they
  produce a different word. Latin passages in Antiqua inside a German page are part of the page.
- **el** — Greek print (polytonic). Accent, breathing or iota-subscript errors are minor unless they make a different
  word; ligatures and abbreviations expanded correctly are fine. Latin translation columns or notes beside the Greek
  are part of the page.
- **sa** — Sanskrit, Devanagari (or another Indic script). A wrong akṣara or conjunct that makes a different word, or a
  dropped pāda/line, is material; virāma or anusvāra/nasal-consonant variants that do not change the word are minor.
- **ar** — Arabic script. A wrong letter or dot that makes a different word is material; missing or added ḥarakāt
  (vowel marks), hamza seat and tāʾ marbūṭa/hāʾ variants are minor unless they change the word.
