---
stage: ocr
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: 20
verdict: "The self-declared-blank rule flags 166,077 pages corpus-wide but 0 of 20 read by eye are invented text on a blank leaf (Wilson 0-16.1%); use it as a ranking signal, not a quarantine list."
status: informational
decision: "Not used to quarantine; kept as a supporting signal in detect-fabricated-ocr.mjs (PR #5652)"
superseded_by: null
issue: 4149
---
## 2026-10-02 · Does the OCR's own "this page is blank" tag find invented pages corpus-wide? (#4149)

- **Question.** On the confirmed #4149 fabrications, the page's own tags often say it is blank: `<page-type>blank`, or a `<warning>`/`<meta>`/`<image-desc>` reading blank, show-through or mirrored. That holds for 46.6% of fabrications vs 4.7% of `has_ink` controls. Does a rule "tags say blank AND body letters > 20" find the invented pages readers are reading now? That would include show-through leaves, which the pixel guard (#4184) passes.
- **Design.** The rule is `self_declared_blank` in `scripts/audit/detect-fabricated-ocr.mjs --self-declared-blank`. Body = `bodyText` from `blank-page-study.mjs`. Each signal records its word class: `:blank` (blank/empty/no text…) or `:showthrough` (show-/bleed-through, mirror, reversed, offset). The walk covered all 25.58M `pages`, typed `_id` phases, with a server-side regex prefilter: 439,908 prefiltered, 166,077 flagged. It ran in about 35 min. Walk controls: all 41 fabrication pages that the rule fires on were found by the walk. Two independent `_id`-window recounts matched exactly (249/249 and 342/342). Precision used a seeded sample (seed 4149) of 20 per stratum: `page_type_blank`, `tag_says_blank` (blank-class word but not page-type), and `showthrough_only`. All 60 were downloaded and ink-measured (`inkCoverage`, blank-page-guard). A seeded 20 of them (6/7/7) were read by eye by two subagents and labelled white / show-through / real ink, plus whether the stored opening is on the page. Read-only. $0.
- **Result.**

| stratum | flagged | on live books | ink-white (of 20) | by eye: white / show-through / real ink | invented text on a blank leaf |
|---|---:|---:|---|---|---:|
| page_type_blank | 20,174 | 12,432 | 1 (1 unmeasured, HTTP 429) | 4 / 0 / 2 | 0 / 6 |
| tag_says_blank | 9,969 | 7,811 | 0 | 0 / 0 / 7 | 0 / 7 |
| showthrough_only | 135,934 | 102,445 | 0 | 0 / 0 / 7 | 0 / 7 |
| **all** | **166,077** (34,467 books) | **122,688** (20,294 books) | 1 / 59 | **4 / 0 / 16** | **0 / 20 (Wilson 95% 0–16.1%)** |

  - **The four "white" pages are not fabrications.** Their body is a stamp, a shelfmark, a digitiser caption ("Digitized by eGangotri", a ProQuest fore-edge photo), or a correct transcription of a stamp. The one ink-white page was measured only, never viewed. Its body is untagged commentary: "None This page is blank and contains no visible manuscript text". That breaks the output contract, but nothing was invented.
  - **One page had invented text, on a real leaf.** eye17, `rDo rje phag mo'i zab khrid skor` p.10, shows four Tibetan pothi leaves; the stored OCR is a Devanagari *vāstu-pūjā*. That is wrong-script fabrication (taxonomy O2), found by accident. Counting it, any invented text = 1/20 (0.9–23.6%).
  - **By model:** gemini-3-flash-preview 152,515, 3.1-flash-lite-preview 9,455, 3.1-flash-lite 3,972. **By prompt:** v5.2026-02 76,204; v5.1.2026-03 43,428; 12 19,428; v3.2026-02 8,846; v10 6,895; 16 3,127; 15 979. Rows carry these counts; the counts track OCR volume, not a defect rate.
  - **The positive control needed correcting.** Tags alone reproduce the brief exactly: 142/305 = 46.6%. With the body > 20 condition, the rule fires on 41/305. The reason: **139 of the 305 still-held "confirmed fabrications" have ≤ 20 letters outside apparatus tags.** Their prose sits in `<unclear>`/`<insert>`/`<note>` ("[The page contains no original recto text…]"). The August screen's `body()` did not strip those tags, so it counted honest declines as 300-character claims. The meaningful control is 41/166 (24.7%) of fabrications with a body vs 6/261 (2.3%) of controls.
- **Consequences.**
  1. **Do not quarantine on this rule.** A 4.7% control rate looked small, but against 25M pages it yields 166K flags, while #4149 sizes the fabrication population in the hundreds.
  2. The show-through class mostly flags real pages. "Some bleed-through from the reverse" is a routine quality note.
  3. This sample cannot size show-through fabrication (bleed-through leaves with ink above 0.004), because none appeared in 20. If it is to be measured, the narrowest unmeasured cut is `page_type_blank` + a show-through word + ≥ 300 body letters: **679 pages**. A by-eye pass over a seeded 30 of those would bound it.
  4. Use `self_declared_blank` as a supporting signal that ranks the language screen's image checks, the way `repeated_opening` is used. It should not be a candidate list.
  5. About 139 of the 409 quarantine candidates are honest declines, not fabrications. Quarantining them removes harmless apparatus. The tool re-measures ink, so it remains safe, but the 409 headline overstates invented pages.
- *Replicated?* No. The by-eye labels are one reader per image (two subagent batches of 10). The ink measures and the walk are mechanical.
- **Artifacts** (Hetzner, gitignored): `scripts/output/self-declared-blank-2026-10-02.jsonl` (166,077 rows), `.sample.jsonl` (60 rows with ink), `sdb-eye/` (20 images + batch manifests). Sampler: `scripts/eval/self-declared-blank-precision.mjs`.
