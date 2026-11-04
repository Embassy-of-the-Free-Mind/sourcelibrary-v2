---
stage: ocr
measure: accuracy
languages: [la, grc, lzh, he, sa]
scripts: [Latn, Grek, Hant, Hebr, Deva]
canons: []
n_books: 162
n_pages: 162
verdict: "With the page image, both models read famous and obscure pages about equally well (Opus 0.91-0.99 accuracy on both; famous minus obscure between -0.05 and +0.04), so memory does not visibly inflate reading at full resolution. Without the image, Opus reproduces famous pages measurably better than matched obscure ones in Latin (R 0.15 [0.04, 0.28], all from canonical works: 0.31; RECITATION-refused pages 0.00), Hebrew (0.28 [0.12, 0.44]) and Sanskrit (0.14 [0.04, 0.24]), and in Greek once 4 mislabelled 'obscure' pages it recites are set aside (0.25 [0.08, 0.42]). Gemini 3.8 Flash low does so only in Hebrew (0.21 [0.08, 0.36]). Opus's Chinese 'gap' is an artefact of the cross-edition e-text key. 5 of 81 'obscure' pages are texts Opus recites from the name alone."
status: undecided
decision: "The preregistered rule says the full 10 x 50 run is justified (Opus shows a measurable gap in >= 2 scripts). Run it only redesigned: one key type for every page, an obscure label confirmed by a no-image probe as well as lookups, n-gram recall as the memory measure, and a degraded-image arm. At this pilot's cost it needs about 20x the Opus calls, so several account-weeks: Derek decides when (#7570)."
superseded_by: null
issue: 7570
---
<!-- PRIOR ART: 2026-10-19-maya-palenque-suggester-6903-6945.md (the no-image arm on a famous text: Gemini 36 of 90 Palenque blocks exact with the crops withheld vs 39 with them); 2026-10-24-continuation-probe-7271.md (no-image continuation, its positive/negative control gates, and the finding that a RECITATION refusal does not mean the page is memorised); dataset/refusal-census-v1 (the #6740 refusal census). None of them crosses image/no-image with famous/obscure across scripts, which is #7570. -->
## 2026-10-27 · Read or recall? Vision models on famous vs obscure pages, with and without the image (#7570, pilot)

**Question.** When a vision model "reads" a historical page, how much of its transcription comes from the image and how
much from memory of the text? If memory supplies a large share, a model's accuracy on famous pages overstates its
reading, and pages with no online copy are a contamination-resistant benchmark.

### Preregistration (committed and pushed before any model call)

Code: `scripts/eval/read-or-recall-7570/` (`draw.mjs`, `controls.mjs`, `screen.mjs`, `arms.mjs`, `prompts.mjs`,
`calls.mjs`, `text.mjs`; `seal.mjs` and `score.mjs` follow the rules below and are committed before the first arm call).
Results: `scripts/eval/results/read-or-recall-7570/`. Pair list: `scripts/eval/dataset/read-or-recall-v0/`.

**Scripts and kind.** Latin (print 1470–1800), Greek (print 1470–1900), classical Chinese (print; manuscripts out),
Hebrew (print 1475–1930), Sanskrit in Devanagari (print 1800–1960). Up to 20 pairs per script, one page per book.

**Pools** (`draw.mjs`, seed 7570, sealed in `pools.json` before any call; ordered by a seeded hash, nothing picked by hand):
- **Famous** = a page whose text is online.
  - Latin: alternating, 17 pages Gemini refused with `finishReason: RECITATION` (the #6740 census population, via
    7271's indexed entry) and 17 pages of canonical classical or biblical works by title (Vulgate, Virgil, Cicero, Ovid…).
  - Greek and Chinese: the sealed benchmark pages (`scripts/eval/benchmark/{greek,greek-ext,greek-ext2,chinese,chinese-ext}.json`)
    whose reference is an aligned e-text window (Perseus, First1KGreek, el.wikisource; Kanripo, CBETA), overlap ≥ 0.5,
    SKQS manuscripts excluded.
  - Hebrew and Sanskrit: books whose title names a canonical work (Torah, Talmud, Mishnah, Zohar, Siddur, Psalms…;
    Gita, Veda, Ramayana, Purana, Upanishad…).
- **Obscure** = same script, kind and period; title names no canonical work (in any script's list); not refused in the
  census; no Gutenberg copy and `archive_text_online` not true in the census; not in any benchmark stratum (those were
  drawn because an e-text was looked for); Chinese titles from the Siku sets (`(vol N)`, 御定/欽定…) excluded because
  Kanripo holds them all.
- **Page**: interior (15–90% of the book), usable image, and (for pools drawn from Mongo) a stored model read with
  ≥ 900 / 500 / 200 / 400 / 400 letters of the script (Latin / Greek / Chinese / Hebrew / Sanskrit) and no
  index/title/table/plate page type. The stored read only screens the page; it is never a key.

**Screen** (`screen.mjs`): the blind key reader (Opus via `claude -p`, image only, no work named, prompt `KEY`)
classifies each candidate and transcribes it. A candidate passes if SCRIPT is the target script, SHARE ≥ 60, KIND is
print, PAGE is running-prose, verse or text-with-commentary, and the key holds ≥ 600 / 400 / 150 / 300 / 300
comparison characters. Candidates are screened in pool order (first 24 famous, first 40 obscure per script; more in
pool order only if a script runs short).

**Online check** (after the screen, before sealing; recorded per page in the pair list). Two phrases from the key
text: 8 consecutive words starting at word 30 and at the middle (Chinese: 10 consecutive Han characters at character
30 and at the middle), each searched in quotes on the web. A hit is a page showing the phrase. Hits are labelled:
`etext` (a curated transcription: Wikisource, Perseus, The Latin Library, CAMENA, EEBO-TCP, ctext, Kanripo, CBETA,
Sefaria, GRETIL, sanskritdocuments, HebrewBooks text, a scholarly edition online…), `scan-ocr` (archive.org full text,
Google Books, HathiTrust), or `self` (sourcelibrary.org). A famous page outside Greek/Chinese needs ≥ 1 `etext` hit
(Greek/Chinese famous pages already carry an aligned e-text). An obscure page needs no `etext` hit on either phrase.
`scan-ocr` is recorded as a covariate, not a disqualifier: nearly every printed book in the corpus has one, famous
editions included. Our own OCR being online (`self`) is recorded with its date (7271 found Opus has seen some of our
July 2026 text).

**Pairing** (`seal.mjs`): famous pages in pool order, up to 20; each takes the first unused eligible obscure page of
the same script in pool order with the same half-century, else within ±100 years, else (only where a year is
missing) any. A famous page with no partner is dropped and the next famous page is tried. A script short of 20 pairs
is reported with its n; the rule is not loosened.

**Arms** (`prompts.mjs`, same wording for both models except how the image file is opened):
- **A** image + work named (catalogue title, author, year), transcribe.
- **B** image only, transcribe.
- **C** work named, no image: the page's first 12 words (Chinese: 12 characters) from the key as an anchor, the page's
  length in characters, "write the main text of this page from where those words stop … word for word"; scored as
  anchor + continuation, so all three arms are scored as whole-page transcriptions.
- **P** positive controls, no image: 10 famous passages named by work and locus, two per script
  (`controls.json`: Caesar BG 1.1, Vulgate Gen 1:1–8; Iliad 1.1–21, John 1:1–14; Analects 1.1–1.4, Mencius 1A.1;
  Gen 1:1–8, Psalm 23; Gita 1.1–1.8, 2.19–2.25).
- **Models**: Opus (`claude -p --model opus`, image via the Read tool only, subscription login) and Gemini 3.8 Flash
  low (`agy -p`, plan mode, tool gate, image via view_file only). No paid API, no fallback, one call per (page, arm),
  no retry; calls in seeded random order over (page × arm). A refusal, empty, timeout or tool failure is a failed read
  and scores 0, and is counted.

**Key** (the brief's rule): the stored reference where one exists (an aligned e-text window for the Greek and Chinese
famous pages; a by-eye reference if a drawn page has one), otherwise the blind Opus key. **Sensitivity:** every page
scored against the blind Opus key. No arm's own output is ever a key.

**Scores** (`text.mjs`): per script, a comparison form (NFC; Latin lower case, marks stripped, ſ/æ/œ/j/v folded;
Greek accents and breathings stripped, ς→σ; Hebrew points stripped, final forms folded; Chinese Han characters only;
Devanagari letters and signs only), letters of the script only, no spaces, punctuation or digits.
- `acc` = max(0, 1 − CER) against the key: **the primary measure** (`measure: accuracy`).
- `recall_ng` = share of the key's character 6-grams (Chinese 3-grams) found in the output; `lcs` = longest common
  substring in characters (the verbatim-memory signature).
- A key under 50 comparison characters (Chinese 30) is unjudgeable and the page is dropped with its pair.

**Outcomes**, per script and model, 95% percentile bootstrap over pairs (10,000 draws, seed 7570):
1. **Recall without the image**: R = mean acc(C) on famous − mean acc(C) on obscure.
2. **Image gap, difference in differences**: G = acc(A) − acc(C) per page; DiD = mean G (obscure) − mean G (famous).
   Memory shows as a smaller image gap on famous pages.
3. **Naming lift**: L = acc(A) − acc(B); L (famous) − L (obscure).
4. Descriptive: mean acc per arm and side; the anchor-only baseline (acc of the anchor alone); for Latin, R and DiD
   split by recitation-hit vs canonical-work famous pages; Opus key vs e-text reference on the Greek/Chinese famous pages.

**Gates (fixed here, before any reply is read):**
- **P gate**, per model and script: mean `recall_ng` over the two positive controls ≥ 0.50. A model that fails cannot
  show memory in that script without the image, so its R and DiD there are reported as "insensitive", not as zero.
- **Reading gate**, per model and script: median acc(B) on obscure pages ≥ 0.50. A model that fails cannot read the
  script from the image, so its image-arm numbers there are reported as "cannot read", not as a memory result.
- **Label check** (not a gate): any obscure page with acc(C) ≥ 0.50 for either model is flagged as a suspect label,
  listed, and the outcomes are also reported without it.

**Decision rule for the full run (10 scripts × 50 pairs).** A *measurable gap* in a script = for a model that passes
both gates there, R or DiD with point estimate ≥ 0.05 and 95% CI lower bound > 0. The full run is justified if a
measurable gap appears in ≥ 2 of the 5 scripts for at least one model. If it appears in exactly one, the full run is
justified only for that script family (reported as a recommendation). If none, the full run is not justified: memory
is not a measurable share of these models' reading at this n, and the decision says so.

**Budget and stops.** Opus on this box's subscription (dereklomas@gmail.com, 26% weekly at the start): every runner
stops when the weekly meter reaches 70% and the run reports what it has. Gemini on the shared agy pool (about 600
calls). No production writes; Mongo read-only.

**What this cannot show** (stated in advance). n ≤ 20 pairs per script is a pilot. The Opus key shares a model with the
Opus arms, so Opus's absolute accuracy is flattered against it; comparisons inside a model (arm vs arm, famous vs
obscure) are what the design rests on. "Famous" here means "text online", from canonical scripture to a niche e-text;
the Latin split and the per-page evidence let a reader regroup. The no-image arm tests verbatim recall of the page's
text, not knowledge of the work's content.

### Deviation from the preregistration (recorded before the pairs were sealed and before any arm call)

**The online check by web search could not carry a label, so it was replaced.** Seven search subagents (Sonnet,
WebSearch) ran the quoted-phrase search on 138 screened pages. The session's search budget is 200 queries in all, and
it ran out after the first pass on about half the pages. Worse, the search found the text of only 1 of the ~11
canonical Latin pages it reached: Lucan, Cicero, Terence and the *Rhetorica ad Herennium* all came back empty, so
"no hit" said almost nothing.

What replaced it (`online.mjs`, no model call):
- **Phrases:** two exact phrases per page, 5 words long (Chinese: 8 characters), taken from the blind key at 25% and
  60% of its length.
- **Sources searched:** GitHub code search over all public repositories (Latin Library, Perseus, First1KGreek, Kanripo,
  Sefaria and GRETIL mirrors all live there), Kanripo on its own for Chinese, the language's Wikisource
  (la, el, zh, he, sa) and, for Hebrew, Sefaria's search API.
- **The first-pass web hits are merged in.**
- **Calibration:** the instrument's miss rate is measured on 20 Greek and 20 Chinese famous pages whose e-text is
  known.

Two rules change:
- **Obscure** still means no `etext` hit, now from these lookups.
- **Famous Latin, Hebrew and Sanskrit pages are labelled at the work level:** a canonical title, or for Latin a
  RECITATION refusal. A lookup miss no longer removes a famous page, because the lookups miss known-online pages too
  often to unlabel one. The per-page lookups are still recorded as evidence.

**What this means for "obscure":** the label's evidence is the catalogue and census rules, plus a lookup with a
measured miss rate. The arms supply a second, direct check: any obscure page the no-image arm reproduces (acc(C) ≥ 0.50)
is flagged as a suspect label, and the outcomes are also reported without it.

**How the seal ran.** The pairs were sealed script by script, as each script's lookups finished, so the arms could
start early. Re-sealing is deterministic per script; each re-seal was checked to leave every earlier script's pages
byte-identical, and did.
- **One slip:** a wait loop exited on its timeout rather than its condition, so Chinese was first sealed with 34 of its
  37 lookups done.
  - That seal had 10 pairs; the complete one has 13.
  - All 20 pages of the 10 early pairs are still in the 13; the obscure pages are paired with different famous pages.
- **The fix:** the Chinese arm rows already written are joined to the final pairs by page (book id and page number)
  through `slug-remap-chinese-v3.json`, not by pair slug. Only the 6 new pages were called.
  - No page was called twice.
  - No row was moved to a page it was not called on. The prompt for a page (title, anchor, length) does not depend on
    its pair.
- **Rows written after this carry `page_key` directly.**

**Final pairs:** Latin 20, Greek 16, Chinese 13, Hebrew 12, Sanskrit 20 (81 pairs, 162 pages). The short scripts ran
out of eligible obscure pages: the screen dropped manuscripts, short keys and the wrong script, and the lookups dropped
pages with an e-text hit. The rule was not loosened.

### Results

81 pairs, 162 pages, 162 books. Arm calls: Opus 496, Gemini 496. Failed reads: 2, both Opus no-image replies with no
markers, scored 0. Both gates passed in every script for both models; Gemini's Hebrew reading only just passed
(median 0.71). Numbers are `acc` = 1 − CER against the primary key, mean over pages, with a 95% bootstrap CI over pairs.

| script | engine | pairs | famous A / B / C | obscure A / B / C | **R**: C famous − C obscure | **DiD**: image gap obscure − famous | naming lift L | measurable gap |
|---|---|---|---|---|---|---|---|---|
| Latin | Opus | 20 | 0.99 / 0.99 / 0.39 | 0.98 / 0.99 / 0.24 | **0.15** [0.04, 0.28] | 0.14 [0.03, 0.27] | 0.01 | **yes** |
| Latin | Gemini | 20 | 0.93 / 0.93 / 0.25 | 0.98 / 0.97 / 0.24 | 0.01 [−0.01, 0.04] | 0.06 [−0.00, 0.13] | 0.00 | no |
| Greek | Opus | 16 | 0.95 / 0.95 / 0.53 | 0.99 / 0.99 / 0.41 | 0.12 [−0.07, 0.30] | 0.16 [−0.02, 0.34] | −0.00 | no (yes without flagged, below) |
| Greek | Gemini | 16 | 0.94 / 0.86 / 0.28 | 0.85 / 0.78 / 0.27 | 0.02 [−0.05, 0.11] | −0.06 [−0.26, 0.11] | 0.00 | no |
| Chinese | Opus | 13 | 0.75 / 0.75 / 0.07 | 0.95 / 0.96 / 0.07 | −0.00 [−0.12, 0.08] | 0.20 [0.07, 0.34] | 0.01 | rule: yes; **artefact** (below) |
| Chinese | Gemini | 13 | 0.72 / 0.74 / 0.13 | 0.83 / 0.71 / 0.10 | 0.04 [−0.03, 0.12] | 0.15 [−0.08, 0.36] | −0.14 | no |
| Hebrew | Opus | 12 | 0.91 / 0.92 / 0.45 | 0.95 / 0.96 / 0.17 | **0.28** [0.12, 0.44] | 0.32 [0.14, 0.49] | 0.00 | **yes** |
| Hebrew | Gemini | 12 | 0.78 / 0.77 / 0.47 | 0.69 / 0.66 / 0.25 | **0.21** [0.08, 0.36] | 0.13 [−0.15, 0.39] | −0.02 | **yes** |
| Sanskrit | Opus | 20 | 0.94 / 0.98 / 0.41 | 0.99 / 0.99 / 0.27 | **0.14** [0.04, 0.24] | 0.18 [0.05, 0.35] | −0.04 | **yes** |
| Sanskrit | Gemini | 20 | 0.90 / 0.91 / 0.27 | 0.92 / 0.83 / 0.23 | 0.05 [−0.02, 0.13] | 0.07 [−0.11, 0.26] | −0.10 | no |

A = image + work named, B = image only, C = work named, no image (anchor + continuation). Full tables, the Opus-key
sensitivity, the controls and every flag: `scripts/eval/results/read-or-recall-7570/report.md`.

**Calibration.** The anchor alone scores 0.04–0.10. Two unrelated pages of the same script score 0.02 (Chinese) to
0.17 (Latin) against each other: this is the floor of `acc` for a fluent but wrong text. An obscure page's C arm at
0.17–0.27 is therefore that floor plus the anchor, not recall. The controls passed for both models in every script:
every one of the 10 famous passages was written out with n-gram recall ≥ 0.91. Gemini's John 1 scores `acc` 0.05
because the reply runs on past verse 14; its recall is 1.00.

**Findings.**
- **With the image, fame does not raise accuracy.** Opus reads famous and obscure pages alike. A(famous) − A(obscure)
  against the Opus key is −0.05 to +0.04 in every script.
  - Naming the work adds nothing for Opus: L is 0.00 ± 0.04 everywhere.
  - Gemini is noisier. Famous pages score +0.09 (Hebrew) and +0.12 (Greek, Opus key) above obscure ones; that could be
    memory or cleaner print, and this n cannot separate them. Naming hurts Gemini on Chinese and Sanskrit
    (L −0.14, −0.10).
  - At full resolution the image dominates. Whatever these models remember does not show up as better reading.
- **Without the image, Opus remembers famous pages.** Given the work's name and the page's first 12 words, it writes
  out a measurable share of a famous page and little of an obscure one.
  - Latin canonical works: R 0.31 [0.12, 0.50] (Lucan, Cicero, Terence, Horace, Quintilian…).
  - Hebrew: 0.28 (Torah, Psalms, Zohar). Sanskrit: 0.14 (Veda, Gita, Purāṇas).
  - On n-gram recall (floor ≈ 0), R for all 20 Latin pairs, Hebrew and Sanskrit is 0.18, 0.33 and 0.21.
- **RECITATION-refused pages are not remembered, with or without a name.** For the 10 Latin pages Gemini refuses as
  recitation, Opus's R is 0.00 [−0.03, 0.03] and Gemini's 0.03 [−0.00, 0.06]. This replicates #7271's continuation
  probe with a different prompt (name + anchor + length). Gemini's DiD on these pages is 0.12 [0.02, 0.26], but
  with its R ≈ 0 that comes from the image arm, not from recall.
- **Gemini 3.8 Flash low remembers only the Hebrew Bible.** It passes every positive control (it can write Genesis 1,
  Iliad 1, the Gita) but reproduces arbitrary pages of famous works only in Hebrew (R 0.21). Knowing a work's famous
  passages is not knowing its pages.
- **The "obscure" label leaks, and the no-image arm catches it.** Opus reproduced 5 of 81 obscure pages from the name
  alone (acc ≥ 0.50):
  - the *Poimandres* (Corpus Hermeticum I, Turnèbe's 1554 editio princeps), 0.85;
  - the Aldine *Epistolae diversorum philosophorum*, 0.90;
  - a Greek *Gnomologia*, 0.71;
  - Archimedes with Eutocius, 0.56;
  - the *Samguk sagi*, 0.72.

  They are online texts that the catalogue rules and the lookups missed. Without those 4 Greek pairs, Greek is a
  measurable gap: R 0.25 [0.08, 0.42], DiD 0.28 [0.11, 0.45]. Chinese without its flagged pair: R 0.05
  [0.02, 0.09]. Many more "obscure" Sanskrit pages are of works on GRETIL (Haṭhayogapradīpikā, Sāṃkhyakārikā,
  Caraka…), which none of the lookups can search. Opus reproduced none of them past 0.50. But Sanskrit's obscure C
  (0.27; n-gram recall 0.23, against Latin's 0.13) sits above the floor plus the anchor, so some partial recall of
  those works is likely, and Sanskrit's R is a lower bound.
- **Chinese: the e-text key manufactures a gap.** The 13 famous Chinese pages are keyed to Kanripo/CBETA windows of
  the *work*, not this edition (blind Opus key vs window: median 0.78).
  - So Opus's image reads score 0.75 against that key and 0.99 against the blind key.
  - The preregistered DiD (0.20) comes from that mismatch: with the Opus key it is −0.06 [−0.18, 0.03], and R is
    ≈ 0 under both keys.
  - Opus does not reproduce Chinese pages from a name: its no-image C is 0.07 against a floor of 0.02, on both sides.
  - Greek e-text windows (same editions, median 0.95) show no such effect.

**Decision.** The preregistered rule counts a *measurable gap* for a model that passes both gates: R or DiD ≥ 0.05
with a CI above 0. For Opus that holds in Latin, Hebrew and Sanskrit, plus Chinese mechanically, which is discounted
above. For Gemini it holds in Hebrew. Since ≥ 2 scripts show a gap for one model, **the full 10 × 50 run is justified
by the rule.**

What the pilot says that run should measure differently:
1. **One key type for every page.** Use the blind key, or by-eye references where they exist; never a cross-edition
   e-text window for only one side.
2. **Obscure labels confirmed by a no-image probe of two models**, on top of lookups. GRETIL and TLG cannot be searched
   by any instrument used here, and 5 of 81 labels failed.
3. **n-gram recall, not `acc`, as the memory measure for the no-image arm.** `acc` has a script-dependent floor of
   0.02–0.17.
4. **A degraded-image arm** (downsampled or cropped). At full resolution the image settles the reading and memory has
   no room to show. The question labs care about, whether memory fills in what the model cannot see, needs a page it
   cannot fully see.

At this pilot's rate the full run is about 20× the Opus calls: several account-weeks on one subscription.

**What this does not cover.**
- n is 12–20 pairs per script; the CIs are wide.
- One Opus key reader also keys the Opus arms, which flatters Opus's absolute accuracy. The comparisons rest within a
  model.
- "Famous" ranges from the Torah to a niche e-text. "Obscure" means "not found by these lookups", and 5 labels
  failed visibly.
- C is a verbatim test of this edition's wording, so a model that knows the work in another edition scores low.
- One size of each model (Gemini Flash low is a small tier).
- The longest-common-substring figures in `report.md` include the 12-word anchor, so for C they mostly measure the
  anchor; use n-gram recall.

*Grade.* Pilot-grade throughout. Directional for "Opus remembers famous Latin, Hebrew and Sanskrit pages without the
image, and at full resolution that memory does not raise its reading accuracy". *Replicated?* The RECITATION null
replicates #7271; the rest has not been run twice. *Cost.* $0 marginal, all on subscriptions:
- 898 Opus calls (402 blind keys, 496 arm calls), on dereklomas@gmail.com via `claude -p`. Weekly meter 26% → 40%;
  other jobs on that account also ran in the window.
- 496 Gemini 3.8 Flash low calls on the agy pool (Gemini weekly remaining 60% → 54%).
- 7 Sonnet search subagents for the abandoned web check.
- No paid API. Mongo read-only; no production writes.

*Artifacts.*
- `scripts/eval/read-or-recall-7570/`: draw, controls, screen, online, seal, arms, score.
- `scripts/eval/results/read-or-recall-7570/`: `pools.json`, `controls.json`, `seal-log.json`, `online-summary.json`,
  `scores.jsonl` (no text), `report.json`, `report.md`, `slug-remap-chinese-v3.json`.
- `scripts/eval/dataset/read-or-recall-v0/`: the pair list, no page text.
- Page texts (keys, raw replies, phrases) are kept off this public repo, on gex45 under
  `/root/jobs/read-or-recall-7570/private/`.
