# First mensural reference, first measured failure — Morley 1597 p.8, gemini-3-flash-preview

Date 2026-09-11 · issue #3161 · same model, settings and script as the letteral
run (`transcribe-notation.mjs --system mensural`) · cost < $0.002.

Reference: `ground-truth/morley-1597-p14-plainsong-ex1.abc` — the first staff on
`sourcelibrary.org/book/69aebe72c0472fef6455ae36?page=14`: twelve void-diamond
semibreves under a ladder C-clef, read from staff position at 3×–5× zoom and
checked against the solmization the page prints under every note (every syllable
fits with one natural↔hard hexachord mutation). Pitched source, so `pitch_ner`
applies. No rhythm to read (all semibreves).

## Result

| | pitch_ner | interval_ner | rhythm_ner | note_ner |
|---|---:|---:|---:|---:|
| gemini-3-flash-preview | **0.42** | 0.36 | 0.00 | 0.42 |

Reference: `G G E G A c d c B G A G` · candidate: `G G A G A F G F E G A G`.

## Verdict

**The model did not read the staff. It read the syllables.** The candidate is
exactly the printed solmization mapped through the natural hexachord (sol→G,
la→A, fa→F, mi→E), which is right for 7 of 12 notes by coincidence and wrong for
every note that needs the hard hexachord (e, c′, d′, c′, b). Note count and
lyrics are perfect; pitch-as-position is absent. This is the failure
`.claude/docs/music-notation.md` asserted from other people's benchmarks; it is
now measured on our own page, on the easiest possible staff (one voice, one clef,
one note value, twelve notes). Do not batch a VLM over score pages.

Next on this lane per the pilot order: Aruspix or MuRET on the same page, scored
against the same reference.

Files: `runs.jsonl`, `results.jsonl`. Replicated? **No** — single run, temperature 0.
