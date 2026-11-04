---
stage: translation
measure: [judged]
languages: [la, de, en, el, ru, zh, fr, nl, sa, ko, it, hy]
scripts: [Latn, Grek, Cyrl, Hani, Deva, Arab, Hebr, Tibt]
canons: []
n_books: 24859
n_pages: 5736921
verdict: "A number-vote detector with gappy runs flags 1,164 of 24,859 live translated books for English sitting on the wrong leaf; Opus, reading the scans of n-1, n, n+1 blind to the flagged direction, confirms 76 of 80 tier-A books (95%, 88-98) and 156 of 220 tier-B books (71%, 65-77), and calls a shift on 0 of 20 random unflagged windows. On the single-page v2/v5 lane, which cannot shift, only 3 of 22 flagged runs confirm. A third signal, absorption (one page's English as long as its own leaf plus the next), confirms 40 of 59 (68%, 55-78) and reaches 1,624 books the numbers do not flag."
status: adopted
decision: "Contained 2026-11-03 under the contain-on-finding rule: 298 Opus-confirmed wrong-leaf pages in 74 tier-A books withheld (snapshots in page_revisions, sweep_log 'withhold-by-eye'), books held with reason leaf-shift-5021, release-when issue:5021. 495 more confirmed pages in 157 books are listed and not withheld (the brief's 300-page cap); a DECISION row asks about them. Detector change: scripts/lib/leaf-shift.mjs gappy rule for the audit only; the write-time gate keeps the strict rule."
superseded_by: null
issue: [5021]
router_evidence: "none — a detector's precision on stored English, not a comparison of routes"
defect_rates: "none — the unit is a page on the wrong leaf, counted by book and page, not a defect rate per 1,000 words"
---
## 2026-11-03 · English on the wrong leaf, library-wide: gappy runs, Opus with the images, and absorption (#5021)

PRIOR ART: `scripts/audit/translation-leaf-shift.mjs` and `scripts/lib/leaf-shift.mjs` (the 2026-10-13 number-vote
detector, `2026-10-13-translation-leaf-shift-5021.md`), reused and changed here, not rebuilt. The 10-15 full scan of
the other-script books (#5021 comment, 1,011 flagged) used the strict rule and opened no images. The write-time gate
(`2026-10-15-leaf-shift-write-gate-5021.md`) is untouched.

**Who it is for.** A reader opening a page gets fluent English that translates the leaf before or after it. Nothing
on screen says so. This finds those pages, checks them against the scans, and takes the confirmed ones off the page.

### 1. The rule fix (gappy runs)

Before: a book was flagged on 2 or more ADJACENT pages that vote only for the next (or previous) leaf's printed
numbers. Karl Grosherzog pp.16-20 votes next, -, next, -, prev (pp.17 and 19 print no testable number), so it was
missed. Now (`gappyRuns` in `scripts/lib/leaf-shift.mjs`): a run is a window where 2 or more pages vote one
direction, nothing votes the other way, `own` or `mixed`, and at most 2 silent pages sit between two votes; a `next`
run may end on one `prev` page (the last leaf of a slipped block carries the previous leaf's footnotes back: Karl
p.20). A run that holds a strong strict run stays strong, so widening never demotes tier A. The strict rule is kept
in the output (`strictRuns`) and is still the write-time gate's. Unit cases: `tests/unit/leaf-shift-gappy-runs.test.ts`,
fixtures from the four controls' pre-containment text reduced to numbers.

**The 300-book sample.** 10-13: 19 of 300 flagged (8 tier A). The seeded draw cannot be repeated (the frame grew from
20,404 to 20,620 books, so seed 5021 draws other books). Today's draw: strict 16 of 300, gappy 16 of 300 (6 tier A
each): no change in this sample. The 19 books flagged on 10-13, re-read today: 13 still flag (six lost their run to
the 10-13 containment); the gappy rule lengthens the run in 5 (e.g. 70-71 → 68-71, 412-414 → 412-417) and adds a run
in 2. Library-wide the gappy rule adds 184 books to the strict rule's 980 (+19%).

### 2. Library-wide run

Every live translated book (`visible`, `pages_count > 0`, `pages_translated > 0`): 24,859 books and 5,736,921
translated pages, both frames, read
2026-11-03 09:20-09:50 UTC, $0, read-only.

| | books | flagged | tier A | tier B |
|---|---:|---:|---:|---:|
| all | 24,859 | 1,164 (4.7%) | 310 (1.25%) | 854 |
| other-script label | 18,338 | 1,068 (5.8%) | 292 | 776 |
| caseless-script label | 6,521 | 96 (1.5%) | 18 | 78 |

By the translation lane of most of the book's pages:

| lane (prompt_version) | books | flagged | tier A |
|---|---:|---:|---:|
| block v10/v11 | 10,560 | 821 (7.8%) | 233 (2.21%) |
| v1/v6 (2026 named prompts, Flash-Lite) | 1,572 | 110 (7.0%) | 36 (2.29%) |
| v12+ | 8,782 | 140 (1.6%) | 39 (0.44%) |
| v2/v5 single-page lane (cannot shift: noise floor) | 3,396 | 91 (2.7%) | 2 (0.06%) |

Note: prompt versions `1` and `6` are not the old single-page lane. They are 2026 named prompts ("Standard
Translation", "English Modernization") on Flash-Lite, and their tier-A runs confirm 15 of 16 (§3). The noise floor is
v2/v5. By model: gemini-3.1-flash-lite-preview 553 of 6,770 books (8.2%), flash-lite 298 of 7,450 (4.0%),
gemini-3-flash-preview 294 of 8,707 (3.4%), gemini-3.8-flash-low 12 of 1,223 (1.0%), claude-opus-5-5 6 of 286.
By language: Latin 521 of 9,246, German 165 of 2,686 (66 tier A), Greek 99 of 1,073, English 76, Russian 59 of 241
(24%, and 13 of 13 sampled Russian books confirm), French 49, Chinese 36 of 2,818, Dutch 28, Sanskrit 25 of 329,
Tibetan 0 of 1,569. Every flagged book with its runs: `scripts/eval/results/translation-leaf-shift-5021/2026-11-03/flagged.jsonl.gz`.

**Coverage gap** (share of translated pages that cast no number vote; a silent page is no claim): all 65%; Latin
script 59%, Greek 71%, Cyrillic 70%, Devanagari 48%, Arabic 85%, Hebrew 91%, Han 91%, Japanese 92%, Tibetan 99%,
Hangul 99.5%.

### 3. Confirmation by Opus, with the images

`scripts/audit/leaf-shift-confirm-5021.mjs`: one sealed `claude -p --model opus` call per flagged run (at most 3 runs
and 6 pages per run per book), 4 at once, on this box's subscription. Each call gets the scans (display_photo,
≤ 1,400 px) and transcriptions of pages n-1 … end+1 and the English shown on each run page, and is NOT told the
direction, the tier, or that a shift is expected. Verdict per page: own / next / prev / mixed / other / cannot_tell
with a quoted pair of phrases. 1,164 > 300, so a seeded (5021) 300 stratified by tier, proportional: 80 A, 220 B;
416 calls, 1,153 pages, no failures. A book counts as real when some run page is judged to carry the flagged
direction's leaf.

| | books | real | 95% (Wilson) |
|---|---:|---:|---|
| tier A | 80 | 76 | 95% (88-98) |
| tier B | 220 | 156 | 71% (65-77) |
| all | 300 | 232 | 77% (72-82) |
| other-script frame | 275 | 221 | 80% (75-85) |
| caseless frame | 25 | 11 | 44% (27-63) |
| books flagged only by the gappy rule | 48 | 29 | 60% (46-73) |

By run lane: block v10/v11 tier A 101 of 111 runs (91%), tier B 152 of 213 (71%); v1/v6 tier A 15 of 16, B 22 of
28; v12+ A 5 of 7, B 9 of 19; v2/v5 lane B 3 of 22 (14%, 5-33). The v2/v5 lane cannot move a page, so its 3 are either
Opus errors or OCR-side faults; they are listed, not withheld.

**Controls.** Positive, with their pre-containment English (`--as-of`): Karl 16-20 next, next, next, next, prev;
Corpus Medicorum 83 next, 84 other (a model note), 82 own; Postel 179-184 all next; Śakuntalā 292-294 next, 291
mixed. All four match the by-eye record. Negative: 20 two-page windows drawn at random (seed 50210) from unflagged
live books; all 20 judged: 38 pages own, 1 other (a Javanese page), **0 of 20 windows called next or prev** (0-16%).

**Recall on the controls, by signal.** Numbers, strict rule: Śakuntalā only (1 of 4). Numbers, gappy rule: Karl and
Śakuntalā (2 of 4). Corpus Medicorum p.83 (one voting page, p.82) and Postel (no printed numbers) stay silent. The
name signal (§4) adds Postel p.179 alone, not a run. Absorption (§5) catches Karl p.15, Corpus p.82 and Postel p.178.
All four signals together: 4 of 4.

### 4. Second signal: capitalised names (measured, not used)

`namesIn`: capitalised tokens of 4+ letters, folded to their first five letters (Galeni / Galen), minus a stop list
of sentence openers and any word the same text also writes in lower case, voting own/next/prev like the numbers,
2 votes needed for a direction, used only where the numbers are silent. It fills Karl p.19 and Postel p.179. But it
fires at the noise floor: in the 300 sample it adds name-only runs to 4 of 53 single-page books and 11 of 162 block
books; library-wide 854 books get a name-only run (block 5.9% of books, v2/v5 3.6%). It is reported (`nameRuns`)
and feeds absorption's corroboration, but flags nothing on its own. Cross-lingual embeddings (LaBSE / e5) were not
tried: this box is ARM64 with no ML stack, and absorption covered the shape the brief wanted them for.

### 5. Third signal: absorption (Derek's session, 2026-11-03, via the job inbox)

A slide starts with one page whose English holds its own leaf AND the next. With k the book's median
log(EN chars / SRC chars) over text pages (SRC ≥ 300), page n absorbs when n and n+1 were written in one block
(`translation.updated_at` within 2 s: a block's pages are written milliseconds apart) and
|log EN(n) − k − log SRC(n)| > 0.5 and |log EN(n) − k − log(SRC(n)+SRC(n+1))| < 0.2. Index, apparatus, title and
similar page types are skipped. Corroborated = n votes next, or a page in n+1..n+3 votes next/prev (numbers, or
names where the numbers are silent). `absorptionsOf` in `scripts/lib/leaf-shift.mjs`.

Controls: Karl p.15 (corroborated by 16, 18), Corpus p.82 (by its own next vote), Postel p.178 (by names on 179):
3 of 4; Śakuntalā's run start is not hit, and Śakuntalā (bilingual with notes, k = −0.54) fires 30 uncorroborated
false absorptions and 2 corroborated ones, which is why corroboration is required. Library-wide (second pass,
10:00-10:30 UTC, after the containment below): 5,593 books have an absorbing page, 2,350 a corroborated one; it
almost never fires on the v2/v5 lane (11 of 2,913 books corroborated), since one-page writes are not one block.
4,484 corroborated absorbing pages in 2,124 books lie outside every number-flagged run, 1,624 of those books not
number-flagged at all. Opus on a seeded 60 of them (59 judged): **40 real (68%, 55-78)**; corroborated by names only
26 of 35, by numbers 14 of 24. On the absorbing page itself Opus says mixed 43, own 13, next 3, which is the shape
the signal assumes. Caseless scripts: 704 of 5,819 caseless-script books have an absorbing page but only 60 are
corroborated; the uncorroborated ones were not sent to Opus. List: `absorbed-outside-runs.jsonl.gz`.

### 6. Containment

Opus confirmed 793 run pages (next or prev) in 231 books outside the v2/v5 lane; no page had a human edit
(`translation.source` manual / `edited_by`). The brief caps containment at 300: tier-A books in selection order,
whole books, up to 300 pages, gave **298 pages in 74 books**. Each book held (`hold-pipeline-books.mjs`, reason
`leaf-shift-5021`, release-when `issue:5021`; 68 newly, 6 already held for another reason), then
`withhold-stale-translations.mjs --by-eye-pages … --issue=5021` dry run (298 targeted) and `--apply` (298 withheld).
Verified after: 298 of 298 pages have no served English and a `translation_withheld` record; 74 of 74 books held.
Undo: `restore-withheld-translation.mjs`. Not withheld: 495 confirmed pages in 157 books (tier A 7 pages in 2
books, the rest tier B), and the 3 v2/v5 pages: `containment.json`. Re-translation of the 298 withheld pages is
priced work, not done. Actuation: the withhold bumps `pages.updated_at`, so the 4-hourly `embed-gemini --incremental`
re-embeds those 298 pages from their OCR (bounded by its $5/day guard).

### Estimate

Tier A 310 books × 95% ≈ 295 real; tier B 854 × 71% ≈ 605; about **900 books** (≈ 850-960) carry a number-detected
run, 3.6% of live translated books. Absorption adds about 0.68 × 1,624 ≈ 1,100 more books with at least one
wrong-leaf page (precision on n = 59). Pages: the 300 sample gave 3.4 confirmed pages per confirmed book (793 in 231, with at most 3 runs and 6 pages
a run sent), so the number-flagged set alone holds roughly 3,000 wrong-leaf pages, before absorption. Still a floor: 65% of translated
pages cast no number vote, and a slide whose start the absorption test misses is invisible.

**Replicated?** No. One scan, one Opus read per run. Precision rests on 300 books (80 / 220) and 59 absorption
windows; the negative control on 20 windows.

**Not done.** The 495 confirmed pages not withheld; the 864 flagged books not sent to Opus; the 4,484 absorbing pages
beyond the 59 judged; embeddings for caseless scripts; re-translation (paid). The absorption test is not in the
write-time gate.

**Artifacts.** `scripts/eval/results/translation-leaf-shift-5021/2026-11-03/`: `library-summary.json` (frame, lane,
script, language, model tables), `flagged.jsonl.gz` (1,164 books, runs, strict runs, name runs), `selection.json`,
`opus-verdicts.jsonl.gz` (all 495 calls: flagged-300, negative-control, absorption arms), `containment.json`,
`absorbed-outside-runs.jsonl.gz`. Reproduce: `translation-leaf-shift.mjs --frame rest --sample all --live --shard i/4`
and `--frame caseless --live --shard i/2`; `leaf-shift-confirm-5021.mjs --flagged <flagged.jsonl> --select 300 --seed 5021`.
