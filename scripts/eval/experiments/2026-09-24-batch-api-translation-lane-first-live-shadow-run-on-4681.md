---
stage: translation
measure: preference
languages: [de, it, la]
scripts: [Latn]
canons: []
n_books: 3
n_pages: 48
verdict: "First live shadow of the batch lane: Batch API cancelled 8 of 15 jobs; judge preferred production 5-1 on 6 decided junctions vs A/A floor 79% ties; too thin to call"
status: superseded
decision: null
superseded_by: "2026-09-25-retraction-of-the-arm-label-on-both-4681-seam-4681.md"
issue: [4681, 5000, 5011, 5013]
---
## 2026-09-24 — Batch API translation lane, first live shadow run on three books: A/A floor, blind judge vs production, and what the Batch API did (#4681 steps 3–4; PRs #5000/#5011/#5013)

**Headline: the lane runs end to end on real books and writes what it should (nothing, in shadow),
but the Batch API cancelled 8 of 15 jobs, and the judge result is too thin to call. Where a page
break actually carried a sentence, production was preferred over the repaired lane 4–1 and over
plain batch 4–2; the same-lane A/A control tied 79% and split 2–1. This does not reproduce the
#4912 tie (27–27, n=57) and is not a flip signal. Decision stays with Derek; the lane is not the
default and nothing is scheduled.**

*Design.* Three untranslated books, terminal status: *Über das optische Formgefühl* (de, 1873,
65 pp), *Vita e Frammenti di Saffo* (it, 1863, 106 pp), *Mélanges d'alchimie* (la manuscript,
95 pp). Arms on the same pages: **S1** and **S2**, two independent shadow runs of
`translate-batch-worker --shadow` (batch translate + seam repair, arm Et byte for byte, drafts and
repairs kept on the run document, nothing written); **P**, the realtime `translate-worker` on the
same books afterwards (production code, writes pages). One blinded packet: at every block
boundary of S1, a junction = end of page N + start of page N+1 from one lane; pairs **S1/P**
(the test) and **S1/S2** (the judge's noise floor) interleaved, left/right flipped by seed, ids
opaque (`j001…`; a first build leaked the pair type in the id and was rebuilt before any
verdict). 48 junctions: 32 S1/P (20 repaired-lane, 12 plain-batch), 16 S1/S2. Eight independent
Claude (Sonnet) judges, six junctions each, LEFT/RIGHT/TIE + one sentence. Harness:
`translation-batch-shadow-judge.mjs` (`--packet`, `--score`); results in
`results/translation-batch-shadow-*`. Envelope `batch-shadow-4681`: **$0.53 spent** of $1.50
(shadow ×2 with retries ≈ $0.25, realtime ≈ $0.28); closed after.

*What the Batch API did.* 15 jobs submitted inline on `gemini-3.1-flash-lite`: 4 translate jobs
and 4 repair jobs died — whole jobs `JOB_STATE_CANCELLED`, or `JOB_STATE_SUCCEEDED` with every
request `{ error: { code: 1, message: "The operation was cancelled." } }`. Before PR #5011 the
lane read only the success shape and marked such a run `shadow_complete` with 0 drafts and its
meter row `success` at $0. Two one-request grids (~$0.01): not the request shape — the exact
request succeeded while trivially different cells were cancelled; a file-based submit (PR #5019)
was cancelled 10/10 too. Web: same errors reported on Gemini 3.x flash models through 2026, no
Google fix, retry is the only mitigation; repo: the OCR orchestrator forces file input for Lite
after an inline stuck-PENDING episode, and the file-based OCR lane had a normal day (21 saved,
1 failed). Conclusion: capacity-class, format-independent; a scheduler for this lane needs a
bounded resubmit on "no drafts" and on "no repairs" (a run with drafts and no repairs is arm B,
plain batch, not the design).

*Scope loss.* The Latin manuscript was at `archive_complete`, not `complete`; finalize promoted it
to `ocr_complete` and the realtime worker, funded by the envelope, claimed it before a repaired
shadow run existed (memory: an envelope funds every scoped worker on those books). It became the
plain-batch control. Two repair jobs for it were cancelled first.

| pair | n | tie | decided | winner split | share of decided |
|---|---|---|---|---|---|
| S1/S2 (same lane twice, A/A floor) | 16 | 13 (81%) | 3 | S1 1 – S2 2 | — |
| S1/P, S1 repaired (the design) | 20 | 14 (70%) | 6 | lane 1 – **production 5** | production 83% (p=0.22) |
| S1/P, S1 unrepaired (plain batch, control) | 12 | 6 | 6 | lane 2 – production 4 | production 67% |

Six junctions were **degenerate** (an illegible page, a bare marker, a one-line placeholder) and
were judged TIE; excluding them: repaired lane vs production 11 tie / production 4 / lane 1; A/A
11 tie / 2 / 1. Most remaining ties are page breaks between numbered fragments or at headings —
this draw was NOT filtered for "ends mid-flow" as #4912's was, so the tie rate is inflated by
seams that are not seams and the decided n is small. **Read:** the A/A floor says the judge can
say TIE and does under the null (79%); on the seams that discriminate, production is preferred
by the same judge, 4–1 and 4–2. At n=5 decided this is a direction, not a result; it is the
direction #4912 found for plain batch, and it does not reproduce #4912's tie for the repaired
lane. The three production wins that were read against the source (memory: *by eye means the
image was opened* — here the OCR text): German p.35 opens mid-sentence "…eingeschlagen hat";
production carried the verb, the lane's repaired page lost it. Italian p.109 (an index page): the
lane's repair reproduced garbled OCR verbatim, production rendered the index. Latin p.12→13: not
a misalignment (the judge misread garbled Latin); both lanes translate the same page.

*Found on the side — intra-block page drift is a property of block translation, not of the
lane.* Over 218 page boundaries INSIDE blocks (never touched by the seam repair), 6 (2.8%) have
one lane's text on the other side of the page boundary relative to the other lane. Attributed
against the OCR head of page N+1: **production pulled the next page's opening onto the previous
page in 3** (de 30→31, 41→42; it 58→59), the lane did it in 1 (it 107→108), 1 ambiguous, 1 a
paragraph the lane dropped (it 90→91). Both lanes use the same 8-page block prompt and the same
parser. Body pages otherwise agree: of 228 pages with both texts, 196 (86%) within ±10% length;
5 lane pages under 75% of production's length (one near-empty). Median word-bigram similarity
lane~production 0.67, lane~lane 0.73.

*Not done / next.* No flip, no schedule, no retry logic (#4681 names it). If the question "does
the repaired lane tie production at real seams" is to be answered at n≥50 decided, the draw must
filter to mid-flow seams (reuse #4912's `assessSeam`) and the judge packet must carry the A/A
pairs as here. The intra-block drift deserves its own detector over production (it is live
today at ~3% of in-block boundaries).

*Artifacts:* `scripts/eval/translation-batch-shadow-judge.mjs`;
`results/translation-batch-shadow-judge-{packet.jsonl,key.json,verdicts.json}`,
`results/translation-batch-shadow-body-similarity.json`,
`results/translation-batch-shadow-report-2026-09-24.json`. Runs: `translate_batch_runs`
`tbs_mufjaivx_if4uw8`/`tbs_mufk3x42_g9tgs2` (de S1/S2), `tbs_mufigql9_laf1y7`/`tbs_mufl8fqe_jmdr1x`
(it), `tbs_mufiwfjw_hyekvt` (la, unrepaired). Issue thread: #4681 (2026-09-24 comments).
