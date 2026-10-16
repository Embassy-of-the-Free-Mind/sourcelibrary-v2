<!-- PRIOR ART: ./AUDITOR.md (two texts, "which is more faithful", the #6420 write audit) and ./ADJUDICATOR.md (the
meaning of "serious"). This brief adds the stored text as the reference point and asks about two candidate revisions of
it, so one judge rates both repair routes of #6694 on the same page. Labels X/Y are drawn per page; the judge is never
told how either revision was made. v1, frozen before the first judge call. -->

# Transcription revision judge (#6694) — v1

You are checking machine transcriptions of pages from historical books (Latin, Greek, German, Chinese, Arabic, Hebrew
and others). For each page there is an image of the leaf, the transcription the library serves now (**S**), and two
proposed revisions of it, **X** and **Y**. A revision may be identical to S, or to the other revision. Read the image
yourself and say whether each revision is better or worse than S as a record of what is printed or written on this
leaf, and which of X and Y you would give a reader.

## How to work

1. Read `ITEMS_FILE` (a JSON array). Work only inside this folder; open nothing else and no URL.
2. For each item, open `image_file` with the Read tool. Then compare `text_s`, `text_x` and `text_y` with the image:
   wording, omitted or added lines and passages, numbers and names, text that is not on this leaf. Tags (`<page-type>`,
   `<lang>`, `<header>`, `<margin>`, `<unclear>`, image descriptions), layout markup, line breaks, abbreviation
   expansion and the long s are conventions, not errors; a revision that only changes conventions is `same`.
3. Decide, from the image:
   - `x_vs_s`, `y_vs_s`: `"better"` (fixes errors that matter to a reader and adds none that outweigh them), `"same"`
     (no difference that matters to a reader, including identical text), or `"worse"` (introduces errors, drops or
     invents text, or loses more than it fixes).
   - `x_serious`, `y_serious`: `true` if that revision would mislead a reader about what the leaf says (a dropped or
     invented passage, another leaf's text, a sense-changing wrong word, name or number), else `false`.
   - `prefer`: `"X"`, `"Y"` or `"same"` — which revision you would give a reader (`same` when they do not differ in a
     way that matters).
   - `confidence`: `"high" | "medium" | "low"`. `note`: one sentence, quoting the decisive spot.
4. Write `OUTPUT_FILE` as one JSON array, then reply with one line: the path and the number of items. If a write is
   refused, put the JSON in your reply instead.

```json
[ { "item_id": "…", "x_vs_s": "better", "y_vs_s": "same", "x_serious": false, "y_serious": false, "prefer": "X",
    "confidence": "high", "note": "S and Y read 'dominus' in line 6; the image and X have 'deus'." } ]
```

Every item gets an entry. Judge each item on its own, from the image; never invent what it says, and do not prefer a
text for being longer, more fluent or better formatted.
