---
stage: ocr
measure: [accuracy, judged]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 100
n_pages: 100
verdict: "On Paddle's Chinese pages, Opus correcting Paddle's draft beats both Paddle and an Opus re-read: on the 40 withheld table pages, median CER 4.0% against Paddle 6.4% and Opus redo 5.8%, better on 31 pages and worse on 1. On ordinary pages the gain is small (−1.0 pt mean on 30 random pages) and lies where the lane's own Kanripo screen is weak (dice < 0.95: 15 pages better, 1 worse). Opus left 1 of 30 planted errors. Gemini correctors move text toward Kanripo where the image does not support it (Pro 36%, 3.8 Flash high 26% of such edits, judged by Opus by image), and Pro makes 21 of 40 table pages worse. Opus quota, not speed, bounds the lane."
status: undecided
decision: null
superseded_by: null
issue: [6561, 6388, 6553]
---
## 2026-10-12 · Paddle Chinese: correct flagged pages or re-read them, with which model, and does it fit the quotas? (#6561)

PRIOR ART: `2026-10-12-paddle-zh-table-opus-reread-pilot-6388.md` (PR #6574: the 100-page Opus re-read of the
withheld table pages, NO-GO at 23% invented). Its Opus reads are this entry's redo arm on set A, unchanged.
`2026-10-11-paddle-zh-table-detector-6388.md` (the over-count measure) and the #6547 Greif replication (correction
helps a weak reader; Opus anchoring 0/33). Code, draw and outputs: `scripts/eval/paddle-correct-6561/`.

**Design (#6561, one pass, no production writes, $0 on the subscription CLIs, 2 calls in flight).**
- **Set A:** 40 of the pilot's 100 withheld table pages, drawn (seed 6561) from the 48 whose own Kanripo leaf aligns.
- **Set B:** 60 ordinary Paddle pages (not table-flagged, interior, ≥ 40 Han characters) with a trusted own leaf
  (`ocr.qa_screen` screened, dice ≥ 0.6). 30 random, one per book from the lane's books, and 30 where Paddle and the
  stored second read disagree (the lane's superseded Gemini 3 Flash preview reading, old-vs-new CER ≥ 0.10). 59 of 60
  align `own`.
- **Arms:** Paddle as served; Opus, 3.1 Pro high and 3.8 Flash high each correcting (image + Paddle draft); Opus redo
  (image only; set A = the pilot's reads). The prompt is the pilot's read prompt byte for byte (OCR v19.1 + the
  counting-rod, count-don't-estimate and drawing lines); the correct arms add a draft block. It names no error count, no
  planted errors and no reference text. Opus via `claude -p`, Gemini via `agy -p` with the #6523 tool gate.
- **Scores:** CER against the Kanripo leaf (Han only, margins removed; ditto marks read as 丨 for every arm, see
  below); over-count (characters written more often than the leaf prints them); column-order jumps (a body line placed
  more than 2 characters before the previous line in the leaf); over-correction on set B random; anchoring (3 planted
  look-alike substitutions on 10 set-B random pages, at characters where Paddle and the leaf agree); recitation (below);
  did-not-read; seconds and calls per page.

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

**Set B disagree: 30 pages where Paddle and the stored second read differ** (Gemini arms: the pages read before the
quota stop, see "Not finished")

| arm | read / requested | did not read | median CER | mean CER | Δ mean CER vs Paddle | better / worse pages | over-count (pages ≥ 3) | pages with a jump | median s/page |
|---|---|---|---|---|---|---|---|---|---|
| Paddle (served) | 30 / 30 | 0 | 2.9% | 4.1% | — | — | 50 (4) | 0 | — |
| Opus correct | 30 / 30 | 0 | 2.7% | 3.8% | −0.4 pt | 7 / 3 | 45 (2) | 0 | 19 |
| 3.1 Pro correct | 26 / 26 | 0 | 3.2% | 5.3% | +1.3 pt | 6 / 8 | 45 (4) | 0 | 90 |
| 3.8 Flash high correct | 22 / 23 | 1 | 2.4% | 3.6% | −0.1 pt | 6 / 5 | 41 (3) | 0 | 115 |
| Opus redo | 30 / 30 | 0 | 4.4% | 6.3% | +2.2 pt | 5 / 19 | 52 (3) | 0 | 18 |

Calls per page: 1.00 for Opus, 1.00–1.02 for Gemini (one nudge retry). The one did-not-read: 3.8 Flash high called
B052 (263 printed characters) a blank page. One B-disagree page has no `own` leaf, so 29 are scored.

**Over-correction (set B random).** Opus correct made 2 of 30 pages worse (mean 2.4 pt, worst 3.2 pt) and 12 better.
3.8 Flash high: 0 worse, 10 better. Pro: 7 worse (mean 2.9 pt, worst 6.7 pt). Opus redo: 9 worse. The corrections are
small: across set B the median edit is 0.6% of Paddle's characters for Opus, 0.4% for Flash high, 1.1% for Pro.

**Anchoring.** Opus correct fixed 29 of 30 planted errors and kept 1 (3%), the same as Greif (#6547: 0/33).
Gemini arms: pending (their planted-draft calls queue after the quota reset).

**Recitation.** An arm "moves toward Kanripo" where its text holds the leaf's reading and Paddle's does not. Each such
edit was shown, blind (A/B in seeded order, the leaf never named), to a model of the other family with the image. Each
page also carried one control item: a spot where everything agrees, against a look-alike character.

| edits by | judged by | answered | image shows Paddle's reading (unsupported) | image shows the leaf's | neither |
|---|---|---|---|---|---|
| 3.1 Pro correct | Opus | 55 | **20 (36%)** | 34 | 1 |
| 3.8 Flash high correct | Opus | 54 | **14 (26%)** | 38 | 2 |
| Opus correct / Opus redo | 3.8 Flash high | pending (quota) | | | |

Opus as judge got 38 of 38 answered controls right (1 not found, 2 unanswered).

**The flag signal.** 89% of Paddle pages already carry a trusted `qa_screen` against their own Kanripo leaf (sample of
200 lane books, 28,627 pages; `coverage.json`), so a Kanripo-based flag costs $0 for most of the lane even though
Kanripo text is not served. On set B its dice tracks Paddle's true CER at Spearman −0.90. Opus correct by dice:

| set B pages | n | mean gain | better | worse |
|---|---|---|---|---|
| dice < 0.90 | 15 | +1.3 pt | 4 | 0 |
| dice < 0.95 | 37 | +1.0 pt | 15 | 1 |
| dice ≥ 0.95 | 22 | +0.2 pt | 4 | 4 |

The stored second read is a weak flag: Spearman 0.22 with Paddle's CER (n = 29). The old Gemini 3 Flash preview read
disagrees with Paddle by ≥ 2% on 81% of the census pages. The fresh 3.8 Flash low second read is pending (quota).

### Projection

Inputs (`meter.json`): Opus 17 s a page on ordinary pages, 28 s on tables. The `team@` Claude account moved 70 → 74%
weekly while this job made its first 170 Opus calls with other sessions running. That gives **at least 4,250 Opus
pages per account-week** (a lower bound). The shared Gemini account returned 429 on every model twice: at 03:41 after
2,285 calls in 5 h, and at 08:43 after 1,036, with all jobs mixed. At the low figure that is about 33,600 calls a week
for everything on the account. At 2 calls in flight, Pro manages 14,300 pages a week and 3.8 Flash high 10,300.

| pages | count | Opus correct, 1 account | Opus correct, 4 accounts | 3.1 Pro correct | 3.8 Flash high correct |
|---|---|---|---|---|---|
| withheld table pages | 4,379 | 1 week | 0.3 | 0.3 | 0.4 |
| dice < 0.80 | 152,000 | 36 weeks | 9 | 11 | 15 |
| dice < 0.90 | 414,000 | 97 weeks | 24 | 29 | 40 |
| dice < 0.95 | 878,000 | 207 weeks | 52 | 61 | 85 |
| no trusted screen | 98,000 | 23 weeks | 6 | 7 | 10 |
| whole lane | 1,568,108 | 369 weeks | 92 | 109 | 152 |

Opus redo costs the same as Opus correct per page. Its saving would come downstream, and it loses on quality here. A
3.8 Flash low second read of the whole lane, as a flag, takes about 16 weeks of the Gemini account by itself.

### Proposed flag rule

1. **Withheld table pages (4,379): Opus correct**, image + Paddle draft. It beats the NO-GO'd Opus re-read on CER
   (4.0% vs 5.8%), over-count (51 vs 79) and pages made worse (1 vs 15). It still needs the pilot's gate, a by-image
   reviewer finding invented text on ≤ 10%, before anything is served. That review is the next step, not part of this one.
2. **Ordinary pages: correct only where `qa_screen.dice` < 0.90** (about 414K pages), with Opus. That is 97
   account-weeks, or about 24 weeks on four accounts. Above 0.95, correction changes little and is as likely to hurt as
   to help.
3. **No Gemini corrector for this lane.** Pro makes table pages worse and over-corrects ordinary ones. Both Gemini
   arms recite Kanripo against the image on a quarter to a third of their toward-leaf edits. 3.8 Flash high is safe on
   clean pages (0 worse) but slow (2 min a page) and one read came back "blank".
4. Pages with no trusted screen (6%, about 98K) need another signal. The stored second read is too noisy, and the 3.8
   Flash low read is not measured yet.

**Answer to the decision.** Correct, don't redo. Use Opus. Flag by the lane's existing Kanripo dice (< 0.90, about
414K pages) plus the 4,379 table pages. That fits the Claude quota only at months of account time (about 24 weeks on
four accounts), and the whole 1.57M lane does not fit (92+ weeks).

### Scorer note: ditto marks
Opus writes the ditto mark (repeat the headword) as fullwidth ｜ U+FF5C. Paddle and Kanripo write the Han 丨 U+4E28,
and `foldHan` drops the fullwidth form. Scored raw, every Opus ditto mark counted as a deletion: set A Opus redo read
9.6% median CER instead of 5.8%. All arms here map every bar form to 丨. The #6388 pilot's over-count used the raw
form. Its Opus total (91 vs Paddle 218) may be slightly low, but its verdict came from the reviewer, not from this
measure.

### Not finished (the Gemini quota stopped the run at 08:43 UTC; it resumes after the reset)
- 3.1 Pro and 3.8 Flash high on the last set-B-disagree pages (Pro 96, Flash high 93 of 110 requests), and on the 10
  planted-error drafts (their anchoring);
- the 3.8 Flash high read-off of Opus's toward-Kanripo edits (recitation for the Opus arms);
- the 3.8 Flash low second read of set B (55 of 60), the candidate flag for unscreened pages.
