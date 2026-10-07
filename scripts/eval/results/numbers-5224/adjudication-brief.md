# Adjudication brief — numbers-5224 (blind reading of printed numbers)

PRIOR ART: scripts/eval/ft-gold-annotator-brief.md (a brief for adjudicating first-translation
claims from catalogue evidence — a different question, no image reading); scripts/eval/results/
en-ocr-ref-5124/digitpack.txt (#5124's number check showed the reader BOTH candidates, A and B,
which primes the choice; this brief is blind by design).

You are reading numbers off crops of scanned book pages (US/UK print, 1800–1930). Each sheet
image stacks up to 8 crops, numbered 1–8 in the yellow strip on the left. Every crop shows one
line of print with its neighbours above and below, and one or two RED boxes.

You are NOT told what any OCR engine read. Report only what is printed.

## For each crop, decide

- **`printed`** — the digits printed inside the red box, digits only, as a string ("1836").
  - If the red box holds a number with punctuation or a suffix ("1819," / "188%" / "1,538"), give the digits
    inside the box only, in order ("1819", "188", "1538").
  - If the box holds no number at all (a word, a letter, punctuation, an ornament, blank): `"none"`.
  - If TWO red boxes are shown, the question is "is a number printed BETWEEN them (on the same line,
    or at the start of the next line if the first box ends its line)?" — give that number's digits, or `"none"`.
  - If you genuinely cannot read it (too blurry, torn, cut off): `"unreadable"`. Use this sparingly and
    only when a careful human with a loupe would also hesitate.
- **`figures`** — `"lining"` (all digits the same height, like modern print), `"old-style"` (3, 4, 5, 7, 9
  descend below the baseline, 6 and 8 ascend), or `"unsure"`.
- **`confidence`** — `"high"` / `"medium"` / `"low"`.
- **`note`** — optional, ≤ 12 words: anything odd (roman numeral, fraction, broken type, ink blot).

Common traps: an old-style 3 and 8 differ in the top loop (3 is open on the left, 8 closed);
1 vs 7 — the 7 has a horizontal bar; 5 vs 6 — the 5 has a flat top; 0 vs 9 — look for the tail.
Look at the ACTUAL glyphs, not what a plausible year would be.

## Output

Append one JSON line per crop to the output file you were given, exactly:

```
{"sheet":"sheet-001","pos":1,"printed":"1836","figures":"lining","confidence":"high","note":""}
```

Every crop on every sheet you were assigned must have a line. Never skip a sheet; never guess a
value you did not see — write `"unreadable"` instead.
