---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 450
n_pages: 450
verdict: "4.9% [3.3, 7.3] of 450 live pages carry an untagged addition the detector sees, almost all in pre-v10 translations (v13: 0/124); OCR also invents text on 4/86 typed-text pages."
status: informational
decision: null
superseded_by: null
issue: [5982, 5942]
---
## 2026-10-06 · How often does a translation carry untagged words of ours, and at which stage do they come in? (source-grounded additions detector, #5982)
<!-- PRIOR ART: 2026-10-02-what-the-judge-calls-invention-5274.md typed the audit judge's "invention" flags by hand on 45 pages; 2026-10-06-translation-notes-free-5919.md and the #5942 phase-1 entry (PR #5958) hold the judge verdicts re-read in Q1; scripts/audit/translation-bridging.mjs (#5305) is the mechanical work list. None lists the untagged sentences of a page that render nothing in the source, and none compares against a typed text. -->

**Question.** A reader takes the English as the author's words. How often does the running text of a translation (everything outside `<note>`, `<gloss>`, `<summary>`, `<meta>` and the like) carry a sentence or clause of ours? Does the note-free prompt (#5919, #5942) raise it? Do such words come in at translation, or does the OCR invent them and the translation render them faithfully?

**Measures.** Stated per number below: *read from the image*, *read from the source text*, or *engine judgement*. `measure` for every rate: a detector's flags with a by-eye reading applied; not accuracy against a gold set.

### 1. By stage, on pages that have a human-typed text (the strongest number here)

86 live translated pages, not Tibetan, that also have a committed typed text of the page: 26 Latin (CAMENA, la.wikisource, EEBO-TCP, same edition), 46 Chinese and Greek e-text windows (Kanripo, CBETA, Perseus, First1KGreek), 14 pinned passages (Greek, Armenian, German, Hebrew). The detector ran on each page twice: against the typed text and against our OCR. All 86 flagged sentences (42 pages) were then read with the page image open; 83 of 86 verdicts were confirmed on the image.

| read from the image, 86 pages | pages | rate [95% CI] | sentences |
|---|---:|---:|---:|
| **added at translation** (our own definition, explanation or gloss; in neither text, not on the page) | 6 | 7.0% [3.2, 14.4] | 7 |
| **came in through the OCR**: text the OCR invented, which the translation rendered faithfully | 4 | 4.7% [1.8, 11.4] | 4 |
| OCR read the edge of the facing page; the translation completed the fragments into sentences | 1 | 1.2% [0.2, 6.3] | 10 |
| the OCR's own description (`<image-desc>`, `<meta>`) rendered as text | 0 | 0% [0, 4.3] | 0 |
| OCR stage, any of the three | 5 | 5.8% [2.5, 12.9] | 14 |

1. **All 7 translation-stage additions were flagged against both texts.** The typed text found no addition of ours that the OCR-based check missed. They are a glossary definition run into the sentence ("Clementines: a collection of decrees in Canon Law…"), a dash definition of *reductio ad absurdum*, two definitions of Chinese carpentry terms, and two short parentheses ("(sneezing powders)", "(the science of elements)"). Four of the six pages are Flash translations under the early prompts (stored as `v2` and `v5.2026-02`); two are Lite (v11, v13).
2. **What came in through the OCR is misreading, not commentary.** Two Siku pages where the OCR wrote a book title that is not in the margin (金石目錄 on a 繪事備考 page); one Greek manuscript line ("Of Isagoras, greatly honoured"); one printed Greek clause where the OCR inserted οὐ and the translation says the opposite of the page. A check against our OCR cannot see any of these. The reading of the two Greek pages is small print at confidence 0.7.
3. **A typed text cannot be used alone as the source of truth.** 50 of 70 flags raised only against the typed text (25 pages, 29% [21, 39]) are text that is printed on the page and that the typed text leaves out: running heads, marginal notes, footnotes, a commentary, a different recension. The page image decides.
4. **Flags raised only against the OCR were all wrong** (8 sentences, 6 pages = 7.0% [3.2, 14.4]): loose renderings and spelled-out titles, not OCR noise. That is the detector's false-flag floor again (section 3).
5. **Tibetan, engine judgement only.** 60 Derge Tengyur folios, measured read-only; nothing was translated. The Esukhia e-text is the stored page text, so there is no OCR stage to set against it. The detector flagged 3 of 60 pages (5% [1.7, 13.7]): a block that runs past the folio, a supplied chapter heading, a logical expansion. No Tibetan reader checked them.

**Limit.** These 86 pages are benchmark pages (Chinese Siku manuscripts, Neo-Latin with a CAMENA text, Greek classics), not a random draw, and 5 or 6 pages per row is a small count. The stage split is evidence that both stages add; it is not a corpus rate.

### 2. Q1 ($0): what the stored judges named, per arm

The #5695 judge prompt asks for an `invention` list per candidate: a kind (`boundary`, `unreadable_fill`, `added_fact`, `gloss`) and a quote of at most 15 words. It does not ask whether the words are tagged, and it does not ask for every added sentence. Each quote was located in the arm's text by exact string match (`q1-stored-verdicts.mjs`). Two blind Opus judges; entries / pages named by either judge.

| | v13-a | v13-b | v13-plain |
|---|---:|---:|---:|
| **#5919, 40 pages**: all inventions named | 206 / 39 | 212 / 40 | 74 / 23 |
| untagged `gloss` + `added_fact`, in brackets | 2 / 2 | 6 / 2 | 24 / 11 |
| untagged `gloss` + `added_fact`, bare | 13 / 8 | 9 / 7 | 4 / 3 |
| **#5942 phase 1, 40 Lite pages (PR #5958)**: all inventions named | 142 / 36 | 122 / 33 | 37 / 19 |
| untagged `gloss` + `added_fact`, in brackets | 2 / 1 | 6 / 2 | 16 / 7 |
| untagged `gloss` + `added_fact`, bare | 3 / 2 | 0 / 0 | 1 / 1 |

Per page, plain − v13-a against the floor (v13-b − v13-a), paired bootstrap: bracketed +0.31 [+0.13, +0.53] against +0.05 [−0.04, +0.17] (#5919) and +0.17 [+0.04, +0.35] against +0.05 [−0.05, +0.17] (#5942). Bare: −0.29 [−0.50, −0.07] against −0.24, and −0.09 [−0.26, +0.06] against −0.11.

- **Bare untagged commentary does not rise under the note-free prompt.** Bracketed words do, in both sets, beyond the floor. Most are a supplied word ("I shaved [my head]"); a minority are definitions ("`Krimp-schelvis` [shivering haddock]").
- Counts of judge examples on 80 pages, not of sentences.

### 3. The detector and its controls

`scripts/eval/untagged-additions/detector.mjs`. Input: the page's source text and its translation. The translation's running text is cut into numbered sentences; Gemini (thinking off, temperature 0) names each sentence in which a whole sentence, or a clause, bracket or parenthesis of five words or more, renders nothing in the source, with a kind, the added words, the nearest source words and a reason. The OCR's own descriptive blocks are shown apart, so a sentence that renders them is typed `transcriber_block`. A mechanical filter (`keepFlag`) then drops a flag whose "added words" stand in the source as they are, and a flag under five words that is neither in brackets nor a whole sentence.

Controls: pages of #5919 and #5942 on which neither blind judge named an invention outside a tag (clean, against the human reference), and the same pages with one commentary sentence planted (10 templates each: explanation, image description, definition, bridging summary; 5 or 6 in brackets).

| | recall on planted sentences | clean pages with a flag |
|---|---:|---:|
| round 1, prompt v1, no filter, v13-a texts: Lite | 38 / 38 | 39 / 50 = 78% |
| round 1: Flash | 38 / 38 | 29 / 50 = 58% |
| **round 2, prompt v2 + filter, fresh v13-b texts and fresh plants: Flash** | **37 / 37 = 100% [91, 100]** | **3 / 57 = 5% [2, 14]** |
| round 2: Lite | 37 / 37 = 100% [91, 100] | 4 / 57 = 7% [3, 17] |

- Round 1 failed on false flags: the model called a supplied subject, a connective or a term kept beside its translation an addition. One iteration, as the brief allowed; round 2 passes both bars (recall ≥ 80%, false flags ≤ 10%). The round-2 pages are the same 80 pages; the texts (another run of v13) and the plants are new.
- All 7 flags on clean pages in round 2 (Flash) are wrong, read from the source text: footnotes the translation moved inline, a running head, a transliteration.
- **What it does not find.** A planted sentence is its own paragraph; real additions are often shorter. On the 23 pages where a judge did name an untagged invention, the round-2 detector flagged almost none of the located quotes (Flash 0 of 15 that are not `unreadable_fill`). They are one-word bracket identifications ("these [Catholics]"), inserted headings of two to four words ("### Proposition 8") and loose renderings. The detector is an instrument for commentary of clause length or more, and for bracketed glosses of two words or more.
- Flash is the primary reader (fewer false flags, kinds named right 30 of 37 against 23). Lite is reported as a second read.

### 4. The rate on live pages

Seeded draw (seed 5982), one page per book, 450 live translated pages with OCR; 1,329 Tibetan books excluded from a pool of 22,928 (21,599 left). Latin 191, English 58, Chinese 43, German 39, Greek 22, French 20, 26 other language labels. 9,117 sentences.

- **Engine judgement:** Flash flagged 40 of 450 pages (8.9% [6.6, 11.9]), 92 sentences. Lite flagged 79 (17.6%).
- **Read from the source text:** every flagged page was read (40 flags on 25 pages by two readers; the other 15 pages in the job session). **22 of 40 pages carry an addition; 16 are false flags; 2 are text of the neighbouring page.** Of the 40 sampled flags, 22 are additions (55% [40, 69]): 20 commentary, 2 invented text.
- **Rate: 22 of 450 pages = 4.9% [3.3, 7.3] carry an untagged addition that this detector can see.** One of the 22 renders the OCR's `<image-desc>` in bare brackets (OCR stage); one is the pipeline's "[Blank page — no translatable content]" on a page with a shelfmark. Four unconfirmed pages have flags nobody read, so 22 is a floor for flagged pages.
- **Unflagged pages, read from the source text:** 0 of 20 had an addition of five words or more (95% upper bound 16%); 1 had next-page text; 5 had additions under five words (a parenthetical gloss, a supplied name, a bracketed word), which the detector does not count. The rate is a lower bound.
- False flags are 16 of 450 pages (3.6% [2.2, 5.7]), the same floor as the controls (5%).

| translations written under | pages | flagged (engine) | with an addition (read) | rate [95% CI] |
|---|---:|---:|---:|---:|
| `Standard Translation` v13 (Sept–Oct 2026) | 124 | 6 | 0 | 0% [0, 3.0] |
| v10, v11, v12 (March–Sept 2026) | 217 | 8 | 3 | 1.4% [0.5, 4.0] |
| stored as `v1`, `v2`, `v5…`, `v6` or none (Feb–April 2026) | 98 | 22 | 16 | 16.3% [10.3, 24.9] |
| `English Modernization` | 10 | 3 | 3 | 30% [11, 60] |

One more page (`Latin Translation (Neo-Latin)` v2) was flagged and is a false flag.

| by translating model | pages | with an addition | rate [95% CI] |
|---|---:|---:|---:|
| `gemini-3-flash-preview` | 147 | 13 | 8.8% [5.2, 14.5] |
| `gemini-3.1-flash-lite-preview` | 153 | 6 | 3.9% [1.8, 8.3] |
| `gemini-3.1-flash-lite` | 144 | 2 | 1.4% [0.4, 4.9] |

- **The additions sit in the old translations.** 11 of the 22 pages are Flash pages stored as `v2`, written in February and March 2026 (11 of 53 = 21% [12, 34]): glossary definitions run into the sentence, "Left Column (Greek)", a keyword list after the last line, an illustration described in brackets. Model and prompt version are confounded: Flash wrote most of the early pages.
- **v13 on 124 pages: none confirmed.** Of the 6 flagged pages, 5 are false flags (4 are Chinese dictionary pages where a ditto mark stands for the headword) and 1 is next-page text. The typed-text set has one v13 Lite page with a two-word parenthesis, so v13 is not at zero.

### 5. Consequences

1. **Q1.** The note-free prompt does not raise bare untagged commentary in the stored verdicts; it raises bracketed words. The #5902 guard stays in front of it.
2. **The detector passes its controls and is usable as a gate, with its flags read by eye.** Raw flags run at the false-flag floor (4 to 5% of pages), so a raw rate below about 10% says nothing by itself.
3. **Proposed gate for #5942 step 5:** untagged additions under the note-free prompt ≤ v13 + noise floor, measured by this detector on 300 pages translated three times (v13 twice, note-free once), every flag read from the source text; pass when the paired difference in pages with a confirmed addition, note-free − v13, has a 95% upper bound under +3 points and is no larger than the v13 − v13 difference plus 1 page in 100. Bracketed glosses are counted apart.
4. **The standing rate is carried by translations from before v10.** Re-translating them under the current prompt would remove most of what this detector sees; that is a spend decision, not taken here.
5. **Not a reader label yet.** At 55% precision per flag, a label on flagged sentences would mark the author's words as ours on almost half of them.
6. **OCR-stage inventions are real and invisible to any text-to-text check** (4 of 86 pages). They belong to #3591 and the OCR quality lane, not to the notes redesign.

**Spend: $1.86** of a $5 cap (envelope `additions-5982`, removed). 1,820 detector calls: controls $0.50, draw $0.77 (Lite on the Batch API; the Flash batch was cancelled by the API unbilled and re-run realtime), typed-text pages $0.59. Readers: seven subagent runs on subscription (one inventory, six by-eye), $0.

**Replicated?** No. One draw, one detector prompt, one reading per flag. Lite agrees with Flash on 31 of the 40 flagged pages; where both flag, 20 of 31 pages are confirmed, where Flash flags alone, 2 of 9.

**Artifacts.** `scripts/eval/untagged-additions/` (detector, runner, controls, draw, typed join, analysis); `scripts/eval/results/untagged-additions-2026-10/` (`results.json`, `q1.json`, control keys and scores, `draw.jsonl`, `typed.jsonl`, detector rows per model, `by-eye/`). Nothing was written to `pages`; no prompt row was changed.
