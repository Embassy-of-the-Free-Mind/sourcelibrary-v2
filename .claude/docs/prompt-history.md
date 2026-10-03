# Prompt history: every OCR and translation prompt, what changed, what it was measured to do, and how many pages it wrote

**Read this when** you are about to change, seed, promote or A/B test an OCR or translation
prompt, or when you need to know which prompt wrote a page ("is this page on v12?").

PRIOR ART: `prompts/README.md` + `prompts/*/` (text snapshots with no counts or evals, and
they lag the DB); `scripts/eval/INDEX.md` / `EXPERIMENTS.md` (evals listed by date, not by
prompt version); `scripts/lib/provenance-history.json` (generation *settings* by writer and
date, not prompts); `.claude/docs/data-provenance.md` (the `page_revisions` record). None of
them joins prompt → evals → pages. This doc does, for #5672.

**Data:** `scripts/eval/results/prompt-history/prompt-history.json`, built by
`scripts/audit/prompt-history.mjs` ($0: Mongo reads and `git log`, no model calls). Refresh
with `node --env-file=.env.production.local scripts/audit/prompt-history.mjs`. It takes about
30 minutes, and the page walk checkpoints and resumes. The snapshot below is from
**2026-10-03**.

Every page count is exact. The script walks all of `pages`: 25,451,743 ObjectId `_id`s and
268,893 string `_id`s, each type walked separately, and each total equals `countDocuments`
for that type. Of those pages, 8,004,944 hold OCR text and 5,495,502 hold a `translation`.

---

## What we learned

**The prompt changes that measurably worked all name a concrete output that can be checked:**

| Change | Evidence (quoted from the source) | Shipped? |
|---|---|---|
| Blank-page rules: "blank" means no ink on this side, and show-through leaves are blank (OCR v18 → v19.1) | v18: "On white leaves the fabrication rate falls from 0.91 to 0.29." v19.1: "It beats v18 on invented pages. On W ∪ T it is better on 15 pages and worse on 4, p 0.019." Fabricated W ∪ T rate: .783 (v16) → .304 (v19.1). | Yes: v19.1 has been the default since 2026-10-02 |
| Translation seam rules: page-break devices plus one rule line (`PAGE_BREAK_SCOPED`, #5103) | "F0 halves the defect rate on device breaks with no duplication penalty" (device-break defects: F0 42%, B 71%). In the 8-page block: "Fs 29%, B 50%". | Yes, ON since PR #5170. **This changed the prompt without bumping `prompt_version`**, so those pages still say v13. |
| Bare continuity marker and "This page only" (v14 candidate items 1/1b, #5305) | "removes text from the continuity `<meta>` (32 / 31 / 0 pages, p < 1e-9) and halves page-boundary invention (20 / 17 / 8 pages; 16 vs 4 discordant, p 0.012)" | No. The bundle it was tested in breached a control guard. |
| Verbatim `original:` notes, or no note (translation v15, #3825) | "verified-note rate 66.7% → 96.3% while writing MORE notes — but v15 also suppresses interpretive notes by a third" | No |
| Long-s line (#5488) | "The line cuts RECITATION refusals by about 70% on both engines. Flash went from 28 to 9 refusals of 142 pages" | As a retry tier for refused pages only, not in the default |

**The changes with no detectable effect mostly asked the model for restraint, or to report something it cannot see:**

| Change | Evidence (quoted from the source) |
|---|---|
| Restraint block, "stop where the page stops" (#5305, PR #5349) | "NO measurable effect on judged invention … invention 18.3% (v16) → 21.1% (v16 + restraint), McNemar 9 vs 7 discordant, p 0.80" |
| The v14 candidate as a whole, including items 3–7: no summary on unreadable pages, plain image notes, identifications only when certain, keep English verbatim, numbering (PR #5669) | "no measurable effect on judged invention, and a control-guard breach. Invention 47.7 % (v13a) / 42.1 % (v13b) / 38.3 % (v14); v14 vs v13a 13 vs 23 discordant, p 0.13" |
| Illegible-page clause (#5305 item 2, PR #5638) | "The clause has no detectable effect on positives, and the model self-withholds on only 3 of 12 illegible pages." The code gate met its rule; the clause did not. |
| Bleed-through line on OCR v15 (#3444 Tier 2) | "no measurable gain." Declared blank: 30/39 vs 32/39. "That is noise at n=39." |
| Four anti-fabrication add-ons (#3444 Tier 3) | "all fabricating Genesis 1:2 through an opaque mask"; "each asks the model to report a state it cannot observe." |
| "Keep each page's text on its page" (#5021) | "a "keep each page's text on its page" instruction fixed none and turned 30→31 into a duplicate." |

**Four lessons about how we change prompts:**

1. **Most versions shipped without being measured.** No eval compared Standard OCR v1–v16, or
   Standard Translation v1–v13, against the version before it. Measured prompt changes begin
   in September 2026, with OCR v17 and translation v15. OCR v16 and translation v13 were each
   the default for a month. They were seeded with no committed script and no A/B test.
2. **One run is not a measurement.** In the v17 acceptance run, a fabricated page fell from
   24,108 to 1,286 body chars. At k=5 the effect "reversed. Two independent k=5 runs put the
   runaway loop on *opposite arms*" (PR #4610). Pre-register, run k ≥ 2, and include an
   A-vs-A noise floor, as the v18, v19.1 and #5305 runs do.
3. **A page's `prompt_version` is a label, not evidence.** 4,433,738 OCR pages and 2,212,309
   translation pages have only a label, often a constant the writer stamped regardless of
   what it sent:
   - `realtime-ocr.mjs` stamps `v5.2026-02` (`TARGET_PROMPT`), and was still doing so on
     2026-10-01.
   - `batch-collector.mjs` falls back to `v5.2026-02`.
   - When no prompt row is passed, the orchestrator labelled OCR `v10`, and
     `translate-worker.mjs` still labels translation `v10`.

   953,899 pages carry the `prompt_id` of DB OCR v10, v11, v12, v14 or v15 while their label
   says `v5.1.2026-03`. To find a page's prompt, read `prompt_id` first, then `prompt_hash`.
   Use the label only when neither is set.
4. **A version number does not identify a prompt.**
   - Two rows are both named "Standard Translation" v12.
   - The "v14" tested in PR #5669 is not the DB v14 row.
   - Translation "v16" exists only in an eval script.
   - OCR v18 and v19 exist only as files.
   - `PAGE_BREAK_SCOPED` changed the translation prompt without a version bump.

   Cite the `_id` or the hash.

**Which prompts still hold the most pages:**
- **OCR:** v12 has the most pages attributable to a prompt row (1,132,296), then v14 (534,460)
  and v16 (501,590). Another 2,481,501 pages say `v5.2026-02` and 1,575,650 say `v10`; those
  labels cannot be resolved to a row.
- **Translation:** v11 has 1,083,285 pages, v2 756,831 and v13 466,988. Another 2,154,655 say
  only `v10`.

---

## How to read the tables

- **`_id` · hash** is the `prompts` row and the first 8 hex digits of `md5(content)`. That
  digest equals the stored `content_hash` on every row.
- **Default from → to** is when the row served production.
  - Rows record only *today's* `is_default`, and flips were direct DB writes. So each date
    comes either from the issue, PR or commit that says so (**stated**), or from the next
    row's `created_at` plus its "Rollback: set is_default on vN" note (**inferred**).
  - Before PR #4570 (2026-09-02), several rows could be the default at once.
- **Pages (id/hash)** counts pages whose `prompt_id` or `prompt_hash` resolves to the row. The
  date range is the first → last `updated_at` among them. That is each page's *last* write, so
  it is a lower bound on when the prompt was in use.
- **Pages (label only)** counts pages whose label matches but that carry no id or hash. Read
  lesson 3 before trusting these.
- **Measured** lists every eval that tested the version, quoted from the source. "None" means
  no eval was found in `scripts/eval/`, `EXPERIMENTS.md`, `DECISIONS.md`, the
  PREREGISTRATION/RESULTS files or the PRs.

---

## Standard OCR (`type: ocr`)

| Ver | `_id` · hash | Created | Default from → to | What changed | Issues / PRs | Measured | Pages (id/hash) | Pages (label only) |
|---|---|---|---|---|---|---|---|---|
| 0 | `6942988af84d061181bc6348` · 16e2a042 | 2025-12-17 | 12-17 → 12-27 (inferred) | First seeded prompt. | f81a70813 | None | 0 | — (19,047 `batch_api` pages from 2025-12-30 → 2026-01-04 carry no version at all) |
| 1 | `69507191da618b752bdc334d` · 422b5dcb | 2025-12-27 | 12-27 → 02-13 (inferred) | XML annotation syntax. | 7bb57a39c (prompt versioning) | None | 0 | — |
| 2 | `698f0509ce487724c41313ab` · e2767655 | 2026-02-13 | a few hours (inferred) | Fixes drop-cap splitting and header/heading duplication; adds `{language_instruction}`. | c2898d554, 76980ab52 | None | 0 | `v2.2026-02` 1,080 |
| 3 | `698f115939b2da94f0204ecc` · aa056cc2 | 2026-02-13 | 02-13 → 02-16 (inferred) | Adds the `<page-type>` classification. | 3b0d22086 | None | 0 | `v3.2026-02` 173,604 (02-09 → 08-04) |
| 5 | `6992d47b0a387ab27668b2c4` · cf81657f | 2026-02-16 | 02-16 → 02-19 (stated, 191020fad) | Adds `<columns>` and `<column-break/>`. This edit glued the `<page-type>` enum onto the `<columns>` bullet, which #4149/#4195 later found was the root cause of blank-leaf fabrication. There is no v4 row. | 6442729f0, 104104b3a | None | 0 | `v4.2026-02` 48,345 |
| 6 | `6996e9959a64d626a1ce6a19` · 8b7af40b | 2026-02-19 | 02-19 → ~03-23 (start stated, end inferred) | `<lang>` → `<language>`. The DB row became authoritative (9e820aea0, #31). | eba7de467 | None | 0 | `v5.2026-02` 2,481,501 (02-19 → **10-01**). This is a stale constant; see lesson 3. |
| 8 | `69c14a6ccdbcdda570638464` · 040a2e31 | 2026-03-23 | unknown, at most 1 day | `<image-desc>` gains size, type and significance. There is no v7 row. | bf476048f | None | 0 | — |
| 9 | `69c25dc452c6cdeca5f9c1f2` · c97ae04f | 2026-03-24 | unknown, at most 31 min | A required `<script>` tag; use `<unclear>` "LIBERALLY" on manuscripts. | — | None | 0 | `v9` 4 |
| 10 | `69c264f6c26fcca147d6bd5e` · a2bb9e51 | 2026-03-24 | 03-24 → ~04-13 (start stated in PR #357, end inferred) | Recalibrates v9: keep transcribing, and use `<unclear>` for 5–15% of words. | PR #357, #384 | Only as the stale "v10-legacy" baseline of the July ablation (#3444), never as a deliberate arm | 63,393 (03-25 → 09-30); 57,608 of them labelled `v5.1.2026-03` | `v10` 1,575,650 (04-04 → 09-03, an orchestrator constant); `v6.2026-03` 18,256; `spread-v*+ocr-v10` 36,586 |
| 11 | `69dd69de346e8052f41bee69` · adc19581 | 2026-04-13 | 04-13 → 04-22 (inferred) | Adds `<scan-quality>`. | — | None | 24,750 (04-14 → 05-02); 24,747 of them labelled `v5.1.2026-03` | `11` 238 |
| 12 | `69e95dce00d00c207591167c` · e1a8c7ee | 2026-04-22 | 04-22 → 06-26 (stated in `tmp-create-ocr-prompt-v12.mjs` and #2764) | Abbreviation expansion (q̃→que, ꝑ→per) for consistency across editions. | #1323, PR #1325 | Baseline only: "20-26% word-level agreement across editions" (#1323). No comparison with v11. | **1,132,296** (04-23 → 06-26); 210,641 of them labelled `v5.1.2026-03`. Also 3,472 pages written 09-30 → 10-02 carry v12's id and hash with the label `16`. Their batch job (e.g. `GZpcuWOKUThEgr7DYighi`, from `bulk-reocr-local.mjs`, #5309) records v16 and the hash of the v16 text it sent. So the page stamp is wrong, not the prompt; the writer that stamped it is not yet traced. | `12` 510 |
| 13 | `69eb244efa7d7ad48b7d0785` · 677b9db3 | 2026-04-24 | never (inferred: v14's notes call it "abandoned") | Stronger margin detection. | #1351 | None | 0 | — |
| 14 | `6a3edbd0fd4d2f05ea592418` · d048140c | 2026-06-26 | 06-26 → 07-09 (start stated in #2764, end inferred) | v12, plus a lacuna/anti-repetition rule against dot-walls, plus v13's margin rule. | #2764, PR #2774 | None | 534,460 (06-26 → 09-13); 504,091 of them labelled `v5.1.2026-03` | `v14-lacuna*` 673 |
| 15 | `6a4f58252ecde61d13c6a3ba` · 98023b57 | 2026-07-09 | 07-09 → 09-03 (stated in #3614, #4195, PR #4570) | v14 plus an output contract: no untagged commentary; remarks go in `<warning>`. | PR #3108 (1,859 pages had preambles) | The change itself: none. Used as the baseline in #3444 Tier 2 and in the v17 A/B tests. | 252,749 (07-09 → 09-03); 156,812 of them labelled `v5.1.2026-03` | `15` 9,329; `v15` 93 |
| 16 | `6a98b8a075660c6a8b09a8f8` · 0203c264 | 2026-09-03 | 09-03 → 10-02 21:29 UTC (stated, PR #5661) | v15, plus: an untranscribable region gets one `<unclear>`, never a description or a repeated glyph. An interim fix, seeded with no committed script. | #4584 | The change itself: none. Used as the baseline for the long-s, v18, v19 and v19.1 tests. | 501,590 (09-03 → 10-02) | `16` 75,199 |
| 17 | `6a98d629415911c56bbb08ed` · e9dc838f | 2026-09-03 | never (stated, PR #4610) | v15, plus all six #4195 items, plus the `<lacuna>` marker. | #4195, #4584, PR #4605 | v15 vs v17 at k=5: "INCONCLUSIVE, and the first-pass finding was retracted". On blank cases: "v17 **over-declines** elsewhere … v17 not promoted". | 0 | — |
| 18 | file only: `prompts/ocr/standard-ocr-v18-candidate.md` | — | never | v16 with four edits: the enum moves onto `<page-type>`; `blank` = "no ink on this side"; a Blank pages section; the DISCURSUS and drop-cap specimens are neutralised and `<insert>` is reworded. | #4195, #4149, PR #5630 | vs v16: "Verdict: not established. Do not promote on this evidence." (S1 5 better vs 2 worse, p 0.45). Screened again by eye: "v18 passes all five clauses. On white leaves the fabrication rate falls from 0.91 to 0.29." | 0 | — |
| 19 | file only: `prompts/ocr/standard-ocr-v19-candidate.md` | — | never | v18 plus two sections: Show-through, and "Document context is not a source". | #4195, PR #5642 (closed) | "v19 fails the over-decline guard by 0.009. Its S3 false-blank rate is 0.381, against a limit of 0.372 … despite the largest fabrication drop of any arm (W ∪ T 0.78 → 0.35, 36 pages better vs 1 worse)." | 0 | — |
| **19.1** | `6ac02220413a82637da889bb` · 9d8f959e | 2026-10-02 21:29 | **10-02 → today** (stated, PR #5661) | v19 with one bullet rewritten: a right-reading stamp or shelfmark on a show-through leaf is text. | #4195, #4149, PRs #5655, #5661 | "Verdict, by the pre-registered rule: v19.1." "It calls more real pages blank than v18: S3 0.360 vs 0.299 … That is the trade." "The new bullet did not get stamps into the body." | 37,533 (from 10-03) | `19.1` 3,598 |

**OCR evals:**
- [v17 lacuna, k=5](../../scripts/eval/experiments/2026-09-02-does-ocr-prompt-v17-reduce-fabrication-vs-v15.md)
- [v17 blank pages, k=5](../../scripts/eval/experiments/2026-09-02-does-4195-s-blank-page-narrowing-work-4195.md)
- [v18 vs v16](../../scripts/eval/RESULTS-ocr-v18-blank-insert.md) ([prereg](../../scripts/eval/PREREGISTRATION-ocr-v18-blank-insert.md))
- [v18/v19 on show-through leaves](../../scripts/eval/RESULTS-ocr-v19-showthrough.md) ([prereg](../../scripts/eval/PREREGISTRATION-ocr-v19-showthrough.md))
- [v19.1](../../scripts/eval/RESULTS-ocr-v19-1-stamps.md) ([prereg](../../scripts/eval/PREREGISTRATION-ocr-v19-1-stamps.md))
- [long-s line on v16](../../scripts/eval/experiments/2026-10-01-does-a-long-s-prompt-line-fix-early-english-ocr-5488.md)
- The July ablation and Tiers 1–3, run on the stale v10-era file: `.claude/docs/ocr-memorization-paper.md` (result 7) and #3444.

### Code-shipped OCR prompts (before the DB was authoritative)

These are the labels pages got from `PROMPT_VERSION` in code. The text is archived as
`prompts/ocr/*-code.md`; commit 77b10bd78 explains the lineage.

| Label | Commit | What changed |
|---|---|---|
| `v2.2026-02` | 14fe4730 | — |
| `v3.2026-02` | c2898d55 | — |
| `v4.2026-02` | 104104b3 | column breaks |
| `v5.2026-02` | eba7de46 | — |
| `v5.1.2026-03` | 62442ef1 | multilingual |
| `v5.2.2026-03` | e0e59e1b, PR #234 | tone |

**None of these was measured.** From 2026-03-24, realtime writers kept stamping the label
`v5.1.2026-03` while they read DB v10–v15. The `prompt_id` on those pages says which row they
actually used.

### OCR pages that no prompt wrote

1,024,435 OCR pages record no prompt, because no Gemini prompt produced them:

| Source | Pages |
|---|---|
| `paddle` | 314,414 |
| `ia_djvu` | 211,898 |
| `bdrc` | 191,897 |
| `esukhia-derge-tengyur` | 128,369 |
| no `source` recorded either (2025-12-26 → 2026-09-18) | 76,072 |
| `kraken` | 38,926 |
| `esukhia-derge-kangyur` | 25,891 |
| `ndl-koten` | 7,133 |
| `cbeta-xml-p5` | 4,983 |
| `mineru` | 2,566 |

---

## Standard Translation (`type: translation`)

| Ver | `_id` · hash | Created | Default from → to | What changed | Issues / PRs | Measured | Pages (id/hash) | Pages (label only) |
|---|---|---|---|---|---|---|---|---|
| 0 | `6942988af84d061181bc6349` · 2118b5cd | 2025-12-17 | from 12-17; end unknown (several defaults at once then) | First seed. | — | None | 0 | `v0` 1,720 (06-10 → 08-14; may be another row's v0) |
| 1 | `69507192da618b752bdc334e` · ce5ce003 | 2025-12-27 | from 12-27; still `is_default` in the 03-24 export | XML annotation syntax. | 7bb57a39c | None | 277,788 (02-09 → 07-17) | `v1` 1,162 |
| 2 | `6992d4b146b85e738a0c3ac4` · 6f712937 | 2026-02-16 | 02-16 → 03-25 (inferred) | Column-break preservation, per the code lineage; the row's description repeats v1's. | 104104b3 | None (it appears only as an observational stratum in #5021 and #5274) | 756,831 (02-16 → 09-03) | `2` 996 (may be Latin v2) |
| 3 | `69c3f5e620d538ddaf875070` · 6cdbf80c | 2026-03-25 14:49 | under 1 hour (stated, #384) | Rules for `<note>`, `<term>` and `<gloss>`. | #384 | None | 0 | `3` 2,003 (ambiguous: German Translation also has a v3) |
| 7 | `69c3fa10388d5bc836fd73fd` · 2f857606 | 2026-03-25 15:06 | at most 18 min | XML tags, no brackets. There are no v4–v6 rows; those numbers were code-era versions. | — | None | 0 | — |
| 8 | `69c3fe3b73c307203fcf455c` · c7aaddcb | 2026-03-25 15:24 | 03-25 → 03-27/28 (stated, 77b10bd78) | Merges code v5.2 (multilingual, tone) with v7's XML rules. Docs kept calling v8 the live prompt until 2026-09-02. | PR #234 | None | 0 | — |
| 9 | `69c6609dc53ec5e9b696a941` · 91484704 | 2026-03-27 10:49 | at most 1 hour | Unknown: the row has no notes. | — | None | 0 | — |
| 10 | `69c67349b52dc5c5ea60defc` · 21379346 | 2026-03-27 12:08 | 03-28 → ~04-14 (start stated in PR #506, end inferred) | Term/gloss pairing, few-shot annotation examples and no bare brackets, for flash-lite. | PRs #467, #506 | None | 0 | `v10` 2,154,655 (03-29 → 09-03). This is a `translate-worker.mjs` constant; see lesson 3. |
| 11 | `69de17371d85ecbcc1558316` · 33ae9a4a | 2026-04-14 | 04-14 → 07-09 (inferred from v12 (B)'s rollback note) | All brackets become XML, and a continuity instruction. It introduced the `<meta>continues from previous page: …</meta>` offer; #5376 found page text after that marker in 75.6% of continuity metas. | — | None | **1,083,285** (04-24 → 10-01) | `v11` 809; `v11-retx` 583 |
| 12 (A) | `69e9dd60f101c2ae01ac00a4` · 4e753a3c | 2026-04-23 | never (stated: "opt-in only") | v11 plus readability rules: short sentences, active voice. | PR #1332 | None | 0 | — |
| 12 (B) | `6a4f58529658a130d55ddbcb` · 1e096024 | 2026-07-09 | 07-09 → 09-03 (stated in #3614, #3825, PR #4570) | v11 (not 12 (A)) plus an output contract; the companion to OCR v15. | PR #3108 | None | 32,264 (07-10 → 09-03) | `12` 5,347 |
| **13** | `6a98b8a175660c6a8b09a8f9` · 51651014 | 2026-09-03 | **09-03 → today** (stated in PRs #4605, #4758, #5661) | v12 (B) plus "`<unclear>` is absence": never translate or invent an unread span. An interim fix with no committed script. Since PR #5170 the `PAGE_BREAK_SCOPED` seam rules ride on it without a version bump. | #4584 | The change itself: none. Used as the baseline for the v15, restraint, seam, illegible-clause and v14-candidate A/B tests. | 466,988 (09-03 → 10-03) | `13` 2,595 |
| 14 | `6a98d629415911c56bbb08ee` · 410de499 | 2026-09-03 | never | v12 plus "`<lacuna>` is absence". Tied to OCR v17. **Not** the "v14 candidate" of PR #5669. | #4584, #4195, PR #4605 | None | 0 | — |
| 15 | `6aa5767fbcba38d6ce451d50` · f60c6810 | 2026-09-12 | never (stated, PR #4767) | v13 plus all five #3825 items: a closed tag vocabulary; verbatim `original:` notes or none; no glossary lines; OCR tags are input only; numbering. | #3825, PRs #4740, #4758 | "verified-note rate 66.7% → 96.3% … but v15 also suppresses interpretive notes by a third, and the blind judge caught it. Not flipped" | 0 | — |
| "16" | code only: `buildV16()` in `translation-restraint-ab.mjs` | — | never | v15 plus the note-scope sentence, and later the bare continuity marker (PR #5433). | #4767, #5376 | An arm in the restraint A/B (below) | 0 | — |
| "v14 candidate" | code only: `translation-prompt-v14-ab.mjs` | — | never | v13 plus #5305 items 1, 1b and 3–7, and the #5137 line. | #5305, PR #5669 | "no measurable effect on judged invention, and a control-guard breach". But it removes text from the continuity `<meta>` and "halves page-boundary invention". | 0 | — |

**Translation evals:**
- [v15 vs v13](../../scripts/eval/experiments/2026-09-12-does-translation-prompt-v15-make-original-notes-real-3825.md) ([prereg](../../scripts/eval/PREREGISTRATION-translation-prompt-v15.md))
- Page-break fix: [F](../../scripts/eval/experiments/2026-09-25-night-page-break-fix-three-arms-on-the-63-5103.md), [F0](../../scripts/eval/experiments/2026-09-25-late-night-page-break-fix-without-the-lookahead-f0.md), [scoped, in the block shape](../../scripts/eval/experiments/2026-09-26-page-break-fix-scoped-and-in-production-s-block-5103.md), [hardened Fs2](../../scripts/eval/experiments/2026-09-25-round-4-page-break-fix-hardened-and-re-measured-5103.md)
- [restraint](../../scripts/eval/experiments/2026-09-30-does-a-stop-where-the-page-stops-instruction-cut-5305.md) ([prereg](../../scripts/eval/PREREGISTRATION-translation-restraint.md))
- [illegible clause](../../scripts/eval/experiments/2026-10-02-illegible-gate-5305.md)
- [v14 candidate](../../scripts/eval/experiments/2026-10-02-translation-prompt-v14-ab-5305.md) ([prereg](../../scripts/eval/PREREGISTRATION-translation-prompt-v14.md))
- Observational, by stored version: [page-boundary drift](../../scripts/eval/experiments/2026-09-24-how-often-does-a-translation-put-text-on-the-5021.md) ("≥500-char context leak: v2 0.11%, v5 0.07%, v10/v11 0.02%, v13 0 of 6,671 pairs").

**The seam rules in numbers** (fix arm better / worse / tied against B, the live v13 prompt):

| Comparison | Seams | Result | Defect rate | p | Verdict |
|---|---|---|---|---|---|
| F vs B | all 63 | 32 / 15 / 16 | — | 0.019 | "Not a flip" |
| F0 vs B | device breaks | 15 / 5 / 4 | "F0 42%, B 71%" | 0.041 | — |
| Fs vs B, in the block | device breaks | 11 / 3 / 10 | "Fs 29%, B 50%" | 0.057 | — |
| Fs2 vs B | device breaks | "10–5–9" | "defective 38% vs 58%" | — | "duplication 2 vs 6" |

### Translation pages from prompts that have no row

| Pages | Text | Label | Written |
|---|---|---|---|
| 186,743 | hash `fe12a293`, found neither in `prompts` nor in `prompts/` | `v5.2026-02` | 03-17 → 06-26 |
| 108,200 | `prompts/translation/standard-translation-v5-2-2026-03-code.md` | `v5.1.2026-03b` | 03-24 → 08-04 |
| 42,163 | no hash | `v6` | 03-29 |
| 91,775 | none recorded, `source: system` | — | 04-12 |
| 12,206 | none, `source: same-language` (no model) | — | 09-30 → 10-02 |

---

## Other `prompts` types

| Type / name | Versions (hash, created) | Default | Pages |
|---|---|---|---|
| Latin OCR (Neo-Latin) | v0 63faf84c (12-21), v1 974040d6 (12-27), v3 2b620789 (02-16), v4 862c45bb (02-19) | none | 0. The orchestrator uses Standard OCR for every book. |
| German OCR (Fraktur) | v0 db9b8bf9, v1 8b935b75, v3 0b3e4eb0, v4 d18df16d, v5 7209d2de (04-12, from #384) | none | 0 |
| Arabic / Hebrew OCR | v1 9ed1d611 / 2a4691ef (04-12, #384, PR #995) | none | 0 |
| Cuneiform OCR / Translation | v1 d03a0e1e / eb7500a9 (03-06, a blog experiment) | none | 0. The ETCSL import wrote 5,749 pages labelled `etcsl-import`. |
| Music pages | v1 09446445, v2 073838a6 (01-02) | none | 0 |
| "new OCR" | v0 05090ec5 (12-17, a stray UI row) | none | 0 |
| Latin Translation (Neo-Latin) | v0 41b3b085, v1 afcb2396, **v2 b2e3deae** (02-16) | none | **10,709** under v2 (`batch_api`, 07-09 → 10-02). The batch lane still selects it. |
| German Translation (Early Modern) | v0 c88b5a4b, v1 f15def1b, v2 77b65bbc, v3 f15def1b. v3 is v1's text, re-seeded by #384. | none | 1,435 under v3 (06-17 → 09-16) |
| Arabic / Hebrew Translation | v1 989efcf0 / bf58e29b (04-12) | none | 0 |
| English Modernization | v1 d0e82fa7 (03-30), **v2** 45790074 (09-21) | v2 | Written into `translation`: v1 173,202, v2 19,856, code-era v0 12,622. No eval of v1 → v2. |
| Image Extraction | v1 f02e2427 (03-31), **v2** e7ec5d45 (04-13; adds `scan_quality`) | v2 | Not counted (it writes `detected_images`) |
| Standard Summary | v0 7d722994, **v1** a1fc709d | v1 | Not counted (book-level) |

None of these has an eval.

---

## Changing a prompt: the checklist this history argues for

1. Seed a **new row**. Never edit a row's `content` in place: the hash on every page that
   cites it would then be wrong. Give it the next unused number, and check that a code-only
   candidate is not already using that name.
2. Pre-register the A/B test before running it (`scripts/eval/PREREGISTRATION-*.md`), with
   k ≥ 2 and an A-vs-A arm. Reuse the existing runners: `scripts/eval/prompt-ab.mjs`,
   `ocr-v19-ab.mjs` and `translation-prompt-v14-ab.mjs`.
3. Promote with a committed script that has a `--demote` option
   (`ocr-prompt-v19-1-promote.mjs` is the model), and give the flip time in the PR.
4. Writers must stamp `prompt_id` and `prompt_hash` from the row they read, never from a
   constant.
5. Add the row to this doc and rerun `scripts/audit/prompt-history.mjs`.
