---
stage: ocr
measure: judged_vs_reference
languages: [la, zh, bo, de]
scripts: [Latn, Hani, Tibt]
canons: []
n_books: 129
n_pages: 150
verdict: "One Opus judge read 290 route outputs against the page image, with no Opus text as the key. Every correction route a reader would accept more often than its draft: Latin lite 17/30 to Opus correction 30/30; Chinese Paddle 3/30 to the served Opus correction 24/30; Tibetan Yigdzin 17/30 to Flash-low 26/30 or Opus 25/30. In German, Opus CLI English scores 26/30, against 3 Flash 22/30 and Flash-Lite 15/30. Kanripo agrees with the judge's order on 16/16 Chinese pairs and Derge on 25/27 Tibetan ones. The judge caught 8/10 planted Tibetan syllables and agrees with by-eye reads on 28/30. It missed one confident wrong name inside an Opus correction. Two served wrong-leaf finds were contained."
status: undecided
decision: "Proposed, per cell: Latin, the Opus correction of lite pages (#5924). Chinese, Paddle not served raw; the correction stays and the tables question stays open (#6871). Tibetan, a Kangyur-volume gate for the Flash-low correction (#6560). German, Opus CLI replaces Flash-Lite English, not 3 Flash (#7263). Derek decides."
superseded_by: null
issue: [6740, 5924, 6871, 6560, 7263]
---
## 2026-10-25/26 · Same-judge, image-grounded read of production routes: the pilot, run (#6740)

PRIOR ART: `scripts/eval/translate-cli-lane-7075/sample.mjs` is reused here: its seeded one-page-per-book draw, its
blind packet with a separate key, its wrong-page control and `parseJson`. `scripts/eval/route-judge-6740/judge.mjs`
extends it to OCR and translation. It reads one output at a time against the page image and tags defects with the 44
classes of `.claude/docs/page-error-taxonomy.md`. Results: `scripts/eval/route-judge-6740/results/pilot-2026-10-26/`
(`score.json`, the verdicts, the key, the by-eye notes and the meter).

### Design change, 2026-10-26: the image is the key, not an Opus read
Derek changed the design after the evidence check, and the harness now follows it. Opus stays the one judge. It shows
no measurable self-preference: estimator v2 fits −0.11 to −0.13, and every interval includes 0. It also catches the
most planted errors: 43/46, against Pro's 37/46 (#6545). But as a reader, Opus is not a safe key. From the image it
invented text on 23/100 Chinese table reads (#6388). It was worse than the specialist on 27/30 Tibetan pages. It is not
the measured leader for Latin, German/French, Greek or Chinese print OCR (estimator v1). So the judge now reads each
output against the page image, plus the source OCR for a translation. It is never shown an Opus text as a reference.
The Opus corrections are blind candidates, scored like the other routes and priced as the Opus route: #5924 for Latin,
the served #6561 for Chinese, #6560 for Tibetan, and this run's own German reads. External references score every
candidate, and the judge's agreement with them is reported. For Tibetan that is Derge. The cell moved from one volume
with no reference to the 30 one-per-book Kangyur folios that hold Derge windows and the committed #6560 correction
reads. For Chinese it is the Kanripo leaf, where it aligns. In Tibetan, 10 Yigdzin drafts carry one planted syllable
each. Below an 80% catch rate, Derge decides the Tibetan cell, not the judge.

### The run
- **Judge:** `claude -p --model opus` (claude-opus-5-5), Read as its only tool, the page image in its workspace.
  322 judge calls; 0 unparsed after one retry. All 10 wrong-page controls passed: none was accepted, all scored ≤ 2.
- **Packet:** redrawn with the original seeds. Main's job box could not be reached by scp; the frame figures match its
  draw. Two routes that produced the same text on a page share one verdict: the 4 Latin pages Opus left unchanged, and
  6 Tibetan pages.
- **German Opus CLI reads:** production's `scripts/batch/claude-translate.mjs read`, one page a call,
  `CANDIDATE_READS=off`, never applied. 30 pages: the first 15 of each served route's draw, paired.
- **Meter** (Derek's inbox note): derek@playpowerlabs, read from the Claude Code usage endpoint in whole points. Over
  the judge window the weekly rose 21% → 25%, and the 5-hour 46% → 67%. That is 323 Opus image calls, 1 image each, about
  14.6K input / 1.5K output tokens a call ($0.082 list-price equivalent). So **≈ 0.012 weekly points per Opus image call
  (0.009–0.016 for the whole-point reading)**. It is SHARED: this orchestrating session ran on the same account
  throughout, so the figure is an upper bound. No other job was seen. route-costs.json prices a Claude call at 0.0303
  points, from Sonnet TEXT calls. These image calls came in under that. The cost columns below use 0.0124.

### Results, per cell × route (accept = a reader would accept this as the page's text / translation; intervals by book)

| cell | route | served? | accept | wrong_text pages | top wrong_text classes | per usable page |
|---|---|---|---|---|---|---|
| Latin (9 books) | lite | served | 17/30 [0.29, 0.86] | 12/30 | O5 omission 9, O6 misread 7, O4 2 | $0.0026 |
| | lite > Opus correction | experiment read, not served (#5924) | **30/30** [1, 1] | 0/30 | none | $0.0015 + 0.012 pts |
| Chinese (30) | Paddle draft | served before the correction | 3/30 [0, 0.23] | 24/30 | O5 14, O6 12, O4 12, **O1 invented 8** | $0.0009 |
| | Paddle > Opus correction | served (#6561) | **24/30** [0.63, 0.93] | 3/30 | O10 secondary script 3 | $0.0001 + 0.016 pts |
| Tibetan (30) | Yigdzin | served (2026-10 manifest) | 17/30 [0.40, 0.73] | 12/30 | O6 6, O5 4, O1 2 | $0 |
| | Yigdzin > Flash-low correction | experiment read, not served (#6560) | **26/30** [0.73, 0.97] | 3/30 | O4, O6, O8 one each | 5.0e-6 agy share |
| | Yigdzin > Opus correction | experiment read, not served (#6560) | 25/30 [0.70, 0.97] | 3/30 | O6, T5, O4 one each | 0.015 pts |
| German (60) | 3 Flash | served | 22/30 [0.57, 0.87] | 6/30 | O13, O6 2 each; I1, I4, O1 one each | not priced |
| | Flash-Lite | served | 15/30 [0.33, 0.67] | 10/30 | T5 continuity 3, T9 omission 3, O6 2 | not priced |
| | Opus CLI | this run's reads, not served | **26/30** [0.73, 0.97] | 3/30 | I1 (the image offset below), T9, T6, T10 | 0.014 pts |

"wrong text" = a defect the judge rated wrong_text: invented, dropped, duplicated, another page's, or a word that
changes the sense. Every class with n is in `score.json` (`classes_k_of_n`, `wrong_text_classes`), with three quoted
examples of each route's commonest class. route-costs.json is an OCR table and has no per-page German translation
price. So the two Gemini German routes are not priced here, and German cost is not compared.

**Pages made worse** (the after-route against the draft, same page: lower fidelity, an accept lost, or a wrong_text
added):
- Latin lite → Opus: **0/30 worse**, 23 better, 13 accepts gained.
- Chinese Paddle → Opus: **0/30 worse by the judge**, 25 better. **By eye, 1 of 3** (page 6a3cbfe2…:38): the served
  correction changed the calligrapher's name 章德懋 to 童德懋 twice. The judge accepted that page and quoted 童.
- Tibetan Yigdzin → Flash-low: 1/30 worse, 10 better. Yigdzin → Opus: 1/30 worse, 8 better. The worse page is the same
  folio for both, 69e7ab9e…:269 ("three kinds" where the leaf may say seven). By eye, on 69e7ab48…:223 Flash-low
  restored a line Yigdzin dropped but invented its middle and dropped a negation; the judge did not accept it.
- German Flash-Lite → Opus: 3/15 worse, 10 better (+0.67 fidelity [0.13, 1.13]). 3 Flash → Opus: 4/15 worse, 4 better
  (+0.00 [−0.33, 0.40]). The Opus "worse" pages are mostly notes and keywords that say more than the page does
  (T10-type), not dropped text.

**Judge vs reference:**
- **Tibetan, Derge** (syllable identity against the folio window). Means: Yigdzin 0.945, Flash-low 0.968, Opus
  0.960. On the pairs where two routes differ by ≥ 0.005 identity, the judge orders them as Derge does **25/27 (0.93)**;
  it ties 31 more. Accepted pages average 0.959 identity, not accepted 0.953. So within the cell, Derge barely separates
  what a reader would accept. Part of the Derge gap between the two correctors is tsheg spacing: Opus keeps the draft's
  merged syllables, and Derge counts them as errors (by-eye note, 69e7ab58…:149).
- **Tibetan planted syllables: 8/10 caught.** That meets the 80% rule, so by the rule the judge decides the cell. With
  n = 10 the catch rate is anywhere from about 0.5 to 0.95. Derge and the judge agree on this cell's ordering anyway.
- **Chinese, Kanripo** (Han-only CER against the WYG leaf, apparatus stripped). The leaf aligns for 21/30 pages, by
  neighbours only; 1 is placed a leaf off and dropped. Paddle CER 0.21, the Opus correction 0.09. **The judge agrees on
  16/16 ordered pairs.**
- **By eye** (3 pages per route per cell, image open; German partly against the transcription; `by-eye.md`): **28/30
  accept verdicts agree** with the judge.

### The four decisions, in these terms (proposed; Derek decides)
1. **Latin (#5924).** Served lite: a reader accepts 17/30 pages; 12/30 carry wrong text, mostly dropped lines and
   meaning-changing misreads. Lite corrected by Opus: 30/30 accepted, 0 wrong text, 0 made worse. Per usable page that
   is $0.0015 + 0.012 Claude points, against $0.0026 for lite alone. This repeats #5924's result with the image as the
   key instead of an Opus read. **Proposed: correct the served lite Latin with Opus, most-read books first.** The frame
   is one eval's 9 books, so the fan-out below widens it before the router believes it.
2. **Chinese (#6871).** The Paddle draft is not servable raw: 3/30 accepted, 24/30 wrong text, 8/30 with invented
   characters. The served Opus correction is accepted on 24/30, and Kanripo agrees with the judge on every ordered pair.
   But the judge missed a correction that changed a person's name, so the Opus-judges-Opus blind spot is real on
   names. **Proposed: keep Paddle → Opus correction; never serve Paddle alone; spot-check names in corrections by eye
   or against Kanripo.** The tables question is still open. The served corrections hold one table page, rod numerals,
   and its correction writes every number reversed (not accepted). The fan-out draws table works.
3. **Tibetan (#6560).** Served Yigdzin: 17/30 accepted, 12/30 wrong text. On the Kangyur folios, either correction
   lifts accept to 25-26/30 and Derge identity from 0.945 to 0.96-0.97, with 1/30 made worse. Flash-low costs 5e-6 of
   the agy month a page; Opus costs 0.015 Claude points. The #6560 volume gate said NO-GO for Flash-low on the rGyud
   'bum volume, a different stratum and a span-level test. One Flash-low invention was seen by eye here. **Proposed:
   gate Flash-low on two Kangyur volumes (40 pages each) with this judge, Derge and by-eye reads before any write.
   Opus correction is the fallback where Flash-low changes a line's words.**
4. **German translation (#7263).** Opus CLI English: 26/30 accepted. Flash-Lite: 15/30, with 10/30 wrong text
   (continuity leaks, omissions). Paired on the same pages, Opus is +0.67 fidelity over Flash-Lite [0.13, 1.13] and
   level with 3 Flash [−0.33, 0.40]. **Proposed: re-translate Flash-Lite German with Opus CLI, most-read first; leave 3
   Flash English as it is.** Opus costs ≈ 0.014 Claude points per usable page at one page a call. Production sends 10
   pages a call, which should cost less per page; that is not measured here.

### Proposed fan-out (NOT run)
At 0.012 points per judge call, about 1,000 calls (≈ 12 points) cover all four:

| cell | pages | new reads | judge calls | quota |
|---|---|---|---|---|
| Latin | 60 served lite pages, 60 books outside #5924 | 60 Opus corrections (6 calls of 10) | 120 + 4 controls | ≈ 1.6 pts |
| Chinese tables | 40 pages from the #7275 table works | 40 Opus corrections; 40 agy 3.8 Flash reads | 120 + Kanripo where it aligns | ≈ 2 pts + 40 agy calls |
| Tibetan Kangyur gate | 2 volumes × 40 pages, plus 20 planted | 80 Flash-low (agy); 80 Opus corrections | 180, Derge on every page | ≈ 3.2 pts + 80 agy calls |
| German | 60 Flash-Lite pages, one per book, plus 30 3 Flash | 90 Opus CLI (blocks of 10) | 180 | ≈ 2.4 pts |

In each cell: 3 by-eye pages per route, and a name check on every Opus correction (the 章/童 miss).

### Contained this run
Two served pages the judge flagged were confirmed with the image open and contained
(`.claude/docs/invariants/containment-on-finding.md`):
- **Mineralogische Belustigungen V (6a243c29…), pages 11-25.** Each image is one printed page behind its text (I1). 15
  English pages are withheld; the book was already held.
- **PH293 (69b41890…), page 348.** The facing leaf's cut edge was read and translated as a column, and mercury became
  "Antimony". The book is now held and the page withheld.

Details are in `by-eye.md`. The image re-pairing and re-reads are owed.

### What the draw showed before any judging (still true)
- **Chinese tables are not in the served correction route.** Of 4,379 pages served as #6561 Opus corrections, one had
  a table in its Paddle draft.
- **Latin and Tibetan correction routes were never served.** Those cells compare the served draft with experiment
  reads of the same pages, and are labelled so.
- **German has no served Opus English** in the visible 1500-1800 frame, so this run made its own 30 reads.
- **"Batch" cannot be read from the stored label.** `translation.source` is `ai` for nearly all German pages, so the
  German cell compares the models as served.

### To re-run
```
D=$JOB_SCRATCH/pilot
node --env-file=… scripts/eval/route-judge-6740/judge.mjs draw --out=$D --n=30     # seeded; the German frame moves
node --env-file=… scripts/eval/route-judge-6740/judge.mjs refs --out=$D            # Kanripo leaves
node --env-file=… scripts/eval/route-judge-6740/judge.mjs translate --out=$D       # German Opus CLI reads
node --env-file=… scripts/eval/route-judge-6740/judge.mjs packet --out=$D
node scripts/eval/route-judge-6740/judge.mjs judge --out=$D --concurrency=3        # exit 3 = a limit; sleep and repeat
node scripts/eval/route-judge-6740/judge.mjs score --out=$D
```
