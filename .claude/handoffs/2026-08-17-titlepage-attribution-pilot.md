# Title-page attribution — pilot, corpus run, and a measured benchmark (2026-08-17)

Started as triage of four small attribution issues (#3948–#3951). Ended with a
method for letting books state their own authorship, measured against a random
sample with blind adjudication. PR **#3982** carries the whole arc.

## Shipped and merged

| PR | What |
|---|---|
| #3962 | Four attributions repaired in production (#3951 C+D) |
| #3967 | Description-vs-title contamination signal (#3949) |
| #3972 | Four false-positive classes removed from the review queue (#3950) |
| #3963 | New issue: 56 contested author routing keys — **sequenced before any resolver change** |

Review queue 109 → 100 rows; `ai_value_suspect` now names its reason.

## The pilot (PR #3982, open)

**Question:** can a book's own front matter say who wrote it? We hold the scans
and had never read them for this — every byline came from a catalogue record.

- **Regex pass: NEGATIVE.** Fires on ~5% of pages; captures offices and
  dedicatees. `title-page-attribution.mjs` was built for clean catalogue strings
  and does not transfer to page text. Committed so nobody repeats it.
- **Model pass: works.** ~90% precision on a Latin-script control, each proposal
  carrying page number, page type, and a quoted line verified present on that
  page. **3,856 books read for $1.92.** 1,239 gained a candidate.
- **Non-Latin: parked at ~52%.** Four named causes (御定 as authorship, 輯注/繪圖
  compounds, volume headers read as bylines, cited persons). Do not ship.
- **Nothing written to Mongo.** Evidence is JSONL.

## The benchmark (the part worth keeping)

Random 50 from the 161-book pool, **frozen before any page was read**. 50
independent subagent readers vs flash-lite. Only discordant rows adjudicated,
answers unlabelled, A/B order randomised.

> subagent 17 · flash-lite 1 · neither 1 — **McNemar p = 0.00014**

On 17 of 19 contested books the page names **no author** and flash-lite proposed
one anyway. Implied precision ~94% vs ~60%.

**Limits, all structural:** measures precision not recall (the pool is "books
where flash-lite fired", so it can never be the reader that declines); the
adjudicator shares a model family with one reader; the 28 concordant rows were
never checked.

## Where to pick up

1. **Two-tier design** — flash-lite for coverage, subagents for adjudication where
   a relationship judgement is at stake, human only on what those two dispute.
   ~4M subscription tokens for 70 subagents, so tiering is the point.
2. **Front-matter capture** — Derek's idea. 19% of books state their printer on
   the page and nobody can search it. Store as evidence with the OCR prompt
   version, not as metadata.
3. **Non-Latin prompt v5** against the pinned control before any re-run.
4. **Blocked:** `ANTHROPIC_API_KEY` in `.env.production.local` returns 401. The
   Sonnet head-to-head harness runs unchanged once it's replaced.
5. **For a human:** the review page at
   https://claude.ai/code/artifact/efc550b5-8b52-4273-860e-4a993ac2d38b — written
   for a bibliographer, with the failure modes stated.

## The through-line, which is not about attribution

**Six times this session a Latin-only text operation reported non-Latin content
as absent rather than as unjudgeable** — prompt, verifier, comparator, date rule,
validator, quote guard. Each fix was trivial; nothing caught the pattern, because
everything gets written and tested against Latin text. The 87%-of-proposals-
discarded moment was a guard that could not read the script it was checking.

Second: **every number I asserted without measuring was wrong, in both
directions.** "Decisive" at p=0.070. A 42.9% that was really ~52% because the
comparator couldn't judge CJK. A $0.71 that was $1.92. A "safest slice" that was
the least accurate one. The corrections are in the commit messages, not buried.
