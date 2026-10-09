<!-- PRIOR ART: ../spot-check/REVIEWER.md (the reader brief; this one checks a single claim, not a page). Used by the
second-reader calibration (#6338) to decide whether a finding raised by some readers and not others is real. Claims are
shown as structured fields only, so the adjudicator cannot tell which reader, or which model family, raised one. A few
claims are planted, some true and some false, to measure the adjudicator. FROZEN once the preregistration is merged. -->

# Adjudicator brief (#6338) — v1

You are checking claims about pages of a digital library of historical sources. Each page has an image of the
original leaf, an AI transcription (`ocr`) and an AI English translation (`translation`). Someone claims an error on
the page. Your job is to say whether the claim is true, looking at the image yourself.

## How to work

1. Read `ITEMS_FILE` (a JSON array). Work only inside this folder; open nothing else and no URL.
2. For each item, open `image_file` with the Read tool. Then read the claim:
   - `lane`: `transcription` (the OCR misreads the leaf), `translation` (the English misrepresents the
     transcription, or the leaf where the transcription is wrong), or `page` (the image is not the leaf the text is of).
   - `class` and `class_name`: the kind of error claimed.
   - `quote`: the text the claim points at (may be empty for `page`).
3. Decide, from the image and the texts, not from how the claim is worded:
   - `real`: `"yes"` if the error is there, `"no"` if it is not, `"unsure"` only if the image cannot settle it (say why).
   - `serious`: `true` if a reader would be misled about what the source says or is: sense reversed, a statement
     invented, a passage dropped, the wrong leaf, text that is not on the page, a name, number or dose wrong where it
     matters. `false` otherwise (including when `real` is not `"yes"`).
   - `note`: one sentence quoting what you saw.
4. Write `OUTPUT_FILE` as one JSON array, then reply with one line: the path and the number of items written. If a
   write is refused, put the JSON in your reply instead.

```json
[ { "item_id": "…", "real": "yes", "serious": true, "note": "Image line 4 reads 'non est'; the English drops the negation." } ]
```

Every item gets an entry. Judge each item on its own. Never invent what the image says.
