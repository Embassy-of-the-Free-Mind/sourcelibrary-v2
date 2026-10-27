---
stage: ocr
measure: [judged, agreement]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 19
n_pages: 91
verdict: "The 'severe' Tibetan correction errors are mostly real, not mantra spelling. Re-classed by what a reader would notice, arm A of PR #7505 has 28 severe pages of 72 (it had 31). The 24 mantra and normalisation spans that were counted as severe sat on 4 pages. Of the 11 severe spans that both judges confirmed and that were then checked by eye, the leaf showed the draft at all 11. On 19 pages the lane has already written (wave 2, one per book), 6 have a new severe error: 3.2 per 10 [1.5, 5.4]. The same pages fix 48 severe-class spans and 145 minor ones, and the whole-page judge rates 9 better, 10 same, 0 worse."
status: undecided
decision: "Owed to Derek: the written lane fails the rule 'severe on fewer than 2 of 10 pages' at 3.2/10. Recommended: pause new volumes, revert no class wholesale, and remove only confirmed severe spans (#6560)."
superseded_by: null
issue: [6560, 6740]
---
## 2026-10-27 · What are the "severe" Tibetan correction errors? Re-class, Derge check, by eye, real-world rate (#6560)

PRIOR ART: `2026-10-27-tibetan-corrector-profiles-diff-qa-6560.md` (PR #7505: the 72-page diagnostic set, arms A/B/C,
span judge with `--severity`, confirm judge, whole-page judge, diff QA). This entry makes no new corrector calls. It
re-classes that run's verdicts, checks them against Derge and by eye, and then runs the same three judges on pages
the lane has already written.

**Why.** Derek (2026-10-27): "I question what those 'serious errors' are." The #7505 severity prompt labels the
*difference* between two readings. It counts mantra vowel length as severe. The 72-page set was chosen because it was
hard, so its rate is not the corpus rate.

### 1. Re-class by reader impact (no model calls)

`severity-recheck/classify.py` uses rules first and a hand table for the rest (`hand-labels.json`, 96 entries). The
hand table covers the spans the rules cannot settle, for example one letter changed in one syllable: ཚོན→ཚོགས is
another word, ཙད→ཅད is a spelling.

- **normalisation** (O8): mantra or Sanskrit vowel length, anusvara or candrabindu, visarga, a tsheg inside a Sanskrit
  cluster, a Sanskrit form put for the Tibetan one (ཀ་ཏྱའི་བུ→ཀཱ་ཏྱཱ་ཡཱ་ན).
- **mantra**: a mantra letter changed beyond normalisation (ཨཱ→ཞཱ, ཊཱ→ཏྲཱ). This class is shown separately and is
  not counted as severe.
- **minor**: a particle variant, a particle added or dropped, tsheg or shad, a split or join, the same word spelled
  another way, the tense or honorific form of the same verb.
- **severe** (O1/O5/O6/O7): another word with another meaning, a negation, a number or a name, or text added or
  dropped. It has three sub-kinds: a word swap (1–2 syllables), an add/drop, and a phrase (3+ syllables).

The judges' verdicts on which reading the leaf shows are unchanged. A page is severe under three conditions:
- a severe-class span where the span judge **and** the confirm judge saw the draft on the leaf;
- the whole-page judge finds a new wrong-text defect that is not O8;
- the page is a wreck (over 25% changed).

**Arm A, the spans #7505 counted as severe introduced** (the leaf shows the draft):

| class | spans | pages | both judges | Derge says (all) |
|---|---|---|---|---|
| normalisation | 22 | 3 | 17 on 1 page (ཧུྃ→ཧཱུྃ ×17) | — |
| mantra letter | 2 | 1 | 1 | — |
| minor | 5 | 4 | 1 | — |
| severe: word swap | 16 | 13 | 12 on 10 pages | draft 10, arm 1, neither 4, not placed 1 |
| severe: added/dropped | 12 | 10 | 10 on 8 pages | draft 8, arm 3, neither 1 |
| severe: phrase 3+ | 16 | 11 | 11 on 8 pages | draft 6, arm 1, neither 6, not placed 3 |

**Derek's rule** (fewer than 2 of 10 pages severe, i.e. at most 14 of 72), with #7505's verdicts and the new classes:

| variant | #7505 severe pages | re-classed (both judges) [95%] | one judge only | rule |
|---|---|---|---|---|
| A | 31 (4.3) | 28 (3.9) [2.9, 5.0] | 30 | fail |
| B | 33 (4.6) | 29 (4.0) | 31 | fail |
| C | 31 (4.3) | 28 (3.9) | 31 | fail |
| A + lane guards | 18 (2.5) | 15 (2.1) | 17 | fail |
| A + diff QA | 18 (2.5) | 17 (2.4) | 17 | fail |
| **B + diff QA** | 13 (1.8) | **12 (1.7)** | 15 | **pass** |
| C + diff QA | 17 (2.4) | 16 (2.2) | 17 | fail |

**The re-class moves the page counts by 1 to 4 pages, and no verdict changes.** The mantra spans were 24 of 73 by count,
but they sat on 4 pages, and most of those pages are severe for other reasons too. In arm A, a page is severe:
- through a confirmed span: 19 pages;
- through the whole-page judge: 12 pages (dropped or invented lines, O1/O5/O6);
- as a wreck: 4 pages.

### 2. Derge check (`severity-recheck/derge-spans.py`)

Each draft page was placed in Derge with `tib-derge.py locate` (PR #7465, OpenPecha P000001). 71 of 72 pages were
placed. The one that was not, Thadrak brGyad stong p.415, is dedication verses, not Kangyur text. Each severe draft-win span
of A, B and C (unique, 115) was set in its context and aligned locally to the window:

| sub-kind | spans | draft = Derge (Flash broke good text) | arm = Derge, leaf shows draft | neither | not placed |
|---|---|---|---|---|---|
| word swap | 57 | 36 | 7 | 10 | 4 |
| added/dropped | 25 | 14 | 5 | 6 | 0 |
| phrase 3+ | 33 | 17 | 1 | 10 | 5 |
| **all** | **115** | **67 (58%)** | **13 (11%)** | **26** | **9** |

**Most severe spans are Flash breaking text that Derge agrees with. They are not recitation.** "arm = Derge" is a weak
signal of recitation. The by-eye sample below had 4 such spans:
- one where the arm really was right (the draft had skipped a passage);
- one spelling variant (ཁྲི་ཁྲག for ཁྲི་ཕྲག);
- one interlinear insertion the arm dropped;
- one where the alignment matched a repeated formula on the next line.

None of the 4 was Flash supplying Derge text that the leaf lacks. Derge is also not this manuscript's text, so
"neither" includes real manuscript variants.

### 3. By eye, 15 spans at full resolution (`results/.../by-eye-15.json`)

The sample is seeded (6560): 5 phrases, 5 word swaps and 5 adds/drops from arm A's severe draft-win spans. Each span
was opened in a brightened full-resolution crop of the page image (`zoom.mjs`).

| stratum | leaf shows draft | arm | neither | span judge right | counted severe (both judges) and draft by eye |
|---|---|---|---|---|---|
| phrase | 4 | 0 | 1 | 4/5 | 3/3 |
| word swap | 4 | 1 | 0 | 4/5 | 4/4 |
| add/drop | 4 | 1 | 0 | 4/5 | 4/4 |
| **all** | **12** | **2** | **1** | **12/15** | **11/11** |

- **The span judge alone is wrong 3 times in 15.**
  - #11: the leaf has the passage the arm added; the draft had skipped it.
  - #6: the leaf reads བླ་མར་བགྱིད, which is the arm's reading.
  - #3: the lower leaf's first line is missing from the draft; the arm puts back a shortened version of it.
- **Every span that both judges confirmed was right by eye: 11 of 11.** The confirm step is what makes the count
  trustworthy. It overruled the span judge on #6 and #11, and answered other or unclear on #1 and #3.
- One confirmed span was re-classed after the eye check: ཁྲག→ཕྲག in ཁྲི་ཁྲག is a spelling of ཁྲི་ཕྲག ("ten
  thousand"), so it is minor. It is in the hand table.

### 4. Real-world rate: pages the lane has written (`severity-recheck/realworld.mjs`)

- **Frame.** Pages whose stored OCR is the lane's write (`ocr.pipeline = tib-correct-6560`, Flash-low), excluding
  Neyphug rGyud Tsha (wave 1) and #7505's 72 pages. That is 7,284 pages in **19 books**, so one page per book gives
  19, not 20.
- **Draft.** The draft is the Yigdzin row that the write replaced, in `page_revisions`.
- **Judges.** The span judge was asked the three classes in its prompt. The confirm judge ran on every severe
  draft-win span and every line hunk. The whole-page judge ran on the draft and on the written text. 66 sealed Opus
  calls.

| | value |
|---|---|
| pages severe | **6 of 19: 3.2 per 10**, Wilson 95% [1.5, 5.4], by-book bootstrap [1.1, 5.3] |
| from confirmed spans / whole-page judge | 5 / 1 |
| spans fixed / introduced | 195 / 17 |
| introduced, by class | severe 7, minor 9, mantra 1, normalisation 0 |
| fixed severe-class spans (span judge only) | 48 on 13 pages |
| span judge: better / same / worse | 18 / 0 / 1 |
| whole-page judge: better / same / worse | 9 / 10 / 0 |
| controls (span, confirm) | 37/38, 14/18 |

The 6 severe pages:
- Thadrak 'Dus 'khor p.411: བགོ་བ→གོས་བཟང.
- Neyphug mDo sde Ma p.263: འཚལ→འཆལ ("ask" becomes "immoral").
- Kanjur dKon brtsegs Nga p.246: བས→བསལ (a second severe span there was not confirmed).
- Neyphug mDo sde Ja p.350: ན་བདེ→ནད་པ་དེ. The leaf has ན་བ་དེ; the draft was wrong too.
- Kanjur Sras sna tshogs p.150: དེ་ཅིའི→དེའི. The question "why is that?" becomes "therefore".
- Kanjur Phal chen Ka p.212: Flash **swapped two lines** of the lower leaf, the 4th and 5th. They now read in a better
  order, but not in the order the leaf has them, which I checked by eye. The line-count guard cannot see a swap.

No severe page in this sample came from mantra or normalisation. Flash's mantra habit is real, but it lands on few
pages.

### What it means

The severe errors are real word substitutions, plus dropped or reordered lines. The counts are not inflated by mantra
spelling. The two-judge count is accurate (11/11 by eye). On written pages the lane:
- fixes far more than it breaks (195 spans fixed against 17 introduced; 48 severe-class fixes against 7 severe
  introductions);
- makes no page worse by the whole-page judge;
- still leaves a new severe error on about 3 pages in 10 (1.5–5.4), which is above the rule's 2.

**Recommendation.**
- **Pause new volumes:** the rule fails at 3.2/10.
- **Revert no class wholesale.** Reverting the normalisation class removes nothing on written pages (0 introduced).
  Reverting whole pages would bring back about 7 severe errors for every 1 it removes.
- **On the written pages, put back only the spans that both judges confirm as severe.** That is the shape of the
  vol1 job's diff-QA tranche, and of B + diff QA, the only variant that passes.
- **Add a line-order check:** does each output line match the leaf line at the same position? The swap on p.212
  passes every guard the lane has.

### Cost

- 66 sealed Opus calls on the subscription: span 19, confirm 9, whole page 38.
- 0 agy calls; $0 paid. No page, book or R2 object was written.

### Artifacts

- Scripts: `scripts/eval/tibetan-correct-6560/severity-recheck/`.
- Results: `scripts/eval/results/tibetan-correct-6560/severity-recheck-6560/`:
  - `hunks-7505.jsonl.gz`: every hunk's verdicts from #7505's score;
  - `reclass-7505.json.gz`;
  - `derge-locate.jsonl`, `derge-spans.jsonl`;
  - `by-eye-15.json`;
  - `realworld-score.json.gz`.
