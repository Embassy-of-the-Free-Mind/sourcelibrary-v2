---
stage: metadata
measure: [judged, agreement]
languages: [de, fr, it, es, nl, la, en]
scripts: [Latn]
canons: []
n_books: 1500
n_pages: null
verdict: "Of works first printed 1400–1700, the share with ANY published English (grounded Gemini 3.8 Flash-low; on 60 a language a blind Sonnet read and a third read settled disputes) is 1.3% German, 7.0% French, 4.1% Italian, 4.7% Spanish, 6.0% Dutch (n≈300 each, Wilson CIs 0.5–3.4 to 4.6–10.5). Works COMPOSED in the language with an English translation are 0.3–1.7%: most positives are editions that are themselves translations, from Latin or another vernacular or from English. Gemini missed 5 of 13 translations the second read confirmed (sensitivity 0.62). After that correction the shares are 1.0–8.7%, with wide intervals. Catalogued recall is 0 of 72. Work grouping: wrong merges 4–7 of 30 in five languages and 14 of 30 in Spanish (formulaic anonymous titles); missed merges 22 of 30 in French. Scan coverage (harvested IIIF, a floor) runs from 22.7% of Latin works down to 0.4% of Dutch; the scanned, not-translated, not-held queue is 55,449 works across seven languages. 2026-10-30."
status: informational
decision: "No write. Three follow-ups for #7751: phase 11 counts each USTC newspaper issue as a work (German 69,646; Dutch 20,958; French 17,599; English 11,085); the anonymous first-6-token join over-merges formulaic Spanish titles; generic short French titles under-merge. Harvesting Italian, Spanish and Dutch manifests is what limits Part C there."
superseded_by: null
issue: [7751, 7769, 2684]
---
## 2026-10-30 · What share of 1400–1700 works in each vernacular has ever been published in English, and how many are scanned? (#7751)
<!-- PRIOR ART: scripts/analysis/gap-validation-sample.mjs, gap-validation-cli-adjudicate.mjs, gap-validation-estimate.mjs (the June Latin study, n=1000, #2684: its prompt, verdict schema and binary rule are reused); scripts/translation-layer/09-scan-coverage.mjs (the Latin cluster scan matcher, generalised here); the #7751 over-merge sample (40 Latin works, by hand). -->

**Question.** The per-language census (#7751, phase 11 `--lang`) counts the catalogued external translations, but outside Latin the catalogues hold almost nothing (German: 34 works of 221,931). This run measures, for each language: what share of works has really been published in English, what share has a scan somewhere, and how good the work grouping is. It is an instrument. It is blind and random, every verdict carries its evidence, and nothing was written to `books`, `translation_catalogs` or any store a cron reads. A Source Library translation never counts as evidence.

**Frames.** Phase-11 works with at least one USTC edition (`work-graph[-<lang>].jsonl`, PR #7774's K=6 run, from `/data/scratch/sl/jobs/inputs-7751/`). German 221,931 works; French 124,168; Italian 68,819; Spanish 59,582; Dutch 74,378; Latin 306,352; English 93,554.

### Part A: sampled translated share

**Design.** For each language, n=300 works were drawn uniformly (mulberry32, **seed 7751**), blind to `ext`/`sl` (`translation-share-sample.mjs`). The query card is built from the work's editions only: modal author, the 2–3 most common edition titles (shortest first), first print year, number of editions. The adjudicator is `gap-validation-cli-adjudicate.mjs --lang <l> --engine agy`. It uses the June prompt, with the language swapped in and three rules added:
- a substantial translation counts;
- a summary or encyclopaedia entry does not;
- a Source Library translation never counts.

It also reports translator, publisher, year and a quoted line. The model is Gemini 3.8 Flash-low on the second account (`AGY_HOME=/root/.agy-james`). That account may run only flash-low, so "Flash" here means Flash-low. Search is grounded: the tool gate's new `search` task allows `search_web` and nothing else. Every one of the 1,500 calls searched at least once.

Second opinion: a blind `claude -p --model sonnet` read with web search, on a seeded random 60 per language (`--subset 60`, seed 7751). Where the two disagreed, a third Sonnet read (`--tiebreak`) was given both verdicts and their evidence and had to open the URLs. Its verdict replaces Gemini's for that work.

**Binary rule** (as in `gap-validation-estimate.mjs`): translated, or not found. Unsure and container verdicts are left out of the denominator.

The **origin** of every positive was then tagged by hand, from the verdict's own prior, quote and URL text (`origin-tags.json`):
- **N:** the work was composed in that language;
- **V:** the edition is itself a translation from a third language (Latin, Greek, Italian, Spanish, French), and that work exists in English;
- **E:** the edition was translated from English, or prints the English itself (the French *Gazette de Londres* issues, Dutch versions of Stuart declarations);
- **X:** the cited evidence does not support the claim.

There are three X verdicts:
- SP081: the quoted FitzGerald line names *La hija del aire* among plays he did *not* translate.
- SP284: the evidence is for a different Granada work.
- FR033: the evidence is Nikephoros's *Breviarium*, not a life of him.

| language | n (well-posed) | any English, minus X | **composed in the language (N)** | N + V | excl. newspaper issues: any / N | Gemini only | corrected for Gemini sensitivity |
|---|---|---|---|---|---|---|---|
| German | 299 | 1.3% [0.5–3.4] (4) | 0.3% [0.1–1.9] (1) | 1.0% (3) | 2.0% (4/198) / 0.5% | 1.7% | 1.0% [0.0–4.6] |
| French | 299 | 7.0% [4.6–10.5] (21) | 1.3% [0.5–3.4] (4) | 3.7% (11) | 5.1% (13/257) / 1.6% | 6.3% | 8.7% [3.9–18.8] |
| Italian | 295 | 4.1% [2.3–7.0] (12) | 1.7% [0.7–3.9] (5) | 4.1% (12) | same (no issues) | 4.0% | 4.9% [0.7–12.8] |
| Spanish | 299 | 4.7% [2.8–7.7] (14) | 1.7% [0.7–3.9] (5) | 4.0% (12) | same | 5.7% | 7.6% [2.7–16.6] |
| Dutch | 299 | 6.0% [3.8–9.3] (18) | 0.7% [0.2–2.4] (2) | 2.7% (8) | 8.5% (18/212) / 0.9% | 5.7% | 7.6% [2.8–16.1] |

Positives by origin (N / V / E / X):

| language | N | V | E | X |
|---|---|---|---|---|
| German | 1 | 2 | 1 | 0 |
| French | 4 | 7 | 10 | 1 |
| Italian | 5 | 7 | 0 | 0 |
| Spanish | 5 | 7 | 2 | 2 |
| Dutch | 2 | 6 | 10 | 0 |

By century of first printing (any English, final verdicts; n per cell in brackets):

| language | 1400s | 1500s | 1600s |
|---|---|---|---|
| German | 0/3 | 2.8% (1/36) | 1.2% (3/256) |
| French | 0/2 | 8.3% (5/60) | 7.3% (17/234) |
| Italian | 1/5 | 6.1% (6/98) | 2.6% (5/191) |
| Spanish | — | 22.6% (7/31) | 3.1% (8/257) |
| Dutch | 0/1 | 5.7% (2/35) | 5.8% (15/260) |

**Catalogue recall** is P(ext = true | adjudicated translated) = **0 of 72** across the five languages (95% upper bound 5–49% per language). Only one sampled work carried `ext` at all (Italian), and it was not found translated. The phase-11 external side outside Latin is the curated series plus the catalogs; #7782's LoC, Open Library and Wikidata sets are not in these inputs.

**Readable on Source Library** in the sample: German 1/300 (held 38), Italian 1/300 (held 5), French, Spanish and Dutch 0/300.

**Second opinion** (60 per language):

| language | agreement | κ (3-way) | disputes | settled |
|---|---|---|---|---|
| German | 59/60 | 0.66 | 1 | GE177 van Noort: Gemini "Purchas 1625", third read: an abridged extract, not found |
| French | 56/60 | 0.47 | 4 | Sonnet found 4 Gemini missed: 3 confirmed (FR065, FR126, FR288 contemporary English pamphlets), 1 unsure |
| Italian | 58/60 | 0.49 (binary 1.0) | 2 | both unsure |
| Spanish | 59/60 | 0.66 | 1 | SP246: Gemini's claim not confirmed |
| Dutch | 53/59 | 0.52 | 6 | 2 Gemini misses confirmed (DU187 Jarrige, DU293 Oldenbarnevelt); 1 Gemini claim and 2 Sonnet claims rejected; 1 unsure |

Pooled against the reconciled truth, Gemini's **sensitivity is 0.62** (8 of 13 positives) and its **specificity 0.99** (278 of 281). Flash-low ran about one search per work, in about 8 s. It finds famous translations and misses contemporary English pamphlet versions, which Sonnet finds by opening STC and EEBO records. The "corrected" column is a pooled Rogan–Gladen correction, 2000-rep bootstrap over both the 300 and the subset. Its intervals are wide because it rests on 13 positives.

### Part B: work-grouping precision

**Design.** Gemini 3.8 Flash-low, no tools, one pair per call, blind to which list a pair came from (`work-grouping-check.mjs`).
- **Wrong merges:** 30 random works with at least 2 editions whose titles are known; two random member editions per work.
- **Missed merges:** 30 random pairs of single-edition works by the same author whose first six distinctive tokens overlap (containment ≥ 0.5, ≥ 2 shared tokens), which the graph did not merge. An author with more than 400 singles is capped at 400 random members.

The judge was checked by reading 15 Spanish wrong-merge verdicts and 12 French missed-merge verdicts by hand. All 27 hold, except that one call separates volumes of a multi-volume *Recopilación* (M23).

| language | wrong merges (k/30) | missed merges (k/30) | missed-merge pool |
|---|---|---|---|
| Latin | 5 | 7 | 35,833 |
| German | 5 | 4 | 17,201 |
| French | 7 | **22** | 10,467 |
| Italian | 4 | 6 | 19,421 |
| Spanish | **14** (+1 unsure) | 13 | 6,287 |
| Dutch | 6 | 12 | 1,333 |

What drives the two outliers:
- **Spanish wrong merges** come mostly from the anonymous identical-first-6-token join. It merges distinct legal briefs ("In processu … super apprehensione"), gazette issues, royal decrees ("Don Felipe rey de Castilla …") and *relaciones*. Two are surname-stem merges of different authors (Granados / Granados de los Ríos).
- **French missed merges** are short, generic titles that fail the specificity gate: *Le theatre du monde* (Boaistuau) is left as separate works in 1562, 1563, 1565, 1590 and 1619; *Traicté de l'amour de Dieu* too.

### Part C: scan coverage (floor)

**Design.** `09-scan-coverage.mjs --lang <l>` matches harvested IIIF manifests (Mongo `import_candidates`, read-only, `manifest_url` set) to the WORKS of phase 11. Every edition is a target.

Which manifests count: those whose `language` names the language, plus the untagged ones. There are 1,256 spellings. A value counts when it holds the language's code or word (`ger`, `German`, `pol;ger;lat`, `englat` …). Untagged means `Unknown`, `und`, null or `Multiple`: 342,010 manifests.

How a match is made:
- **Authored editions:** the author-stem anchor plus phase 11's own join: the first 6 distinctive tokens, IDF-weighted containment ≥ 0.6, and the specificity gate.
- **Anonymous editions:** an authorless manifest with an identical first-6-token title (orthography folded, ≥ 4 tokens) within 2 years.

The first pass reused 09's full-title rule, where one STRONG token anywhere is enough. Only 5 of 20 sampled Latin matches were right, because a dedicatee or toponym late in a title page is rare. With the phase-11 rule, sampled matches were right 30/30 for Latin, 30/30 for German (15 per channel), 10/10 for French, 10/10 for Italian, and 9/10 for English (*Doctor and Student*, first vs second dialogue).

Manifest counts held, by language (with `manifest_url`):

| language | spellings | manifests |
|---|---|---|
| Latin | 288 | 404,777 |
| English | 144 | 384,974 |
| German | 137 | 271,189 |
| French | 89 | 145,747 |
| Italian | 34 | 9,794 |
| Dutch | 15 | 2,538 |
| Spanish | 27 | 1,643 |

The largest groups are not European: Arabic 743K, Chinese 714K.

| language | works | newspaper-issue works | works with ≥1 manifest (floor) | excl. issues | scanned & catalogued ext | scanned & held by SL | **queue** (scanned, ext=false, no SL book) |
|---|---|---|---|---|---|---|---|
| Latin | 306,352 | 11 | 69,673 (22.7%) | 22.7% | 1,747 | 45,231 | **23,860** |
| German | 221,931 | 69,646 | 31,818 (14.3%) | 20.9% | 26 | 21,980 | **9,837** |
| French | 124,168 | 17,599 | 11,125 (9.0%) | 10.4% | 117 | 1,382 | **9,674** |
| Italian | 68,819 | 1 | 1,855 (2.7%) | 2.7% | 51 | 689 | **1,153** |
| Spanish | 59,582 | 5 | 417 (0.7%) | 0.7% | 17 | 80 | **329** |
| Dutch | 74,378 | 20,958 | 289 (0.4%) | 0.5% | 0 | 115 | **174** |
| English | 93,554 | 11,085 | 28,719 (30.7%) | 34.8% | 32 | 18,295 | **10,422** (ext is meaningless for English) |

The queue is written to `scripts/output/scan-queue-<lang>.jsonl`, one row per work: `example_manifest`, sources, and `via`.

**Caveats**
- **Phase 11 counts every USTC newspaper issue as a work.** The sn-less rows of the editions cache are issues: *Wochentliche Post-Ordinari-Zeitung*, *Gazette de Londres. No. 2209*, *Amsterdamse Dingsdaegse Courant*. That is 69,646 German "works" (31% of the denominator), 20,958 Dutch, 17,599 French and 11,085 English. They are almost never translated, except the 8 *Gazette de Londres* issues, so they dilute every share. They also broke the first draw: `eds.get(null)` gave 101 German, 42 French and 87 Dutch works the same card. Those cards were fixed and re-adjudicated before any number here was computed. The pre-fix verdicts are kept in `pre-nullsn-fix/`.
- **"Any English" is not "translated from this language".** In Dutch, 10 of 18 positives are translations *from* English (Stuart declarations, Partridge, Fuller, bilingual broadsides and emblem books). In French, 10 of 21 are, including 8 *Gazette de Londres* issues. The N column is the one comparable to the June Latin gap.
- **Gemini under-detects**, as the sensitivity of 0.62 shows. Uncorrected shares are low by about a third, and the corrected ones are imprecise. X verdicts were found only by reading the evidence text, so there may be more false positives among the 240 works without a second read: 3 of 72 positives failed on their own evidence.
- **Part C is a floor at three levels:**
  - The harvest: Italian, Spanish and Dutch manifests are barely in `import_candidates`.
  - The matcher: anonymous editions match only on an identical title.
  - Sn-less editions match only on their work's representative title.

  "Scanned" means some edition of the work has a manifest. The queue overstates what is untranslated, because `ext` is a floor (recall 0/72 above).
- **Part B** is a model reading two catalogue titles. Short titles are hard for it too.

**Replicated?** The Sonnet second read on 60 per language (above). Part B and Part C precision were checked by hand reads of the judge's verdicts and of the matches.

**Artifacts** (box earthai-l7a; worktree `scripts/output/` is gitignored, and a durable copy is in `/data/scratch/sl/jobs/translation-share-7751/artifacts/`):
- `translation-share/<lang>-{frame,blind,grouping}.json`
- `<lang>-{agy,sonnet,tiebreak}-verdicts.jsonl`: every verdict with queries, sources, URL, quote and raw reply
- `<lang>-final-verdicts.jsonl`, `<lang>-estimate.json`, `summary.json`, `origin-tags.json`, `<lang>-grouping-verdicts.jsonl`
- `scan-coverage-report-<lang>.json`, `work-scan-coverage-<lang>.jsonl.gz`, `scan-queue-<lang>.jsonl.gz`

**Cost:** about 3% of the second account's weekly Gemini pool, 51.6% → 48.4% remaining (shared). Claude: about 330 Sonnet calls on the l7a subscription. $0 API.
