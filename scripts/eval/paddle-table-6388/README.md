# #6388 Paddle zh table/diagram detector + backup-reader bake-off

PRIOR ART: `scripts/eval/paddle-zh-qa-6388/` (qa3: Kanripo leaf rule, `claude -p` / `agy -p` one-page readers, the live
OCR prompt) and the job paddle-flagged-6388 artifacts (`/mnt/HC_Volume_105839809/jobs/paddle-flagged-6388/w/`: Opus
layout + verdict on 495 strict-flagged pages). Neither scored a per-page detector nor compared readers on table pages.

Write-up: `scripts/eval/experiments/2026-10-11-paddle-zh-table-detector-6388.md`. The shipped rule is
`scripts/lib/paddle-table-detect.mjs` (not wired into the lane).

These are the scripts as run, from a scratch directory (`$JOB_SCRATCH/w`, with `node_modules` linked). Every Mongo
access is a read. Run with `node --env-file=/root/sourcelibrary/.env.production.local`.

**Part A (detector)**
1. `books.mjs`: the 10,985 books with a `paddle_zh_reocr` event.
2. `dump.mjs`: every page whose served `ocr.source` is `paddle`, as `paddle-pages.jsonl.gz` (1,568,108 rows; not
   committed).
3. `rev.mjs`, `meta.mjs`: the 66 contained snapshots, their page numbers, and the book titles.
4. `labels.mjs`: joins the 495 + 66 + 60 judged pages into `labels.jsonl`.
5. `feat.mjs`, `allfeat.mjs run`: text-shape features and the strict screen for every page.
6. `analyze.mjs`, `an2.mjs`: per-signal and combined-rule precision and recall, written to `data/rules.json`.
7. `parity.mjs`: the shipped `paddleTableRisk()` over every stored text, written to `data/flagged-S4.jsonl.gz`
   (4,379 pages).

**Part B (bake-off)**
1. `align.mjs`: the Kanripo leaf for each candidate, written to `data/align.jsonl` (leaf text kept only for the 30
   bake pages).
2. `select.mjs`: the 30 pages, written to `data/bake.json`.
3. `img.mjs`: fetches the page images.
4. Reads:
   - Opus: `opus.mjs <req> <out> <cap> <parallel>`, with the requests built from `prompt-ref.json`'s live prompt.
   - Gemini: `../run-cli-arm.py --model gemini-3.1-pro-high --print-timeout 300`.
   - Output goes to `reads/read-{opus,gem}.jsonl`.
5. `mkreview.mjs`: builds the cross-review requests from `review-prompt.txt` and plants 3 duplicated-row controls
   (`data/*-controls.json`). The reviews are in `reads/review-by-{opus,gem}.jsonl`.
6. `cer.mjs`: CER against the Kanripo leaf, the order-free bag measure and the over-count. Writes `data/cer.json`,
   `data/bag.json` and `data/overcount.json`.
7. `score-rev.mjs`: writes `data/reviews.json`. Where a uid was reviewed twice, the first parseable reply counts.
