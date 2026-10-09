---
stage: pipeline
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Every keep-what-we-have decision stands; the Flash translation routing (#5740) is under 30 referenced books in six of seven languages and the A5 re-OCR plan rests on 5-14 pages a script."
status: informational
decision: "No routing change; proposed a reference top-up (run as 2026-10-06-reference-topup-flash-translation-5873) and a human calibration set (#5406)"
superseded_by: null
issue: [5873, 5700]
---
## 2026-10-05 · Did this week's quality decisions have enough evidence? An audit against the decision cards (#5873)
<!-- PRIOR ART: 2026-10-04-routing-eval-tool-replay-5828.md replayed ONE run (#5795) through a rule with a margin; scripts/eval/DECISIONS.md records what was decided and on what evidence. Neither asks whether the evidence was enough for the money at stake, per language. -->

- **Question.** `eval-design.md` §10.2 now fixes, per decision type, what evidence is sufficient: measure, books per language, pooling, minimum effect, tier by dollars and reversibility, replication, judge. Applied to the decisions of 2026-09-29 to 10-05, which stand, and what is missing?
- **Answer.** Every "keep what we have" decision stands. Of the changes, only the Chinese Paddle lane proposal and the Greek OCR routing look sufficient. **The Flash translation routing (#5740, live) is under 30 referenced books in six of its seven languages**, and the re-OCR backfill proposal (A5) rests on 5–14 selected pages per script. None of the gaps argues for a revert: every measured effect points the same way. The top-ups cost under $10 of Gemini in total.
- **measure:** none new. This is a $0 re-reading of stored results (`judged_vs_reference`, `judged`, by eye) against a sufficiency rule. No model call, no database write.

### Design

`node scripts/eval/decision-cards-audit.mjs` builds each decision's evidence from the stored result files and applies `cardVerdict()` (`scripts/eval/lib/routing-rules.mjs`). Five decisions are replayed this way and pinned by `tests/unit/decision-cards.test.ts`; the output is `scripts/eval/results/decision-cards-5873/audit.md`. The other rows below were read from their `DECISIONS.md` rows and experiment files and are marked "ledger".

**The cards are post hoc for every row here.** They were written on 2026-10-05, after these decisions. Read "fails" as "would not be sufficient under the rule we now have", not as a fault in the decision.

### Result

| # | Decision (status) | Card · tier | Sufficient? | What is missing, and the top-up |
|---|---|---|---|---|
| 1 | **Greek** translation on Flash (#5740, live) | routing · large (≈ $1.9K Batch over 1.87M pages) | **No, narrowly.** n 75 (decision grade), +0.32 [0.16, 0.48], beyond the floor | No rule registered before the run; no replication; judge not calibrated against readers (large tier). Top-up: 30 fresh Greek books under a registered rule (≈ $1) |
| 2 | **Chinese, Sanskrit, Pali** translation on Flash (#5740, live) | routing · large (Chinese ≈ $1.9K) | **No.** n 24 / 28 / 16, all exploratory. The T5 pool is sound (68 books, homogeneous, +0.40), but a pool does not clear a language under 30 | Chinese +6, Sanskrit +2, Pali +14 books. Pali has 26 live books, so it tops out as a census of about 25. Then a replication, as row 1 |
| 3 | **Hebrew/Aramaic, Arabic, Persian** translation on Flash (#5740, live) | routing · medium (< $300) | **No.** n 15 + 5 / 20 / 12. Arabic's own interval touches zero (+0.43 [−0.02, 0.80]). The T4 pool is sound (52 books, +0.53) | Persian +18, Hebrew +15, Arabic +10 books. With those, the pool lifts each to decision grade and no replication is owed |
| 4 | **Persian, Sanskrit, Pali, Arabic, Ge'ez** OCR on Flash, visible and new books (Derek 2026-10-04) | routing · small or medium (not priced) | **No.** A5's Lite-read pages: 6 / 10 / 6 / 9, picked for scoring low; Pali and Arabic are inside the floor on the re-read alone; Ge'ez has agreement only | One routing-eval run per family on visible books (30 each, `margin-v1` as registered, ≈ $0.36 a family), or a reference CER cell |
| 5 | **Persian hidden backlog** OCR on Flash (#5795, Derek's override) | routing · medium (≈ $80) | **No, narrowly.** 27 pages with text, 9–0 by eye, planted arm refused; but the margin was chosen after the pages were seen | A fresh 30-book draw under `margin-v1` (≈ $0.36). It is the registered run and the replication at once |
| 6 | **Greek OCR** on Flash (#5575, live) | routing · large | **Looks sufficient (ledger).** accuracy, 176 referenced books; paired period cells at decision grade (56, 53 books) | The ledger row quotes unpaired medians (6.6 % vs 11 %); cite the paired cells. Canonical-dependent |
| 7 | **Re-OCR before retranslating Lite-read pages** (A5, pending) | backfill · large ($476–618 for Greek; changes served text) | **No.** 5–14 pages per script, selected for scoring low; no rule registered; no undo built; main gate passed on a supplementary packet only | A shadow tranche: 50 random Greek Lite-read books, one page each, re-read and retranslated but not served, judged (≈ $1.50). It is the random sample and the replication. Then Persian and Sanskrit the same way |
| 8 | **Folio markers stay off** (#5678, decided) | prompt | **Stands.** The card agrees with the registered rule: 7 per 100 fewer defects is under the 8 minimum, its interval includes zero, the omission guard failed, and two Lite runs differ by up to ±10 per 100 | Nothing |
| 9 | **OCR-trust gate** on four strata (#5761, live) | gate · hold | **Three of four, provisionally.** Greek manuscripts 2.54 [1.86, 3.23] (n 12); Persian 2.96 [2.39, 3.52] (n 12); Greek print 1450–1599 3.40 [2.86, 3.94] (n 15). **Latin incunabula is not supported:** 3.55 [2.89, 4.21] at n 10 | Latin incunabula +20 books, or release its 4,786 pending pages. The other three: +18 / +18 / +15 to a standing gate, with a top-up date |
| 10 | **Served-text cleanup A2** (applied, 277,832 pages) | gate · flag | **Yes on precision and undo.** 40 of 40 by eye per class on fresh samples (Wilson lower bound 0.91); a revision row per page; restore proven. A3 was rightly not applied (≈ 27 of 40) | The by-eye reader was a session, not a person, and the card asks for a human read. For a rule that only deletes markup that seems acceptable; it is Derek's call. Recall is not stated |
| 11 | **One page per request for the Tengyur** (#5717, decided) | prompt | **Yes, for that corpus (ledger).** 113 sides against 84000; wrong-span pages 15 → 1 | Sides of one corpus, not books: it is not a general rule. Another page-exact corpus needs its own run (already the row's trigger) |
| 12 | **Chinese SKQS cohort on Paddle** (#5547, pending) | routing · large (≈ €650–800) | **Looks sufficient (ledger).** accuracy, 433 books, registered rule, A-vs-A floor; the 2026-09-18 run (69 books) is its replication | Derek's signature |
| 13 | **No change:** Latin and vernacular translation stay on Lite; Latin print 1600–1699 stays on Lite; hidden Sanskrit, Pali, Arabic, Ge'ez stay on Lite; prompt v16, seam lines, OCR v20 and the Tengyur levers not adopted; the note verifier not scaled | all | **All stand.** Keeping what we have needs no card | Two notes. The vernaculars may not be pooled: German +0.39, French −0.18. Latin's +0.22 is under the 0.25 minimum, so "keep Lite" is also what the card would say |

Chained-lane Flash routing (pending) is supported, not decided, by #5678: Flash without markers made 10 per 100 fewer seam defects than Lite (8 vs 18 discordant breaks), which sits at the edge of the ±10 A-vs-A interval, on one run.

### What the top-ups cost (proposal; nothing was run)

Cost model: `eval-design.md` §11 ($0.02 of model spend per referenced page; 3 minutes of a person per page where an e-text aligns, 70 % of draws, else 20 minutes), checked against this week's bills (T4: $1.96 for 52 pages and eight arms; A5: $2.93 for 109 pages).

**(a) A human calibration set.**
- **Pages:** 50 of the 321 served pages already judged in #5695, 25 the judges scored ≤ 3 and 25 they scored ≥ 4, alternating, in the languages the volunteers read (`HUMAN-CALIBRATION.md` §3).
- **Who:** the volunteer lane (#5406): 34 candidates, 12 of whom offered to review. Strong in Spanish, Dutch, French, German and Latin; nobody for Syriac, Japanese, Armenian or Korean. The split for Persian, Pali, Arabic and Hebrew is in the private ops repo and was not readable from this job.
- **Hours:** readers about 10 hours (50 pages at ten minutes, plus one page in five read twice). Derek about 3 hours for the letter and the replies. A session about 2 hours to build the packet and record answers. $0.
- **Blocked on:** the TU Delft ethics and GDPR answer, and Derek's approval of the letter (#5406). Nothing has been sent.
- **What it unlocks:** the first measured agreement between a judge and readers (about ±12 points on sound pages, ±18 on defective ones at 25 each), and a bank of real error shapes for planted controls. It does **not** meet the card's bar (34 + 35 answers): 20 more answers do, about 4 more reader-hours. At that point a large-tier judged decision can be sufficient: rows 1, 2 and 7, and quality round 1's publication threshold. No per-language claim until a language has 30 answers per group.

**(b) Reference top-up to 30 books a language.**

| language | have | need | supply | reference sources (as T4 and T5 used) |
|---|---:|---:|---|---|
| Persian | 12 | +18 | 62 live books; about 24 tries at T4's 75 % yield, half of what is left | pre-1931 public-domain translations (Nicholson and others); 5 of T4's 52 references were in copyright and stay private |
| Hebrew | 15 (+5 Aramaic) | +15 | 284 live books; commentary-heavy layouts could not be aligned | Sefaria versions with a named translator (community translations excluded), JPS 1917 |
| Arabic | 20 | +10 | 279 live books | public-domain and CC-BY translations |
| Pali | 16 | +9 (census) | 26 live books: 30 cannot be reached | SuttaCentral (Sujato, Brahmali; CC0), all canonical |
| Chinese, Sanskrit (not in the brief, but Chinese carries half the money) | 24, 28 | +6, +2 | ample | pre-1931 public-domain translations (Legge, Giles, Thibaut, Bühler) |

- **60 pages. Gemini ≈ $1 with the three arms the card needs (Lite twice, Flash), ≈ $2.30 with T4's full arm set.** Alignment agents and the two judges run on the subscription, as this week.
- **Hours:** none if cuts are aligned by agents as in T4 and T5. About 3 hours for a person to check every cut (3 minutes each); 8 hours under §11's full model. Recommended: a person reads 20 cuts (1 hour), which also gives the `reference_error_rate` §4.1 asks for.
- **Before the arms run:** commit a rule file (minimum effect 0.25, pools T4 and T5, the heterogeneity check). Prefer non-canonical works: 46 of T5's 68 references are canonical.
- **What it unlocks:** rows 2 and 3 become sufficient for Hebrew, Arabic, Persian, Sanskrit and Chinese; Pali is labelled a census. Rows 1 and 2 still need a replication and the calibration set.

### Limits

- The thresholds marked "judgement call" in §10.2 (0.25 fidelity points, the $10 and $500 tier lines, $0.01 per page-point, the gate bounds) are not measured quantities. Moving the minimum effect to 0.2 would make Latin's +0.22 an effect worth acting on (row 13) and changes no other row; moving the directional line to 20 books would clear Chinese, Sanskrit and Arabic's n and nothing else.
- Stakes for row 4 were not priced, and rows 6, 11 and 12 were read from the ledger, not replayed.
- The Latin incunabula interval is a t interval on 10 pages of a 1–5 scale; it is wide because n is 10, which is the finding.

- **Decision.** None taken here; no routing constant, lane or gate was changed. For Derek: the two proposals above (#5873, #5700).
- **Cost.** $0. One read-only count of live books per language on Atlas.
- **Files.** `scripts/eval/decision-cards-audit.mjs`, `scripts/eval/results/decision-cards-5873/audit.json` and `audit.md`, `tests/unit/decision-cards.test.ts`; the cards in `.claude/docs/eval-design.md` §10.2.
- *run_id:* `decision-cards-5873`. *Replicated?* Not applicable: a re-reading of stored results, reproducible from the files.
