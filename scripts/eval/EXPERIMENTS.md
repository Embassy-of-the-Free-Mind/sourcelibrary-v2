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

## 2026-09-16 (logged 2026-09-25) — Is our Syriac OCR a reading of the page? Against published Syriac and published English (#4883)

*Logged late.* The headline was posted on #4883 the same day and drove the Syriac decision;
the report, scripts and per-page artefacts stayed in an uncommitted worktree, and the report's
own "logged in EXPERIMENTS.md" line was never true until now.

- **Question.** The 2026-09-15 benchmark had no Syriac reference and could not tell recitation
  from reading. Does the Gemini OCR of our Syriac books read the scan in front of it?
- **Design.** $0 in model calls, text-vs-text. References are same-edition electronic texts:
  ETCBC `syrnt` (the 1905 BFBS NT exactly), ETCBC `peshitta` (Leiden OT, edition differs from
  our 1913 TBS reprint), Digital Syriac Corpus TEI page-exact for Isaac of Nineveh (Bedjan 1909)
  and Narsai (Mingana 1905), text-exact for Aphrahat (Parisot 1894). Consonantal Syriac only.
  Bible pages classified right / wrong passage / invented by longest increasing subsequence
  over canonical verse order. English for five narrative works scored against public-domain
  published translations with a control work as the null.
- **Result.** NT 1905 (100% `gemini-3-flash-preview`, 0 pages looped): of 350 pages with Syriac,
  **19%** carry the right passage at <= 10% CER; **47%** are wrong passage (14%), text not in the
  Bible at all (17%), or right passage > 50% wrong. Hand-read six against the image, classifier
  right on all six. Isaac, Narsai: median page ~70% CER, **no page under 20%**. English for five
  narrative works: indistinguishable from random alignment with the published translations.
  Loop score flags 0/372 NT and 13/410 Isaac pages: it measures the model (flash 2.2% looped,
  lite 12.4%), not invention. Flash loops less and invents just as much.
- **Recommendation at the time:** withdraw all Syriac-OCR-derived text from "readable" by book.
- **Superseded.** The same day #4883 changed course (retest of the specialist engines, #4746,
  PR #4901): re-transcribe Syriac with Kraken and withhold only looped or unreadable pages
  meanwhile. The Kraken lane has run on Hetzner since 2026-09-18. What still stands from this
  entry: Gemini re-OCR is not a fix for Syriac (it removes loops, not invention), and no
  page-level signal we have separates a recited page from a read one.
- *Replicated?* No; hand checks are one reader's. Reruns in minutes (README). *Artifact:*
  `results/syriac-vs-published-2026-09-16.md`, per-page classes and alignments in
  `results/syriac-vs-published-2026-09-16/`, scripts in `syriac-vs-published/`.

## 2026-09-11 (logged 2026-09-25) — Which languages can OCR on flash-lite? Per-language suitability vs the script-family allowlist (#4729, #4735)

*Logged two weeks late.* The run finished on 2026-09-11 in a worktree whose session died
before committing; the result never reached an issue, this log, or main, while the allowlist
it tests kept routing production. Landed as found, with the disclosed post-run metric
amendment (PREREGISTRATION, Amendment 6).

- **Question.** `LATIN_SCRIPT_LANGUAGES` (translate-core.mjs) sends a language's OCR to
  flash-lite by script family. Is each listed language actually safe on lite?
- **Design.** Preregistered (`PREREGISTRATION-per-language-ocr-suitability.md`). One page per
  book, up to 20 books per language, lite and Cloud Vision each scored against production
  flash on the same page. Rule, fixed before the run: lite allowed iff median character
  agreement with flash >= **0.956** (letters+marks; calibrated so 0.956 = 1 pp CER on the
  pinned set), catastrophic (loop/empty) <= 10%, **zero** invented pages (judge), coverage >= 80%.
  Spend: Gemini $4.35, judge $0.07, Vision 206 units.
- **Post-run amendment (disclosed).** First scoring used `agreementPrimary()`, whose word
  tokenizer shreds combining marks and read Devanagari/Syriac/Ethiopic as ~0 (the
  non-latin-text-operations failure shape). Primary metric switched to character agreement and
  the threshold re-derived by the same pre-declared procedure. Both metrics are stored per page.
- **Result (lite verdict).**

  | language | n | lite agr | catastrophic | verdict | allowlist today |
  |---|---:|---:|---:|---|---|
  | English | 17 | 0.996 | 1 | allowed | lite |
  | Russian | 19 | 0.996 | 0 | allowed | **flash** |
  | Portuguese | 18 | 0.994 | 1 | allowed | lite |
  | Spanish | 18 | 0.972 | 0 | allowed | lite |
  | Armenian | 17 | 0.963 | 0 | allowed | **flash** |
  | German | 19 | 0.972 | 1 | flash only: 1 invented page (veto) | **lite** |
  | French | 20 | 0.951 | 0 | flash only: agreement < 0.956 | **lite** |
  | Dutch | 17 | 0.921 | 0 | flash only: agreement < 0.956 | **lite** |
  | Chinese | 19 | 0.932 | 4 | flash only | flash |
  | Arabic | 15 | 0.929 | 0 | flash only | flash |
  | Greek | 19 | 0.918 | 0 | flash only | flash |
  | Ge'ez / Sanskrit / Syriac / Tibetan | 19-20 | 0.47 / 0.38 / 0.25 / 0.22 | 9 / 6 / 8 / 11 | flash only | flash |
  | **Latin, Italian** | 0 | - | - | **undecided: sampler drew no scorable page** | lite |

  Cloud Vision passed no language (consistent with the 2026-09-11 Vision entry below).
- **What it says about production.** Three languages on the lite lane today did not pass
  (German, French, Dutch); two on flash did (Russian, Armenian). **Latin, the bulk of the lite
  lane, was never measured** here; the sampler returned no scorable Latin or Italian page,
  which is itself a defect to fix before any re-run.
- **Caveats.** n = 15-20 pages per language, one run. French missed the bar by 0.005; German
  failed on a single judge-flagged page. Agreement with flash is not accuracy: where flash is
  itself weak (Greek, see 2026-09-21) a language can "fail" by disagreeing with a wrong
  reference. Treat the verdicts as the case for a decision, not the decision.
- **No routing change made.** Editing `LATIN_SCRIPT_LANGUAGES` moves pages between the
  $0.86/1K and $3.50/1K lanes; that call belongs to Derek.
- *Replicated?* No. *Artifact:* `results/per-language-suitability-2026-09-11.{md,json}`,
  raw outputs `...-raw-2026-09-11.jsonl`, judge calls `...-judge-2026-09-11.jsonl`, sample
  `...-sample-2026-09-11.json`, calibrations `...-calibration{,-charM}-2026-09-11.json`, Tibetan
  sub-run `...-tibetan-2026-09-11.jsonl`; runner `per-language-suitability.mjs`.

## 2026-09-25 — Which engine should retranslate the re-OCR'd Kanjur pages: Gemini flash, flash-lite, or the Dharmamitra specialist (MITRA-MT)? Blind A/B against 84000 (#4742, gates the #4523 $430 retranslation)

**Question.** Nobody has published a specialist-vs-Gemini Tibetan translation comparison, and nothing
on OCR-derived manuscript input. Before ~150K Yigdzin-read Kanjur pages are retranslated on
`gemini-3-flash-preview` batch (approved, ~$430), does buddhist-nlp/gemma-2-mitra-it (9B, the
paper's "Gemma 2 MITRA-MT") translate them more faithfully?

**Design.** 22 manuscript pages, one per book (Thadrak / Neyphug Kanjur, EAP), drawn from
`concordance-eap.jsonl` where a Derge locus with an 84000 English translation exists (identity
0.66–0.99; six of the 09-12 draw were replaced because their reference could not be located — Toh 8
volumes 22–25 are not in the cached TEI, Toh 557's TEI ends before folio 63, one page had no Yigdzin
text). Source = the Yigdzin read (#4722), the text the retranslation would consume. Reference = the
84000 English for the matched folio ± one side, sliced from the cached TEI by volume + folio
(`tibetan-mt-ab/extract-84000-refs.py`; CC BY-NC-ND, judge input only, not committed). Arms:
flash and lite on the production Tibetan prompt (v13) through `gemini-script-client`, thinking
off, BLOCK_NONE; MITRA-MT self-hosted with vLLM 0.29 on a Scaleway L4 (bf16, eager, its own
template `Please translate into English: … 🔽 Translation::`, page re-segmented at the shad into
≤500-char chunks). Two blind judges (Opus, Sonnet; `lean-worker` subagents, image + source +
reference + shuffled candidates, seed 4742), the June rubric: fidelity 1–5, omission, invention,
doctrinal inversion, ranking with ties. Pre-registered rules: (i) issue — MITRA wins fidelity on
≥ 15/20 pages → hold the $430; (ii) handoff — cheapest engine whose median fidelity is within 0.5
of the best AND invention ≤ best + 5pp. Peer finding folded in mid-run: Yigdzin drops one
manuscript line on some two-leaf pages; the judges were told a one-line omission is the source's
and ties all arms on that span.

**Controls first.**
- Same-arm pairs (one engine's output shown twice under two labels, 4 pages): Opus 4/4 ties,
  Sonnet 4/4 ties. Byte-identical texts, so this is the easy floor, not the seam-judging one.
- Positive control (the 84000 English as a 4th candidate) took THREE attempts, and both judges
  were right each time it failed. Attempt 1 (Toh 552 title leaf, identity 0.82): both judges
  scored the "reference" 1/5 with invention — the concordance had matched the leaf to the wrong
  text (a praise of Prajñāpāramitā, not the Eight Maidens), i.e. the reference was wrong, not the
  judge. Attempt 2 (Toh 9 F.392.b): my span search caught an earlier copy of a repeated refrain
  and imported a whole extra paragraph; Opus 2/5, Sonnet 3/5, both naming the imported paragraph.
  Attempt 3 (exact page span): **Opus 5/5, Sonnet 5/5, no invention, tied with flash and lite.**
  Net: the instrument detects a mismatched or over-wide reference, and passes a true one.
- One more page (Toh 543, identity 0.79) had a reference that did not cover the page; both judges
  said so and scored against the source. Two of 22 references were wrong; the 0.85 identity floor
  the draw was supposed to hold would have excluded both.

**Result (21 test pages, 2 judges; fidelity median / mean, rates pooled over judge-pages).**

| engine | fidelity median | mean | invention | omission | inversion | 1st place (Opus / Sonnet) | $/page realtime | $/page batch |
|---|---|---|---|---|---|---|---|---|
| gemini-3-flash-preview | 5 | 4.79 | 2.4% | 0% | 0% | 20 / 20 | $0.0024 | $0.0012 |
| gemini-3.1-flash-lite | 5 (Opus 4, Sonnet 5) | 4.43 | 4.8% | 4.8% | 2.4% | 14 / 16 | $0.0011 | $0.0005 |
| MITRA-MT (gemma-2-mitra-it) | 3 | 2.64 | **50%** | 33% | 7% | 0 / 1 | self-hosted | see below |

- **Issue rule: NOT met.** MITRA beat flash on fidelity on **0 of 21** pages for Opus and 0 of 21
  for Sonnet (one tie). Specialist "wins by ≥ 1.0"? The opposite: it trails by 2.
- **Handoff rule:** eligible = flash and lite (lite's pooled median 5 is within 0.5 of flash's 5;
  invention 4.8% ≤ 2.4% + 5pp). Cheapest eligible = **lite**. Read with care: Opus alone puts
  lite's median at 4 and gave it 2 of the 3 non-flash inversion/omission flags (Toh 8 F.393.b:
  lite 2/5 with an omission; Toh 94: lite's "does not approach" inverted). n = 21.
- **Judge agreement:** exact fidelity agreement 68%, within one point 97%, mean |Δ| 0.35; the
  judges shared a first-place engine on 21/21 pages.
- **What MITRA did wrong** (judges' reasons, checked by eye on four pages): invents lines with no
  counterpart ("one should not stand in the notion that form is empty"), misnames Subhūti as
  Subhadra, and on 4 of 22 pages fell into a repetition loop until the 1,024-token cap
  (Nirvikalpa-jñāna-prabhāsa-svabhāva-… for 1,000 tokens on a title leaf). Its clean pages read
  like 84000 prose, which is the training-data echo the issue warned about; the errors are on the
  manuscript readings.
- **Throughput / cost, MITRA:** 37.6 s per page sequential in eager mode (12 tok/s), 47 tok/s
  with four concurrent requests; at that rate 150K pages ≈ 400 L4-hours (order €300 at list price,
  before CUDA graphs or quantisation), for a translation two points worse.
- **Spend this run:** Gemini $0.0764 (44 calls, all `STOP`); Scaleway L4 powered on 22:28Z, API
  poweroff confirmed `stopped` 22:53Z (~25 min; the 80 GB volume is kept, Derek's call); judges on
  subscription (10 lean-worker dispatches, ~0.9M tokens).

**Verdict.** Do not hold the $430 for the specialist; MITRA-MT is out for manuscript-OCR Tibetan.
Between the two Gemini arms the pre-registered handoff rule picks lite at roughly half the price;
flash is the safer engine on Opus's reading (median 5 vs 4, no inversions). Which of the two runs
the retranslation is Derek's call, not this experiment's; nothing was flipped.

*Replicated?* No (single run, n = 21 pages, 2 judges). The reference set is now reusable
(`refs-final.json` in the run data dir, ops repo) for a larger draw.
*Artifacts:* `results/tibetan-mt-ab-2026-09-25.json` (controls, per-engine, per-judge, both rules,
per-page table with reasons); `results/tibetan-mt-ab-2026-09-25/` (arm outputs, blinding key,
judge verdicts, the three control attempts); scripts `scripts/eval/tibetan-mt-ab/`; judge
prompt `tibetan-mt-ab/JUDGE-PROMPT.md`; sample + references + packet (with the 84000 text) in
the ops repo `handoffs/data/2026-09-25-mtab/`.


## 2026-09-24 — Are the scans in order, and is every page's translation all there? Five exact page-integrity detectors over the whole mirror

**Question.** A reader who turns a page and meets a leaf missing, the same leaf twice, or a
translation that stops a third of the way down never knows it: the text is healthy and the
image is right. Can exact checks over the text we already store find these, and how many are there?

**Design.** One walk of the local mirror (`scripts/audit/page-integrity.mjs`; pure detectors in
`scripts/lib/page-integrity.mjs`): 64,990 books, 6.78M pages, 5.11M translated, zero Atlas page
reads, 7 minutes on 16 processes. (1) catchword of page N vs the opening words of N+1; (2)
printed `<page-num>` sequence fitted at the book's rate (1, ½, 2 per scan), 1–2-number misprint
runs removed as outliers, a break excused as `misnumbered` only when the pages CHAIN (catchword or
a hyphen-broken word); (3) OCR of N vs N+1 and N+2 (word-bigram Dice ≥ 0.9 after ſ/f and
hyphen folding) — the same page, or the same two-page opening, twice; (4) translation vs source
reading length (letters + digits, so tables/LaTeX/entities do not count), normalised by the
language's median; flag < 0.5 of median, and in languages whose ratio varies widely (Tibetan,
Sanskrit, Hebrew, Arabic, Persian …) also < ½ of the language's 5th percentile; (5) a run of
≥ 120 folded chars shared by translation and source, and the *whole-page* tier where that run is
≥ ½ of the translation. OCR vintage and translation prompt from a read-only Atlas sample of
1,500 books. Precision from 20 hand-read flags per detector (one per book, fresh seed, final
code); the duplicate class by the IMAGES (pixel correlation of the two photos vs an ordinary
neighbour, 3 by eye).

**Result.**

| class | flagged | books (visible) | precision, final read of 20 | repair cost |
|---|---:|---:|---|---|
| duplicate captures (a page / an opening photographed twice) | 30,186 pages | 4,249 (3,328) | **20/20 real, by image** | $0 model; hide the copy (#1721's `duplicate_of`) |
| repeated-page books (≥ 20% of pages repeat) | 3,557 of 9,771 pages | 198 (121) | 6 worst checked: 4 IA items serve ONE image for every page, 1 same OCR on different images, 1 real double captures | fix image source, re-OCR + translate ≈ $56 |
| page-number break not explained by a duplicate | 20,933 breaks | 6,472 (5,084) | 9 real (4 missing pages, 5 duplicates the Dice missed), 8 false, 3 unclear | human triage; re-source missing leaves |
| truncated translation | 66,525 pages | 7,437 (6,994) | **10 real, 0 false**, 10 unclear (editor's notes / footnotes not rendered) | re-translate ≈ $233 realtime, ≈ $116 batch |
| echoed source, whole page | 4,598 pages | 1,503 (1,363) | 12 real, 7 false (tables, sigla, transliteration), 1 unclear | re-translate ≈ $16 |
| echoed source, partial run | 26,731 pages | 4,183 | 3/20 — kept quotations; **not a class** | — |
| catchword break | 256,271 of 1.60M judged boundaries | 26,719 books | **1/20** (and that one a duplicate scan); not a class | — |
| OCR field holds the model's reasoning (side find) | 25 pages | 24 (23) | 25/25 | re-OCR |

Duplicate captures are a partner-library defect: **1,031 of 2,322 BPH books** (and 113 of 1,511
Kloss) carry them, against 1,111 of 6,643 IA and 347 of 5,546 BSB books — the #1721 manual-upload
re-shoots, library-wide; #1721 repaired 42 books, and 10 of the 14 of those found here still carry
flags (132; one checked by image, r=0.91 vs 0.35 — its dHash ≤ 2 was too strict). The
repeated-page books are the reverse case (`lesson_text_image_mismatch_has_two_sides`): Ishvara
Pratyabhijñā's IA item returns byte-identical images for leaves n40 and n200, so 325 of 347 pages
show one title page — the reader sees one page 300 times.

*Vintage (1,500-book sample).* `<page-num>` is on 67–75% of v3/v5/v10/batch OCR pages and on
0.3% of imported text; catchwords on 16–54%. Duplicated openings concentrate in the v5 lane (768
pairs, 73 books — the Feb–Mar 2026 manual uploads). Truncation by translation prompt: v10 2.1%
(99 books), prompts-collection 11 1.5% (62), v1 2.2% (19), v2 0.3%, v5 0.02%; v11 and v13 are one
book each (an SBE Enoch, a Migne Greek/Latin) and say nothing about the prompt.

*Positive controls.* Atalanta fugiens: catchwords chain 183/196, page numbers 0 breaks after 19
misprint outliers. The 197 held wrong-leaf books (#4790): the catchword chain holds on 51% of
judged boundaries vs 82% in a matched random sample — detector 1 lights up; detector 2 does NOT
(break rate no higher than random), as it should not: that defect offsets text from images and
leaves the printed sequence in order. Batch-lane drafts (#4681): Latin p.12 at 0.33 of production
flags; p.89 at 0.04 is a 292-char diagram page, excluded by the prose gate (a documented miss).
Italian p.109's repair echo flags (whole page). Tests: 40, every one of 10 mutants fails the suite.

**Found on the way — the false shapes, each now a test.** The model records a page's own LAST
WORD as the catchword (and invents catchwords for modern books); a sentence merely left open is no
evidence that two scans are in order (most pages end mid-sentence — the first `misnumbered` rule
hid duplicated openings and would hide missing leaves); page numbers on plates; `&nbsp;`, LaTeX
and HTML-encoded Greek inflating a source 2–10×; untagged Greek+Latin crib pages; English inside a
source counted as echo; a line beginning with the word "thought" read as leaked reasoning (19/20
false before the rule was tightened).

*Replicated?* No — one walk (the fifth; the first four were stopped as the hand-reads found
shapes), one final hand-read per detector. The catchword and partial-echo detectors are recorded
as NEGATIVE results: do not rebuild them as leaf-order or translation-failure detectors.
Artifacts: `scripts/eval/results/page-integrity-handread-2026-09-24.json` (every label),
`page-integrity-repair-<class>-2026-09-24.jsonl.gz` (six lists), `page-integrity-2026-09-24.summary.json`;
the per-boundary flag file (109 MB) is regenerable in 7 minutes and is not committed.
Issues: truncated #5055, duplicate captures #5056, repeated-page books #5057, whole-page echo #5058, page-number breaks #5059.

---

## 2026-09-24 — How often does a translation put text on the wrong page? Intra-block drift (#5021) and continuity leakage (#5026)

**Question.** (a) How often does block translation (8 pages per prompt) finish page N's last
sentence with page N+1's opening words? (b) How often does a page's translation reproduce
the previous page's text, and does the current lane still do it?

**Design.** Walk of the local mirror (`scripts/audit/translation-page-boundaries.mjs`, 64,990
books, 20,996 with ≥2 translated pages, 5.19M consecutive translated pairs, zero Atlas page
reads). Drift = `scripts/lib/block-drift.mjs` (source N+1 opens mid-sentence with a clause, the
translation doesn't, and N's last sentence grew by about the clause's length). Leak = shared run
≥200 chars between consecutive translations after stripping editorial blocks; pairs whose
SOURCES share such a run are excluded. Segmented by `translation.prompt_version`/model/month on
a random 1,500-book sample, with metadata read from Atlas (55 of 374,576 pairs were dropped
because the mirror text no longer matched). Hand-read: one flag per book.

**Result — drift.** 77,775 of 3.83M in-block prose boundaries flagged (2.03%, 9,315 books);
Greek 4.5%, Russian 3.1%, Latin 2.5%, English 2.0%, German 1.6%; caseless scripts ~0 by
construction. **Precision on a fresh sample of 20: 9 real, 8 false, 3 unclear.** The control is
prompt version, not block position: the single-page lane (v2/v5, cannot move text) flags
0.70–0.86%, which is the detector's floor. Block-era v10/v11 flag 2.0–2.4%. So ≈1–1.5% of in-block
boundaries really have a clause on the wrong page. Reconstructed in-block vs block-start boundaries
flag at nearly the same rate (2.03% vs 1.78%), so the block partition cannot be recovered from the
mirror; don't use it as a control. The first cut (steps 1–4, no length test) flagged 4.7% at
6/20 precision — the length test is what makes it usable. Known misses: Saffo 58→59 (N ends in a
long quotation, score 0.45), verse boundaries (capitalised lines), German fragments opening on
a noun.

**Result — leak (#5026).** 43,250 flagged pairs (0.83%). By position of the shared run: 
*forward duplicate* (N+1's opening also at the end of N) 8,092 — 7/7 hand-read real, **0.00% under
v2/v5, 0.2% under v10/v11, 0.45% under v13** (21 books; small) — a block artefact, same family as
drift; *N's head reproduced in N+1* (the #4968 context-slice shape) 4,365, of which runs ≥500 chars
(2,313 pairs, 1,240 books) were 4/4 real and runs under 500 were 0/6 (Loeb facing pages, proof
formulae, sutra openings). **≥500-char context leak: v2 0.11%, v5 0.07%, v10/v11 0.02%, v13 0 of
6,671 pairs.** Atalanta control: 21/21 flagged, 12/21 fall in the n-head class. So the context
leak is mostly a single-page-era defect; the current block lane duplicates forward instead.

**Prompt fix: not supported.** Smoke on the three production drift boundaries (6 flash-lite calls,
≈$0.004): a "keep each page's text on its page" instruction fixed none and turned 30→31 into a
duplicate. Shipped the parser reject only (both shapes → the two pages re-translate single-page).

*Replicated?* No — one walk, two 20-flag hand-reads (the first was the tuning set).
Artifact: `scripts/eval/results/page-boundary-drift-leak-2026-09-24.json`; fixtures
`tests/fixtures/block-drift/`.

---

## 2026-09-24 — What is the efficient pattern for finding "body instruction" pages across 4.5M pages? (Jev, $8.57 total) — RESULT

**Headline: distil Jev into a linear probe on the page embeddings we already hold, then spend Jev only on the probe's top.**
Fresh check: of the probe's top 1,343 never-labelled pages (≤ 3 per book, 926 books), **44.5 % are Jev-positive**
(≥ 0.5), against **0.9 %** at random and **15.6 %** for the best Jev-only cascade. Scoring the whole corpus with the probe
is free and takes seconds; the verification pass cost **$0.08**.

**The steps and what each measured** (scripts in `scripts/eval/jev/`, rubric = the instruction-page judge prompt):
1. *Random base rate* — one random translated page from each of 21,018 books: 0.89 % ≥ 0.5, 0.07 % ≥ 0.9 ($1.08).
2. *Book screen* — Jev on each book's catalogue title+summary+categories (21,107 books, $0.42): at ≥ 0.5 keeps 32 % of
   pages, recall 91 % of the random-sample positives.
3. *Page `<summary>` only* — AUC 0.98 vs the full-page verdict, but only ~2.7× cheaper (question text dominates) and
   only 58 % of pages carry a summary ($0.23).
4. *Chapter summary* (the chapter's page summaries joined; chapters = `books.chapters`, 16,431 books, titles only) —
   AUC 0.96; at ≥ 0.2 keeps 11.6 % of pages, recall 92 %, ~57 tokens per page covered — ~20× cheaper than full pages.
   **Gap:** ~40 % of pages have no summary and they held about half the positives.
5. *Cascade at scale* — books ≥ 0.7 → 40,446 chapters → full pages of chapters ≥ 0.5 (stopped at the $8.50 cap after
   87,566 pages): 15.6 % ≥ 0.5, 1,375 pages ≥ 0.9 from 151 books.
6. *Embedding probe* — logistic regression on the 768-d `gemini-embedding-2-preview` page vectors (`~/sl-corpus/emb`,
   snapshot 2026-09-10) trained on 67,109 Jev-labelled pages: **AUC 0.949 on held-out BOOKS** (GroupKFold by book; the
   embeddings cluster by book, so a page split would flatter it), 0.977 on the random sample; top-50 of the random
   sample 34 % positive vs 0.3 % base. Then the fresh check above.

**Read by eye (18 of the fresh ≥ 0.8):** real finds no keyword search had reached — computus finger-counting, a Tamil
*Sara Nul* (science of breath), Sarum liturgy movements, the Shīʿa takbīr, Avicenna on exercise, Mersenne on the lute
hand, the Ars Notoria bed rite. Edge class: surgical/bloodletting procedures (body instructions, not practices) — the
companion Choice question files most of them as `none`, so filter on it.

**Not shown.** Labels are Jev's, not people's (Jev itself was AUC 0.94 vs Sonnet judges, #5006 pilot). Pages newer than
the 2026-09-10 embedding snapshot are invisible to the probe. One probe, one C; no per-kind probes; untranslated
pages untested.

*Replicated?* No. **Artifact:** `scripts/eval/jev/` (stage1–6, `probe.py`); results in the session scratchpad.

---

## 2026-09-24 — Can Jev (TypeSafe's typed-decision model) screen pages for "this tells a body what to do"? — RESULT

**Headline: yes, as a first-pass filter.** One Noul question worded from the instruction-page judge rubric
(`~/sourcelibrary-atlas/scripts/graph/instruction-pages-JUDGE-PROMPT.md`) over the 292 pages Sonnet judges labelled
on 2026-09-13 (144 instruction / 148 not): **AUC 0.94; 0.99 on the 194 pages the judges marked ≥ 0.85 confident.**
At threshold 0.3: accuracy 0.87, precision 0.93, recall 0.81, κ 0.75 (the two blind judges on H7 agreed at κ 0.86).
A naive one-line question does worse (AUC 0.89): the rubric wording matters. Cost for all 507 calls: **$0.019**
(~900 input tokens/page), 8 concurrent, 0 failures, ~0.2 s/call.

**Controls.** Negative: 133 random translated pages from the local mirror — 1 scored ≥ 0.5 (a Vajravārāhī sādhana,
plausibly a true find). Positive: the 82 quoted translations on /blog/techniques-of-the-body — 67 ≥ 0.5. The misses
are read by eye and are mostly *reports*, not instructions (Santorio weighing himself, Guarinoni watching handball,
Iamblichus' signs of possession, Marinus on Proclus' day, a bare list of the eight kumbhakas) — the rubric excludes
reports, so Jev is applying it more strictly than the page's curation did. Disagreements with the judges are mostly
ethnographic dance descriptions the judges themselves were unsure of (conf 0.55–0.7).

**Not shown.** Labels are Sonnet judges, not people. No test on untranslated OCR text (the state was English
translations). One prompt wording beyond the naive one. Recall on a fresh pool is unmeasured — the next step is a
wide candidate pool, human-read at the top.

*Replicated?* No. **Artifact:** `scripts/eval/jev/instruction-page-pilot.py` (gateway endpoint
`https://ai-gateway.vercel.sh/typesafe/v1/systemone`, model `typesafe-ai/jev`; a Vercel OIDC token from
`vercel env pull` works for 12 h). Results were written to the session scratchpad, not committed.

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
## 2026-09-17 — Does translation survive the Batch API? The block-boundary continuity A/B (#4681, prereg #4905) — RESULT

**Headline: by the rule as written, nothing passes (rung 5, "do not migrate") — but the
rule's H1 bound turned out to be unreachable, and production run twice against itself
fails it by more than any arm did. What the experiment actually established: the
cross-block seed is NOT buying nothing. A blind judge prefers chained production over
naive batch 41–11 at the seam. A one-page second pass that repairs only the seam page
(arm E) ties production 27–27, touches nothing outside the seam, and costs +15% on top of
batch. Migration is Derek's call; the evidence points at "batch + seam repair", not at
"stay" and not at "plain batch".**

*Question.* Production translates 8 pages per prompt and hands the next block the first
2,000 chars of the previous block's last-page translation. The Batch API (half price,
≈ $149/mo saved) cannot do that. Does anything measurable get lost at that one seam in
eight, and if so what is the cheapest way to get it back?

*Design.* Paired, `gemini-3.1-flash-lite`, production prompts (Standard Translation v13,
English Modernization v1), block size 8, unit = one block BOUNDARY per book. **58
boundaries** (60 planned; Chinese gave 4 of 6) stratified on what production translated
2026-09-01..17: English 23, Latin 16, Chinese 4, Arabic 4, French/Hebrew/German 2 each,
Spanish/Dutch/Tibetan/Greek/Malay 1 each. 57 scored (one lost arm C's seam page). Block
k−1 translated once and shared. Arms: **A** chained (production) · **B** unseeded (naive
batch) · **C** seeded with the previous page's OCR source · **D** previous page re-sent as
an overlap and discarded · **E** second pass repairing B's seam page only. D and E were
added by Amendment 1 and each ran only after the rung above failed.

*The draw is explained, which is how an inert probe is ruled out.* 209 candidate seams
rejected: 103 untranslatable page in the 16-page window, 44 a block over 20,000 OCR chars,
38 a seam page under 400 chars of prose, 12 block k opening on a heading, 7 off the end of
the book, 4 non-prose seam page, 1 page under 200 chars. 40 of 58 seams end mid-sentence.

*Controls.* (1) **H1's probe fires:** real cross-boundary consistency is 73.8% against
3.8% [1.5, 6.8] when the same pages are scored on another same-language book's terms.
(2) **The harness runs production's configuration:** on block-k pages already translated
by the current prompt and model, arm A reproduces the stored text as closely as two
harness runs reproduce each other (strict match 8 pages/1 book, 0.986 vs 0.985; looser
version-label match 32 pages/4 books, 0.57 vs 0.70; floor 0.06). Stored translations were
NOT used as a scoring reference — they span eight prompt generations. (3) **Nothing was
written to `pages`:** sha256 over all 928 sample page documents identical before and
after. (4) Positive-control unit tests for the term scorer, the seam filter and the prompt
builder (`tests/unit/translation-batch-continuity-ab.test.ts`).

*Result.*

| arm | H2: judge prefers A / arm / tie | A's share (limit 60%) | H1 whole block k | H1 seam page only | H3 body vs A |
|---|---|---|---|---|---|
| A production | — | — | 73.8% | 72% | — |
| B unseeded | 41 / 11 / 5 | **76.3% FAIL** | 66.7% | 40% | +0.4% |
| C source-seeded | 32 / 16 / 9 | **64.0% FAIL** | 71.4% | 48% | −0.1% |
| D overlap | 30 / 21 / 6 | 57.9% pass | 64.3% | 32% | −2.0% |
| E seam repair | 27 / 27 / 3 | **50.0% pass** | 69.0% | 72% | +0.5% |
| *A2: A run again* | *not judged* | — | *64.3%* | *80%* | *+0.9%* |

- **H1 cannot discriminate at this n, and the rule needed it to.** Only 17 of 57
  boundaries carry a term block k−1 tagged whose source form recurs in block k (42 terms).
  Every arm fails the −5pp paired bound (B −13.9, C −10.0, D −23.5, E −11.8 lower bounds) —
  and so does **A2, production run a second time: −12.0pp [−25.5, −1.2], 0 better / 4
  worse.** A bound that production fails against itself is not a quality bar. A2 was post
  hoc and descriptive; it is the most useful number here for reading the rest.
- **The seam-page column is where the signal is**, and it agrees with the judge: arms that
  see the previous page's *translation* (A, A2, E) sit at 72–80%; arms that do not (B, C,
  D) sit at 32–48%. Seeing the previous page's *source* (C, D) does not carry renderings
  across — which is why D, rated above E before the run, measured below it.
- **H2 is decisive for B.** 41–11 (sign p < 0.001), no left/right bias (25 of 52 LEFT).
  The judge's reasons are concrete: a dangling clause picked up or dropped, "Allah" kept vs
  switched to "God", "powers" vs "faculties", header and gloss conventions.
- **E did not show the invention its prior predicted**, with the source page in the prompt:
  median seam page 96% similar to B's (p10 63%), length ratio 0.997, invented tags
  unchanged, **zero pages outside the seam altered** (by construction: it never sees
  them). One caveat: the A/E judges picked LEFT 34 of 54 — a mild position lean the
  randomised sides mostly cancel, but it makes 27–27 softer than it looks.
- H3 passes everywhere. One outlier worth knowing: a single Arabic boundary under C emitted
  534 `<foreign>` tags; the gate was (correctly) not decisive on one book.

*Decision-rule branch that fired:* **rung 5 — nothing passes; do not migrate; report the
cost of the quality.** Reported as written. The honest reading is that the rule's H1 leg
was mis-specified for n = 17, so E "fails" on a leg production also fails; on the two legs
that can discriminate (H2, H3) **E passes and D passes, B and C fail.** A re-run to confirm
E before shipping it should drop whole-block H1 for the seam-page rate and judge A2 as
well, so H2 has a noise floor too.

*What E costs in production.* A second batch job over one page in eight: measured +15% of
B's spend here at realtime rates. It needs block k−1's output first, so it is a two-stage
batch (translate everything unseeded, then repair seam pages), not a single submission.

*Considered and excluded:* scoring against published translations — a different estimand
(absolute quality, not production-vs-batch), covered by #4883 and the Tibetan benchmark.

*A trap caught in-run:* re-emitting judge packets AB and AC alongside the new AD pair moved
their left/right flips (one seeded stream), so the key on disk stopped matching what the
judges had read — 59 of 114 entries would have been wrong. Caught before any verdict was
scored; packets verified byte-identical to the files the judges read; `--pairs/--only` now
makes emission order-stable.

*Spend:* **$2.72** metered at `eval/translation-batch-continuity` (A/B/C $1.74, D $0.47,
E $0.07, A2 $0.44) against a $3.00 estimate and a $5 ceiling. It counted against the
2026-09-17 daily dial. Judge: 8 blind Claude subagents, not metered Gemini.
*Replicated?* No — single run, k = 1 per arm; A2 is the only replicate and it is why H1 is
read the way it is. *Artifacts:* `translation-batch-continuity-ab.mjs`,
`PREREGISTRATION-translation-batch-continuity.md` (eight dated amendments, each before the
output it governs), `results/translation-batch-continuity-{sample,arms,report-2026-09-17,
judge-packet-*,judge-key,judge-verdicts,harness-control*,e-rewrite}`.
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

## 2026-09-21 — Which engine should read Greek print, per period? (#4925 step 2, #4744)

**Headline: for 1700–1799 (53 referenced books, decision-grade) production flash-lite is
inadequate by the preregistered threshold (median CER 0.107, CI 0.077–0.122, threshold 0.10)
and flash-preview is the preferred reader (median CER 0.085, Δ −0.018 [−0.024, −0.009], 46
wins / 6 losses, 0 vs 1 catastrophic). Kraken greek-cllg reads the letters as well as preview
(0.082) but is closed for the period: it clears Δ ≤ −0.05 on 15 % of pages, not the 60 % the
better-reader rule needs. For 1450–1699 the cell holds 48 referenced books, two short of 50,
so it is DIRECTIONAL: lite 0.170, preview 0.088 (48 wins / 0 losses), Kraken 0.091 (46/1/1).**

- **Design.** `PREREGISTRATION-greek-ext-4925.md`. One Greek-majority interior leaf per book,
  typeset print only, by-eye `greek_share ≥ 0.5`; references from First1KGreek / Perseus /
  el.wikisource; Greek letters only are scored. Arms: flash-lite, its repeat, flash-preview
  (all `temperature: 0`, `thinkingBudget: 0`), Kraken greek-cllg on Hetzner CPU. Spend: $1.36
  Gemini (approved ≈ $2).
- **Spot check by hand (2026-09-21) — read before quoting any number here.**
  1. The ranking holds on the image: on the 1531 Aristotle page Kraken reads *ἐστὶ θεῶν πλέα τε*
     correctly, preview writes a fluent wrong *διὰ θεῶν τελέα τε*, lite garbles the line.
  2. **The noise floor cannot fail in this design.** At temperature 0 the repeat read is
     byte-identical on 91 of 101 cell pages; Δ₀ = 0 measures API nondeterminism, not reading
     variance. Rule (d) is reported as untested, not as passed.
  3. **The preregistered invention metric was degenerate for lite**: "in neither the reference
     nor any other engine" lets the identical repeat vouch for lite, so lite scores 0 on nearly
     every page and no arm could ever pass "invention ≤ lite's". DEVIATION, recorded: the
     scorer now also writes `invention_indep` (a repeat arm never vouches for its twin) and the
     decision file reports all three definitions. Preview passes under `invention_indep` and
     `invention_ref`, fails only under the degenerate literal one. Kraken's verdict does not
     depend on invention in either period.
  4. Kraken's "invention" is word segmentation (run-together words, line-break fragments), not
     hallucinated text. Describe it that way.
  5. A reference is a modern critical edition; where the early edition prints a different text
     (the 1538 New Testament against Westcott–Hort) every arm carries the same ≈ 0.16 floor.
     This compresses differences; it does not favour an arm.
  6. **Selection caveat.** A page gets a reference only if the preview read locates a window
     (overlap ≥ 0.35). Pages preview reads worst are therefore under-represented, which can only
     flatter preview. Six pre-1700 in-cell pages were dropped this way.
- **Reference-builder bug fixed.** A tie between two EDITIONS of the same work voided the
  identification (Eusebius 1544, 32/40 phrase hits, discarded). A tie now voids only against a
  different work: +1 reference pre-1700, +1 in 1700–1799, none lost.
- **Not settled.** Pre-1700 needs two more referenced books, by drawing further down the sealed
  walk (412 of 3,525 books walked) — never by lowering the overlap threshold. Rule (d) needs a
  repeat arm at temperature > 0 to mean anything.
- **SUPPLEMENT, same day (greek-ext2, seed 47442, Derek approved 10 pages).** Rule (e) says a
  shortfall is a draw-more item. Ten more pre-1700 books were sealed as a separate file (every book
  in greek.json / greek-ext.json excluded; 66 books walked). By eye, before any engine output was
  read: 9 typeset Greek leaves, 1 codex (excluded). 8 of the 9 found a reference. **Pre-1700 is now
  decision-grade at 56: lite 0.171 [0.159, 0.188] = inadequate; flash-preview 0.090, Δ −0.068
  [−0.093, −0.057], 55W/1L = preferred; Kraken 0.088, Δ −0.054, 52W/3L/1T, and it passes the
  better-reader rule at 60.7 % of pages (34 of 56) against a 60 % bar — ONE page. An independent
  recompute puts that share at 57 %. Treat Kraken ≈ preview on letters, not "Kraken wins".** Spend
  $0.11. Optional-stopping note: the supplement was drawn after seeing results, but its size was
  fixed beforehand, the remedy is the preregistered one, and no verdict turned on it except that
  knife-edge. The numbers above in this entry's headline are the pre-supplement state.
- **THE ABSOLUTE NUMBERS CARRY A FLOOR THAT IS NOT READER ERROR (second spot check).** The scorer
  replicates: independent code matched 18 of 18 values within 0.01. But a word diff of preview on
  median 1700s pages shows the charged "errors" are mostly convention — sentence capitals, grave vs
  acute, δ' vs δὲ, γίγνεται vs γίνεται — plus footnote apparatus the modern edition lacks (one
  "error", Κράτης for Σωκράτης, is probably the early edition's true reading).
  `benchmark-convention-floor.py` removes those layers (median CER, strict → tolerant):
  pre-1700 lite 0.174 → 0.127, preview 0.093 → 0.052, Kraken 0.094 → 0.049; 1700–1799 lite
  0.112 → 0.051, preview 0.088 → 0.033, Kraken 0.090 → 0.040. **So rule (a)'s thresholds, borrowed
  from the 19th-c cell, do not transfer: "lite inadequate for 1700–1799" is WITHDRAWN (tolerant
  0.051 sits on the adequate line; preview's edge is ≈ 1 character in 100 at 3× the price).
  Pre-1700 "inadequate" stands under both measures.** Paired rules survive because every arm pays
  the same floor. Next benchmark over early print: score convention-folded, and set adequacy
  thresholds from the cell's own best-of-arms floor, not from another period.
- **Files.** `results/benchmark/greek{,-ext,-ext2}-2026-09-21.json`, `benchmark/greek-ext2.json`,
  `results/benchmark/decisions/greek-period-*-2026-09-21.json` (the `prereg` block is the
  verdict; the generic `verdict` string is the step-1 cost-lane rule and does not apply to a
  3×-cost arm). Raw reads: `~/sl-benchmark-reads/greek-4925-2026-09-20/` on Derek's laptop.

## 2026-09-24 — contact-sheet screen for illustrated pages (#5009)

**Question.** Books filled with free Internet Archive text carry no `<page-type>` or `<image-desc>`
markup, so `image-extract-worker.mjs` finds zero candidates and marks the book `images_complete`
having looked at nothing. Can one vision call over a GRID of page thumbnails find the illustrated
pages instead, cheaply enough to run over a whole shelf?

**Tool.** `scripts/eval/contact-sheet-screen.mjs`. Reference labels are `gallery_images` rows —
detections that survived the 0.5 quality gate and `isTrivialGalleryDetection` — NOT raw
`detected_images`. Six illustration-rich books, 491 pages, 188 labelled pages. Arms are PINNED to
the same six books (`--book-ids`); `$sample` redraws every run and the misses are strongly
book-specific, so an unpinned arm measures the draw.

**THE INSTRUMENT WAS THE FIRST RESULT, AND IT WAS WRONG TWICE.** Reported in order, because the
shape recurs:

1. First run: recall **72.9%**. Reading the misses by eye showed 30 of 51 were large, full-page
   woodcuts — too conspicuous for a downsampling story. Grouping by sheet showed why: the misses
   arrived in whole blocks of sixteen. Eleven of 33 sheets returned zero hits while their
   neighbours scored exactly right (8/8, 10/10, 6/6).
2. The cause was one line of parsing. The model answers in **either** envelope — `{"cells":[...]}`
   as asked, or a bare `[...]` array. v1 read only `parsed.cells`, found `undefined` on a bare
   array, and scored all sixteen cells as "no picture". **A discarded valid answer was
   indistinguishable from a confident negative.**
3. Interim fix (retry + exclude non-answering sheets) gave **88.3%**, still wrong: the sheets that
   happened to use the asked-for envelope were a biased subset. Only accepting both envelopes gave
   full coverage and the honest number.

Guards now in the script: three attempts, one cell required per page, both envelopes accepted,
never-answered sheets reported loudly and **excluded from the rates rather than counted as
negatives**. See `lesson_partial_artifact_read_as_total` and
`lesson_absence_is_not_failure_no_silent_skips` — this is a third instance.

**Results** (same six books, full coverage):

| arm | prompt | density | recall | precision | $/page screened |
|---|---|---|---|---|---|
| A | v1 | 16 @ 384px | 65.4% | 83.1% | $0.000134 |
| B | v2 | 16 @ 384px | **79.3%** | 83.7% | $0.000128 |
| C | v2 | 9 @ 512px | 78.7% | 82.2% | $0.000162 |
| **B ∪ C** | v2 | both | **93.6%** | — | $0.000290 |

**The prompt was worth 13.9 points, free.** v1's exclusion list said "text-only pages", and the
production extractor catalogues **a staff of musical notation** as an image — 13 misses in
*Le Jeu de Robin et de Marion* were typeset text pages carrying medieval notation, confirmed on
all 13 by eye. v2 names notation, heraldic arms, and sparse line art explicitly, and warns against
**show-through** (v1 twice called ink bleeding from the far side of a leaf a "heraldic coat of
arms", while missing the real painted shield on the facing page).

**Precision is understated by the reference, not by the screen.** Of 29 hits with no gallery row,
20 were flagged by OCR as well; the expensive pass agreed and the 0.5 quality gate rejected them
afterwards. And at least one *miss* is a label artifact: `Nieuwe Maniere` p43's row describes a
fold-out bastion plan, but the leaf we hold scans nearly blank — the screen is right there.

**Resolution is NOT the dial — the misses are stochastic, and that is the design finding.**
Arm C gives the model 78% more pixels per page and recall does not move (78.7% vs 79.3%) at 27%
more cost. But B and C miss almost *different* pages: of ~40 misses each, only **12 are shared**;
512px recovers 27 that 384px missed and loses 28 that 384px caught. The model is inconsistent
rather than blind, so **two cheap passes at different tilings beat one pass at any density** —
`B ∪ C` reaches **93.6%** recall for $0.00029/page, still **6.8× cheaper** than one
full-resolution page call ($0.00196). Only 6.4% of labelled pages are missed by both.

Union-ing costs nothing in practice because a false positive is just one extra full-resolution
call on a page that was going to be cheap either way. My "fine hatched engravings need more
pixels" hypothesis was wrong and is withdrawn: the residual misses are not a contrast problem.

**Not measured.** Whether the screen finds pictures on free-filled books where there is no
reference at all — by construction those have no labels. Recall here is measured against what
production already found on books that went through the expensive path.

---
## 2026-09-24 — Batch API translation lane, first live shadow run on three books: A/A floor, blind judge vs production, and what the Batch API did (#4681 steps 3–4; PRs #5000/#5011/#5013)

**Headline: the lane runs end to end on real books and writes what it should (nothing, in shadow),
but the Batch API cancelled 8 of 15 jobs, and the judge result is too thin to call. Where a page
break actually carried a sentence, production was preferred over the repaired lane 4–1 and over
plain batch 4–2; the same-lane A/A control tied 79% and split 2–1. This does not reproduce the
#4912 tie (27–27, n=57) and is not a flip signal. Decision stays with Derek; the lane is not the
default and nothing is scheduled.**

*Design.* Three untranslated books, terminal status: *Über das optische Formgefühl* (de, 1873,
65 pp), *Vita e Frammenti di Saffo* (it, 1863, 106 pp), *Mélanges d'alchimie* (la manuscript,
95 pp). Arms on the same pages: **S1** and **S2**, two independent shadow runs of
`translate-batch-worker --shadow` (batch translate + seam repair, arm Et byte for byte, drafts and
repairs kept on the run document, nothing written); **P**, the realtime `translate-worker` on the
same books afterwards (production code, writes pages). One blinded packet: at every block
boundary of S1, a junction = end of page N + start of page N+1 from one lane; pairs **S1/P**
(the test) and **S1/S2** (the judge's noise floor) interleaved, left/right flipped by seed, ids
opaque (`j001…`; a first build leaked the pair type in the id and was rebuilt before any
verdict). 48 junctions: 32 S1/P (20 repaired-lane, 12 plain-batch), 16 S1/S2. Eight independent
Claude (Sonnet) judges, six junctions each, LEFT/RIGHT/TIE + one sentence. Harness:
`translation-batch-shadow-judge.mjs` (`--packet`, `--score`); results in
`results/translation-batch-shadow-*`. Envelope `batch-shadow-4681`: **$0.53 spent** of $1.50
(shadow ×2 with retries ≈ $0.25, realtime ≈ $0.28); closed after.

*What the Batch API did.* 15 jobs submitted inline on `gemini-3.1-flash-lite`: 4 translate jobs
and 4 repair jobs died — whole jobs `JOB_STATE_CANCELLED`, or `JOB_STATE_SUCCEEDED` with every
request `{ error: { code: 1, message: "The operation was cancelled." } }`. Before PR #5011 the
lane read only the success shape and marked such a run `shadow_complete` with 0 drafts and its
meter row `success` at $0. Two one-request grids (~$0.01): not the request shape — the exact
request succeeded while trivially different cells were cancelled; a file-based submit (PR #5019)
was cancelled 10/10 too. Web: same errors reported on Gemini 3.x flash models through 2026, no
Google fix, retry is the only mitigation; repo: the OCR orchestrator forces file input for Lite
after an inline stuck-PENDING episode, and the file-based OCR lane had a normal day (21 saved,
1 failed). Conclusion: capacity-class, format-independent; a scheduler for this lane needs a
bounded resubmit on "no drafts" and on "no repairs" (a run with drafts and no repairs is arm B,
plain batch, not the design).

*Scope loss.* The Latin manuscript was at `archive_complete`, not `complete`; finalize promoted it
to `ocr_complete` and the realtime worker, funded by the envelope, claimed it before a repaired
shadow run existed (memory: an envelope funds every scoped worker on those books). It became the
plain-batch control. Two repair jobs for it were cancelled first.

| pair | n | tie | decided | winner split | share of decided |
|---|---|---|---|---|---|
| S1/S2 (same lane twice, A/A floor) | 16 | 13 (81%) | 3 | S1 1 – S2 2 | — |
| S1/P, S1 repaired (the design) | 20 | 14 (70%) | 6 | lane 1 – **production 5** | production 83% (p=0.22) |
| S1/P, S1 unrepaired (plain batch, control) | 12 | 6 | 6 | lane 2 – production 4 | production 67% |

Six junctions were **degenerate** (an illegible page, a bare marker, a one-line placeholder) and
were judged TIE; excluding them: repaired lane vs production 11 tie / production 4 / lane 1; A/A
11 tie / 2 / 1. Most remaining ties are page breaks between numbered fragments or at headings —
this draw was NOT filtered for "ends mid-flow" as #4912's was, so the tie rate is inflated by
seams that are not seams and the decided n is small. **Read:** the A/A floor says the judge can
say TIE and does under the null (79%); on the seams that discriminate, production is preferred
by the same judge, 4–1 and 4–2. At n=5 decided this is a direction, not a result; it is the
direction #4912 found for plain batch, and it does not reproduce #4912's tie for the repaired
lane. The three production wins that were read against the source (memory: *by eye means the
image was opened* — here the OCR text): German p.35 opens mid-sentence "…eingeschlagen hat";
production carried the verb, the lane's repaired page lost it. Italian p.109 (an index page): the
lane's repair reproduced garbled OCR verbatim, production rendered the index. Latin p.12→13: not
a misalignment (the judge misread garbled Latin); both lanes translate the same page.

*Found on the side — intra-block page drift is a property of block translation, not of the
lane.* Over 218 page boundaries INSIDE blocks (never touched by the seam repair), 6 (2.8%) have
one lane's text on the other side of the page boundary relative to the other lane. Attributed
against the OCR head of page N+1: **production pulled the next page's opening onto the previous
page in 3** (de 30→31, 41→42; it 58→59), the lane did it in 1 (it 107→108), 1 ambiguous, 1 a
paragraph the lane dropped (it 90→91). Both lanes use the same 8-page block prompt and the same
parser. Body pages otherwise agree: of 228 pages with both texts, 196 (86%) within ±10% length;
5 lane pages under 75% of production's length (one near-empty). Median word-bigram similarity
lane~production 0.67, lane~lane 0.73.

*Not done / next.* No flip, no schedule, no retry logic (#4681 names it). If the question "does
the repaired lane tie production at real seams" is to be answered at n≥50 decided, the draw must
filter to mid-flow seams (reuse #4912's `assessSeam`) and the judge packet must carry the A/A
pairs as here. The intra-block drift deserves its own detector over production (it is live
today at ~3% of in-block boundaries).

*Artifacts:* `scripts/eval/translation-batch-shadow-judge.mjs`;
`results/translation-batch-shadow-judge-{packet.jsonl,key.json,verdicts.json}`,
`results/translation-batch-shadow-body-similarity.json`,
`results/translation-batch-shadow-report-2026-09-24.json`. Runs: `translate_batch_runs`
`tbs_mufjaivx_if4uw8`/`tbs_mufk3x42_g9tgs2` (de S1/S2), `tbs_mufigql9_laf1y7`/`tbs_mufl8fqe_jmdr1x`
(it), `tbs_mufiwfjw_hyekvt` (la, unrepaired). Issue thread: #4681 (2026-09-24 comments).

## 2026-09-24 — can the Archive's own OCR confidence replace the paid reference? NO (#4763, #4784)

**Question.** The free IA text lane admits a book only when the Archive's reading agrees with OUR
model's reading of the same leaves, so every candidate must first be given a paid OCR sample
(today a 25-page Phase 1.5 preview). `ocr-plausibility.mjs` names a free alternative as its own
blind spot: the engine's per-word confidence, `x_wconf` in the Archive's hOCR. If that separated
the books the paid gate rejects, the sample could shrink or go away.

**It is even cheaper to read than that note implies.** The confidence is already in the
`_djvu.xml` the ingester downloads, as `x-confidence` on every `<WORD>` — no extra request, just a
second pass over bytes on disk. `scripts/lib/ia-ocr-confidence.mjs` parses it;
`scripts/eval/ia-confidence-vs-gate.mjs` scores it against the gate's own verdicts. Both free.

**Result: it does not work, and it fails BACKWARDS.** Over 129 books of the #4966 cohort that the
free gate had judged (126 ACCEPT / 3 REJECT):

| | median mean-confidence |
|---|---|
| ACCEPTED | 51.0 |
| REJECTED | **73.0** |

Rejected books score HIGHER. Pearson r(agreement, mean confidence) = **−0.112**. A cutoff catching
all three rejects would refuse **71.4%** of the accepted books.

**Why: the scale is not comparable between items.** Per-item median confidence over 1,710 cached
XMLs is bimodal — min 5, p10 29, p25 32, median 53, p75 93, max 100 — a cluster near 30 and
another near 95. The median word in a lower-quartile item scores a third of the median word in an
upper-quartile one, so no single threshold can mean the same thing in both.

**And it is NOT a producer artifact, so normalising cannot rescue it.** Within one declared engine
(`ABBYY FineReader 0.0.21`, n=100) per-book mean confidence still ranges **25 to 100**, median
46.4. Same engine string, fourfold spread.

**Two of my own probes failed first, and both would have produced a wrong answer:**
- A scan of 600 of the 1,945 cached files reported "0 items with a constant value", and I had
  already opened a book emitting exactly 100 for all 9,798 of its words. The file simply was not
  in the sampled 600. Re-run over all 1,945: exactly **1** constant item — a curiosity, not the
  mechanism I had briefly made it.
- A producer-split probe returned `(none declared)` for **100%** of items, i.e. it never matched
  anything. That is a dead probe, not evidence that producers agree
  ([[lesson_probe_needs_a_positive_control]]). Redone against the engine string the Archive's
  metadata declares, which the gate log already prints.

**What survives.** Nothing at BOOK level: confidence cannot gate a fill. Within a single item the
values do vary meaningfully, which is the page-level job #4784 actually asked for — ranking the
worst leaves inside a book whose text was already accepted. That is a different instrument and
needs hand-graded pages, not this eval.

**Standing caveat.** The reference here is the gate's own verdict, which is itself a model-vs-model
comparison, not ground truth. n(reject) = 3 is far too small to have built a threshold on even had
the separation been clean — the useful output was the ABSENCE of separation, which n=3 can show
and a threshold cannot be drawn from.

---
## 2026-09-24 — Can Jev judge page-break continuity? Pilot against the 48 Sonnet-judged junctions (#4681 follow-up, Derek's question)

**Headline: as an independent per-side scorer, Jev agrees with the eight Sonnet judges on 5 of 6
junctions both sides decided (AUC 0.79 over the 15 judge-decided junctions), is near-perfectly
silent on the same-lane A/A pairs (15 of 16 TIE, mean |margin| 0.04), and cost $0.006 for 192
calls. As a PAIRED comparator it leans RIGHT (7–1 on the A/A pairs, p=0.07) and agrees less
(κ 0.21). Use the side form, order-free, as the first-pass screen for large seam draws, with
Sonnet on the decided subset; do not use the paired form without scoring both orders.**

*Setup.* Calibration set = today's blinded packet (`translation-batch-shadow-judge-packet.jsonl`,
48 junctions: 32 lane vs production, 16 same-lane A/A) and the merged verdicts of eight
independent Sonnet judges. Jev (TypeSafe System One via the Vercel AI Gateway, `typesafe-ai/jev`,
noul questions, OIDC bearer) saw neither key nor verdicts. Per junction: `side_L`, `side_R` (one
call per side, "reads as one translator continuing across the break…"), and `pair_L`/`pair_R`
(one call with both sides, "LEFT continues more convincingly than RIGHT" and the reverse).
Verdict = sign of the margin with a ±0.10 tie band. Script `scripts/eval/jev/seam-continuity-pilot.mjs`;
result `results/jev-seam-continuity-pilot-2026-09-24.json`.

| design | exact agreement (3-class) | κ | judge-decided & Jev-decided | same side | AUC (margin → judge L/R, n=15) | A/A pairs (n=16) |
|---|---|---|---|---|---|---|
| side (two calls) | 77% | 0.41 | 6 | 5 (83%) | 0.79 | 15 TIE · 0 L · 1 R, mean \|m\| 0.04 |
| pair (one call) | 46% | 0.21 | 14 | 10 (71%) | 0.80 | 8 TIE · 1 L · 7 R (p=0.07) |

*Read.* The side form is conservative — it called TIE on 9 of the 15 junctions the judges decided
— but when it decides it agrees, and it does not manufacture preferences under the null, which is
the property a judge must have (memory: *a judge that cannot say TIE reports its own noise*). The
paired form sees more but carries a position lean; the fix is to score both orders and average,
which doubles its cost to a still-negligible figure. Spend: 137,540 input tokens, **$0.0058**.

*Caveats.* n=15 decided junctions is a pilot, not a validation; most of the packet's ties are
page breaks between fragments or at headings (the draw was not filtered to mid-flow seams). The
Sonnet judges are the reference here, not ground truth — the three production wins read against
the source earlier today are the only human-checked labels. Jev's "continuity" may partly be
"fluency": a leaked previous page (#5026) reads perfectly continuous, so this question cannot
catch leakage — the string scan does that.

*Use.* For the decisive seam draw (handoff `2026-09-24-batch-seam-decisive-rerun.md`): run the side
form over every junction, both lanes, order-free; report the Jev margin distribution against the
A/A floor; send Sonnet only the junctions where Jev's margin exceeds the A/A band, plus a random
tenth of the rest as its own control. For a corpus-scale seam audit of production (every block
boundary of every book), the side form at ~$0.00003 per junction is the first instrument we have
had that is affordable at that scale; calibrate it on this set before quoting any rate.


## 2026-09-24 — Batch + seam-repair lane vs production at MID-FLOW seams: the decisive draw (#4681)

**Question.** Does the Batch API lane with seam repair (arm Et, PR #5000) read as production at page
breaks where a sentence actually crosses the break? The first live shadow (entry above) leaned
production 5–1 on 6 decided junctions, most of its 48 junctions being non-seams.

**Answer: TIE.** On 62 mid-flow junctions, production was preferred 19, the lane 14, tie 29.
Production share of decided = 0.576 (Wilson 95% CI 0.41–0.73, two-sided p = 0.49). The judge's
own A/A floor on the same packet split 14–9 (share 0.61, CI 0.41–0.78) with 51% ties — the
production-vs-lane gap is smaller than the gap the judge produces between the SAME lane run twice.
Not "better", not "worse": the lane is not shown worse than production at the seam. The point
estimate sits under the #4912 60% limit, but the CI upper bound (0.73) does not exclude it, so this
is a tie, not a demonstrated non-inferiority.

| pair | n | tie | decided | winner split | share of decided |
|---|---|---|---|---|---|
| S1/S2 (same lane twice, A/A floor) | 47 | 24 (51%) | 23 | S1 14 – S2 9 (p=0.41) | — |
| S1/P, S1 repaired (the design) | 62 | 29 (47%) | 33 | lane 14 – production 19 (p=0.49) | production 57.6% [41–73%] |
| S1/P, S1 unrepaired (plain batch) | 0 | — | — | — | every S1 run carried repairs |

**Draw.** No usable books at `complete`: the 10 Latin-script 40–120 pp candidates had stale
`pages_translated` counters and were already translated. Used 9 books at `needs_attention`
(e-rara ×7 incunabula/16th c. Latin, BSB ×2: one German 1675, one Latin 1782; OCR ≥90%, stale
`image_download_failed`), which is terminal for every lane (orchestrator sweep and translate-worker
`DONE_STATUSES` exclude it; Phase 9 reads only `cover_selected`) — no status drift during the shadows.
4 are `hidden_reason: launch_curation`. Requeued to `ocr_complete` by hand for the realtime arm
(the stock `requeue-untranslated-complete.mjs` moves only `complete`); translate_complete within
~5 min. The `parked` cohort (93 Kloss takedown books) was excluded.

**Packet.** `--midflow` (new): 20 skip records (15 S1/S2 pairs missing text in S2 from partial Batch
drafts, 3 seams not mid-flow on the OCR, 2 seams with a degenerate <120-char half) → 109 junctions (62 S1/P, 47 S1/S2),
committed before judging. Body pages (701): median similarity S1~S2 0.73, S1~P 0.71, length ratio
S1/P 1.00. Eight Sonnet `lean-worker` judges, 11–14 junctions each (more than the 6–8 planned; 109
junctions, 8-agent cap), the printed question verbatim, blind to the key.

**Batch API.** Cancellation persisted: of 29 translate submissions across both passes, 11 (38%) came
back fully cancelled or with partial drafts and no repairs (e.g. 16/116 pages); the 4-try runner got a repaired
run for all 9 books in both passes. Partial drafts shrink the seam set (Manuale S1 had 5 of 12 seams).

**What the judges said** (their reasons, NOT checked against the source). Production wins are mostly
the lane dropping or orphaning a word at the break, with three lane-specific defects: an editorial
note "continues from previous page" left in the text (j062), and untranslated source fragments glued
to English (j019 "Bishop-rum", j096 a German catchword). Lane wins are the mirror image (production
dropping a subject, losing an antecedent, a truncated split word). By book, production led on the
German Apologia (4–2) and Brevis Notitia (3–0), the lane on Epistolae (4–2) and Modus (3–2).

**Jev as a second instrument (asked by the parent session).** Side form (one noul per junction side,
question from `seam-continuity-pilot.mjs`), tie band = A/A 95th pct |margin| = 0.14. Jev tied 101 of
109: A/A 45 ties, 1–1; S1/P 56 ties, lane 5 – production 1. Against Sonnet: AUC of the margin 0.487
(chance), same side on 2 of 4 both-decided, and Jev tied 52 junctions Sonnet decided. **The
proposed gate (Sonnet only where Jev decides, +10% control) would have sent ~13 junctions to
Sonnet and discarded the 33 that decided this run** — Sonnet's verdicts on the 6 Jev-decided S1/P
junctions were production 3, tie 3, lane 0, opposite to Jev's own 5–1. Jev's pilot (AUC 0.79, n=6
both-decided) does not replicate at n=109; do not use it as a continuity screen. Cost $0.008.

**Spend.** $1.40 metered over the 9 books (both shadow passes with retries + the realtime arm),
envelope `batch-seam-decisive` $4 — closed. Jev $0.008.

*Next.* Cheaper is settled (≈58%) and "not worse" now reads as a tie at n=33 decided. Whether that
meets Derek's condition is his call; nothing was flipped or scheduled. Before any flip: the lane-only
defect class (repair leaves an editorial note / untranslated fragment at the seam) is worth a
detector over the shadow runs, and the Batch cancellation rate makes retries a production
requirement, not an option.

*Artifacts:* `results/translation-batch-seam-decisive-judge-{packet.jsonl,key.json,verdicts.json}`,
`results/translation-batch-seam-decisive-{body-similarity,jev}.json`,
`results/translation-batch-seam-decisive-report-2026-09-24.json`; `scripts/eval/jev/seam-continuity-screen.mjs`.
Runs (`translate_batch_runs`, S1/S2): 69b51e949a… `tbs_mufrlndv_8pzcmn`/`tbs_mufsds5z_dpvlow`;
69b51e72ff… `tbs_mufssawy_bsi6pn`/`tbs_mufu0d0h_qlfbq4`; 69b6304e1c… `tbs_mufs1sxw_kxnpm6`/`tbs_muftc4qw_ccoof2`;
69b630791c… `tbs_mufru3zi_j6zwru`/`tbs_mufsudao_wctqjf`; 69b6311a1c… `tbs_mufsfsxw_m2yozn`/`tbs_muftkis8_oq26x6`;
69b630c31c… `tbs_mufr5afl_81tham`/`tbs_muft3wt1_5wfnk1`; 69b6312f1c… `tbs_mufqs0ed_ong93d`/`tbs_mufs53sg_tar3q7`;
69b630dc1c… `tbs_mufs3ztm_m4qsux`/`tbs_mufspooe_2rik07`; 69b631fb1c… `tbs_mufsef21_jyvov6`/`tbs_mufsya26_04ecaa`.

## 2026-09-25 — RETRACTION of the arm label on both #4681 seam draws: the judges read the plain DRAFT, never the repair

**Found by hand.** Spot-checking 11 of the 62 decisive S1/P junctions against the source OCR (4 production wins,
4 lane wins, 3 ties by the judges): 8 agreed on reading, 1 judge reason was factually wrong but the verdict
held (j028: neither side dropped the Titus/Timothy sentence; the lane's "Titum" stayed untranslated), 1 was
a tie the judge scored for production (j107: both sides repeat "Confession"), and **j009 was backwards** —
the judged lane text opened at paragraph 164, silently dropping the ~40-word first sentence of p.65
("O no! we poor cannot pay for it…"), and the judge rewarded the smoother, shorter side. A junction-only
judge cannot see an omission; only a read against the source can.

**Then the mechanism.** The lane's REPAIR for j009 is complete ("out there / O no! We poor people…").
It was never judged: `chooseSeamText` writes `seam_outcomes[].source: 'repair'`; the harness's `laneTexts`
matched the literal `'repaired'`, which no outcome carries (220 outcomes across 32 shadow runs: 169
`repair`, 51 `draft`, 0 `repaired`). So in BOTH draws (#5020 first shadow, #5053 decisive) every "S1
repaired" seam page was the draft, and the first shadow's "plain batch" control row was the same arm
twice. The tie (production 19 / lane 14 / 29 ties) is therefore **plain batch vs production**; the
batch + seam-repair design has not been judged at all. Fix: the harness imports `SEAM_SOURCE_REPAIR` from
the writer and throws when a run with repairs substitutes nothing (a matcher pinned to a literal passes
vacuously — `lesson_a_check_can_stop_checking_and_still_report_green`). Re-scoring the existing verdict
files is unchanged by design (same verdicts, corrected label); a decisive draw of the repaired arm needs a
NEW packet and a new judging round (Derek's call — it spends).

## 2026-09-25 — Batch + seam-repair lane vs production, judged for REAL this time (#4681) — TIE on fluency; the repair step has fidelity defects the judge cannot see

Same nine shadow runs as the 2026-09-24 decisive draw, re-packeted after PR #5077 (the harness now substitutes
the repair) and after fixing `readerText` to strip the OCR front-matter wrappers the way the site does — a
repair mirrors `<scan-quality>…<page-num>` and showed the judge "good German printed text 65" on one arm
only (arm-identifying, blinding broken). 111 blinded mid-flow junctions (63 S1/P, 48 S1/S2), 8 Sonnet
judges, tag `translation-batch-seam-repaired`. Subscription judges; $0 API.

| pair | n | tie | decided | split | share |
|---|---|---|---|---|---|
| S1/S2 (same lane twice, A/A floor) | 48 | 27 (56%) | 21 | 8–13 (p=0.38) | — |
| S1/P, repaired lane vs production | 63 | 26 (41%) | 37 | lane 18 – production 19 (p=1.0) | production 51.4% |

**Fluency at the seam: tie.** The gap (19–18) is inside the A/A gap (13–8). Point estimate under the 60%
limit; at n=37 the CI still reaches it.

**Hand read, 18 junctions against the source OCR** (all 7 length-flagged + 4 P + 4 S1 + 3 ties): 14 verdicts
hold; j037 and j061 are ties the judge decided; **j040 and j033 are lane wins the judge got backwards** —
the repaired seam *invented* a bridging phrase ("all the angelic choirs", not on the page) and expanded a
"Gloria" rubric into a full doxology the page does not carry, and the judge rewarded the fluency. The
new completeness flag (`seam_len`) caught a real production defect (j089: production's p.25 is 784 chars
of the wrong passage; lane correct) and three lane ones (j103 repair dropped the carried sentence, ~60
words; j050 lost the verb of a split word; j105/j060 below).

**The repair step echoes untranslated source on 2 of 63 seams (3.2%) — and the DRAFT on those pages did
not.** Token-overlap of the first 60 words with the OCR ≥0.6: lane j105, j060 (both 1.0); draft 0/63;
production 0/63. `chooseSeamText`'s health check let a Latin page through as a "repair". Issue filed.

**Read:** on the judge's question the lane ties production. On fidelity the repair introduces three
defect classes (echo, omission of the carried sentence, fabricated bridge) at a rate a junction judge
cannot see and a length flag only partly catches. Not a flip; the repair needs an echo/omission gate
before it is judged again. Files: `results/translation-batch-seam-repaired-*`, report
`…-report-2026-09-25.json`. Cost $0. Record: #4681.

## 2026-09-25 (late) — Seam FIDELITY judge: source beside both translations, gated lane vs production (#4681) — production ahead on fidelity; the page break is a defect hotspot for BOTH

Every earlier seam decision (#4912, #4968, #5020, #5053, the rejudge above) used a judge that saw only the
English on both sides of the break: it can score smoothness, never faithfulness, and it rewarded an omission
and two fabricated bridges. This draw gives the judge the OCR of the same two page-excerpts (arm-independent,
so blinding holds) and asks for a defect list per side — OMISSION, ADDITION, MISTRANSLATION, UNTRANSLATED,
DUPLICATION, each quoted against the source — BEFORE a fidelity verdict; fluency asked separately. Lane =
the same nine shadow runs re-choosing repair vs draft with the #5085 gates (`--regate`). 111 junctions
(63 S1/P, 48 A/A), 8 Opus judges (fidelity reading of early modern Latin/German needs a translator, not a
reader of English), subscription, $0 API. Tag `translation-batch-seam-fidelity`; harness flags `--regate
--with-source`, `--score --field=fidelity|fluency`.

| pair | fidelity (a / b / tie) | fluency (a / b / tie) | breaks with ≥1 defect |
|---|---|---|---|
| A/A, S1 vs S2 | 14 / 14 / 20 | 12 / 9 / 27 | S1 71%, S2 60% |
| lane S1 vs production P | 18 / **25** / 20 | 15 / 19 / 29 | lane 76%, production 75% |

Defect counts, S1/P breaks: lane 83 (39 mistranslation, 17 omission, 10 duplication, 9 untranslated, 8
addition); production 69 (28 / 14 / 12 / 5 / 10).

**Instrument check:** the A/A row splits 14–14 — the judge does not invent a preference between identical
arms. 14 random defect claims read against the source: 9 real, 3 real-but-minor, 2 not defects (a name
rendered as "Arnauld"; "in pago" as "territory") — ~80% precision, both arms alike, so counts overstate by
about a fifth.

**Read:** on fidelity at the seam production is ahead, 25–18 (58% of decided; the A/A floor is dead even),
and the lane makes more mistranslations. Not shown non-inferior. And the larger finding: **three in four
mid-flow page breaks carry a fidelity defect in production too.** By source mechanism: where the page ends
on a split word ("Damna-|mnatur") or a catchword repeated on the next page, production is defective at
10 of 12 breaks, the lane at 10 of 12 — the translator translates the catchword twice, splits the word
into two, or drops it. Those are mechanical and fixable before any model sees the page. Issue filed.

## 2026-09-25 (night) — Page-break fix (#5103), three arms on the 63 seams, source-grounded fidelity judge — fix preferred 32–15 overall, TIE on the device subset it targets; the lookahead trades omissions for duplications

The fix, behind `buildTranslationPrompt({ pageBreak: PAGE_BREAK_FIX })` (default OFF, production untouched):
`scripts/lib/page-break-devices.mjs` joins a split word onto the page where it begins and removes the
fragment from the next page, removes a trailing catchword from the page's text and names it, sends the
SOURCE of the next page's first sentence as context, and adds one prompt line. Resolved on the 63 seams
by string edits alone: 24 carry a device (12 catchword, 4 split, 2 split+catchword, 1 merged catchword,
5 tag-only). Harness `scripts/eval/translation-page-break-fix-ab.mjs`: arms **B** (current v13 prompt,
single-page realtime, chained), **B2** (B again, the A/A floor), **F** (B + fix); both pages of every seam,
production model (lite), nothing written to `pages`; $0.57 on Hetzner (cap $3). Same judge as the entry
above (8 Opus, source beside both sides, defect list before the verdict), 124 blinded junctions.

| pair | fidelity (a / b / tie) | fluency (a / b / tie) | breaks with ≥1 defect | p (split) |
|---|---|---|---|---|
| A/A, B vs B2 (61) | 20 / 17 / 24 | 15 / 9 / 37 | B 77%, B2 79% | 0.74 |
| F vs B, all 63 | **32** / 15 / 16 | 26 / 17 / 20 | F 68%, B 78% | 0.019 |
| F vs B, device breaks (24) | 10 / 7 / 7 | 11 / 8 / 5 | F 71%, B 79% | 0.63 |
| F vs B, plain breaks (39) | **22** / 8 / 9 | 15 / 9 / 15 | F 67%, B 77% | 0.016 |

Defects at the break, F vs B (63 junctions): omission **11 vs 24**, addition 9 vs 7, mistranslation 29 vs 31,
untranslated 6 vs 9, duplication **12 vs 5** (B2: 20 / 7 / 32 / 9 / 7).

**Instrument check:** the A/A row is 20–17 with a 39% tie rate — no invented preference. 14 random defect
claims read against the source (seed 5103): 13 real (3 minor: "our pastors" for "us pastors", "pupil" for
"orphan", a dropped "ii. reg. i"), 1 not a defect (a garbled OCR "Ab ho dixi" rendered literally) — ~93%.

**Mechanical check (arm-independent, free):** on the 12 seams whose device the resolver edits, F carried
no fragment into the English; B and B2 carried "178. Dare", "ente", "Anony-", "Ca-", "Re", "rum" on 5–6
each. Whole-page collapse into `<meta>continues from previous page: …</meta>` (an empty page to the reader,
what the worker's health gate refuses): B 4 of 63, B2 3 (+2 on the retry), F 1 — three of B's four on
device seams. Every arm got production's one retry (`--rerun-degenerate`).

**Read:** F is preferred on fidelity, 32–15 (68% of decided; A/A floor 54%), and the gain is fewer
OMISSIONS — B drops the head of the next page (the whole first paragraph, or the clause that crosses)
at 24 junctions, F at 11. But on the 24 device breaks the fix was built for, 10–7–7 is not separated
from the floor: the deterministic edits do remove the carried fragment every time, and the LOOKAHEAD
then undoes some of it — flash-lite translates the "context only" opening on page N and page N+1 either
repeats it (j057 seam: the next page's first three sentences rendered twice) or skips it (j090: N ends
"constancy of the Bishops...", N+1 opens at the paragraph after). Duplication 5 → 12 is that. Not a flip:
the next arm is F WITHOUT the lookahead (edits + rule only, ~$0.20), and a lookahead cut to the crossing
clause rather than the sentence. Caveat on B: all arms are single-page prompts chained through the
fresh previous page; production sends 8-page blocks, so B is production's prompt, not its block shape.
