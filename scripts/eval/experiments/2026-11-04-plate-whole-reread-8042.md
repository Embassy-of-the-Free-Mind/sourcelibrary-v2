---
stage: ocr
measure: judged
languages: []
scripts: []
canons: []
n_books: 19
n_pages: 93
verdict: "A plate rejoined across the fold needs a new read of the whole image. Flash-low read 93 whole plates; a blind Opus judge with the image found 32 match, 49 minor, 12 wrong. The wrong reads are mostly Cosmographey maps, where Flash fills place names from geography rather than the print. English from the accepted reads: 5 good, 6 minor, 0 wrong (n=11)."
status: adopted
decision: "Wrote OCR on 43 whole plates and English on 35 from no-invention Flash reads, plus 3 Opus reads (Khunrath Emerald Table x2, Geestelyke natuurkunde p66). Held 45 map/plate pages for an Opus re-read (#8042)"
superseded_by: null
issue: 8042
router_evidence: "none — whole-plate pages are not a router-table cell; a repair check of one route (agy Flash-low read, Flash translate) against a blind Opus judge, k/n in the body"
defect_rates: "none — verdicts were match/minor/wrong per page, not per-1,000-word defect counts"
---
## 2026-11-04 · Is a Flash read good enough for a plate rejoined across the fold? (#8042)

<!-- PRIOR ART: 2026-11-04-plate-spreads-cut-8042 found and repaired the cut images; this entry measures the new text written on the rejoined pages. -->

- **Question.** 94 pages across 19 books had a plate or map cut at the fold and now show the whole image again (`scripts/maintenance/restore-plate-spreads.mjs`). The text they kept came from one half. Is a Flash-low read of the whole plate good enough to replace it?
- **Design.** Each read used the whole image. Every image was checked before reading (aspect ratio ≥ 1.18, no stale half). Opus judged every read blind, seeing the whole image: match / minor / wrong, with a list of words that are not printed. The rule for writing: a read is applied only if it is match or minor **and** has no words that are not printed. Two guards came after that (a shared-word floor against the old half-read, and a Hebrew page). English came from the accepted reads, and Opus spot-checked a sample against the image and the OCR.
- **Result (OCR).** First set, 22 pages (Piranesi Carceri + BPH): 13 match, 9 minor, 0 wrong. Second set, 71 BPH pages, 47 of them Cosmographey: 19 match, 40 minor, 12 wrong. **Total 32 / 49 / 12 of 93.** "Wrong" means invented map labels: Flash writes the place names it expects from geography, not the ones engraved.
- **Result (English).** Opus spot check: 2 good / 3 minor / 0 wrong (n=5) and 3 good / 3 minor / 0 wrong (n=6). One translation was held because it contained a stray sentence ("source text is in French rather than Dutch").
- **Written.** OCR 17 + 26 + 3 Opus; English 17 + 18 + 3. Every write went through `cli-ocr.mjs apply` / `cli-translate.mjs apply`, so the old text is in `page_revisions`. Run ids are on #8042. No human-edited page was among them.
- **Held.** 40 judge holds, 5 guard skips, and Piranesi p10 and p42. These keep their old text until an Opus re-read.
- **Caveats.** One judge per read and no second rater. The English sample is small (n=11). For map-heavy books, a Flash read is not safe to write blind.
- *Replicated?* No.
