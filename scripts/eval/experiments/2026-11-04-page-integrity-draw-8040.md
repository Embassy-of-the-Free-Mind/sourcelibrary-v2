---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 200
n_pages: 200
verdict: "PRE-REGISTERED, not yet run: how often a reader's page image, text, English and number disagree, by defect."
status: informational
decision: "none yet"
superseded_by: null
issue: [8040, 7169, 5021, 5803, 5699, 5056]
router_evidence: "none — a whole-chain alignment draw over every route; it adds no judged page to a router cell and changes no k/n"
defect_rates: "none — it counts pages whose parts do not belong together, not misleads or wrong_text per 1,000 words"
---
## 2026-11-04 · How often do a reader's page image, text, English and number disagree? (#8040)

PRIOR ART:
- `scripts/audit/leaf-shift-confirm-5021.mjs`: the sealed `claude -p` call and leaf fetch, reused. It asks about pages a screen already flagged, so it cannot give a rate.
- `scripts/eval/spot-check/served-draw.mjs` and `REVIEWER.md`: one served page per book, but only pages with English, and it grades quality with no label for order, number or split.
- `scripts/audit/page-integrity.mjs`, `leaf-order-sharpen.mjs`, `translation-leaf-shift.mjs`: $0 screens over text, no image, no rate.
- `.claude/skills/spot-check-round/SKILL.md`: 3 pages a book, `book_checks` writes. Its reviewer does not fit these five labels, and a page's neighbours are not given as images.
- Searched `gh issue list --search "reader's-eye draw"` (#7169: detector recall by class, not this) and `gh pr list --search 8040` (nothing).

Code: `scripts/audit/page-integrity-draw.mjs`.

**Pre-registration (committed before any judge call).**

- **Frame.** `books`: `visible: true`, `pages_count > 0`, at the draw.
- **Draw.** 200 books in a seeded order (`bookOrder`, `makeRng`), uniform per book. Seed 20261104. One served page per book, uniform over the book's pages with `page_number > 0`, no `repeat_of`, `page_type` not `blank`; a page whose own `<page-type>` tag says blank moves to the next served page. Pages inside a book are one observation, so never more than one. Pages with no transcription or no English stay in: `empty` and `none` are labels.
- **Recorded per page.** Frame number, shown number (the toolbar's `p. N` is the frame; the flow reader and citations show `printed_page.label` when stored), OCR engine, translation engine, language, script, provider, tenant.
- **Judge.** Opus via `claude -p` on the subscription, one call per page, `--restricted --tools Read`, no session, a folder holding only the three images. It gets the title, the catalogue language, the images and stored text of frames N-1, N and N+1, the English of frame N and both shown numbers. A verdict counts only if the transcript shows a Read of every image. The judge is not told the rates, the flags or the existence of controls.
- **Labels per page.**
  1. `text_leaf`: `this_leaf` / `prev_leaf` / `next_leaf` / `other` (another book, elsewhere, or on no visible leaf) / `empty` / `cannot_tell`. A bad misread of this leaf is `this_leaf`.
  2. `english`: `this_text` / `prev_text` / `next_text` / `mixed` / `invents` / `none` / `cannot_tell`, against the transcription. A carried sentence, an omission or a mistranslation is `this_text`.
  3. `number`: the number printed on the image, and whether it agrees with the frame (`agrees` / `disagrees` / `none_printed` / `cannot_tell`) and with the stored printed number. A frame that differs from the print is a fact about scans and is reported apart from a stored number that differs, which is a defect.
  4. `order`: `forward` / `backward` / `jumbled` / `cannot_tell`.
  5. `split`: `single_leaf` / `two_leaves` / `plate_cut` / `cannot_tell`.
  6. `repeat` (added for #5056): a neighbour is a second capture of this leaf, `none` / `prev` / `next`.
- **Controls, hidden in the judge's order.** 38 planted on books outside the 200, from windows with text and English: image of another book (5), a neighbour's text on the page (5), a one-leaf shift across the window (5), a neighbour's English (5), another book's English (5), neighbours swapped (5), two leaves composited into one frame (4), a number stamped on the frames (4). A class is caught only by its own label. Report catches per class. If a class catches under 4 of 5 (3 of 4), that defect's rate is printed as "not settled".
- **Re-judge.** Every flagged page plus unflagged pages to reach at least 20 and at least 5 unflagged, in a fresh call with the same prompt, blind. Over-flag = flags not repeated.
- **Read by eye.** At least 5 positives with the images open before any rate is stated.
- **Report.** k/n with a Wilson 95% interval per defect, by language group (Latin, German, English, Romance + Dutch, other Latin script, CJK, other script), and by whether a repair has touched the book (#5021, #5803, #5699, #5056, from `sweep_log`, `book_events`, `page_revisions`, the pipeline hold and `repeat_of`). No single pass/fail share. Denominators: text over pages with a transcription, English over pages with English, stored number over pages where a number is printed and one is stored, order over pages not `cannot_tell`.
- **Known limits, stated now.** Books are weighted equally, not by readers. Opus judges some Claude-made text (`ocr_engine` is recorded so it can be cut). One page per book reads a book-level fault once. This is `judged`: AI reviewers, no human reference.

**Result.** Not yet run.
