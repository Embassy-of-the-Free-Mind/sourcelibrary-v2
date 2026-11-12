# Repair pilot #7809 — Opus corrects stored Flash-Lite OCR (German print)

Derek's go, 2026-11-12 (#6420 decision 4): a 40-page pilot of the measured repair route, with before/after
measurement and the #6694 stop rule. The only production write approved in this job.

## Scope

- **Route:** `lite>Opus` on router cell `german-lite` / print: the live route in router table `2026-11-01-validated-7263`.
  Latin and French print route to `agy`, so they are not in this pilot.
- **Pages:** every page an audit had flagged with a serious OCR-stage error, on text unchanged since that judgment,
  with Flash-Lite OCR, printed, in a live German book that is not held and not in a translate lane. That is **35 pages
  in 23 books** (≤ 3 a book), not 40: only 36 pages in the whole label table meet every condition. Selection:
  `select.mjs`; the findings each page was picked for: `findings.jsonl`.
- **Before:** `before-2026-11-12.jsonl` holds every page's full OCR and English, their hashes and timestamps, frozen
  and committed before any correction ran.

## Steps

1. `scripts/batch/ocr-convergence/correct.mjs --set-dir=SET --model=opus`: Opus answers each page with a corrected
   transcription, UNCHANGED, or CONTAIN. Writes nothing.
2. `judge-6694.mjs decide-b`: write / keep / contain / defer per page.
3. `driver.mjs audit-packets`, `audit-opus`, Gemini 3.8 Flash high through `run-cli-arm.py`, `audit-score`: a blind
   check of each write against the stored text, image first, by a fresh Opus and by Gemini.
4. **Stop rule (#6694 write audit):** GO only if at most 2 writes are judged worse than the stored text by Opus AND
   at most 2 by Gemini. STOP writes nothing.
5. On GO: `cli-ocr.mjs apply --out=SET/reads --only=writes.json --mark-stale=error-zoo-pilot-7809` under
   `CLI_RUN_ID=error-zoo-pilot-7809` (run id `error-zoo-pilot-7809-ocr`). The English of each written page is marked
   `translation_stale`, because it was made from the old transcription. Re-translation is not part of this pilot.
6. After: read every written page back, check its hash equals the correction judged, and check whether each audit
   finding's quoted misread is still in the text.

## Revert

Every write goes through `writePageText`, which keeps the old text in `page_revisions` under the run id.

```
node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id error-zoo-pilot-7809-ocr          # dry run
node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id error-zoo-pilot-7809-ocr --apply  # undo
```

It restores only pages still holding exactly what the run wrote. `before-2026-11-12.jsonl` is the independent copy.
`written.jsonl` (added after the write) lists every page written, with the before and after hashes.
