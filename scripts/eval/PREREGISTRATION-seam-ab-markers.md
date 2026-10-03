# Pre-registration: page-seam A/B — Lite vs Lite again vs Lite+markers vs Flash+markers on mid-sentence breaks (#5678)

_Written 2026-10-03, **before the draw, before any paid call and before any arm output exists** (Hetzner job
seam-ab-5678). Harness: `scripts/eval/seam-ab-5678.mjs`. Judge text: `results/seam-ab-5678/JUDGE-PROMPT.md`. The
rule below is fixed now. Any change after the paid submit goes under "Amendments" with its date and reason, and the
rule is not rewritten._

PRIOR ART: `PREREGISTRATION-translation-seam-confirm.md` (#5305, the same lane, the same door and the same A/A2
design; it found prompt lines alone do not move block-door seams, 19/19/19). `experiments/2026-10-03-folio-markers-5678.md`
(markers on the Tengyur with Flash: median placement miss 0.51% vs 1.02%, 1 dropped marker in 49).
`experiments/2026-10-02-translation-page-boundary-3918.md` (Lite 3.18% vs Flash 1.26% of pages, unpaired and
confounded). The #5678 comment of 2026-10-03 09:48Z (26 served Lite breaks read by hand: 2 real defects, both at
mid-sentence breaks).

## The question

At a page break where the source sentence runs on to the next page:
1. Is the chained Batch lane's continuity defect the **model** (Flash-Lite vs Flash) or the **forcing** of each
   page's English to stand alone (one self-contained `<translation page="N">` per page)?
2. Do folio markers fix it on cheap Lite?

**Nothing is flipped by this study.** The marker flag stays off and no `pages`, `books` or `prompts` row is written.
Adoption is Derek's call.

## Arms

All four arms translate the **same two-page block (N, N+1)** through the chained lane's door:
- `buildBlockTranslationPrompt` with the live v13 prompt (md5 `516510147237b6a79d9d3f6e797bba7f`; the draw refuses
  any other);
- the stored translation of N−1 as the continuity seed, exactly as production seeds it;
- the adjacent pages' OCR, with `PAGE_BREAK_SCOPED`;
- Batch API, file input, `thinkingBudget: 0`, `maxOutputTokens = maxOutputTokensFor(pages)`, default temperature,
  production safety settings. This is `translate-batch-seam batchRequest`, so it matches production by
  construction.

| Arm | Model | Prompt |
|---|---|---|
| **A** | gemini-3.1-flash-lite | production: one `<translation page="N">` per page, markers off |
| **A2** | gemini-3.1-flash-lite | A again, an independent draw: the **noise floor** (its Batch job is submitted first) |
| **B** | gemini-3.1-flash-lite | `folioMarkers: true`: one continuous English text with `<pb n="N"/>` at each page turn (`FOLIO_MARKER_RULE`, as merged in #5682), split into page spans by `parseFolioMarkedText` |
| **C** | gemini-3-flash-preview | as B |

The design is not a full 2×2: there is no Flash arm without markers. So "model vs forcing" is read from the pattern
of A, B and C (see the decision rule).

## Sample (drawn by `--draw`, seed 5678; pinned by `--pin` after a by-eye screen of the SOURCE)

**Frame.** The seam-confirm frame:
- books with a `translate_batch_runs` record in mode `chained` that are served (`visible` and `pages_count > 0`);
- pages the lane wrote (`call_site = scripts/lib/translate-batch-chained.mjs`) with a continuity seed;
- not hand-edited, not an excluded page type, model a Gemini 3/3.1 Flash(-Lite).

**Filters.**
- Language: the book's language is Latin, German, French or Italian, **and** both pages' own OCR `<language>` tag is
  one of those four.
- Excluded: every book in the v14 or seam-confirm sample; a body (OCR minus furniture and the trailing `<vocab>`
  keyword line) under 400 characters on N or under 200 on N+1; N+1 of an excluded type; N−1 with no stored
  translation.

**Draw.** Books are visited in seeded order, and **one random lane page per book** is picked. It goes into the
candidate pool `pagebreak` if `sourceEndsOpen` says its source ends open, and into `control` otherwise. The pools are
filled to 150 and 30.

**By-eye screen (source only, before any arm output exists).** Every candidate's N-end and N+1-head body (the
keyword line stripped) is read in `screen.md`, and each gets one verdict in `screen.json`:
- `mid`: a **true mid-sentence break**. The last sentence of N's body is grammatically unfinished, and N+1's body
  continues it.
- `closed`: N's body ends a sentence, and N+1 starts a new sentence or a heading.
- `reject`: neither can be told (a list, a table, a recipe line, verse whose syntax cannot be judged, garbled OCR,
  or N+1 not continuous with N).

`--pin` takes, **in draw order**, the first **100** `pagebreak` candidates screened `mid` and the first **20**
`control` candidates screened `closed`. If there are not enough, the draw is extended by the same procedure, and an
amendment says so.

## Outcomes (per break, per arm)

Each break is judged by **two blind Claude Opus subagent judges**, independently. Each judge sees:
- the source end of N and the source start of N+1;
- all four arms' English for the end of N and the start of N+1. Editorial blocks (summary, keywords, meta, vocab)
  are removed, so a marker arm's spans and a page arm's pages look alike.

Arms are lettered at random per break, and no model or arm is named.

A judge flags, per version:
- **duplication**;
- **forced closure** (N's English closes a sentence the source continues, by supplied words or changed meaning; a
  full stop alone is recorded separately and does not count);
- **omission at the edge**;
- **words moved** across the turn (the import measure, and for the marker arms the misplacement of the marker in
  words);
- whether the sentence **reads across** the turn.

Per break, the judge also names the best seam, **with a tie allowed**. The full text is in `JUDGE-PROMPT.md`.

**Real seam defect**, per judge: `duplication || forced_closure || omission_edge || words_moved ≥ 6`. These are the
shapes of the 09:48Z read: moving a word or two across the break with nothing lost or doubled was judged good
continuity, so 1–5 moved words are reported but are not a defect.

The following count as a real defect **by construction** (the page has no English of its own):
- a block that does not parse into both pages;
- in a marker arm, a **dropped** or out-of-order marker for N+1.

**Primary measure:** per arm, the number of the 100 mid-sentence breaks with a real seam defect **flagged by both
judges** (consensus), with a Wilson 95% CI. Secondary: flagged by either judge.

**Mechanical, per arm:**
- duplication across the boundary (`duplicatedAcrossBoundary`).

**Mechanical, marker arms only:**
- dropped markers;
- text before the first marker;
- placement miss in words: the share of English words before the marker, minus the share of source words on page
  N, times the English word count.

## Judge controls

- **Plants.** In each of the 4 packets, 2 planted duplications and 2 planted forced closures, each as an extra
  version inside a page-break item. A planted duplication is A2's English with N+1's first English sentence also
  appended to N. A planted forced closure is B's span for N, ending mid-sentence, closed with ", and so the matter is
  settled." Plants are excluded from all arm counts. The share caught is reported. **If fewer than 3 in 4 plants
  are caught by a judge, that judge's verdicts are reported but the primary is recomputed on the other judge, and
  this is stated.**
- **Repeats.** 2 breaks per packet are shown again in the next packet under a new id with new letters. Repeat
  agreement and inter-judge agreement on "real defect" are reported.

The judges are 4 packets × 2 = **8 subagents**, each writing its verdicts to a file.

## Decision rule (fixed now; counts are breaks on the 100 mid-sentence breaks, consensus flag)

Let noise = |A2 − A|. Paired tests are the exact one-sided sign test on discordant breaks, alpha 0.10.

1. **Markers fix it on Lite** if B < A, and A − B > noise, and p(B vs A) < 0.10.
2. **Flash adds beyond markers** if C < B, and B − C > noise, and p(C vs B) < 0.10.
3. **Flash + markers beats production** if C < A, and A − C > noise, and p(C vs A) < 0.10.

The answer for Derek:
- **FORCING**: 1 holds and 2 does not. The defect is the per-page forcing; Lite with markers is as good as Flash
  with markers.
- **BOTH**: 1 and 2 hold.
- **MODEL**: 1 fails and 3 holds. Markers do not help Lite; the Flash arm does better.
- **UNRESOLVED**: none of the above. Reported as measured, with the counts.

**Guard (controls, 20 closed breaks):** B − A and C − A on the control count must each be ≤ max(1, |A2 − A|).
A guard failure is reported beside the answer as "effect with a cost".

Before any number is quoted, at least 5 breaks where the arms disagree most are read against their source. Three
example breaks (source and English) are quoted in the report.

## Spend

The --pin estimate is quoted in Amendment 1, and the hard cap is **$2**:
- 120 breaks × 4 arms = 480 two-page Batch requests: 360 Lite and 120 Flash.
- Expected about $0.6–1.0.
- The cap is enforced in two places. `--submit` refuses without `--approved-usd` ≤ $2. It also refuses unless the
  envelope `seam-ab-5678` (`set-scope.mjs`, `--lanes eval-seam-ab-5678`, so that no production worker can draw on
  it) has room.
- Usage is metered per book into `gemini_usage` (endpoint `eval/seam-ab-5678`).
- The envelope is removed when the run is collected.

## What this cannot say

- It measures Opus judges' flags on a window around the turn, not accuracy. A2 and the repeats bound the noise;
  the plants check sensitivity; neither validates the judges.
- Blinding is partial. A marker arm's page N often ends mid-sentence, which a judge can notice. The rubric says
  this is not a defect by itself.
- Only two-page blocks are tested. Production blocks are up to 8 pages, and the marker prompt's behaviour on longer
  blocks is untested here.
- There is no Flash arm without markers, so "model" is identified only through the pattern above.
- Latin-script languages only.

## Amendments

1. **2026-10-03, after the draw and screen, before submit (no arm output exists).**
   - **Draw.** 419 books were visited. Skipped:
     - 311 for book language;
     - 60 with no OCR on N+1;
     - 42 with no seeded lane page;
     - 22 prior-sample books;
     - 12 short OCR;
     - 10 for page language;
     - 4 with N+1 of an excluded type.
   - **Screen.** The 150 `pagebreak` candidates screened as 133 `mid`, 6 `closed` and 11 `reject`.
   - **The control pool was extended, as the rule allows.** The first 30 `control` candidates gave only 13
     `closed`: 10 of them were in fact mid-sentence (`sourceEndsOpen` misses an end like "…super Psal." or
     "…apud"). The pool was extended to 60 by the same seeded procedure (`--pool-control 60`). The `pagebreak`
     list is byte-identical, which was checked. The extension added 14 `closed`, 9 `mid` and 7 `reject`.
   - **Pinned:** 100 mid-sentence breaks and 20 closed controls. Languages by the page's own tag: Latin 117,
     German 2, French 1.
   - **Verdicts and reasons** are in `results/seam-ab-5678/screen.json`, and `candidates.jsonl` holds the
     candidates.
   - **Spend.** 480 Batch requests; the `--pin` estimate is **$1.569** (A2 0.311, A 0.311, B 0.316, C 0.631).
     The same estimator over-read seam-confirm by ~44% ($0.944 estimated, $0.531 actual). Approved at $1.90,
     under the $2 cap.
   - **Envelope.** Because a scope's book list is also a pause bypass for production workers, the
     `seam-ab-5678` scope is opened just before submit and removed just after it; it gates only this submit.
     Spend is metered per book under endpoint `eval/seam-ab-5678`.
2. **2026-10-03, after collect, before any packet was built or judged (a post-hoc secondary; the primary is
   unchanged).**
   - **What failed the literal parse.** It lost a page in 35 marker-arm blocks: B 22, C 13. A2 lost 2 blocks
     (production format, discarded by `parseBlockTranslations`).
   - **The marker failures are almost all numbering, not a missing turn.** Read from the raw responses:
     - **renumbered** (B 10, C 13): both markers are present and in order, but carry the **printed page number** from
       the OCR's `<page-num>` tag (`<pb n="97"/>` for sequence page 21) instead of the sequence number the prompt
       labels the page with.
     - **first-omitted** (B 11): the first page's marker is left out, page N's text stands before the one marker,
       and that marker is at the turn.
     - **unmarked** (B 1): the turn carries no marker.
   - **Why it was not seen before.** The Tengyur e-text has no `<page-num>`, so the #5678 run could not show it.
   - **The primary is computed as registered.** Every literal failure is a defect by construction.
   - **Beside it, post hoc, the same rule on a positional reading** (`positionalSpans()` in the harness):
     - the markers are read by position, with their numbers ignored;
     - in a block missing only its first marker, the text before the remaining marker is page N;
     - only an **unmarked** turn stays a defect by construction.
   - **What the judges see.** They judge the positional spans for the marker arms. Under the literal rule their
     verdicts on the 35 blocks do not enter the primary, because those blocks are already defects. Under the
     positional rule they do.
   - **What the report must say.** It quotes the primary first. It may quote the positional reading only as post
     hoc, and only as the answer to "do markers fix the seam once the numbering bug is fixed". The numbering fix
     itself (sequence numbers in the prompt, or a positional parser) is out of scope here, and is reported as a
     finding for #5678.

## Result (2026-10-03)

The numbers are in `results/seam-ab-5678/report.json` (`decision`). Every count below is breaks out of the 100
true mid-sentence breaks with a real seam defect, flagged by both judges, with Wilson 95% intervals.

**Noise floor, read first:**
- A: 21 (14–30%).
- A2: 26 (18–35%).
- |A − A2| = 5 (10 vs 5 discordant breaks).

**Primary, as registered (literal parse): UNRESOLVED.**
- B: 28 (20–38%). 17 of its 28 are blocks the literal parse could not split.
- C: 18 (12–27%). 11 of its 18 are such blocks.
- Clause 1 (markers fix Lite) fails: B is worse than A.
- Clause 2 (Flash beyond markers) holds: C vs B is 8 vs 18 discordant, p 0.038.
- Clause 3 (C beats production) fails: C vs A is 12 vs 15 discordant, p 0.35.
- The control guard fails for B (5 vs 1, all of them parse failures) and holds for C (2).

**Post hoc, Amendment 2 (positional reading): MODEL.**
- B: 15 (9–23%).
- C: 8 (4–15%).
- B vs A: A − B = 6 > noise, but 5 vs 11 discordant, one-sided p 0.105, which misses 0.10.
- C vs A: 5 vs 18, p 0.005.
- C vs B: 2 vs 9, p 0.033.
- Controls: 1 / 1 / 0 / 0.

**Defect kinds, both judges (A / A2 / B / C):**

| Kind | A | A2 | B | C |
|---|---:|---:|---:|---:|
| Forced closure | 12 | 15 | 6 | 1 |
| Duplication | 5 | 8 | 1 | 0 |
| Words moved ≥ 6 | 6 | 9 | 5 | 5 |
| Edge omission | 4 | 6 | 4 | 3 |

So markers on Lite halve forced closures and nearly remove duplication, but do not stop the import. Flash with
markers removes almost all closures.

**Judges:**
- Plants caught: 32 of 32.
- Inter-judge agreement on "real defect": 475 of 480.
- Repeat agreement: 59 of 64.

**Spend:** $0.848 (480 Batch requests). The `gemini_usage` meter matches: $0.848 over 480 rows. The envelope was
opened for the submit only and is removed.
