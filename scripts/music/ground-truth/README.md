# Music transcription ground truth

Reference transcriptions that a recogniser is scored against with
`scripts/music/eval-transcription.mjs`. Everything here has been checked
against the page image by a human or by a documented letter-for-letter pass;
**drafts never live here** — a draft is a candidate, not a reference.

`manifest.json` is the index: one entry per reference, with the page it
transcribes, the notation system, how it was verified, and the file. Add an
entry when you add a file. The same reference must also exist as a
`status: "verified"` row in `music_transcriptions` (the reader plays from
Mongo; the eval reads from either).

## What counts as verified

- Pitch AND rhythm checked against the scan, not just "sounds right".
- The notes say what was checked and what remains uncertain (a melisma whose
  syllable alignment is a guess is still verified for pitch — say so).
- Unpitched sources (Shaker letteral notation names no key) are verified for
  intervals; the absolute key is a free choice and `interval_ner` is the
  metric that matters for them.

## Answer keys the sources print themselves

Some pages carry their own check. Morley's *Plaine and Easie Introduction*
(1597) prints the solmization syllables under every example, so the
hexachord degree of each note is given in the source's own words
(`sourcelibrary.org/book/69aebe72c0472fef6455ae36?page=14`). A recogniser's
output for those pages can be checked against the printed syllables without a
hand transcription. Entries of `kind: "answer-key"` in the manifest point at
such pages; they are checks, not full references, until someone writes the ABC.

## Coverage wanted (one verified piece per notation system)

| system          | have | wanted first                                               |
|-----------------|------|------------------------------------------------------------|
| letteral        | 1    | more Shaker pieces from the 78 drafts (#3161)              |
| mensural        | 0    | Morley 1597 p.14 examples (printed answer key); Atalanta Fuga I via Furnace & Fugue MEI (#3164, compare-only — CC BY-NC-ND) |
| common-practice | 0    | Fux 1725 or Rameau 1722, one short example                 |
| neumes          | 0    | one antiphon from the 1360 Gradual, against a Liber Usualis reading |
| tablature       | 0    | one lute page                                              |
