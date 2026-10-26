---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 19
n_pages: 38
verdict: "The span gate PASSES across books. 20 visible manuscript Kangyur volumes were drawn across Thadrak, Neyphug and the EAP310 'Kanjur' set and across sections. 2 seeded changed pages a volume were corrected by agy Flash-low (CORR request) and judged by judge B. Result: 1 of 38 pages worse (by-book 95%: 0.000-0.079), 35 better, 2 same; no volume with 2 worse. The leaf shows the correction at 334 of 364 decided spans (92% [89, 94]); controls 71/76 (93%). On the 36 two-leaf (seam) frames: 0 worse. One volume (Thadrak 'Bum Ja) gave no writable page: all 6 candidates were held by the ya-btags guard or the 25% cap. Contrast: the split-leaf tantra volume Neyphug rGyud Tsha failed the same gate on the same day (10/40)."
status: undecided
decision: "Gate passed; no page written. Full correction of the 19 volumes (8,278 pages) held for Derek's decision (inbox note 22:50Z)"
superseded_by: null
issue: [6740, 6560]
---
## 2026-10-26 · Flash-low correction across 20 Kangyur volumes: span gate, audit first (#6740 wave 2)

PRIOR ART: `2026-10-26-tibetan-flash-correct-neyphug-tsha-6740.md` is wave 1 (one split-leaf tantra volume, NO-GO
10/40), with the same request, guards and judge. Wave 2 is Derek's note of 22:05Z: "one volume is one observation;
extend ACROSS BOOKS". It covers 20 volumes and allows two-leaf frames. The bar: at most 2 of 40 worse, no single book
with 2 worse, and controls at least 90%. The seam stratum is reported separately.

**Draw.** From the 145 eligible volumes I drew 20 with `random.Random('6740-wave2')`, round-robin over sections within
each collection: 7 Thadrak, 7 Neyphug, 6 from the EAP310 "Kanjur" set (`pass-gate-wave2-6740/books.json`).
- Eligible means: visible Kangyur, not Derge, at least 200 Yigdzin SERVE pages, not in the router draws, not the #6560
  gate volume, and not held, or held only by `tibetan-retranslation-awaits-derek` (#4523, a translation hold; the router
  allowed it too).
- One quarantined volume was swapped for Kanjur Phal chen Ka.
- In each volume, the pages (page_number > 2, at least 300 characters) are ranked by `sha256("6740-wave2|<page id>")`.
  The first 6 were corrected. The audit takes the first 2 in rank order that apply would write with a change.

**Order deviation, decided in the run.** Derek's note asked to correct every page of the 20 volumes. I ran the audit
first: 120 reads instead of about 8,300. The full read was to start only if the gate passed. A second note (22:50Z:
"do NOT start wave 2 corrections until Derek decides") arrived after the full read had been dispatched. It was
stopped on main within 10 minutes, before it made any read (R2 shows only the 114 sample reads for those books).

**Read.** 120/120 read. Guards on the 120: 5 pages held for ya-btags (22 changes), 2 over the 25% cap, 0 adding Latin.
115 changed; the median change is 2.4% of syllables. Thadrak 'Bum Ja (Prajñāpāramitā) had no writable candidate: 4 of
its 6 were held for ya-btags and 2 were over the cap, with 9–37% of syllables changed. So the audit has 38 pages from
19 volumes, not 40.

**Gate** (judge B, `--seed=6740-wave2`, 384 changed spans, 76 controls):

| | worse / same / better (of 38) | leaf shows the correction (decided spans) | unclear | controls right | books with 2 worse |
|---|---|---|---|---|---|
| all | **1** / 2 / 35 | 334 of 364, **92%** [89, 94] | 17 | **71/76 (93%)** | 0 |
| seam (two-leaf frames), 36 | 0 / 2 / 34 | | | | |
| single leaf, 2 | 1 / 0 / 1 | | | | |

The by-book bootstrap (19 books, 4,000 draws) puts the worse-page rate at 0.000–0.079 and the span rate at
0.886–0.945. The one worse page is Neyphug rGyud Kha p.278: a long vowel added to a mantra syllable, ཛྙ→ཛྙཱ.

**Why wave 1 and wave 2 differ** (a reading, not measured here). Wave 2's drafts are two-leaf page-mode Yigdzin reads,
and they carry many plain misreads: a dropped tsheg (སེམསདཔའ), a wrong letter (ཐུབས→ཐབས), dropped words. Flash
fixes these: Thadrak brGyad stong Ka p.323 has 24 of 25 spans going to the correction. The wave-1 leaves are leaf-mode
reads of one tantra, already closer to the leaf (median Derge identity 0.953), so a larger share of Flash's changes
there is normalisation. The three rGyud (tantra) volumes in wave 2 (Neyphug rGyud Ka, Tha, Kha) gave 5 better and 1 worse (the
ཛྙཱ page), so "tantra" alone does not explain wave 1.

**Not done (held for Derek):** correcting the remaining ~8,160 pages, the two-wave apply, the rolling audit. Apply
would write through `writePageText` (PR #7470) with run id `cli-ocr-<stamp>`, undone by `revert-run.mjs --run-id`.

Artifacts: `scripts/eval/results/tibetan-correct-6560/pass-gate-wave2-6740/` (books, candidates and their guard
outcomes, the 38 picked, the reads, the audit key, requests, replies and score). Cost: $0. 120 agy calls and 38 Opus
judge calls.
