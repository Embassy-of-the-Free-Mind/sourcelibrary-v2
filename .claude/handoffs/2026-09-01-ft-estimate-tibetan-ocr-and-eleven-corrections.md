# First-translation: the estimate, the Tibetan OCR failure, and eleven corrections

*Handoff — 2026-09-01. Branch `worktree-ft-round5-estimate`, PR #4524. Written
for whoever picks this up next.*

---

## Read this part first

I corrected myself **eleven times** in one session. Not typos — headline
findings I had already reported to Derek, several of which I had written into
docs. Every single one was caught by one of three things: a positive control, a
question from Derek, or a number that didn't reconcile. **None was caught by
thinking harder.**

That is the most useful thing I can hand you. This domain punishes confident
conclusions, and the specific way it punishes them is that **the wrong answer is
fluent, plausible, and internally consistent.** A fabricated OCR page reads like
a transcription. A recalled prior reads like a search result. A selected sample
reads like a random one. You will not feel the error.

So: before you report a number here, ask what would have to be true for it to be
wrong, and go measure *that*.

## What is true right now (state changes I made)

- **795 Tibetan first-translation claims retracted.** Badged Tibetan 795 → 0;
  live badge count 5,921 → **5,126**. Derek's decision: "we can't claim those are
  translations… we don't need to withdraw the text yet." The text stays; the
  claim is gone. Written via `scripts/maintenance/retract-tibetan-ft-claims.mjs`
  (attempt + verdict) then a scoped reconcile. Every row carries
  `_src: 'ft-4523-tibetan-retraction'` — queryable, reversible.
- **A job is still running on Hetzner** (`/var/log/sourcelibrary/ft-reverify-4525.log`),
  re-verifying ~8,328 books with grounded search. At handoff: 4,245 done, $11.96
  of a $14 cap, so it will **truncate before finishing**. Rows resolve to
  `tier1_catalog`, which the reconcile valve does not admit — it cannot move a
  badge. Resume with the remaining ids if wanted.
- **Nothing else was written.** The join, the OCR investigation and the estimate
  are all read-only.

## The three findings that stand

**1. ~8,565 books were never previously translated into English** (95% CI
7,362–9,768) over a 16,151-book eligible pool. Round 5, PR #4524. The public
`~5,000` in `first-translation-history.md` is a **superseded-rubric number** —
built on the 462-study's 46% badged-genuine rate under the old `not_applicable`
rubric that Derek's July policies replaced. Correct it wherever cited.

The load-bearing part is *where* the instruments agree: on the western strata
(11,538 books, 71% of the pool) grounded Gemini at n≈250 and the Claude oracle at
n=52 agree within ~5pp, two model families two months apart. Non-western
disagree by +12–14pp, both positive.

**2. OCR of handwritten Tibetan is not a transcription.** Cross-run agreement on
the same folio: printed Latin **87–93%**, Tibetan manuscript **31–35%**, best
case (4352px master) 54–56%. Three runs of one page gave 1749 / 2286 / 1491
characters. Confirmed by eye: a page whose image is plainly Tibetan dbu-med came
back as `॥ श्रीरामचन्द्राय नमः ॥` with the published English rendering it
faithfully. Issue #4523. This was **already characterised in July 2026 (#3244)**
and I did not find it before filing.

**3. `gemini_verifier` over-claims priors by ~20%.** It produced ~57K of the
ledger's rows. Grounded re-search contradicts it on 19.8% (833 of 4,215). Its
rows *do* carry queries (95.2%) — recorded, not necessarily executed. **A false
"found" produces no visible error; it silently suppresses a first.** That is the
leading explanation for the gap between the estimate and the badge count.

## The eleven corrections, because the pattern matters more than any one

| # | I claimed | Actually | Caught by |
|---|---|---|---|
| 1 | A one-line prompt fix recovers 12,187 Tibetan pages | It fixes which *script* the invention is written in, not whether it's an invention | Derek asking "did you spot check?" |
| 2 | The verifier over-claims 7.7× | ~20%. The paired set was selected *on disagreement* | A broad re-run disagreeing with it |
| 3 | Only 672 books have a cited prior | 11,323. I measured `books.prior_translation`, a narrow credit field, not `priors[]` | Derek asking "are you sure?" |
| 4 | `gemini_verifier` has no searches | 95.2% of its found rows carry queries and sources | Same question |
| 5 | Withdraw the Tibetan text | A verified `pro` re-OCR fix already existed (June 2026, 6/6 rescued) | Reading memory late |
| 6 | #4523 is a new discovery | #3244, thirteen months earlier, same failure | Reading the runs ledger late |
| 7 | The `reference_translations` join is the highest-leverage move | 422 citations, not thousands. Reference-set recall is 32.1% and it's documented | Running it |
| 8 | My join found no matches | `author_surname` is *indexed* and populated on **zero rows** | A positive control I'd built in |
| 9 | Two join matches were priors | German function words `{der, zur}` carried the whole score | Reading the 13 matches myself |
| 10 | 21 badge conflicts | Mostly *partial* translations (Servius Book 4, Flamsteed's preface) and one different work | Reading the titles |
| 11 | Gangtey is a metadata/scan mismatch | The scan is fine; the OCR is fabricated. Different disease, same symptom | An agent verifying against the BL original |

Seven of eleven are **measurement** errors, not reasoning errors. Four are
**retrieval** failures — the answer was already written down.

## The sprawl, and how to survive it

Measured: **77 FT scripts, 20 docs, 16 modules, 132 open issues, 13 evidence
stores.** Full assessment in `.claude/docs/ft-organization-assessment.md`.

But the sprawl is not what cost the most. **Four of five failures were retrieval
failures, not knowledge gaps.** Everything I "discovered" was already written
down somewhere. So:

1. **Read `.claude/docs/ft-eval-runs-ledger.md` FIRST.** One row per measurement
   ever run. It is now the mandatory first read in the invariant doc's header. It
   is the single highest-value artifact in this layer and reading it late cost me
   corrections 5, 6 and 7.
2. **The obvious store is usually the wrong one.** 13 of them. The map is now in
   `.claude/docs/invariants/first-translation-claims.md`. `books.prior_translation`
   (676) is a *credit* field; `priors[]` on the ledger (11,323 books) is the
   evidence.
3. **`gh issue list --search` before filing.** #4523 duplicates #3244.

## Traps that will bite you specifically

- **`reconcile-first-translation-flag.ts` dry-run returns BEFORE the filter
  block.** A dry run reports the global count regardless of `--ids`/`--verdict`/
  `--resolver`. Mine showed 1,432 for a 795-book scope. I only noticed because
  the `--ids filter` log line never printed. **A dry run there does not preview
  what `--apply` does.** Worth fixing.
- **The 05:30 derive recomputes verdicts from the attempt ledger.** Hand-set a
  verdict and tonight's cron reverts it. Write the *ledger*, and check what
  `deriveVerdictFromAttempts` produces from your row shape — I probed it with
  synthetic inputs and zero writes (`scripts/output/derive-probe.ts`).
- **`not_applicable` is the only verdict that derives to a demotion.** Its
  defined meaning ("already English, or wordless art") is not what the 795
  Tibetan retractions mean. The data carries a small lie because the vocabulary
  had no room for "transcription unverified".
- **Local Atlas connections drop on long cursors.** Push work to Hetzner. Bulk
  never goes through Vercel.
- **`scripts/output/` is gitignored.** Durable work belongs in `scripts/audit/`.

## What I'd do next, in order

1. **The warning copy.** `PageMetadataPanel.tsx:225` already renders a red
   "Quality Warning" box, and those Tibetan pages already say "Handwritten
   Tibetan U-chen script". It warns about the *manuscript*, not about our
   transcription being unverified. The slot exists; only the copy is missing.
   Small PR, closes a real honesty gap for 795 books whose text we still serve.
2. **Decide re-OCR vs withdraw for Tibetan.** The June `pro` proposal has a
   costed number in the ops repo. A fresh-WebSearch session prompt is at
   `scripts/eval/results/r4523-handoff-prompt.md` — my own budget was exhausted,
   and the literature question (what purpose-built Tibetan OCR achieves on
   cursive dbu-med) is genuinely unanswered.
3. **Correct the `~5,000` figure** wherever cited. It may have gone to funders.
4. **Review the 21 join candidates** (`scripts/output/rt-join-full.jsonl`) on
   partial-vs-complete. That judgement needs a person.
5. **Merge PR #4524** — green, documentation and measurement only.

## The one thing I'd want you to carry

The search layer costs **~$45 to rebuild from scratch** ($0.00124–0.0028/book,
measured twice). The verification layer is bounded by attention, not money. This
project spent years optimising the free thing — 10,333 "found" verdicts against
1,691 verified books.

**Optimise for citability, not decidability.** A verdict is a perishable opinion;
a citation is permanent. We kept the opinions.

And treat this handoff with the same suspicion I'm asking you to apply to
everything else: it was written by someone who was wrong eleven times today, and
some of what's above is probably the twelfth.
