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

(none yet)
