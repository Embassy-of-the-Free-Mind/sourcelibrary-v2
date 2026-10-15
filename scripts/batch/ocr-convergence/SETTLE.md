<!-- PRIOR ART: ./SCREEN.md (the question a Gemini screener answered; this brief checks its flag), ./ADJUDICATOR.md
(the meaning of "not on this leaf") and .claude/docs/invariants/containment-on-finding.md (the bar: invented or another
leaf's text, found with the image open). Used by screen-6694.mjs `settle` (#6694 step 3): a sealed Opus reader settles
every page the screen did not call OK. v1. -->

# Leaf-screen settlement brief (#6694) — v1

You are checking machine transcriptions of pages from historical books. For each page there is an image of the leaf,
one transcription, and a flag raised by another reader who looked at the same image. Read the image yourself and
decide whether the flag is right. The flag is a claim to check, not evidence.

## How to work

1. Read `ITEMS_FILE` (a JSON array). Work only inside this folder; open nothing else and no URL.
2. For each item, open `image_file` with the Read tool and look at the whole leaf (columns, marginal notes, headers,
   catchwords). Then read `text`, and the flag: `flag` is one of WRONG-LEAF (the text is another page's), INVENTED (a
   passage in the text is not on the leaf), UNREADABLE (the leaf cannot be read, or is blank and the text is not), with
   `flag_note` saying why.
3. Misread words, letters, numbers and spellings of this leaf's own text are NOT what is asked: a transcription with
   misreadings is still this leaf's text. Tags (`<page-type>`, `<header>`, `<margin>`, `<unclear>`, `<image>`),
   descriptions inside `<image>` tags, layout markup, line breaks, abbreviation expansion and the long s are
   conventions, not passages.
4. Decide `verdict`:
   - `"confirmed"` — the text is not this leaf's text, or a passage, line, column or note in it is not on the leaf
     (invented, another page's, a run of repetition the leaf does not print), or the leaf cannot be read and the text
     claims to read it. Say which in `kind`: `"wrong-leaf"`, `"invented"` or `"unreadable"`.
   - `"not-confirmed"` — every passage of the text is on this leaf (whatever its misreadings).
   `confidence`: `"high" | "medium" | "low"`. `note`: one sentence, quoting what you checked.
5. Write `OUTPUT_FILE` as one JSON array, then reply with one line: the path and the number of items. If a write is
   refused, put the JSON in your reply instead.

```json
[ { "item_id": "…", "verdict": "confirmed", "kind": "invented", "confidence": "high", "note": "Lines 14–22 ('Item de lapide …') are not on the leaf, which ends at 'finis capituli'." } ]
```

Every item gets an entry. Judge each item on its own, from the image. Never invent what the image says.
