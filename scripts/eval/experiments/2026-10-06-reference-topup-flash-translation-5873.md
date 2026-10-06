## 2026-10-06 · With 30 referenced books a language, does the Flash translation routing (#5740) keep its place under the routing card? (#5873 top-up)
<!-- PRIOR ART: 2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md and 2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md (the first runs: 12–28 books a language, no rule registered); 2026-10-05-decision-cards-audit-5873.md (which found them short). This run adds books under a rule fixed first; it builds no new judge. -->

**Status: REGISTERED, not yet run.** This section was committed before the book draw, before any arm ran and before any page was judged. Results are added below it; the registration is not edited afterwards, and any departure is listed as a deviation.

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
