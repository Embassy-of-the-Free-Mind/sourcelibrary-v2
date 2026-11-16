<!-- PRIOR ART: ../../second-reader/CALIBRATION-ADDENDUM.md (read after the frozen REVIEWER.md, never edited into it),
which this follows in form. It adds one field for the T10 note-rule test (v3#44): what each note is worth, and where a
note a reader needed is missing (the counter-class, glosses lost). FROZEN for the run: the same text for every packet. -->

## Second addendum for this packet (notes)

Do everything the brief and the first addendum ask. Then add one more field to the page object, `notes_audit`, about the
editorial apparatus in the English: every `<note>` and every `<gloss>`.

```json
"notes_audit": {
  "items": [ { "quote": "first 60 characters of the note or gloss, exactly", "verdict": "ok", "helpful": true } ],
  "missing": [ { "english": "the passage, quoted exactly", "why": "what a general reader cannot follow without a note" } ]
}
```

- `verdict` for each note or gloss, judged against the image and the transcription:
  - `"ok"`: correct, and either drawn from the page or plain knowledge of the words (a gloss, the original wording, a
    clarification the source implies);
  - `"unsupported"`: adds a date, name, work, reference or interpretation the page does not carry and you cannot
    confirm from it, whether or not it may be true;
  - `"wrong"`: says something false about the text, the word, or the world.
- `helpful`: `true` if a general reader of this page would lose something they need if the note were cut.
- `missing`: places where a general reader needs a gloss or a short note to follow the text and the English gives none:
  an unexplained technical term left in the original, a name or allusion the sentence depends on. At most five, the
  most needed first. An empty list is a fine answer.
- A wrong or unsupported note that is serious goes in `tr_errors` too, as the brief says (class T10). `notes_audit`
  does not replace that; it lists every note, good ones included.
