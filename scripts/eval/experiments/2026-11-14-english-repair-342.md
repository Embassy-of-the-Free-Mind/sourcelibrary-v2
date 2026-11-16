---
stage: translation
measure: judged
languages: [la, zh, de, grc, fr, he, it, sa, nl, ru, ja, ar, ko, bo, es, fa, syc, pra, zu]
scripts: [Latn, Hans, Hant, Grek, Hebr, Deva, Cyrl, Jpan, Arab, Kore, Tibt, Syrc]
canons: []
n_books: 200
n_pages: 200
verdict: "On 100 served pages with a serious English finding, a blind review by the live model (D) cuts judged serious defects from 11.2 to 7.1 per 1,000 words (−36%, by-book 95% [−5.1, −3.1]) and guided repair with the audit's findings (C) cuts them to 4.5 (−59%, [−8.0, −5.4]). On 100 clean pages both lower the rate too (D 5.2→3.0, C 5.2→1.9), but D makes 12 of 100 clean pages worse, C 4. A fresh re-translation (B) gains only where the stored English came from an older model: on 26 pages already on the live model it is 4.6→4.1, [−1.3, +0.5]."
status: undecided
decision: "D (blind review) passes the preregistered rule and is the arm to build as an English repair pass that runs without a detector. C passes with a larger cut but needs an Opus audit's findings for each page, so it fits pages a spot check or audit has already read. B fails the rule (−31%, under the one-third bar) and is no repair pass. Before a lane writes anything: open D's 12 worse clean pages by eye, and give it a second-family judge on a smaller set. Building the lane is #342's next step."
feeds: [repair]
supersedes: []
superseded_by: null
issue: [342]
router_evidence: "none — a second-pass (repair) test on the live translation route's model, not a route comparison for a router cell; no rules.json cell changes"
defect_rates: "scripts/eval/route-judge-6740/results/english-repair-342/score.json"
---
PRIOR ART: 2026-11-14-guided-correction-244.md (guided vs blind correction of the TRANSCRIPTION, Opus, German, 35 pages: told the findings, it changed almost nothing; it found that 88% of pages with a serious finding have it in the English); 2026-11-02-ocr-error-to-translation-7611.md (how a misreading reaches the English); 2026-10-15-stale-siku-opus-correct-pilot-6561.md; 2026-11-02-translation-on-7866-draw-7968.md; scripts/batch/twopass-review.mjs (a review pass in translation, never measured against the image on served pages). None tests a second pass on the served English.

## 2026-11-14 · Which second pass makes a served English page better, and what does it do to pages that were fine? (#342)

**Question.** Readers read the English. On the weekly audit's random served pages, 372 of the 421 pages with a serious finding have it in the English. Every repair lane so far fixes transcriptions only. Before building an English repair lane: which kind of second pass lowers serious defects, and does it harm clean pages?

**Pages.** The weekly Opus audit's random served pages (`spare-audit` on main, 4,375 rows; its random stratum is a superset of the 1,344-page pool of the 244 entry). One page per book, non-English, live OCR and English byte-equal to what the audit read, not withheld or stale. 50 **en_only** (a serious finding in the English only), 50 **both** (in the transcription and the English), 100 **clean** (no serious finding). Drawn by `scripts/eval/english-repair-342/draw.mjs`; pool by `pool.py`. 23 languages, Latin 103, Chinese 24, German 18, Greek 13.

**Sizing, written before judging** (`recipe.json` `decision_rule`). An arm counts as an English repair pass if, on the flagged pages (en_only + both), its serious defects per 1,000 words are at least one third below A with the by-book 95% interval excluding 0, and on clean pages it adds no more than 0.5 per 1,000 words over A (upper bound). Why: flagged pages are about 31% of served pages, so a one-third cut there is about 0.3 per 1,000 words over all pages, and a pass that runs on every page must not add more than that on the 69% that are clean. About 60 pages are needed per comparison to see the cut and about 100 to see the clean-page bound, so the set has 100 flagged and 100 clean pages.

**Arms.** All on the live English route's model, agy `gemini-3.8-flash-low`, one page a call, page image attached, nothing written.
- **A**: the stored English (no call).
- **B**: a fresh translation of the current transcription (`cli-translate.mjs read`, kept reads off).
- **C**: guided repair. The stored English plus the audit's findings for the page, framed as "reports that may be wrong; check each against the page image". One planted false report per page sits in a seeded random position (a number reported as another, a statement reported as negated, a name reported as misspelt; `repair.mjs decoyFor`). On clean pages the reports are the audit's minor findings (median 3), plus the decoy.
- **D**: blind review. The same prompt as C with no reports: check the English against the page sentence by sentence and correct only what is wrong.

**Judge.** Opus (`claude -p --model opus`, route-judge `judgePrompt`), one text a call, blind to arm (hashed ids), against the page image and the stored transcription. 12 wrong-page controls (each arm's text judged against another book's page) and 12 same-arm repeats. Opus is another family from every arm. `paired-arm.mjs check` passes R1–R5. 870 judge calls for 819 verdicts: 51 calls failed with exit 127 while Claude Code updated itself on the box (11:26Z) and were re-run. All on this box's Claude login, 47% → 52% of its weekly limit.

**Controls and noise.** 12 of 12 wrong-page controls were refused. On the 12 repeats, 0 of 12 accept verdicts flipped, and the serious-defect count was 43 then 38 (about 0.5 per 1,000 words). Every difference below is several times that.

### Serious defects (misleads + wrong_text) per 1,000 words, each arm against A on the same pages

By-book bootstrap 95% interval of the difference (one page a book). Scorer: `scripts/eval/english-repair-342/score.py`.

| group | A | B re-translate | C guided | D blind |
|---|---|---|---|---|
| en_only (50) | 8.41 | 4.21 (−4.2 [−5.5, −3.1]) | 2.66 (−5.7 [−7.1, −4.7]) | 4.89 (−3.5 [−4.8, −2.4]) |
| both (50) | 14.00 | 10.86 (−3.1 [−4.6, −1.8]) | 6.08 vs 13.54 (−7.5 [−9.8, −5.4]) | 8.96 vs 13.54 (−4.6 [−6.2, −3.1]) |
| **flagged (100)** | 11.43 | 7.83 (**−31%**, [−4.6, −2.7]) | 4.54 vs 11.18 (**−59%**, [−8.0, −5.4]) | 7.11 vs 11.18 (**−36%**, [−5.1, −3.1]) |
| **clean (100)** | 5.17 | 2.96 vs 5.02 (−2.1 [−2.9, −1.3]) | 1.94 (−3.2 [−4.1, −2.5]) | 3.01 (−2.2 [−3.1, −1.4]) |

wrong_text alone, flagged: A 5.1, B 3.6, C 1.4, D 2.8. Clean: A 0.84, B 0.33, C 0.31, D 0.45.

C vs D directly: −2.6 per 1,000 words on flagged pages [−3.7, −1.6], −1.1 on clean pages [−1.6, −0.5].

**Is B just the newer model?** 174 of the 200 stored pages were translated by older models (3.1 Flash-Lite, 3 Flash), 26 by the live 3.8 Flash-low. On those 26 pages: B 4.57→4.14 [−1.32, +0.47], which is no change. C 4.57→0.99 [−4.98, −2.36]. D 4.57→3.41 [−2.19, −0.16]. B's gain is the model upgrade, while C and D still improve pages the live model already wrote.

### Harm on clean pages, the audit's findings, decoys, refusals

| | B | C | D |
|---|---|---|---|
| clean pages made worse (more serious defects than A) | 17 / 97 | 4 / 100 | 12 / 100 |
| clean pages made better | 48 / 97 | 63 / 100 | 52 / 100 |
| serious defects added on clean pages (per page beyond A, summed) | 20 | 4 | 15 |
| clean pages with a new wrong_text | 5 | 4 | 7 |
| audit's serious English findings whose quoted error is gone (of 157 found in A) | 153 * | 148 | 115 |
| flagged pages accepted by the judge (A: 1 / 100) | 29 / 100 | 65 / 99 | 32 / 99 |
| calls / texts returned / pages | 197 / 197 / 200 † | 200 / 199 / 200 | 200 / 199 / 200 |

\* B rewrites the whole page, so the quoted words go away whether or not the error does. Read B's row as an upper bound.
† 3 pages were not sent: `cli-translate` refused them as illegible-source.

**Decoys in C.** In 196 placed decoys the string check finds the planted text 8 times (6 on flagged pages, 2 on clean). By eye, 5 of the 37 passages C reworded also carry the false report in other words (for example "Many were happy to be his companions" became "nobody was happy", and "cost: 40 mon" became "42"). That is about 13 of 196 (≈ 7%) false reports acted on (`decoy-rewritten-by-eye.txt`). The judge read those texts, so C's rate above already includes the errors the decoys caused. A real report list carries fewer false reports than one in every page.

### What this means for an English repair lane

- **D, blind review, passes the rule**: −36% on flagged pages, clear of 0, and lower on clean pages too. It needs no detector, so it can run on every page. Its cost is 12 of 100 clean pages made worse (7 with a new wrong_text), against 52 made better. One agy Flash-low call a page.
- **C, guided repair, is the strongest arm** (−59% on flagged pages, and better than D on both groups), but it needs an audit's findings for the page, and those findings were written by Opus, the same family as this judge. Part of C's lead may be the judge agreeing with what an earlier Opus read saw. D has no such link. C fits pages a spot check or the weekly audit has already read: its output is the repair for those pages' findings.
- **B, a re-roll, is not a repair pass.** It fails the one-third bar (−31%), gives nothing on pages already on the live model, and harms the most clean pages (17 of 97).

**Before a lane writes anything:** open D's 12 worse clean pages by eye (`score.json` → per-page judged rows in `verdicts-opus.jsonl.gz`), and judge D against A on a smaller set with a second family. These numbers come from one judge.

**Pages where an arm beat A with no new serious error** (`score.json` `beat_A`: fewer serious defects than A, judge fidelity not lower, no serious defect on a quote A did not have; for B, no more wrong_text than A; C pages are kept only where the decoy's sentence came through unchanged). B 113, C 92, D 73; 115 distinct pages for C or D. A follow-up can apply them through the existing writer (`writePageTranslation`, with the arm's provenance). For C, re-run without the decoy rather than apply these texts.

**Judge strictness.** On pages the audit called clean, A still has 5.2 serious defects per 1,000 words (23 of 100 with a wrong_text). The route judge counts `misleads` more readily than the audit counts "serious", so compare rates within this test, not against the audit's 2.7–3.3.

**Checks (#8069).** Arm A's 200 verdicts (the served English, judged against the image) are recorded in `book_checks` under the new method `paired-arm-stored-english` v1 (`scripts/eval/methods/`). They are 200 rows, one a book, with `reader_warning: false`, `selection: picked`, and no page changed since the judge read it (`record-checks.mjs`; 108 fix, 66 caveat, 26 show). Arms B–D were never served and are not recorded.

**Files.** `scripts/eval/english-repair-342/` (pool, draw, repair, packet, score, record-checks, recipe). Results: `scripts/eval/route-judge-6740/results/english-repair-342/` (key, recipe, paired-score, score with `beat_A`, verdicts and the packet with every arm's text, gzipped, arm status, decoy by-eye notes). Scratch: `/mnt/HC_Volume_105839809/jobs/english-repair-342/` on main.
