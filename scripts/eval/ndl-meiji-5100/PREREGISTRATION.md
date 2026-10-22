# NDLOCR (modern print) vs stored flash-lite on 20 Meiji typeset pages — preregistration (#5100, #4745)

PRIOR ART: `scripts/workers/ndl-koten-lane.mjs compare` (the paired stored-vs-NDL agreement measure this reuses:
character-bigram Dice, loop verdicts, character counts) and the #4745 benchmark, which ran NDL古典籍OCR on 10
Meiji-and-later pages but not NDL's modern-print OCR ("Meiji print is already read by lite").

Committed 2026-10-22 before any NDLOCR read exists.

## Question
Is a second NDL lane (modern print, NDLOCR) worth a scored preregistration for Meiji typeset Japanese? This run is
**descriptive**: it writes nothing to Mongo and makes no quality claim. Neither arm is a reference.

## Pages
`pages.json`: 20 pages from 5 works (7 books' worth of draws were made; the English, cursive, colophon and index
pages were dropped by eye before any read). Frozen; no page is swapped after a read exists. A page whose image does
not fetch is reported as missing, not replaced.

## Arms
- **N**: NDLOCR-Lite (github.com/ndl-lab/ndlocr-lite, the National Diet Library's modern-print OCR, CC BY 4.0),
  pinned to the commit the run records, CPU. (The GPU `ndlocr_cli` is the fallback if Lite will not install.)
- **L**: the stored reading (`ocr.data`, `gemini-3.1-flash-lite[-preview]`), read from Mongo at scoring time; the
  scorer records its `content_hash` so a later rewrite is visible.

## Measures (`score.mjs`)
Per page and pooled: body characters (envelope tags stripped), loop verdict of each arm, character-bigram Dice
agreement, and normalised edit distance between the arms with whitespace removed (an AGREEMENT, not a CER).

## What would make a scored prereg worth writing (fixed now)
Any ONE of:
1. Dice < 0.6 on ≥ 5 of 20 pages (the arms are not two readings of one text there), or
2. L loops or is textless where N reads ≥ 100 characters on ≥ 2 pages, or
3. on the by-eye packet (5 pages, one per work, seeded 5100, read against the image), N is right where L is wrong
   on a span of ≥ 10 characters on ≥ 2 pages.

Otherwise: lite stays the Meiji reader and no second lane is pursued (record and stop).
