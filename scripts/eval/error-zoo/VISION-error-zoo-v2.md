# Error zoo + bad-page predictor — my note before reading the handoff

Written 2026-11-11 on clawdbot, before `git show origin/eval/error-zoo-predictor:…/README.md`. Second half added after.

## What I would build from scratch

**The loop is a labelled dataset with a feedback valve, not a model.** Everything else (zoo, predictor,
budget) is a view of one table: `(page_id, text_sha, judged_at, reader, exposure, verdict, [class, kind, quote])`.
We already have that table in pieces. The first job is to join the pieces, not to collect more.

### Labels that exist on this box / in `bookstore` (measured tonight)

| source | rows | what a row is | trust |
|---|---|---|---|
| `book_checks.page_findings` | 2,400 rows, ~10,360 pages read, 19 methods, all image-opened model readers | per-page serious findings `{stage, class, kind, problem}`; `[]` = clean page | the best store: typed, versioned method, exposure, `text_provenance` (so a label knows which text it judged) |
| `lane_judge_verdicts` | 10,700, page-level, `fidelity` 1–5 + `defects[{class,quote,severity}]` | mostly judgments of *candidate* arms; `arms:["served"]`/`route:gemini-stored` rows judge what readers see | keep only served-arm rows; the rest label texts nobody serves |
| `/root/jobs/spare-audit/*/report.json` | 22 runs × 80 = 1,760 pages, Opus only (Gemini never read) | 625 page-findings, 1,347 class codes (O6 315, T8 158, O7 105, T10 94, T7 85, T9 83, O5 81, O1 64 …), 59 long-tail `other:` strings | one reader, uncalibrated, "not posted" — are these in `book_checks`? (`served-audit` has 200 rows; the rest look unrecorded) |
| `page_corrections` / `correction_events` | 268 / 243 | a human-or-job edit actually applied: the strongest positive label, with the diff | tiny, biased to books someone cared about |
| `page-error-taxonomy-2026-09-25/findings/*.md` | 78 books, 156 leaves, 8 readers | the taxonomy's own specimens | prose, needs parsing once |
| `double_ocr_pages` / `page_revisions` | 163K / 8.1M | agreement between two reads | a **signal**, not a label (instability ≠ error; and most of `page_revisions` is text relocation) |
| `ocr_judgments`, `pipeline_judgments` | 428 / 48 | A-vs-B preferences | not absolute; skip for v1 |
| `books.hidden_reason`, withheld pages, `sweep_log` repairs | large | a detector or a session decided a page was bad enough to pull | positive labels with a known selection mechanism; useful for the zoo's counts, dangerous for training (they are exactly the detectable cases) |

So: **roughly 12–13K page-level judgments already exist, from at least six instruments**, and the first pass used 1,520 of them from one. Precision@k and AUC should be reported *per source*, because the sources disagree about what "serious" means (fidelity ≤ 3 vs `severity: wrong_text` vs a `page_findings` entry) and a predictor fit to one reader learns that reader's habits.

### Signals that see an error, not just a hard page

Difficulty features (year, language, script, manuscript, image size) predict *where readers find errors* mostly because readers find errors on hard pages. They are fine for ranking but they do not improve when a page is repaired, so they cannot measure a repair. The features that actually see a defect, all cheap, all from the stored text:

1. **Cross-lane disagreement on the same page**: OCR length vs translation length ratio against the language's norm (T1/T9/T3), `<meta>` share of the translation, translation language ≠ English, OCR script block ≠ book script (O2), the `<vocab>` words absent from the body (O5).
2. **Cross-page continuity**: catchword vs next page's opening, printed `<page-num>` vs the sequence (I1/I2), identical blocks within or across adjacent pages (O4, I2), the first clause of the translation repeating the previous page's last clause (T5).
3. **Two-read disagreement where it exists** (`double_ocr_pages`): character-level distance between independent reads of the same leaf is the one signal that sees O1/O6 directly, and we hold it for 163K pages.
4. **Model-side tells**: which model and prompt version wrote the text (the 2026 lite routes have measured higher misread rates), `<page-type>`, columns tag, a refusal/empty read (O18), reasoning leaked into the text (O15/T17).
5. **Text statistics that correlate with confabulation**: compression ratio, repeated n-grams, proportion of dictionary words in the OCR language (too *high* on an illegible leaf is the tell of O1/T7), perplexity proxies without a model (type/token ratio by length).

The predictor should be a small gradient-boosted or logistic model over ~40 such features, trained with **group-by-book cross-validation** (pages from the same book never span train and test) and reported as AUC plus precision at the top 10% and 30% of the library, per label source.

### The smallest slice that proves the loop

1. Join the label sources into one table keyed by `(page_id, text_sha)`; drop labels whose text has since changed (`text_provenance.*_updated_at` vs page). Report the overlap: how many pages have two independent judgments, and their agreement. That overlap is the only calibration we have.
2. Score the whole live corpus (visible, `pages_count > 0`) with the features above on Hetzner, not here (this box runs the paid pipeline).
3. Draw the next weekly audit (lane D, 80 pages) **half random, half from the top-5% risk decile** with the stratum recorded. Random stays forever: it is the only unbiased rate. The risk half gives precision at the top directly, every week, with no extra reader cost.
4. Before/after for lane B: freeze the risk score and the serious-rate on the pages lane B is about to rewrite, re-score after, and have the same instrument (Opus, same brief) read a paired sample. Report the change as k-of-n books with Wilson intervals, by kind.

That is enough to say "the top 5% holds X% of the serious findings" with an interval, and the zoo's counts come from the same table.

### What could make the numbers lie

- **Selection**: nearly every existing label was drawn *because* something looked wrong (lane-B written pages, leak repairs, stub books, withheld pages). A predictor trained on those learns the drawing rule. Keep the random strata (spare-audit `random`, fortnightly spot check, shelf-overview) as the only evaluation set.
- **Stale labels**: a label is of a `text_sha`, not a page. Re-OCR after the judgment makes it wrong silently.
- **Reader habits**: one Opus reader with no second opinion; its O6/T8 may be partly its own misreads of the image. Report AUC per reader and never pool them into one "truth".
- **Exposure**: withheld and hidden pages mixed into served rates.
- **Difficulty leakage**: a model that ranks by year and script will look good on AUC and be useless for measuring repairs. Report AUC with and without the difficulty block.
- **Long-tail `other:` classes** (59 distinct strings in 1,760 pages): the taxonomy is missing a mistranslation-with-correct-OCR family finer than T8; classifying the unclassed with a cheap model will inherit whatever the reader meant.
- **Row counts are not integrity**: assert the shape (every label has text_sha, exposure, reader) before counting.

## Second half: after reading the handoff (PR #8608, merged to main 19:37 today)

**Where we agree.** Group-by-book CV; "serious" as the target; features saturate at ~0.72 because they measure
*hard page*, not *wrong text*; the next step is more and cleaner labels and signals that see the error. The feature
code (`feats2.py`) is good and I reuse it: the text-side features are the same list I wrote above.

**Where we differ, and which is right.**

1. *Labels.* The handoff trained on 1,520 pages from one reader (now 1,765; 23 runs are on disk tonight) and lists
   "pull other audits from the DB" as future work. The DB already holds **~10,400 page-level judgments in
   `book_checks.page_findings`** (16,261 error entries, 19 methods, every one an image-opened model read with
   `text_provenance`, so the label knows which text it judged), plus 158 served-arm `lane_judge_verdicts` and 268
   applied `page_corrections`. That is six to seven times the training set, with **six independent instruments**, which
   is the only way to put a number on label noise. This is the first thing to build; I am right that it comes before
   any new signal, and the handoff's own ceiling argument says why.
2. *The "59% unclassed" errors.* Measured tonight: of 13,953 logged errors, 1,645 are serious and **95% of the serious
   ones carry a class**. The unclassed 59% are minor (5,582) and moderate (2,128) findings the reader was not asked to
   class. So the zoo already covers what harms readers; classing the tail is cheap and worth doing for the zoo's
   counts, but it is a cosmetic gap, not the hole the README implies. I will class them with a rule-first pass (lane +
   keywords) and a small-model pass on the remainder, then spot-check 30 by eye.
3. *Which label is the target.* The handoff's `serious` is "any serious-severity finding on the page" from one reader.
   `book_checks` rows record only serious findings (`page_findings` = `[]` means clean), so the two agree in
   definition. `lane_judge_verdicts` uses `fidelity` 1–5 and `accept`; I map `accept=false` or `fidelity ≤ 3` to
   serious and report it separately, never pooled.
4. *Difficulty vs error.* The README notes year and compressibility are the strongest signals and calls that
   saturation. I would go one step further: report the model **with and without the difficulty block** (year, language,
   script, model), because a score that is mostly "old Latin from the lite route" cannot measure a repair. The
   repair-sensitive features are the ones that change when the text changes.
5. *Signals that spend money* (Paddle second read, Flash screener, logprobs). Agreed these need Derek; they become a
   DECISION line. But one two-read signal is free: `double_ocr_pages` already holds 163K pages with two independent
   reads in `page_revisions`. Joining it is a query, not a spend, and it is the first thing to try after the labels.
6. *Image features* exist only for the spare-audit pages (the images are on disk here). For the DB-wide label set I
   drop them and note it; the README's ablation shows them weak anyway.

**Postscript, after the build (23:20 UTC).** The label join held up: 12,352 rows, and the per-source numbers were the
story (lane B's check vs the Opus audit, 46% agreement; cross-instrument transfer costs 0.08–0.1 AUC). The
predictor did NOT deliver the brief's success line: on the only uniform frame the top 5% hold 14% of serious pages,
the top 30% hold 59%. The difficulty and text blocks are interchangeable (0.780 vs 0.778), so the score is still
mostly "which population", and the free two-read signal in `double_ocr_pages` is the next thing to join, before any
paid screener. The "unclassed 59%" point in §2 above was right and matters less than v1 thought. Full numbers: PR #8612.

**Plan for this job, in order:** (1) one label table from all sources with `source`, `exposure`, `selection`,
`text_sha`/updated-at so stale labels can be dropped; (2) retrain with GroupKFold by book, AUC and precision@10/30%
overall, per source, and cross-source (train on A, test on B); (3) class the unclassed tail, 30 by eye; (4) the
before/after plan for lane B as a document, no runs; (5) regenerate the zoo from the whole table.

---

# Part 2 — Is "serious" predictable at all? (written 2026-11-12, before the tests)

## My answer before looking

**Not as currently defined.** "Some reader called something serious on this page" mixes four things: a real
defect on the leaf, the reader's threshold (Opus vs Gemini, brief vs brief), the frame that chose the page (a
lane-B queue is not a random book), and whether the text the label judged is still the text served. A predictor
can score well on that target by learning the last three. The pooled AUC of 0.81 against a cross-instrument
agreement near 50% is the tell: no score should agree with "the truth" better than two instruments agree with each
other, unless it is recognising the instrument.

But the 46% may overstate the noise. The two instruments behind it did not judge the same thing: `ocr-convergence`
(Gemini Flash) checks the OCR only; the weekly audit (Opus) flags OCR **and** English, and 38 of the shared labels
were of OCR that lane B later rewrote. Before calling "serious" unmeasurable, compare like with like: same stage,
same text.

## What the target should be

**A count of critical errors per page, typed and quoted, where critical is defined by what it does to a reader
who quotes the page.** Concretely: text not on the leaf (invented, recited, another leaf's, filled-in illegible),
meaning reversed or a negation lost, a name, number, date or dose changed, a passage dropped. Each finding carries
the quoted span so a second reader can check it against the scan. Normalise by the page's length in words, report
the page as 0 / 1 / 2+ criticals, and keep "major" as a second, separately reported tier. Drop minors from the
target entirely: within one reader they correlate with nothing, so they add noise and no signal.

Why not the graded MQM page score: with weights 1/5/25 the score is the critical count to first order anyway, and
three of our four stores never recorded minor or major findings, so an MQM score exists only for the audit. Why not
the 1–5 score: it tracks one reader's serious count (ρ −0.81) because it *is* that reader's overall impression; it
inherits the same threshold.

## What would make me trust a severity label

1. It carries a span and a quote, so it can be checked against the scan by someone else.
2. Two independent model families flag the same span at a rate near what two humans would (we have no human-human
   number; the calibration set must produce one for a few languages).
3. The same reader re-reading the same text gives the same label (test-retest).
4. The reader catches planted critical errors and passes clean and wrong-page controls at known rates.
5. Severity follows a written rubric anchored to consequence, the same brief for every store.
A label that passes 1, 3 and 4 but not 2 is a reader's habit; one that passes 2 but has no span is luck.

## The cheapest test that settles errors vs instruments

All free, on data we hold:
1. **Frame-only baseline.** Fit the predictor on nothing but which store and method judged the page. Its AUC is
   what the pooled 0.81 gets for free.
2. **Within-instrument AUC.** Score the pooled predictions inside each method separately. If within-method AUC
   is far below pooled, the gap is base-rate differences between frames.
3. **Same pages, two instruments.** On pages two stores judged on the same text, the predictor's score is one
   number per page. Its AUC against each store's label, set beside how well one store's label predicts the
   other's, is the ceiling test. A score cannot learn "the error" better than the instruments agree on it.
4. **Like with like.** Recompute that agreement for OCR-stage serious only, fresh text only, and for the
   critical "not on the leaf" kinds only. If agreement rises sharply, the target was the problem, not severity.

## Where your guesses are wrong, or need a qualifier

- *"The 0.81 is partly instrument."* Probably right; tests 1–2 measure how much.
- *"A graded MQM-style page score is a better target."* Partly wrong for us. MQM's weights make it a critical count
  in practice, MQM agreement is itself poor, and our stores cannot supply minor/major counts. A critical-only count
  with spans is the better target; MQM's real lesson is the *consequence-defined* severity, which we should adopt.
- *"~100 pages judged by Opus, Gemini and Derek by eye."* Two problems. Derek cannot read most of the corpus's
  languages, so his judgments are a ceiling for Latin, German, French and Italian only, and one human is not a
  human-human ceiling. And 100 pages across 14 languages is about 7 per language, too few for kappa per kind. Better:
  fewer languages, more pages each, AI-prefilled spans so Derek verifies rather than reads cold (the ESA-AI result),
  planted errors and wrong-page controls for ground truth that costs no human time, and a second human for a
  subset if one can be found.

## After the tests (same day; full tables in scripts/eval/error-zoo/leakage-report-2026-11-12.md)

**The premise was wrong, and so was my reading of it.** The 46% agreement and ρ 0.49 do not measure two instruments
disagreeing about the same text. Lane B rewrote every page its check called bad, so its surviving ("fresh") labels on
the 217 shared pages are 0% serious by construction, and every serious label it holds is of text that has since been
replaced. What the comparison actually measures is lane B's sign-off on its own output against a later independent
audit: Opus finds a serious OCR error on 11% of pages lane B passed, and a serious error of any kind on 51%, mostly
in the English, which lane B never checked. The only other shared-page pair (59 pages) is one Opus run's labels
derived from another's. **We hold no independent second reading of the same text at scale.** The ceiling is unknown,
not low.

**Leakage is real but modest for "any serious", large for "not on the leaf".** Frame-only (store, method,
selection, exposure, reader) reaches AUC 0.70. The text and catalogue features identify the judging method at AUC
0.86–0.92, so the frame is in the features. Pooled 0.81 falls to 0.785 averaged within method. For "text not on the
leaf" the drop is 0.83 → 0.68: those labels sit in a few targeted queues and the model learns the queues.

**The target matters more than the model.** Within the uniform frame (the weekly audit's random books):
any serious 0.756; serious OCR error or wrong leaf **0.854**; text not on the leaf 0.739. OCR damage leaves marks in the
text; a mistranslation of a correct transcription does not. So: two targets, transcription-critical (predictable,
aim audits and repairs with it) and English-critical (not predictable from text, needs a reader).

**Minors are noise, moderates are not.** Minor count vs the reader's 1–5 translation score ρ +0.11; a minor count on
one read does not predict a serious finding on the re-read (AUC 0.43). Moderate ρ −0.58: keep it as "major".

**Self-agreement is high and proves little.** Opus re-reading identical packets with a frozen brief: κ 0.95. An
upper bound on reliability, no evidence of validity.

**Revised view of your guesses.** (1) Instrument leakage: right in direction, smaller than feared for "any serious",
bigger for the invented-text target. (2) MQM page score: adopt its consequence-based severity, not its weights; minors
get weight 0. (3) A 100-page Opus/Gemini/Derek set: right that it is the missing piece, because no existing data gives a
ceiling. Wrong on shape: put Derek on four languages he can verify, with prefilled spans, and add planted and
wrong-page pages so sensitivity is known without a human. Design in CALIBRATION-SET-DESIGN.md.

---

# Part 3 — One loop for finding and fixing (#8632), written 2026-11-12 before designing

## What should the bandit optimise?

Not "serious errors found per check". That rewards the easiest places to find errors, such as Greek manuscripts
where nearly every page is bad, few people read, and no repair route works yet (the pilot and #7568 measured Greek
MS corrections still misleading a third of the time). A check is worth what it changes. So the reward is
**reader-weighted harm removable**: for a checked page, (confirmed critical error) × (readers it reaches) ×
(probability a measured route repairs it in that cell). The first factor comes from the check, the second from page
views, the third from the repair router's Beta posteriors (#6740). A check in a cell with no working route still has
value, but as **information** (it tightens the cell's rate and tells the router where to test a route), not as harm
removed. Splitting the reward into "harm removable" and "information" keeps both visible instead of letting one swamp
the other.

**The unbiased rate stays by construction, in two ways.** (1) A fixed random slice of every audit (40 of 80) that
the bandit never touches, reported as the headline. (2) Every adaptive pick is drawn with a known inclusion
probability (probability proportional to score with a floor, not a hard top-k), so all checks, not just the random
slice, can enter a Horvitz–Thompson estimate of the library rate. A hard "top decile" gives pages outside it
probability zero and throws that away; this week's risk stratum does exactly that, and the smallest version below
changes it.

## What would make an adaptive audit fool us?

- **Small cells.** Arabic had 18 random pages. A bandit that greedily follows 13 of 18 will over-sample Arabic for
  weeks on noise. Remedy: hierarchical shrinkage (a cell's rate pulled toward its language and lane family) and a
  minimum exploration share per cell.
- **One reader's habits.** The pilot showed it: Gemini Flash low called a known misread correct and a facing-page
  strip "marginal notes", Opus the reverse. A bandit rewarded by "Opus said serious" learns where Opus is strict.
  Remedy: the reward is a **confirmed** finding (a second family, or a repair judged better), and the reader of each
  check is recorded and balanced across cells.
- **The predictor feeding on its own picks.** Labels concentrate where the score sent the readers, the score
  retrains on them, and its errors become self-confirming. Remedies: train with inverse inclusion weights; evaluate
  only on the random slice; never let the random slice's pages be chosen by the score.
- **Repairs erasing the evidence.** A repaired page's label goes stale, so cells that get repaired look "clean" in
  later labels. Track labels by text hash, and count "repaired" as an outcome, not as a clean page.
- **Goodhart on the judge.** If correction prompts are tuned against one judge, they learn to please that judge. Keep
  a judge family that is never used for tuning.

## Does sophistication matter?

Probably little at our scale, and it can be measured before building anything. About 80 checks a week is too few for
a contextual bandit to beat "top decile + random slice" by much. The gain is dominated by two things a bandit does not
fix: how well the score ranks pages (0.86 within the uniform frame for OCR damage), and whether findings reach repair
(544 flagged pages, almost none touched). Where a bandit would win is **cells where the global score is
miscalibrated**: if the top decile's hit rate differs a lot by language or lane beyond what the score predicts, a
per-cell posterior corrects it. Test: in the random-stratum labels, compare each cell's observed rate with the
score's predicted rate. A large, stable residual by cell argues for the bandit; a flat one says top decile plus
random is enough. Offline replay on the existing labels can compare the two policies on "confirmed criticals found
per 80 checks" before any audit changes.

## How should reflection work?

A weekly fixed routine, not a person reading a page. (1) A script writes the **zoo delta**: class × cell counts this
week against the trailing four weeks, with the three biggest movers and two quoted specimens each. (2) A spare-quota
Claude session reads only that delta and writes, for each mover, one hypothesis and one candidate change (a prompt
line, a route change, a detector). (3) Each candidate becomes a preregistered paired-arm test on that cell
(`paired-arm-judge`, both families, the #6694-style stop rule). (4) A passing change lands where the system reads it:
router `rules.json` evidence, a prompt version, a detector in `page-integrity`. A failing one lands as an experiment
file. Derek sees a decision only when it spends money, touches public copy or writes in bulk. One rolling issue holds
the weekly delta; a pattern gets its own issue only when it has a test and a definition of done.

## The smallest version that runs next week on spare quota

1. **Probability-proportional risk draw.** Replace the hard top decile with inclusion probability ∝ score (with a
   floor), recorded per page, so every adaptive check can enter an unbiased estimate. No new spend.
2. **Findings → repair queue (dry run).** Every confirmed or single-reader serious OCR finding on unchanged text,
   mapped to its cell's live route from the router table, with status `queued | needs-second-read | no-route`. No
   writes; it shows how many flagged pages each route could take, and is what a later repair wave reads.
3. **Second-read gate for the queue.** Findings from one reader are re-read by the other family on spare quota before
   they count as confirmed. Budget-capped per week.
4. **Weekly loop report.** One script: ingest the week's audits, recompute cell posteriors (shrunk), write next week's
   allocation, the repair queue, and the zoo delta, and post the digest. Spare quota only; any repair wave stays a
   DECISION.

## Part 3, after building (same day)

- **My proportional-draw proposal was wrong for now.** The replay (`2026-11-12-audit-policy-replay-8632.md`): top decile
  finds 2.54× random, a proportional draw 1.51×, a cell bandit 1.64×; cell indicators add nothing to the score (AUC
  0.843 vs 0.841). The random half already gives the unbiased rate, so the deployed 40 + 40 stays. The replay is the
  standing test to rerun as labels grow.
- **Why findings do not reach repair is now measured.** 2,646 flagged pages: 1,891 in cells with no decided route,
  599 deferred (held or in a translate lane), 156 with a route but only one family's word, none confirmed by two.
  The bottleneck is route decisions for the big HOLD cells (Latin and Greek Flash, script unknown), then second reads.
- **What runs next week with no new schedule:** the scheduled Monday audit (40 random + 40 top decile) now ends with
  the loop step: ledger (both readers, so the audit itself produces two-family confirmations), repair queue, digest on
  #8632. The second-read gate runs by hand on spare Gemini quota until it gets a slot.
