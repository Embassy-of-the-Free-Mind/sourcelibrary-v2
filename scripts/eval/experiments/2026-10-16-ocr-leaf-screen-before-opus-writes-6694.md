---
stage: ocr
measure: [judged, detection]
languages: [la, de, zh, grc, ar, he]
scripts: [Latn, Hani, Grek, Arab, Hebr]
canons: []
n_books: 585
n_pages: 5844
verdict: "A gemini-3.8-flash-low leaf screen ('is this text the text of this leaf; is any passage not on it?') over 4,714 of arm B's Opus corrections and keeps (queue ranks 301–1000) flagged 18 pages; a sealed Opus settled 16 as false positives (annotation tags such as <vocab>, <warning>, descriptions of blank leaves) and confirmed 2, both arm B's own refusals (a model <warning> in place of a modern preface), not invented served text. On calibration it caught 2/2 whole-page wrong-leaf shifts but only 2/12 stored texts that lane B's Opus adjudicator had judged invented or garbled in place: a pass means 'not another leaf's text', not 'no invention'."
status: adopted
decision: "Job opus-screen-6694 (#6694 step 3) ran the screen, Derek's q300 audit rule and cli-ocr.mjs apply on every batch: 3,624 arm B pages written, 150 refused by the shared-words guard, 16 audit-disputed pages withheld from the write; Greek on lane B: 92 written, 48 refused, 31 pages contained in 13 books."
superseded_by: null
issue: [6694, 6420]
---
PRIOR ART: 2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md — the side-by-side that chose arm B and found it never answered CONTAIN on q300; this entry is the screen put in front of B's writes, and what it can and cannot catch.

## 2026-10-16 · A Gemini leaf screen in front of Opus correct-in-place writes (#6694 step 3)

**Frame.** Arm B's reads of `queue-next-1000.json` ranks 301–1000 (job opus-route-6694; `results/run/q400` … `q1000`),
minus books held at prep: 4,714 pages screened (3,810 B writes, 904 keeps). Greek books (`greek-lane-a.json`, 1,130
pages in 116 books less those held) went through lane B unchanged.

**Screen.** `scripts/batch/ocr-convergence/screen-6694.mjs` + `SCREEN.md`: one `gemini-3.8-flash-low` call per page
(agy, plan mode, tool gate), the image attached and B's text inline; answer OK / WRONG-LEAF / INVENTED / UNREADABLE.
A reply without `view_file` on the image, or without an answer, is "no screen" and was asked once more (all 4,714
ended screened). Non-OK pages went to a sealed Opus (`SETTLE.md`, image opened or the verdict is dropped).

| batch | screened | flagged | Opus confirmed | audit Opus / Gemini worse (of 40) | written | guard-refused |
|---|---:|---:|---:|---:|---:|---:|
| q400 | 700 | 0 | 0 | 0 / 4 | 527 | 32 |
| q500 | 620 | 3 | 0 | 0 / 1 | 507 | 9 |
| q600 | 650 | 5 | 1 | 0 / 1 | 447 | 35 |
| q700 | 669 | 4 | 1 | 0 / 0 | 541 | 20 |
| q800 | 725 | 3 | 0 | 0 / 3 | 555 | 23 |
| q900 | 670 | 0 | 0 | 0 / 4 | 517 | 23 |
| q1000 | 680 | 3 | 0 | 0 / 3 | 530 | 8 |
| **all** | **4,714** | **18** | **2** | **0 / 16** | **3,624** | **150** |

**Calibration** (`results/run/q300/screen-6694-calibration/`, `q400/screen-6694/screen-positive-control.jsonl`):

| texts screened | n | flagged |
|---|---:|---:|
| stored text known to be the NEXT page's (Faust *Compendium* pp.50, 105) | 2 | 2 (WRONG-LEAF, naming the right printed page) |
| q300 contained pages, stored text (lane B Opus: invented / garbled in place) | 12 | 2 (*Huiming jing*) |
| the same 12 pages, arm B's corrections | 12 | 0 |

**Reading.** The screen is a wrong-leaf detector, not an invention detector: hard-hand manuscripts with plausible
invented text in place (Pal. lat., Codex Gigas, *Sancai tuhui*, *1001 Nights*) pass it. Its false positives are the OCR
format's own annotation tags. The 2 confirmed flags were arm B returning a model `<warning>` instead of a modern
edition's preface (*Essence of the Taoist Canon* p.7, *Ishimpō* p.4): not written, not contained (the served text was
not found wrong), a rights question.

**Audit agreement** (Krippendorff α, `judgeReliability`, bootstrap by book): on B's 40-write audits α for
better/stored/same ran −0.05 to 0.73 and for "B worse" −0.04 to 0.00 — **not settled** in every batch: the two judges
never called the same B write worse. Opus called 0/280 worse; Gemini 16/280, all direct disputes with Opus about a
reading on the leaf (page numbers, single words, marginal notes).

**Greek on lane B.** 1,130 pages: 92 written; 48 refused by the shared-words guard (25 in q800, mostly Stephanus
Plato and Loeb Hippocrates parallel-text editions, where the stored text is probably the facing Latin/English); 31
pages contained in 13 books (Barocci 131/235/241, Theon, Proclus, Aristotle *Rhetoric* MS, Plato Clarke, Homer CCC,
Vat. gr. 244, Pal. gr. 182, Petrus Hispanus, a Thucydides MS) — Greek minuscule manuscripts, invented in place.
