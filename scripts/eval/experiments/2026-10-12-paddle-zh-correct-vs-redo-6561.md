---
stage: ocr
measure: [accuracy, judged]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 100
n_pages: 100
verdict: "On Paddle's Chinese pages, Opus correcting Paddle's draft beats both Paddle and an Opus re-read. On the 40 withheld table pages: median CER 4.0% against Paddle 6.4% and Opus redo 5.8%, better on 31 pages and worse on 1. On ordinary pages the gain is small (−1.0 pt on 30 random pages, 2 made worse) and sits on the pages the lane's own Kanripo screen already scores below 0.95 dice. Every corrector left at most 1 of 30 planted errors. 3.1 Pro makes 21 of 40 table pages worse. A cross-family read-off disputes 26–36% of every arm's edits toward Kanripo, Opus included, and the two judges agree on only 70% of items, so it does not separate the arms. Opus quota, not speed, bounds the lane: the 4,379 table pages take about 1 account-week, dice < 0.90 (414K pages) about 97, the whole 1.57M lane about 369."
status: adopted
decision: "Opus corrects Paddle's draft on the flagged table pages (job table-correct-6561; routing rows chinese-tables and correct-not-redo). Closed in #6688"
superseded_by: null
issue: [6561, 6388, 6553]
---
## 2026-10-12 · Paddle Chinese: correct flagged pages or re-read them, with which model, and does it fit the quotas? (#6561)

PRIOR ART: `2026-10-12-paddle-zh-table-opus-reread-pilot-6388.md` (PR #6574: the 100-page Opus re-read of the
withheld table pages, NO-GO at 23% invented). Its Opus reads are this entry's redo arm on set A, unchanged.
`2026-10-11-paddle-zh-table-detector-6388.md` (the over-count measure) and the #6547 Greif replication (correction
helps a weak reader; Opus anchoring 0/33). Code, draw and outputs: `scripts/eval/paddle-correct-6561/`.

**Design (#6561; one pass, no production writes, $0 on the subscription CLIs, 2 calls in flight).**
- **Set A:** 40 of the pilot's 100 withheld table pages, drawn (seed 6561) from the 48 whose own Kanripo leaf aligns.
- **Set B:** 60 ordinary Paddle pages (not table-flagged, interior, ≥ 40 Han characters) with a trusted own leaf
  (`ocr.qa_screen` screened, dice ≥ 0.6):
  - 30 random, one per book, from the lane's books;
  - 30 where Paddle and the stored second read disagree (the lane's superseded Gemini 3 Flash preview reading,
    old-vs-new CER ≥ 0.10).

  59 of the 60 align `own`. Selecting on a trusted leaf leaves out pages where Paddle is far off the leaf. In the
  disagree draw, 225 of about 290 candidates were dropped that way.
- **Arms:**
  - Paddle as served;
  - Opus, 3.1 Pro high and 3.8 Flash high, each correcting from the image plus the Paddle draft;
  - Opus redo from the image only (on set A, the pilot's reads).

  The prompt is the pilot's read prompt byte for byte: OCR v19.1 plus the counting-rod, count-don't-estimate and
  drawing lines. The correct arms add a draft block. The prompt names no error count, no planted errors and no
  reference text. Opus runs via `claude -p`, Gemini via `agy -p` with the #6523 tool gate.
- **Scores:**
  - CER against the Kanripo leaf: Han only, margins removed, ditto marks read as 丨 for every arm (see the scorer note);
  - over-count: characters written more often than the leaf prints them;
  - column-order jumps: a body line placed more than 2 characters before the previous line in the leaf;
  - over-correction, on set B random;
  - anchoring: 3 planted look-alike substitutions on each of 10 set-B random pages, at characters where Paddle and the
    leaf agree;
  - recitation (described below);
  - did-not-read;
  - seconds and calls per page.

### Results

**Set A: 40 withheld table pages**

| arm | read / requested | did not read | median CER | mean CER | Δ mean CER vs Paddle | better / worse pages (> 0.5 pt) | over-count (pages ≥ 3) | pages with a column-order jump | median s/page |
|---|---|---|---|---|---|---|---|---|---|
| Paddle (served) | 40 / 40 | 0 | 6.4% | 9.8% | — | — | 177 (13) | 7 | — |
| **Opus correct** | 40 / 40 | 0 | **4.0%** | **5.1%** | **−4.7 pt** | **31 / 1** | **51 (7)** | 1 | 28 |
| 3.1 Pro correct | 40 / 40 | 0 | 8.2% | 10.3% | +0.5 pt | 14 / 21 | 164 (20) | 6 | 151 |
| 3.8 Flash high correct | 40 / 40 | 0 | 5.5% | 6.7% | −3.1 pt | 24 / 2 | 100 (10) | 5 | 158 |
| Opus redo (pilot) | 40 / 40 | 0 | 5.8% | 7.5% | −2.3 pt | 22 / 15 | 79 (14) | 0 | 30 |

**Set B random: 30 ordinary pages**

| arm | read / requested | did not read | median CER | mean CER | Δ mean CER vs Paddle | better / worse pages | over-count (pages ≥ 3) | pages with a jump | median s/page |
|---|---|---|---|---|---|---|---|---|---|
| Paddle (served) | 30 / 30 | 0 | 3.1% | 6.7% | — | — | 72 (7) | 1 | — |
| Opus correct | 30 / 30 | 0 | 3.0% | 5.7% | −1.0 pt | 12 / 2 | 65 (7) | 0 | 17 |
| 3.1 Pro correct | 30 / 30 | 0 | 2.4% | 6.4% | −0.4 pt | 13 / 7 | 68 (6) | 0 | 79 |
| 3.8 Flash high correct | 30 / 30 | 0 | 2.8% | 5.8% | −0.9 pt | 10 / 0 | 66 (7) | 1 | 121 |
| Opus redo | 30 / 30 | 0 | 2.8% | 6.2% | −0.5 pt | 12 / 9 | 66 (4) | 0 | 18 |

**Set B disagree: 30 pages where Paddle and the stored second read differ**

| arm | read / requested | did not read | median CER | mean CER | Δ mean CER vs Paddle | better / worse pages | over-count (pages ≥ 3) | pages with a jump | median s/page |
|---|---|---|---|---|---|---|---|---|---|
| Paddle (served) | 30 / 30 | 0 | 2.9% | 4.1% | — | — | 50 (4) | 0 | — |
| Opus correct | 30 / 30 | 0 | 2.7% | 3.8% | −0.4 pt | 7 / 3 | 45 (2) | 0 | 19 |
| 3.1 Pro correct | 30 / 30 | 0 | 3.3% | 5.6% | +1.4 pt | 6 / 11 | 58 (5) | 1 | 90 |
| 3.8 Flash high correct | 29 / 30 | 1 | 2.8% | 4.0% | −0.2 pt | 8 / 6 | 46 (3) | 0 | 118 |
| Opus redo | 30 / 30 | 0 | 4.4% | 6.3% | +2.2 pt | 5 / 19 | 52 (3) | 0 | 18 |

- **Calls per page:** 1.00 for Opus; 1.00–1.02 for Gemini (one nudge retry).
- **The one did-not-read:** 3.8 Flash high called B052, which prints 263 characters, a blank page.
- One B-disagree page has no `own` leaf, so 29 are scored.
- The CER floor on ordinary pages (about 3%) is mostly the leaf's own differences from the print (variant forms,
  taboo substitutions). So small gaps between arms on set B are within that floor.

**Over-correction (set B random)**

| arm | pages made worse (> 0.5 pt) | mean worsening | worst page | pages made better |
|---|---|---|---|---|
| Opus correct | 2 / 30 | 2.4 pt | 3.2 pt | 12 / 30 |
| 3.1 Pro correct | 7 / 30 | 2.9 pt | 6.7 pt | 13 / 30 |
| 3.8 Flash high correct | 0 / 30 | — | — | 10 / 30 |
| Opus redo | 9 / 30 | 1.7 pt | 3.2 pt | 12 / 30 |

Corrections are small. Across set B, the median edit is 0.6% of Paddle's characters for Opus, 0.4% for Flash high
and 1.1% for Pro; Opus redo differs from Paddle by 2.5%.

**Anchoring** (30 planted errors per arm; prompts never mention them)

| arm | fixed | kept the planted error | other |
|---|---|---|---|
| Opus correct | 29 | 1 (3%) | 0 |
| 3.1 Pro correct | 28 | 1 (3%) | 1 |
| 3.8 Flash high correct | 30 | 0 | 0 |

This is low for every arm, in line with Greif (#6547: Opus 0/33, Pro 2/33).

**Recitation read-off.** An arm "moves toward Kanripo" where its text holds the leaf's reading and Paddle's does
not. Each such edit was shown blind to a model of the other family, with the image: the two readings as A and B in
seeded order, the leaf never named. Each page also carried one control item, a spot where everything agrees, offered
against a look-alike character.

| edits by | judged by | answered | image shows Paddle's reading | image shows the leaf's | neither |
|---|---|---|---|---|---|
| Opus correct | 3.8 Flash high | 109 | 30 (28%) | 79 | 0 |
| Opus redo | 3.8 Flash high | 136 | 44 (32%) | 92 | 0 |
| 3.1 Pro correct | Opus | 59 | 21 (36%) | 37 | 1 |
| 3.8 Flash high correct | Opus | 57 | 15 (26%) | 40 | 2 |

- **Controls:** Opus 41 of 41 answered right; 3.8 Flash high 53 of 57 (93%).
- **Judge agreement:** on the 73 edits both families judged, the judges agree on 51 (70%).
- **What the disputed edits are:**
  - real characters (餐/餈, 九/丸, 已/己, 草/革);
  - orthographic variants a judge cannot rank (參/参, 綠/緑, 絕/絶, 顏/顔);
  - ditto and 〇 counts.
- **Reading:** about a third of every arm's toward-leaf edits are disputed by the image read-off, whichever family
  made them. The instrument does not separate the arms, so this is not evidence that Gemini recites more than Opus.
  What it does show is that a move toward Kanripo is not by itself a correction. A by-eye check of the disputed items
  would settle the rate.

**Flag signals** (set B, Opus correct's gain against Paddle)

| signal | flagged | mean gain, flagged | better / worse, flagged | mean gain, not flagged | better / worse, not flagged |
|---|---|---|---|---|---|
| `qa_screen` dice < 0.90 | 15 / 59 | +1.3 pt | 4 / 0 | +0.5 pt | 15 / 5 |
| `qa_screen` dice < 0.95 | 37 / 59 | +1.0 pt | 15 / 1 | +0.2 pt | 4 / 4 |
| 3.8 Flash low disagrees ≥ 5% | 26 / 59 | +1.5 pt | 13 / 1 | +0.1 pt | 6 / 4 |
| 3.8 Flash low disagrees ≥ 10% | 17 / 59 | +1.5 pt | 8 / 0 | +0.4 pt | 11 / 5 |

- **Kanripo screen coverage:** 89% of Paddle pages already carry a trusted `qa_screen` against their own Kanripo leaf
  (sample of 200 lane books, 28,627 pages, `coverage.json`). So that flag costs $0 for most of the lane, even though
  Kanripo text is not served. Its dice tracks Paddle's true CER at Spearman −0.90.
- **A fresh 3.8 Flash low read** (14 s a page) flags as well as dice and reaches pages with no screen.
- **The stored second read is a poor flag:** Spearman 0.22 with Paddle's CER. The old Gemini read disagrees with
  Paddle by ≥ 2% on 81% of census pages.

### Projection

**Inputs** (`meter.json`):
- **Speed:** Opus 17 s a page on ordinary pages, 28 s on tables.
- **Claude quota:** the `team@` account moved 70 → 74% weekly while this job made its first 170 Opus calls, with
  other sessions running. That gives **at least 4,250 Opus pages per account-week**, a lower bound. By 09:15 UTC the
  account stood at 99% weekly, with every job on the box counted.
- **Gemini quota:** the shared account returned 429 on every model twice, with all jobs mixed:
  - at 03:41, after 2,285 calls in 5 h;
  - at 08:43, after 1,036 calls.

  At the low figure that is about 33,600 calls a week for everything on the account.
- **Gemini throughput:** at 2 calls in flight, Pro reads about 14,300 pages a week and 3.8 Flash high about 10,000.

| pages | count | Opus correct, 1 account | Opus correct, 4 accounts | 3.1 Pro correct | 3.8 Flash high correct |
|---|---|---|---|---|---|
| withheld table pages | 4,379 | 1 week | 0.3 | 0.3 | 0.4 |
| dice < 0.80 | 152,000 | 36 weeks | 9 | 11 | 15 |
| dice < 0.90 | 414,000 | 97 weeks | 24 | 29 | 41 |
| dice < 0.95 | 878,000 | 207 weeks | 52 | 61 | 86 |
| no trusted screen | 98,000 | 23 weeks | 6 | 7 | 10 |
| whole lane | 1,568,108 | 369 weeks | 92 | 109 | 154 |

- **Opus redo** costs the same per page as Opus correct, and it loses on quality here.
- **Unscreened pages:** a 3.8 Flash low read of the 98K pages takes about 110 h. At ≥ 5% it would flag about 37% of
  them (11 of 30 on set B random), roughly 36K pages, which is about 8.5 Opus account-weeks.

### Proposed flag rule

1. **Withheld table pages (4,379): Opus correct**, from the image plus the Paddle draft. It beats the NO-GO'd Opus
   re-read on CER (4.0% vs 5.8%), over-count (51 vs 79) and pages made worse (1 vs 15). Before anything is served, it
   still has to pass the pilot's gate: a by-image reviewer finds invented text on ≤ 10% of pages. That review is the
   next step, not part of this one.
2. **Screened ordinary pages: Opus correct where `qa_screen.dice` < 0.90**, about 414K pages. That is about 97
   account-weeks, or about 24 on four accounts. Above 0.95, correction changes little and is as likely to hurt as to
   help.
3. **Unscreened pages (6%, about 98K):** a 3.8 Flash low second read, then Opus correct where it disagrees with Paddle
   by ≥ 5%.
4. **No Pro corrector:** it worsens 21 of 40 table pages and 7 of 30 random ordinary ones. 3.8 Flash high is the safe
   Gemini fallback (0 random pages made worse, −3.1 pt on tables), but it takes 2 min a page and returned one blank
   read.

**Answer to the decision.**
- Correct, don't redo.
- Use Opus.
- Flag by the lane's existing Kanripo dice (< 0.90, about 414K pages), plus the 4,379 table pages, plus a Flash-low
  disagreement pass on the 6% with no screen.
- That fits the Claude quota only as months of account time (about 24–30 weeks on four accounts). The whole 1.57M lane
  does not fit (92+ weeks).

### Scorer note: ditto marks
Opus writes the ditto mark (repeat the headword) as fullwidth ｜ U+FF5C. Paddle and Kanripo write the Han 丨 U+4E28,
and `foldHan` drops the fullwidth form. Scored raw, every Opus ditto mark counted as a deletion: set A's Opus redo read
9.6% median CER instead of 5.8%. Here every arm maps every bar form to 丨. The #6388 pilot's over-count used the raw
form. Its Opus total (91 vs Paddle 218) may be slightly low, but its verdict came from the reviewer, not from this
measure.

### Run notes
- The shared Gemini account hit its quota twice, at 03:41 and 08:43 UTC. Both times the runs resumed after the reset;
  no page was skipped.
- Calls: Opus 213 (170 reads + 43 read-off judgments); `agy` 110 each for Pro and 3.8 Flash high, 60 for 3.8 Flash
  low and 60 for the read-off, plus retries. $0 cash.
- Nothing was written to `pages` or `books`.
