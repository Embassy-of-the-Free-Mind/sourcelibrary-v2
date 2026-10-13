<!-- PRIOR ART: scripts/eval/second-reader/ADJUDICATOR.md (#6338: checks one CLAIM about a page; this one chooses
between two whole TRANSCRIPTIONS of a page) and scripts/eval/spot-check/REVIEWER.md (the meaning of "serious").
Used by scripts/batch/ocr-convergence/driver.mjs (#6420 lane B). The two texts are shown as A and B in an order drawn
per page, so the adjudicator cannot tell which one the library serves now. v1, frozen with the preregistration. -->

# OCR adjudicator brief (#6420) — v1

You are checking transcriptions of pages from a digital library of historical books (Latin, Greek, German, Chinese,
Arabic, Hebrew and others). For each page there is an image of the original leaf and two independent machine
transcriptions, **A** and **B**. They disagree. Your job is to decide, by reading the image yourself, which one a
reader should be given.

## How to work

1. Read `ITEMS_FILE` (a JSON array). Work only inside this folder; open nothing else and no URL.
2. For each item, open `image_file` with the Read tool. Then read `text_a` and `text_b`. `diff` lists the spans where
   they differ (A's words, then B's words), to point you at the places to check; it is a hint, not evidence.
3. Check the differing spans **against the image**, and look for anything either text left out or added (a dropped
   line, a missed column or marginal note, a passage that is not on the leaf). Both texts use the same conventions: tags
   such as `<page-type>`, `<header>`, `<margin>`, `<unclear>`, `<image>`, line breaks and layout markup are not errors
   in themselves. Abbreviations may be kept or expanded, and the long s may be written `s` — not errors either.
4. Decide:
   - `pick`:
     - `"A"` or `"B"` — that text is the more faithful transcription of this leaf, and the other has errors that matter
       to a reader of the text (a wrong word, a dropped or added phrase, a wrong number or name) — more than spacing,
       punctuation or spelling-convention differences;
     - `"both"` — both are faithful; the differences are trivial (spacing, punctuation, line breaks, conventions);
     - `"merge"` — each has errors the other does not, and neither is clearly better as a whole;
     - `"neither"` — both are seriously wrong (see below);
     - `"cannot_tell"` — you cannot settle from the image which reading is right, and the difference matters. Use it only
       when the image genuinely does not decide it (too faint, cropped, too small); say what you could not see.
   - `confidence`: `"high"` (you checked the differing spans on the image and are sure), `"medium"`, or `"low"`.
   - `a_serious`, `b_serious`: `true` if that text would mislead a reader about what the leaf says: a passage, line
     or column dropped; text invented or not on this leaf; another page's text; a model's comment or refusal in place
     of the page; a name, number or word wrong where it changes the sense; a garbled stretch a reader cannot use.
     `false` otherwise.
   - `replace`: `true` only if `pick` is `"A"` or `"B"` **and** giving the reader the picked text instead of the other
     would correct something that matters (not just conventions or punctuation). Otherwise `false`.
   - `a_errors`, `b_errors`: up to 5 short strings each, quoting the text and what the image shows instead
     (`"line 6: 'dominus' — image 'deus'"`). Empty lists if none.
   - `note`: one sentence on how you decided.
5. Write `OUTPUT_FILE` as one JSON array, then reply with one line: the path and the number of items written. If a
   write is refused, put the JSON in your reply instead.

```json
[ { "item_id": "…", "pick": "B", "confidence": "high", "a_serious": true, "b_serious": false, "replace": true,
    "a_errors": ["drops the last 3 lines of the page ('… in saecula saeculorum')"], "b_errors": [],
    "note": "Image ends with three lines A omits; the other spans agree." } ]
```

Every item gets an entry. Judge each item on its own, from the image. Never invent what the image says, and do not
prefer a text because it is longer, more fluent or better formatted.
