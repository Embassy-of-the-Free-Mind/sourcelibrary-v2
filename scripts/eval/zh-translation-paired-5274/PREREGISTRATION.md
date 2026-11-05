# Preregistration: re-translate the 3 Flash English on Paddle-read Chinese? (#5274)

Written 2026-11-04, committed before any arm reads a page. Job zh-translation-paired-5274, Derek's yes of 2026-11-04.

## Question

The stored English made by `gemini-3-flash-preview` on PaddleOCR transcriptions is 44% of live Chinese translated
pages, and 83% of a 12-book stratum was wrong end to end (2026-11-03-chinese-translation-strata-5274.md). Gemini 3.8
Flash measured 7.7% major on pages it was not randomly assigned to. Does a 3.8 Flash re-translation of these pages,
through agy, beat the stored English on the same pages, and should the previous page's English stay in its prompt?

## Frame and draw (`draw.mjs`, seed 20261104)

- Live Chinese and Classical Chinese books. Out: 佩文韻府, 駢字類編, 韻府拾遺 (their ditto marks are being restored,
  #5274 zh-ditto), held books (the Paddle lane's own OCR-only holds `paddle-zh-5600-ocr-only`,
  `paddle-zh-6388-ocr-only`, `gpu-backlog-5660`, `paddle-print-6101` are lane state and stay in, as in route-judge
  zh-dice), the books of #7968's draw, the strata sample and #5600's two draws, and any book with a human edit on
  any page.
- A page: English by `gemini-3-flash-preview` (source ai / batch_api), OCR by PaddleOCR, not withheld, page type not
  excluded, OCR ≥ 200 characters, English ≥ 100. For the draw also interior (15–95%) and ≥ 100 Han characters of OCR
  body (tags and `<detected-images>` removed), so no near-empty leaf.
- 30 reference-work books and 30 running-prose books (`zhKindOf`), one page per book, books in a seeded order. Six
  spare books a kind feed the swap controls.

## Arms (one page per call, agy only, `cli-translate.mjs read --fresh`, `CANDIDATE_READS=off`)

- **S**: the stored 3 Flash English (no call).
- **F**: `gemini-3.8-flash-low`, the live prompt (translate-core's single-page prompt, with the previous page's
  stored English and the neighbours' OCR for the page-break devices).
- **N**: the same with `--no-previous-translation`: the previous page's English is left out; the neighbours' OCR stays.
- **M** (`gemini-3.8-flash-medium`, the live prompt) only if the route is undecided after F and N (below). The
  `.agy-james` and `.agy-milo` logins are held to flash-low, and root's pool is under the floor (10% of its week on
  2026-11-04), so M can run only when root's pool is back above the floors; otherwise it is reported as not run.

Pools: `.agy-james` and `.agy-milo`, never below the Latin lane's floors (weekly 35%, 5-hour 25%). Root's pool is not
used. A read that fails is retried once; a page with no read in an arm is reported, not imputed.

## Judge

`route-judge-6740/judge.mjs`'s `judgePrompt` (translation task: page image + source transcription + one candidate),
unchanged, plus two questions appended for this test: a page-level `source_misread` (does the TRANSCRIPTION misread the
image in a way that changes the sense) and an `origin` on each defect (`translation` or `transcription`). Opus
through `claude -p` on this box's login, one candidate per call, arm names hidden behind hashed ids, order seeded. Two
arms with byte-identical text on a page share one verdict.

Controls: 10 swaps (this page's image and transcription, another book's stored English; caught when not accepted and
fidelity ≤ 2; need 9/10) and 10 retests (an item re-judged under a new id; within one fidelity point on 9/10; accept
agreement reported as the noise floor). A gate failure means no route claim.

Ceiling: 400 Opus calls. The judge stops at the box's Claude limits (judge.mjs's `claudeBlocked`).

## Measures (per arm, pooled and per kind)

- accepted k/n (primary); wrong-text pages (a `wrong_text` defect); major rate (a page with a `wrong_text` or
  `misleads` defect); severity-weighted defects per 1,000 English words (cosmetic 1, misleads 5, wrong_text 25, #7824
  weights; `words7824`); mean fidelity.
- Paired against S: pages gained (accepted in the arm, not in S) and lost; F vs N the same.
- OCR misread share: pages the judge flags `source_misread`, and the share of each arm's defects with origin
  `transcription`, so input faults are not counted as the translator's.
- Cost per accepted page: agy pool share per call (the token counts each read reports, priced with the router's
  agy share and the $200 plan fee, `rules.json`) divided by the accept rate; the pool meters read before and after.

## Decision rule

1. **Switch from S.** An arm X (F or N) is a re-translation route when, pooled over 60 pages, its paired gain over S
   is significant (exact McNemar, two-sided p < 0.05, on accept) AND its wrong-text pages are no more than S's.
2. **F or N.** If both pass, N is chosen when its accepted k ≥ F's k − 2 and its wrong-text pages ≤ F's + 1 (N is
   cheaper and removes the context-bleed path); else F. If one passes, it is chosen.
3. **Undecided → M.** If neither passes, or the chosen arm accepts fewer than 21/30 reference-work pages, M runs on
   the same 60 pages with the chosen (or, with none, the F) prompt, and the rule is applied to M against S.
4. The route's k/n by kind is reported either way. No re-translation at scale starts from this test.

## Useful pages

A judged read is written through `cli-translate.mjs apply` (the translate door; the old English to page_revisions)
only when the judge accepted it, gave it no wrong_text defect, and prefers it to S (higher fidelity, or equal
fidelity and fewer severity-weighted defects), and the page's stored English is unchanged since the draw. Among the
arms, the best by (accept, fidelity, fewer weighted defects) is written; a tie goes to N. Human edits are never
touched (the door refuses them, and the frame has none).

## Amendment 1 (2026-11-04 ~11:25Z): arm F4, four pages a call (Derek's inbox notes of 11:10Z and 11:12Z)

Committed before any F4 page is read. **At this commit arm N was fully read (60/60) and arm F was 52/60 read; no
verdict of any arm had been made** (the judge had not started). The F/N design above is unchanged.

**Arm F4.** `gemini-3.8-flash-low` through agy, **4 pages a call**, `claude-translate.mjs read --cli=agy --per-call=4
--fresh` (reply `json`, the #5021 anchor guard on, the production block guards: anchors, absorption, number vote,
in-block drift, leaf seam; a refused page is read again alone), `CANDIDATE_READS=off`, on the same 60 drawn pages.
Each judged page sits in a block of its real neighbours (`f4.mjs blocks`, seed 20261104): the block's position is
tried mid-block first (positions 2 and 3 in a seeded order), then 1 and 4, then blocks of 3 and 2, and the first
block the book allows is used (all its pages in the book, translatable, OCR ≥ 200 characters each, ≤ 20,000 in total,
so `planBlocks` keeps it whole). Position and block size are recorded per page.

**What context F4 sends** (recorded from each meta's `context`): the production block prompt, the stored English of
the page BEFORE THE BLOCK (the 3 Flash English, as the live lane sends for the first block of a run), the OCR of the
page before and the page after the block, and the other pages of the block as source. F and N send one page with the
previous page's stored English (F) or without it (N), and the neighbours' OCR.

**Factor matrix** (which factor each comparison changes):

| comparison | model tier | pages per call | previous-page English | source draft | stratum |
|---|---|---|---|---|---|
| F vs S | 3 Flash → 3.8 Flash low | 1 (S: as stored) | as stored → stored | Paddle (same) | ref + prose |
| N vs F | same | 1 | yes → no | same | same |
| F4 vs F | same | 1 → 4 | yes (page before the block, as the live lane sends) | same | same |
| test 2 (zh-ocr-gap) | same (3.8 low) | 1 | no | Paddle / Opus / Flash correction | 佩文韻府 family only |

F4 vs N is not a pages-per-call effect and no interaction is claimed: there is no N4 arm.

**Judge.** The same blind Opus judge and prompt, arm names hidden; the F4 reads join the same packet (new ids). The
10 retests are drawn from the S/F/N items only, as before F4 existed. F4 is compared with F paired (gained/lost, exact
McNemar), and reported: accepted k/n, wrong-text pages, major rate, weighted defects per 1,000 words, tokens and calls
per page against F, guard refusals by reason (`calls.jsonl` `guard`, refused calls by class). A judged page that was
refused in its block and read again alone (`call_pages` 1) is what would be served: it is scored in F4 and also
reported separately. F4 does not enter the S/F/N decision rule; it decides whether the Siku lane moves to 4 a call.

**Slip screen.** Every page of every F4 block (~240) is screened by Sonnet (`claude -p --model sonnet`, sealed, the
scans of n−1, n and n+1 and the F4 English of n): does the English carry text that belongs to the leaf before or
after (wrong-leaf), and how many sentences are finished on the wrong side of a page break. Every flag is confirmed by
Opus with the same three scans. Reported: confirmed slip pages, and blocks with a confirmed slip, with Wilson 95%
intervals; wrong-side sentence count; and the slip rate this n would still miss (the rate at which P(0 of n) = 0.05,
i.e. 3/n by the rule of three). Opus calls for F4 (60 verdicts + confirmations) stay under 100.

**Useful pages.** F4 reads of judged pages are candidates under the useful-page rule like F and N; F4 reads of the
unjudged neighbours are never written.
