# Pre-registration: confirmatory folio-marker A/B with the positional parser — do markers go ON in the chained lane? (#5678)

_Written 2026-10-03, **before the draw, before any paid call and before any arm output exists** (Hetzner job
markers-confirm-5678). Harness: `scripts/eval/seam-markers-confirm-5678.mjs`. Judge text:
`results/seam-markers-confirm-5678/JUDGE-PROMPT.md`, a byte copy of `results/seam-ab-5678/JUDGE-PROMPT.md`. The rule
below is fixed now. Any change after this commit goes under "Amendments" with its date and reason, and the rule is
not rewritten._

PRIOR ART: `PREREGISTRATION-seam-ab-markers.md` and `experiments/2026-10-03-seam-ab-markers-5678.md` (#5701, the
run this one confirms: UNRESOLVED by its registered rule because the literal marker parse failed; read by position,
post hoc, A 21 / A2 26 / Lite + markers 15 / Flash + markers 8). `experiments/2026-10-03-folio-positional-parse-5678.md`
(#5719: the positional reading is now the lane's parser; no model run). `PREREGISTRATION-translation-seam-confirm.md`
(#5675: prompt lines alone do not move block-door seams). None of them has a Flash arm without markers, a
non-Latin-script page, or a registered positional parse.

## Why a second run

#5701's positional numbers were read after the outputs existed, and it had no Flash arm without markers. So it
cannot decide either question below. This run registers the positional parser, adds the missing arm and draws a
fresh sample.

## The questions

1. **Do folio markers go ON for the chained translation lane** (Flash-Lite, flag `TRANSLATE_FOLIO_MARKERS`
   currently off)?
2. **Is the seam effect the model or the markers?**

This study itself flips nothing: no `pages`, `books` or `prompts` row is written. If question 1 comes out YES by
the rule below, a separate PR turns the markers on by default; it is `tier:hold` and waits for Derek.

## Arms

All five arms translate the **same two-page block (N, N+1)** through the chained lane's door, as in #5701:
- `buildBlockTranslationPrompt` with the live v13 prompt (md5 `516510147237b6a79d9d3f6e797bba7f`; the draw refuses
  any other);
- the stored translation of N−1 as the continuity seed;
- the adjacent pages' OCR, with `PAGE_BREAK_SCOPED`;
- Batch API, file input, `thinkingBudget: 0`, `maxOutputTokens = maxOutputTokensFor(pages)`, default temperature,
  production safety settings (`translate-batch-seam batchRequest`).

| Arm | Model | Prompt |
|---|---|---|
| **A** | gemini-3.1-flash-lite | production: one `<translation page="N">` per page |
| **A2** | gemini-3.1-flash-lite | A again, an independent draw: the **noise floor** (its Batch job is submitted first) |
| **B** | gemini-3.1-flash-lite | `folioMarkers: true` (`FOLIO_MARKER_RULE` as on main after #5719) |
| **C** | gemini-3-flash-preview | as B |
| **D** | gemini-3-flash-preview | as A: no markers |

**Parse, fixed now.**
- Marker arms (B, C): `parseFolioMarkedText` as on main (positional: literal / renumbered / opener-missing /
  partial / rejected), with the block lane's rule that a page listed in `overrun` is left undrafted
  (`translate-batch-seam parseBlockResponse`).
- Page arms (A, A2, D): `parseBlockTranslations`, as the chained lane collects.
- No other reading of a response is used for any number in the report.

## Sample (seed 56782; pinned by `--pin` after a by-eye screen of the SOURCE)

**Frame.** As #5701:
- books with a `translate_batch_runs` record in mode `chained` that are served (`visible` and `pages_count > 0`);
- pages the lane wrote (`call_site = scripts/lib/translate-batch-chained.mjs`) with a continuity seed;
- not hand-edited, not an excluded page type, model a Gemini 3/3.1 Flash(-Lite).

**Excluded books:**
- every book #5701 drew as a candidate (210);
- every book in the #5675 seam-confirm sample and the v14 A/B sample;
- the three Tengyur volumes of the #5682 preview;
- books whose language is English (they take the modernization prompt).

**Script strata.** A page's script is the script that most of its body's letters are in. Both pages of a break must
be at least 75% in the same script. Groups:
- `latin`: Latin script, and, as in #5701, the book's language and both pages' OCR `<language>` tag are Latin,
  German, French or Italian;
- `tibetan`;
- `han` (Chinese);
- `other`: Greek, Hebrew, Arabic, Cyrillic or Devanagari.

Body minimum (OCR minus furniture and the `<vocab>` line): 400 characters on N and 200 on N+1; for `han`, 150 and
80. N+1 is not an excluded page type. N−1 has a stored translation.

**Draw.** Books are visited in seeded order, and **one random lane page per book** is picked. A candidate goes to the
`pagebreak` pool if its source seems to stop mid-sentence (`sourceEndsOpen`; for Tibetan, the body does not end in
a shad), and to the `control` pool otherwise. Pools: `pagebreak` 95 Latin + 18 Tibetan + 18 Han + 18 other;
`control` 36 + 6 + 6 + 6.

**By-eye screen (source only, before any arm output exists).** Every candidate's N-end and N+1-head body is read in
`screen.md`, and each gets one verdict in `screen.json`, by the same definitions as #5701:
- `mid`: a **true mid-sentence break**. The last sentence (or, in Tibetan or Chinese, the last clause or verse
  line) of N's body is unfinished, and N+1's body continues it.
- `closed`: N's body ends a sentence, and N+1 starts a new sentence or a heading.
- `reject`: neither can be told (a list, a table, a recipe line, verse whose syntax cannot be judged, unpunctuated
  text where the reader cannot place the clause boundary, garbled OCR, or N+1 not continuous with N).

The screener is Claude, one pass.

**Pin.** In draw order, the first passing candidates up to these quotas:

| | Latin script | Tibetan | Han | other non-Latin | total |
|---|---:|---:|---:|---:|---:|
| true mid-sentence breaks (`mid`) | 70 | 10 | 10 | 10 | **100** |
| closed controls (`closed`) | 14 | 2 | 2 | 2 | **20** |

A non-Latin group short of its quota is filled from the other non-Latin groups, in draw order. If the pools are
still short, the draw is extended by the same seeded procedure (`--pool-scale`), and an amendment says so.

## Outcomes (per break, per arm)

As #5701, with five versions per break instead of four. Each break is judged by **two blind Claude Opus subagent
judges**, independently. Each judge sees the source end of N and start of N+1, and every arm's English for the end
of N and the start of N+1 (editorial blocks removed), lettered at random per break, no model or arm named. The
judge text is #5701's, unchanged. The task message that hands a judge its packet adds one sentence, fixed now:

> Some sources in this packet are not in Latin script (Tibetan, Chinese, Greek, Hebrew, Arabic, Russian,
> Sanskrit). The same rules apply. Where the source has no word spaces, count one Chinese character or one Tibetan
> syllable as a word.

**Real seam defect**, per judge: `duplication || forced_closure || omission_edge || words_moved ≥ 6`.

A block that leaves **either page undrafted** under the parse above is a real defect **by construction** (the page
has no English). It is also counted in the parse-failure guard.

**Primary measure:** per arm, the number of the 100 mid-sentence breaks with a real seam defect **flagged by both
judges** (consensus), with a Wilson 95% CI. Secondary: flagged by either judge. Reported beside them, not powered:
the same counts for Latin-script (70) and non-Latin-script (30) breaks, and per group.

## Judge controls

As #5701:
- **Plants.** Per packet, 2 planted duplications (A2's English with N+1's first English sentence also appended to
  N) and 2 planted forced closures (B's span for N, ending mid-sentence, closed with ", and so the matter is
  settled."), each as an extra version inside a page-break item. Plants are excluded from all arm counts. **A judge
  who catches fewer than 3 in 4 of their plants is set aside: for that packet the flag is the other judge's alone,
  and this is stated.**
- **Repeats.** 2 breaks per packet are shown again in the next packet under a new id with new letters. Repeat
  agreement and inter-judge agreement on "real defect" are reported.

Packets: 8, of 15 breaks plus 2 repeats each; 8 × 2 = **16 judge subagents**, each writing its verdicts to a file.

## Decision rule (fixed now; counts are breaks on the 100 mid-sentence breaks, consensus flag)

Let noise = |A2 − A|. "X beats Y" means: X < Y, and Y − X > noise, and the exact one-sided sign test on discordant
breaks gives p < 0.10. No correction is made for testing two primaries; both p-values are quoted.

**Primaries**
- **T1, markers on Lite:** B beats A.
- **T2, markers on Flash:** C beats D.

**Secondaries**
- **S1, model without markers:** D beats A.
- **S2, model with markers:** C beats B.
- C vs A, and B vs A2 (does B also sit below the second Lite draw?), are reported with their discordant counts.

**Guards** (for B against A; the same for C against D):
- **Controls (20 closed breaks):** B − A on the control count ≤ max(1, |A2 − A| on controls).
- **Omission:** B − A on the count of breaks with an edge omission flagged by both judges ≤ max(2, |A2 − A| on that
  count).
- **Parse failures:** blocks of the 120 with a page left undrafted: B ≤ max(A, A2) + 2 (for C: C ≤ D + 2). **Every
  undrafted page is listed in the report, whatever the guard says.**

**Question 1, markers ON for the chained lane:**
- **YES** if T1 holds and all three guards hold for B. The separate PR is opened.
- **EFFECT WITH A COST** if T1 holds and a guard fails. No PR; the cost is reported.
- **NO** if T1 fails. The flag stays off. If T2 holds while T1 fails, that is said in those words: markers help on
  Flash, which is evidence for the Flash routing decision and not for turning markers on in the Lite lane.

**Question 2, model or markers:**
- **MARKERS**: T1 or T2 holds, and neither S1 nor S2.
- **MODEL**: S1 or S2 holds, and neither T1 nor T2.
- **BOTH**: at least one of T1/T2 and at least one of S1/S2.
- **UNRESOLVED**: none holds. Reported as measured, with the counts.

Before any number is quoted, at least 5 breaks where the arms disagree most are read against their source. Three
example breaks (source and English) are quoted in the report.

## Spend

- 120 breaks × 5 arms = 600 two-page Batch requests: 360 Lite and 240 Flash.
- Expected about $1.5 (#5701: $0.848 for 480 requests, 120 of them Flash). **Hard cap $4**, enforced twice:
  `--submit` refuses without `--approved-usd` ≤ $4, and refuses unless the envelope `markers-confirm-5678`
  (`set-scope.mjs`, `--lanes eval-markers-confirm-5678`, a lane label no worker uses) has room.
- The Batch API has no path through `gemini-script-client` (`callGemini` is realtime only). The requests are
  production's own (`batchRequest`, thinking 0), and each response is metered per book into `gemini_usage` through
  the same `logUsage` writer that client uses, under endpoint `eval/markers-confirm-5678`.
- As in #5701, a scope's book list is also a pause bypass for production workers, so the envelope is opened just
  before the submit and removed right after it.

## What this cannot say

- It measures Opus judges' flags on a window around the turn, not accuracy. A2 and the repeats bound the noise;
  the plants check sensitivity; neither validates the judges.
- Blinding is partial: a marker arm's page N often ends mid-sentence, which a judge can notice. The rubric says
  this is not a defect by itself.
- Only two-page blocks are tested. Production blocks are up to 8 pages; marker behaviour on longer blocks is known
  only from the 11 Tengyur blocks of #5682.
- The non-Latin stratum (30 breaks, 10 per group) shows direction, not a rate. The judges and the screener read
  Tibetan and classical Chinese less surely than Latin.
- With 100 breaks and a noise floor near 5, an effect the size #5701 saw on Lite (about 6 to 11 breaks) may again
  fall short of p < 0.10. If so the answer is NO or UNRESOLVED as measured; the sample is not extended after
  outputs exist.

## Amendments

1. **2026-10-03, after the draw and the by-eye screen, before submit (no arm output exists).**
   - **First draw** (seed 56782): every pool filled (95 / 18 / 18 / 18 open-end; 36 / 6 / 6 / 6 closed-end), 203
     candidates.
   - **First screen.** `mid` among the open-end candidates: Latin 84 of 95, Tibetan 7 of 18, Han 14 of 18, other 4
     of 18. Non-Latin `mid` total 25, short of 30, so the fill rule could not complete the sample.
   - **The non-Latin pools were extended, as the rule allows**, by the same seeded procedure with the non-Latin
     pools doubled (`--pool-scale-nonlatin 2`, a flag added for this: scaling every pool would have added Latin
     candidates nobody needs). Checked: all 203 first-draw candidates are kept, the Latin list is identical, and each
     non-Latin pool's first-draw list is a prefix of its extended list. The `other` open-end pool ran out of frame at
     30 (of 36 asked). 66 new candidates were screened; 269 in all.
   - **Why so many non-Latin rejects.** Tibetan: 22 of 36 open-end candidates rejected, most because N+1's OCR is
     not the continuation (it opens "Folio 1" / "Top Section" with another text, or picks up elsewhere). Other: 18 of
     30 (garbled or looped OCR, verse, unpunctuated Arabic where the break falls between coordinated clauses).
   - **Final screen tally, open-end pools (`mid` / `closed` / `reject`):** Latin 84 / 6 / 5; Tibetan 14 / 0 / 22; Han
     26 / 2 / 8; other 10 / 2 / 18. Closed-end pools (`closed` / `mid` / `reject`): Latin 17 / 6 / 13; Tibetan 1 / 0 /
     11; Han 3 / 1 / 8; other 6 / 0 / 6.
   - **Pinned: 100 mid-sentence breaks** (70 Latin script, 10 Tibetan, 10 Han, 10 other) **and 20 closed controls**
     (14 Latin script, 1 Tibetan, 2 Han, 3 other). The Tibetan control quota was one short and was filled, by the
     fill rule, with one `other` control.
   - **Languages** (page tag): mid-sentence breaks are Latin 68, German 1, Italian 1; Tibetan 10; Chinese 10;
     Arabic 3, Malay in Arabic script 1, Persian 1, Russian 2, Hebrew 1, Greek 1, Sanskrit 1. Controls: Latin 13,
     German 1, Tibetan 1, Chinese 2, Hebrew 1, Sanskrit 2.
   - **Screen rulings applied throughout** (all on the source, nothing an arm wrote):
     - a catchword repeated at the head of N+1 is not text of N;
     - a page that ends a sentence and carries only a split syllable of the next one is `reject`;
     - unpunctuated Arabic or Chinese where the break falls between clauses is `reject`, because the sentence end
       cannot be placed;
     - a Tibetan page ending in a shad after a continuative ("…pas", "…na", "…shing", "…ni") is not `closed`.
   - **Verdicts and reasons** are in `results/seam-markers-confirm-5678/screen.json`; `screen.md` is what was read.
   - **Spend.** 600 Batch requests; the `--pin` estimate is **$2.266** (A2 0.321, A 0.321, B 0.327, C 0.654,
     D 0.642). The same estimator over-read #5701 by 85% ($1.569 estimated, $0.848 actual), so the expected actual
     is about $1.2 to $1.6. Approved at $2.50, under the $4 cap.
   - **Envelope.** `markers-confirm-5678`, $4, lanes `eval-markers-confirm-5678`, opened just before the submit
     and removed right after it.
2. **2026-10-03, after the first collect attempt, before any packet was built or any output was read.**
   - **The three Lite Batch jobs died server-side.** A2, A and B (submitted 22:29Z) ended at 22:33Z in state
     `BATCH_STATE_CANCELLED` with `successfulRequestCount: 120`, error `code 13: "failed without error"` and **no
     output file**. Nothing in this repo cancels a Batch job by name, and the three ended within three seconds of
     each other; the two Flash jobs, submitted seconds later, succeeded. No Lite output exists.
   - **Resubmitted unchanged**: the same 120 requests per arm, in the registered order (A2, A, B). The dead jobs
     stay in `batch.json` under `dead_jobs`. Whether Google bills a job that dies like this is not known; for the
     cap they are counted as billed at their estimate ($0.97), which with the full estimate ($2.27) is $3.24,
     under $4.
   - **Two Flash + markers requests (arm C) returned an API error, not a response** (`code 1: "The operation was
     cancelled."`): `69e7ab425f…:214` and `69c1bad585…:45`. **Rule added now, for every arm:** a request that comes
     back as an API error with no response is asked once more (as the lane would re-queue it); if it errors again it
     counts as undrafted. A response that exists is never re-asked, whatever it contains.
   - **What had been seen when this was written:** only counts. C parsed `literal` in all 118 responses; D left one
     block with a page undrafted. No English had been read.
   - C and D actual spend: $0.347 + $0.358 = $0.705.

