---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 10
n_pages: 250
verdict: "We had agy Gemini 3.8 Flash (low) correct the stored lite transcription, one page per call, on the same 250 lite-read Latin pages as the Flash re-read and Opus correction arms. Blind Opus readers called 30/250 Flash-corrected pages misleading, against 100 for lite. That is as low as Opus correction's 31 and passes the halving bar. But 11 pages came out worse than lite, against 1 for Opus correction and 7 for the Flash re-read. Head to head, the readers preferred the Opus correction on 163 pages and the Flash correction on 37, with 50 ties. The Flash correction lost meaning that Opus kept on 48 pages, and Opus lost meaning that Flash kept on 13. Placed next to the Opus text, the Flash correction was called misleading on 65 pages (48 outside the wrong-leaf book), against 30 for Opus. Its typical defects were the long s read as f, wrong expansions of abbreviations, ℞ given as ♃, and lost negations. A second-family judge, agy Flash-low, ruled out self-preference behind #7258's result: on 59 seeded pairs it preferred Opus correction over lite 56–3, where the Opus readers had 58–0."
status: informational
decision: "No production write. Flash-low correction does not stand in for Opus correction: it fails bar (b) on 11 pages and bar (c) at 37–163. It costs about $0.61 per 1K pages at the agy plan fee (1.02 calls a page), against roughly 1% of a Claude account-week per 250 pages for Opus correction. On the 444K lite pages that would use the whole agy week for about 6 weeks. Opus correction stays the recommended upgrade path; the second-family judge removes the main caveat on it. The Flash correction is a cheaper fallback that removes most misleading lite pages but introduces its own; it is not recommended as served text without a guard for ſ/f and negations."
superseded_by: null
issue: [5924]
---
## 2026-10-24 · Flash-low correction of the lite text: the fourth arm, and the second-family check on Opus correction (#5924)
<!-- PRIOR ART: 2026-10-24-latin-lite-opus-correct-vs-flash-reread-5924.md (#7258, the Opus-correction arm and the three-arm table this extends) and 2026-10-23-flash-reread-lite-latin-books-5924.md (#7242, the Flash re-read and the 250-page sample). -->

**Question.** Opus correction cut misleading lite pages from 111 to 31 of 250, with 1 page worse (#7258). That costs Claude subscription time: about 18 account-weeks for the 444K lite pages. agy carries about 75–80K Gemini calls a week at a flat plan fee. Can a Flash-low correction of the same drafts do the same job, at about $0.6 per 1K pages? And was #7258's 201–2 preference over lite partly Opus judging Opus?

**Design** (`scripts/eval/flash-reread-5924/PREREGISTRATION-flash-correct.md`, committed 28feba169 before any agy call)
- **Pages.** The same 250 pages.
  - The l7a job scratch (images, judged lite text, reader task files) is not on this box, so `fc-draw.mjs` rebuilt the images and lite texts.
  - Every stored `ocr.data` hashes to the draft the Opus arm corrected, and every image's bytes to the image it read: 250/250 each (`results/fc-stored-check.json`).
- **Arm FC.** `cli-ocr.mjs read --correct-prompt --lane=flash-correct-latin-5924 --model=gemini-3.8-flash-low`, unchanged.
  - The prompt is the live OCR prompt v19.1 (checked equal to the base the Opus arm sent), plus `correct.mjs`'s `correctInstruction(1)` adapted to one inline draft and cli-ocr's markers. Template hash `0601ef30e816f7a7`.
  - Outcomes are parsed with `correct.mjs`'s `parseAnswer`.
- **Step C4 (FC vs L).** One fresh blind Opus reader per book on the 231 pages where FC differs from L, X/Y from Mulberry32(1034).
- **Step C5 (FC vs O).** One fresh blind Opus reader per book on the 231 pages where FC differs from O, X/Y from Mulberry32(1035).
- **Reader task.** The original `VERDICTS.md`/`C-TASK.md` were never committed. `C-TASK.md` is rebuilt from the prereg's definitions (verbatim) and the scorer's fields, and is now committed.
- **(d) Second-family judge.** agy `gemini-3.8-flash-low` judged O vs L blind on 60 pages drawn from #7258's 209 shown C2 pages (Mulberry32(1036/1037)), one page per call with the image attached (`fc-judge.mjs`).

**Outcomes** (`results/fc-outcomes.json`)
- **corrected 232 · contain 14 · no-answer 4 · unchanged 0.** 254 agy calls (4 re-reads, 0 nudges), no quota stop.
- **Flash never answered UNCHANGED.** Opus left 16 pages unchanged. Flash rewrote every page, and about as much as Opus did: a median 14% of words changed (Opus 15%), and 69 pages over 25% (Opus 54).
- **The wrong-leaf book (`69bd9d05…`, held since #5924):**
  - 13 true contains, each naming the leaf the draft really is.
  - 8 pages re-transcribed from the image instead of contained, so on those pages FC serves the right leaf.
  - 4 Gemini-filter cuts ("This request was blocked by Gemini's filters"). The Flash re-read lost 4 pages of this book the same way.
- **1 false contain:** `69c81aed` p413, "the image is cropped at the right margin". The scan is cropped (the C4 readers say the same of this book's pages); the draft is this leaf.
- **Two apply-path facts, if a Latin correction lane is ever wanted:**
  - cli-ocr's correct-mode `apply` refuses a text carrying `<page-type>`/`<scan-quality>`, the format the prompt asks for.
  - Its 25% cap measures `diffSyllables`, which keeps only Tibetan syllables. On Latin both sides count 0 tokens (232/232 here), so the cap passes everything.

**Result** (`results/fc-score.json`; Wilson 95%; the readers are blind Opus subagents)

| 250 pages | misleading | worse than lite | preferred vs lite | agy calls / page | cost / 1K pages |
|---|---|---|---|---|---|
| lite (L) | 102 · 111 · **100** (C · C2 · C4) | — | — | — | — |
| Flash re-read (F), #7242 | 20 (5–12%) | 7 | F 201 · L 23 · tie 26 | 1.05 | ≈ $0.63 agy |
| Opus correction (O), #7258 | 31 (9–17%) | **1** | O 201 · L 2 · tie 47 | — | ≈ 1% of an account-week per 250 pages |
| **Flash correction (FC)** | **30** (8.5–16.6%) | **11** | FC 210 · L 11 · tie 29 | 1.02 | **≈ $0.61 agy** |
| head to head, FC vs O (C5) | FC **65** (21–32%) · O **30** | — | **O 163 · FC 37 · tie 50** | — | — |
| *without the wrong-leaf book (225)* | L 75 · FC 12 (C4) · C5: FC 48 vs O 5 | FC 7 | C5: O 163 · FC 29 · tie 33 | — | — |

- **Bar (a), halves: PASS.** 30 ≤ 50.
- **Bar (b), no page worse: FAIL, 11 pages.**
  - 4 are filter cuts and 1 the false contain, all on cropped or wrong-leaf scans.
  - 6 are meaning losses:
    - `69b51e7f` p137: ℞ (recipe) given as ♃ (Jupiter/tin) in a pharmacopoeia.
    - `69b638be` p281: *phibeā* expanded as *prohibeam* (forbid) where the sense is *perhibeam* (bear witness). L kept *phibeā*.
    - `69af0a0a` p292: ſ read as f throughout, so *pofteritatemque*.
    - `69c81aed` p381, p507, p525: the scan's right edge is cropped. FC transcribed only what is visible, and so drops *non* in *qui biberit, non sitiet* (by eye: the *non* is off the image) and in *non … omnis*. L had those words.
- **Bar (c), stands in for O: FAIL.** O is preferred 163–37. FC lost meaning that O kept on 48 pages; O lost meaning that FC kept on 13.
  - FC wins 8–0 on the wrong-leaf book, because O serves L there while its contain holds the page.
- **Reader drift, stated plainly.** The C4 reader (FC next to lite) called 12 FC pages misleading outside the wrong-leaf book. The C5 reader (FC next to O) called 48, and only 8 pages overlap.
  - #7258 saw the same shift for F (20 → 32 next to O). A stronger neighbour makes a reader count FC's ſ/f and expansion slips as meaning changes. One C4 reader wrote out the rule it applied: "*fit* for *sit* … a real different Latin word".
  - So the pooled misleading rate for FC is 30–65 depending on the neighbour, while O's is stable (31 in C2, 30 in C5).
  - The ranking does not depend on this: under both readers, O is ahead.
- **The 7 pages the Flash re-read made worse:** FC was worse than lite on none of them.
  - On p131 it keeps *lib. 2.* (the misread both F and O made).
  - On p353 it keeps every line of Jerome's gloss and fixes *omnuræ → omnium naturæ* and *poca → voca*.
  - On the 3 pages the Flash re-read lost to filter cuts, FC answered.
- **Facing strip:** visible on 46 C4 pages. L read it in on 8, FC on 0.

**(d) Second-family judge on Opus correction** (`results/fc-judge.json`): 60 pages, 59 parsed (1 malformed JSON after the re-call), 62 calls.

| same 59 pages | prefer O | prefer L | tie | misleading O | misleading L |
|---|---|---|---|---|---|
| Gemini 3.8 Flash-low | 56 | 3 | 0 | 0 | 27 |
| Opus (#7258 C2 reader) | 58 | 0 | 1 | 1 | 27 |

- They agree on the preference on 55/59 pages, and Gemini prefers L on only 3 pages where Opus preferred O. The prereg's flag was 10, so **self-preference is not supported**.
- #7258's 201–2 preference for Opus correction over lite is not an artefact of Opus judging Opus. The judge is weaker, so this rules out a large bias, not a small one.

**By eye** (image open; crops under the job scratch)
- `69b51e67` p131: FC *lib. 2.* = print (#7258 checked the glyph). FC is right where O and F were wrong.
- `69b51e18` p353, `69b51eba` p49, `69b638be` p174: FC keeps every line. On p174 it expands *qualē* as *qualiter* and *ſpōſus* as *ſponſus*, so the abbreviations are expanded (as the live prompt asks), one of them wrongly.
- `69af0a0a` p60: FC keeps the overbars (X̄, C̄M̄) that L dropped, so 10000 → 10 is gone.
- `69c81aed` p381 (crop): the line ends *qui biber-* at the cut. *non* is not on the image. FC is faithful to the scan, and wrong for the reader.
- 3 random corrections (Mulberry32(1038)), all `69b51eba` (1554), C4: FC flawed vs L misleading on each:
  - **p67:** restores *duo*, *intelligibi-lis*, *cōnexionem*, and the omitted *intelligunt Platonici, per pares naturam alteram &*.
    - It writes *immortale ef- fe* and *ef- sentia* where the print has *immortalē eſ-ſe* and *eſ-ſentia*: the long s read as f, which the lite read had right.
    - It also brings back the print's line-end hyphens.
  - **p86:** restores the two dropped clauses *primum sit: animum uerò aeternitatem illam assequi* and *diuersam esse, quod in perpetua quiete semper*, and corrects *fit → sit*.
  - **p179:** restores *humorem*, *præterquam* (L *paterquam*), *disserit* (L *differit*), and *non* (L *no*).

**Cost**
- **agy:** 254 correction calls + 62 judge calls (316 rows in this job's ledger), 04:17–04:56 UTC on 2026-10-24, no quota hit.
  - At $200/month for about 77.5K calls a week, that is **$0.61 per 1K pages**.
  - The 444K lite pages need about 451K calls, so **about 6 weeks of the whole agy quota**, which every other agy lane shares.
- **Claude:** 20 reader subagents, about 4.1M subagent tokens. The account's 5-hour window was at 45% after the run (meter shared with other jobs).

**Grade.** Exploratory: 10 books, Opus readers with a measured neighbour drift, and the second-family check on 59 pages only.

Files: `scripts/eval/flash-reread-5924/`
- Scripts: `PREREGISTRATION-flash-correct.md`, `C-TASK.md`, `fc-draw.mjs`, `fc-prompt.mjs`, `fc-pairs.mjs`, `fc-judge.mjs`, `fc-score.mjs`.
- `results/`: `FC-correct-prompt.txt`, `fc-stored-check.json`, `fc-outcomes.json`, `fc-step-c4.json`, `fc-step-c5.json`, `fc-judge.json`, `fc-score.json`, `fc-reads.jsonl.gz`.
