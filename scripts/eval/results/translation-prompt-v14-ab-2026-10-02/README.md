# Translation prompt v14 candidate vs live v13, plus a Tibetan multi-leaf stratum (#5305, #4523)

Run 2026-10-02 by Hetzner job v14-ab-2. Pre-registration: `../../PREREGISTRATION-translation-prompt-v14.md`
(committed before the draw; amendments 1–2 are dated). Harness: `../../translation-prompt-v14-ab.mjs`.
**Nothing was written to `pages` or `prompts`. Nothing was flipped.** The flip is Derek's call.

## What ran

- **Arms:** v13a (live default) · v13b (v13 again, the A-vs-A noise floor) · v14 (v13 + #5305 items 1, 1b, 3–7 and the
  #5137 misread line; on Tibetan books also leaf lines a–c) · v14ns (Tibetan only: v14 with no continuity seed).
  The exact edits are `V14_EDITS` / `TIBETAN_LINES` in the harness and quoted in the pre-registration.
- **Door:** the chained Batch lane's (`buildTranslationPrompt` / `buildBlockTranslationPrompt`, stored previous-page
  translation as seed, adjacent OCR, `PAGE_BREAK_SCOPED`), `thinkingBudget 0`, `maxOutputTokensFor`, BLOCK_NONE.
- **Units:** 107 pages (one per book) on **gemini-3.1-flash-lite**: 45 audit-flagged, 12 Sanskrit, 25 chained-lane
  page breaks (sent as N + N+1 blocks), 25 clean controls. 21 Tibetan units on **gemini-3-flash-preview**: 16 page
  groups read by eye on #4523 (32 pages, 78 leaves) and 5 dropped-leaf pages (11 leaves).
- **Spend:** 405 Batch requests, **$0.667** (estimate $1.05; `batch.json`). Metered in `gemini_usage` as
  `eval/translation-prompt-v14-ab`.
- **Judging:** #5305 strata — 24 blind Opus subagent packets (`JUDGE-PROMPT-v14ab.md` = the audit rubric + the
  neighbour-page/kind addendum), 337 items incl. 16 repeats. Tibetan — read by the job, blind to arm (letters W–Z per
  unit, `tibetan-read/`), tallies written to `tibetan-reading.json` before `tibetan-key.json` was opened.

## Result — #5305 strata (Flash-Lite, n = 107 pages)

| | v13a | v13b (noise) | v14 | v14 vs v13a (discordant, McNemar) | noise (v13b vs v13a) |
|---|---|---|---|---|---|
| **Invention flag (P)** | 47.7% | 42.1% | **38.3%** | 13 vs 23, p 0.13 | 16 vs 22, p 0.42 |
| Invention, excl. summary/meta | 39.3% | 33.6% | 31.8% | 13 vs 21, p 0.23 | 14 vs 20 |
| Major invention | 12.1% | 11.2% | 8.4% | | |
| **Page-boundary invention (pages)** | 20 | 17 | **8** | **4 vs 16, p 0.012** | 7 vs 10, p 0.63 |
| Wrong added fact (pages) | 17 | 13 | 14 | 7 vs 10 | 11 vs 15 |
| Unreadable fill (pages) | 26 | 23 | 24 | 4 vs 6 | 6 vs 9 |
| Summary/meta asserting absent content (pages) | 13 | 18 | 11 | 7 vs 9 | 14 vs 9 |
| **Payload inside `<meta>continues from previous page…`** | 32 | 31 | **0** | 0 vs 32, p < 1e-9 | |
| Omission (G1) | 15.9% | 15.9% | 14.0% | 5 vs 7 | 6 vs 6 |
| Fidelity ≥ 4 (G2) | 61.7% | 72.9% | 75.7% | | |
| Apparatus omissions (G4) | 6 | 8 | 8 | | |
| Unmarked open end (`openEnd`) | 15.9% | 15.0% | 14.0% | 2 vs 4 | |
| Square brackets in the body | 19.6% | 19.6% | 22.4% | | |

Per stratum (invention / omission): flagged 71 / 56 / **53** % · 11 / 11 / 7 %; Sanskrit 33 / 58 / 33 · 50 / 42 / 58;
**page breaks 36 / 28 / 16** (5 vs 0 discordant, p 0.063) · 4 / 8 / 8; **control 24 / 24 / 36** · 20 / 20 / 12.
Judge repeats (16 pairs): invention flag agrees 13/16, fidelity 11/16, omission 14/16.

**Verdict under the pre-registered rule: no measurable effect on judged invention, plus a control-guard breach.**
- P: v14 is 9.4 pp below v13a, more than the 5.6 pp noise floor, but p = 0.13 misses the pre-registered 0.10.
- G3 fails: control invention 24 → 36 % (+12 pp > 8 pp). All six control pages flagged only under v14 are *minor*:
  three supply a verb from the next page, one summary, one doubtful note, one unreadable fill. Read in
  `../../translation-prompt-v14-ab.mjs --score` output and `verdicts/`.
- G1, G2, G4 hold.
- **Separately supportable (mechanical/kind secondaries, p < 0.05, guards holding):** the bare continuity marker
  (edit 1b) removes the meta payload (32 → 0 pages), and page-boundary invention falls 20 → 8 pages (p 0.012). The
  two cannot be separated: much of the page-boundary class *was* text in that meta.
- **No detectable effect:** item 5 (wrong added facts 17 → 14, inside noise), item 6 (Sanskrit: only 3 of 12 pages
  carry an English half; one `english-condensed` omission in v13a, none elsewhere), item 7's bracket line (19.6 →
  22.4 %), unmarked open ends.
- The five worst v14 pages by fidelity (all audit-flagged garble: Dunhuang Vinaya, two Hebrew, Korean Yijing, Latin
  *De mineralibus*) score the same under v13a: garbled OCR rendered fluently, which no prompt line here touches
  (#5305 item 2 / PR #5638's gate).

## Result — Tibetan stratum (Flash, read by eye against the #4523 answer key)

| Class (counts over the 16 groups) | v13a | v13b (noise) | v14 | v14ns |
|---|---|---|---|---|
| 1 seam duplication | 1 | 2 | 2 | 0 |
| 2 borrowed / displaced clause | 1 | 3 | 0 | 1 |
| 3 split word mistranslated | 1 | 1 | 0 | 1 |
| 4 word dropped at a seam | 0 | 1 | 1 | 1 |
| **Seam total (1–4)** | **3** | **7** | **3** | **3** |
| 5 invented / mis-normalised proper noun | 2 | 2 | 2 | 2 |
| doubtful note ("Sanskrit mantra" on titles) | 1 | 2 | 0 | 0 |
| payload in continuity `<meta>` | 0 | 2 | 0 | 0 |
| 6 empty / short leaf (mechanical) | 0 | 0 | 0 | 0 |
| 7 guard: #4523 meaning errors still present (of 6 sites) | 2 | 2 | 1 | 2 |
| **Dropped-leaf pages: leaf content dropped** (5 pages) | **1** | **1** | **0** | **0** |
| Dropped-leaf pages: `<leaf-break/>` lost (write gate would refuse) | 0 | 0 | 0 | 1 |

Verdict under the rule: **neither the Tibetan lines nor the no-seed arm is supported by the seam count**: v14 = v14ns =
v13a = 3, while two draws of the *same* v13 prompt differ by 4. The A-vs-A arm is the most informative number here:
seam defects at this size are mostly sampler noise. What did differ:
- **rNying ma rgyud 'bum Nga p.41** (https://sourcelibrary.org/book/69e786b04a6785cfd60c8d27?page=41), one of the five
  dropped-leaf pages: the stored p.40 translation (the seed) already contains p.41's leaf 0. **Both v13 draws drop leaf
  0** and put the opening of leaf 1 in its slot (v13a: "…is the twelfth chapter. By such certainty of determination,
  meditation and non-meditation are liberated…", which is leaf 1's ཡིན། །དེ་ལྟར་ཐག་ཆོད་ངེས་པ་ཡིས། །སྒོམ་དང་མ་སྒོམ་རང་སར་གྲོལ).
  **v14 and v14ns translate leaf 0** ("…is. Know that there is no connection between that support and the
  object…" = ཡིན་ཏེ། །དེ་རྟེན་ཡུལ་དང་འབྲེལ་མེད་ཤེས). This is the production dropped-leaf mechanism, reproduced
  by v13 and gone under v14 even *with* the seed: the defect is a seed that carries the page, and v14's "the previous
  page's translation is given for names and terms only" line is what changed.
- **rNying ma rgyud 'bum Ja p.9–10** (https://sourcelibrary.org/book/69e786b34a6785cfd60c92c4?page=9): the split word
  རྡོ་ | རྗེ་ཅན ("with a vajra"). v13a "formed— / possessing the Lord", v13b "like a stone / the noble one"; v14
  `<unclear>rdo</unclear>` / `<term>rje can</term> <note>fragment of a name, likely Garab Dorje</note>`, as line (b)
  asks. But v14ns, the *same prompt* here (this group has no seed), wrote "a stone… / possessed of vajra": line (b)
  works on one draw of two.
- Line (c) did not stop name normalisation: v14 wrote "Upananda" for ཉེ་སྡེ (Upasena) on mDo sde Ha p.102, and
  v13a "Vajrapani" for བཛྲ་པུ་ནེ་ཏེ on rDzogs chen p.8, where v13b/v14ns also normalised.
- The #4523 meaning errors are not prompt-sensitive: ལུས་མི་གདའ་བར (rGyud 'bum Pha p.49) is wrong in all four arms;
  the 'Dul ba Ga p.68 speaker swap recurs in three of four; the equality-wisdom and reversed-relation sites are right
  in all four.

## Not in this run (and why)

- #5305 item 2 (illegible trigger): job illegible-gate (PR #5638), whose clause had no detectable effect.
- #4741 per-book glossary: no curated per-book glossary exists for the #4523 books; deferred.
- #5055 truncation, #5606 model choice: not prompt questions. Generation settings are recorded per arm (#4613).
- The Tibetan units are 1–3-page blocks; production blocks are up to 8 pages.

## Files

`sample.jsonl` (units, pinned) · `arms.json` (arm texts + hashes) · `batch.json` (jobs, cost, generation settings) ·
`outputs.jsonl` (every response) · `packets/` + `packet-key.json` · `verdicts/` (Opus) · `JUDGE-PROMPT-v14ab.md` ·
`tibetan-read/` + `tibetan-key.json` + `tibetan-reading.json` (the blind read) · `report.json` (`--score`).
