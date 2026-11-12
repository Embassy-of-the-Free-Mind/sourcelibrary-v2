# Error zoo and bad-page predictor

## v3 (2026-11-12): a readable page, and is "serious" predictable?

- **The page.** `zoo-stats.py <dir>` computes the cross-tabs (language × half-century, detectability by class and
  severity, class × circumstance); `build-page.py <dir> <out.html>` fills `zoo-page.html` with the zoo, the stats and
  `fixability.json` (every measured repair route, each citing its experiment). Published at
  https://claude.ai/artifact/5JkkHvq7mnsmkJDqaHxUPK. `head.html` / `tail.html` are the v1/v2 page, kept for reference.
- **Finding ids are now content hashes** (`fid()` in classify-unclassed.py, zoo-all.py, zoo-stats.py). Positional ids
  broke when labels.jsonl was regathered; a model answer could have been attached to the wrong finding.
- **Errors or instruments?** `instrument-leakage.py <dir>` → `leakage-report-2026-11-12.md`; write-up
  `scripts/eval/experiments/2026-11-12-is-serious-predictable-6420.md`. Proposals, not in use:
  `SEVERITY-RUBRIC-PROPOSAL.md`, `CALIBRATION-SET-DESIGN.md`.

## v2 (2026-11-11, later the same day): every label source, per-source numbers

The v1 scripts below read ONE source (the spare audits on disk). v2 reads every page-level judgment we hold and
reports the predictor per source. Full write-up: `scripts/eval/experiments/2026-11-11-error-zoo-v2-all-labels-6420.md`.
Vision note and the comparison with v1: `/root/rc-jobs/error-zoo-v2.vision.md` on gex45-1.

Pipeline (outputs live on gex45-1 under `/root/jobs/error-zoo-v2/`, not in git; ~150 MB):

```
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/error-zoo/labels.mjs      /root/jobs/error-zoo-v2   # labels.jsonl, 12,344 rows
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/error-zoo/fetch-pages.mjs /root/jobs/error-zoo-v2   # pages.jsonl (live text, seams, book facts)
<venv>/bin/python scripts/eval/error-zoo/features.py /root/jobs/error-zoo-v2                                                 # feats.json, 199 features
OMP_NUM_THREADS=4 <venv>/bin/python scripts/eval/error-zoo/train.py /root/jobs/error-zoo-v2                                  # predictor-report.md, preds.jsonl
python3 scripts/eval/error-zoo/classify-unclassed.py rules /root/jobs/error-zoo-v2                                           # legacy map + keyword rules; batches for the rest
bash scripts/eval/error-zoo/run-batches.sh /root/jobs/error-zoo-v2/classes haiku                                             # claude -p over the batches (job quota)
python3 scripts/eval/error-zoo/classify-unclassed.py merge /root/jobs/error-zoo-v2                                           # classes.jsonl + spotcheck.md
python3 scripts/eval/error-zoo/zoo-all.py /root/jobs/error-zoo-v2 && cat head.html zoo.json tail.html > error-zoo.html      # the page
```

All read-only against Mongo. The venv needs `scikit-learn numpy` (no pillow: v2 has no image block). Keep the box's
CPU light: `nice -n 10`, four threads; a full train is a few minutes.

What v2 found, in one breath: 12,344 page-level labels exist (book_checks 10,118, weekly audit 1,920, lane judge 68 live,
corrections 238), seven times v1; the pooled out-of-book AUC is 0.812 but that mostly recognises which frame a page
came from; on the weekly audit's uniform draw (the only library-wide frame) it is 0.755, top 10% 74% serious against
31% base, top 30% holds 56% of serious pages; lane B's own check agrees with the Opus audit on 46% of shared pages;
and the "59% unclassed" are minor findings, 95% of serious ones were already classed. The before/after design for
lane B is `LANE-B-BEFORE-AFTER.md`. Nothing was written to production.

## v1 handoff (2026-11-11, morning)

Two things built from the spare-lane convergent audits (`/root/jobs/spare-audit/spare-audit-2026111[01]-*` on gex45-1;
19 rounds, 1,520 pages, ~12,000 graded errors, Opus as the only reader, not calibrated):

1. **Error zoo** — every class in `.claude/docs/page-error-taxonomy.md` with counts, severity mix, top languages and
   up to 8 quoted specimens (bad text vs what the page says). Published: https://claude.ai/artifact/5JkkHvq7mnsmkJDqaHxUPK
2. **Bad-page predictor** — predict "page has a serious error" from cheap features. Out-of-book (GroupKFold by book) AUC:
   book/page facts alone 0.65 · +text stats 0.71 · ~100 features 0.72 · blend with char n-grams 0.74. Top 30% flagged → ~60%
   precision, catches ~half of serious pages (base rate 36%).

## Files (run from a scratch dir; they read/write `rows.json`, `feats2.json`, `zoo.json` in cwd)
- `agg.py` → `rows.json`: one row per audited page (lang, OCR model, tags, scores, serious, classes). Needs a second pass
  that joins `draw.json` for `stratum`/`exposure`/`ocr_model` (done inline in the session; fold it into agg.py).
- `model.py` — first predictor (metadata + text stats + char n-gram LR).
- `feats2.py` → `feats2.json`: ~100 features in groups: size, repetition (zlib ratio, repeated lines/4-grams), garbage
  rules, lexicality (leave-one-book-out vocab, char-trigram surprise), script-block consistency, OCR↔translation
  consistency (numbers, names, untranslated words), tags, image (sharpness, contrast, bytes/px, aspect, ink, chars per ink).
- `model2.py` — group ablations, permutation importance, quintile tables.
- `zoo.py` (stdin: class→kind JSON from `review-vocabulary.mjs`) → `zoo.json`; `cat head.html <json> tail.html` = page.
Needs `scikit-learn numpy pillow` in a venv.

## What we learned
- Features saturate at ~0.72: groups are redundant (they all measure "hard page"). Strongest single signals: publication year
  (oldest fifth 51% serious vs ~30%), OCR compressibility (most repetitive fifth 53%), char-trigram surprise, text-per-ink.
- Ceiling is likely label noise (one uncalibrated reader) + errors that look normal (sense flips, wrong names).
- 59% of logged errors carry no taxonomy class; the zoo covers only the classed 41%.

## Next (for Fable or whoever picks this up)
1. **More/cleaner labels** — pull other audits, by-eye adjudications, page reviews from main/DB; add a second reader.
2. **Signals that see the error**: two-OCR disagreement (Paddle on cloudlayer, or a cheap Flash read); token logprobs if
   exposed; back-translation vs OCR; a Flash-Lite yes/no screener as one feature. (These spend GPU/API — ask Derek.)
3. **Zoo**: classify the 59% unclassed errors (cheap model, the taxonomy as the label set); curate specimens by eye;
   add a severity rubric (MQM-style anchored weights) to the reader prompt; keep the strata×class grid live from audits.
4. Close the loop: route predicted/serious pages to re-OCR or withhold, and measure lane-B repairs before/after
   (lane-B-written pages were still 47% serious).
