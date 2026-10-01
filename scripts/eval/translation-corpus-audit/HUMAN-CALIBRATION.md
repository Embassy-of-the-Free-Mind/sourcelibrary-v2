# Human readers versus the machine judge: study protocol

PRIOR ART: `.claude/docs/community-quality-review-design.md` (the panel design, credit and abstention rules, Phase 0; this protocol is its first round, specialised to the corpus audit), `.claude/docs/eval-design.md` (vocabulary, one-page-per-book, landing rule; followed here), `calibration-tasks.mjs` (queues the same pages for the /check route; reused for the page set, not the contact method). None of them fixes recruitment, page assignment, reply coding or the analysis for this study.

Status: **draft for Derek's sign-off, 2026-10-01. Nothing sent under it yet** (two [TEST] proofs to Derek only). Issues: #5406 (this round), #5274 (the audit it calibrates), #3560 (volunteer strategy), #4916 (the paper). Once signed off, this file is the preregistration: its commit hash and date go in the paper, and any later change is a dated amendment at the bottom, never an edit above it.

## 1. Who reads this and what it decides

Derek, and the TU Delft co-authors of #4916, deciding whether the corpus audit's headline (most served pages judged faithful, by Claude Opus with no human reference) can be reported as anything more than a judge rating. The study also answers the community design's Phase 0 question: will people who offered to help actually read a page when asked.

The paper section this produces is a methods-and-results section on calibrating an LLM judge with volunteer expert readers. It is written so that section can be drafted from §4 to §8 without re-deciding anything.

## 2. Research questions

- **RQ1, recruitment.** Of library volunteers who described a reading knowledge of a historical language, what share agree to read one page, and what share return a verdict? By language, by stated competence, and by whether they had offered review work specifically.
- **RQ2, judge validity.** On the same pages, how often does the Opus judge's verdict agree with an expert reader's? Reported as the judge's sensitivity and specificity for a material defect, with the human verdict as reference.
- **RQ3, reader reliability.** Where two readers judge the same page, how often do they agree?
- **RQ4, what the judge misses.** A qualitative catalogue of defects readers report that the judge did not, and the reverse.

Out of scope: a human estimate of corpus-wide accuracy. The pilot cannot reach the 35 books per language that needs (`community-quality-review-design.md`, "How many"). Korean and Syriac have no readers in the pool and are reported as a gap.

## 3. Materials: the pages

**Frame.** The 311 main pages of the corpus audit, one page per book, seeded draw (`draw.mjs --seed 20260930`), each already scored by the Opus judge (`verdicts/opus/`). The six wrong-leaf pages excluded in #5311 stay excluded. Each page's `translation_hash` and `ocr_hash` are in `manifest.jsonl`; a human verdict is bound to those hashes, and a verdict on text that has since changed is set aside.

**Enrichment by judge verdict.** The judge rated 47 of 311 pages at fidelity 3 or below. A plain random draw of a few dozen pages would contain too few defects to estimate sensitivity. So within each language, pages are drawn in equal numbers from two strata:

| Stratum | Definition | Pages in frame |
|---|---|---|
| judge-defect | Opus fidelity ≤ 3 | 47 |
| judge-sound | Opus fidelity ≥ 4 | 264 |

Readers are never told which stratum a page came from or what the judge said. Estimates are reweighted to the frame (§7). This is standard verification-bias design and is reported as such.

**Readability screen.** A page is only sent if a reader can do the task on it. Before assignment, each candidate page is screened by eye against these rules, **without looking at its judge verdict**:

1. The page carries running text in the source language, not a cover, catalogue slip, title page, plate, index or blank.
2. The scan is legible at the reader's full-page view.
3. The transcription is of this leaf (no wrong-leaf shift).

Pages are screened in a seeded random order within each language and stratum, and the first page that passes goes to the next reader. Every screened-out page is logged with its rule number. The screen pass rate is reported, because it is itself a finding about how much of a random corpus page sample is readable as text.

The Sanskrit page already proofed (Atharvaveda, p. 85) was chosen by eye from four candidates, without a judge lookup but not in seeded order. It is redrawn under this rule; if the rule lands on it, it stays.

**Overlap.** Where a language has two or more readers, about one page in five goes to two readers independently. Overlap pages are drawn first so that it actually happens.

## 4. Participants

**Frame.** Everyone who signed up as a Source Library volunteer before 2026-09-30 (1,192 people).

**Eligibility.** The signup text names a reading knowledge of one of the audit's languages. Each eligible person is coded into a competence tier from their own words, before contact:

| Tier | Example of what they wrote |
|---|---|
| A, professional | holds or is completing a doctorate in the field, teaches the language, has published a translation |
| B, advanced | graduate study, or names sustained reading of texts in the language |
| C, self-described | says they read the language, with no further detail |

Tier coding is done by two coders independently; disagreements go to the lower tier. The coding rubric and counts are reported; names are not.

**Waves.**

- **Wave 1:** the 11 eligible people who explicitly offered to review or check translations. This is Phase 0.
- **Wave 2:** the other 23 hand-picked people in `~/sourcelibrary-ops/volunteers/2026-09-30-calibration-wave1.json`, sent one week after wave 1 if at least a third of wave 1 has agreed.
- **Wave 3:** remaining tier A and B people, by language, until each language with readers reaches its target or the pool runs out.

**Each person reads one language**, the one they named. A person is never sent a page in a language they did not name.

**Ethics.** This study collects judgments from people and reports how people responded to a request, so it is research with human participants. If #4916 is a TU Delft paper, the TU Delft Human Research Ethics Committee should see it before wave 1 is sent; data collected before approval may not be usable in the paper. The risk is minimal: no deception, no sensitive data, adults volunteering expertise. **This is the one decision that blocks sending.** See §10.

## 5. Procedure

All contact is personal email from Derek, sent via Resend from derek@sourcelibrary.org, with replies to that address. No open or click tracking.

1. **Letter 1, the ask.** Thanks for signing up; one page, about ten minutes, reply by email; a small image of their page; what the answer is for; that it may be reported in a paper, with credit by name unless they prefer otherwise; no reply needed if not. Proofed 2026-10-01.
2. **Reminder.** One, seven days later, two sentences, to non-responders only. None after that.
3. **Letter 2, the page,** sent within two days of a yes. Scan, transcription and English inline, then the reader link. Two questions: does the transcription match the scan, and does the English say what the source says. A sentence or two is enough; a quoted line and its correction is most useful.
4. **Thanks,** within two days of their verdict, with an offer of one more page in the same language. A second page follows the same draw rule.
5. **Results letter,** to everyone who returned a verdict, within four weeks of the wave closing: what the readers in their language found, what the judge said about the same pages, and anything we changed because of it.

A reply of "not me" or "I can't read this scan" is recorded as an abstention with its reason, not as a verdict, and counts as participation (`community-quality-review-design.md`, Abstention).

Every message sent and received is logged with its date in a private sheet in `~/sourcelibrary-ops/volunteers/`. The person who reads and answers replies is Derek.

## 6. Coding replies

Prose replies are coded into the existing `translation-check` vocabulary (`src/lib/review-queue.ts`):

| Code | Meaning |
|---|---|
| `both_sound` | transcription matches the scan and the English matches the source |
| `translation_drift` | transcription right, English departs from it |
| `transcription_off` | transcription does not match the scan |
| `both_off` | neither can be trusted |
| `unclear` | reader could not decide |

A reply is coded `translation_drift` only for a **material** error: one that changes the sense, omits content present in the source, or adds content not in it. A reader's stylistic preference is noted but coded `both_sound`.

Two coders code every reply independently, blind to the judge verdict and the page's stratum. Agreement between coders is reported; disagreements are resolved by discussion and logged. The reader's own words are kept, so a coding can be checked.

Coded verdicts are stored in `volunteer_ratings` (queue `translation-check`) with `detail.via = 'email-reply'`, a pseudonymous rater id, and the text hashes they judged. Reply text with names stays in the private ops repo.

## 7. Analysis

**Mapping the two instruments onto one question.** Material defect present?

| | Defect | No defect |
|---|---|---|
| Human | `translation_drift`, `both_off` | `both_sound` |
| Judge | fidelity ≤ 3 | fidelity ≥ 4 |

`transcription_off` and `unclear` are excluded from the RQ2 table and reported separately: a wrong transcription is a different failure (#4523), and the judge was never shown the scan.

**RQ1.** The response funnel per language and tier: sent, agreed, returned a verdict, took a second page. Proportions with Wilson 95% intervals. Offered versus not offered compared descriptively; the pilot is not powered to test it.

**RQ2.** Judge sensitivity and specificity against the human reference, with inverse-probability weights for the enrichment in §3, and bootstrap 95% intervals over books. Pooled across languages first; per language only where a language has at least 15 verdicts. Cohen's κ alongside raw agreement, because most pages are sound and raw agreement flatters.

**RQ3.** Krippendorff's α on overlap pages, which tolerates missing ratings.

**RQ4.** Every defect a reader names is listed beside the judge's defect list for that page, sorted into: both found, reader only, judge only.

**Bias checks, reported whatever they show.** Non-response by language and by judge stratum, to see whether readers decline harder pages. The screen-out rate by language. Pages where the text changed after the verdict.

**Interim look.** None. Results are computed once a wave closes.

## 8. What can and cannot be claimed

Can say, with n and intervals: in this sample, the judge's verdict agreed with expert readers on X of Y pages; the judge caught A of B defects readers found; C of D volunteers agreed to help when asked.

Cannot say: a corpus accuracy figure; anything about a language with fewer than 15 verdicts beyond listing them; anything about Korean or Syriac. The headline in #5274 stays a judge rating until RQ2 says otherwise.

## 9. Credit

Per the community design decision of 2026-08-04: a reader who returns a verdict is named, with their permission, in the acknowledgements of the paper and on the public methods page. An abstention counts. Authorship is for design and analysis; letter 1 says so in one plain sentence rather than leaving it to be negotiated.

## 10. Open decisions for Derek

1. **Ethics review before sending.** Recommended: ask the TU Delft co-authors whether HREC review is needed, and hold wave 1 until that is answered.
2. **Letter 1 adds the paper and credit sentence.** Recommended: yes, one sentence.
3. **Two coders.** Recommended: Derek plus one independent coder; a Claude coder is acceptable only if labelled as such.
4. **Wave 2 trigger.** Recommended: one third of wave 1 agreeing.

## 11. Landing

Assignment log, screen log and coded verdicts land in `scripts/eval/results/translation-corpus-audit-2026-09-30/human/` (no names). An `EXPERIMENTS.md` entry and a comment on #5274 follow each wave. Contact log and reply text stay in `~/sourcelibrary-ops/volunteers/`.

## Amendments

None yet.
