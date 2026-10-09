# By-eye read of population runs — #5924 (Latin OCR bake-off, round 4)

Each run in your batch file is 3 consecutive pages of a random book from our Latin OCR backlog. For every page there
is the JPEG (`image`) and the plain-text output of up to six OCR engines (`outputs`: engine → file):
`gemini-3.1-flash-lite` (production), `gemini-3-flash-preview`, `gemini-3.8-flash`, `glm-ocr` (open 0.9B model on our
GPU), `calamari-gt4histocr-bin` (Kraken lines + Calamari), and on a few pages `gemini-3.1-pro-preview`.

Open EVERY image with the Read tool and read the outputs against it (this is a by-eye check; label every claim
`read-from-image`). No reference text exists. Do not run any OCR, do not write anywhere except your output file.

For each RUN record:
- `page_kinds`: per page — body | title | front-matter | index | plate | blank | other; and `typeface` (roman | italic |
  gothic | mixed | none), `scan` (good | fair | poor), `layout` (single | two-column | marginalia-heavy | table | verse | other),
  `leaf_language` (lat | mixed | other code).
- `best`: the engine whose text is closest to the printed page across the run (or `tie: a, b`), and `worst`.
- `failures`: per engine, any of: invented text (text not on the page, incl. on blank pages; show-through counted
  separately as `show-through-read`), loop/repetition, truncation (stops before the page ends), omission of a block,
  wrong reading order / column splice, long-s read as f (count roughly: none / few / many), abbreviations dropped or
  mangled (e.g. macrons → umlauts), Greek/Hebrew replaced or dropped, text pulled from a neighbouring page, a page's
  text duplicated across the boundary.
- `note`: 1–3 sentences with concrete examples (quote the engine's wrong words and what the page prints).

Output JSON: `{ "runs": [ { "book_id", "stratum", "pages": [...per-page labels...], "best", "worst",
"failures": { engine: [..] }, "note", "method": "read-from-image", "checker": "claude-subagent (<batch>)" } ] }`.
Then reply with a short summary: which engine read best overall in your batch, and the most important failure seen.
