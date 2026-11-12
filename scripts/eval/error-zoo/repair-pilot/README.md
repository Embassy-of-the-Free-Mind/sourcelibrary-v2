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

## Result, 2026-11-12: STOP — nothing written

| | Opus (fresh, sealed) | Gemini 3.8 Flash **low** (james pool) |
|---|---|---|
| writes judged | 35 | 34 (one call returned no verdict) |
| correction better than stored | 34 | 24 |
| same | 1 | 0 |
| **correction worse than stored** | **0** | **10** (4 of them flagged serious) |
| gate (≤ 2 worse each) | pass | **fail** |

**Gate: STOP.** No page was written; the run id `error-zoo-pilot-7809-ocr` has no rows; there is nothing to revert.

- **The judge was not the preregistered one.** The #6694 rule was set with Gemini 3.8 Flash **high**. This box's
  default agy account is out of quota until about 2026-11-15 15:00 UTC; the two pools with quota are held to Flash
  **low**. The gate was run as written, with the judge available.
- **What Flash low objected to** (`audit-result-2026-11-12.json`, notes per page): it calls `gank` a faithful reading of
  printed `gantz` (the tz ligature misread as k, a known Flash-Lite error) on two pages; on three pages it calls the
  facing leaf's cut-off line ends "marginal notes the correction omits", where the original audit and Opus both
  identified them as a facing-page strip (I4); on others it prefers `Feldgeschren`, `jeko`, `Herz` where Opus quotes
  the print as `Feldgeschrey`, `jetzo`, `Herr`. These disputes are not settled here: the rule exists so that one
  model's reading does not overrule another's.
- **The audit findings themselves** (`finding-check-2026-11-12.json`, no model): of 17 audit findings whose quotes can
  be checked, the correction removes 15 (11 misreads replaced by the audit's reading, 4 facing-page strips removed),
  changes 1 to another reading, and leaves 1. 18 findings had no quotable misread.
- **A scorer bug found and fixed on the way:** `driver.mjs`, `judge-6694.mjs` and `screen-6694.mjs` counted a Gemini
  verdict only if its tool log showed `view_file`; current agy opens images with `read_file` (the shared
  `agy-cli.mjs` accepts both). Before the fix every Gemini verdict was dropped and this gate read GO on Opus alone.

**Next (no new approval needed, same pilot):** re-judge with Flash high when the quota resets, unchanged packets:

```
python3 scripts/eval/run-cli-arm.py --requests /root/jobs/repair-pilot-7809/set/audit/gemini-requests.jsonl \
  --out /root/jobs/repair-pilot-7809/set/audit/gemini-high-out.jsonl --arm audit7809-g38h --model gemini-3.8-flash-high \
  --job repair-pilot-7809 --kind audit --parallel 2 --attempts 4
```
then score with that file as `gemini-out.jsonl`. GO under Flash high writes the 35 pages as step 5 above; STOP again
ends the pilot.
