---
stage: translation
measure: judged_vs_reference
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics, chinese-buddhist, siku-quanshu]
n_books: 64
n_pages: 64
verdict: "The cheap cascade fails all three preregistered conditions: cascade − Flash −0.31 [−0.48, −0.17] fidelity, 12.5 vs 4.7 reversals per 100 pages, $0.00131 a page against a $0.00107 limit, with 53 % of pages routed. No cheaper arm matches Flash. DeepSeek scores 3.11, Qwen 2.95, Lite 3.56, Flash (3.8, via agy) 4.29."
status: rejected
decision: "Proposed: translate the 890K Siku pages with gemini-3.8-flash-low through agy ($0, CLI quota-bound); if bought, Flash Batch ≈ $1,600–1,700. No cheap-model cascade, no Lite."
superseded_by: null
issue: [7202, 5600, 5547, 5695]
---
## 2026-10-23 · Classical Chinese: does a cheap-model cascade (DeepSeek/Qwen + mechanical gates → Flash) match Flash at lower cost? (#7202)

**Who reads this:** Derek, deciding how to translate the ~890K Paddle-OCR'd, untranslated Siku Quanshu pages (#5600, #5547). The choice was between Flash on every page, Lite, and a cascade. **Answer: Flash on every page. The cascade loses a third of a point of fidelity and nearly triples the reversals. It also costs more than the limit, because its gates send half the pages to Flash and still miss a third of the bad ones.**

**Question.** Is a cheap model (DeepSeek or Qwen through OpenRouter) close enough to Flash once free mechanical checks send its failures to Flash? Is the cascade cheaper than 0.6× Flash Batch?

**Design** (preregistered on #7202 before any arm ran: [comment](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/7202#issuecomment-6359777441), commit `5d8860bc6`).
- **64 pages, one per book.**
  - **T5 (24):** the classical Chinese pages of #5695 T5 (`results/xlref-t5-2026-10/`). Each is judged against a published English reference (Legge, Giles and others; public domain), using the source text T5's arms translated.
  - **Siku (40):** seeded draw (seed 7202, mulberry32) from the #5600 Paddle cohort: 20 Kanripo-flagged pages (Dice < 0.6) and 20 clean ones. Seal-script titles excluded. A page was accepted only if it had Paddle OCR, at least 100 Han characters, no translation, and no hold other than the cohort's own. Each is judged against its source, with Kanripo's WYG text at the matched `pb` given to the judges as a second witness (`reference_kind: source_witness`, a new `JUDGE-PROMPT.md` paragraph). Flagged pages are oversampled 50 % against 6.55 % in the cohort, so routing and cost are reweighted to 6.55 %.
- **Arms.** All use prompt v13, single page, with the neighbours' OCR for page breaks and no previous-page English.
  - `lite` / `lite2`: `gemini-3.1-flash-lite`, Batch, thinking 0. Two separate jobs; this pair is Lite's noise floor.
  - `flash` / `flash2`: `gemini-3.8-flash-low` through **agy only** (`scripts/lib/agy-cli.mjs`, the call `cli-translate.mjs` makes, $0). This pair is Flash's noise floor. T5's Flash was `gemini-3-flash-preview` on the API; this is the model the CLI lane would run on the 890K.
  - `deepseek`: `deepseek/deepseek-v4-flash`, the cheapest DeepSeek chat model the chat endpoint serves (the `:batch` variant 404s).
  - `qwen`: `qwen/qwen3.7-flash`, the cheapest Qwen.
  - Both OpenRouter arms ran with reasoning off and v13 plus a "translate everything, leave no Chinese in the running text" rule (`gates.mjs` `RESIDUE_RULE`).
  - `cascade` = the better cheap arm (DeepSeek: 3.11 against Qwen's 2.95). Where it fails any gate, Flash's text replaces it. The gates:
    - residue: untranslated CJK > 2 %;
    - length: English/CJK ratio outside Flash's P5–P95 on the Siku pages, [6.76, 9.62];
    - negation: fewer than half as many English negations as source 不弗未毋勿非莫無;
    - Kanripo flag.

    The cascade's page scores are the judged scores of whichever text it routed to, from the same packet.
- **Judges.** The shared harness `translation-vs-reference/`: two blind Opus subagents, 24 chunks. **The gate passed for both judges** (wrong page 3/3, planted negation 3/3 caught and located, duplicate 3/3 tied). Agreement: exact 78 %, within one point 99.5 %, weighted κ 0.86 (n = 384 cells).

**Result: all 64 pages.** Page = the mean of the two judges; paired Δ against `flash`; bootstrap CIs, seed 7202.

| arm | fidelity [95 % CI] | Δ vs flash [CI] | reversals / 100 pages [CI] | omission | $ / Siku page | 890K pages |
|---|---|---|---|---|---|---|
| `flash` (3.8 low, agy) | **4.29 [4.14, 4.43]** | — | **4.7 [0.8, 10.2]** | 3 % | $0 on agy; $0.00192 at 3.8 Batch list | $0 (CLI) · $1,713 Batch · $1,584 at #7202's $0.00178 |
| `flash2` (A-vs-A) | 4.22 [4.06, 4.37] | −0.07 [−0.24, +0.09] | 4.7 | 3 % | | |
| `lite` | 3.56 [3.37, 3.74] | −0.73 [−0.92, −0.54] | 15.6 [7.8, 24.2] | 23 % | $0.00064 (Batch, measured) | $566 |
| `lite2` (A-vs-A) | 3.58 [3.39, 3.76] | −0.71 [−0.90, −0.52] | 17.2 | 24 % | $0.00063 | |
| `deepseek` | 3.11 [2.88, 3.34] | −1.18 [−1.44, −0.93] | 17.2 [8.6, 26.6] | 14 % | $0.00036 (OpenRouter charge) | $323 |
| `qwen` | 2.95 [2.77, 3.12] | −1.34 [−1.52, −1.16] | 25.8 [16.4, 36.7] | 29 % | $0.00014 | $124 |
| **`cascade`** (deepseek → flash) | 3.98 [3.79, 4.16] | **−0.31 [−0.48, −0.17]** | **12.5 [5.5, 20.3]** | 8 % | **$0.00131** (routed pages at Flash Batch) | $1,168 paid · or $323 + 474K agy calls |

- **Noise floors.** Lite − Lite2 is −0.02 [−0.16, +0.13]. Flash − Flash2 is +0.07 [−0.09, +0.24], with 16 wins, 32 ties and 16 losses. Every cheap arm's gap to Flash lies far outside both.
- **Rule** (as preregistered):

  | condition | needed | measured | met? |
  |---|---|---|---|
  | lower CI bound of (cascade − flash) | ≥ −0.15 | −0.48 | no |
  | reversals per 100 pages | ≤ Flash + 3 = 7.7 | 12.5 | no |
  | paid cost per page | ≤ 0.6 × $0.00178 = $0.00107 | $0.00131 | no |

  **Not adopted.** The fallback ("cheapest arm that matches Flash"): **none does**. Lite, DeepSeek and Qwen each miss both the fidelity bound and the reversal bound.
- **Routing.** 48 of 64 pages (75 %) went to Flash: all 20 flagged Siku pages and 10 of 20 clean ones. Reweighted to the cohort's 6.55 % flag share, **53.3 %** would be routed. Gate counts (a page can fail several): length 28, Kanripo 20, residue 19, negation 14.

**By stratum** (fidelity; Δ vs flash [CI]; reversals per 100).

| stratum | n | flash | lite | deepseek | qwen | cascade |
|---|---|---|---|---|---|---|
| T5 (reference) | 24 | 4.35; 10.4 | 3.73; −0.62 [−0.94, −0.29]; 20.8 | 3.19; −1.17; 27.1 | 2.94; −1.42; 35.4 | 4.04; −0.31 [−0.58, −0.08]; 18.8 |
| Siku, all | 40 | 4.25; 1.2 | 3.46; −0.79 [−1.04, −0.56]; 12.5 | 3.06; −1.19; 11.2 | 2.96; −1.29; 20.0 | 3.94; −0.31 [−0.51, −0.14]; 8.8 |
| Siku, Kanripo-flagged | 20 | 4.17; 0.0 | 3.42; −0.75 | 3.25; −0.93 | 2.95; −1.23 | = flash (all routed) |
| Siku, clean | 20 | 4.33; 2.5 | 3.50; −0.82 | 2.88; −1.45 [−1.88, −1.10] | 2.98; −1.35 | 3.70; −0.62 [−0.97, −0.30]; 17.5 |

The clean Siku stratum is 93 % of the 890K, and there the cascade loses 0.62 points. Pages where a judge called the reference cut wrong (8; mostly Kanripo witnesses at Dice < 0.1) change no ranking: on the 56 others, Flash 4.30, Lite 3.56, DeepSeek 3.08, Qwen 2.96.

**Why the cascade fails: the gates do not separate good DeepSeek pages from bad ones.**
- On the 16 pages that passed every gate, DeepSeek scored 3.03 and Flash 4.28. On the 48 pages that failed one, DeepSeek scored 3.14.
- Of the 38 pages DeepSeek scored ≤ 3, the gates caught 25.
- What they miss is wrong English of normal length with its negations in place: 起復 (recall during mourning) read as "resume office after mourning"; 非直斷 (not only cuts off) read as "does not cut off"; an envoy's reason inverted.
- DeepSeek's worst failures are of another kind: it writes modern Chinese or re-punctuates the source instead of translating, typed T2/T12 on 25 judge-cells. That is the 16 % residue of 2026-09-14, and the residue rule did not stop it (mean residue 20 %, 19/64 pages over 2 %).
- Qwen invents more often: unreadable_fill on 21 % of pages against Flash's 6 %, plus working notes printed as the translation. A moderation cut emptied its reply on one forensic page of 折獄龜鑑補, three times out of three.
- Even Flash's second run fails these gates on 6 of 20 clean Siku pages: a P5–P95 band rejects 10 % by construction. A gate tight enough to catch DeepSeek's wrong-but-fluent pages would route nearly everything.

**The five worst pages per arm** (fidelity, two-judge mean; one major defect each). Links: `https://sourcelibrary.org/book/<book_id>?page=N`, ids in `results/zh-cascade-7202/summary.json` → `worst`.
- **flash.** 3.0 萬姓統譜 p157 (name/office swapped across columns). 3.0 記纂淵海 p138 (each quote's credit put on the next block). 3.0 Liezi p53 (未必無獸心 inverted). 3.0 Shijing p24 (a complaint made a wish). 3.5 御定韻府拾遺 p32 (a rain entry garbled).
- **lite.** 2.0 萬姓統譜 p157 (interleaved columns read as names). 2.0 Zhuangzi p141 (piglets made "a child feeds on its dead mother"). 2.0 Liezi p53 (a definition omitted). 2.0 御定佩文韻府 p106 (headwords misaligned). 2.0 春秋或問 p29 (稱族 inverted, twice).
- **deepseek.** 1.0 ×5. 萬姓統譜 p157 (a character-by-character gloss list). 六藝之一錄 p119 (modern Chinese, not English). 大乘起信論義記 p65 (the source re-punctuated). 金剛經口訣 p83 (modern Chinese). 春秋或問 p29 (modern Chinese).
- **qwen.** 1.0 Zhuangzi p78 (invented dialogues). 1.0 折獄龜鑑補 p94 (empty after a moderation cut). 2.0 萬姓統譜 p157 (working notes printed). 2.0 御定韻府拾遺 p32 (fragments). 2.0 欽定詩經傳說彙纂 p17 (mistranslated ritual).
- **cascade.** 2.0 Liaozhai p129 (DeepSeek, gates passed: 市惠 misread). 2.5 御定孝經衍義 p168 (DeepSeek: 起復 inverted). 3.0 萬姓統譜 p157 (via Flash). 3.0 記纂淵海 p138 (DeepSeek: an envoy's reason inverted). 3.0 大乘起信論疏 p45 (DeepSeek: 非直 read as "not").

**Threats, with numbers.**
- **One judge family.** Both judges are Opus. The controls bound only wrong pages, planted negations and duplicates; there is no human calibration. This is a paired comparison at medium tier, which the decision card allows. An absolute claim ("Flash is 4.3") is not supported.
- **Source-grounded Siku.** These pages have no English reference. The judges read the Chinese with Kanripo's text as a check. On flagged pages the witness is often a different passage (`reference_fit: wrong` on 16 of 128 judge-pages).
- **Different Flash.** 3.8 Flash-low on agy is not T5's 3-flash-preview on the API. Its Lite gap here (−0.73) is larger than T5's (−0.40) on the T5 pages: −0.62 against −0.33 then.
- **n = 64 pages from 64 books,** 24 + 40, a single draw, not replicated. The effects are large (cascade −0.31, cheap arms −1.2 to −1.3) next to floors of about ±0.2.
- **Cost of routed pages.** $0.00178 (T5's Flash Batch) per the rule. The CLI would read them for $0, and then the cascade costs $0.00036 a page, but it still fails both quality conditions.

*Measure:* judged against a human reference (T5) and source-grounded with a second witness (Siku); two blind Opus judges; fidelity is not "accuracy" (eval-design §2). *Grade:* directional for classical Chinese (64 books). *Replicated?* No. The cheap arms' failure modes replicate 2026-09-14: DeepSeek's untranslated residue and Qwen's inventions.

*Cost:* **$0.121 paid.** Lite Batch $0.0857 (2 jobs, 128 pages; `gemini_usage` endpoint `eval/zh-cascade-7202`, registered `external_eval` and closed). OpenRouter $0.0357 (DeepSeek $0.0261, Qwen $0.0096, as OpenRouter reported). Flash: 128 agy calls on the subscription. Judges: 24 Opus subagents on the subscription. No writes to `pages` or `books`.

*Ran:* 2026-10-23. agy was quota-locked on the shared account from before the job until 21:59 UTC, so the Flash arms ran after the reset and judging after that.

*run_id:* `zh-cascade-7202`.

*Artifacts:* `results/zh-cascade-7202/`:
- `summary.json`: every number above, the rule, the worst pages;
- `results.json`: the harness score;
- `gates.json`: per-page measures, the band, gates failed;
- `sample.json`: the draw and its rejections;
- `arms/*.jsonl`: every output, with its cost;
- `records-arms.jsonl.gz`: the judge input;
- `ledger.jsonl`;
- `packet/`: key, manifest and verdicts. The judge files rebuild from the records with seed 7202.

*Scripts:* `scripts/eval/zh-cascade-7202/` (`build-sample.mjs`, `gates.mjs`, `run-openrouter.mjs`, `run-agy.mjs`, `assemble.mjs`, `analyze.mjs`). Lite ran through `pareto-6182/run-arms.mjs --work`. Judged on `translation-vs-reference/`.
