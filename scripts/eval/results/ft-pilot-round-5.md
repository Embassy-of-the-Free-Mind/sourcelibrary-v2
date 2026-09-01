# FT expanding-pilot — Round 5

*Protocol: #2880. Contract: `.claude/docs/ft-verdict-contract.md`. Measure-only —
NO public-badge flips. Round record; the tier-3 detail lives in
`r5-tier3-manual.md`, the oracle brief in `r5-oracle-brief.md`.*

## Why this round exists

Rounds 1–4 converged on 2026-06-30 and recommended STOP. **The arithmetic was
never done.** The rates were measured, written up, and never multiplied by the
population, so the project's public figure remained `~5,000 [4,000–6,500]` from
`first-translation-history.md` — a number built on the 462-study's **46%**
badged-genuine rate, which used the OLD `not_applicable` rubric that Derek's
July Policy 1 and Policy 2 superseded. Under the corrected rubric the badged
rate is 74%, and the eligible pool has grown 14,106 → 16,151.

Round 5's job was to tighten every stratum to ±5pp so the figure could finally
be stated with a real interval.

## 1. Design

**Pool** (16,151): live (`visible` + `pages_count > 0`), source language not
English, and we hold a translation (`pages_translated > 0`).

**Strata**: badged × western/non-western — the axes that moved measured accuracy
in rounds 1–4, kept identical so samples pool.

**Draw**: 1,165 books, excluding the 208 already judged, seeded and reproducible
(`ft-pilot-sample.mjs --round=5`).

| stratum | N | prior rounds | drawn now |
|---|---|---|---|
| badged · western | 4,001 | 52 | +299 |
| badged · non-western | 1,790 | 52 | +265 |
| unbadged · western | 7,537 | 52 | +314 |
| unbadged · non-western | 2,823 | 52 | +287 |

**Three tiers, escalation sets pre-registered in the sampler** before any result
was seen (tier 3 ⊂ tier 2 ⊂ tier 1, so three-way agreement is measurable):

- **Tier 1** — grounded Gemini (`gemini-3-flash-preview`, `thinkingBudget: 512`;
  flash-lite does not ground) over all 1,165. **Spend $1.45** of a $6 cap.
- **Tier 2** — unprimed Claude subagents, one per book, told to REFUTE, with a
  thoroughness floor. 30 completed.
- **Tier 3** — manual read of **our own scans** by the main session, 16 books,
  judgments written to disk before any other tier reported.

## 2. Tier-1 results (n ≈ 250 per stratum)

| stratum | n scored | "no prior" | 95% Wilson |
|---|---|---|---|
| badged · western | 267 | 79.0% | [73.7–83.5] |
| badged · non-western | 212 | 85.4% | [80.0–89.5] |
| unbadged · western | 254 | 38.6% | [32.8–44.7] |
| unbadged · non-western | 255 | 47.1% | [41.0–53.2] |

Tier 1 is **not** ground truth (rounds 1–4 measured it at precision(first) ~85%,
recall ~83%), so these are reported beside the oracle rate, never substituted
for it.

## 3. The corpus estimate

Oracle rates (rounds 1–4) × current population, via `inference.ts`
(Wilson + finite-population correction):

**≈ 8,565 books never previously translated into English, 95% CI 7,362–9,768**,
out of 16,151 eligible.

## 4. The finding that matters most: where the two instruments agree

| stratum | Tier 1 (n≈250) | oracle (n=52) | Δ |
|---|---|---|---|
| badged · western | 79.0% | 75.0% | **+4.0pp** |
| unbadged · western | 38.6% | 44.2% | **−5.6pp** |
| badged · non-western | 85.4% | 73.1% | **+12.3pp** |
| unbadged · non-western | 47.1% | 32.7% | **+14.4pp** |

**The western strata — 11,538 books, 71% of the pool — agree within ~5pp across
two independent instruments, different model families, two months apart, at very
different sample sizes.** That is real corroboration, and it is the part of the
estimate that should now be considered settled.

**The non-western strata disagree by 12–14pp, and both deltas are POSITIVE**:
Tier 1 systematically over-calls "first" on non-western material. This is the
predicted direction — a Western-catalogue-oriented search fails to find priors
that exist, and "no prior found" then over-reports firstness. It is why the
verdict contract already says a blind Western-catalogue miss on a non-Western
text is `weak`, never proof of a first.

So the honest decomposition is:

- **Western (11,538 books): ≈ 5,900–6,500 firsts.** Well measured, two agreeing
  instruments.
- **Non-western (4,613 books): ≈ 2,200–2,900 firsts.** Instruments disagree, and
  see §6 — for a large part of this stratum the question is currently ill-posed.

## 5. Three-tier agreement, and what a third tier is for

On the 16-book overlap set: **14 agree, 2 disagree.** Both disagreements were
named in the tier-3 record *before any oracle reported*, and both were then
verified by re-sampling evenly across the whole book:

- **Wei Yuan, *Haiguo Tuzhi*** — catalogued juan 41; every running header across
  84 pages reads 卷八十 (juan 80). The oracle researched juan 41 (the France
  section) and returned a confident verdict about a text this book does not
  contain.
- **Gangtey, *Jam dpal nag po*** — catalogued Tibetan; pp. 1–46 OCR as Sanskrit.

The oracle was not weak — on the other 14 it was repeatedly better than the
manual tier, running explicit negative tests (K10plus `spr=eng` → 0, positively
controlled by Böhme+eng → 2,447) and catching that a WorldCat "No results" was
boilerplate served behind a bot challenge.

**The failure is structural: a searcher handed a title and an author cannot
discover that the title does not describe the book.** More search effort never
fixes it. **An identity screen must run BEFORE the search tier** — which puts
#4329/#2318 ahead of FT in the queue.

## 6. The round's biggest finding is not about first translations

Three oracles independently flagged, and the main session then verified by eye
against the page image: **our OCR is fabricating Sanskrit Hindu scripture on top
of Tibetan Buddhist manuscript folios.** Book `69e78a454a6785cfd60d3124` page 10
is unmistakably Tibetan dbu-med; our stored OCR reads
`॥ श्रीरामचन्द्राय नमः ॥ १४८` and our published English says "Salutations to Shri
Ramachandra". The images are correct and book-scoped — the invention is entirely
in the transcription layer, and the translation layer faithfully translated it.

Scope: **529 of 2,016 Tibetan books** carry ≥1 Sanskrit/Devanagari-claiming OCR
page (12,187 pages); **355 are badged first translations**; 497 are visible.
That is the suspect population, not confirmed damage — Tibetan manuscripts
genuinely carry Sanskrit dhāraṇī in Ranjana — but the confirmed case is no
dhāraṇī. Filed as **#4523**.

Consequence for this round: in the non-western strata, *"we translated it
first"* and *"what we published is what the page says"* are separate claims, and
the second is failing. No first-translation number over the Bhutanese EAP
collections should be quoted until #4523 is triaged.

## 7. Instrument failures caught this round

- **Session WebSearch cap (200) is shared across all subagents** and was
  exhausted mid-round. Four agents had begun silently falling back to WebFetch —
  which cannot *discover* a prior, only confirm a known URL — and were stopped.
  The brief now requires declaring search availability.
- **But the first fix was an overcorrection.** Three post-exhaustion agents
  pivoted to structured catalogue APIs (K10plus SRU, CiNii, CrossRef, Harvard
  LibraryCloud) and produced *better*-bounded absences than open search would
  have. The rule was refined: the requirement is a **positive-controlled probe**,
  not a particular tool.
- **A silent stratification bug.** The first draw returned 613 books and reported
  success because a `--targets` key read `nonwestern` against a stratum named
  `non-western`; two whole cells drew zero. The drawer now hard-fails on an
  unmatched target key.
- **WorldCat is effectively unavailable** to this pipeline (403/429/Turnstile),
  and its "No results" page is boilerplate that renders identically for a
  successful control query. Two agents caught this independently.

## 8. What is still open

- ~30 of the 60 pre-registered oracle books, blocked on the search cap.
- The calibration that would let Tier 1's large-n rates be used directly needs
  that oracle set finished.
- **A live demote candidate**: Vat. gr. 243 (Porphyry's *Isagoge* + Aristotle's
  logic) is badged a first English translation; both independent tiers say no.
- **Two missed firsts** found in 16 books: the *Auctoritates Aristotelis*
  florilegium and Averroes' Hebrew *Physics* V commentary.
- **A rights problem**: the Jāmī is catalogued `published: 1480`; its title page
  reads ١٤٢٢هـ (2001 CE) — a modern in-copyright print in the corpus.
- `first-translation-history.md`'s `~5,000` figure is a superseded-rubric number
  and should be corrected wherever cited.
