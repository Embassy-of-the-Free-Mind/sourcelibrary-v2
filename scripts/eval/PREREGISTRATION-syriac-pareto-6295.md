# Preregistration — Syriac on the Pareto page (#6295)

PRIOR ART: `scripts/eval/pareto-6182/PREREG.md` (translation arms, two blind Opus judges, PLANT + DUP gate,
A-vs-A floor), `scripts/eval/benchmark/syriac-retest/` (Syriac OCR on two manuscripts' line ground truth, N2
normalisation). Neither has a printed-Syriac reference set or a translation-from-OCR arm; this adds both.

Written 2026-10-08, after the page set was sealed and the arms were started, **before any score was read**.
The decision rules are the issue's, copied here with the margins the issue asks for.

## Question and readers
Two decisions wait on this (issue #6295): (1) re-translate the Kraken-read Syriac pages (≈ $45, not
approved), or keep their translations withheld; (2) where to spend on Syriac OCR (a column splitter, a Kraken
fine-tune per #5730, or nothing). The panel is read cold by a reader who taps "How we checked" in a
Syriac book, so every number carries n, date and a by-book interval.

## Page set (sealed)
- 24 printed Syriac books we hold whose text has a Digital Syriac Corpus e-text (srophe/syriac-corpus,
  CC BY 4.0): 18 books / 14 editions where the e-text transcribes our printing, 6 books where it is another
  edition of the same work. Count posted on #6295 before any arm ran.
- One page per book, drawn uniformly (seed `6295|<book id>`) from the pages whose Kraken read shares
  ≥ 8 consonantal word bigrams and ≥ 20 % of its bigrams with the book's matched e-texts.
  `sealed-pages.json` sha256 `d4043685b96e33cd55f0eaf3a7a230c211b2d3978eb5e4737bc4947b41a880c3`.
- Under 30 books: every result is labelled **directional**.
- Intervals are by EDITION (20 clusters: the four editions we hold twice count once), bootstrap 2,000, seed 6295.

## Reference window (rule fixed before scoring)
Per page, every OCR arm's output is aligned to the matched e-text (`edition-window.mjs` cutEditionWindow,
consonantal fold, fitting alignment). Arms whose fitted span has word error < 0.5 vote; the window is the
union of their spans plus 3 e-text words each side. No arm alone sets the boundaries. A page where no arm
aligns has no reference and is reported, not scored. The e-texts stay on the box and are never committed.

## Step 1 — OCR
- Measure: consonantal CER (`syriac-pareto-6295/syriac-cer.mjs`, fixtures `scripts/eval/fixtures/syriac/`,
  test `tests/unit/syriac-cer.test.ts` passing first). Accuracy = 1 − median CER (CER capped at 1).
- Arms: omnisyr as the lane runs it (gutter split), omnisyr with no split, Sophro Mhiro, Qoruyo Eastern and
  Estrangela (all Kraken 7.1, the lane's invocation, Hetzner CPU); stored Gemini reads from `page_revisions`
  (Flash-Lite or Flash, whichever the page has — never regenerated); `gemini-3.8-flash` on the live OCR
  prompt, Batch, twice (A-vs-A); MinerU 3.4 pipeline (CPU, as the production worker runs it);
  PaddleOCR-VL and GLM-OCR (same weights, read on CPU here; cost from their production GPU basis).
  The Gemini CLI route (`agy`) is not installed on this box: not run, said so.
- **Column-splitter rule:** omnisyr-split beats omnisyr-whole if the by-edition CI of the paired median
  difference in CER excludes 0. **OCR lever rule:** the arm the panel favours is the cheapest arm whose
  accuracy CI overlaps the best arm's; a fine-tune is recommended only if no tested arm reaches CER ≤ 0.10.

## Step 2 — translation
- Sources per page: **K** = the lane's omnisyr text (what production would translate), **R** = the
  reference window (the ceiling for each model).
- Models: gemini-3.1-flash-lite (production for Syriac), gemini-3-flash-preview, gemini-3.5-flash-lite,
  gemini-3.7-flash, gemini-3.8-flash; each translates K and R with production's one-page v13 request
  (pinned prompt document, as #6182), Batch, thinking budget 0 (minimal for 3.5-lite), billed thinking recorded.
- **Noise floor first:** production translates R a second time (R′). Floor f = the larger absolute bound of the
  by-edition 95% CI of mean fidelity(R′) − fidelity(R).
- Judges: two blind Opus judges (J1, J2) on the Claude subscription (`claude -p --model opus`), never an API
  key. One item per page with all 11 candidates, labels shuffled (seed 6295); the SOURCE they judge against is
  the Syriac e-text window. Fidelity 1–5, omissions, inventions, inversions, ranking with ties.
- **Gate (per judge, before any number counts):** 8 PLANT items (production's R English beside a copy with one
  planted reversal, #5829's planter) caught (inversion listed, or lower fidelity than its twin) in ≥ 6 of 8,
  and 4 DUP items (two identical candidates beside a third) tied in ≥ 3 of 4. Fail → re-run once on fresh
  controls; fail again → "instrument failed", no translation number is published.
- Per page × arm: fidelity = mean of the judges; an inversion page = either judge lists one.

### Decision rule (the issue's, with the margin)
For model m, **K is within the noise floor** iff the by-edition 95% CI lower bound of
mean(fidelity K_m − fidelity R_m) ≥ −f **and** inversion pages(K_m) ≤ inversion pages(R_m) + 2.
- Within, for some model → recommend the re-translation, naming the model with the best fidelity on K among
  those within, or the cheapest whose K fidelity CI overlaps that best one.
- Within for none → keep the Kraken-read translations withheld; recommend the OCR lever Step 1 favours.

## Spend
Estimate $2–4 (OCR 48 Batch reads ≈ $0.4; 264 translations ≈ $1.5–3). Stop and comment above $10.
Ledger: `<work>/ledger.jsonl`; every Batch job registered in `batch_jobs` as `external_eval`. No page writes.

## Amendment 1 — 2026-10-08, the spend rule (written before any translation was judged)
Derek's spend rule of 2026-10-08 (#6295 comment) supersedes the arm lists above: the only Gemini model on the paid
API is `gemini-3.1-flash-lite`; every other Gemini tier runs through the CLI on the subscription, which this box
does not have; no GPU rental; total paid spend under $1.
- **OCR arms run:** the five Kraken arms, MinerU (CPU), stored Gemini reads, and `gemini-3.1-flash-lite` (Batch,
  read twice for A-vs-A). The two `gemini-3.8-flash` OCR Batch jobs submitted before the rule were cancelled while
  RUNNING; no output was collected. PaddleOCR-VL and GLM-OCR: not run (no stored Syriac output, no weights on the
  box, no GPU). CLI arms: pending, from the export in `<work>/cli-export/`.
- **Translation arms:** `gemini-3.1-flash-lite` only: R and R′ (the e-text window twice, R′ is the noise floor) and
  K and K′ (the served Kraken text twice). Four candidates per judge item instead of eleven. The decision rule is
  applied to K − R for this one model; K′ − R′ is reported beside it.
- **Judges:** `claude -p --model opus` sessions on the subscription (ANTHROPIC_API_KEY unset), one per packet
  part, prompt `syriac-pareto-6295/JUDGE-PROMPT.md`. The gate is unchanged.
- **Window alignment, changed after a trial run had printed partial CERs:** a book's matched corpus texts are
  aligned as ONE text in corpus-id order, not text by text, because a page can run from one corpus text into the
  next (NT p. 271, Romans → 1 Corinthians, had no window text by text). The voting rule and its 0.5 threshold are
  unchanged. 4 pages still have no window and are reported, not scored.
- **Kraken / MinerU cost:** CPU time on this box (a 16-core cax41, about €32/month), inference time only.
