---
stage: ocr
measure: [judged]
languages: [en, el, de, la, fr, es]
scripts: [Latn, Grek]
canons: []
n_books: 217
n_pages: 3021
verdict: "The stranded IA residual (#5309) can be repaired at $0 on agy: an agy leaf screen (flash-medium) agreed with Opus on 30/30 pre pages and 4/4 controls, and in production on 120/120 sampled off-leaf calls (p2-p5) and 156/157 own-leaf calls (p3-p5); 3,021 pages in 217 books were re-OCR'd (flash-low) and 551 re-translated. Post checks: p2-p4 own leaf 30/30 and usable 30/30 each; p1 and p5 failed at 29/30 (one invented page each), both contained the same run. 2,558 screened off-leaf pages stay unwritten because the guards refused the read."
status: adopted
decision: "Repair applied in waves p1-p5 through scripts/maintenance/offleaf-fix-5309.mjs with the agy screen in front (#5309); stopped after p5's 29/30 per the brief; 3 big books (1,683 pages) and 43 held books not run."
feeds: [repair, detector]
landed: "scripts/maintenance/offleaf-fix-5309.mjs"
router_evidence: "none — a repair with one route (agy gemini-3.8-flash-low OCR); the judge measures leaf identity and usability, no route compared"
defect_rates: "none — defects counted per page by kind and severity (scripts/eval/results/offleaf-5309-2026-11-08/post*/post-result.json), not per 1,000 words"
supersedes: []
superseded_by: null
issue: [5309, 5026, 8399]
---
## 2026-11-08 · Can the stranded-leaf residual on Internet Archive books be repaired on agy at $0? (#5309)

PRIOR ART: `scripts/audit/stranded-image-repair-text.mjs` (the frame), `scripts/batch/cli-ocr.mjs` /
`cli-translate.mjs` (the writers, guards on), `scripts/lib/stranded-leaf-gate.mjs` (stands in for the 40%
shared-words floor on a page whose stored text is another leaf's), `2026-11-04-stranded-run-repoint-5803.md`
(re-pointed whole runs at $0; this run reads the pages no shift could place).

**Who it is for.** A reader on an Internet Archive book who sees the right scan beside the previous
page's text. The 2026-10-02 repair deferred this residual only because paid flash would have overrun its envelope.

**Frame (2026-11-08 audit).** 11,455 stranded pages in 322 books (11,169 live in 299). Of the 6,111
deferred on 10-02, 5,225 were still stranded (110 books). Withheld English never remade: 26,554 pages in
English books (modernisation is reader-triggered since #4958, so not this job's), 3,485 live non-English.
Positive controls in the issue: 12/12 still read their own leaf.

**Pre (precision of the audit).** 30 stranded pages, one per book, blind Opus with scans n-3…n+3:
28/30 another leaf = 93% (Wilson 79–98%); offsets -1×25, -3×2, +1×1.

**Screen (Derek's inbox note, 06:13Z).** agy gemini-3.8-flash-medium, given the stored text and scans
n-1…n+1: own / prev / next / other. On the 30 pre pages: 30/30 agreement with Opus (binary and exact),
4/4 planted controls, 0 false alarms, 0 misses (only 2 own-leaf items, so own-leaf recall was thin there).
In production, Opus read every page agy did not call off-leaf (own capped at 5–15 per book from p3, since an
unconfirmed own call is never written) and 30 sampled off-leaf calls per wave:

| wave | screened (books) | agy off | Opus on agy own | Opus on 30 agy off |
|---|---|---|---|---|
| p2 | 600 (33) | 580 | 20/20 (all not-off calls) | 30/30 |
| p3 | 2,000 (40) | 1,423 | 42/42 | 30/30 |
| p4 | 2,000 (89) | 1,536 | 95/96 (1 cannot tell) | 30/30 |
| p5 | 1,651 (76) | 1,511 | 19/19 | 30/30 |

The screen also removed false positives the audit cannot see. Lingua Aegyptiaca Restituta (523 pages,
diagnose "undecided") was own leaf on 522; Opus agreed on the 15 it read.

**Repair and post checks.** For each confirmed off-leaf page: a cli-ocr read on agy flash-low (the live
prompt, one page a call), then apply with every guard on. Non-English pages were then translated
through cli-translate with `--no-previous-translation`. A post check takes one repaired page per book (30 a wave)
plus 2 planted wrong-leaf controls, judged blind by Opus with scans n-1…n+1 and by agy flash-low as a second checker.

| wave | written | not written (guards) | own leaf | usable | agy checker vs Opus | controls (Opus / agy) |
|---|---|---|---|---|---|---|
| p1+p1b | 329 | 211 | 29/30 FAIL | 29/30 | 29/30, 1 FA | 2/2, 2/2 |
| p2 | 325 | 255 | 30/30 | 30/30 | 30/30 | 2/2, 1/2 |
| p3 | 638 | 785 | 30/30 | 30/30 | 30/30 | 2/2, 2/2 |
| p4 | 723 | 802 | 30/30 | 30/30 | 27/30, 3 FA, 0 miss | 2/2, 2/2 |
| p5 | 1,006 | 505 | 29/30 FAIL | 29/30 | 28/30, 2 FA, 0 miss | 2/2, 2/2 |

Every other defect Opus found was minor: misreads and the odd added word, never a passage.

**The two failures.** p1: page 117 of 69ef286185daccce30f2ca01 had invented Jerome text. A corroboration audit
found 13 invented reads, all with the agy read_file allow→deny shape. They were reverted
(revert-run, offleaf-5309-p1-ocr/-p1-tr), re-read (p1fix), and two guards were added: the gate now needs
corroboration, and a denied image read is refused. p5: R06, Florus p.748, is a blank verso.
The read transcribed the faint ghost of another index page as print. The agy checker flagged it too. It was
contained in the same run: the book was held, the page was re-read fresh and came back `blank`, the read was checked by eye
against the image and applied (`offleaf-5309-fix748-ocr`), and the hold was released. To see whether this was a class, Opus
then read every written page whose read carries a show-through/offset/mirror warning (53 pages, all waves):
53/53 own leaf and usable. The brief's stop rule was followed: p6 was not run.

**What the guards refused (2,558 pages).** The largest share is agy answering with a summary of the page
("Would you like a more detailed summary…") instead of a transcription, on 19th–20th-century English
books (p3: 164 of 376 refusals in the first five books). Next come cut replies, a second marker,
denied image reads, and no neighbour corroborating the read. They stay stranded, and none was written.

**Harness bugs found.** `isQuotaError` read a short reply "Page 429 …" as an HTTP 429 and locked the model
for an hour; fixed, with a unit test. The post-judge prompt clipped the stored text at 6,000 chars, and Opus
called the clip an omission; the clip is now 30,000 and the two affected verdicts were re-judged.

**Not done.** p6: three books of 465–688 pages (1,683; Buddhism in Translations is likely the djvu
artifact #5803 found aligned). 43 held books (2,981 pages) are skipped by design. A retry pass over the 2,558 refused pages
was not run, and English modernisation of the 26,554 withheld English-book pages is #4958's lane.

**Replicated?** The screen held across four production waves (296/297 Opus confirmations). Post checks: 5 waves, 3 passes.

Artifacts: `scripts/eval/results/offleaf-5309-2026-11-08/` (pre, screen-p2…p5, post1…post5, showthru,
ledger.jsonl.gz). Revert run ids: offleaf-5309-{p1,p1b,p1fix,p2,p3,p4,p5}-{ocr,tr}, offleaf-5309-fix748-ocr.
