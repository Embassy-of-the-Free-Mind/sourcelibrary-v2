# Readers of the original: a standing check on served pages and on the judge

PRIOR ART: `.claude/docs/community-quality-review-design.md` (credit and abstention rules, Phase 0; this is its first standing lane), `.claude/docs/eval-design.md` (vocabulary, one page per book, §2.1 the reader's chain), `MONTHLY.md` (the monthly draw and judge whose pages this reuses), `calibration-tasks.mjs` (queues the same pages for the /check route; not used, because answers come by email). The 2026-10-01 first version of this file (stratified draw, competence tiers, waves, two coders) was replaced the same day, before anything was sent, by this simpler design. It is in git history.

Status: **draft for Derek's sign-off, 2026-10-01. Nothing sent under it yet.** The statistical analysis plan (§7a), alternating page order (§3) and random double reads (§6) were added on 2026-10-01, before sign-off. Issues: #5406, #5274 (the judge it checks), #3560 (volunteers), #4916 (the paper). Once signed off, this file is the preregistration: its commit hash and date go in the paper, and any later change is a dated amendment at the bottom, never an edit above it.

## 1. What this is for

A reader asks one thing of a served page: does this English say what is printed on this leaf? Today only a model answers that: Claude Opus rates translations against their transcriptions every month (`MONTHLY.md`), and the same judge decides publication in quality round 1 (#5438). It never sees the scan and has never been checked against people.

This lane asks volunteers who read the source languages the reader's question directly, one page at a time, for as long as they are willing. It is designed to scale by staying simple: one task, one question, one stream, no waves and no coding step for the main measure.

## 2. The task

One page, one question: **Does the English say what this page says?**

- **Yes**
- **No**, with a line on where
- **Can't tell** (cannot read this scan, not my language, unsure)

The email carries the scan, the transcription and the English inline. The transcription is a reading aid, not something to grade. The question covers the whole chain (right leaf, right transcription, faithful translation), and the "where" line tells us which link failed.

Each answer is a `mailto:` link to derek@sourcelibrary.org with a prefilled subject (`YES <page-id>`, `NO <page-id>`, `CANT <page-id>`). There is no backend and no web form. A free-text reply is always welcome and is read the same way. Every page email ends with a fourth link, `MORE <language>`: send me another.

## 3. Pages

- **Source.** The current monthly audit draw: one interior text page per book, already judged, controls passed (`MONTHLY.md`). Month 0 is the 2026-09-30 audit (311 pages, minus the six wrong-leaf pages excluded in #5311), because the first monthly judge run is 2026-10-02.
- **Assignment.** A reader gets a page in the language they named, never one they have already read. Within a language, pages alternate between the two groups the judge's rating makes: one it called defective (fidelity ≤ 3), then one it called sound, each group in seeded random order, until a group runs out; then the other continues alone, and month 0's leftovers carry into month 1. Readers never see the judge's verdict. Alternating, rather than serving all defective pages first, keeps a reader's run of pages from leaning one way, so a reader is not primed to expect faults. Why the groups are balanced at all: §7a.
- **Binding.** Each verdict is stored with the page's `translation_hash` and `ocr_hash` from `manifest.jsonl`. A verdict on text that has changed since is set aside.

The pages are the judge's own random draw, so agreement on them is agreement on served pages. Balancing the two groups changes how fast each fills, not what is measured within it, because every figure is reported separately for the two groups (§7a). The one figure that pools them is re-weighted to the draw's own mix.

## 4. Readers and letters

**Who.** Volunteers whose signup names a reading knowledge of an audit language. The first letters go to the 34 candidates in `~/sourcelibrary-ops/volunteers/2026-09-30-calibration-wave1.json`, and later eligible signups as they arrive. Each person reads only the language they named.

**Letters**, all personal email from Derek at derek@sourcelibrary.org:

1. **The ask.** One page, about ten minutes, answer by a click or a reply. One sentence on consent and credit (§8). No reply needed if not.
2. **The page**, after a yes, within two days. Scan, transcription, English, the three answer links, and "send me another". It also thanks them for the previous page.
3. **An occasional results note** to everyone who has answered: what readers found, what the judge said, what changed.

One reminder at most, seven days after letter 1. Rhythm is pull: a reader gets a new page when they ask for one.

All messages sent and received are logged with dates in `~/sourcelibrary-ops/volunteers/`. Derek reads and answers replies.

## 5. Recording replies

A script (or Claude, labelled as such) reads the subject line and stores one row per answer in `volunteer_ratings` (queue `translation-check`): `verdict` (`yes`, `no`, `cant_tell`), `detail.via = 'email-reply'`, `detail.where` (the reader's words, kept verbatim), a pseudonymous rater id, and the two text hashes. A free-text reply with no button subject is mapped to a verdict by Claude and marked `coded_by: claude`.

For the catalogue in §7, each "where" line is sorted into **wrong page**, **transcription**, **translation** or **other**, by Claude, marked as such. This sort is descriptive and does not feed the agreement rate.

## 6. When a reader and the judge disagree

The judge says sound at fidelity ≥ 4 and defective at ≤ 3. A reader's Yes or No either agrees or disagrees with that.

Second readers are used two ways, and the two are kept apart.

- **Random double reads (for statistics).** One answered page in five, chosen by a seeded draw *before* the first answer is read, goes to a second reader of that language whether or not the first reader agreed with the judge. These pages, and only these, measure how often two readers agree with each other (§7a, estimand 4) and feed any statement about who was right.
- **Disagreement follow-ups (for the catalogue).** Every page where the first reader and the judge disagree also goes to a second reader. If the second reader agrees with the first, the page enters the catalogue (§7, item 2) as a human finding; if they split, or there is no second reader, it is listed as **unresolved**, with both answers. These follow-ups never change the agreement rate in §7a.

Why not resolve only the disagreements: a check run only where reader and judge differ can overturn the reader but never the judge-reader consensus, so it can only move agreement upward. In diagnostic-test research this is called *discrepant resolution*, and it is known to inflate the measured accuracy of the test being checked. There is no expert tier.

## 7. Outputs

Monthly, and cumulative since month 0, on the quality page and in the paper:

1. **Agreement between readers and the judge** on served pages, shown separately for pages the judge called sound and pages it called defective (most pages are sound, so a single figure would flatter the judge), and the agreement of two readers with each other: estimands 1–4 of §7a, each with n, readers and an interval. `cant_tell` answers are excluded and counted.
2. **A catalogue** of what readers found that the judge missed, and what the judge flagged that readers did not, each with the page link and the reader's words.
3. **The response funnel**: letters sent, yes to the ask, pages answered, pages per reader, Can't tell rate, by language.

Nothing else is computed beyond the statistical analysis plan in §7a. Sensitivity and specificity, per-language rates and the whole-chain rate are reported once n supports them (§7a, reporting thresholds), not before.

## 7a. Statistical analysis plan

Fixed before any page is sent. Numbers for the sample-size table come from `scripts/eval/quality-paper-stats.mjs` (`results/quality-paper-stats-2026-10-01/report.md`).

**Unit.** One answer by one reader on one page. Pages are one per book, so pages are independent. Answers are not, because one reader answers many pages. Every interval is therefore computed two ways once ten or more readers have answered: a Wilson interval treating answers as independent, and a bootstrap over readers (resample readers, keep all of each reader's answers). The wider of the two is reported. Until ten readers have answered, the Wilson interval is reported alongside the number of readers and the largest share of answers from any one reader.

**Estimands**, each with n, readers, and a 95% interval:

1. **Agreement on pages the judge called sound** — of first answers (Yes/No) on pages rated 4–5, the share that are Yes.
2. **Agreement on pages the judge called defective** — of first answers on pages rated 1–3, the share that are No.
3. **Overall agreement** — estimands 1 and 2 combined with weights equal to each group's share of that month's draw (month 0: 85% sound, 15% defective), never the raw pooled share, since balancing the groups over-represents defective pages among answers.
4. **Reader–reader agreement** — on the random double reads only: the share of pages where both readers gave the same Yes/No, with Cohen's κ and Gwet's AC1 and a bootstrap interval. This is the ceiling. If two readers agree on 85% of pages, a judge that agrees with readers 85% of the time is doing as well as a reader.

Estimands 1–3 are first answers only. Second readers never replace a first answer in them.

**Can't tell** answers are left out of estimands 1–4 and reported as a rate per group and per language. As a sensitivity check, estimand 3 is also reported with every Can't tell counted as a disagreement. Answers on text whose hash has changed are set aside and counted.

**How many answers.** The half-width of a 95% Wilson interval depends on the expected agreement and on n within a group:

| half-width | agreement ≈ 90% | ≈ 70% | ≈ 50% |
|---|---:|---:|---:|
| ± 15 pp | 15 | 33 | 39 |
| ± 10 pp | 34 | 78 | 93 |
| ± 5 pp | 141 | 320 | 381 |

Agreement on sound pages is expected near 90%, so 34 answers give ± 10 pp. On defective pages it may be near 50–70%, so the same precision takes 78–93 answers. Month 0 holds only 47 judged-defective pages, and under random order defective pages would arrive as one answer in seven: about 265 answers before 40 defective ones. Alternating the groups makes about half of all answers fall on defective pages, which is what makes estimand 2 reachable in the first months; each monthly draw adds about 15 more defective pages.

**Targets**, cumulative, reported as reached:

- estimand 1 at ± 10 pp: 34 answers on sound pages;
- estimand 2 at ± 15 pp: about 35 answers on defective pages, then ± 10 pp at about 80;
- estimand 4: 40 random double reads (κ is not reported below that).

**Reporting thresholds.** An estimand is published with its n from the first answer, marked *preliminary* until its target is met. A per-language estimand needs 30 first answers in that language and group. Sensitivity and specificity of the judge, treating readers as the reference, are reported only once estimand 4 is reported, and always next to it: when two readers disagree with each other on a page in ten, no judge can score above about 90% against one of them.

**No tests, no stopping rule.** The lane is descriptive. Nothing is tested for significance, and no result stops or starts the lane. Estimands are reported monthly and cumulatively from month 0. A change of judge prompt or model starts a new cumulative series, and the old series stays on record.

**What estimand 2 is and is not.** It is the share of the judge's defective calls that a reader also calls defective. That is the judge's positive predictive value, read against one reader. It is not the judge's sensitivity: pages the judge called sound but readers call defective appear in estimand 1, as 1 minus its value.

## 8. Consent, ethics, credit

Letter 1 carries one sentence: answers may be used in published research, and readers are credited by name in the acknowledgements unless they prefer not to be. Authorship is for design and analysis. New signups will see the same sentence on the signup form.

Because answers and response rates may be published, this is research with human participants. The ask to TU Delft is one standing approval for an ongoing lane, and the lawful basis under GDPR for contacting existing signups about research. **Nothing is sent until that is answered.**

## 9. What it can and cannot claim

Can say, with n and intervals: on random served pages, readers of the original agreed with the judge on X of Y; readers found these defects the judge missed; this many volunteers answered when asked.

Cannot say: a corpus accuracy figure from readers; anything per language until a language has enough answers; anything about Korean or Syriac, which have no readers in the pool.

**The cost of keeping it simple.** With one combined question, a reader's No says the chain broke but not always where; the "where" line is the only localisation. Defective and sound pages alternate (§7a) because otherwise they arrive as about one answer in seven, and agreement on them would take many months to reach a usable interval. Sensitivity and per-language figures still take months.

## 10. Open decisions for Derek

1. **Where the preregistration lives.** Recommended: deposit this file on OSF or Zenodo once signed, and link that from the paper and from letters, instead of GitHub.
2. **Who is first.** Recommended: all 34 candidates at once, since there are no waves.

## 11. Landing

Assignment log and stored verdicts (no names) land in `scripts/eval/results/volunteer-readers/<YYYY-MM>/`. One file in `scripts/eval/experiments/` and a comment on #5274 follow each month with answers. The contact log and reply text stay in `~/sourcelibrary-ops/volunteers/`.

## Amendments

None yet.
