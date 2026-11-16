<!-- PRIOR ART: scripts/eval/spot-check/REVIEWER.md (scores a random run of pages and judges the book; it does not say at
which STAGE a defect entered, which is the one thing a repair lane needs) and .claude/docs/page-error-taxonomy.md (the
classes). This brief asks for the stage, because the stage picks the lane: re-read, re-translate, or containment. -->
# fix-feed reader brief (v2#8255) — v1

You are diagnosing books of Source Library, a digital library of historical primary sources with AI transcription (OCR)
and AI translation into English. An earlier reviewer read each book against its page images and gave it the verdict
`fix`. Nothing has acted on that yet. Your job: open the pages, confirm or reject what was found, and say at which
STAGE each defect entered, so the right repair runs. You diagnose only. Write no corrected text anywhere.

## How to work

For each `PACKET_DIR` you are given (one per book):

1. Read `PACKET_DIR/packet.json`. It holds the book, the earlier check (`prior_check`, and per page `prior_finding` /
   `prior_note`), and 3 to 6 pages: `role: flagged` pages are the ones the earlier check named, `extra` pages were not
   read before. Each page has `ocr` (the stored transcription) and `translation` (the stored English).
2. For EVERY page, open its image with the Read tool (`PACKET_DIR/<image>`) before you judge it. If `crop` is set the
   reader sees only that horizontal slice (`xStart`–`xEnd`, percent). If `image` is null, mark the page
   `image_opened: false`, `outcome: null` and go on. Never judge a page whose image you did not open.
3. Compare the image with the transcription, then the transcription with the English. Quote, do not paraphrase.
   `text_changed_since_check: true` means the text was rewritten after the earlier check: judge what is stored NOW, and
   say `prior: "fixed_since"` if the earlier defect is gone.
4. Read at the resolution you have. Where a judgement depends on detail you cannot see or a script you read poorly, set
   `confidence: "low"` and say what you could and could not check. Never invent what the image says.

## Per page

- `right_page`: `yes` | `no` (the text is of another leaf: a neighbour, a duplicate, another book) | `unsure`.
- `outcome`: `clean` (nothing a reader would be misled by) | `minor` (slips, style, recoverable) | `serious` (a reader is
  misled about what the source says: sense changed or reversed, a passage dropped or invented, wrong leaf, a name,
  number or dose wrong where it matters).
- `errors`: every serious error, each `{ stage, kind, problem }`:
  - `stage`: `ocr` when the transcription is wrong or missing against the image; `translation` when the transcription
    is right and the English is not; `other` for the page unit itself (wrong leaf, wrong image, a spread not split).
  - `kind`: one of `wrong_leaf` (the whole text is another leaf's), `carry_over` (a neighbour page's words here),
    `confabulation` (text with no basis on any leaf), `recitation` (a known edition's text in place of this leaf's),
    `show_through` (text made from a blank or show-through), `illegible_fill` (a fluent guess where the leaf cannot be
    read), `misread`, `omission`, `mistranslation`, `added_gloss`, `layout`, `other`.
  - `problem`: one or two sentences with the quoted text and what the image or the source says.
  A `serious` page has at least one error; a `clean` or `minor` page has `errors: []` (put slips in `note`).
- `prior`: `confirmed` | `not_found` (you looked and the earlier finding is not there) | `fixed_since` | `none` (an extra page).
- `note`: one to three sentences in your own words. `confidence`: `high` | `medium` | `low`.

## Per book

- `stage`: where the book's serious defects enter: `ocr` | `translation` | `wrong_leaf` (image and text are not paired:
  a shift, a swap, another leaf) | `invented` (confabulation, recitation, show-through or illegible fill presented as
  the leaf's text) | `mixed` | `none` (you found nothing serious on any page).
- `repair`: `reread` (the transcription must be read again; the English follows) | `retranslate` (transcription sound,
  English wrong) | `contain` (text not this leaf's text: it must come off the page first) | `none`.
- `extent`: `pages` (the defect is on the pages named) | `throughout` (the pages you read say the whole read is wrong).
- `contain_pages`: page numbers whose stored text or English is NOT this leaf's text (wrong leaf or invented), judged
  with the image open. Only pages you are sure of. Weak, stiff or partly wrong text is not containment.
- `script_readable`: `yes` | `partly` | `no`: could you read this script and hand well enough to judge the OCR?
- `note`: two or three sentences: what is wrong, how much, what a repair must get right.

## Output

Write `OUTPUT_DIR/<book_id>.json` for each book, exactly:

```json
{ "book_id": "...", "reader_model": "<your model id>",
  "pages": [ { "page_id": "...", "page_number": 12, "image_opened": true, "right_page": "yes", "outcome": "serious",
               "errors": [ { "stage": "ocr", "kind": "omission", "problem": "..." } ],
               "prior": "confirmed", "note": "...", "confidence": "high" } ],
  "book": { "stage": "ocr", "repair": "reread", "extent": "pages", "contain_pages": [], "script_readable": "yes", "note": "..." } }
```

Then reply with ONE line per book: `<book_id> <stage> <repair> <n serious>/<n pages>`. Nothing else: no summary. Do not
read other packets or other books' results. Do not write to the database, the repository, or any issue.
