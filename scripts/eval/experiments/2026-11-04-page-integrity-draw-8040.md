---
stage: ocr
measure: [judged]
languages: [la, zh, de, en, fr, nl, it, es, bo, he, ar, grc, ko, nah]
scripts: [Latn, Hani, Tibt, Hebr, Arab, Grek, Hang]
canons: []
n_books: 200
n_pages: 200
verdict: "200 random visible books, one served page each, judged by AI reviewers with the image open (2026-11-04). Another leaf's text 2/121 pages with a transcription (1.7%, 0.5-5.8), both read by eye and real; a neighbour's text 0/121 (0-3.1); English not from its transcription 0/67 (0-5.4), with 10 more pages' English already withheld. The toolbar's number differs from the print on 103/108 numbered leaves (95%, 90-98) because it counts scans; no printed number is stored on 73/108 (68%, 58-76); a stored one was wrong on 1/35 (2.9%, 0.5-14.5). Order wrong 0/194 (0-1.9). Two leaves in a frame 7/200 (3.5%, 1.7-7), five of them Tibetan boards. The judge missed 4/38 planted controls by the registered rule and repeated 11/11 flags. n=200 cannot show a fall below about a third of a rate this small."
status: informational
decision: "No bulk alignment repair is justified by this draw alone; keep the repairs under way. The larger reader-facing gap is the number: the toolbar counts scans and two in three numbered leaves have no stored printed number (#4291). Monthly draw on gex45 from 2026-12-01."
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

**Pre-registration (committed in 33ef5b318, before any judge call). Unchanged below, except where the Result says so.**

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

**Result (2026-11-04, seed 20261104, frame 70,942 books, n = 200, AI reviewers).** 121 pages carry a transcription, 67 carry English, 10 more have their English withheld, 36 have a stored printed number. Measure: `judged`, no human reference. Every call's transcript shows every image opened (238 of 238 calls, then 20 of 20 re-asks).

| what a reader meets | k/n | % (95% Wilson) |
|---|---:|---|
| Transcription is a neighbour's leaf | 0/121 | 0 (0–3.1) |
| Transcription is another book's, or from elsewhere | 2/121 | 1.7 (0.5–5.8) |
| No transcription though the leaf has text | 76/200 | 38 (32–45) |
| English renders a neighbour's transcription | 0/67 | 0 (0–5.4) |
| English has no source in the three transcriptions | 0/67 | 0 (0–5.4) |
| Stored printed number differs from the print | 1/35 | 2.9 (0.5–14.5) |
| Leaf has a number and none is stored | 73/108 | 68 (58–76) |
| The toolbar's `p. N` differs from the print | 103/108 | 95 (90–98) |
| Order backward | 0/194 | 0 (0–1.9) |
| Order jumbled | 0/194 | 0 (0–1.9) |
| Two leaves in one frame | 7/200 | 3.5 (1.7–7) |
| One plate cut in two | 0/200 | 0 (0–1.9) |
| A neighbour is the same leaf | 1/200 | 0.5 (0.1–2.8) |

The 76 empty pages are text not yet made, not a misalignment. Of the 200 pages, 85 carry no printed number and on 7 it could not be read. By language group and by repair: `scripts/eval/results/page-integrity/2026-11-04/report.md`. No language has more than one off-leaf page, so the language cut shows nothing but its intervals, apart from the split: 5 of the 7 two-leaf frames are Tibetan boards (5/18 of "other script", 12.5–50.9).

**What it says about the repairs.** A random draw rarely lands in a repaired book: #5021 touched 0 of these 200 books, #5803 one, #5699 none, #5056 four, so the repair cut cannot show whether a repair worked. One of the two off-leaf pages was in a book #5803 already holds. The other was in no repair's scope.

**The judge, both ways.**
- *Misses.* By the registered rule it missed 4 of 38 planted controls (10.5%, 4.2–24.1), and no class fell under the bar, so no rate is marked not settled. Text-leaf controls caught 13/15, English 10/10, order 4/5, two leaves 4/4, stamped number 3/4. Read by eye, only one is a plain miss (order on faded leaves with handwritten numbers). One was flagged under the wrong class, and two were weak controls of my own making (a neighbour holding nearly the same text; a stamp the judge correctly said was not on the leaf). The registered figure stands; a fair reading is lower, on few controls.
- *Over-flags.* 11 of 11 flags repeated on the blind re-ask, and 10 of 10 unflagged pages stayed clean. That is stability, not truth: a judge can repeat its own mistake.
- *By eye.* 7 of the 10 positive pages opened: all 7 upheld. Not opened: 3 Tibetan boards of the same form. 2 unflagged pages opened: both agree. A third picked for this was a map and went unread, so there is no real-page miss rate beyond the planted one.
- 3 pages hold Claude-made text and an Opus judge read them; none was flagged.

**Positives.** Each with its owner; the full record is `by-eye.json`.

| page | what | owner | state |
|---|---|---|---|
| [Greek Grammar of Roger Bacon f.22](https://sourcelibrary.org/book/69ac7fdd6a7dbd267e0cfe15/page-number/22) | stored images run one leaf behind the text in frames 15–17 and 20–22; also the one wrong stored number | #5803 | **contained today**: English withheld on the 6 frames; the book was already held. New to #5803. Frames past 40 not read |
| [69aebfde… f.57](https://sourcelibrary.org/book/69aebfdee997cc01b0cab898/page-number/57) | English plate page with a Russian transcription | #5803 | English withheld 2026-10-18; **the transcription is still served** |
| [Vat. ebr. 635 f.195](https://sourcelibrary.org/book/6ac4f7d2e4016f24bafabc80/page-number/195) | the same page captured twice | #5056, whose pairs come from OCR, so an image-only book is not seen | open |
| 5 British Library Tibetan pages (f.1, 2, 2, 266, 444) | two leaves on one board; 3 not opened | none open (#5132 closed as a map entry) | open |
| [Loeb Cicero f.175](https://sourcelibrary.org/book/6a089ad2c00e102b3bb2395c/page-number/175), [Allard Pierson f.9](https://sourcelibrary.org/book/69b525aa29577f283b57a5f6/page-number/9) | an opening in one frame; the Loeb is kept that way on purpose | none open (#2454 parked) | open |

**What it can and cannot decide.**
- *Alignment.* About 2 in 100 pages with a transcription (0.5–5.8) carry text from another leaf, in line with #5803's 1% of books from its Clef screen. This draw offers no case for a larger repair, and none against finishing those under way.
- *Numbering.* This is where the draw finds most: the toolbar's number is the scan count, so it differs from the print on 95% of numbered leaves. A stored printed number is usually right (1 wrong of 35), but two in three numbered leaves have none. Owner: #4291.
- *Whether it is falling.* A month of 200 will not show it. Telling 2% from 1% takes about 2,300 pages a side, roughly a year of monthly draws pooled. A single month can show a large jump in a defect, not a slow fall. Only 67 of 200 pages carry English, so its interval will stay the widest.

**A method slip in this row, found after the run.** The judge was told it was reading the English shown to readers, but it got the stored model output, notes and tags included (`translation.data`), not the words the reader's parser leaves. On 62 of the 67 pages the two differ; the median page loses 24% of its characters, and the 4 largest cases read by hand lost notes and markup, not book text. One page (slot 149, a photograph of a hand) has only a note, so a reader gets no English there and the real n is nearer 66. The 0/67 was not re-judged. The words a reader gets are inside what the judge read, so the slip should not hide another leaf's English, but that is reasoning, not a measurement. From the next row the script goes through `getTranslationText`, so the judge reads what the reader gets, and a model's note can no longer count for or against a page.

**Limits.** Books count equally, not by readers. A carried sentence is `this_text` by the registered definition, so the small page-edge drift of #5021 is not measured here. One page a book reads a book-level fault once, which is why 6 bad frames in one book count as 1. Withheld English is not judged: of the 10, 1 was withheld for another leaf's text and 9 for lane or stale reasons.

**Changes after registration.** Fixed before the result was read as final, no verdict affected: `withheld` was recorded false on every page (the field is an object, not `true`); a stored language of `de` was grouped apart from German; the `#5021` coverage pattern also matched a `#5803` hold. Added to the report: the "none is stored" row, which the registration did not list.

**Replicated?** No. First run. **Cost.** 258 `claude -p` Opus calls, about 15 s each, on the subscription: $24.61 API-equivalent, no paid API. The dereklomas@ weekly meter moved from 12% to 19% over the run, with this session and other jobs on the box included.

Artifact: `scripts/eval/results/page-integrity/2026-11-04/`. Series: `_series-monthly-page-integrity.md`. Next run: `node --env-file=.env.production.local scripts/audit/page-integrity-draw.mjs --seed <new> --out <dir> --land`; cron on gex45, first of the month, 05:00 UTC.
