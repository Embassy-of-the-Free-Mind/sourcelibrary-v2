# Needs map: Trustworthy

**Purpose:** every page a reader opens reads right, hardest books first, paid for with subscription capacity that
would otherwise go unused (Derek, 2026-10-16). Claude is the final arbiter; a Gemini review is a second opinion.
**Measure:** verified pages per week, weighted by difficulty and readership, not jobs finished.
**Built:** 2026-10-11 by job `needs-trustworthy-6359`. **Refreshed:** 2026-10-16 by job
`needs-refresh-trustworthy-6359`, part of #6359 step 2. Read-only, $0.
Mongo figures are from `bookstore`, queried 2026-10-16; "live" means `visible: true && pages_count > 0` (42,357 books).
Every issue and PR number below was checked on 2026-10-16 and has the state given.
Ranked queue: `trustworthy.json` next to this file.

## 1. The number

**Serious-error rate of what readers are served, read against the page image: one random served page per book,
across every OCR and translation lane.** A serious error misleads a reader about what the page says
(`scripts/eval/spot-check/REVIEWER.md`).

**Now: 22% frame-weighted (34% of 184 served books unweighted, 95% CI 27–41), all lanes, measured 2026-10-13.**
Source: served-text audit, first run (#6691, PR #6698,
`scripts/eval/experiments/2026-10-13-served-text-audit-by-lane-6691.md`). By form: manuscript 28 of 44 (64%),
print 25 of 116 (22%). Text not on the leaf, confirmed by eye: 10 of 184 (5%, 3–10), all contained.

**Then (2026-10-11 map): 23% of 91 pages, canon shelves, drawn 2026-10-06** (fortnightly spot check, #5914). That is a
different frame, so the two are not a trend. The fortnightly draw runs next on 2026-10-19 with the page-frame fix
(PR #6637, merged).

Two more image-grounded readings this week. They point the same way and are not summed with the number:
- **Random visible non-English books, one Opus reader (#6420, job `opus-audit-6420`, 2026-10-16):** 171 of 551 books
  serve a serious error, **31.0% (27.3–35.0)**; text not on the leaf 70 of 551, 12.7% (10.2–15.7). No Gemini reader
  ran, so nothing in it is convergent.
- **Quality sprint round 2 (#6056, PR #6655, public frame, 2026-10-13):** 4 of 30 pages serious, nothing invented,
  0 of 30 wrong leaf. Round 1 on the canon frame was 15 of 30.

**This week's verified pages (the purpose's measure, first count).** Pages rewritten after a Claude decision with the
image open, 2026-10-11 to 10-16:
- #6694 (opus-screen): 3,624 Opus-corrected pages written in q400–q1000, each batch screened by Gemini and audited
  by fresh Opus (0 worse); 92 Greek pages written, 31 contained.
- #6420 lane B main200b: 1,131 pages in 114 books checked, 188 written, 31 contained.
- #6561 (PR #6744): 4,379 Paddle table pages served on Opus corrections, Claude arbiter on all 23 Gemini flags.
- #6769: Grec 1841, 354 pages, G4L under a per-book blind gate (29 better, 1 same, 0 worse of 30).
- #6559: 570 Maya manuscript pages OCR'd by Opus; 1,341 Yucatec pages re-translated by Argon with a style gate.
- #4523 (2026-10-14): 5,145 empty Tibetan pages written by the Yigdzin rule in 15 hidden books. The rule is a
  model-free guard, not a Claude read.

About 10,000 pages in all, before weighting. **Readership weighting can start now:** `books.human_read_count`
(PR #6809, merged 2026-10-16) replaces `pages.read_count`, which counts 1.19M pages as read 3+ times (#5048).
Difficulty weights can come from the pareto accuracy of the page's lane (below).

**Where the reads are worst** (`src/data/ocr-pareto.json`, regenerated 2026-10-16 by PR #6789; accuracy is
1 − capped CER against a typed reference; production engine, then the best one we can run):

| page kind | production | best measured | grade |
|---|---|---|---|
| Syriac manuscript | flash-lite 12.5% | Kraken (Sophro) 59% | not fit, 2 works |
| Hebrew in Rashi type | stored 48% | G4L (CLI, $0) 83% | not fit, 12 works |
| Greek manuscript | stored 57% | G4L (CLI, $0) 78% | not fit, 4 works |
| Chinese manuscript | Paddle 79% | Paddle 79% | directional, 261 works |
| Chinese print | flash-lite 82% | Qwen3-VL 84% | not fit, 11 works |
| Greek print | 3 Flash 91% | Surya 2 93% | decide, 24 works |
| Latin print | flash-lite 96.2% | 3.8 Flash (CLI, high) 98.9% | decide, 44 works |

No reference yet for Japanese, Hebrew (4 pages), Tibetan, Sanskrit or Persian on that scale. **No reader at all:**
Mongolian (0 of 10 pages on any arm, #5664), Samaritan (#5645).

**How it could be gamed, and the outside check for each:**
1. *Withholding lowers the rate without repairing anything.* Report it next to the containment debt: **3,004 live
   books are under a text-trust hold today, up from about 1,740 on 10-11.** Biggest: Tibetan 1,432
   (`tibetan-retranslation-awaits-derek`, #4523); Paddle Chinese held while stale English is rewritten 866 (#6388,
   #6561); title-leaf recitation 306 (#6297, new); IA wrong leaf 150 (#4790); Syriac 81 (#4883); poison cohort 37
   (#3391); `ocr-unsettled-6420` 35; about 100 single-cause by-eye holds. (Pipeline-lane holds such as
   `paddle-zh-5600-ocr-only` 7,006 and `gpu-backlog-5660` 3,477 are excluded; they hold work, not bad text.)
   The rise is containment catching up (#6297, #6388), not new damage. The number is better only if the rate falls
   and this debt does not rise.
2. *One model family draws, reads and judges.* The 10-16 audit was Opus only. Outside checks: the Gemini second
   reader (#6338, Phase 2 not run) and the Clef image-text screen (#5803).
3. *The sample avoids hard pages.* The served-text audit stratifies by lane and found every BDRC Tibetan page already
   withheld, so that stratum has no served book; n = 10 per stratum, so its ranks are not stable (#6688).
4. *Readers disagree with us.* 2 text-quality reports since 10-11 (a `missing_text` page report and a seam complaint), both unread; too few to trend.

## 2. Asked

- **Derek, 2026-10-16 (this refresh):** rank by the quality pages (`/platform/admin/ocr-evidence`, the pareto pages
  of PR #6789), worst and most read first. Claude is the final arbiter, Gemini review a second opinion (applied in
  PR #6744). Named areas: quality control (#6694, #6420, #6553, #6561) and difficult transcription (Maya #6559,
  Mongolian #5664, Tibetan #6560 and #4523, Kurrent #6780, Greek and Rashi #6769).
- **Derek, 2026-10-16 (#6769):** GO to write G4L re-reads for Rashi and mixed books (38), then Greek MS row 2
  (87), each behind a per-book blind gate, retranslated on the $0 CLI route before release.
- **Derek, 2026-10-16 (#6780):** run Kurrent manuscripts cpg 555, 293 and 594 (~1,210 pages) with the two-read Opus
  writer; keep 627 held.
- **Derek, 2026-10-16 (#6742):** yes to measuring page seams; prompt candidate A had no effect (PR #6814).
- **Derek, 2026-10-10 (#6420):** no human review of non-English text for a month; two model families and the image.
  Error clusters at 3× a lane's rate (n ≥ 20 pages, ≥ 5 books) become one issue each.
- **Derek, 2026-10-10 (#5826):** a by-eye gate every 300 books or 7 days; NO-GO pauses enrolment.
- **Derek, 2026-10-08 (`containment-on-finding.md`):** invented or wrong-leaf text found by eye comes off the page in
  the same run.
- **Readers and agents (feedback, unread, no issue):** Llull *Ars brevis* (1578) wrong English on one page
  (2026-10-09); Plato 1550 p.527, the *Theaetetus* wax-tablet passage (2026-09-30); "no smooth transition between
  pages" (2026-10-13, the seam class of #6742); a `missing_text` page report on book `6988a59e…` p.3 (2026-10-11).

## 3. In motion

Finishing these ranks above starting anything new.

- **#6694 Opus correct-in-place vs lane B** (updated 2026-10-16): step 3 done, q400–q1000 screened, audited and
  applied; 3,624 pages written, 31 Greek pages contained. Gemini called 3–4 of 40 audited writes worse in each batch
  where Opus called none worse; those pages were not written. Open: Theon *Expositio* p.15, where the judges disagree
  about which text is on the leaf, needs a look by eye.
- **#6420 convergent review** (updated 2026-10-16): main200 has no books left. **Systemic finding:** 299 of the 310
  pages lane B rewrote still serve English made before the new OCR (61 of them more than 1.5× the OCR's length), and
  `withhold-stale-translations.mjs` does not catch them. Whether to withhold or retranslate went to the digest.
- **#6561 / #6567 Paddle Chinese:** 4,379 table pages served on Opus corrections, Claude arbiter (PR #6744 merged
  10-16; 781 books stay held). The stale-Siku correction run is at 28,306 of 50,387 pages (12:00 UTC); the review at
  30,000 found new better 14, same 4, worse 2.
- **#6769 Greek MS and Rashi (G4L):** Grec 1841 OCR written (354 pages), English being rewritten. **Rashi row 1 is
  blocked:** a right-column-first instruction made column order worse (left first on 15 of 23, was 6 of 23). Greek
  row 2 (87 books) is next.
- **#6559 Maya:** 15 Yucatec books re-translated with Argon plus a style line (1,341 pages, PRs #6795, #6801); 4
  Princeton manuscripts live with Opus OCR (Bacabs 235 of 239). The judges scored word-by-word glossing as faithful;
  a gloss gate caught it after 223 pages. finish-6559 checks the rebuilt summaries after 00:00 UTC.
- **#4523 / #6560 Tibetan:** Yigdzin wrote 5,145 empty pages in 15 hidden books (10-14, PR #6734); 5,132 guttered
  bound-book pages stay empty and need a page-format reader. The G4L correction gate is NO-GO (5 of 40 worse;
  PR #6790), as was Flash (10 of 40, PR #6758). 1,432 live books remain held for the translation decision.
- **#5664 Mongolian:** no reader. G4L and Opus 0 of 10 pages (PR #6813); 83K pages, no $0 route.
- **#6780 Kurrent:** the two-read Opus lane is merged (PR #6804) and piloted on 10 cpg555 pages; the ~1,210-page run
  is approved and not dispatched.
- **#5826 quality gate:** the brake is live. PR #6422 merged 2026-10-12, and the 10-10 NO-GO still pauses translate
  enrolment (`system_config.processing_control.lane_budgets.translate.enrol_paused`). `quality_gates` has 1 row; no
  gate since; the 7-day rule calls for one by 2026-10-17.
- **#6691 served-text audit:** baseline run done (above); 10 pages contained in 9 books (`served-audit-6691`).
- **#6297 title leaves:** 20 of 20 sampled were real, so all 532 pages are withheld; 306 live books held. The
  re-translation needs an output-length cap that is not built; #6048's four title leaves wait on the same cap.
- **#5803 page shift:** PR #6658 (e-rara cover-sheet fix) merged; 45 of 353 re-archived books are one leaf off again.
- **#5782 Schutzschrift:** text re-seated on prod; the run record PR #6659 is open, `tier:hold`.
- **#6326 dropped lines:** detector built, PR #6636 open (`tier:auto`): 12,431 pages flagged in 990 books, 12 of 20
  real by eye.
- **#6338 second reader:** Phase 2 not run (`src/data/second-reader-6338.json` still says not run).

## 4. Found, not fixed

- **79 live books whose latest `book_checks` verdict is `fix` are not held** (was 34). `book_checks` now holds 957
  rows on 854 books: latest `fix` 177, `caveat` 488, `show` 189. Of 174 live `fix` books, 95 are held. Nothing checks
  that each of the 79 carries its #6199 reader warning. No issue.
- **Lane B and #6694 leave stale English under new OCR** (#6420): the review measures the OCR it wrote, and readers
  read the English.
- **Manuscripts are three times worse than print** (64% against 22% serious, #6691), and the worst rows on the pareto
  page are manuscript or specialist type: Syriac 12.5%, Rashi 48%, Greek MS 57%.
- **Japanese and Korean:** 88% and 75% serious (16 pages each, 2026-10-07); #6115 is `spare-skip` (its A/B is paid
  API work) and there is no Japanese typed reference. Korean has no issue.
- **Judges miss form errors:** side-by-side judges scored word-by-word glossing and recited Spanish as faithful on
  Yucatec (#6559); single-reviewer `not_this_leaf` calls overcount whole-page invention about 3× (#6691).
- **Detectors with no repair:** truncated translations 66,525 pages (#5055, `spare-skip`: paid repair, notes policy);
  echoed source 4,598 pages (#5058); page repeated through 198 books (#5057); duplicate captures 30,186 pages (#5056);
  page seams (#6742, #5021, #5103).
- **Contained, waiting on a reader:** Syriac 81 (#4883), Samaritan (#5645), poison cohort 37 incl. Gesner III
  (#3391, #5215), IA wrong leaf 150 (#4790, #5309), reasoning-leak 550 pages (#6117, `spare-skip`).
- **Unread wrong-text feedback:** Llull and Plato reports, still unread with no issue on 2026-10-16.

## Surprises

- Containment debt rose from about 1,740 to 3,004 live books in five days. Most of the rise is new holds on known
  damage (#6297 title leaves 306, Paddle 866), so the served rate improves while the debt grows.
- The verified-page count is dominated by Latin and German print (#6694 audit gates were 33/40 and 27/40 Latin), the
  easiest rows on the pareto page. The hardest rows (Syriac, Rashi, Greek MS, Tibetan, Mongolian) moved one book.
- The translate brake has been on since 2026-10-12 and nobody has recorded a gate since. Only the orchestrator and
  the two translate workers read it; `scripts/batch/cli-translate.mjs`, which wrote most of this week's English, does
  not, so the gate samples a lane that is mostly idle.
- The best $0 reader for Rashi (G4L, 83% against 48% served) is blocked only by column order, a crop problem, not a
  model problem.
