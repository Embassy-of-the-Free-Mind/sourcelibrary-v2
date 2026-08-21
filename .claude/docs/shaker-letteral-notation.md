# Shaker letteral notation → ABC (transcription spec)

Source of truth: the 1852 *Sacred Repository of Anthems and Hymns* explains its
own system in the preface (scan images 6–8 of `sacpository00cant`; pages iv–v).
Secondary literature: Daniel W. Patterson, *The Shaker Spiritual* (1979). The
system is Isaac N. Youngs's "small letteral" notation as printed at Canterbury.
Issue: #3161. Player: `src/components/book/HymnPlayer.tsx`; data:
`music_transcriptions` collection (see `src/lib/music-transcriptions.ts`).

## The system, from the book's own rules (page iv)

**Pitch** is a printed letter a–g. There is no staff-position reading — this is
why AI transcription is viable here and NOT for engraved staff notation (the
Atalanta Fugiens lesson: pitch-as-geometry defeats vision models; pitch-as-symbol
is OCR).

**Duration** is the letter's typography:

| Printed form            | Duration          | ABC (L:1/8) |
|-------------------------|-------------------|-------------|
| Capital with bar `A\|`  | semibreve (whole) | `A8`        |
| Lowercase with bar `a\|`| minim (half)      | `A4`        |
| Plain lowercase `a`     | crotchet (quarter)| `A2`        |
| One underline dash      | quaver (eighth)   | `A`         |
| Two underline dashes    | semiquaver (16th) | `A/`        |

A trailing `·` is a dot (×1.5); a long dash after a letter extends the note; a
`—` under a lyric syllable is a melisma continuation.

**Octave**: "the intermediate note occupies the center line through the tune
(unless when a change in the mi is made), and all those notes contained in an
octave, counting from the medium to the eighth note above it, are placed on a
line above the center." Ascending past an octave → a second line above; the
same mirrored below. So: identify the medium note (stated by the tune's opening
letter on the center line), then each printed line above/below shifts the
letter's octave register up/down relative to it.

**Other marks**: curved arc = slur/tie (slurred group carries one syllable);
`:` columns = repeat marks; `(3` style numerals at the tune head = the mode /
measure signature ("3" = triple time); barlines are printed as in standard
music.

## Conventions for our ABC

- `K:C` with the medium note mapped to a sensible tessitura (the originals are
  unpitched — any comfortable key is faithful; note the choice in `notes`).
- Lyrics in `w:` lines, one syllable per note, `_` for slurred continuations —
  copy spelling from the page verbatim (house quote-integrity rules apply to
  lyrics as much as prose).
- `status: "draft"` until a human (or a verified second pass) has checked pitch
  AND rhythm against the scan. The player labels drafts explicitly.
- Score pitch accuracy and rhythm accuracy separately when evaluating AI
  transcription (pitch is expected near-perfect; rhythm is the risk).

## Anti-goals

- Never AI-transcribe music that has a modern scholarly edition (e.g. the
  Atalanta Fugiens fugues — Brown's *Furnace and Fugue* provides all 50 as MEI
  + recordings, CC BY-NC-ND 4.0). Source those; transcribe only what has no
  modern edition.
