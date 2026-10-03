# Pre-registration: OCR prompt v20 tag wording (#4195)

PRIOR ART: scripts/eval/PREREGISTRATION-ocr-v19-1-stamps.md — same runner and pages; this adds two strata and two arms, it does not replace it.

Written 2026-10-03, before any draw or request. The spec is the v20-candidates comment on #4195:
https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4195#issuecomment-5967637794

## Question

Live v19.1 sometimes returns the wrong page number, names the wrong language, and leaves the sig line's example in place. The v20 rewrite targets four tags. Does it:
- fix page numbers and language,
- keep v19.1's blank-page and show-through gains, and
- avoid costing real pages?

Separately, does dropping the "you are being too cautious" sentence make the model mark what it cannot read, without losing text on clean pages?

## Arms (`gemini-3.1-flash-lite`, Batch, the production request of `ocr-v18-ab.mjs`, k = 3)

| arm | prompt |
|---|---|
| D | v19.1, the live default (`prompts/ocr/standard-ocr-v19-1-candidate.md`, md5 `9d8f959e053491362b2c4acec1e20c9a`, row `6ac02220413a82637da889bb`) |
| D2 | v19.1 again (the noise floor) |
| E | v19.1 + items 1, 2, 4, 6 (wording below) |
| F | E + item 5 |

**E's edits, each applied exactly once (the builder asserts every anchor matches once):**
1. **`<sig>` specimen.** `printer's marks like A2, B1` becomes v17's `printer's signature marks, transcribed exactly as printed on THIS page`. v19.1 already carries v17's de-specimened drop-cap rule, so this is the only specimen left.
2. **`<page-num>`.** The number printed or written on THIS page, exactly as it appears: arabic (123), roman (xiv), or a folio with its side (12r, 12v). Omit the tag if no number is visible. Never work it out from a neighbouring page, the scan order or the book's structure. Never use a chapter, section, plate or signature number.
3. **`<language>`.** The primary language of the page by its standard English name, with examples. Name the language, never the script ("Punjabi, not Gurmukhi"). One language only.
4. **`<script>`.** `printed` = set in type, cut on a woodblock (xylograph), engraved or lithographed. `handwritten` includes text brush-written on pre-printed ruled paper or forms. Line 1 "historical manuscript page" becomes "historical page". The context line "public domain manuscripts (16th-18th century)" becomes "public domain books and manuscripts".

**F** additionally drops the sentence "If you are marking more than ~20% of words as unclear, you are being too cautious."

**Item 3 (splitting `<header>` from chapter titles) is deferred.** It changes body structure and needs its own outcome.

## Pages

| stratum | n | source | outcome |
|---|---:|---|---|
| W, T, S3, S5 | 195 | the v19 run's scored pages (`results/ocr-v19-ab-2026-10/pages.jsonl`, with S5 references), unchanged | the v19.1 clauses, now GUARDS |
| PN | 50 | new draw, one page per book | `<page-num>` exact match |
| LG | 40 | new draw, one page per book | `<language>` resolves and matches the catalogue |

**PN draw.** Seed 4195, `$sample` of visible books with `pages_count` 60–800. Tibetan and Syriac books are excluded.
- Each book's pages run through `pageNumberBreaks` (`scripts/lib/page-integrity.mjs`). Only numberings judged at rate 1, kind arabic or roman, are eligible. Folio numbering is excluded, because "12" vs "12r" is ambiguous on the leaf. Only text pages from the interior 10–90% are eligible.
- **On-line pages (target 30).** The stored tags of p−1, p and p+1 all parse to the same kind and step by exactly 1. The expected value is p's stored value.
- **Misread pages (target 20).** `pageNumMisreads` flags the stored tag as off the book's line ('misread', 'show-through' or 'other-counter'). The expected value is the line's value.
- **Keys are checked by eye before any request.** I open the image of every misread page and of 10 on-line pages. A page whose key disagrees with the printed number is dropped and logged. If more than 2 of the 10 on-line keys are wrong, the on-line rule is suspect, and I check all 30.

**PN score.** A run is correct when `parsePageNum(tag)` has the expected kind and value; a span-2 range counts on its first value. A missing tag is wrong. The page score is the mean over k.

**LG draw.** Same seed. One interior text page per book, with stored OCR over 400 characters. Target books by catalogue `language` (`books.language` starts with the name, visible, `pages_count` > 20):
- non-Latin and ambiguous scripts, 30 pages: Greek 4, Arabic 3, Persian 3, Hebrew 3, Chinese 3, Japanese 3, Sanskrit 3, Punjabi 2, Ottoman Turkish 2, Armenian 2, Church Slavonic or Russian 2;
- mixed-language catalogue labels (containing a comma), 5;
- Latin-script controls, 5: Latin 2, German 2, French 1.

A language with no qualifying books is skipped and logged.

**LG score.** The key is the code set from `toLanguageCodes(books.language)` ∪ `books.languages[]`. Per run:
- `resolved`: the tag maps to at least one code;
- `match`: some tag code `sameLanguage`s some key code;
- `distinct`: the number of distinct raw labels per arm, reported only.

## Outcomes and decision rule

**Floors.** A page counts as better or worse only when |X − D| ≥ that stratum's p90 of |D − D2|. A floor of 0 becomes 1/3 (one run in three), as in v19. Sign tests are two-sided binomial over pages that are not tied.

**E is recommended over v19.1 when all four guards hold and at least one primary passes.**

Guards, E vs D:
- **G1, W ∪ T fabricated.** Not more pages worse than better.
- **G2, S3 false blank.** E ≤ D + 0.05.
- **G3, S5 windowed CER.** The median of (E − D) ≤ max(S5 floor, 0.01).
- **G4, loop.** E's Wilson lower bound ≤ D's Wilson upper bound.

Primaries:
- **P1, PN.** E better on more pages than worse, and sign p < 0.10.
- **P2, LG.** The `match` rate (or the `resolved` rate) is better on more pages than worse, and sign p < 0.10.

If the guards hold and neither primary passes, E is reported as **"safe, not shown to help"**: its wording fixes (items 1 and 6) can ride the next measured change. If a guard fails, the verdict is **"not E"**, naming the failing guard.

**F is recommended over E when:**
- F passes the four guards vs D;
- on S3, F has more pages where the `<unclear>` count per page rose than fell (vs E);
- on S5, the mean `<unclear>` count for F ≤ E + the D-vs-D2 S5 `<unclear>` floor;
- on S5, the median windowed CER of (F − E) ≤ max(floor, 0.01).

Reported, not gating: per-arm `<unclear>` rates on S3, T and S5; PN tag-absent and other-counter rates; LG distinct labels; `<script>` values on PN and LG pages.

## Budget

- **Estimate:** 285 pages × 4 arms × 3 = 3,420 requests at the v19.1 run's measured ≈ $0.00106 per request ≈ $3.6.
- **Cap:** $8. If the build estimate exceeds $8, k drops to 2 for PN and LG only.
- **Metering:** `eval/ocr-v20-tags-4195`.
- **Where it runs:** from the laptop. Nothing is written to `prompts` or `pages`, and no default changes.
