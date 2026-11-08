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
