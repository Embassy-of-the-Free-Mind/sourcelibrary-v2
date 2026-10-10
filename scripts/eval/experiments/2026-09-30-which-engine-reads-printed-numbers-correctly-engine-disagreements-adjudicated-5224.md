---
stage: ocr
measure: accuracy
languages: [en]
scripts: [Latn]
canons: []
n_books: 82
n_pages: 178
verdict: "Against the page image the Archive gets 5.1% of printed numbers wrong vs lite 1.8% (82 books, 5,212 numbers); lite fewer wrong on 39 books, the Archive on 7."
status: undecided
decision: null
superseded_by: null
issue: [5224, 5124, 5186]
---
## 2026-09-30 — Which engine reads printed NUMBERS correctly? Engine disagreements adjudicated blind on the page image (#5224; feeds #5124, #5186)

- **Question.** #5124 put the Archive's silent number misreads at ~1.5% on 10 cases and lite at 0/750. For county histories, genealogies and directories the numbers are the payload, and a silent 1836→1886 passes every word-level gate. Per engine, how often is a printed 2–4-digit number wrong, with the page image as truth?
- **Design.** `measure: accuracy`. (a) The four #5186 county histories: Archive `_djvu.xml` text snapshotted in `page_revisions` vs lite in `pages.ocr`, 25 pages per book. (b) Breadth: one number-dense interior page per English IA book 1800–1930 (seeded, decade round-robin, 130 drawn, 78 scored), lite read into the eval store. Numeric tokens aligned between engines; agreed numbers counted correct; every disagreement cropped at the Archive WORD box (or between the two anchor words for a lite-only number, or as a margin band for a page number) and read BLIND by Sonnet vision (no engine readings on the sheet), `adjudicated_by: model-eye`. A 30-page subset had every agreed number read too (shared blind spot). Book-cluster bootstrap CIs.
- **Result** (82 books, 178 pages, 5,212 printed numbers; directional):

  | set | Archive wrong [95% CI] | lite wrong [95% CI] | silent misread Archive / lite |
  |---|---|---|---|
  | ALL | **5.1%** [3.8, 7.4] | **1.8%** [1.1, 3.1] | 3.6% / 1.2% |
  | (a) 4 county histories, 100 pp | 3.5% [1.7, 5.8] | 0.8% [0.4, 1.2] | 2.0% / 0.4% |
  | (b) 78 breadth books | 6.8% [5.0, 10.1] | 2.8% [1.6, 5.0] | 5.2% / 2.0% |

  Lite fewer wrong on 39 books, the Archive on 7, 35 tied (sign test p ≈ 2×10⁻⁶). Both wrong identically on 8 of 682 agreed numbers (1.2%). The Archive's signature: 3→8 (24 vs lite 1), letters for digits (`1s96`), dropped digits, page numbers dropped from the margin. By Archive version: ia-ocr/0.0.21 5.3% vs lite 2.4%; ia-ocr/0.0.14 3.4% vs 0.9%; ABBYY 8.0 2.5% vs 0.8%.
- **Decision proposed (Derek's call, eval-design §10).** Lite stays the text for any page with numbers (the #5124 no-numbers rule stands); adopt the #5186 digits gate (engine agreement on a number is right 98.8% of the time, so disagreement is the flag); approve the ~$70 Tingley/Point Loma lite re-read (18,513 Archive-text pages, ~58K numbers, ≈1,900 fewer wrong numbers expected, possibly half that on this cleaner shelf).
- **Instrument findings.** (1) A crop "between two anchors" is only as good as the anchors: on two-column indexes the engines order columns differently and the window lands on a neighbouring entry; the headline keeps only tight windows (125 of 264), and the all-crops variant gives the same ratio (6.7% vs 2.9%). (2) sharp applies `resize` before `composite` whatever the call order — composite, then resize in a second pass. (3) A shell-quoted regex turned `\b` into a literal backspace and silently disabled the decimal-table filter; write regexes from a file. (4) The Archive SPLITS numbers ("19 16") inside its own word boxes; a blind reader confirms each half, so a split must be scored structurally, not by the crop.
- **Not measured.** Human spot-check (130 items queued in `human-queue.jsonl`, unread); flash; batch lite; pre-1800; non-English.
- *Cost:* $0.313 of $3 (161 lite realtime calls, run_id `numbers-5224-2026-09`); adjudication on the Claude subscription (9 Sonnet workers). *Replicated?* No; one reader per crop, a second model reader agreed on 30 of 31. *Artifact:* `results/numbers-5224/report.md`, fixture `benchmark/numbers-en-5224.json` (1,274 adjudicated numbers; score any engine with `--stage=regress --texts=<dir>`; on the fixture lite 16.6% vs Archive 30.6% — a disagreement-enriched set, comparative only), store `store/outputs/gemini-3.1-flash-lite/2026-09.jsonl` + `store/scores/numbers-scorer@1/2026-09.jsonl`, script `numbers-5224.mjs`.
