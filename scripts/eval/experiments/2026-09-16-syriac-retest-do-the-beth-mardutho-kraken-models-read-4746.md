## 2026-09-16 — Syriac retest: do the Beth Mardutho Kraken models read what Gemini loops on? (#4746 addendum, decides #4883)

**Headline: yes. Against 40 pages of PUBLISHED ground truth (MS Jerusalem SMMJ 36, ÖNB Cod.
Syr. 1) Sophro Mhiro scores 19 % order-free line-level CER and beats lite 40/0; both Gemini
arms are at 74–79 %. On printed editions omnisyr + Qoruyo agree with each other at Dice
0.83–0.96 and match the page by eye where every Gemini version writes loops or fluent
unrelated text. The 09-15 verdict "nothing reads Syriac" stood on Zenodo being down and on
Kraken's default left-to-right line direction; both fixed. 68 % of the corpus's looped Syriac
pages were written by the retired `gemini-3.1-flash-lite-preview` — but re-OCR with current
Gemini does not fix printed Syriac (current lite still loops, current flash fabricates the
running head). Disposition for #4883: a Kraken lane, withhold by page meanwhile.**

- **Question.** sourcelibrary-12 (relaying Derek): trained Syriac models exist — retest before
  withdrawing 41 K served translations. Rule from #4746: engine ≥ 0.6 aligned where lite < 0.3.
- **Design.** External reference, not ourselves: HTR Winter School 2024/2025 GT sets (PAGE XML,
  CC BY 4.0; 20 seeded pages each, ≤ 2400 px). Models: Sophro Mhiro (manuscript ATR, zenodo
  17406773), Qoruyo printed Estrangela 17406703 / Eastern 17406690, omnisyr 8425684
  (Apache-2.0); Kraken 7.1 `segment -bl -d horizontal-rl` + `ocr --base-dir R` (direction is a run
  setting; nothing reversed post hoc). Sophro's segmonto segmenters (17406717/754/766) are
  **truncated on Zenodo itself** — declared size 5,242,880 bytes, our md5 matches theirs, "Wire
  format was corrupt" — so default segmentation. Gemini lite + flash-preview on the same images
  (approved, $1.22 metered incl. 8 printed pages). Two normalisations (N1 punctuation; N2 +
  Syriac points); page CER is order-sensitive and these pages have two text streams, so the
  headline is the order-free line-level CER (best-matching hypothesis line per reference
  line, length-weighted). Printed pages (no e-text): one looped + one clean page from each of
  the four loop-heaviest printed books (from the 2026-09-16 loop scan), agreement + eye.
- **Result (manuscripts, n=40, line CER / Dice / vs lite).** Sophro 0.188 / 0.63 / 40-0
  (Jerusalem 0.17, ÖNB 0.23; 9 pages ≤ 0.20); print models 0.60–0.63 (wrong medium);
  flash-preview 0.74 / 0.17 / 25-12; lite 0.79 / 0.08, loops on 16/40. Eye: Sophro's lines are
  the editors' lines nearly verbatim, in a different order; flash's text is not on the page.
- **Result (print, 8 pages).** omnisyr~Qoruyo-Eastern 0.96, ~Qoruyo-Estrangela 0.83, Sophro~print
  models 0.61–0.67; any specialist ~ current flash 0.19–0.24, ~ current lite 0.07–0.09, ~
  served text 0.06–0.08. *Chronicon Syriacum* p.105: all four specialists read the running head
  ܝܘܒܠܐ .ܝ. ܡܠܟ̈ܐ ܐܪ̈ܒܝܐ (the Arab kings; Hijra dates on the page), flash writes "kings of
  Assyria" with Eastern points on a Serto page, lite loops to 22 K chars. *Kalilah* p.53: all
  four read ܐܪܝܐ ܘܬܘܪܐ and the first line as printed; flash writes an unrelated heading.
  Sealed stratum (28): print-model consensus 0.54–0.85 on the six genuine print pages; the
  six non-Syriac pages are where Gemini agrees with itself and the specialists garble.
- **Who wrote the loops.** 46,705 OCR'd Syriac pages, 2,160 looped: lite-preview 1,465 (68 %;
  11.8 % of its 12,425 pages), current flash-preview 661 (2.1 % of 31,012), lite 33, 2.5-flash 1.
  Chronicon 591/616 pages lite-preview (238 looped); Liber Superiorum 716/744 (189); Kalilah
  474/498 (43). Seven books where current flash still loops ≥ 20 pages (Memre anthology 145,
  Paris Bible 52, Peshitta OT 45, Nomocanon 31, …).
- **Vapour and gaps.** Qoruyo covers Estrangela + Madnhaya print, not Serto (Bedjan's editions)
  — it did not bite on the Serto *Chronicon* page (all four converged) but keep omnisyr in the
  stack and score Serto print against an e-text before routing. Segmonto deposits truncated
  (report to the depositors).
- **Decision (proposed on #4883, Derek's call).** Kraken lane for `language = Syriac`: Sophro for
  manuscript books, omnisyr (+ Qoruyo as agreement arms) for print, RTL flags set; free on
  Hetzner CPU (≈ 3–5 min/page, ≈ 11 days on 8 cores for 42.8 K pages) or ≈ 60 h of L4. Withhold
  by page meanwhile (looped, or model = lite-preview), not by language. Gemini re-OCR would cost
  ≈ $90 batch for the lite-preview pages and buy fluent unrelated text.
- **Replicated?** Sophro on two independent manuscripts (0.17 / 0.23); print agreement on 8 + 6
  pages; k=1 per engine.
- **Cost.** Gemini $1.22 (lite $0.51 + $0.09, flash-preview $0.58 + $0.04); Hetzner CPU free;
  no GPU.
- **Artifacts.** `scripts/eval/results/benchmark/syriac-retest-2026-09-16/` (score.json, score
  table, sealed-agreement, gt-manifest, kraken timings); scripts in
  `scripts/eval/benchmark/syriac-retest/`; raw outputs and models on
  `hetzner:/root/ocr-bench/syriac-retest/` and `images/syriac-gt/out/`.
