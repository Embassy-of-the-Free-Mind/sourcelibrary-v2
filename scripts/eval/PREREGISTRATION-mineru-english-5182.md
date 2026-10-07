# Preregistration — MinerU on the English reference pages: peer engine or tier-3 fallback? (#5182, #3389)

PRIOR ART: `PREREGISTRATION-english-modern-5182.md` (lite vs flash on these pages, with the A-vs-A
floor — this reuses its sample, scorer, tie band and statistics unchanged); PR #2561 (the MinerU
worker, measured only as AGREEMENT with Gemini, 0.96–0.99, never against a reference). Neither
scores MinerU against an independent reference; this does.

Committed 2026-09-30, **before any MinerU read of this study**. Nothing below changes after the run;
a deviation is reported as a deviation in the result, not edited in here.

## Question

MinerU (CPU, pipeline backend, `-m ocr`) sits today as tier 3 of the RECITATION ladder (#3389): the
engine a page falls to when lite and flash both refuse. Is it good enough to be a **peer** engine for
English print 1800–1930 (read first, free, with Gemini as the fallback), only a **fallback**, or
**neither**?

## Sample

Exactly the pages `flash-arm-2026-09-28` scores: the #5216 reference pages with `leaf_check: ok`,
interior leaf (15%, 95%], minus the 8 references dropped after the #5182 by-eye check (they stay
dropped). 114 referenced books, one page per book; strata S1–S4 as #5216 defined them. No new
references, no new draw. The page image is the one lite read — the arm asserts the byte length
equals `fetch.jsonl` `image_bytes` and stops if not.

## Arms

1. **mineru** — `/root/mineru-eval/venv/bin/mineru -b pipeline -m ocr` (version from
   `mineru --version`, recorded on every row), CPU, `nice -n 15`, on Hetzner. Post-processing is the
   production worker's `sanitize()` ONLY (`scripts/workers/mineru-ocr-worker.mjs`, lifted verbatim —
   the worker is not importable, it runs on import), then the shared normaliser
   `en-ocr-ref-normalise@3`, identically to every other engine.
   Run id `en-mineru-5182-2026-09`, engine `mineru-pipeline-cpu`, `issue: 5182`.
2. **mineru-repeat** — the same binary on the 20 seed-5182 floor pages (the lite-repeat draw), run id
   `en-mineru-repeat-5182-2026-09`. MinerU is expected deterministic; the floor is **measured**, not
   assumed.
3. **lite, flash** — the existing store rows (`en-ocr-ref-5124-2026-09`, `en-flash-5182-2026-09`),
   not re-run. **$0 Gemini in this study; no `runGemini` call exists in the new arm.**

## Failed read (MinerU's "refusal")

MinerU has no recitation filter. Its failed read is what the production worker would refuse to
write: `empty` (fewer than 40 letters/digits after `sanitize()`, the worker's `MIN_CHARS`),
`low-quality` (the worker's `lowQuality()`: mean word length > 8 or space ratio < 0.10), or `error`
(the binary failed). A low-quality read is kept on disk and its CER is shown beside the table,
but it counts as a failed read, because production would not have written it.

**Catastrophic** = failed read OR text read with CER > 50% (the #5182 definition).

## Metric and statistics

`measure: accuracy`, scorer `en-ocr-ref-scorer@1` unchanged. Paired MinerU vs lite on pages where
both have a scorable text read: wins/losses/ties (tie |ΔCER| < 0.2 pp), sign-test p, median Δ
(MinerU − lite) with a 95% bootstrap CI (10,000 resamples, seed 5182), per stratum S1–S4, per
period, pooled. Grades: ≥ 50 books decision, ≥ 30 directional, else exploratory.

Also reported, not in the rule: digit error (#5186 measure — silent number misreads verified
against `digitcheck.jsonl`; MinerU candidates not already in it are read off the image and listed);
pages printed before 1820 separately, with a by-eye note on long-s (ſ → f).

## Decision rule (fixed now)

On the ALL cell (decision grade), and quoted per period:

- **PEER** iff paired median Δ (MinerU − lite) is within ±0.2 pp **and** MinerU's catastrophic rate
  (failed read + CER > 50%) is ≤ 2%.
- otherwise **FALLBACK** iff MinerU's pooled CER on the pages lite REFUSED after retry is ≤ 2× lite's
  own pooled CER on its text reads (ALL cell), and MinerU reads (not failed) at least half of them.
  The same number is reported on the pages flash refused.
- otherwise **NEITHER** — tier 3 of the ladder should be re-examined.

The ladder population is small (lite refused 16, flash 19): its result is quoted as exploratory with
its n. This PR changes no routing, lane or worker; the DECISIONS.md row is PENDING Derek.

## Spot-check (by eye)

Ten MinerU pages — the five best and five worst by CER — opened as images and compared with the
MinerU text, recorded in `results/en-ocr-ref-5124/mineru-arm-byeye.jsonl`, labelled *read from image*.

## Budget

$0 API. CPU on Hetzner, ≈ 20–50 s/page at `nice 15`, ≈ 134 page reads.
