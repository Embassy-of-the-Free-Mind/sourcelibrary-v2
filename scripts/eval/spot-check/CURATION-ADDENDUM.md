<!-- PRIOR ART: OVERVIEW-ADDENDUM.md (PR #6079) is the addendum for a RANDOM shelf draw and asks for per-page error
lists that overview-score.mjs turns into rates. This is the addendum for a hand-picked run (`overview-draw.mjs --picked`),
where no rate may be formed, so it asks for one short shelf entry per book instead. Like the overview addendum it is
appended after the frozen REVIEWER.md, never edited into it. The brief the 2026-10-06 Eternity reviewers were given lived
only in that session's Agent prompts; this is that brief written down from the verdict format they returned
(scripts/eval/results/spot-check/curation-2026-10-06-eternity/shelf.json). -->

## Addendum for this packet (hand-picked curation check)

This packet is not a fortnightly run and not a random draw. Someone chose these books because a reader of this tradition
would want to open them. The question is which of them we can put in front of that reader today.

- Each book has **two consecutive pages from the middle of the book**. Ignore the "run of 3 consecutive pages" wording
  above. A page number below 1 is itself a finding: say so, and judge nothing else on that page.
- **Open every page image** (`image_url`) and read the transcription and the English against it, as REVIEWER.md says.
  If you could not read the image (too small, the script is beyond you, the fetch failed), say so in the note and give
  tier 2 at best. Never judge from the text alone.
- Write ONE object per book to OUTPUT_FILE, as a JSON array, and nothing else:

```json
{ "book_id": "…", "tier": 1, "title": "…", "note": "…", "interest": "…" }
```

- `tier`: **1** show (a scholar of the tradition would find both pages sound); **2** show with care (usable, with a
  named weakness); **3** fix first or do not show (text that is not on the leaf, a loop, a missing column, English that
  is not a translation of the page, the wrong work under the title).
- `title`: a short plain title a reader would recognise, with the edition or date in brackets. Use the title page, not
  the catalogue field, when they disagree, and say in the note that they disagree.
- `note`: starts with `SHOW.`, `SHOW WITH CARE.`, `FIX FIRST.`, `DO NOT SHOW.` or `INVENTED.`; then "Checked p.N
  (what the passage is)"; then what matched and the worst thing you found, quoting the source word and the English;
  then ends with `?page=N` for the page to open. Two or three sentences. No praise.
- `interest`: one line on why a reader of this tradition would open this book. It sells the book, not the platform.
- Anything about rights or copyright goes in a separate field `rights_note`, never in `note`: this repo is public.

The verdict covers two pages. It says whether those pages can be shown, not what share of the book is sound.
