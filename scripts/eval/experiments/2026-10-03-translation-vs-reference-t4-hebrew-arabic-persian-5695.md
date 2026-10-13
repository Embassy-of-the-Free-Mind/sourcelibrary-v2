---
stage: translation
measure: judged_vs_reference
languages: [he, arc, ar, fa]
scripts: [Hebr, Arab]
canons: []
n_books: 52
n_pages: 52
verdict: "Served Hebrew/Aramaic/Arabic/Persian English scores 3.44/5; OCR is the primary cause on 14 of 23 low pages; corrected text +1.4, Flash over Lite +0.53."
status: adopted
decision: "Flash routes Hebrew, Aramaic, Arabic and Persian translation (PR #5740), provisional pending the #5873 top-up"
superseded_by: null
issue: [5695, 5740]
---
<!-- PRIOR ART: 2026-10-03-translation-vs-reference-harness-smoke-5695.md (the harness this run uses, unchanged); scripts/eval/translation-corpus-audit/ (#5274, source-grounded, no reference); scripts/eval/tibetan-mt-ab/ (#4742, Tibetan vs 84000). No earlier run scored Hebrew, Aramaic, Arabic or Persian translations against a published human translation. -->
## 2026-10-03 · How faithful is the served English for Hebrew/Aramaic, Arabic and Persian against published translations, and which lever fixes it? (#5695 track T4)

- **Question.** Against a published human translation of the same page, how faithful is the English readers see now, what causes the bad pages, and which cheap lever helps?
- **Design.**
  - **52 pages, one per book**: Hebrew 15, Aramaic 5, Arabic 20, Persian 12. Our translated pages are Hebrew 55,154 · Aramaic 365 · Arabic 56,626 · Persian 13,755 (census 2026-10-03), so Persian is over-sampled to reach n ≥ 10.
  - Pages were drawn in seeded order per book; an alignment agent took the first one a published translation covers (the first candidate on 37/52). 69 books were tried; 17 could not be aligned (commentary-heavy layouts, no open human translation, or the book is not in the labelled language).
  - References: 47 open (39 public domain, 6 CC-BY, 2 CC-BY-NC), 5 in copyright (scores and ≤ 15-word quotes only). Style: literal 36, free 12, early-modern 4. Canonical (scripture, liturgy, Mishnah/Talmud, Qur'an, Zohar) 12; famous literary classics 10; neither 30. "Sefaria Community Translation" versions were excluded (no named human translator).
  - Harness `scripts/eval/translation-vs-reference/`, two blind Opus judges. Gate passed for both judges in both packets (wrong page 3/3, planted change 3/3 located, duplicate 3/3 tied). Agreement: exact 84% / 87%, within one point 100%, weighted κ 0.91 / 0.94.
  - Arms on the same pages (Gemini, envelope `xlref-t4`, about $1.96 of $8): production Lite twice (noise floor), Flash thinking off, Flash thinking budget 8192, Lite without neighbour context, a Lite negation/role check with one Flash fix pass, and Lite and Flash on a transcription corrected by eye. Opus translated 20 pages as a ceiling (subscription).
  - Image check (addendum 3): the page image was opened for all 23 pages with served fidelity ≤ 3 and for 10 random others; 30 corrected transcriptions were written.
  - A separate pass (one Opus reader, not blind) scored five more dimensions for ours and for the reference.
- **Result — served English.** Fidelity **3.44 (3.19–3.68)** on 1–5; 48% of pages ≥ 4, 12% ≤ 2. Omission on 41% of pages, a reversal of meaning on 16 per 100 pages, plausible text over an unreadable source on 35%.
  - Hebrew 3.80 (3.43–4.13, n 15) · Arabic 3.50 (3.05–3.93, n 20) · Persian 2.96 (2.46–3.42, n 12) · Aramaic n 5, not reported alone (Hebrew + Aramaic 3.68, n 20).
  - Composed before 1000: 3.74 (n 19); 1000–1299: 3.17 (n 24). Scripture, liturgy and law 4.00 (n 10); philosophy, science, history 3.66 (n 19); kabbalah and mysticism 3.04 (n 12); poetry and adab 3.00 (n 11).
  - On 2 of 52 pages the served English is the neighbouring page's text (a one-page shift).
- **Result — cause of the low pages (image opened, n 23).** OCR misread 14 (61%, Wilson 41–78), translation 6 (26%, 13–47), stale served text 2 (9%), reading order 1 (4%). By defect: 92 of 148 judge defects (62%, 54–70) trace to the transcription. OCR is wrong on a median 17 words per 100 on the low pages, 5 per 100 on the random ten. The worst cases are Rashi-type Hebrew (45–60 wrong words per 100), vocalised Arabic, nastaliq lithographs, and verse set in columns.
- **Result — levers.** Noise floor (Lite vs Lite, same settings, temperature 1): fidelity Δ 0.07 (−0.08 to 0.21); 12 of 52 pages move by a point or more; reversals 11 vs 19 per 100 pages.
  - **Corrected transcription: +1.38 (1.08–1.67) for Lite and +1.47 (1.20–1.73) for Flash** on the 30 corrected pages, judged against the corrected text (Lite 2.53 → 3.92, Flash 2.85 → 4.32). Reversals fall from 43 to 12 per 100 pages (Lite) and 38 to 3 (Flash); unreadable-fill from 43% to 8%.
  - **Flash instead of Lite: +0.53 (0.31–0.72)**, above the floor; pages ≥ 4 rise from 44% to 71%. On the uncorrected OCR of the 30 corrected pages the gain is 0.32; on the corrected text 0.40.
  - Thinking (budget 8192, 2,416 thinking tokens per page, 2.6× Flash's cost): −0.01 (−0.22 to 0.20); reversals 12.5 vs 4.8 per 100, inside the floor. **A 2048 budget produces no thinking at all on `gemini-3-flash-preview`** (0 thinking tokens on 52 pages).
  - No neighbour context: +0.04 (−0.13 to 0.21) on fidelity; neighbouring-page text in the English falls from 21% of pages to 4%.
  - Negation/role check plus fix: −0.05 (−0.11 to 0.00). The checker flagged 41 of 52 pages.
  - Opus ceiling, 20 pages: 4.73 (4.48–4.93) against Lite 3.18 and Flash 3.85 on the same pages; no reversals.
- **The instrument's blind spot.** The judges read the transcription as the source. The same Lite outputs on the 30 corrected pages score 3.05 against the OCR and 2.53 against the corrected text (Flash 3.68 and 2.85). The headline 3.44 is therefore fidelity to the transcription and overstates fidelity to the page.
- **Dimension profile, ours / reference (1–5).** Readability 3.4 / 4.1 · register 3.5 / 4.3 · terminology 3.5 / 4.1 · ambiguity 3.7 / 4.0 · transparency 3.4 / 3.5. Ours is labelled a literal crib on 40 of 52 pages; the references are literal 17, balanced 21, free 14. Of 151 places where ours and the reference differ in meaning, the reader judged the reference right in 94, ours right in 32 (on 20 pages), both defensible in 21.
- **Threats.** Canonical pages score 3.83 against 3.33 for the rest. Two pages carry the reference itself in the translator's context and two more a facing Latin or French translation; without all four the mean is 3.39. No reference cut was judged wrong (104 judge-pages: 68 exact, 26 narrower, 10 wider). The set is skewed to texts someone has translated; commentary-heavy pages (Vilna layouts) could not be referenced at all and their OCR is the worst we saw.
- **Side findings.** Five books labelled Arabic or Persian are not in that language on the page (two English translations, one Urdu, one modern Arabic commentary, one modern editor's introduction). The transcription of a faded Vatican Zohar manuscript is largely composed by the model rather than read (#5523).
- **Files.** `scripts/eval/results/xlref-t4-2026-10/`: `pages.jsonl` (one row per page × arm, licences and every arm's text), `references.jsonl` (open reference texts; private ones withheld), `summary.json`, `results.json`, `results-packet2.json`, `dimensions.json`, `image-check.json`, `corrected-transcriptions/` (30), `gallery.md`, `books-not-aligned.json`. Tools in `scripts/eval/xlref-t4/`.
- *Replicated?* No. One run, n = 52; every lever is reported against the A-vs-A floor. The OCR-correction effect is on 30 pages chosen because they scored low (22) or at random (8), so it is the effect on affected pages, not a corpus mean.
