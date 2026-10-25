<!-- PRIOR ART: scripts/batch/ocr-convergence/correct.mjs (Opus corrects a draft against the image: the reference here
is built the same way, from the drafts), scripts/batch/ocr-convergence/JUDGE.md (X/Y labels drawn per page, judged from
the image, never told which engine), scripts/eval/translation-corpus-audit/JUDGE-PROMPT.md (fidelity 1–5 and its flag
names, kept). Changed: one call yields a full-leaf reference transcription (scored with a metric, not by the judge) and
a fidelity score against the LEAF, not against the OCR, for the #6553 untested-language cells. v1, frozen before the
first judge call. -->

# Untested-language cells judge (#6553) — v1

You are checking machine readings of single pages from historical books in languages whose machine reading has never
been measured (Italian, Korean, Spanish, Russian, Portuguese, Yiddish, Ottoman Turkish, Samaritan Hebrew, Middle High
German, Tamil, Avestan, Purépecha and others). For each page there is an image of the leaf, one or two machine
transcriptions (**X**, and sometimes **Y**; you are not told how either was made), and sometimes an English
**translation** made by a machine from one of the transcriptions.

## How to work

1. Read `ITEMS_FILE` (a JSON array). Work only inside this folder; open nothing else and no URL.
2. For each item, open `image_file` with the Read tool and look at the whole leaf before reading any text.
3. **Reference.** Write your own transcription of everything written or printed on this leaf, in reading order: running
   head, page number, body, marginal notes, footnotes, catchword. Use X (and Y) as drafts if they help, but check every
   word against the image; where the drafts are wrong, write what the image says. Keep the original spelling, script,
   abbreviations and diacritics as printed; do not modernise, translate or expand. Line breaks do not matter. Leave
   out descriptions of pictures. Where a word cannot be read, write `[?]`. Plain text, no tags.
   - If the leaf has no text (blank, a plate, only a picture), set `leaf: "no-text"` and leave `reference` empty.
   - If you cannot read this script or language well enough to transcribe it with confidence, set
     `can_read: "no"` and leave `reference` empty; never guess a reference. `can_read: "partly"` means you
     transcribed it but would not stake much on it.
4. **Each reading** (`x`, `y`): `status` is `"text"` (a transcription of this leaf), `"refusal"` (declines, or says
   it cannot read), `"empty"`, `"wrong_leaf"` (text that is not on this leaf), or `"invented"` (fluent text that does
   not match the leaf's letters, in whole or in large part). `serious`: true if a reader would be misled about what the
   leaf says (a dropped or invented passage, another leaf's text, a sense-changing wrong word, name or number). `note`:
   one sentence quoting the worst spot.
5. **Translation** (only when the item has one). Judge it against the LEAF, through your reference, not against the
   transcription it was made from. `fidelity` 1–5: 5 = a reader of the original would find the same meaning
   throughout; 4 = minor slips (a term, a number, one clause); 3 = a sentence or a list wrong, or a passage garbled but
   recoverable; 2 = substantial parts wrong or missing; 1 = mostly not this page's text, or not a translation. Flags
   (true/false): `omission`, `invention`, `inversion`, `untranslated`, `wrong_language`, `wrong_page`,
   `garble_passthrough`, `truncated`, `repetition` (as in the house rubric: an interpretive note about what IS there
   is not invention; house tags such as `<summary>`, `<note>`, `<heading>` are not content). `inherited`: true if the
   translation's main defect comes from an error in the transcription it was made from. `note`: one sentence.
6. `confidence`: `"high" | "medium" | "low"` for the item as a whole.
7. Write `OUTPUT_FILE` as one JSON array, then reply with one line: the path and the number of items. If a write is
   refused, put the JSON in your reply instead.

```json
[ { "item_id": "…", "leaf": "text", "can_read": "yes", "reference": "…full transcription…",
    "x": { "status": "text", "serious": false, "note": "…" },
    "y": { "status": "text", "serious": true, "note": "drops lines 12–15 ('…')" },
    "translation": { "fidelity": 4, "omission": false, "invention": false, "inversion": false, "untranslated": false,
      "wrong_language": false, "wrong_page": false, "garble_passthrough": false, "truncated": false,
      "repetition": false, "inherited": false, "note": "…" },
    "confidence": "medium" } ]
```

Omit `y` when the item has no Y, and `translation` when it has none. Every item gets an entry. Judge each item on its
own, from the image; never invent what the leaf says, and do not prefer a text for being longer, more fluent or better
formatted.
