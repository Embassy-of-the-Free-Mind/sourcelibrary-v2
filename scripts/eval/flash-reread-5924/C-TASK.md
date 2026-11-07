# Step C reader task (blind pairwise), #5924 Flash re-read test and its added arms

PRIOR ART: the original `VERDICTS.md` / `C-TASK.md` of jobs `flash-reread-test-5924` and `opus-correct-latin-5924`
lived in their job scratch on l7a and were never committed. This file is rebuilt on 2026-10-24 for the Flash-correction
arm from `PREREGISTRATION.md` (verdict and preference definitions, verbatim below) and the fields `score.mjs` /
`oc-score.mjs` read from each reader's output. It is committed so the next arm reuses the same words.

You are a careful reader of early modern printed Latin. You judge, page by page, two transcriptions of the SAME
page, labelled X and Y, against the page image. You do not know where either came from; do not guess.

## Input
`<IN>` (a JSON file): the book, and per page `slug`, `page_number`, `img` (≤ 2000 px), `full_img` (full resolution),
`X` and `Y` (paths to the two transcriptions). Open the image and both transcriptions for every page.
To zoom: `node scripts/eval/flash-reread-5924/crop.mjs <full_img> <x0> <y0> <x1> <y1> <out.jpg>` (fractions 0–1 of
width and height), writing the crop under `$JOB_SCRATCH/crops/`. Zoom whenever a word is in doubt: numbers, short
words, abbreviations, marginal notes. Metadata tags (`<header>`, `<page-num>`, `<margin>`, `<vocab>` …) are part of a
transcription; judge them, but layout and tag differences alone are minor.

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

## Per page: a preference
X better / Y better / tie, and whether the loser's defect is **material** (it changes or drops meaning the other read
gets right) or minor (spelling, punctuation, tags, layout).
Also: `not_this_leaf_X` / `not_this_leaf_Y` (the transcription is another leaf's text, not a misread);
`facing_strip_visible` (a strip of the facing page shows at the image's edge) and `strip_in_X` / `strip_in_Y` (that
strip's partial words were transcribed as content).

## Output
Write `<OUT>`: a JSON array, one object per page, in input order:
```
{"slug": "...", "X": {"verdict": "misleading|flawed|sound", "defects": [{"class": "O6", "quote": "...", "print": "...", "material": true}]},
 "Y": {...}, "prefer": "X|Y|tie", "loser_material": false, "why": "<one line, quoting the decisive words>",
 "not_this_leaf_X": false, "not_this_leaf_Y": false, "facing_strip_visible": false, "strip_in_X": false, "strip_in_Y": false}
```
Judge every page. Write the file even if a page is hard; say so in `why`. Do not read any other file in the job
directory, any key, or any other reader's output.
