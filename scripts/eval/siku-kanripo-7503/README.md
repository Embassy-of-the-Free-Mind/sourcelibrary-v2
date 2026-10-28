# #7503 Siku pilot pages against Kanripo (model-free)

PRIOR ART: `scripts/eval/zh-skqs-5568-kanripo.mjs` (workInfo / pbPages / best / fold, imported),
`scripts/eval/ground-truth-5935/lib.mjs` (bodyText / bodyCer, imported), `scripts/eval/paddle-table-6388/` (align + CER
on 30 pages). None of them ran whole volumes from the stored Paddle text with image-sequence flags.

Write-up: `scripts/eval/experiments/2026-10-27-siku-pilot-kanripo-check-7503.md`.

Every Mongo access is a read. Run with `node --env-file=/root/sourcelibrary/.env.production.local`.

1. `align.mjs --draw=draw.json --pages=page-ids.json --out=DIR --dir=CACHE`: every page of the 20 pilot books
   (`draw.json` / `page-ids.json` from PR #7543) against the whole Kanripo WYG work. It records the matched `<pb>`, Dice,
   runner-up, body CER (glyph variants folded, ±40 chars of slack at each leaf edge) and the edit runs. It also writes
   the sequence flags: out-of-sequence (not on the longest increasing run), same-leaf, skipped and extra leaves,
   unaligned runs, and the R2 key scope.
2. `report.mjs --in=DIR --dir=CACHE`: summary, CER with a by-book bootstrap CI, a class for every page without a
   leaf, and what Kanripo would change on the Dice ≥ 0.9 pages. It writes `results/summary.json` and
   `pages.jsonl.gz`.
3. `eye.mjs --rows=… --img=… BOOK:PN …`: for one page, the Paddle text, the Kanripo leaf it should be and the leaf it
   matched, plus the image, for checking by eye.
4. `model-reply-scan.mjs --books=draw.json | --all`: Paddle pages whose OCR holds a chat model's stock reply
   (`作为一个人工智能语言模型…`). Writes `results/model-reply-scan.json`.

`results/qa-join.json`: siku-pilot-7503-cl's 30 judged pages (PR #7543 `verdicts-pilot.jsonl.gz` + `packet-pilot`),
joined to each page's CER.
