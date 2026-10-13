# Preregistration — OCR convergence on the most-read non-English books (#6420 lane B)

PRIOR ART: scripts/eval/PREREGISTRATION-latin-cli-pilot-6375.md (the CLI read and the nudge, on backlog pages with no
stored text; no write) and scripts/eval/PREREGISTRATION-second-reader-6338.md (Gemini as a second READER of served
pages; no write). This one turns a second read into writes and containments on served pages, so the agreement
threshold and the gate are fixed here before the data that sets them is looked at.

Committed 2026-10-10, after the calibration and gate pages were DRAWN and the CLI reads STARTED, and before any
comparison (CER) or adjudication was computed. Job `convergent-ocr-6420`, Hetzner. Driver:
`scripts/batch/ocr-convergence/driver.mjs`; reads through `scripts/batch/cli-ocr.mjs read`.

## Frame
- **Books:** `visible: true, pages_count > 0, pages_ocr > 0`, `language` in the six groups (first word Latin, Greek,
  German, Chinese, Arabic, Hebrew), not held. Ranked by **distinct (ip, day) book-page views** in
  `analytics_pageviews` over the 60 days to 2026-10-10 (the store is human-filtered at write time,
  `measurement-instruments.md`; the window starts after the Jul 10–Aug 6 fleet). 9,839 books ranked.
- **Pages per book:** eligible = `page_number > 0`, `ocr.data` ≥ 200 chars, an archived image, not human-edited, page
  type not blank/cover/illustration. The pages readers opened most (≥ 2 distinct ip-days, per-page paths), filled to
  N with a seeded spread (one page from each of N equal slices, Mulberry32(6420 ^ sha1(book id))).
- **Calibration set** (`calib`): the next books after the gate's in each group — Latin 8, Greek 4, German 3, Chinese 2,
  Arabic 2, Hebrew 1 — 3 pages each: **60 pages, 20 books.**
- **Gate set** (`gate`): the top books of each group — Latin 15, Greek 5, German 4, Chinese 3, Arabic 2, Hebrew 1 —
  10 pages each: **300 pages, 30 books.** (Proportions follow the first 200 of the frame, which is ~half Latin; every
  group is in the gate so the go/no-go covers every script that will be run.)
- **Main run:** ranks 1–200, minus the books above, in group order (Latin first), 10 pages each. Then ranks 201–1,200.

## Second read
`gemini-3.7-flash-low` through `agy -p --mode plan --print-timeout 120s --output-format json` (subscription, $0),
one page per call, the live default OCR prompt as `cli-ocr.mjs` sends it, ≤ 3 calls in flight. Nudge on a denied tool
(#6331); one fresh re-read when the reply fails `ocrReadProblem()` (plan note, refusal/summary, restarted read,
duplicated reply, opener before the tags, empty). A page whose read still fails is `no-second-read`: nothing is
claimed or written. On a quota error the reader sleeps 30 min and resumes. Never `--dangerously-skip-permissions`.

## Comparison
CER = Levenshtein(stored, cli) / max(len) over both texts with the OCR metadata tags stripped, markdown marks
removed, ſ→s, æ/œ unfolded, line-break hyphens joined and whitespace collapsed (`normaliseForCer`).

## Threshold rule (fixed here; the value is set by the calibration batch)
All 60 calibration pages are adjudicated by Opus, whatever their CER. A page **needs action** if the adjudicator
marks the stored read serious, or picks the CLI read with `replace: true`.
**T** = the largest of {0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15} such that, among calibration pages with CER < T,
(a) at least 10 pages fall below T and (b) at most 1 page, and at most 5% of them, needs action. If none qualifies,
T = 0.01. T is posted on #6420 and appended to this file (one line, "Calibration result") before the gate's
adjudication runs. Pages with CER < T are `agree`: a `book_checks` row, no write.

**Check on T in the gate:** 30 gate pages drawn at random (seed 6420) from the `agree` pages are adjudicated as well.
If more than 3 of the 30 need action, T drops to the next lower candidate before the main run, and that is reported.

## Adjudication (CER ≥ T)
Opus (`claude -p --model opus`, subscription on team@, sealed folder, Read/Write only), brief
`scripts/batch/ocr-convergence/ADJUDICATOR.md` v1, ≤ 25 pages per call, ≤ 8 calls at once. The two texts are A and B
in an order drawn per page (sha1(seed:page id)); the adjudicator is not told which one is served.

## Actions (per page)
- **write** — pick = CLI, confidence high, `replace: true`, CLI read not serious, no chatter flag, and the book is not
  in a state where a translate lane would re-translate the page at once (status ocr_complete / translate_partial /
  translate_submitted, or < 92% translated in a gap-fill status). Written by `cli-ocr.mjs apply --only … --apply` (its
  guards: human edit, OCR changed since the read, < 40% shared words, loop, refusal; revision snapshot; provenance).
  Each written page with a translation is stamped `translation_stale` (lane `convergent-ocr-6420`) for lane C.
- **defer** — a write held back by the translate-lane rule; listed for lane C.
- **contain** — pick = cannot_tell or neither, or both reads serious: hold the book, withhold the page's English
  (`withhold-stale-translations.mjs --by-eye-pages`), label #6420 `contained`.
- **keep** — the stored read was picked, or both are fine. **residual** — merge, or a pick below high confidence.

## Gate (before any run beyond the 300 pages)
A blind by-eye audit of **40** gate decisions — every `write` up to 40, the rest filled from `contain` and `keep` —
by a fresh Opus reader and by Gemini 3.8 (`gemini-3.8-flash-high`, agy), each reading the image against the
before/after texts (shown as X and Y in a drawn order) and answering which is the more faithful transcription.
**Go** only if **neither** auditor finds a written page made worse in more than **2 of the 40**. Otherwise stop, post
the failures on #6420, and do not scale. The audit reads the STAGED decisions (the stored text against the CLI read
that would replace it), so nothing is written before it passes; the gate's own writes are applied after a pass, minus
any page an auditor found worse.

## Reported
Per group and pooled: pages compared, agree / keep / write / defer / contain / residual / no-second-read, with
Wilson 95% CIs for the write and contain rates by page; the CER distribution; the audit result. Experiment file in
`scripts/eval/experiments/`, comment on #6420.

## Calibration result (2026-10-10, appended before the gate's adjudication)
59 of 60 calibration pages compared (1 CLI reply refused twice on a Zohar page: `no-second-read`); 18 first reads had
used the whole spread on split pages and were re-read from the page's own image (cli-ocr.mjs fix, same commit range).
All 59 adjudicated by Opus. Pages needing action by CER band: CER < 0.01: 3 of 5; 0.01–0.03: 7 of 14; 0.03–0.10:
9 of 13; ≥ 0.10: 20 of 27. No candidate meets the rule (no band below any T has ≤ 1 page and ≤ 5% needing action), so by the rule
**T = 0.01**: in effect every disagreement goes to Opus. Two near-identical reads (CER 0.003, 0.006, Suidas) were
judged to share a serious misreading: the two families' errors are correlated, so low CER is not acceptance here.

## Gate result (2026-10-10, appended after the audit)
Check on T: 12 of 30 agree pages needed action (> 3); there is no candidate below 0.01, so a main run adjudicates every
page. Audit of 40 staged writes: Opus worse 0 / better 36 / same 4; Gemini 3.8 worse 3 / better 34 / same 3. **STOP**
by the rule (Gemini > 2). Nothing written; containments and check rows applied (`driver.mjs apply --no-writes`).
Deviation, decided before any containment was applied: "both reads seriously wrong" on a page where each read is right
somewhere (a merge) is `residual`, not `contain` — containment is kept to pages neither read can give a reader
(neither / cannot tell at medium or high confidence) and to pages whose stored text the adjudicator found to be
another leaf's (`contain-extra.json`), the bar in `containment-on-finding.md`.
