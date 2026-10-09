# Text hidden in the continuity `<meta>` — corpus count, classes, and the repair plan (2026-10-01)

PRIOR ART: scripts/eval/results/translation-invention-location-2026-09-30/README.md — tq9's finding on a 3,000-book sample; this is the full-mirror count, the class each page falls in, the live re-check, and the plan it implies.

Track tq11 of #5376; follows #5363 (the detector) and #5323 / #5148 (the write-time unwrap and the
first 307 repaired pages). Measurement only: nothing here wrote to a page. The write guard is PR #5432,
the v16 prompt line PR #5433.

**Who reads this.** Derek, deciding whether to approve a page-text migration, and for which pages. The
decision rows are in §5.

## 1. What the scan measured

`scripts/audit/hidden-meta-scan.mjs` over the whole local mirror (`~/sl-corpus`, taken 2026-09-29):
66,240 books, 19,900 with translations, **4,938,717 translated pages**. It parses only the pages that
carry the marker, so the walk takes four minutes in eight shards; `--summarize` classes the rows;
`--live` re-reads the candidates from the live `pages` collection (the mirror is two days old and
#5148's repair moved 307 pages on 2026-09-30); `--dry-run` previews the implied repair on live pages.

| Continuity metas | Pages |
|---|---|
| `<meta>continues from previous page…</meta>` present | 247,804 (5.0% of translated pages) |
| …bare marker, nothing after it (what the prompt's continuity rule asks for) | 59,805 |
| …a sentence about the previous page (`…'s discussion of`, `, where`) | 656 |
| …**text after the marker** | **187,343 (75.6%)** |
| …of which under 8 words (a phrase; left alone) | 94,659 |
| …of which 8 words or more — the rows classed below | **92,684, in 6,690 books (86,517 pages in visible books)** |

The prompt has offered `<meta>continues from previous page: ...</meta>` in its bracket-replacement list
since v11 (2026-04-14); every row from v11 to v15 carries it (checked in the `prompts` collection). The
pages are old: of the 10,413 `own-text` pages, 7,466 were written under prompt 11 and 2,437 under v10;
137 under v13, the default since 2026-09-03.

**Severity** — the hidden words as a share of everything the translation says (reader-visible body +
hidden; apparatus stripped as the reader strips it):

| Share hidden | Pages | What the reader meets |
|---|---|---|
| ≥ 80% (whole page) | 3,218 | a blank or near-blank page |
| 50–80% | 1,552 | half a page |
| 20–50% | 5,664 | the page minus its opening paragraph(s) |
| < 20% (opening) | 82,250 | the page minus its first line or two |

## 2. What the hidden words are — the classes

Each row carries evidence that needs no model: the payload's word-trigram share in the previous page's
translation (`inPrev`) and in this page's own visible body (`inBody`); cognates (the folded 5-letter
prefixes of its long English words, looked up in the head of this page's source and in the tail of the
previous page's — Latin, French, Italian and German share enough stems with English for the *difference*
to say which page the words translate); numbers and proper names the same way; and length accounting
against the language's median translation/source ratio (only when the payload is ≥ 20% of the page —
a page varies around its ratio by more than one line moves it).

| Class | Meaning | Pages | Repair |
|---|---|---|---|
| `own-text` | the page's own lines, translated into the meta | **10,413** | move meta → body, $0 |
| `copied-previous` | already in the previous page's translation (the continuity context handed back — or the previous page bridged into this one) | 37,905 | strip to the bare marker, $0; nothing a reader sees changes |
| `duplicate-of-body` | also in this page's visible body | 1,888 | strip, $0 |
| `description` | a sentence *about* a page ("The previous page was a blank endpaper…", "keywords: …") | 3,140 | strip, $0 |
| `not-this-page` | matches the previous page's source, or the page is whole without it | 1,540 | strip, $0 |
| `undecided` | no signal either way | 37,798 | see §5 |

By severity and class:

| | own-text | copied-previous | undecided | description | not-this-page | duplicate |
|---|---|---|---|---|---|---|
| whole page (≥ 80%) | 2,217 | 391 | 353 | 208 | 49 | 0 |
| half (50–80%) | 790 | 325 | 273 | 108 | 44 | 12 |
| part (20–50%) | 2,367 | 1,615 | 974 | 259 | 388 | 61 |
| opening (< 20%) | 5,039 | 35,574 | 36,198 | 2,565 | 1,059 | 1,815 |

Hidden words in all: 4.25M; in the `own-text` class 1.96M.

### Hand-read of the classes (one page per book, against the OCR *text*, not the image)

| Class · severity | Read | Right | Notes |
|---|---|---|---|
| own-text · whole | 6 | 6 | Italian, Latin, German, Greek (Demosthenes), Italian (Castiglione), Arabic (Ibn Khaldun): each payload is the page's source head, word for word |
| own-text · half | 4 | 4 | |
| own-text · part | 5 | 5 | Euripides *Heracles* 1268ff, Seneca, Sade… |
| own-text · opening | 8 | 7 | the miss was "this page begins the back matter catalog…", now caught by `description` |
| copied-previous · opening | 4 | 4 | each is the previous translation's last clause; 3 of 4 are the end of a sentence that runs onto this page, so the reader has it either way |
| copied-previous · whole | 4 | 4 | 2 are descriptions on near-empty leaves, 2 are the previous page's close with this page's own translation absent (a collapse, not a hidden page) |
| not-this-page · opening | 6 | 6 | 4 are summaries of the previous page, 2 are the previous page's text |
| undecided · opening | 8 | — | 2 the page's own first line, 4 the previous page's or invented, 1 a description, 1 unjudgeable (garbled source) |
| undecided · whole (< 40 words) | 5 | — | all sentences of commentary on a near-empty leaf (a heading, a stamp): the two-word body *is* the translation |

So `own-text` is **22/23** on the pages read; every `copied-previous` / `description` / `not-this-page`
strip loses nothing a reader has today; and `undecided` at the opening tier is roughly one-quarter the
page's own first line, the rest not this page's text.

### The `copied-previous` class has two shapes, and #5148's unwrap cannot tell them apart

`inPrev ≥ 0.6` means the payload already stands in the previous page's translation. That happens when
(a) the model handed the continuity context back and wrote nothing of this page — the page's own
translation is **absent** — or (b) the previous page's translation had already bridged into this page
(the next-page pull-back #5363 found in bodies) and this page repeats its own opening; or (c) the two
leaves are the same scan twice. The write-time unwrap (`unwrapHiddenTranslation`, #5148) opens any wrapper
longer than the body: run over the mirror pages with share ≥ 50%, it opens **170 of 716 copied-previous
pages** (and 2,092 of 3,007 own-text, 37 undecided, 13 not-this-page, 2 descriptions). Of the 5,715 T3
candidates on Hetzner (`/root/repair-t3-t12-5354/candidates.jsonl`), 2,365 are continuity metas in this
scan: 2,126 own-text, **183 copied-previous**, 41 undecided, 13 not-this-page, 2 descriptions. Of the 307
applied on 2026-09-30, **6 were copied-previous**; the two read by eye against the live pages
(69b62fd91c1c21a3737fb4fb p124, 69e8b18b2ff2a8dc09e76378 p26) are shapes (b) and (c) — the opened text is
right for the page and duplicated on the page before — so no wrong text was shown, but the rule got
there by luck. Splitting copied-previous by whose source the payload matches (cognates/anchors), share ≥ 50%:
94 own-source, 117 previous-source, 505 no signal.

**Before the remaining T3 candidates are applied: open only where the payload matches this page's source;
strip where it matches the previous page's; re-translate where neither.**

## 3. Live check (`live-summary.json`, `live-check.jsonl`; 2026-10-01 07:26Z)

Every row with share ≥ 20%, plus every `own-text` row: **15,473 pages in 3,922 books**, all found live.
15,053 are byte-for-byte what the mirror holds; 420 changed since 2026-09-29. **107 were opened by #5148**
(98 own-text, 6 copied-previous, 3 undecided). None is human-edited; one is on a hidden page. **15,055
still carry text in the meta.** Move candidates still live, by tier: whole page 2,088, half 778, part
2,325, opening 4,969 — **10,160 pages**.

## 4. Dry run (`dry-run.md`)

20 live pages, stratified by class and severity, before/after as the reader would see them. Nothing
written. The six whole-page moves turn an empty page (or a bare running head) into the page; the half
and part moves put the opening paragraphs back in front of the body; every strip leaves the visible text
unchanged. One of the four opening moves (69e53443d48480a3869658be p205, an English source) would place a
line the body already opens with: the mover should skip a payload with `inBody > 0.3`, which the `--live`
rows carry.

## 5. The plan — one decision row per tier

Prices: chained Batch lane $0.00056/page written (pilot 2026-09-29; $0.00061 at scale), realtime lite
$0.00241/page. Every write goes through `writePageTranslation` (revision row first, human-edit guard,
provenance kept: the model's own text, moved or trimmed, keeps its `engine` block; `content_hash`
recomputed; a `translation.repaired_by` stamp like #5148's `unwrapped_by`; `sweep_log` row per run;
`updated_at` bumped so the Supabase `page_translations` embedding resyncs). The move and the strip are
`moveContinuityPayload` / `stripContinuityPayload` in the scan script (pure; previewed, not yet a writer).

| Tier | Pages (live) | Repair | Cost | Risk | Recommended default |
|---|---|---|---|---|---|
| **A. own-text, whole + half + part** | 5,191 | move meta → body | $0 | a wrongly moved page shows an invented lead-in; hand-read 15/15 right at these tiers | **apply** — the same pages #5148 approved, under a tighter rule |
| **B. own-text, opening** | 4,969 | move (skip `inBody > 0.3`) | $0 | 7/8 right on the hand-read; the miss is now `description` | **apply** |
| **C. copied-previous / duplicate / description / not-this-page, all tiers** | ≈ 44,400 | strip to the bare marker | $0 | none visible: `<meta>` is already hidden; the two leaks (reader-v2 Info panel fallback, plain-text download) stop showing stray text | **apply after A+B**, or skip and fix the two leaks in the reader instead |
| **D. copied-previous, whole + half, where this page's translation is absent** | ≈ 120–620 (previous-source + no-signal, share ≥ 50%) | re-translate | ≤ $0.40 batch | the page shows nothing of itself today | **apply with E** |
| **E. undecided, whole + half + part** | 1,555 | re-translate (batch) | ≈ $0.90 batch / $3.80 realtime | a page re-translated under v13 hides its opening again 3.8% of the time — do it after the v16 flip, or in a lane that sends the v16 candidate text | **apply after v16** |
| **F. undecided, opening** | 36,198 | leave; or re-translate ≈ $20 batch; or a lite judge ("is TEXT the translation of the opening of SOURCE?") ≈ $8 and move the yeses | the reader loses one line on about a quarter of them (≈ 9K pages) | **leave until v16**, then re-translate under it |

A and B together restore the page's own words on **10,160 pages for no model spend**. The migration is a
data write and stays on the hold list; this README, the dry run and the live check are the review packet.
The candidate list for A and B is `move-candidates.jsonl` (book, page, tier, hidden words, `inBody`).
