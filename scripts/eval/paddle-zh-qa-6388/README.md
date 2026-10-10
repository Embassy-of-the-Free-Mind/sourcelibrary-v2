# #6388 Paddle zh lane: random-sample Opus + Gemini Pro QA

PRIOR ART: scripts/eval/ocr-prereg-6388/ (seeded one-page-per-work draw, committed before any engine ran) and
scripts/eval/ground-truth-5935/kanripo.mjs (Kanripo CER). Neither reviews the stored Paddle text against the image.

Committed **before any reviewer ran** (draw time 2026-10-10T17:26:26Z):

- `draw.json`: 60 books, seed 6388 (rule in `draw.mjs`). Frame: 10,201 books with a `paddle_zh_reocr` event
  (#5600: 7,006, #5660: 3,195; the job paddle-skqs-rest-6388 had written no book yet). 50 from all books,
  10 from the 53 books whose English the lane marked stale.
- `texts.jsonl`: the stored `ocr.data` each reviewer saw (content hash unchanged since the draw).
- `kanripo.jsonl`: body CER against Kanripo's WYG text by the #5935 leaf rule (57 scored, 1 unaligned, 2 not screened).
- `controls.json`: 10 planted-error copies (3 spans each: 6-char insertion, 6-char deletion, 4-char substitution) of
  pages with Kanripo CER ≤ 0.02, and 5 byte-identical repeats. Rule in `prepare.mjs`.
- `prompt.txt`, `packet-map.json`: one prompt for both reviewers; 75 opaque requests (`q001`…) in seeded order 6393,
  so neither reviewer can tell a sample page from a control.

Reviewers (subscriptions, $0): R1 Opus via `claude -p --model opus` (`review-opus.mjs`); R2 Gemini 3.1 Pro (High) via
`agy -p` (`scripts/eval/run-cli-arm.py`). Smoke calls before the run: one each, on q001, not used.
