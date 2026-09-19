# Experiment log — what we ran, and what it concluded

PRIOR ART: `recommend-experiments.mjs` ranks experiments still *worth running*;
`INDEX.md` lists the scripts that exist. Neither records **what a run concluded**,
which is the thing that evaporates. This is that record.

Append-only, newest first. One entry per *question*, not per invocation. A null
result and a retraction are both first-class entries — the retractions are the
most valuable rows here, because a wrong number that stays uncorrected in a PR
description is how a mistake becomes doctrine.

**Rare-event discipline.** These runs happen a few times a month at most, so
nobody remembers them and nobody will re-read the code. Two lines here when you
finish is the whole mechanism. If you ran something and did not log it, the next
person pays for it again.

**Format.** Date · question · design · result · *replicated?* · artifact.
The replication column exists because of 2026-09-02, below.

---

## 2026-09-19 — Can a vision model read hieroglyphs off a printed edition? (baseline for `scripts/eval/hieroglyph-ocr/`)

**Headline: no — and the benchmark can say so.** `gemini-3-flash-preview`, temperature 0,
thinking off, one request per pair over 38 pairs (10,203 ground-truth signs, Sethe *Urk.* I
autograph + four BM *Hieroglyphic Texts* line-drawing volumes, ground truth from ORAEC):
**median anchored sign error rate 0.78**; 35 of 38 outputs hit the 8,000-token cap and 37 of
38 are flagged `looped` (a 20-sign window recurring ≥ 4 times) — the same degenerate
repetition the #4850 loop gate catches on Latin and Han. Four full outputs read by eye: the
first 30–60 signs are plausible offering-formula openings (𓇓𓏏𓊵𓏙𓁹𓊨 for ḥtp-dj-nsw), then the
model recites. This is recitation, not reading (cf. paper #4916). Cost $0.90 on Hetzner.

**Design.** Pairs and scorer: `scripts/eval/hieroglyph-ocr/README.md`. Controls PASS: ground
truth against itself 0.0 on every pair; against its own shuffle 0.79–0.96 full / 0.54–0.83
anchored. So the instrument separates a page from noise, and the model scores at the noise
level. Sign-count ratio where measurable: 1.1–5.6× over-generation.

**Not shown.** Whether a lite or a Pro model does better; whether masking the printed
transliteration (Urk. I pages carry none; HTBM plates carry none either) matters; whether a
smaller `maxOutputTokens` plus the loop gate turns 0.78 into a usable number. One model,
one prompt. **Replicated?** No — one run, temperature 0.

**Artifact.** `scripts/eval/hieroglyph-ocr/results/flash3-preview-v1/` (38 raw outputs,
`scores.json`, `report.md`). Library findings surfaced by the alignment (mis-catalogued HTBM
volumes, a Helck volume filed as Sethe, an HTBM IV leaf shift) are in the README, not fixed.

## 2026-09-18 — Is PaddleOCR-VL-1.6 an acceptable COST LANE for Chinese pages, decided per observed page class? (#4925 step 1a, #4743) — RESULT

**Headline: on Siku Quanshu brush manuscript (`manuscript-regular`, 69 referenced books,
decision-grade) PaddleOCR-VL-1.6 passes the preregistered non-inferiority rule — median
ΔCER −0.028 (95 % CI −0.036 to −0.014), wins 57 / loses 10 / ties 2 against production
`gemini-3.1-flash-lite`, 0 vs 14 catastrophic pages, lower invention (0.132 vs 0.201), no
loops either side. Cost lane ADOPTED for that class. It is NOT "the better reader" by the
stronger #4743 rule (Δ ≤ −0.05 on 38 % of pages, the rule wants 60 %). Woodblock (14
referenced) and typeset (6) stay directional, no lane decision; woodblock cannot reach 50
from this corpus at one page per book (the prereg's step 1b is a further draw, not run).
Lite's catastrophes are reading-order failures — by eye on 0e588a-p21 lite starts at the
LEFT column of a right-to-left leaf and repeats a line; Paddle reads the columns in order.**

- **Question.** #4743 asked whether Paddle beats lite on "Chinese woodblock"; #4925 found the
  cell was 71 % SKQS manuscript by eye and the 2.0M pages at stake are that class. Prereg:
  `PREREGISTRATION-chinese-ext-4925.md` (cost-lane rule per OBSERVED class; lite-vs-lite repeat
  as noise floor; ≥ 50 referenced pages; no proxy top-ups).
- **Design.** Strata `chinese` (40, sealed 09-13) + `chinese-ext` (80 + 16 spares, sealed
  09-18, seed 47431). Arms on Hetzner: lite, lite REPEAT (`gemini-3.1-flash-lite-b`, same
  settings), flash-preview — 96 + 96 + 96 + 48 pages, $0.346 total, thoughts 0. Paddle on one
  Scaleway L4 (`sl-ocr-gpu-test`, fr-par-1, leased `owner=4925` under the #4909 watchdog):
  paddleocr 3.7.0 / paddlex 3.7.2 / paddlepaddle-gpu 3.2.1 (the 09-15 venv was lost with the
  ephemeral scratch volume; same recipe reinstalled), 96 pages in 630 s GPU, 0 errors; box
  booted 14:19 UTC, stopped 15:03 UTC (44 min, ≈ €0.55), stop confirmed by the Hetzner watchdog.
  References: CBETA + Kanripo via `benchmark-refs.mjs`; 8 textless pages retired for spares
  (draw order, reason recorded in the registry). Scorer, decision (`benchmark-cost-lane.mjs`),
  dashboard (`benchmark-dashboard-data.mjs`, new pooled factor *Script × observed class*).
- **Deviations, all reported.** (1) The title+juan Kanripo lookup found the WORK but not the
  PAGE for 30 pages (a Siku volume's 卷 rarely matches Kanripo's file numbering; plain titles
  carry no juan): `--wide` now lists every juan file of the identified work on its WYG
  (Wenyuange) branch, else master, and takes the best window — same ≥ 0.35 acceptance, no
  proxy. +29 references, all with the same threshold; e.g. 淵鑑類函 "卷四十八" sits in file 053.
  (2) `benchmark-score.mjs` did not list `chinese-ext` as a CJK stratum — fixed before scoring
  (it would have scored Han with the alphabetic normaliser). (3) One arbitrated class file
  (`chinese-ext-5d00b1-p132`) carried `leaf_language: other` against its own note ("a clean
  SKQS leaf"); corrected to `zh`. (4) The lite REPEAT arm at temperature 0 tied lite on 63 of
  65 referenced pairs (identical output token counts, 49,473 vs 49,474) — the noise floor is 0, which satisfies the rule but measures
  determinism, not sampling noise; a real floor needs temperature > 0 or a second day.
  (5) References were built on Hetzner (GitHub was ~100× slower from the laptop that afternoon).
- **Result table** (referenced Chinese-leaf pages, both strata pooled by by-eye class):

  | class | ref pages | median CER Paddle / lite | median Δ [95 % CI] | W/L/T (p) | catastrophic | invention | verdict |
  |---|---|---|---|---|---|---|---|
  | manuscript-regular | 69 (20 + 49) | 0.166 / 0.260 | −0.028 [−0.036, −0.014] | 57/10/2 (p < 0.001) | 0 vs 14 | 0.132 vs 0.201 | **cost lane ADOPTED** |
  | woodblock | 14 (2 + 12) | 0.174 / 0.202 | −0.010 [−0.022, +0.002] | 9/4/1 (0.27) | 0 vs 0 | 0.128 vs 0.129 | directional (n < 50) |
  | typeset | 6 (5 + 1) | 0.313 / 0.314 | 0.000 [−0.005, +0.009] | 2/2/2 (1) | 0 vs 0 | 0.098 vs 0.110 | directional (n < 50) |

  flash-preview (exploratory second reader) on manuscript-regular: median Δ −0.022
  [−0.036, −0.012], 55/4/10, 0 catastrophic — Paddle and flash-preview agree lite is the
  outlier. Contamination check: Paddle's output length tracks flash-preview's page for page
  (no reading beyond the leaf); its best page still misreads the 欽定四庫全書 header as
  金文口屋全書 — an OCR error, not a recitation. 3 pages demoted to proxy by the scorer's
  `ref_mismatch` guard (one a 17,770-char lite loop that the reference builder had windowed).
- **Decision.** Route `manuscript-regular` Chinese pages to a PaddleOCR-VL-1.6 lane (sizing
  issue next: GPU-hours for ≈ 2.0M pages at ≈ 6.6 s/page on an L4 ≈ 3,700 GPU-h ≈ €2.8K, vs
  ≈ $4K at lite's $0.002/page — and lite's 20 % catastrophic rate on this class is the real
  cost). Woodblock: no decision; a woodblock draw of non-SKQS books classified by eye
  (#4925 step 1b) if anyone needs that verdict. Results: `results/benchmark/chinese-2026-09-18.json`,
  `chinese-ext-2026-09-18.json`, `decisions/cost-lane-chinese-2026-09-18.json`; dashboard
  `/platform/admin/ocr-evidence?by=script_class_pooled`. PR #4926.

---
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

## 2026-09-15 — Does any current specialist OCR engine beat flash-lite on our pages? (five strata, one protocol: #4743 #4744 #4745 #4746 #4800, registry #4735)

**Headline: one does, on one script. NDL classical OCR v3 reads Japanese kuzushiji where both
Gemini arms loop or invent (45 cursive pages, one per book: NDL coherent on 10/10 read, 3/3
checked against the image; the two Gemini arms disagree with each other on 28/45) → route the
cursive ≈ 29 % of pre-1868 Japanese to NDL. Everywhere else the ranking is
`gemini-3-flash-preview` > `gemini-3.1-flash-lite` ≥ best specialist: PaddleOCR-VL-1.6 reaches
flash-preview's level on Chinese woodblock (beats lite 18/7, p=0.04, invents less) but not the
issue's +5 pp-on-60 % bar; Kraken greek-cllg ties lite on 19th-c. Greek print (14 pinned pages,
6/7); Calfa Tesseract ties lite on 19th-c. Armenian print only. Syriac is read by nothing we can
measure — Gemini's failure there is fluent recitation or a loop, and the one lead (Sophro
Mhiro emitting real Old-Testament vocabulary once its lines are re-reversed) has no reference to
score against. TongGuOCR is vapour.**

- **Question.** Five preregistered trials (decision rules fixed in the issues before the run):
  does a specialist beat lite by a paired sign test without inventing more — Chinese woodblock
  (PaddleOCR-VL-1.6, TongGuOCR), Greek polytonic (CLLG Qwen3-VL-8B fine-tune, Kraken
  greek-cllg, Tesseract grc), Japanese kuzushiji (NDL classical OCR v3), Syriac + Armenian (Beth
  Mardutho Kraken models, Calfa Tesseract), historical Latin-script print (Kraken CATMuS /
  austriannewspapers, Surya 2, Tesseract).
- **Design.** One page per book, seeded draw, images from our archive at ≤ 2400 px, identical
  for every engine: 10 sealed strata, 370 pages (`scripts/eval/benchmark/*.json`; the file is the
  seal — a redraw against the live catalogue reshuffles; textless or unfetchable pages retired to
  sealed spares in the file). Two reference tiers for real CER (55 pinned ground-truth pages, 120
  Wikisource-proofread pages; house passage aligner). Page-level references for Chinese cut from
  CBETA (full-text search on the page's own read) and Kanripo (title + juan): 29/40, with a
  reference-mismatch guard (no engine within 0.5 → proxy). Three numbers per page: CER (or
  distance to lite), bag-of-words − sequence gap (reading order), invention rate; plus a LOOP
  flag (repeated lines or 3× the other engines' length). Kyūjitai folded before CJK CER.
  **Per-page script class** (typeset / woodblock-regular / woodblock-cursive / manuscript-regular /
  manuscript-cursive / illustration; flash-preview classifier, 10/10 vs eye on the cursive axis,
  recorded as `observed_substratum`) — because the catalogue year is the WORK's date: a "1716"
  Hagakure is a modern typeset reprint, three Rylands "prints" are Syriac manuscripts, 17/20
  "Greek pre-1700" leaves are Latin. Engines: lite, flash-preview (`thinkingBudget 0`), Surya 2
  (vLLM, L4), Kraken 7.1 (CATMuS-Print, austriannewspapers, greek-cllg, Sophro Mhiro), Tesseract
  5.3 (lat, frk, deu, eng+fra, grc, syr, hye, Calfa hye, chi_tra_vert, jpn_vert), PaddleOCR-VL-1.6
  pipeline, NDL classical OCR v3, CLLG Qwen3-VL-8B (2048-token cap), dots.mocr (vLLM; see #4735
  for whether its arm reached the cap).
- **Result (references).** Wikisource Latin n=65: flash-preview 0.7 % median CER (31W/7L vs lite,
  p<0.001), lite 1.1 %, Kraken CATMuS 1.2 % (17/28, n.s. — Bench 2's tie replicated at 13× the
  n), Surya 2 1.6 % (19/21), Tesseract 4.0 %. Wikisource German n=30: flash-preview 0.3 %, lite
  0.6 %, Surya 2.3 % (0/26), Tesseract frk 3.9 %, Kraken austriannewspapers 6.2 % on 14/30. Greek
  pinned n=17: flash-preview 0.1 % (10/1), lite 0.4 %, Kraken greek-cllg 0.5 % on 14 aligned
  (6/7/1, p=1; 4 catastrophic), Surya 0.7 %, Tesseract grc 7 %; Wikisource Greek n=25: lite
  0.4 %, Kraken greek-cllg 0.9 % (1/18, p<0.001), Surya 1.5 % (1/18); CLLG fine-tune 3.3 % on 11/15
  pinned (0/10). Armenian pinned n=9: flash 2.1 % (8/0), lite 3.4 %, Calfa Tesseract
  3.9 % (2/7), stock hye 0/9 aligned. Chinese canon windows n=28: Paddle 0.149 median CER
  (18/7 vs lite p=0.043, invention 0.13 vs 0.16), flash-preview 0.163 (18/4 p=0.004), lite 0.191,
  Surya 0.188 (13/10), NDL 0.250 (7/21), Tesseract 0.73.
- **Result (no reference — distance to lite, catastrophic count, loops).** Latin-script strata:
  flash-preview 0.015–0.045, Surya 0.03–0.06, Kraken 0.06–0.21, Tesseract 0.08–0.19. Japanese by
  script class (155 pages): cursive n=45 lite↔flash 0.63 with 28 > 0.5 and 4 loops each, NDL 0
  loops; woodblock-regular n=84 lite↔flash 0.10, NDL↔lite 0.53 — a convention gap (NDL writes
  kunten and furigana inline), not misreads. Syriac n=20: flash-preview vs lite 0.77, 16 > 0.5;
  every specialist ≥ 0.82; the 1725 Rylands Serto page: lite one line of John 6:32 (recitation),
  flash-preview 448 lines (loop).
- **Reading the pages.** (1) Column splicing is shared by lite and Kraken; Surya, Paddle and
  flash-preview read down the column, and without a reference the gap measure charges the
  correct reader. (2) Surya invents fluently on hard pages ("STATE OF CONNECTICUT" on a 1735 Latin
  title page); Kraken fails loud. (3) Lite reads Kurrent MS and notrgir Armenian; no print
  specialist does. (4) On kuzushiji NDL's output is the book's own text — *Ise monogatari* §4 word
  for word on a kana-zōshi page where flash-preview writes plausible kana and lite loops. (5) On a
  Serto manuscript both Gemini arms fail fluently — name the two kinds, recitation and loop; a
  loop-rate check catches the second at OCR time. (6) Sophro Mhiro (Kraken, default segmenter)
  emits its Syriac lines left-to-right; reversed, they are Old-Testament vocabulary on an Old
  Testament page.
- **Vapour and unreachable.** TongGuOCR: demo page only. Zenodo (Qoruyo Syriac print models;
  Patrologia Graeca ground truth 7296539): 504 for the whole run. Sophro's segmonto segmenters:
  truncated at 5 MiB. CLLG fine-tune: no card, no licence, 100–300 s/page, garbles Greek at the
  word level on 16th-c. type. dots.mocr: incompatible with transformers 5 (vLLM route, #4735).
- **Decision.** Route cursive pre-1868 Japanese (classify first: ≈ 29 % of books) to NDL v3
  (≈ 2–5 s/page on an L4, CC BY 4.0). Adopt no other specialist. Prefer flash-preview over lite
  where budget allows (significant on Latin, German, Greek-pinned, Chinese, Armenian). Paddle is a
  zero-API-cost engine at flash-preview quality on Chinese woodblock — a cost-lane candidate, not
  a quality lane. Put a layout step in front of the recogniser for multi-column and vertical text.
  Withdraw Syriac translations and, until the NDL lane runs, kuzushiji translations from
  "readable" (follow-up issue with the takedown-surface list). Fix `language`/`published` on
  Greek–Latin editions (follow-up).
- **Replicated?** Bench 2's Kraken≈Gemini Latin tie: yes (65 vs 5 pages); Bench 2's Kraken
  greek-cllg≈Gemini on 4 Greek pages: yes on 14 pinned (6/7). Everything else k=1 per engine;
  Gemini k=1 (temperature 0).
- **Cost.** Gemini $3.98 metered (1,680 calls; ≈ $1.5 of it on a first draw re-sealed after a
  determinism bug) + ≈ $0.10 unmetered classifier calls. Hetzner CPU free. Scaleway L4 ≈ 57 h
  ≈ €45: ≈ 2 h work + **43 h idle** after the first Paddle run hung (2026-09-13 → 09-15; the
  session was not woken), then ≈ 6 h of round-2 arms under a dead-man `shutdown -h` and per-arm
  `timeout`, then **≈ 5 h "stopped in place"** — on Scaleway a guest `shutdown -h` keeps the
  instance reserved and billed until the API `server stop`; the session slept through it. Total
  ≈ $52 against the $35 approved / $40 hard stop (the overrun is the idle GPU, twice; round 2
  was separately approved at €5, then up to €100 for the Japanese extension — used ≈ €4 of
  arms). Scratch volume deleted 2026-09-16. Lesson: the dead-man must call the provider's stop
  API, not the guest's poweroff.
- **Artifacts.** `scripts/eval/benchmark/` (10 registries + refs), `scripts/eval/benchmark-{seal,run-api,refs,score}.mjs`,
  `scripts/eval/results/benchmark/*-2026-09-16.json` (per-page rows incl. script class, loop flag,
  agreement matrix), `results/scorecard-outputs-2026-09-13.jsonl` (Gemini arms on both tiers).
  Raw engine outputs: `hetzner:/root/ocr-bench/images/*/out/` (mirror of the L4's before it was
  powered off).
||||||| ddd81573
## 2026-09-15 — Does `gemini-3.1-flash-lite` read early-modern manuscripts and incunables? (#4541) — RESULT

**Headline: no. Flash-preview is better on 11/11 items read. Lite fails catastrophically
on 5 of 7 microfilm manuscripts and on the 1472 Lauer incunable — runaway repetition and
invented words — and degrades QUIETLY on the rest: on 16th–17th-c. roman type it renders
long s as `f` ("quifque… nifi fit doctor vel affeffor" for "quisque… nisi sit doctor vel
assessor"), which is fluent, wrong, and would corrupt every quote, search hit and citation
over those books. This is a pre-spend pilot, not a scored benchmark — see the caveat.**

- **Question.** 18 books had just been acquired for the Forum of Conscience (#4541):
  7 BSB microfilm manuscripts (Gothic cursive, 12th–15th c.) and 11 printed books
  (1472 incunable → 1613 roman type). Production would have sent all of them to
  flash-lite, because `OCR_LITE_ONLY` (`scripts/lib/ocr-routing.mjs`) defaults ON and is
  not overridden on Hetzner — Derek's 2026-09-11 cost measure, "OCR should only be
  flash-lite batch, in the meantime", tied to the $5/day dial. It returns lite *before*
  consulting the carve-out for hard visual decoding, so the #1726 evidence that built that
  carve-out never applies while the flag is on. Question: is lite fit for THIS material?
- **Design.** One **interior** page per book (45 % of the way in, past the microfilm target
  card and front matter). One page per book because pages within a book are one
  observation. Identical image to both arms; production OCR prompt v16 (from the DB, not a
  copy); `temperature: 0`, `thinkingBudget: 0`; arms `gemini-3.1-flash-lite` vs
  `gemini-3-flash-preview`. Judgement is a human reading the Latin, not a metric.
- **Result — manuscripts (7).** Flash better on all 7. Lite: Clm 2756 produced 9,427
  characters of fluent nonsense; Clm 14268 drifted for 22,453; Clm 3773 emitted the word
  "nota" 120+ times (19,230 chars). Where lite looked *fine* it was still wrong — Clm 28673
  silently dropped one column of a two-column list, and Clm 4616 gave "Quae dilecta
  tabernacula tua" where the page reads "Quam dilecta tabernacula tua domine" (Ps. 83:2).
  Flash returned coherent canon law on the same images: the five causes of a cleric's
  transitus ("Necessitas. Utilitas. Humilitas. Cupiditas et Levitas") and 1 Tim. 3:2
  ("sobrius prudens ornatus hospes… non percussor non litigiosus non cupidus").
- **Result — prints (4).** Gothic type is fine on both (Koberger 1498: 7,094 vs 7,735
  chars, both coherent) — consistent with the #4541 B2 pilot, which used flash. But the
  1472 Lauer incunable broke lite completely (17,615 chars of noise vs 1,778), and **both**
  16th–17th-c. roman-type books (Plantin 1569, Cardon 1613) came back from lite with long s
  transcribed as `f` throughout, while flash normalised it correctly. Gothic print being
  safe does not generalise to roman print.
- **A cheap detector falls out of this.** Lite's failures are 2.4–9.9× longer than flash on
  the same page (22,453 and 19,230 vs a 3,778–5,612 flash range), while its successes sit
  at 0.8–1.0×. An output-length or arm-ratio guard separates the two populations with no
  human in the loop. Noted as a candidate; **not built** — and note it catches the runaway
  class only, not the long-s class, which is the more dangerous of the two precisely
  because the output length looks normal.
- **Cost.** At the measured output sizes, batch: flash-preview ≈ $0.00197/page vs lite
  ≈ $0.00098/page — about **$3.70 more across the 3,766 manuscript pages**. The quality
  difference here is close to free.
- **Caveat, stated plainly.** n = 1 page per book, 11 books, no reference transcription,
  and the verdict is a human read rather than a scored metric. It is decisive for THIS
  material class (early-modern manuscript and incunable, Latin) and is **not** a general
  claim about flash-lite, which the 2026-09-14 Chinese A/B above found perfectly
  competitive on a different corpus.
- **Action taken.** The 18 books were held (`scripts/lib/pipeline-hold.mjs`, reason
  `lite-ocr-unfit-4541`), 16 in-flight lite jobs cancelled before any page was written, and
  the set re-submitted with an explicit `model: gemini-3-flash-preview` override. The
  global `OCR_LITE_ONLY` policy was left alone — that is a corpus-wide cost decision, not
  this run's to make.
- *Replicated?* **No.** Single run, both arms one call each. The extreme failures (runaway
  repetition) are the kind that vary between calls; re-running would sharpen the rate but
  not the direction.
- **Artifact.** `scripts/eval/_tmp-forum-microfilm-pilot.mjs` (throwaway, uncommitted);
  raw arms in `scratchpad/pilot.json` and `scratchpad/pilot-prints.json`; the full read
  transcripts and the per-item table are in the #4541 issue comment of 2026-09-15.

---

## 2026-09-14 — Which model should translate classical Chinese? (樂舞 preview pages, SIX arms) — RESULT

**Headline: no arm displaces `gemini-3.1-flash-lite`. `gemini-3-flash-preview` is the
only arm that beats lite blind (31 W – 16 L – 13 T, p = 0.040) and it costs 2.2×, so
the pre-registered rule keeps lite. The Chinese-lab arms are cheaper but write LESS:
DeepSeek v4.1-flash leaves 16 % of the page in Chinese (12/60 pages > 20 % untranslated)
and emits no house-format notes at all; Qwen3.8-flash is the worst-ranked arm and
invents tags on 0.8 tags/page. And the judge's own test-retest is 52 % — a coin flip —
so read every ranking here as weak.**

- **Question / design.** As pre-registered below. Same n = 60 pages / 60 books, same
  production prompt v13 (hash 51651014…), no thinking, no previous-page context. Six arms
  delivered: lite (baseline), gemini-3-flash-preview, gemini-2.5-flash,
  deepseek-v4.1-flash, qwen3.8-flash, deepseek-v4-pro-0813 — 60/60 each except
  deepseek-v4-pro (59, one empty reply). $0.62 spent on translation, judging on subscription.
- **Skipped, recorded not failed.** `z-ai/glm-5.3-flash` and `qwen/qwen3.8-max-0902`
  refuse `reasoning.enabled=false` ("Reasoning is mandatory for this endpoint", HTTP 400);
  a reasoning-on run of both was delivered ($0.86) and is preserved UNJUDGED in
  `results/translation-model-ab-zh-arms-reasoning-excluded.jsonl` — judging it would have
  compared a thinking model against five non-thinking ones. `gemini-2.5-flash-lite`: HTTP 404,
  closed to new users.
- **Primary (blind ranking, 60 pages, 6 labels/page, fresh shuffle seed 20260914).**
  Mean rank / first place: preview 2.30 / 28, deepseek-v4.1-flash 2.85 / 26, lite 3.07 / 19,
  deepseek-v4-pro 3.37 / 21, 2.5-flash 3.45 / 17, qwen3.8-flash 3.60 / 12. Sign test vs lite:
  preview 31–16–13 (p = 0.040), deepseek-v4.1 28–18–14 (p = 0.184), deepseek-pro 24–26–9
  (p = 0.888), 2.5-flash 21–31–8 (p = 0.212), qwen 20–30–10 (p = 0.203).
- **Co-primary (fabrication).** deepseek-v4.1 14, deepseek-pro 16, preview 21, lite 22,
  2.5-flash 28, qwen 31 of 60. Eligible (refusals ≤ lite + 4 AND fabrication ≤ lite's):
  preview, deepseek-v4.1, deepseek-pro. **A low fabrication count is not free here** —
  deepseek-v4.1 writes 378 fewer chars/page than lite, emits 0.00 notes/page against lite's
  0.93, and leaves 16.4 % of the page as untranslated Chinese (lite 0.3 %): it asserts less
  because it says less, and its omission count is higher (16 vs 13).
- **Judge reliability (second pass, 20 pages, labels re-shuffled).** Arm-vs-lite direction
  agreed on 52/100 comparisons (**52 %**, chance ≈ 50 %); same first place 14/20; mean
  Spearman ρ 0.50; fabrication flags identical 86/120 (72 %). The three-arm read below put
  preview at 27–26 (p = 1.000) on the SAME translations; this six-arm read puts it at 31–16
  (p = 0.040). That swing between judging passes, not a change in the models, is the finding
  to carry: **a Sonnet judge cannot carry a p-value on this task at this n.** Fabrication
  flags and the mechanical measures are the sturdier signal.
- **Reference-free (per delivered page).** Untranslated CJK share: preview 0.000, lite 0.003,
  2.5-flash 0.050, qwen 0.057, deepseek-v4.1 0.164, deepseek-pro 0.197 (pages > 20 %
  untranslated: 0 / 0 / 5 / 5 / 12 / 13). House format: notes/page 1.13 preview, 0.93 lite,
  0.62 2.5-flash, 0.37 qwen and deepseek-pro, 0.00 deepseek-v4.1; invented tags/page 0.00
  lite and preview, 0.82 qwen. `verified-note rate` stays a citation-FORMAT measure (preview
  writes pinyin), not a fabrication measure.
- **Cost, measured (realtime; Gemini batch halves it).** $/page → 樂舞 20K pages:
  qwen3.8-flash $0.0005 → $11, deepseek-v4.1 $0.0010 → $19, 2.5-flash $0.0012 → $24,
  **lite $0.0017 → $34**, deepseek-pro $0.0024 → $48, preview $0.0037 → $73. OpenRouter arms
  are provider-reported charges; Gemini arms are list price × tokens.
- **Recommendation (rule applied as written).** Run 樂舞 on `gemini-3.1-flash-lite`. The rule
  recommends the cheapest arm that beats lite at ≤ 2× its price; preview beats lite but costs
  2.2×, and lite's fabrication gap over it is 1 page, far under the 5-page override. Named but
  NOT recommended: deepseek-v4.1-flash is cheaper (0.6× lite) with a better mean rank and lower
  fabrication at p = 0.184 — its untranslated residue disqualifies it for production as-is,
  but a residue-fixing prompt tweak plus a stronger judge is the run that would settle it.
- **What would change the answer.** A judge with real test-retest (a stronger model, or two
  independent judges per page with disagreements adjudicated) before any preview-vs-lite call;
  n = 60 is powered for a large effect only.
- **Replicated?** Partly, and it did NOT replicate: three Gemini arms were judged twice
  (three-arm read below, six-arm read here) and the preview-vs-lite verdict flipped from
  p = 1.000 to p = 0.040. Treat both as one weak read, not two.
- **Artifact.** `results/translation-model-ab-zh-report.md` (+ .json, arms, score, packets,
  keys, verdicts ×2; the three-arm pass kept as `…-3arm-judge-{key,verdicts}*`); harness
  `translation-model-ab.mjs`; judge prompt `translation-model-ab-JUDGE-PROMPT.md`.

---

## 2026-09-13 — Which model should translate classical Chinese? (樂舞 preview pages) — RESULT (three arms; superseded by the six-arm read above, which re-judged these same translations)

**Headline: on 60 Chinese pages, `gemini-3.1-flash-lite` and `gemini-3-flash-preview`
are indistinguishable to a blind judge (27 : 26, p = 1.0) at 2.2× the price;
`gemini-2.5-flash` is worse (17 : 33, p = 0.033, 5/60 pages > 20 % untranslated).
Lite stays the route. The Chinese-lab arms were NOT run (no OpenRouter key) and
`gemini-2.5-flash-lite` is closed to new users (HTTP 404) — both recorded as skipped.**

- **Question / design.** As pre-registered below (same-day entry). n = 60 pages / 60
  books, production prompt v13 (hash 51651014…), no thinking, no previous-page
  context. Three Gemini arms delivered 60/60 each, zero refusals, $0.39 total.
- **Primary (blind ranking, 60 pages).** Mean rank lite 1.73, preview 1.72,
  2.5-flash 2.23; first place 29 / 32 / 15. Sign test vs lite: preview 27 W – 26 L –
  7 T (p = 1.000); 2.5-flash 17 – 33 – 10 (p = 0.033).
- **Co-primary (fabrication flags).** lite 19, preview 23, 2.5-flash 27 of 60 — no
  arm is eligible under the rule (fabrication ≤ lite's), so the rule returns lite.
  Paired: lite-only 14, preview-only 18, both 5, neither 23. The absolute rate is
  high because the judge flags ANY unsupported gloss or meta-note (e.g. an invented
  author in `<meta>`, an unsupported "Coromandel" gloss for 西洋); the ORDER is the
  signal, and it favours lite weakly.
- **Judge reliability (second pass, 20 pages re-shuffled).** Arm-vs-lite direction
  agreed 24/40 (60 %); same first place 11/20; mean Spearman ρ 0.42; fabrication
  flags identical 39/60. **The judge cannot reliably separate lite from preview**;
  it does separate 2.5-flash (omission 17 vs 9, untranslated residue 5 % vs 0.3 %).
  n = 60 is powered for a large effect only — read "no large difference", not "equal".
- **Reference-free.** Preview writes 9 % more prose and leaves 0 CJK residue; lite
  0.3 %; 2.5-flash 5 % (5 pages > 20 % untranslated, tables left as raw Chinese).
  `verified-note rate` 0.79 / 0.02 / 1.00 is a citation-FORMAT artefact: preview
  writes `original: "Zuo Zhuan"` in pinyin, which the verbatim verifier cannot
  match; it is not fabrication (instrument note now in the report).
- **Cost, measured.** $0.0017 / $0.0037 / $0.0012 per page realtime → 樂舞 20K pages
  ≈ $34 / $73 / $24 (batch halves it).
- **Recommendation.** Run 樂舞 on lite. What would change it: an OpenRouter key on
  Hetzner (`--run` resumes; the DeepSeek/Qwen/GLM arms cost ≈ $1.55) and a judge with
  better test-retest (a stronger model, or two independent judges per page) before
  trusting any preview-vs-lite call at this n.
- **Replicated?** No. k = 1 per (page, arm); judge pass 2 is the only repeat.
- **Artifact.** `results/translation-model-ab-zh-report.md` (+ .json, arms, score,
  packets, keys, verdicts ×2); harness `translation-model-ab.mjs`; judge prompt
  `translation-model-ab-JUDGE-PROMPT.md`.

---

## 2026-09-13 — Which model should translate classical Chinese? (樂舞 preview pages, N-arm) — PREREGISTRATION

_Written before the paid run; the result entry goes above this one when it exists.
Handoff: ops repo `handoffs/2026-09-13-zh-translation-model-ab.md` (+ amendment); research:
ops repo `docs/improvement-research-2026-09-11-data/trackA3-chinese-translation-models.md`._

- **Question.** The 136 ritual-dance (樂舞) books (~20K pages) await full translation.
  Production routes all non-BPH translation to `gemini-3.1-flash-lite` (#4762) on price,
  not on any Chinese measurement — none exists (only OCR numbers). Which model, among
  the cheap Gemini tiers and the Chinese-lab models, gives the most faithful English per
  dollar on THESE pages? Derek: "is it best to use flash-lite on chinese or qwen or
  another model, do we know?" / "doesn't need to be qwen — could be deepseek or another
  chinese model".
- **Design.** Paired over arms, SAME production translation prompt (whatever
  `is_default` resolves to; no v15 arm — a model comparison, not a prompt one), no
  thinking (`thinkingBudget: 0` / `reasoning.enabled=false`), no previous-page context.
  **n = 60 pages from 60 books, one page per book**, interior (page_number > 3), ≥ 150
  CJK chars of `ocr.data`, drawn by seeded shuffle from the 136-book list
  (`results/translation-model-ab-zh-books.txt`; sample pinned in `-sample.json`).
  Harness `scripts/eval/translation-model-ab.mjs`.
  Arms (baseline first): `gemini-3.1-flash-lite`, `gemini-3-flash-preview`,
  `gemini-2.5-flash`, `gemini-2.5-flash-lite`; via OpenRouter (`OPENROUTER_API_KEY`):
  `deepseek/deepseek-v4.1-flash`, `qwen/qwen3.8-flash`, `z-ai/glm-5.3-flash`,
  `deepseek/deepseek-v4-pro-0813`, `qwen/qwen3.8-max-0902`. **An arm whose key is absent
  is recorded as SKIPPED — a result, not a failure** (no OpenRouter key exists on Hetzner
  as of writing; a later `--run` with the key adds those arms without re-spending).
  Every arm is written to `-arms.jsonl` with refusals kept as rows.
- **Primary outcome.** Blind RANKING of all delivered translations per page by Sonnet
  lean-worker judges (labels T1..Tk shuffled per page, key in a separate file; ties
  allowed as grouped ranks; ≤ 3 pages per dispatch, ≤ 8 concurrent; prompt
  `translation-model-ab-JUDGE-PROMPT.md`: fidelity → omission → term consistency →
  readability last). Per arm: mean rank; **vs baseline: pages ranked above lite minus
  pages ranked below, exact two-sided sign test.**
- **Co-primary.** Judge fabrication flag per arm (something asserted the Chinese does
  not say — the disqualifier for classical text). Also omission and terms-ok flags.
- **Secondary.** Refusals per arm (HTTP error / blocked / RECITATION-class finish /
  empty body) as a ROW, never dropped; reference-free table per arm —
  `scoreTranslation` fields (notes emitted, verified-note rate, inline terms, invented
  and housekeeping tags, glossary blocks), English chars per CJK char, untranslated CJK
  residue share of the prose (citations inside `<note original>`/`<term>` excluded),
  pages > 20 % untranslated; measured $/page per arm (OpenRouter's reported charge
  where available, list price otherwise). Second judge pass over the first 20 pages,
  labels re-shuffled: arm-vs-lite direction agreement, same-first-place rate, mean
  Spearman ρ, fabrication-flag agreement.
- **Decision rule (fixed now).** *Eligible* = refused at most 4 more pages than lite
  AND fabrication-flagged on no more pages than lite. *Beats lite* = eligible AND ranked
  above lite on more pages than below AND sign-test p < 0.05. Recommend the CHEAPEST
  arm that beats lite and costs ≤ 2× lite per page; a dearer winner only if lite is
  fabrication-flagged on ≥ 5 more pages than it. If nothing beats lite: **lite**, unless
  a cheaper eligible arm has a mean rank at least as good as lite's (p ≥ 0.05) or an
  arm leads lite at p < 0.2 — then **undecided**, and the report names the run that
  would settle it (120 more pages, ≈ the two arms' $/page × 120). n = 60 is powered
  for a large effect only (sign test 60 pairs detects ~65:35); a null is "no large
  difference", not "equal".
- **Cost cap.** `--max-usd 2` enforced by the harness (`--dry-run` prints the estimate
  and exits 2 above it). Estimate for the four keyed Gemini arms: $0.58; all nine arms
  would be ≈ $2.13, so the OpenRouter arms are a second `--run` under their own cap.
  Nothing is written to Mongo; the 136 books stay at preview posture.
- **What would falsify the premise.** If lite is not last on fabrication and no cheaper
  arm ties it, the price-list routing was right for Chinese and the 樂舞 run goes to
  lite unchanged.

---

## 2026-09-12 — Does translation prompt v15 (#3825) make original-notes real?

**Headline: the verbatim rule works — verified-note rate 66.7% → 96.3% while
writing MORE notes — but v15 also suppresses interpretive notes by a third, and
the blind judge caught it. Not flipped; v16 = v15 + one sentence.**

- **Question.** v15 carries all five #3825 items; item 2 says the phrase inside
  `<note>original: "…"</note>` is copied character-for-character from the OCR
  or the note is omitted. Does it cut fabricated citations (12.2%, #3308)
  without gaming the metric by falling silent, and without losing content?
- **Design.** Pre-registered (`PREREGISTRATION-translation-prompt-v15.md`).
  Paired, one page per BOOK, 8 strata × 40 = 320 pages, both arms on
  `gemini-3.1-flash-lite` (flat, Derek's call — the full-flash routing rests on
  OCR evidence; #4759). Verifier = `scripts/lib/page-terms-parse.mjs`, the
  build-page-terms one. Blind 30-pair Claude judge on loss. $1.26.
- **Result.** Criteria 1–3, 5 pass: Δ +28.9 pp (CI [+14.7, +44.7]), sign test
  13–0; original-notes/page 0.42 → 0.77; invented tags −95%, housekeeping
  leakage −91%, inline terms +22%. Hebrew went 8% → 93% verified, Arabic
  29% → 100%: on those scripts v13's citations were mostly fabricated.
  Criterion 4 (body −26%) FAILS as written but is two v13 runaway loops
  (MAX_TOKENS, 96K/138K chars) that v15 refused with `<warning>`; excluding
  them −0.3%. Criterion 6 FAILS: judge 8:1 against v15 — 4 are running
  headers not reproduced (item 4 by design), 3 are interpretive notes not
  written. Corpus-wide interpretive notes fall 1.27 → 0.81/page, every
  stratum. The "omit the note" clause is being read beyond `original:`.
- **Replicated?** No. k=1 per (page, arm), one run.
- **Two instrument lessons.** (a) `<[^>]+>` as a tag stripper eats prose
  between `->centred<-` markers — fixed, control added. (b) A mean body
  length cannot carry a runaway-loop failure; `prompt-ab.mjs` said so in
  September and the plan did not inherit it. Amendment 1, prospective.
- **Artifact.** `results/translation-prompt-v15-report-2026-09-12.md` (+ .json,
  arms, judge packet/key/verdicts), PR #4758. v15 row stays `is_default:false`.

---

## 2026-09-12 — Can flash-lite text-only cleanup rescue rejected Internet Archive OCR?

**Headline: no lane. It raises agreement a little everywhere, lifts no rejected book over
the 0.85 gate, costs 86% of re-reading the image, and invents where the input is unreadable.**

- **Question.** `ia-ocr-ingest.mjs` (#4727, #4763) takes the Archive's free ABBYY text where it
  agrees ≥ 0.85 with our Gemini pages; 741 English books (136K pages) fail. Their errors look
  systematic (long s → f, broken words). Can `gemini-3.1-flash-lite`, text in / text out, no
  image, thinking off, push them over the gate cheaper than image OCR?
- **Design.** 10 books × 6 interior reference pages (pages with both IA text and Gemini OCR),
  two per agreement band from the dry run plus the two long-s probes at leaf offset −1. Word-
  sequence agreement with the Gemini reading before and after cleanup; length ratio to catch
  additions/deletions; three pages adjudicated by eye against the scan.
- **Result.** Median agreement before → after: ≥0.90 band 0.916 → 0.939; 0.85–0.90 band
  0.895 → 0.935; magazine title/index pages 0.612 → 0.617; Van Helmont 1662 0.669 → 0.755;
  1801–1803 long-s 0.700 → 0.775. 48/60 pages improved, 1 worse. Cost $0.076 = $0.00127/page
  (615 output tokens/page) vs $0.00148 measured lite-batch image OCR. Two of 60 pages changed
  length by more than 25%: an index page came back 1.98× longer with 7 of 8 author names
  fabricated (page says R. D. Mussey, H. W. Compton, Thomas L. Greene; model wrote John G.
  Nicolay, M. G. van Rensselaer, William L. Greene); on the Oriatrike title page the ink-blotted
  "Toparch or Governor" became "Lord of". Where the cleanup was right (Cabiri p.286: Areas →
  Arcas, Fejla → Vesta) the image reader had already been right.
- **Replicated?** No — single run, 60 pages. The cost figure is the load-bearing one and is
  arithmetic on token counts, not a sample.
- **Artifact.** `ia-ocr-cleanup-exp.mjs`; `results/ia-ocr-cleanup-2026-09-12.{jsonl,log}`
  (page triplets IA / cleaned / Gemini with scores and image URLs). Blog: `/blog/free-reading`.

## 2026-09-11 — Google Cloud Vision as a cheaper OCR lane?

**Headline: no lane. Parity on the pages it reads, but it reads fewer of them —
and on Tibetan it is the worst engine we have tested on our own scans.**

- **Question.** Cloud Vision DOCUMENT_TEXT_DETECTION is $1.50/1K pages against
  $3.42/1K measured on flash realtime and $0.85/1K on lite batch; BDRC's Tibetan
  leaderboard ranks it 3rd of 46. Is it a viable cheaper lane for any of our
  languages, and is its failure mode "garble, not invent"?
- **Design.** All 55 pinned ground-truth pages (the July v0.3 set plus the
  September Latin/Greek/German additions), per-page language hints, same
  `scoreAgainstReference` + normalisation as the July post, paired per page
  against the stored `gemini-3-flash-preview` and `gemini-3.1-flash-lite` runs
  (page = mean over aligned runs, exact sign test). Positive control: the
  Copernicus reference passage rendered as a clean modern page → **CER 0.00 %**.
  Plus 20 pages of the #4523 pilot book (`69e7abd05f1a22ab19a9e929`) scored on
  Derge identity with `kanjur_align.py` on clawdbot against the three Tibetan arms
  already on disk. 78 Vision units, $0 (free tier).
- **Result.**
  - Coverage: Vision aligns **37/55**; lite aligns 52/55 on the same pages. Where
    both align, Vision loses: vs lite 3W/19T/15L, sign p=0.0075, mean −1.09 pp;
    vs flash-preview 1W/13T/11L, p=0.0063, mean −0.51 pp. Per language, on
    aligned pages Vision is at parity on Greek print (median CER 0.21 % vs 0.19 %)
    and near it on German (0.71 % vs 0 %), behind on Latin (3.7 % vs 1.1 %),
    Armenian (4.9 % vs 3.1 %) and Chinese (8.2 % vs 1.7 %).
  - Coverage is the finding: 7/12 Latin pages fail the word guard (early-modern
    long-s, ligatures, abbreviations), 3/6 Chinese (interlinear commentary read in
    the wrong order), both Greek manuscripts (Greek minuscule read as Latin letters
    — the output on the Iliad pages begins `Inches cm 1 2`, the ruler in the
    photograph).
  - Failure mode, read by eye on the five worst pages: **garble, wrong reading
    order and non-text (rulers) — zero invention.** Every disputed string was on
    the page. Gemini's worst pages are a different kind: RECITATION refusals
    (8/8 runs on Hero 178 for flash-preview), a MAX_TOKENS loop of quote marks
    (Zohrab John 1), truncation. The novel-word proxy (output words absent from
    the reference passage) does not separate the two — it runs 0.30–0.81 for
    both engines because the reference is a passage, not the page — so the
    "garbles rather than invents" claim rests on the human read, n=5, and is
    consistent with but not proven by this run.
  - Tibetan: Vision median Derge identity **0.339** vs Gemini woodblock-prompt
    0.453, dbu-can-prompt 0.426, BDRC Yigdzin 0.51 (control 0.968, chance 0.083).
    Vision loses **20/20** to the woodblock arm and to Yigdzin. The leaderboard
    rank does not transfer to this manuscript Kanjur.
  - What Vision has that no VLM does: a per-block confidence. Mean block
    confidence tracks the guard loosely (0.98 on the control, 0.6–0.7 on the
    worst pages) — worth a look as a *triage* signal, not as a lane.
- **Decision.** No routing change. Vision is not a lane for any language here.
  Its one plausible use is as a non-generative *second reader* for triage
  (confidence + disagreement with Gemini flags a page), which is a different
  experiment. The per-language lite-suitability question this was a proxy for is
  now pre-registered in `PREREGISTRATION-per-language-ocr-suitability.md`.
- **Side finding.** `latin-la-praetorius-syntagma1-p120` is unpinnable: the
  stored pipeline OCR (printed p.72) aligns with the reference, but the archived
  image at `page_number 131` is printed p.73 and every engine run over it since
  (lite, Vision, Kraken, Surya, CHURRO) reads p.73 — a one-leaf image/text shift
  on book `69ef2b4685daccce30f2e066`. Filed as an issue; the page must be excluded
  from cross-engine rollups until repaired.
- *Replicated?* Single run (Vision is deterministic; the control re-scored
  identically on a second call). *Artifact:* `results/vision-vs-gemini-2026-09-11.{json,md}`,
  raw outputs in `results/scorecard-outputs-2026-09-11.jsonl` (model `google-vision`),
  transcripts in `results/vision-transcripts-2026-09-11/`, runner
  `google-vision-baseline.mjs`, `runGoogleVision()` in `lib/runners.mjs`.

---

## 2026-09-11 — Music: can a VLM read Shaker letteral notation? (first scored run)

**Headline: pitch yes, rhythm no.** gemini-3-flash-preview on seven verified
letteral references (180 notes, `scripts/music/ground-truth/`): interval NER
**0.19 mean, 0–0.08 on the five pages it read the right span of**; rhythm NER
**0.49** (long group underlines → quarters; half-note bars dropped). The July #3161
pilot's "85–90% rhythm" was eyeballed and is withdrawn. Cost $0.019. Positive
control on the scorer passed (0 on self, 0.06 on a one-edit copy). *Replicated?*
No (single run, temp 0). Artifact:
`scripts/music/eval-results/2026-09-11-letteral-gemini-3-flash-preview/README.md`.
Next: crop per music line and re-score the same seven.

**Same day, staff notation:** first mensural reference (Morley 1597 p.8 plainsong
ex. 1, twelve semibreves, checked against the printed solmization). Same model:
**pitch NER 0.42** — the candidate is the printed syllables mapped through the
natural hexachord, i.e. the model read the answer key, not the staff. The doc's
"VLMs cannot read staff notation" claim is now measured on our own page. Artifact:
`scripts/music/eval-results/2026-09-11-mensural-gemini-3-flash-preview/README.md`.

---

## 2026-09-03 — Bench 2 (complete): can self-hosted OCR replace Gemini on print?

**Headline: yes on quality, no decision yet on scope — n is too small.** Three
self-hosted engines are statistically indistinguishable from production Gemini on
pages they can read; the binding constraint is COVERAGE, not accuracy, and the
per-segment samples (5 Latin / 4 Greek / 2 German diplomatic pages) are a pilot,
not a mandate. Do not reroute a 7.9M-page backlog on this alone — scale the
diplomatic set to ≥20 pages per segment first (that is the next experiment).

- **Design.** Pre-registered (`PREREGISTRATION-bench2-print.md`, #4523). 11 new
  diplomatic (non-recitable, same-edition) pages pinned + 25 existing canonical;
  five arms on identical images (`bench2-export.mjs`), identical scoring
  (`score-transcripts.mjs --engine`): gemini-3.1-flash-lite k=3, Kraken 5.x CPU
  (CATMuS-Print; austriannewspapers for Fraktur; greek-cllg), Surya 2 (vLLM, L4),
  CHURRO-3B (L4). Cost: **€3.65 GPU + $0.05 API.**
- **Paired result** (`stats-cross-model.mjs`, pages both arms align, vs flash-lite):

  | arm | Δ vs Gemini | 95% CI | cost/page | speed |
  |---|---|---|---|---|
  | kraken-catmus-cpu | **+0.18pp** | [−0.28, +0.68] | **€0** (Hetzner CPU) | 20–50s |
  | surya2-l4 | **−0.04pp** | [−0.63, +0.46] | €0.00094 | 4.3s (98% GPU) |
  | churro3b-l4 | −0.69pp | [−1.66, +0.06] | €0.01435 | 65.4s |

  None is significantly different from Gemini. All three beat every commercial
  non-Gemini arm previously run on this set (Sonnet 5 −0.63, Mistral-OCR −0.97,
  Qwen-VL-Max −1.42, DeepSeek-OCR −2.10, Gemma −4.2/−7.5).
- **Coverage is the real finding.** Gemini aligns 52/56 pages; Kraken 25/56,
  Surya 28/56, CHURRO 28/56 (partly scope — specialists only ran the 36 print
  pages). The stats therefore read *quality given coverage*: equal accuracy **on
  pages the specialist can read**, which is exactly the cheap-first premise.
- **Per-script (diplomatic tier, tiny n — see headline):** Latin, all three
  engines within ±0.5pp of Gemini and 100% clear a 2pp accuracy gate. Greek,
  Kraken **+0.74pp over Gemini** and 100% guard-clean, while Surya/CHURRO lose
  ~2pp — a CRNN reads polytonic better than either VLM. German Fraktur inverts:
  CATMuS is not a Fraktur model (−4.3pp), a Fraktur-specific Kraken model reaches
  95–99% on 1618/1645 but decays with era distance, and **Surya/CHURRO solve
  early Fraktur outright** (98.5–99.8% on 1618/1645/1772).
- **Escalation rates** (`bench2-escalation-report.mjs`, rule 3, guard-detectable):
  Greek **0%** escalation with Kraken → 100% cheaper. German **0%** with Surya →
  79% cheaper (but n=2 ⇒ **UNDECIDED** under rule 5). Latin **40%** escalation →
  60% cheaper, which **FAILS** the preregistered ≥70% gate on the guard signal
  even though 100% of pages clear the accuracy gate. That gap between what an
  oracle would route and what the guard can *see* is the honest cost of having no
  ground truth in production, and it is the thing to engineer next.
- **Universally hard pages** (every arm, including Gemini): the ~1490 Malleus
  incunable and Praetorius 1615 (dense music-treatise layout). Specialist failures
  are guard-visible; Gemini's are fluent — the Bench 1 asymmetry, replicated on print.
- **Replicated?** **No.** Specialist arms are k=1; Gemini k=3 best-of. Determinism
  spot-check and a ≥20-page-per-segment diplomatic set are prerequisites for any
  reroute decision (see 2026-09-02 below for why k=1 is not a finding).
- **Artifacts.** `results/scorecard-outputs-2026-09-03.jsonl` (all 5 arms),
  `results/bench2-escalation-2026-09-03.json`, `results/scorecard--latin-la--greek-el--german-de---2026-09-03.json`;
  Kraken on `hetzner:/root/bench2-kraken/`, GPU work on archived Scaleway
  `sl-ocr-gpu-test` (`/root/bench2/`, ~€0.66/mo storage, reusable).

## 2026-09-03 — Bench 2 first arms (superseded by the entry above)

- **Design.** As above, Kraken + Gemini only.
- **Result (interim — CHURRO/Surya GPU arms pending L4 stock).** Diplomatic tier:
  - **Latin:** Kraken ≈ Gemini. Agricola 1556 99.2/99.5, Copernicus 1543
    98.7/98.7, Linnaeus 1735 98.2/99.4. Both arms fail the same two hard pages
    (Malleus ~1490 incunable; Praetorius 1615) — Kraken loudly (guard-fail,
    59–73%), Gemini by alignment failure. Kraken cost ≈ €0 (Hetzner CPU,
    ~20–50s/page niced).
  - **Greek:** Kraken **matches or beats** Gemini on every aligned page —
    Marinus 99.9/99.9, Bekker 99.9/99.4, Orphica 99.2/99.2, Parthey apparatus
    94.3/91.9; 99.7–100.0 on Teubner canonical (Philo/Simplicius/Hero). Caveat:
    all diplomatic Greek pages are 19th-c editions; on the one 16th-c Greek
    print page (Dioscorides 1549 Ruel) Kraken guard-fails at 88.4%.
  - **German Fraktur:** Kraken **loses badly** (72.8–89.1%, all guard-fails) —
    CATMuS-Print is not a Fraktur model. Gemini 99.6%. Needs a Fraktur-specific
    arm (GT4HistOCR/austriannewspapers lineage) before any German decision.
  - Failure asymmetry confirmed on print, matching Bench 1: every Kraken failure
    is guard-visible (loud); Gemini's weak pages align plausibly.
- **Replicated?** Not yet — Kraken k=1 (determinism check pending), Gemini k=3
  best-of. No reroute decision until GPU arms + paired stats run.
- **Artifacts.** `results/scorecard-outputs-2026-09-03.jsonl` (both arms),
  `results/scorecard--latin-la--greek-el--german-de---2026-09-03.json`,
  Kraken raw + models on `hetzner:/root/bench2-kraken/`.

## 2026-09-02 — Does OCR prompt v17 reduce fabrication vs v15?

- **Design.** Paired, k=5 runs per (page, arm), page as unit of analysis,
  positive + negative controls, decision rule pre-registered.
  `scripts/eval/prompt-ab.mjs`.
- **Result.** **INCONCLUSIVE, and the first-pass finding was retracted.** A
  single run per arm showed v17 cutting a fabricated page from 24,108 → 1,286
  body chars. At k=5 that page's SD was **±10,222** — the "finding" was one draw.
- **Replicated?** **No — it reversed.** Two independent k=5 runs put the runaway
  loop on *opposite arms*:

  | | run 1 | run 2 |
  |---|---|---|
  | p.118 v15 | 16,264 ±0 | 554 ±65 |
  | p.118 v17 | 348 ±4 | 16,232 ±0 |

  ~16.2k is the **output-token cap**: a degenerate repetition loop running to
  truncation. It lands on either arm, and within a batch of 5 it is all-or-none
  (±0, agreement 1.000), which is exactly what makes one batch look decisive.
  Arms verified distinct by `content_hash`.
- **What this means for method.** Body-length *means* are the wrong estimator
  when the failure is a categorical catastrophe. Needed: a repetition classifier,
  **loop rate as a Bernoulli outcome**, length statistics on non-looped runs
  only, and tens of runs per arm. k=5 cannot estimate a rate this volatile.
- **Artifacts.** `results/prompt-ab-v15-v17-{lacuna,blank}-2026-09-02.json`,
  `…-lacuna-2026-09-02-amended.json`. PR #4610, issue #4195.

## 2026-09-02 — Does #4195's blank-page narrowing work?

- **Design.** Same harness, `--cases blank`.
- **Result.** **Yes, on the faint-mark page** — v17 classifies Kitāb al-Bulhān
  p.4 as `text` on 5/5 runs where v15 said `blank`. I had reported the opposite
  from a single run.
- **Replicated?** Single k=5 run; stable within it (5/5), not repeated across
  sessions.
- **Counter-finding.** v17 **over-declines** elsewhere: p.197's legible Latin
  note ("Nihil hic deesse videtur") becomes a `<lacuna>`. That is the trade
  #4195 warned about, running in the direction nobody was watching.
- **Consequence.** v17 not promoted; PR #4605 labelled `blocked`.

## 2026-09-02 — Is a similarity gate a workable way to stop duplicated work?

- **Design.** Replay all 2,043 watched files as if newly created; sweep the
  block threshold; require the four real duplications of that day to keep firing.
  `.claude/hooks/calibrate-prior-art-guard.mjs`.
- **Result.** **No.** Four rounds of tuning could not get the firing rate below
  ~30% while keeping the true positives:

  | threshold | would block | true positives |
  |---|---|---|
  | 0.60 | 49.1% | 2/2 |
  | 0.70 | 33.2% | 1/2 |
  | 1.00 | 29.9% | 1/2 |

  In a repo organised into families (`ft-*`, `build-*`, `report-*`) the base rate
  of legitimate similarity is high, so a ranked filter's precision tracks it.
- **Consequence.** The gate was redesigned to be **unconditional** — declare
  prior art in any new file under watched roots — with the similarity list
  demoted to advisory. Nothing to tune, nothing to argue about.
- **Two ways the probe lied before it worked**, both worth remembering: it
  replayed existing paths that the guard skips and reported a reassuring **0%**;
  and it invoked a hook path that did not exist, where `else allowed++` counted
  every failed spawn as a pass. A probe needs a positive control, and absence of
  a signal is not evidence of a pass.
- **Artifact.** PR for `.claude/hooks/prior-art-guard.mjs`.

---

## Older runs — not yet back-filled

`results/` holds dated artifacts going back to 2026-04 (calibration scorecards,
blank-page study, revision-agreement pilots, cross-model comparisons, the
occlusion pilot). Their conclusions live in
`.claude/docs/ocr-quality-measurement-loop.md`,
`.claude/docs/ocr-memorization-paper.md` and the issues that commissioned them —
**not** here. Back-filling them is worthwhile but has not been done, and this
section exists so nobody reads the gap as "nothing was run before September".

## 2026-09-05 — How wrong is the ground truth? (Track B item 1, #4523)

- **Question.** Every engine accuracy we quote is `1 − CER(reference, output)`. At 98–99%
  the residual is a few characters per page. If the reference is wrong at the same rate,
  the engine ranking is inside our own noise and nothing downstream is quotable.
- **Design.** No hand transcription — and deliberately no VLM re-transcription, which
  would referee a bench about VLMs with the system under test. Wikisource pages carry
  their own second opinion: `level 3` = one human transcribed it, `level 4` = a second,
  different human re-read it against the scan. `reference-error-rate.mjs` replays each
  page's revision history and measures what the validator changed, through the same
  `normalizeForScript` folding the bench scores through, so the number is on the bench's
  own scale. Restricted to independent validators and to pages whose predecessor was
  genuinely level 3 (a level-1 predecessor is raw OCR and prices the whole proofreading
  pass — one such page carried 10.9% into a 1.1% Latin sample).
- **Result — the reference is NOT the constraint for Greek, and IS for Latin.**
  n=69 pages (pinned set + a matched level-4 harvest per wiki), median 0.00%, 39 exact.

  | | level-3 reference error (A) | level-4 residual (B) | reported engine gap |
  |---|---|---|---|
  | Greek (n=18) | **0.07%** CI [0.02, 0.13] | 0.00% (5/5 exact) | 1.5pp |
  | German (n=15) | **0.06%** CI [0.02, 0.11] | 0.01% | — |
  | Latin (n=36) | **1.15%** CI [0.17, 2.47] | 0.48% | 1.4pp |

  Greek and German engine differences are 20x the reference noise and stand. **The Latin
  comparison does not** — the reference error and the reported Kraken-vs-Gemini gap are the
  same size, which is the arithmetic behind "Latin is a tie". Latin's distribution is
  skewed, not uniformly bad: most references are exact and a handful omit a whole printed
  block (an apparatus criticus, a clause), so the median is 0 and the mean is 1.15%.
- **The bigger error was OURS.** Instrument C compares the two cleaners: the pre-fix
  `cleanPageText` deleted a formatting template together with the text it wrapped —
  `{{SperrSchrift|D’Glocke het zwölfi gschlage.}}` is a printed line, not scaffolding.
  Measured **6.0% of Greek reference letters, 3.8% of Latin, 0.9% of German**, single pages
  losing 40–100%. That is 5–80x the human reference error. Worse, deeply nested apparatus
  markup survived as literal braces: the Poemander reference was 1,178 characters of
  `{{κσχασ|εδάφιο=1|σημείωση=μου] μεν A, om Turn. Fluss.}}` soup where the page prints 383
  characters of Greek.
- **Consequence, measured on stored outputs (no re-runs, no cost).** Re-scoring the
  Gemini-lite arm against the corrected references: Greek conditional accuracy **97.8% →
  99.6%** on coverage 92% → 88%; Latin 96.3% → 96.0%; German unchanged. The single page
  that drove it went **59.7% → 100.0%** — a perfect transcription charged 40 points for our
  markup. Coverage fell because a table-of-contents page that the corrupted reference let
  through now fails the guard honestly. **The Greek correction (1.8pp) is larger than the
  Greek engine gap it was used to judge (1.5pp), so the Bench 2 Greek result must be
  recomputed for every arm before it is quoted again** — the Kraken ws outputs live in
  PR #4651 and were not available to re-score here.
- **What the instrument cannot see:** errors both readers share, and the 79/149 pages
  nobody validated. Pages volunteers chose to validate are the well-loved ones, so this is
  a lower bound.
- **Artifacts.** `scripts/eval/reference-error-rate.mjs`,
  `scripts/eval/refresh-ws-references.mjs`, `results/reference-error-2026-09-05.json`,
  8 new unit tests in `tests/unit/wikisource-text.test.ts`.

## 2026-09-05 — A fabrication detector that needs no reference (Track C, #4523)

- **Question.** Every metric we own compares OCR to a reference. A model that has memorised
  the published text scores *well* on that comparison while never reading the page — Bench 1
  E4 caught one folio where Gemini hit 0.790 against the Derge canon while agreeing 0.33 with
  both specialists' reads of the same image. Production has no reference at all. Can the
  failure be detected without one?
- **Design.** A CTC line recogniser carries no language model over the target text, so it
  cannot recite; two independently-trained ones converging is evidence about the ink rather
  than about any edition. `fabrication-detector.mjs` scores three signals per page — specialist
  convergence (`ink`), VLM-to-ink agreement, and unit overrun — and abstains when the
  specialists do not converge. Every agreement is computed order-sensitively *and* order-free
  (multiset Dice over 3-unit shingles); a page is flagged only when both are low.
- **Validated on two sets with known answers, 349 pages.**
  Positive: Bench 1 Derge Kangyur, 313 folios, two BDRC recognisers + production-era Gemini.
  51 pages carry an externally-established label — Gemini below 0.2 against the canon where
  *both* specialists exceed 0.8, which no reading of the image can produce. Negative: the
  Bench 2 print arms in this repo, Kraken + Surya + Gemini on the same 36 pages.

  **51/51 positives flagged, 0/5 false positives**, and the threshold plateau is wide:
  precision and recall are both 100% for every gap threshold from 0.10 to 0.40. The default
  0.35 sits in the middle of that plateau rather than on a cliff, which is the answer to
  "the guard threshold was picked by hand".
- **Order is not failure — and it nearly cost 8 of 11 print pages.** On the Bekker
  *Categories* page Kraken reads across the gutter of a two-column setting while Surya reads
  down the column: order-sensitive agreement **0.01** between two engines that both transcribe
  it well. Gating on the sequence number sent those pages to INCONCLUSIVE for a layout reason.
  Every quantity is now the better of its ordered and order-free form.
- **The blind spot is the highest-risk population, and it is the real finding.** Recitation and
  specialist failure share a cause: a hard image is what makes a CTC engine fail *and* what
  pushes a VLM onto its memory. So "abstain when the ink is unestablished" silently excuses
  exactly the pages that matter — the seven most flagrant Bench 1 cases (Gemini 0.75–0.98
  against the canon while both specialists scored 0.00–0.16 against it, emitting up to 13.5x
  the units on the page) all sat in INCONCLUSIVE. A canon-anchored rule recovers 9 of them as
  a separate `RECITING?` verdict, reported apart from the verified ones because the
  specialists being broken is a live alternative explanation.
- **Overrun is the famous tell and it is not the useful one.** Across the 203 flagged Tibetan
  pages the median overrun is 0.93x, and only 38/203 exceed 1.6x. The agreement gap carries
  the signal; syllable count catches the spectacular cases only.
- **Coverage is the constraint, not accuracy.** Only 56 of 349 pages are both labelled and
  judgeable. On print, 6 of the 11 pages with a VLM arm are gated out because Kraken and Surya
  genuinely disagree — Copernicus 1543, the ~1490 Malleus, Weigel 1618, Zesen 1645, the
  Poemander apparatus page, Bekker. Two specialists that fail together buy nothing.
- **The validation's own weakness, stated plainly:** the positive and negative classes differ
  in script, medium *and* engine set. Perfect separation between conditions that different is
  evidence the statistic orders known-bad above known-good — not that it discriminates *within*
  early modern print. That needs a print corpus with known fabrication, which we do not have.
- **Artifacts.** `scripts/eval/fabrication-detector.mjs`,
  `results/fabrication-detector-2026-09-05.json`. Bench 1 case files are built from ops
  `eval-tibetan/` + `hetzner:/root/tibetan-eval/pages-*.jsonl` and are not committed here.

## 2026-09-13 — How good is the IA OCR text we actually WROTE, and where should the cutoff sit? (#4780, #4763)

**Headline: the delivered text in the accepted bands has a median CER of 3.9% (WER 8%)
against a fresh flash-lite read of the same image; 84% of pages are within 10%, and a 10%
tail is above 20%. Quality degrades smoothly with the gate score — there is no cliff at
0.85 — so the cutoff is a policy choice, and it should differ by language: 0.80 for
English and French, 0.85 for Latin/German/Italian, and Greek should not be filled at any
score.** The two proposed refinements from the hand read on #4780 were tested and both
fall: a prose-page-only book score admits books whose delivered pages are mediocre
(median 9.1%), and the column-splice failure is page-local, invisible at book level.

- **Design.** One interior, previously-untranscribed page per BOOK (742 books) across
  agreement band × language — including the bands the gate REJECTS (0.40–0.85, text
  regenerated from the leaves cache exactly as the ingester would write it) — scored by
  CER/WER against a fresh `gemini-3.1-flash-lite` read via the eval-lib runner with the
  production prompt v16, thinking budget 0, the production document-context line. Per
  page also the gate's own sequence ratio, bag-of-words Dice and their gap; per book the
  gate re-scored with the current (#4783) logic as median-over-all, median-over-prose
  pages, and p75. Five hand-read anchor pages from the peer session ride along.
  `scripts/eval/ia-ocr-delivered-quality.mjs`; rows in
  `results/ia-ocr-delivered-quality-2026-09-13.jsonl` (image URL + both texts on every
  row). Cost **$2.49** (742 + 193 re-reads; $3.02/1K pages — realtime lite, not the batch
  rate the $1.20 estimate used).
- **By band, all languages (clean references only):** median CER 0.40–0.60 17.3% ·
  0.60–0.70 13.3% · 0.70–0.75 10.1% · 0.75–0.80 9.3% · 0.80–0.85 7.0% · 0.85–0.90 5.9% ·
  0.90–0.95 3.4% · 0.95+ 1.4%. Share ≤ 5% CER climbs 4% → 11% → 20% → 23% → 33% → 37% →
  71% → 97%. Pre-1800 pages median 12.0% vs 5.8% for 1800+ (Latin pre-1800 11.8%).
- **Per-language cutoff sweep (accepted median CER / share ≤ 5% / share > 20%):**
  English 0.85 → 2.7%/71%/6%, 0.80 → 3.3%/65%/7%, 0.75 → 4.3%/58%/6%; French 0.85 →
  3.2%/69%/8%, 0.80 → 3.4%/68%/8% (rejects below 0.80 hold ONE good page); Latin 0.85 →
  4.5%/61%/11%, 0.80 → 4.7%/52%/12%; German 0.85 → 3.2%/57%/13%, 0.90 still 15% > 20%;
  Greek 0.85 → 6.6%/29%/24% and n=5 at 0.90; Italian n=30, 0.85 → 2.1%/71%/14%.
- **The instrument, calibrated on the anchors.** The 0.95+ band medians 1.4%, so the
  reader-vs-reader floor is ~1–2%. The two pages a human called verbatim (Basil *Letters*
  0.353, Dance of Death 0.890) score **6.0% and 6.1% CER** — so ≤ 5% ≈ verbatim by eye,
  6–10% ≈ a few visible errors; the Latin page the human called garbage (*Oratio pro
  Ligario*, names corrupted) scores 7.8% CER / **23% WER** — word error rate is the
  better proxy for "names are wrong". The column-interleaved Century page scores CER
  1.02 with gap 0.25.
- **Bag-of-words minus sequence isolates 14 of 488 pages (gap ≥ 0.15), median CER 0.735
  vs 0.075 for the rest** — the label works. But every one of those pages sits in a book
  whose reference-page gap median is ≤ 0.04: **the splice is page-local (a spread, a
  two-column page), not a book property. A book-level splice gate would catch none of
  them.** CER already flags them as delivered text.
- **Prose-only book score: rejected.** Median |prose − all| = 0.007 — the statistic
  barely moves for most books. Where it does move (39 rejected books cross 0.85) the
  delivered pages median **9.1% CER**, worse than the 3.9% accepted median. The Basil
  case (facing-page Greek dragging a verbatim English book to 0.35) is real and rare; as a
  policy the prose score admits mediocre books.
- **Delivery errors: 31 of 573 pages (5.4%) show text and image as DIFFERENT pages** — the fresh
  read of the archived image fits leaf k±1 at seq > 0.5 while the delivered leaf scores < 0.3.
  Re-read from the SOURCE leaf the record points at (`pages.photo`, IIIF) and classified, because
  the two causes need OPPOSITE repairs: **24 text-side** (the source leaf matches the NEXT leaf's
  text: the gate's per-book offset was locally wrong — every one is "text one leaf behind", the
  Oxyrhynchus volumes worst; 2 already written), **5 image-side** (the text matches the source
  leaf; the archived R2 image is the neighbouring leaf — the #3368 bulk-JP2 leaf offset,
  `.claude/handoffs/2026-07-27-bulk-jp2-leaf-offset.md`; the TEXT is right; 2 written), 2 unclear.
  Mechanism for the text-side class: the reference pages are the book's FIRST 25 (the preview
  sample), so the offset is calibrated at the front and drifts by the interior; an 86% vote
  (`--min-offset-share` 0.60 passes it) was locally wrong. **A repair must classify first —
  shifting text to match the archived image would corrupt the image-side class.** Peer
  verification of the four written cases on #4790 (against IIIF, by printed page number) agrees.
- **Corpus-wide sizing, free and deterministic (`scripts/audit/ia-ocr-leaf-drift.mjs`).** IA's
  scandata marks leaves excluded from access formats; BOTH the IIIF page index and the djvu.xml
  OBJECT sequence skip them (access-leaf count == XML object count on 478/478 written books), so
  the correct offset is 0 for every book. The bulk-JP2 archived images (#3368) do NOT skip them,
  and the reference pages were OCR'd from those images — the offset vote fitted the XML to the
  wrong image set. **236 of 893 written books (26%), 51,851 of 152,997 written pages (34%), were
  written at offset −1/−2/−3 and carry the text of the wrong leaf against their own source.** The
  paid sample's "2 of 56" was a wide interval around the wrong quantity: at the front of an
  offset −1 bulk book the text matches the *shifted* image, so only pages past an interior
  excluded leaf were caught. Shown-image mismatch is an upper bound (98 books / 4,544 pages,
  assuming every bulk image set is shifted; Possidius is aligned, Century shift+1 — only the
  #3368 dHash audit can count it). Folio continuity inside the written text was tried first and
  is blind to this: a fixed shift of a continuous sequence (Open Court delivered folios
  355/356/357 vs archived 353/354/355 vs IIIF 356/357/358).
- **The 2×2 and the repair (same evening).** dHash of each bulk-archived written book's images
  against IIIF at the aligned vs the scandata-predicted leaf (`--stage=images`): CLASS A (images
  aligned, text offset ≠ 0 — reader sees the wrong text) **39 books / 940 pages, repaired**: 910
  pages re-pointed to offset 0 from the cache with revisions, 30 held (offset-0 leaf has no words),
  second run 0 changes; 7/7 readable IIIF re-reads confirm (new text 0.90–0.97 vs old 0.11–0.17).
  CLASS B (images shifted, text right) 42 / 2,270 → the #3368 image repair. **CLASS C (images
  shifted, text at a compensating offset) 188 books / 48,006 pages: text and image AGREE on screen
  except 2,062 pages past an interior excluded leaf — HELD**, must be repaired together with the
  images, images first. So the offset search mostly *masked* #3368 rather than breaking pages.
  Ingester now forces offset 0 and refuses a non-zero vote as `REF_SHIFTED`.
- **Refusals are the instrument's big limit.** 193/742 first-pass references (26%) came
  back RECITATION/PROHIBITED_CONTENT because the run omitted production's document-context
  line; adding it recovered only 24, leaving **169 (23%) unscored — concentrated in the
  cleanest, most recitable print (78 of 169 in bands ≥ 0.85)**, so the accepted-band
  figures are, if anything, pessimistic. The production tier-2 retry (flash-preview)
  would cost ≈ $0.80 more and was not run (over the $3 cap). A further 56 references were
  degenerate (40 hit MAX_TOKENS in a loop — flash-lite on dense Latin/German/Greek pages)
  and are excluded. Stored-text check: 70 pages read from `pages.ocr.data` matched the
  regenerated leaf exactly, all 70.
- **Decision:** per-language cutoffs (English/French 0.80; Latin/German/Italian 0.85;
  Greek: do not fill); force offset 0 in the ingester — a non-zero vote means the reference
  pages were read from #3368-shifted images, a tell to refuse on, not a calibration; re-pair the
  236 books' written pages at offset 0 from the cache (no model calls), images FIRST or both per
  book, since at the front the text currently matches the shifted image.
  Issue: #4790.
