---
stage: ocr
measure: [judged, preference]
languages: [la, de, zh, grc, ar, he]
scripts: [Latn, Hani, Grek, Arab, Hebr]
canons: []
n_books: 99
n_pages: 976
verdict: "On 976 pages of 99 most-read non-English books (queue ranks 201–300), Opus correcting the stored text in place (arm B) beat lane B (Gemini 3.8 Flash read + Opus adjudication, arm A) under both blind judges and passed the preregistered rule: B made 1/196 (Opus) and 9/196 (Gemini 3.8 Flash high; 4.6%, book-clustered 95% CI 2.0–7.7%) of its changed pages worse, and was preferred to A 158–6 (Opus) and 148–21 (Gemini). B changes far more pages (809 vs 189). But B's 40-write audit STOPPED: Gemini 3/40 worse (Opus 0/40), so nothing was written."
status: adopted
decision: "Derek 2026-10-14 (#6694): B (Opus correcting in place) is the OCR route for the rest of queue-next-1000, Greek excepted (Greek stays on lane A); q300 B applied over the 3/40 audit stop with the 3 disputed Greek pages excluded: 600 written, 17 refused by the shared-words guard"
superseded_by: null
issue: [6694, 6420, 6553, 6561]
---
PRIOR ART: 2026-10-13-ocr-convergence-main200-6420.md — lane B at scale on ranks 1–200, whose decision line asked this question; 2026-10-12-paddle-zh-correct-vs-redo-6561.md — correct-in-place beat a fresh read, on Paddle Chinese only.

## 2026-10-13 · OCR route: does Opus correcting the stored text in place match lane B (Gemini read + Opus adjudication)? (#6694)

**Frame.** `results/run/queue-next-1000.json` ranks 201–300 minus the one `lane_block` book (Theatrum regularium):
99 books, 976 pages chosen by `driver.mjs select` as main200 was (756 by page views, the rest a seeded spread).
Latin 490, Chinese 166, German 160, Greek 100, Arabic 50, Hebrew 10 pages. Same pages, same stored text in both arms
(0 pages changed between the arms' snapshots). Nothing written until the verdict.

**Arms.**
- **A, lane B unchanged:** `cli-ocr.mjs read --model=gemini-3.8-flash-low` (3 at a time; the 41 failed reads were read
  once more, 23 still failed), then `driver.mjs compare → packets (T = 0.01) → adjudicate (Opus, 8 at a time) → decide`.
- **B, Opus corrects in place:** new `scripts/batch/ocr-convergence/correct.mjs`. One sealed `claude -p --model opus
  --restricted --tools Read` call per book, with that book's 10 images and 10 stored texts in the folder. It uses the
  live OCR prompt plus a correction block. For each page the answer is a corrected transcription, `UNCHANGED`, or
  `CONTAIN: reason`, under `===== PAGE pNN =====` markers. A page with no answer, no marker, or a transcript showing it
  never opened its image or draft is "no answer", never a write. The ANTHROPIC_API_KEY strip of #6589 is kept.
  A correction that normalises to the stored text counts as `keep`. A correction in a translate-lane book is `defer`,
  by the same rule as A.

| action | A (lane B) | B (correct) |
|---|---:|---:|
| agree (A: CER < 0.01) | 83 | — |
| keep (stored text stands) | 331 | 167 (160 UNCHANGED + 7 no-op corrections) |
| write | 177 | 689 |
| defer (translate lane) | 12 | 120 |
| residual (A: merge or low confidence) | 336 | — |
| contain | 12 | 0 |
| no second read / no answer / pending | 23 / — / 2 | 0 |

The two arms' final texts differ on 806 pages in 98 books. They agree on 170, mostly where both kept the stored text.

**Judging (blind, as #6694 sets out).** 196 differing pages (≤ 2 per book, seeded) plus 40 agreeing controls. Each
page went to a fresh Opus (sealed, chunks of 5) and to `gemini-3.8-flash-high` via agy (one page per call). Each judge
saw the image, the stored text S and the two revisions under per-page X/Y labels (`JUDGE.md` v1). It rated each
revision better, same or worse than S, and preferred one of the two.

Every one of the 236 Opus verdicts shows the image opened. For Gemini, only verdicts whose tool-gate log shows
`view_file` count. In the first pass 12 of 27 lacked it: 9 said "no image" and 3 answered without opening the image.
The request wrapper (not the brief) then told the judge to open the attachment first. The 12 were re-run, and the
final 236 all opened the image.

| group | judged | Opus: B worse / changed | Gemini: B worse / changed | Opus: A worse / changed | Gemini: A worse / changed | Opus pref A–B–same | Gemini pref A–B–same |
|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 116 | 1 / 98 | 3 / 98 | 0 / 22 | 0 / 22 | 4–78–16 | 10–76–12 |
| German | 41 | 0 / 32 | 5 / 32 | 1 / 8 | 1 / 8 | 1–25–6 | 6–22–4 |
| Greek | 26 | 0 / 20 | 0 / 20 | 0 / 5 | 0 / 5 | 0–17–3 | 0–17–3 |
| Chinese | 41 | 0 / 34 | 1 / 34 | 0 / 4 | 0 / 4 | 0–28–6 | 2–25–7 |
| Arabic | 10 | 0 / 10 | 0 / 10 | 0 / 6 | 0 / 6 | 1–8–1 | 2–7–1 |
| Hebrew | 2 | 0 / 2 | 0 / 2 | 0 / 1 | 0 / 1 | 0–2–0 | 1–1–0 |
| **all** | 236 | **1 / 196** (0.5%, CI 0–1.5) | **9 / 196** (4.6%, CI 2.0–7.7) | 1 / 46 | 1 / 46 | 6–158–32 | 21–148–27 |

- B "better than stored" on its changed pages: Opus 173 of 196, Gemini 167 of 196.
- Head-to-head (losses minus wins vs A): Opus −77.6 pts (CI −84.7 to −69.9); Gemini −64.8 pts (CI −74.0 to −55.1).
- Controls: all 40 were pages where both arms kept the stored text; 0 worse. One control note found a stored misread
  both arms missed ('Scabra' for the printed 'Exesa').
- CIs are book-clustered bootstraps (`pareto-stats.mjs clusterCI`).
- Gemini's 9 "B worse" pages are mostly single-letter disputes with Opus: halbe-/halb-, Cosa/Consa, jezigen/jetzigen,
  Geseze/Gesetze, krut/kraut, gibet/gesetzet, and one Chinese numeral. One is a real loss: on Fludd's anatomy amphitheatre
  p.6, B marked a legible John 8 inscription unclear. Both judges agree on one: *Aphorismi confessariorum* p.146, where
  B changed the page number 342 to 142.
- German carries the highest Gemini rate: 5 of 32.

**Preregistered rule.** Adopt B iff, under both judges, B's worse rate is ≤ 5% of its changed pages and its
head-to-head is ≤ 5 points. Opus: 0.5% and −77.6, pass. Gemini: 4.6% and −64.8, pass. **Rule outcome: B.** The Gemini
interval runs to 7.7%, so the 5% bar is met on the point estimate, not with room.

**Write gate (40 of B's writes, blind, `AUDITOR.md`).**
- Opus: 37 better, 3 same, 0 worse.
- Gemini 3.8 Flash high: 36 better, 1 same, **3 worse** (40 of 40 opened the image). All 3 are in Greek books:
  - Nonnus *Dionysiaca* (Cunaeus) p.130: *nouam/nouum* and the æ endings, in the Latin;
  - *Anthologia* p.406: *κενὸς ἥξεις / κερδοπλήξας*;
  - Ptolemy *Tetrabiblos* p.18: *σειρῶδες / στειρῶδες*.

  The judge found Greek 0 of 20.
- Each is a direct Opus/Gemini disagreement about the leaf. 3 > 2/40, so the gate is **STOP**: none of B's 689 writes
  were applied.
- main200a passed a Gemini 3/40 as GO after relabelling those pages. This run follows the rule as written; whether to
  write B's pages is a decision for Derek (#6694).

**Contained (containment-on-finding.md).** A's Opus adjudicator, with the image open, found the stored text invented
or garbled ("neither read is usable") on 12 pages in 8 books. These were contained with `driver.mjs apply --no-writes`:
hold `ocr-unsettled-6420` (7 new holds, *Sancai tuhui* juan 85 already held), English withheld (12 revisions), plus
99 `book_checks` rows. The pages:
- Pal. lat. 1339 p.6, Pal. lat. 1340 p.11, Pal. lat. 1369 p.296
- Codex Gigas p.1
- *Etymologicum magnum* p.3
- *Sancai tuhui* juan 85 pp.56, 85, 113
- *Huiming jing* pp.19, 126, 127
- a *Thousand and One Nights* MS flyleaf p.11

B said CONTAIN on none of the 976 pages, these 12 included: it wrote a correction for each.

**Cost.**

| | A (lane B) | B (correct) |
|---|---|---|
| Opus calls | 35 adjudication chunks (870 pages); list-price equivalent $88.81, 2.2 Opus-hours | 98 calls (+7 pilot calls); list-price equivalent $96.07, 5.7 Opus-hours |
| Gemini calls | 1,109 `gemini-3.8-flash-low` reads (2 quota stops of 30 min, 4 timeouts); about 6 hours wall-clock | none |

- Judging used 48 Opus calls and 251 Gemini 3.8 Flash high calls. The audit used 4 Opus and 41 Gemini calls.
- Everything ran on subscriptions ($0 spend). "% of week" was not measured: `climits` is not on this box.
- B costs about the same Opus as A's adjudication step and saves every Gemini read. But it changes about 4× as many
  pages, so it also queues about 4× as many re-translations (`translation_stale`) when written.

**Replicated?** No: one run, one Opus read per page in each arm. The Opus judge grades Opus's own corrections, so its
1/196 may carry self-preference. The cross-family judge is the binding one, and it sits at the bar.

**Artifacts.**
- `scripts/batch/ocr-convergence/results/run/q300/`: arm A, with pages.json, frame, compare, adjudications, decisions.
- `q300/arm-b/`:
  - B's decisions and call log;
  - `reads.tar.gz` (the corrected texts in the claude-ocr read-dir shape, which `cli-ocr.mjs apply` can write);
  - `judge/` (frame, key, both judges' verdicts, result.json.gz);
  - `audit/`.
- Code: `correct.mjs`, `judge-6694.mjs`, `JUDGE.md`. `driver.mjs`'s Gemini audit now counts only verdicts that opened
  the image.

**After (2026-10-14, job opus-route-6694).** Derek overrode the audit stop.
- q300 B's writes went through `cli-ocr.mjs apply` with the shared-words guard on and `--mark-stale=convergent-ocr-6420`:
  - **600 written** (Latin 356, German 124, Greek 63, Arabic 38, Hebrew 10, Chinese 9);
  - 17 refused by the guard;
  - excluded: pages in held books, the contained pages, and the 3 disputed Greek pages.
- A read-from-image spot check of 5 written pages (one each in Latin, German, Chinese, Arabic and Greek) found all 5 better and none worse.
- B then read ranks 301–1000 of the queue: one run dir per 100 ranks, `q400` … `q1000`, reads only. Greek books are listed per batch in `greek-lane-a.json`.
- Unlike q300, where B said CONTAIN on 0 of 976 pages, B named wrong-leaf or invented text on pages of 13 books by the end of q900. The job checked one per book by eye or from the text, and contained them under `ocr-wrong-leaf-6694`.
- Per-batch counts are in the issue thread (#6694).

