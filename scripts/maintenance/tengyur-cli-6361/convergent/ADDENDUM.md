<!-- PRIOR ART: scripts/eval/spot-check/REVIEWER.md (the frozen brief, passed verbatim before this; never edited) and
its OVERVIEW-ADDENDUM.md (the pattern: an addendum appended after the brief for a packet that differs). The A/B form
and the reversal flag follow ../results/byeye/BRIEF.md (#6361 step 3). Used by run-readers for the #6361 convergent
check (#6420). -->

## Addendum for this packet (two English versions, one page)

This packet is not a fortnightly run. Differences from the brief above:

- The packet has **one book and ONE page** (a folio of the Derge Tengyur, classical Tibetan, woodblock print). Ignore
  the "5 books" and "run of 3 consecutive pages" wording. Judge the book fields from this one page; `structure` is null,
  so `structure_note` is null unless the page itself shows a problem.
- Instead of one `translation` the page has **two English translations, `translation_A` and `translation_B`**, in
  random order. They are also in `A.txt` and `B.txt` beside the packet. Do not guess which is newer or which engine
  made which; judge each against the Tibetan on the image (and the transcription, `ocr.txt`).
- The page image is `page.jpg` in the packet's directory (a long, narrow folio), with `c1.jpg`, `c2.jpg`, `c3.jpg`: the
  same image in three overlapping 2×-upscaled crops, left to right. **Open the crops and read the Tibetan.** Do not
  judge from the transcription alone. Do not download anything; the files are there.
- Tags such as `<term>`, `<gloss>`, `<note>`, `<meta>` are part of the reader format; judge their content, not their
  presence.
- In each page entry, **replace** `tr_score` and `tr_errors` with `tr_score_A`, `tr_errors_A`, `tr_score_B`,
  `tr_errors_B` (same scale and objects as the brief). On every `serious` translation error add `"reversal": true` if the
  English reverses or negates the claim, or gives a claim to the wrong speaker (objection read as reply, the opponent's
  thesis read as the author's, probans and probandum swapped), else `"reversal": false`.
- Add to each page entry: `"prefer": "A" | "B" | "same"` — which English a reader of this page should be given, judged
  on serious errors first and moderate errors second; `same` when neither is clearly better — and `"prefer_reason"`: one
  sentence.
- `ocr_score` and `ocr_errors` are judged as the brief says; they are the same for both versions.
