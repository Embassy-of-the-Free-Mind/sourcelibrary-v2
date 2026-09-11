# First measured music-transcription run — letteral, gemini-3-flash-preview

Date 2026-09-11 · issue #3161 · model `gemini-3-flash-preview`, temperature 0,
`thinkingConfig.thinkingBudget` 2048 · script `scripts/music/transcribe-notation.mjs --system letteral`
· scorer `scripts/music/eval-transcription.mjs --batch` · cost **$0.019**
(12,982 prompt + 944 output + 3,176 thinking tokens).

Seven verified references (`scripts/music/ground-truth/`, 180 notes), all from the
1852 *Sacred Repository* (book `6a58f512c6cd8f9871069afb`). Six were verified this
session by a letter-for-letter pass at 2×–4× zoom; the `verified` field of each
manifest entry says what was checked and what is still uncertain. Positive control
run first: the scorer returns 0 on a reference against itself and 0.06/0.04 on a
copy with one pitch and one note changed.

## Result (normalised edit distance — 0 is perfect)

| page | piece | ref notes | cand notes | interval_ner | rhythm_ner | note_ner |
|---:|---|---:|---:|---:|---:|---:|
| 21 | Faithful Witness (first two phrases) | 26 | 18 | 0.44 | 0.54 | 0.96 |
| 105 | Bond of Union | 15 | 15 | 0.21 | 0.20 | 0.87 |
| 170 | Holy Candle | 20 | 20 | **0.00** | 0.30 | 0.30 |
| 190 | My Holy Work | 16 | 15 | 0.07 | 0.69 | 0.81 |
| 99 | Be Ye Holy | 18 | 16 | 0.47 | 0.39 | 0.56 |
| 27 | Gospel Liberty (full page) | 49 | 49 | 0.08 | 0.57 | 0.61 |
| 84 | Paradise (full page) | 41 | 41 | 0.08 | 0.73 | 0.78 |
| | **mean** | | | **0.19** | **0.49** | **0.70** |

`interval_ner` is the pitch metric (the source is unpitched; absolute key is free).
`note_ner` is the joint (pitch, duration) error — the number that says how much of
a draft a human would have to touch.

## Verdict

**Pitch letters: readable. Rhythm: not.** On the five pages where the model read
the right span and the right rows, interval error is 0–0.08 — the July pilot's
"~100% pitch" holds at roughly 92–100% per page. The mean is dragged to 0.19 by
two pages it misread wholesale: p21 (stopped early and dropped the second lyric
line's eight notes) and p99 (a two-row line, where it lost the medium row and
transcribed a different letter sequence). Rhythm error is 0.49 mean — far worse
than the July pilot's eyeballed "85–90%", which was never scored.

Failure classes, in order of weight:

1. **Long group underlines are ignored.** A single dash running under several
   letters (`e e e e d c` on Gospel Liberty, every full bar of eighths) comes back
   as quarters; short dashes under a slurred pair are usually read. This alone
   accounts for most of the rhythm error on the two long pages.
2. **The half-note bar is missed or misplaced** — `|c |c` on Paradise became two
   quarters; the opening `|c` of Bond of Union became a `g`.
3. **Dotted halves collapse** to dotted quarters (`|c·` → `c3`).
4. **Span and row errors** (p21 truncation, p99 row confusion) — pitch is only
   right when the model finds the right letters to read.

The barline-adjacent half-vs-quarter ambiguity the pilot named is present but
minor next to (1).

## What this changes

- The doc's "letteral is OCR" claim survives for *pitch* and fails for *rhythm*;
  `.claude/docs/music-notation.md` now quotes these numbers instead of the pilot's.
- The 73 remaining drafts should be treated as pitch-reliable, rhythm-unreliable:
  a verification pass can trust the letter sequence and must re-read every
  duration. That is still a large saving over transcribing from scratch.
- Next experiment worth running: crop each music line to its own image (the
  underline-coverage failure is a resolution/attention problem — the marks are 2 px
  high on a 3000 px page) and re-score the same seven references. Cheap (~$0.02).

Files: `runs.jsonl` (one row per page: candidate, reference, usage, raw model text),
`results.jsonl` (scorer output). Replicated? **No** — single run, temperature 0.
