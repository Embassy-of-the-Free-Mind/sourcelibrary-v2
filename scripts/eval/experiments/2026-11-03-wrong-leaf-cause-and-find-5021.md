---
stage: translation
measure: [judged, agreement]
languages: [la, de, fr, en, it, nl, ko, zh, bo]
scripts: [Latn, Hani, Tibt]
canons: []
n_books: 24859
n_pages: 5743761
verdict: "English slides onto the wrong leaf inside multi-page calls because the model folds the next leaf into one page's section and then fills every later tag one leaf ahead; the tags stay numbered and in order, so the parser, which trusts them, writes the slide. Replaying 30 slid calls on the same input and model reproduces it in 17 of 62 calls (12 of 31 blocks), 17 of 23 at the same page as the stored slide, against 1 of 30 clean calls; removing in-page '---' rules changes nothing (6/20 vs 6/20). Single-page-written pages carry none (0 of 499, Opus with scans). Sonnet and agy Flash-low both pass the held-out gate overall (recall 0.973 and 0.947, 0 false flags in 75); neither is proven on Han (7 of 8 natural Han shifts, Wilson 0.53-0.98)."
status: adopted
decision: "No production write (eval only, read-only on Mongo). Opus-confirmed Han and Tibetan wrong-leaf pages and the scale screen's flags are listed for wrong-leaf-fix-5021 on #5021. The screen ran on subscription headroom (Sonnet to 90% of the milolomas week, agy on the milo pool); no cron was installed."
superseded_by: null
issue: [5021]
router_evidence: "none — a cause analysis and a detector's gate, not a comparison of translation routes"
defect_rates: "none — the unit is a page whose English renders another leaf"
---
## 2026-11-03 · Why block translations slide one leaf, and finding the slides in every script (#5021)

PRIOR ART: `scripts/audit/leaf-shift-screen-5021.mjs` (the text-only screen, reused; one fix: its weekly meter now reads
the login `claude -p` really runs under, `CLAUDE_CONFIG_DIR`, not `~/.claude.json`, which on gex45 is another account),
`scripts/audit/leaf-shift-confirm-5021.mjs` (the Opus confirmer with scans, reused unchanged),
`scripts/lib/block-page-guard.mjs` and `scripts/lib/block-drift.mjs` (the guards, run unchanged on the natural Han case),
`scripts/eval/caseless-shift-5021/labse_sims.py` (LaBSE windows, run unchanged), the 2026-11-03 Opus labels of
`2026-11-03-leaf-shift-library-5021.md` and `2026-11-03-shift-screen-5021.md`. New: `scripts/eval/wrong-leaf-find-5021/`
(a library walk of write times, the onset analysis, a replay harness with one-page references, the queue and runner).

**Who it is for.** A reader on page n who is given fluent English for page n+1, in any script. Derek, 2026-11-03:
"figure out how to find them ... and figure out why it happened."

### A. Why it happened

**What the lanes did** (from `git log -S`; file:line evidence in the PR). The realtime `translate-worker` sent 3, then 5
(2026-03-28), then 8 pages (04-11) a call: `--- Page N ---` followed by the raw transcription, and asked for
`<translation page="N">` sections, listing every tag. It parsed by tag number, with a position fallback only when the
count matched, and wrote what it parsed; a section under 15% of its source was skipped and that page read again alone.
Nothing compared a section with its page until #5031 (09-24, a clause test for cased scripts), #5176 (09-26: discard a
short block), #6764 (10-15: two pages voting the neighbour's numbers) and #8009 (11-03: anchors, absorption, a per-page
vote). The 農政全書 pages (gemini-3.1-flash-lite-preview, v10, 2026-04-04) fit one worker call: lite-preview went to
non-BPH books from 03-27 to 05-12, and only the worker wrote it on Chinese books. `prompt_version` v10 is a worker
constant stamped on single-page and block output alike, so it does not tell a block from a page.

**What a shared write time means.** Before 04-08 the worker stamped each page with its own `new Date()` as it wrote
the parsed sections in a loop (milliseconds apart: 農政全書 488-492 are 19:32:46.283-.331); from 04-08 one `now` per
block. A page read again alone is written seconds later. So a chain of pages written within 2 s is one call in the
worker's era, but not in general: the Batch collector stamps a whole job of single-page requests with one `now` (80,559
pages in identical-stamp groups over 10 pages, left out below), and apply scripts write single-page results back to
back. The Mongo `gemini_usage` rows that named a call's pages survive only for single-page worker calls (17,355, 04-05
to 04-10); no block call's page list is stored, and no raw block reply was kept before 11-03.

**The shape, from the 2,104 Opus-labelled pages of the two 11-03 runs** (write groups rebuilt with the withheld pages'
write times from their `page_revisions` snapshots; `onset-shape.json`). Of 454 slides that begin inside a write group:

- **The onset page holds two leaves.** Its English is long for its source: median log residual +0.59 against the book's
  ratio (about 1.8 times), 71% above +0.4, against 14.5% of the earlier pages of the same calls; Opus calls it `mixed`
  in 75 of 87 judged.
- **Every later section carries the next leaf, to the end of the call:** 428 of 454 (94%) run to the group's end.
- **The call's last page is read again alone.** The page after a slid group was written alone 0-60 s later in 49 of 145
  slid groups (34%) against 3.5% after clean groups: the model had no leaf left for the last tag, the section came back
  empty or short, and the worker's fallback read it alone, so the end of the call looks right.
- **Position:** the first carried page is at positions 1-6 (median 2); nothing at position 0 by construction.

**Triggers tested** (onset page against the other pages of the same calls, so book, lane, model and date are fixed):

| on the onset page | onset | same calls | reading |
|---|---|---|---|
| source has an in-page rule (`---`) | 13.2% (10.4-16.6) | 10.0% (8.5-11.7) | no clear effect |
| source under 600 characters | 0.9% | 0.7% | none |
| plate, index or other non-text page type | 1.5% | 1.8% | none |
| source ends on a hyphenated word | **26.7% (22.8-31.0)** | 14.8% (13.0-16.9) | 1.8 times |
| source ends mid-sentence | 60.7% | 63.1% | none |

**Replay** (`replay.mjs`, `score-replay.mjs`, `replay-score.json`, raw replies in `replay-calls.jsonl.gz`). 30 natural
slid calls (seeded from the labels; Latin 15, German 5, French 3, English 3, others) plus 農政全書 488-492, and 30
clean calls from the same books and models, each with the April input: the block prompt
(`buildBlockTranslationPrompt`, whose block text is the worker's April text), gemini-3.1-flash-lite-preview at the
default temperature and thinking. Each section was attributed by its English against one-page reference translations
of n-1, n and n+1 (GA Flash-Lite). Instrument check first: on the stored English Opus called `next`, the attribution
says next 63, own 6, too short 6.

| arm | slid calls | blocks that slid at least once |
|---|---|---|
| slid inputs, block prompt (2 reps) | **17 of 62 (27%)** | 12 of 31 |
| slid inputs with in-page rules, block prompt / rules removed | 6 of 20 / **6 of 20** | |
| clean inputs, block prompt | 1 of 30 (3%) | |
| slid inputs, today's anchored prompt (GA Flash-Lite) | 8 of 31; the guard refused 6 of the 8 | |
| clean inputs, anchored prompt | 2 of 30; the guard refused 3 clean calls | |

17 of the 23 slid replays begin at the same page as the stored slide. By original model: inputs first written by
lite-preview re-slide in 14 of 36 calls, inputs first written by 3-flash-preview or 3.1-flash-lite in 3 of 26 (confounded
with book and language). 農政全書 488-492 did not re-slide in 5 calls (its stored English slid backward at an in-page
rule; today every section renders its own leaf).

**Who wrote what.** In the replay replies, the slide is in the model's output: in 10 of 17 slid block calls the tags are
all there and in order (e.g. 69bda154 p.203-210: section 205 is 2,215 characters, its own leaf and the next; sections
206-209 each carry the next leaf; 210 renders 210 again), and in 7 the model returns one tag short. Today's parser
discards the short ones (#5176); the April parser wrote the tagged sections and read the missing page alone, which is
the 34% signature above. A parser cannot produce this from correct sections: the position fallback only runs when the
count matches. For the stored April writes the raw replies are gone, so the model-side origin there is inferred from the
shape and the replay, not shown.

**The cause, by its evidence:** a multi-page call asks the model to keep N sections aligned with N leaves using nothing
but its attention; at a page break where the text runs on (a broken word is 1.8 times more common there), it folds the
next leaf into the current section, then fills the remaining tags in order, one leaf ahead, and the parser trusts the
tags. Content-triggered (same onset on replay, 27% vs 3%) and stochastic (most replays of a slid input do not slide).

**Not proven:** what in the remaining 73% of onsets triggers it; the April prompt header (the replay used today's DB
prompt with the April block text); whether the preview model behind the name changed since April; per-model and
per-lane rates (model, lane, date and language move together: lite-preview = worker = April-May; every rate by lane in
the earlier runs is confounded this way).

**Why nobody caught it.** The seam repair (#4681) rewrites only each block's first page and checks health, echo and a
length ratio, never which leaf a draft renders. The page health gate tests leaks, length collapse, recitation and stray
script, and a fluent translation of the neighbouring leaf passes all of them. The stored-text detectors before 10-13
looked at cased clause boundaries (`translation-page-boundaries.mjs`) or at the image/OCR layer; the number-vote detector
dates from 10-13. And the end of a slid call is repaired by the fallback, so a reader paging forward sees the run end
cleanly.

### B. Finding them

**1. 農政全書 p.489-492** (`nzqs-guard.txt`; the English rebuilt from the 11-03 withhold snapshots).

| check | 490-492 caught? |
|---|---|
| `dropDriftedPages` (caseless clause drift, absorption, number vote; no anchor on stored text) | no: it refuses 488/489 (a clause flag at the volume heading), and would write 490-492 |
| per-call absorption / number vote | no / no |
| book-level classifier (gappy, names, absorption) | no run |
| LaBSE whole page and windows (Han threshold -0.249) | no: margins -0.03 to -0.07 |
| anchors | not testable on stored English; on replay the model did not slide |
| Sonnet and agy screens (one window a page) | yes, all three |

**2. Frame** (`walk.mjs`, `frame.py`, `frame-by-language.json`). 5,743,761 translated pages in 24,859 live books.
Written with a neighbour within 2 s: 4,165,488 (72.5%); written alone: 1,497,714 (26.1%); Batch-collector stamps:
80,559. Control: Sonnet on 499 random alone-written pages flagged 3, Opus with the scans called all 3 own: **0 of 499
(95% upper 0.8%)**. The alone-written pages are dropped from the frame. Multi-page share by language: Latin 74%, English
65%, German 68%, Greek 70%, Chinese 75%, Tibetan 81%, Russian 94%, Korean 98%.

**3. Han and Tibetan natural positives** (Opus with the scans, blind to direction).
- 300 random Chinese multi-page pages (200 from lite-preview groups of 6-20): Sonnet flagged 10; Opus: 1 next, 2 mixed,
  7 own (woodcuts and star maps, whose English describes the picture). 40 unflagged: 39 own, 1 next.
- 462 pages after an over-long page in the same call (400 Han, 65 Tibetan; an enrichment, not a rate): Sonnet flagged
  17; Opus: Han 3 next, 7 own; Tibetan 1 next, 3 mixed, 3 own. 40 unflagged: 40 own.
- Natural Han wrong-leaf pages: 8 (69e7268c p.15, 69e8b264 p.20, 69f33c10 pp.885-886, 69c66149 p.116, 農政全書
  490-492); Tibetan 1 (69e7abf7 p.371); two-leaf pages: Han 2, Tibetan 3.
- Rough Chinese rate (random 300, lite-preview groups): about 1-3% of multi-page pages; the interval is wide.

**4. Signals, on the natural Han set (8 positives, 79 negatives), nothing fitted** (`signals-natural-han-tibetan.json`):
leading "..." 2/8 (6 false), trailing "..." 2/8 (4), English long for its source 0/8, short 2/8 (14), an over-long page
earlier in the call 3/8 (35; biased by the draw). None is usable for Han. On the labelled (mostly Latin) slides the
call-level length signal L (a page before the call's last with English over e^0.4 of its expected length) has recall
0.91 (414/454, slides starting inside a call; labels partly found by absorption, so inflated) at 8.2% of clean calls;
used below only to order the readers' queue. The text-only model check of the last English sentence against the next
leaf was folded into the screens (they see the English's end), not run separately.

**5. Gate** (`gate.py`, `gate.json`; flag = next/prev/none, pre-registered 11-03 13:05Z; Wilson 95%).

| screen | set | recall | false flags |
|---|---|---|---|
| Sonnet (`claude -p`) | held-out gate 2, 150 pages, all scripts | 73/75 (0.908-0.993) | 0/75 (0-0.049) |
| agy gemini-3.8-flash-low | same 150 | 71/75 (0.871-0.979) | 0/75 (0-0.049) |
| both, Han pages of gate 2 | 7 pos / 13 neg | 5/7 (0.36-0.92) | 0/13 |
| Sonnet | natural Han | 7/8 (0.53-0.98) | 0/79 random own pages |
| agy Flash-low | natural Han | 7/8 (0.53-0.98) | 0/79 |
| both | natural Tibetan | 1/1 | 0/18 |

Both pass overall; for Han the point estimate is 0.71-0.875 and the interval reaches 0.36, so the gate is not met there.
Both miss the same Han page (a list of book titles). **Price:** Sonnet, about 1.4 weekly points per 1,000 pages on the
milolomas login (1,370 calls moved it 81% → 83%, integer meter, with this session on the same login); agy Flash-low,
about 4 weekly points per 1,000 calls on the milo pool (264 calls: 76% → 75% weekly, 49% → 44% of the 5-hour bucket).
Fee × share: the plans' fees are not recorded in the repo; at $200 a month for Max 20x that is about $0.65 per 1,000 pages
for Sonnet.

**6. Screen on the frame** — SCALE_PLACEHOLDER

### Cost

- 2026-11-03 · Gemini API, replay (698 calls: 129 gemini-3.1-flash-lite-preview, 569 gemini-3.1-flash-lite) · #5021 ·
  2.51M tokens in, 0.93M out · ≈ $2.0 at Flash-Lite list prices; the gemini_usage rows meter $6.2, because the preview
  model is not in `model-pricing.mjs` and falls to the $1.5/$9 default.
- Sonnet and Opus on the milolomas subscription, agy on the milo pool: see the price lines above; no cash.

**Replicated?** The replay is its own replication of the stored slides (2 reps per slid input). The rest is one run.
