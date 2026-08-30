# Random-50 benchmark, blind adjudication — 2026-08-17

Replaces the convenience-sampled 20-book benchmark, which could not carry a
significance claim (McNemar p = 0.070 on 18 rows) and was scored against a truth
table written by the same person who scored it.

## Method

- **Sample**: 50 drawn at random from the 161-book pool (Latin-script, no real
  byline), **frozen to disk before any page was read** so it could not drift
  toward whatever the readers turned out to be good at.
- **Readers**: 50 independent Claude subagents, one book each, no shared context,
  no knowledge of the other reader's answer — against gemini-3.1-flash-lite's
  existing proposals from the full corpus run. Same pages, same task.
- **Adjudication**: only the DISCORDANT rows (the only rows McNemar can use).
  Each adjudicator saw the pages plus two unlabelled answers, **A/B order
  randomised per case** (the reader was "A" in 9 of 20). The mapping was held in
  a separate key file the adjudicator never saw.

## Result

|  | |
|---|---|
| scored rows | 48 (2 unparseable) |
| concordant — both name the same person | 28 |
| **discordant** | **20** |
| …reader says nobody, flash-lite names someone | **20** |
| …the other direction | **0** |

Blind adjudication of the discordant rows (19 returned):

|  | |
|---|---|
| subagent correct | **17** |
| flash-lite correct | 1 |
| neither correct | 1 |

**McNemar exact, two-sided, on 18 decided pairs: p = 0.00014 — significant.**

On **17 of 19** contested rows the adjudicator found that **the page names no
author at all** and flash-lite had proposed one anyway. That is the same failure
class the first benchmark identified, now measured on a random sample with the
labels hidden.

## What this does and does not establish

**Does**: where the two readers disagree, the subagent is right far more often,
and flash-lite's dominant error is inventing an author for a book whose front
matter is genuinely anonymous. Taking the 28 concordant rows as correct — which
they were not adjudicated to confirm — the implied precision is roughly 94% for
the subagent against 60% for flash-lite.

**Does not**:

1. **Measure recall.** The pool is "books where flash-lite proposed an author",
   so flash-lite names someone on every row by construction and can never be the
   reader that declines. Books where it wrongly stayed silent are not in the
   sample. The 20-0 discordance direction is therefore partly built in by the
   frame — what the adjudication adds is *which* reader was right, and that part
   is not built in.
2. **Escape model-family bias.** The adjudicator is Claude, as is one reader.
   Randomised order and unlabelled answers remove position and label bias; they
   do not remove family bias. A human or third-family judge would be stronger
   evidence, and the API key needed for a Gemini adjudicator is dead.
3. **Score the concordant rows.** 28 rows where both readers agreed were never
   checked. If they share a blind spot, this design cannot see it.

## Cost

~70 subagents at ~57K subscription tokens each ≈ 4M tokens. Not billed, but not
scalable to 3,905 books either. The two-tier design stands: flash-lite for
coverage, subagents for adjudication where a relationship judgement is at stake.
