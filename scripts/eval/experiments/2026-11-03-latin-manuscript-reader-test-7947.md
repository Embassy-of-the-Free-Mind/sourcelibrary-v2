---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 34
n_pages: 102
verdict: "On the 26 lite-read Latin manuscripts of the #7947 draw (78 pages, strips out), the Opus manuscript reader (claude-ocr.mjs) is the only arm that clears the floor fixed before judging. Its confirmed sense-changing errors are 0.06 per 1,000 words (95% CI 0-0.2), with 77/78 pages accepted and 0 wrong text. The stored Flash-Lite text, judged in the same blind packets, has 5.07 (3.56-6.74) and 38/78 accepted. agy 3.8 Flash low read 4 a call has 3.0 (1.5-4.9) and 54/78 accepted; it does not halve the rate. Arm c (PERO GPU draft, then an agy Flash correction) has 4.27 (2.8-5.9) and 47/78 accepted. PERO is print-trained and its drafts of hands are noise, and the arm-c writer is print only, so it would skip 52 of 78 pages the corrector tags handwritten. On the 24 incunabula pages, lite>opus scores 0 per 1,000 (24/24 accepted) against stored 1.92 (12/24). agy Flash read scores 0.44 (19/24) but leaves one page wrong or mostly wrong. The judge is Opus, the same family as the winning reader. The solo control and #6544's expert-transcription CER point the same way, but no other model family judged here."
status: informational
decision: "No production write. Recommended (DECISION on #7947): re-read the 584 live Latin manuscript books (104,870 pages with OCR) with the Opus manuscript reader on the subscription. That is about $8.4K list-equivalent at the measured $0.08 a page (one page a call), or about 4 Claude account-weeks at #5924's ratio of 1% per 250 pages. It needs two things first: (1) the write path, because 18 of 78 Opus reads share under 40% of their words with the bad Flash-Lite text they replace and cli-ocr.mjs apply refuses those without a lane gate; (2) a 10-a-call check on one book chunk, since this test read one page a call. The 98K translations of those pages then go stale and are priced separately. Incunabula: lite>opus cleared on 24 pages; scaling it to the 1,843 lite-read incunabula (258K pages, about $31K list-equivalent or about 10 account-weeks) is a second DECISION."
superseded_by: null
issue: [7947, 6544, 7567, 5924]
router_evidence: "none — the k/n per arm is written in the router-table evidence shape (scripts/eval/estimator/router-table/evidence/latin-ms-reader-7947.score.json, cells latin-manuscript-lite-7947 and latin-incunabula-7947), but no rules.json row reads it yet: the manuscript row of ocr-routing-table.json is 'settled, not routed', and wiring a cell would move router picks, which this eval PR does not do"
defect_rates: "scripts/eval/results/latin-ms-reader-7947/defect-rates.json"
---
PRIOR ART: `2026-11-02-latin-strata-why-latin-struggles-7947.md` (the census whose draw this reuses and whose §5 named
this test and its floor); `scripts/eval/spot-check/REVIEWER.md` and `SECOND-READER.md` (verbatim);
`scripts/eval/latin-strata-7947/run-reviews.sh` and `lib.mjs` (reused unchanged); the readers `scripts/batch/cli-ocr.mjs`,
`claude-ocr.mjs`, `ocr-convergence/correct.mjs` and `pero-draft.py` (unchanged, read stage only).

## 2026-11-03 · Which reader clears the floor for the lite-read Latin manuscripts and incunabula of the #7947 draw? (#7947)

**Why.** The #7947 census found manuscripts carry 4.4 sense-changing errors per 1,000 words against 1.15 for print,
and Flash-Lite 6.3 against 3 Flash's 2.8. It recommended this test before the 584 live manuscript books (98K translated
pages) are re-read. Derek's order (2026-11-02): GPU OCR, then agy Flash correction, then Opus only when nothing else
clears the floor, so the cheap arms were run first.

**Design** (`scripts/eval/latin-ms-reader-7947/RULE.md`, committed in 0c9334696 before any judge call).
- **Pages.** From the #7947 draw, not re-drawn (`sets.mjs`). `ms` is the 26 manuscript books whose 3 drawn pages were
  all read by Flash-Lite, with the 3 microfilm-strip books left out: 78 pages, 17,350 words. `inc` is the 1450–1500 print
  cell: 8 books, 24 pages, 11,462 words (7 Flash-Lite books, 1 Gemini 3 Flash). On all 102 pages the stored OCR still
  equalled what the census judged.
- **Arms.**
  - S is the stored text.
  - A: agy `gemini-3.8-flash-low`, `cli-ocr.mjs read --per-call=4`, with the drawn page first in a block of 4
    consecutive pages (`blocks.mjs`).
  - B is arm c: PERO-OCR on the GPU (the gpu-queue task `30-latin-ms-pero-7947`, `pero-draft.py --device=gpu`, 78 pages
    in 26 s), then the agy Flash-low correction with the image on the #7263 template (`--gpu-draft --over-stored`), then
    the E3 long-s pass and put-back against the stored text as `apply` runs them.
  - C: the Opus manuscript reader, `claude-ocr.mjs --reread --per-call=1`.
  - `inc` adds L: lite>opus, `correct.mjs --model=opus` as #5924 ran it.
  - An arm that gives nothing usable for a page serves S there: no read, a cut reply, UNCHANGED, CONTAIN, or a
    put-back that cannot be spliced.
- **Judge.** One Opus reader per book (`claude -p`), with `REVIEWER.md` plus `JUDGE-ADDENDUM.md`. A book's arms sit in
  one packet under neutral labels, shuffled. A second Opus reader with `SECOND-READER.md` checked all 266 serious calls,
  blind to arm. Rates count OCR and page lanes only, over the stored page's word count for every arm.
- **Floor** (the write-up's). An arm must at least halve S's confirmed rate, and no page may gain invented text.
  For `inc`, no page may be wrong or mostly wrong (ocr_score ≤ 2).

**Results** (confirmed calls; book-cluster bootstrap 95% CI. Second reader: `ms` 197 confirmed, 18 reclassified,
17 not serious, 1 not an error, 2 cannot tell; `inc` 26 / 1 / 4 / 0 / 0).

| Set · arm | Sense errors per 1,000 words | Accept (no serious) | Wrong text | ocr_score ≤ 2 | Paired vs S (better / worse) | Read served | Floor |
|---|---|---|---|---|---|---|---|
| ms · S stored (Flash-Lite) | 5.07 (3.56–6.74) | 38/78 | 5/78 | 25/78 | — | — | — |
| ms · A agy Flash low @4 | 3.00 (1.54–4.88) | 54/78 | 3/78 | 8/78 | 24 / 3 | 66/78 | no (not halved) |
| ms · B arm c (PERO > agy Flash) | 4.27 (2.79–5.88) | 47/78 | 6/78 | 21/78 | 10 / 1 | 40/78 | no |
| ms · **C Opus reader** | **0.06 (0–0.20)** | **77/78** | **0/78** | **0/78** | **39 / 0** | 78/78 | **yes** |
| inc · S stored | 1.92 (0.86–3.32) | 12/24 | 0/24 | 9/24 | — | — | — |
| inc · A agy Flash low @4 | 0.44 (0.10–0.85) | 19/24 | 0/24 | 1/24 | 10 / 0 | 24/24 | no (1 page ≤ 2) |
| inc · **L lite>opus** | **0 (0–0)** | **24/24** | **0/24** | **0/24** | **12 / 0** | 21/24 (3 UNCHANGED) | **yes** |

- The one confirmed Opus call: Pseudo-Lull recipes (`69b418a62b0edf3eaa2dd7f1` p84) have `per sese horas` where the
  hand has `per sex horas` (six hours). On the same page the stored text names a mercury sign as sulphur.
- What A and B leave: misreads of the hand at about three fifths (A) and five sixths (B) of S's rate, plus every page
  where their reply was cut and the stored text stands. On two such pages, A's and B's replies were both cut, so both
  served the stored text:
  - In the Latin recipe book `69b419052b0edf3eaa2de888` p37, the stored text has `℥` (ounce) for the hand's `ʒ`
    (drachm), a dose eight times wrong, and `Oleo balsamum` for `Oleum sesamini`.
  - In an alchemical manuscript (`69b418d42b0edf3eaa2ddfeb` p78), the stored text reads `noster etenim` as `non enim`.
    That negates the claim that the purified regulus is the one solvent.
  Opus read both pages with no serious call.
- **Arm c on hands** (the put-back rate the brief asked for). PERO's drafts of handwriting are noise: one page came back
  empty, and one draft tripped Gemini's prohibited-use filter. Of 59 corrector texts, 28 (47%) carried flip-risk flags,
  102 of them (73 numbers, 29 negations). On 9 pages, 13 changes were put back. On 19 pages the put-back could not be
  spliced (a tag in the span, or not word for word), so the stored text stands. The corrector tagged 52 of 78 pages
  handwritten, and the arm-c writer is print only, so as built it would write at most 6 of these pages.
- **agy read at 4 a call on hands.** 12 of 78 drawn pages came back cut before `<<<END>>>` and are not written. Many
  blocks were refused and their pages re-read one a call (`cli-ocr.mjs` falls back automatically).
- **Writes the guards would refuse.** `apply`'s 40% shared-words floor against the stored text would refuse 18 of 78
  Opus reads (23%), 7 of A's and 7 of B's. The stored Flash-Lite text on those pages is so far from the leaf that the
  correct read looks like a different text.

**Checks on the judge.**
- *Side by side versus alone* (`solo.mjs`, added after 9 packets, before any second-reader call). 10 books' S and C
  entries were judged again, each alone in its own packet, by a fresh reader. S: 4.61 per 1,000 alone against 6.54 side
  by side, with 21/30 and 18/30 accepted. C: 0 and 0, with 30/30 and 30/30 accepted. Judging side by side inflates the
  stored text's rate by about 40%, and Opus's lead holds either way.
- *Repeat on identical text.* Where A or B served S's exact text (50 page-entries), the confirmed count differed from
  S's own on 7 (14%): that is the judge's noise. Both "pages that gain invented text" were such pages. So the floor's
  second condition is counted on pages whose text differs; this was decided after the first look, and it moves no
  verdict.
- *Against the census.* The census judged the same stored pages at 2.94 per 1,000 OCR-side. This panel says 5.07, and
  4.61 alone: this judge, told to read the transcription only, finds more. Compare arms within this table, not with
  #7947's.
- **Same-family judge.** Opus judged Opus. No other family judged: this job had already spent its agy budget (below). The
  independent anchor is #6544, where expert transcriptions of 76 manuscript pages put Opus at 9.9% CER against 16.1%
  for Flash-Lite. That gap points the same way but is far smaller than 0.06 against 5.07, so read C's near-zero as "the
  judge finds nothing serious", not as error-free.

**Not tested.** Opus at 10 pages a call (production's default); the microfilm strips; later print; translation.

**Cost.**
- Claude subscription (list-equivalent): Opus reader $6.23 (78 pages, $0.08 a page); lite>opus $2.92 (24 pages);
  judging and second reading $60.84 (65 calls).
- agy: about 373 calls on the default pool (the job ledger, 09:10–09:50Z), **over the brief's 250**. The block refusals
  above more than doubled A's calls, and B used 99. Gemini weekly went from 17% to 15%.
- GPU: 26 s. No paid API, no Mongo writes. The readers' standard `lane_job_books` registry row was recorded (a label,
  not page data).

**Files.** `scripts/eval/latin-ms-reader-7947/` (sets, blocks, packets, second, solo, analyze; RULE.md and the two
addenda). `scripts/eval/results/latin-ms-reader-7947/`: analysis.json, defect-rates.json, the score file, and `run/`
(sets, served texts per arm, keys, every review and verdict, PERO drafts). Re-run: `node
scripts/eval/latin-ms-reader-7947/analyze.mjs --scratch scripts/eval/results/latin-ms-reader-7947/run --out
scripts/eval/results/latin-ms-reader-7947`. Raw reads: `$JOB_SCRATCH` (`/root/jobs/latin-ms-reader-7947/arms`, archived
to R2).
