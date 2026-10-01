## 2026-09-24 — Batch + seam-repair lane vs production at MID-FLOW seams: the decisive draw (#4681)

**Question.** Does the Batch API lane with seam repair (arm Et, PR #5000) read as production at page
breaks where a sentence actually crosses the break? The first live shadow (entry above) leaned
production 5–1 on 6 decided junctions, most of its 48 junctions being non-seams.

**Answer: TIE.** On 62 mid-flow junctions, production was preferred 19, the lane 14, tie 29.
Production share of decided = 0.576 (Wilson 95% CI 0.41–0.73, two-sided p = 0.49). The judge's
own A/A floor on the same packet split 14–9 (share 0.61, CI 0.41–0.78) with 51% ties — the
production-vs-lane gap is smaller than the gap the judge produces between the SAME lane run twice.
Not "better", not "worse": the lane is not shown worse than production at the seam. The point
estimate sits under the #4912 60% limit, but the CI upper bound (0.73) does not exclude it, so this
is a tie, not a demonstrated non-inferiority.

| pair | n | tie | decided | winner split | share of decided |
|---|---|---|---|---|---|
| S1/S2 (same lane twice, A/A floor) | 47 | 24 (51%) | 23 | S1 14 – S2 9 (p=0.41) | — |
| S1/P, S1 repaired (the design) | 62 | 29 (47%) | 33 | lane 14 – production 19 (p=0.49) | production 57.6% [41–73%] |
| S1/P, S1 unrepaired (plain batch) | 0 | — | — | — | every S1 run carried repairs |

**Draw.** No usable books at `complete`: the 10 Latin-script 40–120 pp candidates had stale
`pages_translated` counters and were already translated. Used 9 books at `needs_attention`
(e-rara ×7 incunabula/16th c. Latin, BSB ×2: one German 1675, one Latin 1782; OCR ≥90%, stale
`image_download_failed`), which is terminal for every lane (orchestrator sweep and translate-worker
`DONE_STATUSES` exclude it; Phase 9 reads only `cover_selected`) — no status drift during the shadows.
4 are `hidden_reason: launch_curation`. Requeued to `ocr_complete` by hand for the realtime arm
(the stock `requeue-untranslated-complete.mjs` moves only `complete`); translate_complete within
~5 min. The `parked` cohort (93 Kloss takedown books) was excluded.

**Packet.** `--midflow` (new): 20 skip records (15 S1/S2 pairs missing text in S2 from partial Batch
drafts, 3 seams not mid-flow on the OCR, 2 seams with a degenerate <120-char half) → 109 junctions (62 S1/P, 47 S1/S2),
committed before judging. Body pages (701): median similarity S1~S2 0.73, S1~P 0.71, length ratio
S1/P 1.00. Eight Sonnet `lean-worker` judges, 11–14 junctions each (more than the 6–8 planned; 109
junctions, 8-agent cap), the printed question verbatim, blind to the key.

**Batch API.** Cancellation persisted: of 29 translate submissions across both passes, 11 (38%) came
back fully cancelled or with partial drafts and no repairs (e.g. 16/116 pages); the 4-try runner got a repaired
run for all 9 books in both passes. Partial drafts shrink the seam set (Manuale S1 had 5 of 12 seams).

**What the judges said** (their reasons, NOT checked against the source). Production wins are mostly
the lane dropping or orphaning a word at the break, with three lane-specific defects: an editorial
note "continues from previous page" left in the text (j062), and untranslated source fragments glued
to English (j019 "Bishop-rum", j096 a German catchword). Lane wins are the mirror image (production
dropping a subject, losing an antecedent, a truncated split word). By book, production led on the
German Apologia (4–2) and Brevis Notitia (3–0), the lane on Epistolae (4–2) and Modus (3–2).

**Jev as a second instrument (asked by the parent session).** Side form (one noul per junction side,
question from `seam-continuity-pilot.mjs`), tie band = A/A 95th pct |margin| = 0.14. Jev tied 101 of
109: A/A 45 ties, 1–1; S1/P 56 ties, lane 5 – production 1. Against Sonnet: AUC of the margin 0.487
(chance), same side on 2 of 4 both-decided, and Jev tied 52 junctions Sonnet decided. **The
proposed gate (Sonnet only where Jev decides, +10% control) would have sent ~13 junctions to
Sonnet and discarded the 33 that decided this run** — Sonnet's verdicts on the 6 Jev-decided S1/P
junctions were production 3, tie 3, lane 0, opposite to Jev's own 5–1. Jev's pilot (AUC 0.79, n=6
both-decided) does not replicate at n=109; do not use it as a continuity screen. Cost $0.008.

**Spend.** $1.40 metered over the 9 books (both shadow passes with retries + the realtime arm),
envelope `batch-seam-decisive` $4 — closed. Jev $0.008.

*Next.* Cheaper is settled (≈58%) and "not worse" now reads as a tie at n=33 decided. Whether that
meets Derek's condition is his call; nothing was flipped or scheduled. Before any flip: the lane-only
defect class (repair leaves an editorial note / untranslated fragment at the seam) is worth a
detector over the shadow runs, and the Batch cancellation rate makes retries a production
requirement, not an option.

*Artifacts:* `results/translation-batch-seam-decisive-judge-{packet.jsonl,key.json,verdicts.json}`,
`results/translation-batch-seam-decisive-{body-similarity,jev}.json`,
`results/translation-batch-seam-decisive-report-2026-09-24.json`; `scripts/eval/jev/seam-continuity-screen.mjs`.
Runs (`translate_batch_runs`, S1/S2): 69b51e949a… `tbs_mufrlndv_8pzcmn`/`tbs_mufsds5z_dpvlow`;
69b51e72ff… `tbs_mufssawy_bsi6pn`/`tbs_mufu0d0h_qlfbq4`; 69b6304e1c… `tbs_mufs1sxw_kxnpm6`/`tbs_muftc4qw_ccoof2`;
69b630791c… `tbs_mufru3zi_j6zwru`/`tbs_mufsudao_wctqjf`; 69b6311a1c… `tbs_mufsfsxw_m2yozn`/`tbs_muftkis8_oq26x6`;
69b630c31c… `tbs_mufr5afl_81tham`/`tbs_muft3wt1_5wfnk1`; 69b6312f1c… `tbs_mufqs0ed_ong93d`/`tbs_mufs53sg_tar3q7`;
69b630dc1c… `tbs_mufs3ztm_m4qsux`/`tbs_mufspooe_2rik07`; 69b631fb1c… `tbs_mufsef21_jyvov6`/`tbs_mufsya26_04ecaa`.
