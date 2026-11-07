<!-- PRIOR ART: scripts/eval/PREREGISTRATION-bench-translation-7499.md (the panel, A-vs-A floors, non-inferiority form) and scripts/eval/notes-layer-5942/PREREG.md (the note judge: one Opus call per page, arms pooled and hidden). This registers the notes-step gate of #7965 step 3, which neither covers. -->
# Pre-registration: the notes step vs inline v21 notes (#7965, step 3)

Committed before any judge call (2026-11-03). Generation (the reads below) had started; no read was looked at beyond
checking that the replies parse.

## Question

Under the PLAIN translation prompt, a page's notes come from a second call (the notes step). Are those notes no less
truthful than the notes v21 writes inline today, and do they attach to words of the PLAIN text?

## Arms (per engine)

- **(a) v21 inline.** v21 (= `buildV21(v13)`, the default since 2026-10-31) sent exactly as the #7499 bench sent v13:
  the same composed request (previous page's English, neighbours' OCR, page-break block, CLI suffix on agy) with the
  life-words block stacked (`notes-step-7965/lib.mjs v21Request`). Notes = the commentary annotations of type note,
  definition or original that `annotation-layer/3` (`splitAnnotations`, the backfill's parser) takes out of the read.
- **(a2) v21 again**, the identical request, on the 50 #6728 floor pages: the A-vs-A floor.
- **(b) notes step on PLAIN.** `notes-step/v1` (`lib.mjs NOTES_STEP_V1`, md5 `a37be812a95ab0ac3729ab00a4a6fa90`): v21's
  notes / term / gloss / original instructions, examples, life-words block and note style, lifted into their own prompt.
  Input: the page's transcription, the clean text (`splitAnnotations(...).text`) of the PLAIN read #7499 kept for that
  engine, and the previous page's notes (the commentary of the stored previous page's English that the #7499 request
  carried; a proxy for the step's own notes on the previous page). Output: JSON `{annotations:[{type, anchor, body}]}`,
  stored shape `{type, anchor, body, source: "notes-step/v1"}`. Image descriptions, summary, keywords and `<meta>` are
  not asked for.

## Engines and panel

#7499's frozen panel (`scripts/eval/bench-translation/manifest.json`).

| engine | channel | reads | judged pages |
|---|---|---|---|
| 3.8 Flash low | `agy -p` only | (a) and (b) on the #6545 132; (a2) on the floor 50 | the 132 |
| flash-lite `gemini-3.1-flash-lite` (paid) | Batch only, cap $3 (`--cap-usd 3`) | (a) and (b) on all 365; (a2) on the floor 50 | the 132 + 68 others drawn with seed 7965 (`judge.mjs LITE_EXTRA`) = 200 |

The PLAIN reads are #7499's (`gex45:/root/jobs/prompt-bench-7499/w/arms/{flash38,lite}-plain.jsonl`), not re-run.

## Judge

Blind Opus via `claude -p` (`route-judge-6740 opusCall`: Read only, API keys stripped), page image attached, one call
per judged page. The item shows the page's transcription and every arm's notes as lists under shuffled letters (A/B, or
A/B/C on floor pages), each note with the words it is attached to. Prompt: `notes-step-7965/judge.mjs JUDGE_PROMPT`, md5
`0e4f659a7a6cadfa0ae6409ca96a02b0`. Per note: `claim` (correct / wrong / partly_wrong / unsupported / unverifiable /
no_claim: #5647's classes plus "unsupported"), `restates`, `attached`, `kind` (image / original / definition / context /
clarification). An item whose reply does not parse is re-sent, at most 3 tries in all.

**Control (gate).** On 20 judged pages per engine (seed 7965) one EXTRA note is planted in one list: either a real
note of that list with a number moved (a year +170, a count +300 or +7), or a real arm-(a) note from another book's
page. Planted notes are excluded from every rate. **Gate: ≥ 16 of 20 plants per engine get claim wrong, partly_wrong or
unsupported.** An engine whose judge fails the gate gets no verdict.

## Measures

Unit: a note shown to the judge (plants excluded). Rates are ratios over notes, intervals by a page bootstrap (2,000
draws, seed 7965), 95%.

- **Primary — false-claim rate:** notes with claim wrong, partly_wrong or unsupported, per 100 notes, excluding notes
  the judge classes kind = image (v21 wraps image descriptions in `<note>`; PLAIN keeps the OCR's `<image-desc>` in its
  own tag and the step is not asked for them). Also reported with image notes included.
- **Anchor resolution (b):** a note's `anchor` occurs in the PLAIN clean text exactly once, either exactly or after
  folding quotes and whitespace (`lib.mjs placeAnchor`: `exact` or `fuzzy`). A phrase that occurs more than once counts
  as a MISS (its place is not known). Over every (b) note on every page the step ran on (Flash 132, lite 365). The
  lenient rate (found at all) is reported beside it.
- Secondary, reported, not gating: restating notes per 100; unverifiable per 100; notes attached to the wrong words per
  100; pages with zero notes; notes per page; output tokens per page (a: the v21 read; b: the PLAIN read + the step);
  replies that do not parse.

## Rule (per engine)

Let D = rate(b) − rate(a) on the judged pages and D0 = rate(a2) − rate(a) on the floor pages, both per 100 notes.

- **Margin** M = max(1.0, |lower bound of D0|, |upper bound of D0|).
- **Pass** when the upper 95% bound of D ≤ M **and** anchor resolution of (b) ≥ 98%.
- **Fail** when the upper bound of D > M, or anchor resolution < 98%. A D whose lower bound exceeds M is reported as
  "worse".
- Decision for #7965 step 4 per engine: pass → that engine's lane may switch new pages to PLAIN + notes step (with
  whatever the secondary measures show listed as fixes); fail → not, and what to fix.

## Stops

- Claude weekly meter ≥ 85% or 5-hour ≥ 95% (`judge.mjs run`, checked every 5 minutes): judging stops. Flash is
  judged first. An engine judged on fewer pages than planned is decided at the n reached, said so, if its gate holds.
- Lite spend: `--cap-usd 3` (ledger + estimates of open jobs). Logged in the ops spend ledger.
- No production writes: reads go to `$JOB_SCRATCH/w`, never to `pages` or `page_annotations`.
