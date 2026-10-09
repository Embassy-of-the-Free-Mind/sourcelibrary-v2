<!-- PRIOR ART: REVIEWER.md (frozen fortnightly brief; this is appended after it, never edited into it). The overview
asks a partner-facing question REVIEWER.md does not: is this shelf fit to show a scholar, and which pages would we show.
Used by overview-draw.mjs packets (#6056). -->

## Addendum for this packet (shelf overview)

This packet is not a fortnightly run. Two differences:

- Each book has **4 pages spread across the book** (one per quarter: start, two middles, end), not 3 consecutive pages.
  Judge each page on its own. Ignore the "run of 3 consecutive pages" wording above. A page number below 1 is itself a
  structural finding: say so in `structure_note`.
- The reader in mind is a scholar of this tradition who funds translation. He will open these books and judge the
  library by them. Add these fields to each book object:
  - `fit_to_show`: `"show"` (a scholar would find it sound), `"show_with_caveat"` (usable; say what to warn about), or
    `"do_not_show"`.
  - `showcase_pages`: page numbers from your packet you would open in front of him without apology (may be empty).
  - `reader_summary`: 2–3 sentences on what a reader of this tradition finds when they read this book here: what the
    work is, whether the transcription is of the right text, and whether the English can be trusted. Use plain words
    and no praise.
