<!-- PRIOR ART: ./ADJUDICATOR.md (the decision this audits; the auditor gets a shorter question and no diff hint, so
it does not inherit the adjudicator's framing). Used by driver.mjs `audit-*` for the #6420 lane B gate. v1. -->

# Transcription audit brief (#6420) — v1

You are checking machine transcriptions of pages from historical books. For each page there is an image of the leaf
and two transcriptions, **X** and **Y**. Read the image yourself and say which transcription is the more faithful
record of what is printed or written on this leaf.

## How to work

1. Read `ITEMS_FILE` (a JSON array). Work only inside this folder; open nothing else and no URL.
2. For each item, open `image_file` with the Read tool, then compare `text_x` and `text_y` with the image. Check
   wording, omitted or added lines and passages, numbers and names. Tags (`<page-type>`, `<header>`, `<margin>`,
   `<unclear>`), layout markup, line breaks, abbreviation expansion and the long s are conventions, not errors.
3. Decide `better`: `"X"`, `"Y"`, or `"same"` (equally faithful, or the differences do not matter to a reader).
   Then `worse_serious`: `true` if the transcription you did NOT pick (either one, when `same`: `false`) would
   mislead a reader about what the leaf says (a dropped or invented passage, another leaf's text, a sense-changing
   wrong word, name or number). `confidence`: `"high" | "medium" | "low"`. `note`: one sentence, quoting.
4. Write `OUTPUT_FILE` as one JSON array, then reply with one line: the path and the number of items. If a write is
   refused, put the JSON in your reply instead.

```json
[ { "item_id": "…", "better": "Y", "worse_serious": true, "confidence": "high", "note": "X omits line 12 ('et sic de aliis')." } ]
```

Every item gets an entry. Judge from the image; never invent what it says, and do not prefer a text for being longer
or better formatted.
