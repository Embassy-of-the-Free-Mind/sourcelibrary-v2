# Leaf check by eye — #5924 (Latin print, round 4 of the #5660 OCR bake-off)

You are checking REFERENCE windows against PAGE IMAGES. Each book in your batch file has a run of 3 consecutive
pages. For every page there is a JPEG (`image`) and, usually, a reference text (`ref`: a window cut from an
independent same-edition e-text — CAMENA, EEBO-TCP or la.wikisource — located with a Tesseract probe). Some
pages have `ref: null` (no window was located).

Open EVERY image with the Read tool (actually look at it — this is a by-eye check; record method
"read-from-image"). Read the ref file. Do NOT run any OCR engine, do NOT edit any reference text, do NOT write
anywhere except your output file.

For each page decide `verdict`:
- `ok` — the reference window IS this page's body text: its first and last lines match the first and last lines of
  the printed body within about one line (the window builder pads 3 words at each end, so a few words of the
  neighbouring page at the very start/end are acceptable). Running heads, signatures, catchwords, page numbers and
  marginal notes may be missing from the reference — that is fine. The text must be the same words in the same
  order (spelling and abbreviation conventions may differ: the e-text may expand abbreviations or normalise u/v,
  ſ, æ — that is fine).
- `window-off` — the reference is from this book but starts or ends more than about one line away from the page body
  (it misses a substantial part of the page, or contains a substantial part of another page).
- `mismatch` — the reference is not this page's text at all (different passage / different work).
- `no-text` — the page has no letterpress text to read: blank page, endpaper, a plate/illustration without printed
  text, a colour bar/scanner target only. (A plate WITH a printed caption is not no-text.) Use this whether or not a
  ref exists.
- `no-ref` — a text page with `ref: null` (or whose text is outside the e-text, e.g. an index or a preface the
  e-text omits). Describe what is on it in `note`.
- `edition-differs` — the words are the same passage but the e-text is clearly a DIFFERENT EDITION (different
  line content beyond normalisation, added/missing sentences, different orthography throughout).

Also record for each page:
- `page_type`: body | title | front-matter | index | plate | blank | other
- `typeface`: roman | italic | gothic (blackletter/rotunda/textura/Schwabacher/Fraktur) | mixed | none
- `leaf_language`: the language of most text on the leaf (lat, grc, deu, …; `mixed` if no majority)
- `scan`: good | fair | poor (show-through, blur, skew, cropped text, microfilm noise)
- `note`: one short sentence of what you saw (e.g. "ref starts 2 lines early (last lines of p.71)", "marginal notes
  not in ref", "plate: woodcut of a furnace, no caption").

Output: write a JSON file (path given in your task) with
`{ "rows": [ { "book_id", "page", "slug", "verdict", "page_type", "typeface", "leaf_language", "scan", "note",
"checker": "claude-subagent (<your batch name>)", "at": "<ISO time>", "method": "read-from-image" } ] }`
one row per page, every page in your batch. Then reply with a 5-line summary: counts per verdict and anything odd.
