# Readers of the original: a standing check on served pages and on the judge

PRIOR ART: `.claude/docs/community-quality-review-design.md` (credit and abstention rules, Phase 0; this is its first standing lane), `.claude/docs/eval-design.md` (vocabulary, one page per book, §2.1 the reader's chain), `MONTHLY.md` (the monthly draw and judge whose pages this reuses), `calibration-tasks.mjs` (queues the same pages for the /check route; not used, because answers come by email). The 2026-10-01 first version of this file (stratified draw, competence tiers, waves, two coders) was replaced the same day, before anything was sent, by this simpler design. It is in git history.

Status: **draft for Derek's sign-off, 2026-10-01. Nothing sent under it yet.** Issues: #5406, #5274 (the judge it checks), #3560 (volunteers), #4916 (the paper). Once signed off, this file is the preregistration: its commit hash and date go in the paper, and any later change is a dated amendment at the bottom, never an edit above it.

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
- **Assignment.** A reader gets a page in the language they named, in seeded random order within that month's draw, never one they have already read. Readers never see the judge's verdict.
- **Binding.** Each verdict is stored with the page's `translation_hash` and `ocr_hash` from `manifest.jsonl`. A verdict on text that has changed since is set aside.

No enrichment by judge verdict and no weights: the pages are the judge's own random draw, so agreement on them is agreement on served pages.

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

On a disagreement, the page goes to the next reader of that language who has not read it, if there is one. If the second reader agrees with the first, the human verdict stands. If they split, or there is no second reader, the page is listed as **unresolved**, with both answers. There is no expert tier.

## 7. Outputs

Monthly, and cumulative since month 0, on the quality page and in the paper:

1. **Agreement between readers and the judge** on random served pages: the share of Yes/No answers that agree with the judge, with n and a Wilson 95% interval, shown separately for pages the judge called sound and pages it called defective (most pages are sound, so a single figure would flatter the judge). `cant_tell` answers are excluded and counted.
2. **A catalogue** of what readers found that the judge missed, and what the judge flagged that readers did not, each with the page link and the reader's words.
3. **The response funnel**: letters sent, yes to the ask, pages answered, pages per reader, Can't tell rate, by language.

Nothing else is computed. Sensitivity and specificity, per-language rates and the whole-chain rate are reported once n supports them, not before.

## 8. Consent, ethics, credit

Letter 1 carries one sentence: answers may be used in published research, and readers are credited by name in the acknowledgements unless they prefer not to be. Authorship is for design and analysis. New signups will see the same sentence on the signup form.

Because answers and response rates may be published, this is research with human participants. The ask to TU Delft is one standing approval for an ongoing lane, and the lawful basis under GDPR for contacting existing signups about research. **Nothing is sent until that is answered.**

## 9. What it can and cannot claim

Can say, with n and intervals: on random served pages, readers of the original agreed with the judge on X of Y; readers found these defects the judge missed; this many volunteers answered when asked.

Cannot say: a corpus accuracy figure from readers; anything per language until a language has enough answers; anything about Korean or Syriac, which have no readers in the pool.

**The cost of keeping it simple.** With one combined question and no enrichment, defects arrive at roughly the served defect rate (about one page in nine is judged defective). Sensitivity and per-language figures will therefore take months of answers. That is accepted for a standing lane; the agreement rate and the catalogue are useful from the first month.

## 10. Open decisions for Derek

1. **Where the preregistration lives.** Recommended: deposit this file on OSF or Zenodo once signed, and link that from the paper and from letters, instead of GitHub.
2. **Who is first.** Recommended: all 34 candidates at once, since there are no waves.

## 11. Landing

Assignment log and stored verdicts (no names) land in `scripts/eval/results/volunteer-readers/<YYYY-MM>/`. One file in `scripts/eval/experiments/` and a comment on #5274 follow each month with answers. The contact log and reply text stay in `~/sourcelibrary-ops/volunteers/`.

## Amendments

None yet.
