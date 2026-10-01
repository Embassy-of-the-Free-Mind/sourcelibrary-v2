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
