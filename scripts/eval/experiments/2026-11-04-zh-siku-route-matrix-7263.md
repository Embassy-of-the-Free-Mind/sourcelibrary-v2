---
stage: ocr
measure: [judged, judged_vs_reference]
languages: [zh, lzh]
scripts: [Hani]
canons: []
n_books: 120
n_pages: 120
verdict: "On the Siku pages read by Gemini, nothing cheaper than an Opus read qualifies under the preregistered rule. Stored text gives 30/60 wrong-meaning English pages and 174 source-caused major defects; Paddle > Flash low 17 and 58; Opus fresh 8 and 13; Paddle > Opus 15 and 7; stored > Opus 11 and 15. The mixed route fails on set B (M-PO 9 and 16, M-O 8 and 21, best arms 4 and 3). The rule's answer is Paddle > Opus ($3.98 per 1,000 pages with translation), because only it passes the Kanripo test, and Kanripo governs. That choice among the three Opus routes is fragile: their differences are not separated on 60 pages. The gap between Opus and the cheap routes is. After an Opus read, the translator causes 51-64 major defects and the source 7-15."
status: undecided
decision: "No bulk run, no routing change: current.json and rules.json are untouched. Rule's route: Paddle > Opus; Derek's call (DECISION line, #7263). Stop testing cheaper routes on this frame. The next reader gain is the translator, not more transcription."
superseded_by: null
issue: [7263, 5274]
feeds: route
router_evidence: "none — exported to router-table/evidence/zh-siku-route-matrix-7263.score.json, which rules.json does not name; the brief moves no table"
defect_rates: "scripts/eval/zh-siku-route-matrix-7263/results/defect-rates.json"
---
## 2026-11-04 · Which route corrects the 93,277 Gemini-read Siku pages? Reader × draft, scored in English (#7263)

Derek, 2026-11-04: transcription errors matter to the extent that the translation matters; test the obvious route combinations, and use the expensive model only when it is needed. So this crosses reader and draft, scores the English as well as the transcription, and tests a mixed route.

PRIOR ART:
- `2026-11-03-zh-reocr-cheap-arms-7263.md`: arms, judge and price method, followed. `zh-gemini-reocr-7263/arms.mjs` and `router-confirm/confirm.mjs` were extended.
- `2026-11-04-zh-print-arms-7263.md`: the print pages and the O, F, PFL rows.
- `2026-11-04-zh-translation-paired-5274.md`, test 2: the English endpoint and the Kanripo trace, reused and extended (`--shard`, a pool floor).
- `2026-10-27-siku-pilot-kanripo-check-7503.md`: the Kanripo WYG alignment.
- `2026-11-04-paired-arm-recipe-6553.md`: wrong-page controls, retest row, one page per book, blind arm names.

Written before any new text was judged: `scripts/eval/zh-siku-route-matrix-7263/PREREGISTRATION.md` (commit 2e2707e4b), with the signal and cutoff frozen. Everything here is in `results/score.json`; scan links and differences are in `results/side-by-side.md`.

### Answer

| route | English accepted /60 | wrong-meaning pages | name or number pages | major / 1,000 words | source-caused majors | translator-caused | $ per 1K pages, with translation | $ per 1K accepted English | Opus account-weeks | agy pool-weeks |
|---|---|---|---|---|---|---|---|---|---|---|
| S stored | 22 | 30 | 30 | 11.95 | 174 | 38 | 0.39 | 1.06 | 0 | 0.7 |
| P Paddle | 24 | 28 | 28 | 7.82 | 64 | 49 | 0.48 | 1.20 | 0 | 0.7 |
| PFL Paddle > Flash low | 28 | 17 | 23 | 5.43 | 58 | 38 | 1.92 | 4.11 | 0 | 3.1 |
| F Opus fresh | 39 | **8** | 19 | 3.25 | 13 | 55 | 3.51 | 5.40 | 6.3 | 0.7 |
| **PO Paddle > Opus** | 35 | 15 | 17 | 3.74 | **7** | 64 | 3.98 | 6.82 | 7.1 | 0.7 |
| O stored > Opus | 41 | 11 | 20 | 3.31 | 15 | 51 | 4.06 | 5.94 | 7.4 | 0.7 |

Mixed route on set B only (n=30), against the set B arms:

| route | accepted /30 | wrong-meaning | name or number | major / 1,000 words | source-caused | translator | $ per 1K, with translation | Opus account-weeks | agy pool-weeks |
|---|---|---|---|---|---|---|---|---|---|
| M-PO | 13 | 9 | 12 | 3.51 | 16 | 21 | 2.39 | 1.0 | 3.1 |
| M-O | 14 | 8 | 14 | 3.96 | 21 | 22 | 2.41 | 1.0 | 3.1 |
| set B: F / PO / O / PFL / S / P | 20 / 16 / 22 / 13 / 14 / 14 | 4 / 7 / 5 / 10 / 13 / 11 | | | 3 / 5 / 9 / 33 / 90 / 33 | | | | |

**The rule.** Best wrong-meaning count 8 (F), so the limit is 11. Best source-caused count 7 (PO), so the limit is 8.75.

- PO: source in, wrong-meaning out (15). The two tests disagree, Kanripo governs, PO qualifies.
- F and O: wrong-meaning in, source out (13, 15). They disagree the other way, Kanripo governs, both out.
- S, P, PFL: fail both.
- M-PO, M-O: fail both, at the scaled margin of 1 page and at the literal 3 (set B limits: wrong-meaning 5 or 7, source 3.75).

Cheapest qualifying route: PO at $3.98. **Nothing cheaper than an Opus read qualifies. Stop testing cheaper routes on this frame.**

### How far to trust that

What 60 pages can detect: about 18-20 points on a paired comparison at 80% power (11-12 pages); set B alone about 25-30 points. This is not a non-inferiority result and must not be quoted as one.

Bootstrap by page (5,000 draws, seed 7263, `bootstrap.py`):

| difference | source-caused majors (95% interval) | wrong-meaning pages (95% interval) |
|---|---|---|
| PO − F | −6 (−17, +5) | +7 (0, +14) |
| PO − O | −8 (−22, +3) | +4 (−3, +11) |
| F − O | −2 (−15, +9) | |
| PFL − PO | +51 (+22, +86) | |
| PFL − F | | +9 (+2, +17) |
| PFL − O | | +6 (−1, +13) |
| S − O | +159 (+99, +226) | |

- **Opus against the cheap routes is separated on source-caused defects.** PFL's wrong-meaning count is clearly worse than F's and borderline against O's.
- **The three Opus routes are not separated.** PO's win is the letter of a preregistered rule on small counts. The source-caused split flips by set: F 10 on A, 3 on B; PO 2 on A, 5 on B; O 6 on A, 9 on B. Pages with any source-caused major: F 9, PO 5, O 7, PFL 17, S 32, P 23.
- **F is cheaper and has fewer wrong-meaning pages than PO** (8 against 15). English accept pairs: tPO v tO 5 gained / 11 lost, p=.21; tPO v tF 6 / 10, p=.45.
- **Two trace rows are false attributions from Kanripo markup:** 脉色死證(四/) (PO and P) and a leaf gap at 文　(者 (F). Removing them gives PO 6, F 12, and the rule does not change.
- **The errors differ in kind.** Read by eye, the 20 F and PO source rows are mostly real. PO's are mostly undercounted ｜ marks; F's are character misreads (象/彖, 名/召, 主/圭, 談/諌). The rule counts both alike, so it does not say which costs a reader more. The trace itself is Flash low comparing texts, as in test 2: an attribution, not a verdict on the page.

**The mixed route.** It fails for a reason the design can state. The frozen cutoff (0.178392, from set A) sent 10/30 pages on set A and only 4/30 on set B, so most of set B got PFL's text. After the fact, sending set B's top third (10 pages) still fails: M-PO 8 wrong-meaning and 8 source; M-O 7 and 13. That sensitivity is post hoc and hypothesis-forming. Set A's M result is hypothesis-forming too: M-PO 5 and 4, M-O 4 and 7, English accepted 21/30 each; transcription M-O 24/30 with 2 wrong-text, M-PO 27/30 with 1.

**The biggest finding.** After any Opus read, the translator causes 51-64 major defects and the source 7-15. The translator here is Flash low, one page, no previous English. Its failures include leaving ｜ repeat marks as bare bars (T10). More transcription work cannot reach those defects.

### Transcription

Siku, n=60, blind Opus judge with the image. CER is against Kanripo on the 52 pages with a leaf, marks excluded, median.

| arm | accepted | wrong-text pages | severe / 1,000 chars | CER | severity wrong-text / misleads / cosmetic | fidelity 2 : 3 : 4 : 5 |
|---|---|---|---|---|---|---|
| S | 21 | 31 | 19.08 | .041 | 148 / 93 / 65 | 15 : 15 : 18 : 12 |
| P | 33 | 19 | 9.19 | .030 | 72 / 49 / 67 | 4 : 14 : 35 : 7 |
| F | 58 | 1 | 0.45 | .021 | 1 / 5 / 9 | 0 : 0 : 9 : 51 |
| PO | 60 | 0 | 0.22 | .018 | 0 / 3 / 28 | 0 : 0 : 16 : 44 |
| O | 55 | 1 | 0.68 | .025 | 1 / 8 / 29 | 0 : 0 : 13 : 47 |
| FF | 17 | 32 | 15.39 | .041 | 103 / 84 / 45 | 4 : 22 : 17 : 14 (+3 no text) |
| PFL | 41 | 14 | 6.18 | .023 | 41 / 41 / 44 | 3 : 12 : 17 : 28 |
| SFL | 24 | 25 | 12.84 | .032 | 85 / 85 / 54 | 3 : 20 : 19 : 18 |
| M, set B, n=30 | 25 | 3 | 1.86 | .024 | | |

Kinds: O6 (misread character) dominates every arm except PFL, where O5 edges it. Classes per arm are in `score.json`, along with the English severity and kinds.

English severity (wrong-meaning / misleads / cosmetic): tS 128 / 131 / 82, tP 77 / 84 / 77, tF 12 / 59 / 84, tPO 20 / 61 / 94, tO 16 / 55 / 85, tPFL 42 / 74 / 78.

**CER instrument.** `hanOf` drops `<margin>` text, which punishes a read that marks more margin. The preregistered figures stand. With the text kept (`cer-margin-kept.mjs`, `results/cer-margin-kept.json`), medians are S .057, P .030, F .022, PO .018, O .029, FF .040, PFL .023, SFL .040. O's mean moves from .045 to .033. The order PO < F < PFL < O holds.

### Does PO beat O and F?

| | PO | O | F | PO v O (gained / lost) | PO v F |
|---|---|---|---|---|---|
| Siku transcription, accepted /60 | 60 | 55 | 58 | 5 / 0, p=.063 | 2 / 0, p=.5 |
| Siku English, accepted /60 | 35 | 41 | 39 | 5 / 11, p=.21 | 6 / 10, p=.45 |
| Print transcription, accepted /60 | 56 | 51 | 58 | 7 / 2, p=.18 | 2 / 4, p=.69 |
| Print wrong-text pages | 2 | 6 | 1 | | |

Neither is established on either frame. Print English was not tested.

**A Paddle draft does avoid the wrong-passage failures.** Of O's 6 wrong-text print pages, PO is accepted on 5. On the sixth (Taishō 69b99f78) PO is wrong-text for 屬提, a misread and not a wrong passage. PO's two print wrong-text pages are misreads. O's first-sitting 51/60 here against #8114's same-sitting 49/60 are the same texts, so that gap is the judge's own noise. Do not read a 2-page gap on this judge as real.

**PO changes the script tag.** PO says `handwritten` on 47/60 Siku pages (F 20, O 3, stored 0). WYG copies are hand-copied kaishu, so PO may be right and stored `printed` wrong. Either way a PO route flips `pages.script_type` on most pages. `ocr-trust-gate.mjs` has no Chinese row, so that gate is not affected. The other readers of the field (reader projection, batch OCR prompts) were not audited and should be before any run.

### Price

Fee × quota share, as in the 2026-11-03 record; method in `score.price`. OCR per 1,000 pages: F 3.12, PO 3.59 (3.50 Opus + 0.09 Paddle), O 3.67, FF 0.76, PFL 1.53, SFL 1.37, P 0.09. Translation adds 0.39.

The frame is 93,277 by the brief and 93,271 by today's `results/stale.json`, in 10,774 books. **24,873 of those pages hold English that goes stale under any route.** Cost for the whole frame, with translation: F $327, PO $371, O $379, M about $225 at the 4/30 share. M's figure would rise with a cutoff that sends more.

### Judge caveats

- **Opus judges Opus.** Kanripo stands beside it for that reason, and governs where they disagree.
- **Wrong-page controls.** Transcription 22/22 rejected. English 6/6 rejected. No sitting void.
- **Noise floor.** Transcription retest 26/26 accept agree. English repeat 4/6 accept agree, 6/6 within one fidelity point: the English verdict is noisier, and 6 is a small repeat.
- **No Flash judge was used as a verdict.** Everything except the by-eye notes below is judge-reported.
- **Frame narrowing.** "Not held" was taken strictly for set B, so the 76% of the frame's pages that sit in held books are outside it. Set A's held and unheld split is in `score.english_setA_held_split`.
- **Set A's O came from 10-page calls, set B's from 1-page calls.** Set A's existing arms stood, as the brief says.
- **Kanripo.** 52/60 pages have a leaf (22 on A, 30 on B). All the source-caused counts rest on those.
- **FF and SFL English were dropped up front** for the Opus cap. Neither can qualify, given their transcription and what S and PFL did in English. Opus ledger: 954 of 1,000.

**Opened with the image, by the job** (`results/by-eye.md`). Six disagreements: five verdicts stand and one is half wrong, and none favours a cheaper route.

1. 淵鑑類函, O misreads: judge right.
2. 性命圭旨, O another page: judge right; PO keeps the block's 抖搜 where F normalises.
3. 皇極經世書, O's 翁 for 翕: judge right.
4. 子史精華, F dropped marks: judge right.
5. 本草綱目 p16: the leaf has 二味; the judge rejected PO's 一味 but accepted O's identical 一味. One false accept for O, and a PO loss that is not real.
6. 禮記 commentary, English: same source in all three arms, so the gap is translator variance and not a PO cost.

### Written

- **17 pages, stored > Opus reads**, set B only, through `cli-ocr.mjs apply --mark-stale=zh-siku-route-matrix-7263`, old text to `page_revisions`. Run `cli-ocr-20261105022711-2939001`; undo with `scripts/maintenance/revert-run.mjs --run-id`.
- **Selection.** Outcome corrected, 22 pages. Judge accepts O and prefers it to stored, O not wrong-text, Kanripo CER not worse than stored: 19. O is the best judged read of the page: 17. No held book, no human edit.
- **Not written.** F and PO reads cannot go through that door: apply refuses draft-file reads, and F has transcripts only.
- **5 of the 17 carry English**, now stamped `translation_stale`. No worker or maintenance job retranslates off that stamp (they only skip), so that English stays until someone acts. 0 translations written: the arm translations are not in the door's format.
- **747 test rows** in `lane_judge_verdicts` (`origin:test`). Nothing live reads them (`matrix.mjs` comment); they are there for the router's evidence.
- Evidence: `router-table/evidence/zh-siku-route-matrix-7263.score.json`. `current.json` and `rules.json` not moved.

### What this leaves open

- PO against F is the live choice, and this test cannot settle it. They differ by $44 over the frame, 0.8 of an account-week, plus a Paddle pass over every page for PO. That is too small to justify a bigger test of the two; the translator is the better next test.
- Whether the frame's held books behave like set B.
- Print English for PO.
