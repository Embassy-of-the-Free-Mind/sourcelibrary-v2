---
stage: translation
measure: [judged]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 30
n_pages: 30
verdict: "The live Siku translation lane (agy 3.8 Flash-low, one page a call; first English on held Siku Quanshu books) seeded in the router as cell zh-siku-first-tr: blind Opus, against the image and the stored OCR, accepted 20/30 pages (95% CI by book 0.50–0.83) and found wrong text on 6/30 (0.07–0.33); fidelity mean 3.8. Manuscript pages 13/22 accepted, wrong text 6/22; print-tagged pages 7/8, 0/8. Wrong-page controls 2/2 rejected. No page carried text from another leaf or invented text (no containment candidate)."
status: informational
decision: null
superseded_by: null
issue: [7611, 5600]
router_evidence: [zh-siku-first-tr]
---
## 2026-10-29 · How good is the live Siku translation lane, as the router's sampler judges it? (#7611)
<!-- PRIOR ART: the Siku lane's own spot check (siku-translate-lane.mjs JUDGE, every 5,000 pages, posted on #5600: a different rubric, wrong-leaf / invented / sense errors, against a draft bar); the #6567 stale-retranslation pilot (cell zh-siku-tr, a different task: English that existed before); siku-error-types-5600 (queued on #5600, error kinds and risk levels). This is the router's instrument: route-judge judgePrompt, translation form. -->

**Design.** `lane-judge-sampler.mjs run --lane=siku-translate-5600` (new: one lane only; it does not move the nightly window). The frame is the pages the lane wrote from 2026-10-27 to 2026-10-29 22:19Z. A page qualifies by its own stamps: `translation.engine.run.reason` = `Siku lane #5600, Derek 2026-10-27`, model gemini-3.8-flash-low through agy, and the page_revisions row the writer left, with that reason, an empty prior, and a `next_hash` that still matches the page. That gave 47,177 pages. The 22,072 in hidden books (the Four Histories, zh-histories-7546) were left out, leaving 25,105 pages in 334 visible books. Books were drawn weighted by 1 + ln(1 + human_read_count), one page per book, seed 20261029. The first 30 in draw order were judged, together with 2 wrong-page controls (this page's image and OCR, another book's English). Judge: Opus 5.5 through `claude -p` on the subscription; prompt template 6c73d24dbbc9c9df. No planted controls: the planter plants OCR errors only.

**Result.** 20/30 accepted. Wrong text on 6/30: 3 O6 (a variant character or a term misread into the sense), 2 O7 (numbers: a 丈/尺 slip; an astronomical table garbled), 1 T3 (a broken note tag hiding the main text), plus O4 / O5 / O17 / T9 on the table page. The judge also flagged T10 (unsupported glosses in notes) on 16/30 pages, mostly as "misleads" or "cosmetic". It rejected both wrong-page controls at fidelity 1.

**Replicated?** No. n = 30, one draw. The nightly sampler now draws this lane: every book until 60 are judged, then 5%.

**Artifact.** Verdicts: Mongo `lane_judge_verdicts` (run `lane-judge-20261029221909-lane`). The export: `scripts/eval/estimator/router-table/evidence/lane-judge-sampler.score.json`, cell `zh-siku-first-tr`.
