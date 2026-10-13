---
stage: translation
measure: judged_vs_reference
languages: [he, ar, fa, sa, pi, lzh]
scripts: [Hebr, Arab, Deva, Hani]
canons: []
n_books: 183
n_pages: 183
verdict: "No language reverses: with 30 referenced books each, Flash beats Lite by +0.33 to +0.57; Hebrew, Arabic, Sanskrit, Pali meet the card; Persian stops at a census of 28."
status: adopted
decision: "Flash translation routing (PR #5740) kept; Persian census and Chinese as provisional pending Derek (#5873)"
superseded_by: null
issue: [5873, 5740]
---
## 2026-10-06 · With 30 referenced books a language, does the Flash translation routing (#5740) keep its place under the routing card? (#5873 top-up)
<!-- PRIOR ART: 2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md and 2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md (the first runs: 12–28 books a language, no rule registered); 2026-10-05-decision-cards-audit-5873.md (which found them short). This run adds books under a rule fixed first; it builds no new judge. -->

**Answer. No language reverses. Hebrew, Arabic, Sanskrit and Pali keep Flash and now meet the card. Chinese meets its per-language line, but a $1.7K routing still owes a replication and a judge checked against readers. Persian has the largest effect and stops at 28 books, because the library holds no more Persian books that anyone has translated.** The Hebrew/Arabic/Persian top-up (41 fresh books) passes the rule alone, so it replicates the first run.

**Status.** The registration below was committed (first commit of PR #5932, `13c7455f7`, authored 2026-10-06 08:04 UTC; the Batch jobs were submitted at 08:49) before the book draw, before any arm ran and before any page was judged. It is not edited; departures are listed as deviations, and the results follow them.

### Registration (2026-10-06)

- **Question.** Per language (Persian, Hebrew, Arabic, Pali, Chinese, Sanskrit): once the language has 30 referenced books, does Flash instead of Lite for translation meet the routing card (`eval-design.md` §10.2, card 1)?
- **Rule as data:** `scripts/eval/ref-topup-5873/rule.json` (`ref-topup-5873-v1`), applied by `cardVerdict` / `effectBeyondFloor` / `heterogeneity` in `scripts/eval/lib/routing-rules.mjs`.
- **Measure.** `judged against a human reference`: fidelity 1–5, two blind Opus judges, the shared harness `translation-vs-reference/` unchanged. The effect is Flash − Lite, paired by page, with a seeded percentile bootstrap (seed 5873, 10,000 resamples). The floor is Lite twice on the same pages in the same run.
- **Sample.** One page per book. Books are drawn in seeded order (seed 5873) from every live translated book of the language that the first runs did not already use or try; an alignment agent takes each book's first seeded candidate page that a published English translation covers. The top-up is the first *k* books that align, in draw order: Persian 18, Hebrew 15, Arabic 10, Pali 9, Chinese 6, Sanskrit 2. A book that does not align is recorded with its reason. Where the supply runs out, n is reported as reached.
- **References.** As T4 and T5: public-domain and openly licensed translations are stored; an in-copyright one is scored privately and only scores and quotes of ≤ 15 words leave the private directory (#5488). Sefaria community translations are excluded (no named translator). Pages with printed English on or beside them are excluded (the translator would see the reference).
- **Arms on the added pages.** `served` (what readers see), `lite`, `lite2` (A-vs-A), `flash`: the production single-page prompt with neighbouring OCR, the production generation config, through the Batch API (`tibetan-mt-ab/batch-arms.mjs`, the #5606 / T5 runner). Deviation from T4 known in advance: T4's arms also carried the previous page's served English; T4 measured that context at +0.04 [−0.13, 0.21].
- **Pools, named now.** HAP = T4's 52 books + the Hebrew, Aramaic, Arabic and Persian top-up. SPC = T5's 68 books + the Sanskrit, Pali and Chinese top-up. First run and top-up are pooled per language and per pool; this pooling is registered before the second draw. A pool is used only if the heterogeneity check passes.
- **Minimum effect** 0.25 fidelity points. **Tiers** from the untranslated backlog at the measured Batch price difference ($0.00094 a page; `results/ref-topup-5873-2026-10/census.json`): Persian $70, Hebrew $46, Arabic $49, Sanskrit $228 (medium); Pali $7 (small); Chinese $1,672 (large).

**Verdict per language**

| verdict | when |
|---|---|
| **keeps** | n ≥ 30 (Pali: a census of its 26 live books), and the language's line on the card clears: its own effect has a 95 % interval that excludes 0, a point estimate outside the pool's A-vs-A interval and ≥ 0.25; or the pool is usable and the language's own point estimate is ≥ 0.25. Guard G1 holds. |
| **reverses** | n ≥ 30 (or the census), and either the upper 95 % bound of Flash − Lite is under 0.25, or the point estimate is ≤ 0. The proposal is then to return that language to Lite. It goes to Derek as a decision line and is not applied here. |
| **still insufficient** | anything else. The verdict names what is missing. |

- **Guard G1 (fresh pages).** The first run's sign was known when this rule was written, so pooling favours "keeps". A language with ≥ 10 top-up pages whose top-up-only point estimate is ≤ 0 cannot be "keeps".
- **Gate.** Wrong-page, planted-change and duplicate controls pass for both judges, or no verdict is issued.
- **Exclusions.** A page enters a language's effect when Lite and Flash both returned text and both judges scored both. A page whose reference cut both judges call wrong is dropped and listed. Nothing else is dropped.
- **What "keeps" does not waive.** Medium tier needs the registered pool at decision grade or a replication. Large tier (Chinese) needs decision grade, a replication on ≥ 30 fresh books and a judge calibrated against readers; this top-up supplies none of the three. If the HAP top-up (43 fresh books) passes the effect test alone it is reported as a replication of the T4 pool.
- **Reported, not in the rule.** Served fidelity with its interval per language (an absolute judged number; it decides nothing until the judge is calibrated against readers), reversals, omission, canonical against non-canonical, the top-up-only effect.
- **Cap.** $5 of Gemini. No write to `pages` or `books`.

### Deviations recorded after the draw, before any alignment or arm (2026-10-06)

- **Pali.** The registration assumed about 10 untried live Pali books. The draw found 18 (of T5's 16 Pali books only 8 are among the 26 live, Pali-labelled books). All 18 are tried and every one that aligns is used, so the Pali cell can pass 25 and is a census only if all 18 were tried.
- **Books prepared.** The seeded order was extended from 40 / 30 / 20 / 10 to 90 / 70 / 120 / 30 books for Hebrew / Arabic / Chinese / Sanskrit (the shuffle is deterministic, so the longer list only appends). A random draw of live books is mostly material nobody has translated: 52 of the first 120 Chinese books are volumes of one rhyme dictionary and other Siku reference works.
- **Sealed draw:** `results/ref-topup-5873-2026-10/sealed.json` (book order and candidate pages; seed 5873). Alignment brief: `results/ref-topup-5873-2026-10/briefs/ALIGN-BRIEF.md`.
- **Supplementary draw from hidden books (recorded after alignment, before any arm).** Every live translated Persian book (46 untried) and Pali book (18) was tried: 15 and 11 aligned, leaving Persian at 27 and Pali at 27. A second seeded draw (`sealed-hidden.json`) took books that are not visible but have translated pages, up to 3 a language: Pali 3 of the first 3; Persian 1 of 8 (four have no eligible page, two are English books). Their pages enter Flash − Lite; they are left out of the served score, because no reader sees them. **Persian therefore ends at 28: there is no further Persian book in the library to add.** The registration gave the census clause to Pali only, so Persian at 28 is reported under the rule as written (short of 30) and, separately, as the census it turned out to be.
- **In-copyright references read from user uploads.** 13 of the 63 added references are in copyright and scored privately (#5488). Most were read from user-uploaded scans on archive.org. They are flagged, and every effect is also reported without them.

### Result (2026-10-06)

- **measure:** judged against a human reference (two blind Opus judges; not accuracy). **Gate passed for both judges** (wrong page 3/3, planted change 3/3 located, duplicate 3/3 tied). Agreement on 254 cells: exact 85 %, within one point 100 %, weighted κ 0.91. No reference cut was judged wrong (128 judge-pages: 71 exact, 32 wider, 23 narrower, 2 offset), so no page was dropped.
- **Sample reached.** 383 drawn books were tried; 73 aligned; 64 pages were used (one page a book). 51 references are open and 13 are in copyright (scored privately). 32 pages are canonical, 32 are not.

| language | tried → aligned | added | n (first + top-up) |
|---|---|---:|---|
| Persian | 46 live → 15; 8 hidden → 1 | 16 | 28 (12 + 16) |
| Hebrew | 90 → 20 (one of them Aramaic) | 15 | 30 (15 + 15) |
| Arabic | 70 → 12 | 10 | 30 (20 + 10) |
| Pali | 18 live → 11; 3 hidden → 3 | 14 | 30 (16 + 14) |
| Chinese | 120 → 7 | 6 | 30 (24 + 6) |
| Sanskrit | 28 → 4 | 2 | 30 (28 + 2) |

**Verdict per language** (`results/ref-topup-5873-2026-10/verdicts.md`, written by `ref-topup-5873/analyze.mjs` from the rule file):

| language | tier | n | served fidelity [95 %] | Flash − Lite [95 %] | top-up pages alone | verdict |
|---|---|---:|---|---|---|---|
| Hebrew | medium ($46) | 30 | 4.10 [3.85, 4.32] | +0.40 [0.18, 0.63] | +0.20 [−0.07, 0.47] (n 15) | **keeps** |
| Arabic | medium ($49) | 30 | 3.67 [3.28, 4.03] | +0.42 [0.08, 0.70] | +0.40 [0.00, 0.75] (n 10) | **keeps** |
| Persian | medium ($70) | 28 | 3.24 [2.87, 3.59] | +0.57 [0.34, 0.80] | +0.53 [0.19, 0.88] (n 16) | **still insufficient** by the rule as written (2 books short); **keeps** if read as the census it is |
| Sanskrit | medium ($228) | 30 | 3.43 [3.12, 3.72] | +0.42 [0.17, 0.68] | +1.00 (n 2) | **keeps** |
| Pali | small ($7) | 30 | 3.54 [3.21, 3.87] | +0.52 [0.20, 0.88] | +0.50 [0.14, 0.82] (n 14) | **keeps** |
| Chinese | large ($1,672) | 30 | 3.88 [3.59, 4.14] | +0.33 [0.15, 0.52] | +0.33 [−0.33, 0.83] (n 6) | **keeps** its per-language line; the tier still owes a replication and human calibration |

| pool | n | Flash − Lite [95 %] | A-vs-A (Lite twice) | heterogeneity | top-up alone |
|---|---:|---|---|---|---|
| Hebrew, Aramaic, Arabic, Persian | 93 | +0.46 [0.32, 0.60] | +0.01 [−0.10, 0.11] | passes | +0.38 [0.18, 0.57] on 41 fresh books; floor +0.10 [−0.06, 0.26]: **passes alone, a replication** |
| Sanskrit, Pali, Chinese | 90 | +0.42 [0.27, 0.58] | −0.03 [−0.15, 0.11] | passes | +0.50 [0.20, 0.77] on 22 fresh books: too few to count as a replication |

- **What would have reversed a language** was an upper bound under 0.25 or a point estimate at or under zero at n ≥ 30. The lowest upper bound is Chinese's 0.52 and the lowest point estimate is Chinese's +0.33.
- **Served fidelity** is an absolute judged number. It decides nothing until the judge is checked against readers. Hidden books are left out of it. Aramaic (5 first-run pages, +0.50) is reported and not decided.
- **On the 63 added pages with both arms:** Flash 4.21, Lite 3.78; reversed statements 6 against 24 per 100 pages; omission on 22 % against 33 % of pages.

**Where the result is thin**

- **Hebrew's fresh pages alone do not show the effect:** +0.20 [−0.07, 0.47] on 15 pages, against +0.60 on the first 15. Guard G1 holds (the estimate is above zero) and the combined cell passes on its own. The seeded draw landed on scripture and liturgy (13 of the 16 pages; 10 are JPS 1917 Bible text), where the served English already scores 4.38 and leaves little to gain.
- **Arabic's Qur'an pages gain nothing** (+0.10, n 5); its other five pages gain +0.70 [0.30, 1.00].
- **Chinese rests on its first 24 books.** A random draw of 120 live Chinese books found 7 with any published English, and 5 of the 6 used are in copyright (Luo Xiwen's *Bencao gangmu* three times, the Yangs' *Scholars* twice). Without private references Chinese is +0.36 [0.20, 0.54] on 25 books. A replication on 30 fresh Chinese books needs about 500 random books tried, or a hand-picked list as in T5.
- **Persian is a census.** Every live Persian book (62) and every hidden one with translated pages (9) has been tried; 28 could be referenced. The rule gave the census clause to Pali only, so Persian is "still insufficient" as written. Its effect is the largest and is the same on the fresh pages.
- **Refusals.** Lite refused one Hebrew page (Psalm 72, RECITATION) on 4 of 4 requests; Flash translated it. That page has no pair, and the next aligned Hebrew book in draw order replaced it before any page was judged. Three other refused requests succeeded on one resend (Lite twice, Flash once).
- **The first run's sign was known** when the rule was written, and judges, alignment agents and the instrument's blind spot (fidelity to the transcription, not the page) are as in T4 and T5. The arms are single-page; T4's also carried the previous page's English.
- **Sensitivity without the 13 private references:** Hebrew +0.41 [0.19, 0.66], Arabic +0.37 [0.02, 0.67], Persian +0.56 [0.29, 0.83], Pali and Sanskrit unchanged, Chinese +0.36 [0.20, 0.54]. No verdict changes.

**Side finding: catalogue labels.** The draw met 4 Chinese Buddhist texts labelled Persian and 1 labelled Arabic, 5 English books labelled Persian, a Hindi manual labelled Sanskrit, a Persian Dioscorides labelled Arabic, and several titles that do not match their pages (a Ming play catalogued as Ricci's world map, another as his *Jiren shipian*). They are listed with reasons in `alignment.json`, for #4884.

**Decision proposed: none. No routing constant changes.** Three questions go to Derek: whether Persian's census of 28 counts; whether Chinese stays on Flash as provisional until a replication and the calibration set (#5406); and whether in-copyright references read from user uploads on archive.org may stay in private scoring.

- *Cost.* Gemini **$0.24** at the Batch rate (9 Batch jobs, all registered in `batch_jobs` as `external_eval`; cap $5). Alignment and judging on the subscription. No write to `pages` or `books`.
- *Replicated?* The Hebrew/Arabic/Persian pool: yes, the 41 fresh books pass alone under the registered rule. Sanskrit/Pali/Chinese: same sign and size on 22 fresh books, short of the 30 a replication needs.
- *run_id:* `ref-topup-5873-2026-10`.
- *Files.* `results/ref-topup-5873-2026-10/`: `verdicts.md`, `summary.json` (every number above), `results.json` (harness output; private quotes clipped to 15 words), `pages.jsonl` (page × arm, our texts and scores), `references.jsonl` (open reference texts; 13 withheld), `alignment.json` (every book tried, with the reason it failed), `sealed.json`, `sealed-hidden.json`, `refusals.json`, `gallery.md`, `census.json`, `packet/` (key and manifest). Scripts: `scripts/eval/ref-topup-5873/` (`rule.json`, `census.mjs`, `draw.mjs`, `select.py`, `merge-arms.py`, `analyze.mjs`, `export.py`), on `translation-vs-reference/` and `tibetan-mt-ab/batch-arms.mjs` (new opt-in `--register`).
