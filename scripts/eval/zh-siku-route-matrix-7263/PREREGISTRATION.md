# PREREGISTRATION: which route corrects the 93,277 Gemini-read Siku pages? (#7263, job zh-siku-route-matrix-7263)

Committed before any new text in this test is judged. Written 2026-11-04. Set B is drawn; Paddle reads and arm reads may have
started; no judge has seen a new text.

PRIOR ART: `2026-11-03-zh-reocr-cheap-arms-7263.md` (arms, judge, pricing), `2026-11-04-zh-print-arms-7263.md` (fresh read vs
correction on print), `2026-11-04-zh-translation-paired-5274.md` test 2 and `scripts/eval/zh-ocr-gap-translation-5274/run.mjs`
(the English endpoint and the Kanripo trace, extended), `scripts/eval/zh-ditto-restore-5274/score.mjs` (marks in CER).

## Question and the result that would change a decision

Which route should the Siku frame take, given that transcription errors matter to the extent that the translation matters?
**What would change a decision:** a route cheaper than Opus on every page whose English costs the reader no more than the
rule below allows. Thirty pages cannot pass an 8-point margin and sixty cannot show non-inferiority: this is a choice among
routes under a stated rule, not an equivalence claim.

## Pages

- **Set A:** the 30 Siku pages of #8008 / PR #8017. Existing arms and verdicts stand, keyed by text hash.
- **Set B:** 30 fresh pages, one per book (`draw.mjs --seed=20261104 --not-held`, `results/setB-draw.json`): none of set A's
  books, no 佩文韻府 / 駢字類編 / 韻府拾遺, no book with a hold or status held, no withheld page, no human edit, stored text
  aligned to the book's Kanripo WYG leaf at Dice >= 0.6.
- **How that narrows the frame.** Siku frame 10,774 books, 84,273 print-class pages. Not held: 1,797 books, 29,280 pages.
  Not the family: 1,206 books, 20,458 pages. So set B speaks for the unheld quarter of the frame: 76% of the frame's pages are
  in held books, which the brief keeps out. Set A is PPS on the whole frame (18 of 30 held), and its held / unheld split is
  reported, so a difference shows. The Kanripo preference cost 3 books of 51 tried. Three volumes of 禮記注疏 are in set B
  (separate books, one work).
- **Print addition:** the 60 pages of PR #8114, PO only (transcription judge; no English).

## Arms (one page a call; the prompts of PR #8017 and PR #8114)

F Opus fresh, image only. PO Paddle draft > Opus. O stored > Opus. FF Flash 3.8 low fresh, image only. PFL Paddle > Flash low.
SFL stored > Flash low. Baselines S stored, P Paddle. Set A already has O, PFL, SFL, S, P. Identical texts are judged once.
Paddle draft: the read itself (`arms.mjs paddle`); a refused read's draft is the stored text, as in PR #8017. Served: a
correction; UNCHANGED serves the draft; contain or no answer serves stored. F and FF: no answer serves no text, counted not
accepted.

**Mixed route M (derived, no calls).** PFL served unless the page's signal is at or above the cutoff; those pages take PO
(variant M-PO) or O (variant M-O). Signal (`signal.py`): keep Han plus 丨 and ｜ in the PFL and stored texts; 1 −
`difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()`.
**FROZEN from set A: cutoff 0.178392** (`results/signal-setA.json`; the smallest signal in set A's top third). M is scored on
set B only. On set A, M-O is 24/30 accepted, 2 wrong-text on transcription. Several signals were tried on those 30 pages, so
set A's M result is hypothesis-forming and is labelled so. On set B the share of pages sent is whatever the frozen cutoff
sends, and M's price uses that share.

## Measures

1. **Transcription.** Kanripo CER (`bodyCer` on `hanOf` of the ditto record: bars folded to 丨), with marks and with marks
   removed; blind Opus judge with the image (`confirm.mjs judge`): accepted k/n, wrong-text pages, severe per 1,000 characters.
2. **English, primary.** Each arm's text translated by one translator (`gemini-3.8-flash-low` via agy, no previous-page
   English, no neighbour OCR, one page a call: `zh-ocr-gap-translation-5274/run.mjs translate`), then blind Opus judge with the
   scan and no transcription (its `prompt`, which keeps the arm hidden): accepted, wrong-meaning pages (a `wrong_text` defect),
   name/number pages, major defects (misleads + wrong_text) per 1,000 English words. Each major defect on a page with a Kanripo
   leaf is traced (`run.mjs trace`) to source misread, translator or unclear. **The source-caused count per arm is the number
   that says what a transcription difference costs a reader.**
3. Severity distributions and errors by kind (defect class) per arm, not only pass/fail.
4. Price per 1,000 pages and per accepted English page, at fee × quota share (as PR #8017: agy by measured list cost against
   the #7611 call; Opus from measured tokens against the #8008 bounds; Paddle $0.09). Opus account-weeks and agy pool-weeks for
   93,277 pages, per arm and for M, translation included. How many pages' existing English goes stale.

## What 60 pages can detect

Paired n=60 with about 20% discordant pages: McNemar has 80% power at a gap of roughly 18–20 points, i.e. 11–12 pages. A
3-page margin is 5 points, far inside the noise of a test this size: it is a tie-break rule among routes, not a demonstration of
equality. Set B alone (M's comparison): roughly 25–30 points.

## Decision rule

Among the arms on sets A + B together (n=60), and M on set B:

1. Best arm: the lowest English wrong-meaning page count; the lowest Kanripo source-caused major-defect count on the pages with
   a leaf (each is taken separately; they may be different arms).
2. A route **qualifies** if its wrong-meaning count is within 3 of the best arm's AND its source-caused count is within 25% of
   the best arm's. **Where those two disagree, Kanripo governs**: the source-caused test decides, because the judge is the same
   model as the Opus arms.
3. Take the qualifying route with the lowest quota price. An arm whose English was not judged cannot qualify.
4. **M has only set B**, so it is compared with the best arm's counts on set B alone, with the margin scaled to 30 pages: within
   1 page of the best arm's wrong-meaning count (3 × 30/60 = 1.5, rounded down) and within 25% on source-caused. The literal
   "within 3" reading is reported beside it. M's source-caused count uses the served arm per page.
5. If nothing cheaper than the best qualifying Opus route qualifies, say so and stop testing cheaper routes on this frame: that goes in the record.
6. Also recorded: PO against O and F, separately on print and on Siku. End with one DECISION line and a default. No bulk run starts.

## Controls and caveats

Opus judges Opus; Kanripo stays beside it. Transcription: 2 wrong-page controls in this sitting on each of set A, set B and each
print set, and 2 more where an arm's row is judged again; O judged again under `#matrix` on a seeded 10 pages of set A and set B and 6
of print, for a noise floor. English: wrong-page swaps and retests in the same queue. **A control accepted voids that sitting.**
No Flash judge as a verdict. At least 5 disagreements opened with the image by the job itself, and which way each went is said.
Everything else is judge-reported. Kanripo is another digitisation; where it and the image disagree the image governs a by-eye
check, and Kanripo's own defects (#7503) are reported where seen.

## Limits

Cash $0; subscription and agy only. Pools: floors at the larger of LANE_RESERVES (18%) and 20% weekly, 25% 5-hour; `/quota` is
read before each block. **Opus cap 1,000 calls in total**, counted in `results/ledger.json`. The full design is about 1,130 calls:
210 reads (150 Siku + 60 print), about 390 transcription verdicts, 480 English verdicts, controls. So, as the brief says, **FF's
English and then SFL's English are dropped now**, before anything is judged; their transcription verdicts stay, and they cannot
qualify under rule 3. Anything still over the cap comes out of the controls' size first, then P's English on set A. Flash low about
700 calls; the trace is per defect, as test 2, and stops at 1,200 calls in total with the untraced count reported.

## Writes

Tests-produce-useful-pages: a page's best judged read may be written only through `cli-ocr.mjs apply` or the translate door, old
text to page_revisions, only if the judge prefers it, it is not wrong-text and Kanripo does not contradict it. Never a human
edit or a held book. Per-page verdicts go in as `origin:test` rows if the writer fits. No bulk, no cron, no change to current.json or rules.json.
