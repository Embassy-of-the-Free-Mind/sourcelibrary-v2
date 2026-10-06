# Preregistration — #6038 run 3: crawl presence, content knowledge, public e-text

PRIOR ART: scripts/eval/PREREGISTRATION-ai-exposure-r2-6038.md (on branch `eval/ai-exposure-r2-6038`, PR #6089) — run 2 of this issue, whose sample, W and per-work verified-recall labels this run reuses unchanged. Form follows scripts/eval/PREREGISTRATION-engine-wave1-6011.md.

**Committed before any run-3 data query or model call** (2026-10-06, ~23:30 UTC). Before writing it I sent only
instrument-discovery requests: which infini-gram indexes answer, with stock strings ("In the beginning God created…",
"Arma virumque cano…", one Analects line, one Tibetan title), throughput, and whether the e-text sites' APIs answer.
No passage from our books was queried. Nothing below changes after a result is seen. Anything not listed here is
labelled *post hoc* in the report.

Code: `scripts/eval/ai-exposure-r3-6038.mjs`. Results: `scripts/eval/results/ai-exposure-r3-6038/`. Write-up:
`scripts/eval/experiments/2026-10-07-ai-exposure-run3-6038.md`. Private material (passages, query strings, questions,
reference answers, model answers that quote pages): `/root/claude-jobs/ai-exposure-r3-6038-private/`, never committed.
The repo gets sha256 hashes of passages, counts, ids and per-work labels only.

## Why

Runs 1–2 measured RECALL: can a model name a work's author from its title? Run 2: 52.2% [47.4–56.9] of W have an
author that no gated model names. That supports "models cannot recall these works". It does not support either of
the two stronger things we would like to say to an AI lab:
1. "our text is not in the public crawl that labs train on" — layer **A**;
2. "models do not know what these texts say" — layer **B**;
and the lab will also ask 3. "does a machine-readable text of this work already exist publicly?" — layer **C**.
None of the three relies on a model's self-report.

## Population (fixed by runs 1–2; no redraw)

The seeded random 500 (`in_sub500`, seed 6038) of run 1's work-uniform sample, one sampled edition (book) per work,
with run 2's `works.jsonl` fields (`lang`, `century`, `genre`, `visible`, `provider`, `volumes`, `pages`) and run 2's
per-work labels: **W** (`in_W`: identifiable title AND scorable catalogue author, n = 416) and **R** = verified recall
by any gated model (V2 author match by Pro, Opus or GPT-5.6 Sol; `no_V2_union = false`). Run 2's post-hoc by-eye
corrections are NOT used as the input label; the preregistered union label is.

---

## Layer A — crawl presence (cost $0)

**Instrument.** Exact-string occurrence counts.
- **infini-gram mini** (arXiv 2506.12229), `https://api.infini-gram-mini.io/`, character-level FM-index, case-
  sensitive. Indexes (all that answered on 2026-10-06): Common Crawl `v2_cc-2025-05`, `-08`, `-13`, `-18`, `-21`,
  `-26`, `-30` (the CC-MAIN snapshots of Jan–Jul 2025), `v2_dclm_all` (DCLM-baseline), `v2_piletrain` (the Pile).
  The `v2_cc_2025-30` spelling in the docs is rejected by the server; the hyphenated `v2_cc-2025-30` form answers.
  No CC snapshot before 2025-05 answers.
- **infini-gram** (original), `https://api.infini-gram.io/`, Llama-2-token suffix arrays: `v4_dolma-v1_7_llama`
  (OLMo 1.7 training data), `v4_olmo-mix-1124_llama` (OLMo 2 pre-training mix), `v4_rpj_llama_s4` (RedPajama).
- A **hit** is count ≥ 1 in an index. Three attempts per query; a query that still errors is `error`, never `0`.
- Concurrency ≤ 8 requests in flight in total, with backoff on any non-200.

**Passages (our transcription).** For each work, its sampled edition's pages with `ocr.data` (Mongo, read-only),
restricted to the body: page_number in the 10th–95th percentile of the book's OCR'd pages (all OCR'd pages if the
book has ≤ 10). Pages are shuffled with seed `6038-A-<book id>`; from each page in turn one passage is taken, until
k = 5 passages (from 5 different pages where possible; a book with fewer usable pages gives fewer, and if fewer than 5
usable pages exist a second passage may come from the same page, non-overlapping). If Mongo has no usable body page,
the private run-1 text file (first ≤ 15 OCR'd pages) is used.

*Cleaning* (applied identically to every passage source, ours and the web's): NFC; `ſ`→`s`; drop soft hyphens; drop
lines that are only a number, a signature mark or a catchword-sized fragment (≤ 2 tokens); drop the first and last
non-empty line of an OCR page (running head, catchword); strip markdown (`#`, `*`, `_`, `>`, `|`), HTML/XML tags,
and our `<page-type>`-style tags; drop bracketed editorial insertions `[...]`; join a line ending in `-`, `¬` or `⸗`
to the next without a space; collapse all whitespace to one space.

*Window* (a passage is a contiguous substring of the cleaned page):
- space-delimited scripts (Latin, Greek, Cyrillic, Hebrew, Arabic, Syriac, Armenian, Ge'ez, Devanagari prose…):
  **8 consecutive words, ≥ 40 characters** (Devanagari/Hebrew/Arabic: ≥ 30), no digit, no character outside
  letters, combining marks, space and `, . ; : · '` . A window with no punctuation at all is preferred (chosen at
  random among the page's punctuation-free windows if any exist; else among all valid windows).
- Han / Kana / Hangul: **10 consecutive CJK characters** with no punctuation and no Latin letter or digit.
- Tibetan: **8 consecutive syllables** (tsheg-delimited) with no shad, ≥ 24 characters.
- The first 20% of a page's cleaned text is skipped when the page has ≥ 3× the window length (headings, chapter
  titles). A window may not repeat a previously chosen passage of the same work.

**Negative control.** For every work with a passage, passage 1 with its tokens shuffled (words; CJK characters;
Tibetan syllables), seed `6038-N-<book id>`, rejoined with the script's separator. Expected ≈ 0 hits.

**Positive controls.**
- **P-web (index sensitivity):** ≥ 25 works that are on the open web *as text*, with 5 passages each taken FROM the
  site (same cleaning and windows): Perseus TEI (PerseusDL/canonical-greekLit on GitHub) for Iliad, Odyssey, Phaedo,
  Euclid's Elements, Marcus Aurelius; Sefaria API (Genesis in Hebrew, Zohar); CText API (Analects, Daodejing,
  Mencius, Zhuangzi); The Latin Library (Vulgate Genesis, Aeneid, Ovid Met., Caesar BG, Cicero De officiis, Imitatio
  Christi, Bacon Novum organum); Wikisource (Newton's Principia, Chymische Hochzeit, Il Principe, Commedia); GRETIL or
  Sanskrit Wikisource (Bhagavad Gītā); Project Gutenberg (Augustine's Confessions, Boethius tr. I.T., Descartes'
  Discours, Leviathan, Utopia); Esoteric Archives (Agrippa, De occulta philosophia). A work whose site text cannot be
  fetched is replaced by another from the same list, and the list actually used is reported.
- **P-ours (sensitivity of our OCR):** our transcription of the same works (the books we hold, listed in
  `controls-A.jsonl`), passages chosen by the same rules as for the 500. Editions differ from the web text in
  orthography, punctuation and abbreviation; that difference is what this measures.
- **P-IA (is archive.org's own OCR in the crawl?):** a seeded 60 of the IA-sourced works in the 500, 5 passages each
  from the item's `_djvu.txt` (body region, same rules).

**Stop rules (A).**
- If P-web work-level sensitivity (≥ 1 of 5 passages hit in ANY index) is **< 50%**, the index or the method is broken:
  the report says so and publishes **no presence numbers** for the 500.
- If **> 2%** of negative passages hit any index, the window is too short for chance: the strict rule (A++, below)
  becomes the headline. If > 5% hit, layer A is reported as broken.

**Estimands (A).**
- **A+** (primary) = work has ≥ 1 of its passages with a hit in any index. **A++** = ≥ 2 passages hit. Share of the
  500 and of W, Wilson 95% CI. Also per index family (CC 2025 union; DCLM; Pile; Dolma; OLMo-mix; RedPajama).
- **Sensitivity** reported with every presence number: P-web, P-ours, P-IA (work-level and passage-level, Wilson).
  "Not found" with our OCR is weak evidence where P-ours is low. Secondary: the sensitivity-adjusted presence
  A+ / P-ours(work-level), capped at 100%, labelled as a rough bound, not an estimate.
- **By eye (provenance of hits):** a seeded 40 hits (or all, if fewer) are retrieved with `find` + `get_doc_by_rank`
  on a CC index (`v2_cc-2025-18`, or the index that hit) and labelled: *same work* (any edition, any OCR, any site) /
  *shared quotation* (the passage quotes Scripture, a classic, a liturgical or legal formula) / *boilerplate* / other.
  Secondary: **A+ (same-work)** = A+ discounted by the by-eye same-work share. The hosting sites of same-work hits are
  tallied (archive.org, Google Books, Wikisource, our own site…).
- Breakdowns: language (Latin, German, English, other European, CJK, Tibetan/Sanskrit/Pali, other), century, genre,
  visible vs held, provider (mdz, internet_archive, e-rara, other), and run-2 R (recalled / not recalled, on W).

**Caveat carried with every A number.** The public crawl is not all training data. Book corpora, licensed, private
and post-2025 data are invisible to this instrument; the CC indexes here are only Jan–Jul 2025, before most of our
transcriptions were published.

---

## Layer B — content knowledge (≤ $7 of the $10 cap)

**Works.** Every work in the 500 whose sampled edition has `pages_translated ≥ 10` (176 on 2026-10-06; ≤ 200, so all),
plus **20 famous control works** we hold with English translation: Vulgate (Biblia Sacra Vulgatae editionis), Phaedo
(Greek), Euclid's Elements (Greek), Analects, Daodejing, Mencius, Bhagavad Gītā (Schlegel), Iliad & Odyssey (Greek),
Augustine's Confessions, Boethius (tr. I.T.), Ovid's Metamorphoses, Lucretius (tr. Munro), Caesar's Commentarii,
Cicero's ethical writings, Marcus Aurelius, Copernicus' De revolutionibus, Newton's Principia, De imitatione Christi,
Machiavelli's Il Principe, Descartes' Discours. (Ids in `controls-B.jsonl`.) Run-2 known/unknown is recorded per work
(W only); the sample is all eligible works, so no stratified subsampling is needed except for Opus.

**Pages.** Per work, pages with `translation.data` of ≥ 600 characters after stripping markup, excluding the first 3
and last 2 pages of the book; seeded shuffle (`6038-B-<book id>`); the first 5 distinct pages are used. A work with
fewer than 3 such pages is ineligible (reported).

**Question generation** — `gemini-3-flash-preview`, thinking 0, T = 0, one call per work with its 5 pages, each
labelled. One question per page: answerable from that page alone; about a specific claim, example, name, number or
argument on the page; NOT a generic theme, NOT answerable from the title, NOT about page layout or the translator;
self-contained (the work is named by the asker, so the question does not need to name it); short reference answer
(≤ 15 words) plus the supporting sentence. The model may return `null` for a page with no such content.

**Filters.**
1. **Open-book**: `gemini-3-flash-preview` (thinking 0) gets the page and the question and answers. Graded by the
   judge (below). Not `correct` → question dropped as invalid.
2. **Guessability baseline**: `gemini-3.1-pro-preview` gets the question with the title and author replaced by a
   neutral description built mechanically from metadata ("a 17th-century Latin work", genre word if known:
   "dissertation", "sermon", "commentary on Scripture", "treatise") and is asked to answer or say "unknown".
   `correct` → question marked **guessable**.

**Closed-book test.**
- **Pro**: `gemini-3.1-pro-preview` with title, author, year and language, the work's valid questions; answer each or
  "unknown". Same thinking budget for guessability and closed-book: **256** (if the API refuses 256, the smallest it
  accepts; reported).
- **Opus**: Claude Opus 5.5 subscription subagents (from memory; the prompt forbids tools other than reading the
  packet and writing the answer file), on a seeded **50-work** subsample of the B works stratified 25 R-known /
  25 R-unknown in W (fewer if a stratum is short; then filled from the other). ≤ 8 agents, ≤ 25 works each; the same
  closed-book prompt. Opus has no own guessability baseline; it is scored on Pro's non-guessable questions and its raw
  accuracy is reported beside Pro's baseline.

**Judge.** `gemini-3-flash-preview`, thinking 0, T = 0: question, reference answer, supporting sentence, candidate
answer → `correct` / `partial` / `incorrect` / `unknown`. Only `correct` counts. **By eye**: a seeded 50 closed-book
gradings (25 Pro-correct, 25 not, where available) are re-graded by the analyst blind to the judge's label; agreement
and κ reported. If agreement < 80%, B is reported with the caveat that the judge is unreliable and the eye-check
direction of error.

**Controls and stop rule (B).** On the famous works: closed-book accuracy on **non-guessable** valid questions must
be **≥ 60%** and the guessable share of valid questions **≤ 40%**, and closed-book accuracy must exceed the baseline
accuracy (Pro, neutral description) by ≥ 25 points. If any fails, **layer B is reported as a broken instrument and no
content-knowledge number is published.**

**Estimands (B).**
- **Primary: share of scored works with LOW content score** = Pro answers correctly ≤ 20% of the work's
  non-guessable valid questions (≤ 1 of 5), among works with ≥ 3 non-guessable valid questions ("scored"). Wilson CI.
- Question-level: closed-book accuracy minus guessability accuracy on all valid questions (paired, bootstrap 4,000
  over works).
- Cross-tab with run-2 R on W: P(low content | recalled) vs P(low content | not recalled), and the share of recalled
  works whose content Pro does not know ("can name the author" does not imply "knows the content").
- Opus on its 50: same primary and the Opus–Pro agreement on low/not-low (κ).
- Breakdowns: language, visible/held, century.

---

## Layer C — public machine-readable text (cost $0)

Per work in the 500: does a machine-readable text of the WORK (any edition) exist publicly, outside sourcelibrary.org?

| source | method | counts as |
|---|---|---|
| Internet Archive | metadata API for the edition's IA identifier (IA-sourced books): a non-empty `*_djvu.txt` file | raw OCR |
| MDZ / BSB | IIIF manifest: canvas `seeAlso` OCR (hOCR); fetch one middle canvas's OCR, ≥ 200 chars of text | raw OCR |
| e-rara | METS (OAI GetRecord): a `FULLTEXT` fileGrp with ≥ 1 file | raw OCR |
| SBB, Göttingen, SLUB | METS/manifest FULLTEXT where the record exposes it; else `unknown` | raw OCR |
| Gallica | answers 403 to this box → `unknown` | — |
| Wikisource | MediaWiki search on the work's language wiki (+ `mul`, `en`) with author surname + up to 3 title words; candidate if a result title shares a title word or the author | curated |
| CText | `searchtexts?title=` for CJK titles | curated |
| Sefaria | `api/name/` on the transliterated/English title for Hebrew/Aramaic works | curated |
| Perseus | title/author match against the canonical-greekLit / canonical-latinLit catalogues (GitHub) for Greek/Latin works before 1500 | curated |
| GRETIL | title match against the GRETIL index page for Sanskrit/Pali | curated |
| 84000 / BDRC eText / ACIP | not queryable by title from here unless an API answers → `unknown` for Tibetan | curated |

Every automated **candidate** is checked by eye (the analyst opens the record and decides whether it is the same
work); only confirmed hits count. A seeded 40 of the per-work results (hits and misses) are re-checked by eye and the
error rate reported. **A source that could not be queried for a work is `unknown`, not `absent`.**

**Estimands (C).** **C+** = a public machine-readable text of the work was confirmed in ≥ 1 source. Reported:
C+ (any), C+ curated, C+ raw OCR only; and **C-unknown** = works for which no source relevant to their provider and
language could be queried. Shares of the 500 and of W, Wilson CIs.

---

## Fusion and the "strongest offer"

One per-work table: R (run 2), A+ / A++, B score (where measured), C+.
**Agreement matrix**: pairwise 2×2 tables and κ among R, A+, C+, and B-low (on B works).

> **STRONGEST OFFER (primary fused estimand)** = work in **W** with **no verified recall (not R)** AND **no crawl
> presence (not A+)** AND **no confirmed public e-text (not C+)** AND, where B was measured and scored, **low content
> score**.

- Reported by **works** (share of W, Wilson CI), **volumes** and **pages** (ratio estimates, 4,000-resample percentile
  bootstrap over works, using run 2's `volumes` and `pages`), by language and by visible/held, provider and genre.
- **Conservative bound**: the same, also excluding works whose C is `unknown` for their provider's OCR service
  (Gallica, unqueryable providers) — they count as NOT in the offer.
- **Without A**: not R AND not C+ (and B where measured) — for comparison, because A's sensitivity on our OCR may be
  low; the report says which of the two a sentence uses.
- **Unrestricted over 500**: works outside W count as "not recalled" (upper bound, labelled).
- If layer A or B is broken by its stop rule, the fused estimand is reported **without that layer**, and named so.

## Cost and stop rules

- Hard cap **$10** across Gemini, metered with `endpoint: 'eval/ai-exposure-r3'` in `gemini_usage` and in a local
  `spend.jsonl` (cost by `costOf`). Calls stop at **$9.50**. `gemini-script-client` has no batch path, so all calls
  are realtime. Order of dropping if the cap binds: guessability for non-famous works is never dropped (it defines
  the estimand); first the Opus arm's famous controls, then generation is cut to the first 120 works (seeded order).
- Claude arms: subscription subagents only, ≤ 8 agents, ≤ 25 requests each, outputs to files.
- Layers A and C: free public APIs, polite concurrency; any source that rate-limits is backed off, not hammered.

## Known limitations, stated in advance

- A finds text in the crawl, not training; and only an exact 8-word (10-char, 8-syllable) match, so any OCR or
  orthography difference between our transcription and a web copy hides it. P-ours measures that.
- A hit may be a shared quotation rather than the work; the by-eye provenance check estimates the share.
- Infini-gram v4 indexes compare Llama-2 tokens; a query string tokenised in isolation may differ from the same string
  tokenised in context, lowering sensitivity for those indexes only.
- B tests knowledge of what a translated page says, through our English translation; question writers and the judge
  are Gemini models, and the guessability baseline uses the same model as the test (Pro).
- B covers only works with ≥ 10 translated pages, which skews to visible, curated books.
- C searches by title and catalogue author, which misses works catalogued under other names; and raw OCR availability
  is checked per edition we hold, not for other editions.

## Amendment 1 — before any passage query (2026-10-06, ~23:50 UTC)

Written after fetching the positive-control web texts and before any count query on any passage.
1. **Line breaks.** Crawled text keeps the source's line breaks (verse lines, `<l>` in TEI, hard-wrapped
   Gutenberg/IA text), so a space-joined passage that crosses a line can never match. Cleaning therefore keeps
   each source line break as a separator. A passage that crosses one is queried in TWO forms, all spaces and
   with `\n` at the source breaks; it hits if either hits. (Our OCR stores a paragraph per line, so this mostly
   affects web and IA sources.) The "drop first and last line" rule is unchanged and applied as written.
2. **CText's API refuses this IP** (`ERR_REQUIRES_AUTHENTICATION`), so P-web takes the Chinese classics from
   Chinese Wikisource (zh.wikisource) instead, and in layer C CText is `unknown`.
3. Wikimedia requests carry a descriptive User-Agent; Agrippa (Esoteric Archives URL dead) and Zohar (Sefaria
   complex ref) are replaced from the list as allowed above, by Euclid's Elements (Perseus) and Lucretius
   (Gutenberg).
