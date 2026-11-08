---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 159
n_pages: 1539
verdict: "Paired-fifths turns 24 of 159 books (15.1%) from good to bad; 18 of them on a failed join alone. Controls 10/10 and 10/10."
status: undecided
decision: "The preregistered rule is met: the standing Opus QA should move to paired-fifths. The switch itself is a follow-up PR (not made here)."
feeds: judge
superseded_by: null
issue: [8405, 7866, 8399]
router_evidence: "none — no route compared"
defect_rates: "none — the bad-page and bad-book rules of #7866 are reused; join failure rates below are a judge's calls on 759 breaks, not corpus defect rates"
---
## 2026-11-08 · Two adjacent pages from each fifth: does the paired check find bad books the 5-page check misses? Results (#8405)

Preregistration: `2026-11-08-paired-fifths-prereg-8405.md` (the rules and the decision were not changed).
Code: `scripts/eval/paired-fifths-8405/run.mjs`, run from #8411's branch (#8411 was not yet merged).
Output: `scripts/eval/paired-fifths-8405/results/{score.json,books.json,frame-summary.json}`. Verdicts are in
`$JOB_SCRATCH/paired-fifths-8405/verdicts.jsonl` on the job host. Nothing was written to Mongo or `book_checks`.

### Run
- **Frame:** 160 books, 789 pairs, 29 anchors left unpaired, 17 stale anchors judged again.
- **Census stratum skipped:** #8409 (`openingEcho`) was not merged at frame time, so the frame printed "census stratum skipped". No census precision for #8399.
- **Calls:** 1,557 Opus calls (`claude -p`, subscription), under the 1,800 cap. One join parsed to nothing, and its retry was stopped by the pace guard (`meter unreadable … fail closed`). The guard was not bypassed. That leaves **159 of 160 books complete**.
- **Harness fix:** a worker could take a job index past the end of the list while it waited on the pace check. It now re-checks first (one line, no rule touched).

### Results against the preregistered rule
| | |
|---|---|
| Controls (join judge) | carry-over **10/10** caught, wrong-leaf **10/10**: **valid** |
| Complete books | 159 (≥ 80) |
| Bad on anchors (5 pages) | 66 |
| Bad paired (10 pages or any failed join) | 83 |
| **Good → bad** | **24 (15.1%)**: 18 by joins only, 4 by partner pages only, 2 by both |
| Bad → good | 6 |

**Decision line as analyze printed it: `pairs for the standing Opus QA`** (15.1% ≥ 5%).

### Also reported
- **Breaks:** 759 judged, 72 failed (9.5%). By kind: `call_boundary` 7 (1 failed), `in_call` 0, `unknown` 752 (71 failed). Almost no frame page carries `translation.engine.run.read_call`, so the kind split says nothing yet.
- **Direction of failed breaks:** page A holds the misplaced text in 26, page B in 31, both in 15.
- **Failed defects by kind and layer:** dropped/english 38, dropped/transcription 19, carry_over/english 21, wrong_leaf/transcription 12, wrong_leaf/english 8, duplicated/english 6, carry_over/transcription 1, duplicated/transcription 1.
- **Reliability of the 10-page grade:** split-half r (anchors vs partners) 0.681 over 158 books; Spearman–Brown to 10 pages **0.811** (an upper bound, since pair-mates are not independent). The #7866 5-page figure was 0.75.

### By eye (5 failed joins, both scans opened)
1. **Arati Phaenomena** (Latin), pp. 188/189, wrong_leaf: confirmed. Scan A is a Hydra/Crow woodcut over prose ("Ydra sup cui⁹ caudã coruũ…"). Scan B is prose followed by verse from "Etherium uenit in thalamum". The stored texts are verse from other leaves. This book failed 4 joins of this kind.
2. **Armenian homily**, pp. 169/170, carry_over/english A: real but minor. Scan A ends "…յառնել վաղվաղակի 'ի սե-" and B opens "ղանոյ անտի, զի մի ընդ գինեմոլան…". A's English finishes the sentence with B's first clause and B's English starts after it. Nothing is lost.
3. **yid bzhin mdzod** (Tibetan), pp. 8/9, dropped/english B: page B has **no English at all** (an empty translation). That is a missing page translation, which the `dropped` rule counts as a break defect.
4. **German address to Grand Duke Karl**, pp. 6/7, carry_over/english A: same shape as case 2. The verb "aufgenommen und ernannt worden bin" is printed on B, and German is verb-final, so A's English can only finish its sentence by reaching onto B. The judge itself notes "nothing is duplicated or dropped". **This flipped a good book to bad.**
5. **Vie et voyages de Hiouen-Thsang** (French), pp. 10/11, wrong_leaf + duplicated: confirmed. Scan B is p. 11 ("LIVRE PREMIER … Après avoir terminé ces conférences…"), but its transcription and English repeat p. 10.

**What this means for the rule (no decision changed).** The join rule counts every material `carry_over`, and the judge marks a translator finishing a sentence across the break as material. 13 of the 72 failures are only that shape (English carried over on A). Sensitivities, all computed from the same verdicts:
- A-finishes-sentence not counted as a failure: 20 flips (12.6%).
- That, and English-only `dropped` not counted either: 14 flips (8.8%).
- Only wrong-leaf joins plus the page rule: 8 flips (5.0%).

The decision holds in every one of these readings, at the threshold in the strictest. A standing join check should not fail a book on "A finishes its sentence" alone. Before the paired check becomes the standing QA, either the join prompt or the fail rule should exclude it.

### Pages that carry another page's text (containment is a separate step)
Wrong-leaf or duplicated, from the join judge (cases 1 and 5 confirmed by eye; the rest are the judge's call):
- Arati Phaenomena, Geographia, Ora Maritima `69af48642a821385be062737`: pp. 77, 78, 127, 128, 188, 189, 206, 207
- De Rebus Fatisque Huius Seculi `6a4cb63519ae103166961ce4`: pp. 2, 3, 15
- 大唐西域記 / Vie et voyages de Hiouen-Thsang `69e961652beefe2f6f72b4a8`: p. 111 (stored page number; printed p. 11)
- Ueber den Nutzen eines frühzeitigen Studiums `6a243d6f0f0e4f405e630221`: p. 14 (English)
- Duplicated English: Derge Tengyur `6abe8dbb6a920ffd924d59c0` p. 480; 植物名實圖考(六) `6992cf0e284cdd19fef46f38` p. 54; Sidereal Messenger `6953e47477f38f6761bee59e` pp. 35, 124; Post-Reuter `6a267ed26c1f37c9c4f3cc35` p. 13

## Addendum: census stratum (amendment 1), 2026-11-08

**What was run.** `run.mjs census` on `echo-flagged-8405.jsonl` (`scripts/audit/translation-page-boundaries.mjs`, `kind:"echo"` lines): 5,577 lines after dropping `parallel: true` and `sourceRepeats: true`. Seed 84054 drew 40 breaks, at most 3 per book; all 40 had both pages' texts. Same join judge (Opus 5.5, same prompt). The 160th frame book also finished in this run, so the book-level numbers moved by one book (24/160 flips, 15.0%; decision unchanged).

**Detector precision (judged defect / judged): 23/40 = 0.575.**

| split | judged | judged defect | precision |
|---|---|---|---|
| break_kind `unknown` (no `read_call` on one or both pages) | 37 | 23 | 0.62 |
| break_kind `in_call` | 2 | 0 | 0 |
| break_kind `call_boundary` | 1 | 0 | 0 |
| `sourceRepeats: null` (source side unknown) | 0 | — | — |
| `sourceRepeats: false` (source checked) | 40 | 23 | 0.575 |

Most breaks were `unknown` (37/40) because one or both pages carry no `translation.engine.run.read_call`. With only 3 breaks of known kind, the split cannot say whether call boundaries leak more. The 135 `sourceRepeats: null` lines are 2.4% of the frame, and none was drawn, so the source-unknown split is empty.

**Why the judge passed 17 flagged breaks.** These are the judge's notes, not by eye except where marked. 2 were facing-page editions the `parallel` flag missed (Welsh/English *Barddas*, Loeb *Historia Augusta*; both checked by eye). 1 was a colour calibration target shot twice. 2 were overlapping photographs where the same background leaf shows on both scans. The rest were clean joins whose English shares wording across the break, such as running heads or repeated technical vocabulary.

### By eye (both scans opened)
Judge **failed**:
1. Wolff, *Psychologia rationalis* (Latin), pp. 612/613, carry_over A: **real leak.** Scan A ends "adeoque in". A's English goes on through "…neither can a distinct notion of the origin of a contingent spirit be formed", which is printed on B, and B's English translates the same passage again.
2. Benzo, *Scheeps-togt* (Dutch), pp. 23/24, carry_over + duplicated A: **real leak.** Scan A ends "welker handen op / ha-". A's English carries B's first sentence ("These he presented to our commander…"), and B's English repeats it.
3. Dostoevsky, *Дневник писателя* (Russian), pp. 316/317, wrong_leaf A: **real, and worse than a carry-over.** A's English is a second translation of B (printed p. 314). Printed p. 313 has no English at all.
4. Yogananda, *Songs of the Soul* (English), pp. 88/89, duplicated B: **real, but a different mechanism.** Scan B prints only "PART III". Its English layer contains a leaked "**Previous page (modernized) for continuity:**" block that repeats p. 82's poem. The context prompt leaked into the output.
5. Ferdinand III, *Manifest und Abmahnungs Schreiben* (German, Vienna 1644), pp. 19/20, duplicated + carry_over A: **not a translation leak.** Scan A is a cropped second shot of the same printed p. 8 shown in full on B. Both translations follow their scans. The duplication is in the capture, which a reader still sees as the same page twice.

Judge **passed**:
1. Fictuld, *Azoth et Ignis* (German), pp. 87/88: **clean, by eye.** Scan A ends "…ein reines Gold/" with catchword "das", and B begins "das durch alles Creutz". The English splits at the same point.
2. *Barddas* (Welsh), pp. 11/12: **a facing-page edition, by eye** (Welsh left, English right). This is a detector false positive that `parallel` did not catch.
3. *Sammlung … Frankfurter Wirren* (German; the pamphlet *Humanität, Religion und Christenthum*), pp. 317/318: **clean, by eye.** Both photographs show the same title leaf behind the open pamphlet, and that leaf is the shared text. The body text joins at "hoch- / erleuchteten Bruders".
4. Descartes, *Opera philosophica* (Latin; *Principia*, pars IV), pp. 709/710: **a small real leak the judge marked immaterial.** Scan A ends "…quæ mensis / spatio" (catchword). A's English goes on with "traverses the circle A B C D in the space of a month", which is printed on B, and B's English repeats it.
5. *Historia Augusta*, Loeb (Latin/English), pp. 230/231: **a facing-page edition, by eye.** This is a detector false positive.

By eye, then: 4 of the 5 judge-failed breaks are real translation leaks, and the fifth is a duplicate capture. 1 of the 5 judge-passed breaks has a small real leak. The judge's 0.575 is a fair reading of how often a flagged break is a defect a reader would see. Most of the detector's false positives are facing-page editions and clean joins.

The full list of judged leaks, with page links, is in the #8399 comment. Containment is a separate step, and no page was hidden or re-translated here.
