---
stage: translation
measure: none
languages: [lzh, sa, pi]
scripts: []
canons: [chinese-buddhist, chinese-classics, sanskrit, pali]
n_books: null
n_pages: 138
verdict: "Built a 138-unit reference set (75 typed Chinese canon passages, 23 Sanskrit, 40 Pali pages), each with a fit-checked open English (132 same, 7 minor); Sonnet arm run, nothing judged yet."
status: informational
decision: null
superseded_by: null
issue: [6331, 6339]
---
## 2026-10-08 · Chinese canon reference set and the Sanskrit/Pali extension (#6331 tests 2 and 5) — set built, Sonnet arm run, nothing judged yet
<!-- PRIOR ART: 2026-10-08-pareto-sample-audit-6304.md (judged the #6182 Chinese panel unfit: 21 pages, 17 under 300 characters, printed canon only; its page checks now live in scripts/eval/lib/page-fitness.mjs and run here before any arm); scripts/eval/pareto-6182/units.mjs (the prompt v13 request this set reuses); scripts/eval/translation-vs-reference/ (#5695 harness; records.jsonl follows its input format). -->

**Question.** Does a $200/month subscription route translate the canon gap well? The gap is 79% typed Chinese (CBETA, Kanripo). The existing Chinese panel cannot answer that, so this builds a set that can: one passage per text, 600–2,500 source characters, each with an open published English for the same span.

**Status (8 Oct 2026).** The set is built and checked. The Sonnet arm has run on the subscription. Nothing has been judged. No Gemini arm was run here. Spend: $0 (no API call; Claude only through subagents on the subscription).

**The set: 138 units kept of 140 built.**

| set | stratum | kept | not famous |
|---|---|---|---|
| zh-canon | CBETA Taishō sūtra | 11 | 7 |
| zh-canon | CBETA śāstra, commentary, history (T22–T54) | 13 | 9 |
| zh-canon | CBETA Chan | 9 | 2 |
| zh-canon | Kanripo KR1 classics | 10 | 3 |
| zh-canon | Kanripo KR2 histories | 11 | 8 |
| zh-canon | Kanripo KR3 masters | 10 | 7 |
| zh-canon | Kanripo KR4 collections | 9 | 3 |
| zh-canon | Kanripo KR5 Daoist canon | **2** | 1 |
| sa-ext | Sanskrit held pages (new works) | 23 | 18 |
| pi-ext | Pali held pages (new texts) | 40 | 34 |

- **Chinese: 75 units, all typed text.** 40 of the 75 (53%) are not famous. 26 references are free-to-read BDK PDFs marked `private` (all rights reserved); the rest are public domain or CC.
- **KR5 falls short of 8.** Builders found 2 Daozang texts that have an open English covering a passage of 600 characters or more. The Qingjing jing, Yinfu jing, Riyong jing and Yinzhi wen are under 600 characters. Legge's Yushu jing covers only 368 characters.
- **The strata are not in proportion to the gap.** KR4 is about 29% of the gap's characters but 12% of the set. KR1, KR5 and Chan carry the 8-unit floor. Each stratum should be read as its own panel.
- **Sanskrit stops at 50 fit pages, not 60.** The 23 new pages and the #6182 set's 27 fit pages make 50. Three builders tried about 105 held works. The rest fail because a commentary, a Hindi gloss or a printed English sits on every page, because the manuscript OCR is garbled, or because there is no open English for the recension we hold.
- **Pali: 68 fit pages** (40 new and 28 from #6182). 30 of the new units are further suttas from Nikāya volumes already in the set, each a sutta not used before (`nikaya-sutta`). Every Pali reference is a SuttaCentral CC0 translation. Its translators ask that their translations not be used to train AI; here they serve only as references for judging.
- **FP (stored production English) exists for 47 held pages** (35 Pali, 12 Sanskrit). The typed Chinese has none, so its baseline is still to be decided.

**Checks, run before any arm existed** (`build-set.mjs --finalize`):
- Source length 600–2,500 characters.
- #6304 checks 1–2: near-empty page, wrong script or language, and English printed on a held page.
- One unit per work, counting the #6182 texts.
- #6304 check 3, as soft flags: length ratio and unmatched numbers.
- An independent fit read in place of the judges' `reference_fit`. Seven Opus subagents read every source against its reference, blind to the builder's notes. Labels were `same` / `minor` / `narrower` / `wider` / `offset` / `wrong` / `cant_tell`, and anything other than `same` or `minor` was dropped.

Fit reads: 132 `same`, 7 `minor`, 1 `narrower`. The checks dropped 2 units: a numeric Gaṇitasārasaṃgraha page (near-empty) and a Ṣaṭcakranirūpaṇa page with untranslated commentary (narrower). Before this step the builders reported about 180 rejected candidate works or spans, mostly for abridged or loose translations, spans under 600 characters, or sources missing from Kanripo.

**Limits.**
- The fit readers are Opus, the same family as the judges to come. A `same` rate of 94% may be lenient. The builders' own notes record a few drops inside spans (Giles abridges, BDK OCR slips).
- References from 19th-century translators often follow another recension. Where a builder saw this, it is noted per unit (for example Beal's numbers in the Xiyuji, and the Siku respellings in the Xishiji).
- Several Kanripo units (KR2, KR4, the Yili, Suwen and Ganying pian) are unpunctuated Siku/WYG text, closer to what production reads from Siku manuscripts than CBETA's punctuated text. The count is not measured.

**Files.**
- Committed: `scripts/eval/canon-ref-6331/build-set.mjs` and `page-dump.mjs`, `scripts/eval/lib/page-fitness.mjs`, and `scripts/eval/results/canon-ref-6331/summary.json` (ids, sources, licences, flags, fit verdicts; no source or reference text).
- On the box:
  - prompts: `/root/cli-set-6331/prompts/<set>__<uid>.txt` (138)
  - units: `/root/cli-set-6331/units.jsonl`
  - arms: `/root/cli-set-6331/arms/CS.jsonl` (Sonnet, 138) and `arms/FP.jsonl` (47)
  - harness records with reference text: `/mnt/HC_Volume_105839809/jobs/zh-set-6331/records.jsonl` (never committed)
  - builder brief and caches: `/mnt/HC_Volume_105839809/jobs/zh-set-6331/`

**Next.** C38 (CLI) on the same prompts, then two blind Opus judges with plants and duplicates (#5695 harness), per #6331.
