# Preregistration: four pages per call with folio markers and no previous-page English (#8399)

PRIOR ART: `PREREGISTRATION-seam-prevent-7118.md` and `experiments/2026-10-29-seam-prevent-markers-7118.md` (folio
markers on two-page blocks, one-page production reads; adopted for `cli-translate.mjs read` pairs). Its harness
(`seam-prevent-7118/ab.mjs`), seam judge and sign test are reused by `seam-prevent-7118/blocks4-8399.mjs`; nothing
measured the per-call=4 rows (`latin-cli-agy4`, `german-cli-agy4`), which run `claude-translate.mjs --per-call=4`
with page tags and the previous page's English at each block start.

Written 2026-11-08 after the sample was drawn (`build`, which reads only stored OCR and stored English) and before
any arm was run or any output read.

## Question

On the per-call=4 rows, does sending 4 consecutive pages as one continuous text with folio markers, and no
previous-page English anywhere (B), break fewer page joins than production (A), with no leaks and no loss of
per-page usability? Does a seam call per block boundary on top (C) add anything?

## Arms (same blocks, `gemini-3.8-flash-low` through agy, the `.agy-james` pool; $0)

All reads come from the production reader itself, `scripts/batch/claude-translate.mjs read --cli=agy --per-call=4
--fresh` with `CANDIDATE_READS=off` (no reuse, nothing kept), one run per wave so that every block is its own run
and is seeded exactly as a lane block is.

- **A** production: page tags with JSON anchors, the stored English of the page before the block as continuity,
  the block guards (anchors, absorption, number vote, clause drift, leaf seam) and their one-page re-reads.
- **A2** A again (noise floor).
- **B** `--folio-markers=1` (this branch): the block's pages as ONE continuous text with `<pb n="N"/>` where each
  page begins (translate-core `FOLIO_MARKER_RULE`), split at the markers (`splitMarkedReply`, every page turn held
  to the #7118 balance bound [0.6, 1.67]); the wrong-leaf checks (absorption, number vote) and the leaf-seam check;
  any unusable or unbalanced split, or a refused page, is read one page per call. **No call sends previous-page
  English**, the marked block or a page read alone.
- **C** B + one seam call per block-boundary join: the #6742 seam label + minimal repair through agy
  (`seam-repair-6742/gemini-repair.mjs geminiPack`), placed only inside the #6742 edge bound (`edgeRefusal`,
  `mapOntoRaw`). It is cheap to add because the pass exists; it touches block boundaries only, so on an in-block
  join C is B.

## Sample (drawn: `build.json`)

- 4-page blocks, one per seam: `[N-1, N, N+1, N+2]` (else `[N..N+3]` or `[N-2..N+1]`), all four prose pages with
  OCR ≥ 200 chars that `planBlocks` keeps as one block, and a page before the block with OCR and stored English.
- **60 of #5103's 63 seams** (9 books; 3 could not be placed in a 4-page prose block).
- **30 LEAK seams**, one per book: `translation-page-boundaries.mjs` `sharedRun` ≥ 200 chars between N and N+1's
  stored English, sources not repeating, Latin/German books in random order (seed 8399): 97 books scanned,
  140 flags, 30 kept.
- 90 blocks, 39 books; Latin 74, German 16.

## Measures

1. **Seam defects** (the #7118 judge, imported from `ab.mjs`): one blind Opus call per join with all versions
   side by side (A, A2, B, C where it differs, an identical copy of A, and a **planted** version: A's join with its
   last sentence on page N dropped, or repeated at the head of N+1, alternating), both orders, defective only when
   both orders say so. Two joins per block:
   - **T** the seam itself, inside the block for every arm;
   - **S** the block-start join (stored English of the page before | the arm's first page), where A has the
     previous English and B has none.
   **Seam-defect rate = 0.75·T + 0.25·S** (3 of a block's 4 page turns lie inside it), by-row bootstrap interval.
2. **Leaks**: the detector's LEAK (`sharedRun` ≥ 200 on normalised English, source repeats excluded) on every
   consecutive pair of each arm, the S join included (left side the stored English, or C's edit of it).
3. **Usable rate per page**: `route-judge-6740/judge.mjs` (Opus, page image attached, one output per call), one
   page per book (the left page of T) for A, A2 and B; 3 wrong-page controls per arm and 6 repeats of A;
   `paired-arm.mjs check` must pass before judging. C equals B on these pages (C edits only a block's first page).

**Smallest detectable gap.** With n = 90 paired joins and 20–30% discordant (A against #7118's M: 32%), a one-sided
sign test at α = 0.05 with 80% power detects a difference of **11–16 per 100 joins** on one join type. #7118's
A-vs-A2 swing was 8.2 per 100. A difference smaller than that is not a difference. Per page, n ≈ 39: one page is
2.6 points, and only a gap of about 25 points could be separated.

## Decision rule (fixed in the brief)

A's rate is the **mean of A and A2** (two draws of production; #7118's A was an unlucky draw).

**B replaces A** on `latin-cli-agy4` and `german-cli-agy4` if all three hold:
- B's seam-defect rate ≤ A's;
- B has **0 leaks**;
- B's per-page accept rate ≥ (A + A2)/2 − noise, noise = max(|A − A2|, 2 pages) in points.

**C**: the same rule. If B and C both pass, B ships, and C is recorded as a follow-up only if it beats B at the S
joins by more than the A-vs-A2 swing there with p < 0.10 (the seam pass is a new production stage, out of scope for
this PR). If only C passes, nothing ships in this PR and the seam pass becomes the follow-up.

**Instrument checks** (reported; a failed check is said and the result is read with it): the copy of A agrees with
A on ≥ 95% of joins; planted defects caught on ≥ 80%; wrong-page controls rejected; repeat flips reported.

Secondary, reported, not deciding: the T and S rates separately, by origin (#5103 vs leak), the paired sign tests
B vs A, B vs A2, C vs B; the share of B's blocks read marked vs fallen back to one page per call; agy calls.

## Not measured

Non-Latin scripts; pages outside prose; the cost per page (B makes one call per block when the split holds, and
one per page when it falls back).

## Amendment 1 (2026-11-08, before any arm output was read): block size by page density

**Why.** Derek's note in the job inbox (04:09Z, read 04:2xZ): "block size should follow page density, not a fixed 4.
Dense pages go 1-2 per call, light pages up to 4. Use a source-character budget per call, with translate-batch-seam
MAX_BLOCK_OCR_CHARS and planBlocks as prior art, and report the budget you pick. Stratify the test sample by density,
dense vs ordinary, and report seam and usable rates per stratum so the budget rests on evidence." The note overrides
the brief where they conflict.

**Disclosure.** Arms A, A2 and B had been started when the note was read. They were stopped after about 3 blocks
each; only the reader's progress lines (characters per page) were seen, no translation text. Their reads are kept:
A and A2 are unchanged, and the B reads become arm B4 below.

**Budget: 8,000 source characters per call** (`planBlocks` `maxChars`, new `claude-translate.mjs --block-chars`;
production's `MAX_BLOCK_OCR_CHARS` is 20,000 over up to 4 pages, so it never cuts a 4-page block on these rows). In
the drawn sample a page's OCR runs 1,330 / 1,842 / 2,866 characters at p10 / p50 / p90 and a 4-page block 7,460 at the
median: at 8,000 an ordinary block stays at 4 a call (the #7503 quota saving holds), pages above about 2,700
characters go 2 a call, and pages above 4,000 go alone.

**Arms now.**
- **A**, **A2** as registered.
- **B4**: markers, no previous English, a fixed 4 a call (B as first registered; the evidence arm for the budget).
- **Bb**: B4 + the 8,000-character budget. **Bb is the B of the decision rule.**
- **C**: Bb + one seam call on each join Bb reads across a call boundary: the block-start join (S) always, and the
  seam (T) when Bb read its two pages in different calls. Elsewhere C is Bb.

**Dense stratum.** A block is dense when its 4 pages average ≥ 3,000 OCR characters. The first draw held 9 such
blocks (all leak seams). `dense` added 30 blocks, one per book: Latin/German books in seeded random order (83995),
a run of 4 translated pages averaging ≥ 3,000 characters, a seam inside it that is a mid-flow break by #7118's
`qualifies` (the source runs across the turn), placed as above. 102 books scanned. **Now 120 blocks: 39 dense,
81 ordinary**, 69 books.

**Per page.** A, A2 and Bb on one page per book (69); B4 on the books whose picked block is dense, where the budget
changes the blocks. Controls as registered.

**Rule.** Unchanged, evaluated on Bb over all 120 blocks; seam and usable rates are reported per stratum.
**The budget is kept** with the markers unless, on the dense stratum, Bb's seam-defect rate is above B4's by more
than the A-vs-A2 swing, or Bb accepts more than 2 fewer dense pages than B4. If the budget is not kept, B4 is held to
the same rule (its per-page check on the dense books, against A and A2 on those books), and the markers ship at a
fixed 4 if it passes.

**Smallest detectable gap, revised.** n = 120: 10.4–13.2 per 100 joins on one join type. Dense stratum alone (n = 39):
about 16–22 per 100 — the per-stratum rates are descriptive.

## Amendment 2 (2026-11-08, POST HOC: written after the leak flags were read, before any seam or page verdict was read)

**What was seen.** `leaks` flagged A 10, A2 10, B4 4, Bb 4, C 4 consecutive pairs. Reading the OCR under each flag:
the same rows flag in every arm because the **source** repeats (a duplicated scan — `69b630dc…` p.25 and p.26 both
print leaf 13; two editions of one licence on facing pages, `69b21d9e…` p.9/10; a table header reprinted on each page).
The detector's source-repeat check compares raw OCR, and long s, abbreviation marks and another edition's spelling
break its 200-character run, so these pass as leaks. One Bb flag (`69b51e72…` p.70|71, the block-start join) is the
**stored** English of p.70 carrying p.71's text (the Latin of that passage is on p.71 only, at its foot); Bb's p.71 is a
correct reading of p.71, and Bb never saw the stored English.

**Change.** Every flag, in every arm, is classed by one mechanical rule (`leaks()` in the harness): `source` when the
two pages' folded OCR (no tags or marks, ſ→s, u/v and i/j merged) shares ≥ 10 word 4-grams and ≥ 10% of the smaller
page's; `stored_left` on a block-start join that an arm which never saw the stored English (B4, Bb, C) also flags; else
`translation`. On the 48 distinct flagged pairs the folded share separates cleanly (≥ 12 and ≥ 21% on every pair read as
a source repeat; ≤ 9 elsewhere, but one 19/321 = 6% pair, classed `translation`). **The rule's "0 leaks" now reads
`class_translation = 0`**; the raw count is reported beside it (`leaksZeroRaw`). A reader who rejects this amendment
reads B as failing the leak clause on raw counts, with A failing it too (10 flags).
