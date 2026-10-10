---
stage: ocr
measure: [judged, agreement]
languages: [la, grc, de, zh, ar, he]
scripts: [Latn, Grek, Hani, Arab, Hebr]
canons: []
n_books: 50
n_pages: 360
verdict: "On the 50 most-read non-English books, Opus reading the image judged the served OCR seriously wrong on 121 of 283 adjudicated gate pages (43%, Wilson 37–49%; Greek 38/48, Arabic 14/20, Chinese 19/30, Latin 44/144, German 6/37). A Gemini 3.7 Flash CLI second read is the better text on 51 pages, but the preregistered gate stopped the writes: Gemini 3.8 judged 3 of 40 staged writes worse (Opus 0 of 40), and one of the three is an auditor error checked by eye. CER agreement is not acceptance: 12 of 30 pages with CER < 0.01 still needed a fix."
status: undecided
decision: "Nothing written. 19 pages contained (13 gate, 6 calibration), incl. a whole-book wrong-leaf shift (illustrated Tang tales, 10 of 10 pages). Scaling lane B and applying the 51 staged writes is a decision for Derek (#6420)."
superseded_by: null
issue: [6420, 6174, 6338]
---
PRIOR ART: 2026-10-09 Latin CLI pilot (#6375: the CLI read on unread backlog pages, no stored text) and the #6338 second-reader entries (Gemini as a second reader of served pages). This entry is the first that compares a second read with the SERVED transcription on the most-read books and gates writes on it.

## 2026-10-10 · Can a Gemini CLI second read, adjudicated by Opus against the image, safely repair the OCR of the most-read non-English books?

**Design.** Preregistered (`scripts/eval/PREREGISTRATION-ocr-convergence-6420.md`). Frame: visible books with OCR in
six language groups, ranked by distinct (ip, day) page views in `analytics_pageviews` over 60 days (9,839 books).
Calibration: 20 books × 3 pages; gate: the top 30 books (Latin 15, Greek 5, German 4, Chinese 3, Arabic 2, Hebrew 1) ×
10 pages, the pages readers opened most. Second read `gemini-3.7-flash-low` through `scripts/batch/cli-ocr.mjs read`
(plan mode, #6331 nudge, one re-read on a chatter-guard failure). Opus (subscription, sealed `claude -p`, brief
`scripts/batch/ocr-convergence/ADJUDICATOR.md`) read the image against both texts, blind to which is served. Gate: a
fresh Opus and Gemini 3.8 Flash (high) read 40 staged writes blind (`AUDITOR.md`, X/Y order drawn); go only if neither
finds more than 2 of 40 made worse.

**Result.**
- Calibration set T = 0.01 by the rule (no CER band had ≤ 1 page needing action). In the gate, 12 of 30 pages with
  CER < 0.01 still needed action (rule: > 3 lowers T; there is no lower candidate), so a main run would adjudicate every page.
- Gate, 300 pages / 30 books: 8 no second read (CLI failed twice; 6 on one Hebrew book), 4 adjudication pending (3 verdicts
  dropped because the transcript shows the image was not opened), 23 agree, 93 keep, **51 write staged**, 108 residual
  (merge or medium confidence), **13 contained**. Stored read serious (Opus): 121/283 = 43% [37, 49].
- Gate audit, 40 staged writes: Opus better 36, same 4, worse 0; Gemini 3.8 better 34, same 3, **worse 3** → **STOP**.
  Of Gemini's three: the Chinese page (illustrated Tang tales p.160) is an auditor error — the leaf reads
  妍媸面哭…, as the CLI read has it, and the stored text (尚質聯詩) is another leaf; the other two (a Theophrastus book
  number, *si/ni solum*) are direct Opus/Gemini disagreements about the image.
- Found on the way: `cli-ocr.mjs read` sent `archived_photo`, the whole spread on split pages (18 of 60 calibration reads);
  fixed to `getPageSource()`. Two books serve another leaf's text under the image: `illustrated-tang-dynasty-supernatural-tales`
  (10 of 10 pages read) and `erster-zehender-theil-der-bucher…` (pp. 1770/1963/1964, shifted +3) — contained.

**Replicated?** No. Each verdict is one Opus read; the audit shows the two families disagree on what some images say.

**Artifacts.** `scripts/batch/ocr-convergence/results/run/` (frame, decisions, adjudications, audit, the next-1,000 queue);
`book_checks` rows method `ocr-convergence` v1, run ids `convergent-ocr-6420-{gate,calib}-run`.
