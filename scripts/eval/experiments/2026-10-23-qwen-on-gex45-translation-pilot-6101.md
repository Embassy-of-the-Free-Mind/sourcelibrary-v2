---
stage: translation
measure: [judged, none]
languages: [lzh, ja]
scripts: [Hani, Jpan]
canons: []
n_books: 10
n_pages: 10
verdict: "A local Qwen on the GEX45 does not translate Chinese/Japanese print as well as the stored gemini-3-flash: in the gated 10-page pilot Qwen3.6-27B (4-bit) made 3.9 accuracy errors per page against Flash's 1.6 (paired Δ +2.3 [1.0, 3.9]) and was preferred on 25 % of pages, so the preregistered STOP rule fired. Qwen3-14B also fails the judge-free bar (6/57 pages capped, errored or untranslated), and Qwen3-32B-AWQ does not serve on the 24 GB card."
status: rejected
decision: "Chinese/Japanese print translation stays on Gemini (Flash via agy/Batch); no Qwen translation lane (#6101)"
superseded_by: null
issue: [6101]
---
<!-- PRIOR ART: 2026-09-14-which-model-should-translate-classical-chinese-preview-pages-six.md (hosted qwen3.8-flash came last of six on 60 Classical-Chinese pages; judge test-retest 52 %), 2026-10-04-translation-student-latin-lora-5793.md (Qwen3-8B LoRA student reversed meaning on 27 % of Latin pages), 2026-10-18-gex45-capability-card-6871.md (rates on this card, nothing above 14B), 2026-10-18-local-seam-screener-6742.md (Qwen3-14B-AWQ as a screener, κ 0.17). None had a local open model translate on the owned GPU. -->
## 2026-10-23 · Could a Qwen model on our own GPU translate the Chinese/Japanese print pages instead of Gemini Flash? (#6101)

- **Why.** The Paddle print lane (#6101, PR #7184) will give ~300K Chinese/Japanese pages new OCR text, and every one of them will need English. Today Chinese translation routes to `gemini-3-flash-preview`, through Batch or through agy, which costs $0 but is bound by quota. A model on the flat-rate GEX45 ($8.18/day whether it runs or not) would have no per-page cost and no quota. Derek asked on 2026-10-23: "then to translate, qwen or something?"
- **Preregistration.** `scripts/eval/PREREGISTRATION-qwen-translate-6101.md`, commit 402fc8dd7, written before any Qwen output existed.
  - **Amendment 1** (commit f7e58b2c9, written before any judge call) came from a steer by Derek's session through the job inbox. It adds a gated 10-page pilot that is judged first, with a STOP rule.

### Design
- **Pages.** The seeded draw (`qwen-translate-6101/draw.mjs`, seed 6101) produced 57 pages, one per book:
  - 40 woodblock pages from the #6101 frame. Their stored translation is gemini-3-flash-preview, prompt v13, made from the stored CBETA text.
  - 17 Japanese print pages. These are all the qualifying pages that carry a stored Flash translation: only 38 Japanese books carry one at all, so the brief's 20 could not be reached.
  - **The pilot** is a seeded 10 of the 57: 7 zh and 3 ja.
- **Same input for every arm.** Every arm got the exact prompt the stored translation was made with:
  - the prompt was looked up by `translation.prompt_id` and built with the production builder (`PAGE_BREAK_SCOPED`);
  - the source was the same stored text;
  - the continuity context was the same stored previous-page translation.

  So the arms test translation only. The zh source is CBETA, not a Paddle read. That is the text A was translated from.
- **Arms.**
  - **A**: the stored Flash translation. No new Gemini call was made.
  - **Q2**: Qwen3-14B-AWQ.
  - **Q1**: Qwen3-32B-AWQ.
  - **Q3**: Qwen3.6-27B, community 4-bit AWQ (`Alennnndy/Qwen3.6-27B-AWQ-4bit`). This is the newest dense Qwen that fits the card. Its hybrid linear attention keeps the KV cache small.
  - All Qwen arms ran on vLLM 0.31 with thinking off, at Qwen's published non-thinking sampling (T 0.7, top-p 0.8, top-k 20), with a 12,288-token context and 16 concurrent requests.
  - Each arm also translated the 40 zh pages from the Paddle P1s text, ×3 seeds. That run doubles as the throughput pass.
- **Judge.** Blind Opus (`claude -p`, subscription), using the #6545 rubric without the reference (`qwen-translate-6101/JUDGE-PROMPT.md`). The judge was given the source text and the page image.
  - It scored, per candidate: fidelity 1–5, accuracy and style spans, T-class defects, inventions and reversals, plus a ranking.
  - Every page was judged twice (J1 and J2), each time with fresh label shuffles, in separate calls.
- **Pilot STOP rule.** Stop if any of these holds:
  - Q3 is preferred over A on less than 35 % of pages;
  - Q3 has a reversal on at least 3 more pages than A;
  - Q3 has more than 2× A's accuracy spans per page, and at least 1.0 more.

### Result — the pilot (10 pages, A vs Q3, J1 + J2 averaged)

| | accuracy spans / page | major / page | fidelity (1–5) | pages with a reversal | pages with invented fill | preferred over the other |
|---|---|---|---|---|---|---|
| **A**: stored gemini-3-flash | **1.6** | **0.1** | **4.2** | 0 | 0 | 85 % ranked top |
| **Q3**: Qwen3.6-27B 4-bit | 3.9 | 1.2 | 3.25 | 2 | 2 | **25 %** [5, 45] vs A |
| Q3 − A, paired | **+2.3 [1.0, 3.9]** | | | | | J1 2-2-6, J2 1-2-7 (W-T-L) |

- **The STOP rule fired on two of its three clauses.** Pairwise was 25 % against the 35 % threshold. Errors were 2.4× A's and +2.3 per page.
  - Q3 had a reversal on 2 pages and A on none, so the reversal clause (≥ 3 more pages) did not fire.
  - Round 1 (all 57 pages, all arms) was therefore not judged, as the amendment requires.
- **By stratum:**
  - **zh (n = 7)** is closer. Pairwise is 36 % and errors are 3.1 vs 1.4 per page (Δ CI [0.6, 2.7]), which still fires the error clause.
  - **ja (n = 3)** is lost outright: 0 of 3 pages preferred, in both passes, with 3.3 major errors per page.
- **The judge was reliable this time, unlike the 2026-09-14 A/B's 52 %.**
  - α on fidelity between J1 and J2 = 0.93.
  - α on accuracy-span counts = 0.87.
  - The A-vs-Q3 outcome was the same in both passes on 7/10 pages.
- **I checked the judge's claims against the texts myself.**
  - e24f00-p53: Q3 turns 竊比石門老 ("I presume to compare myself to the old man of Shimen") into the denial "How can I compare myself…". It also renders 南泉 as "Nanyuan".
  - be006b-p110: Q3 adds `<note>Image description from OCR: A woodcut depicts a pelican feeding her young … a symbol of self-sacrifice in alchemical tradition</note>` to a Chan sermon. That sentence is **the house prompt's own worked example** for `<image-desc>`, copied into the page.
  - ja-b790a0-p10 (a table of contents): Q3 lists another work's chapters, then loops and is truncated.
  - The judge's classes for Q3 across both passes: 23 `name`, 16 `mistranslation`, 6 T10, 4 T9, 3 T8, 2 T1, 2 T5. For A: 8 `name`, 12 `mistranslation`, 4 T9, 3 `terminology`, and no T8 or T10.

### Result — judge-free census (all 57 pages; Paddle-source ×3)
`qwen-translate-6101/mech.mjs`. "Failed" uses the preregistered list: cap hit, error, more than 20 % CJK left in the English, or chatter. The production write guard (`assessTranslationHealth`) is shown beside it.

| arm | stored source: failed / 57 | guard refusals | prompt example copied | Paddle source: failed / 120 | prompt example copied |
|---|---|---|---|---|---|
| A (stored Flash) | 0 | 1 runaway | 0 | — | — |
| Q2 Qwen3-14B-AWQ | **6** (3 cap loops, 2 untranslated, 1 over context) | 2 runaway, 1 echo | 0 | **11** (7 cap, 4 untranslated) | 0 |
| Q3 Qwen3.6-27B | 3 (1 cap, 1 untranslated, 1 over context) | 2 runaway, 1 echo | 1 | 0 | **5** |
| Q1 Qwen3-32B-AWQ | did not serve | | | | |

- **Q2 fails bar 3 (≤ 5 %) without a judge.** It failed 6/57 = 10.5 % on clean text and 11/120 on Paddle text. Its loops are of the kind "It is the only thing that is not bound…", or `<unclear>…</unclear>` repeated to the 6,144-token cap.
- **Q1 (Qwen3-32B-AWQ) does not serve on the 24 GB card.** Its 19.3 GB of weights leave cuBLAS no room at util 0.92 (`CUBLAS_STATUS_ALLOC_FAILED`), with fp8 KV as well.
  - A ladder of settings (util 0.95, 2K prefill chunks, eager, 8K context) was queued, then withdrawn once the pilot stopped.
  - Even at its best it would hold about one 12K sequence of KV, slower than Q3.
- **One Japanese page has a 15,801-token prompt**, so it exceeds the 12K context of every local arm. Flash's context window takes it. On this card, a 24 GB model plus long-page context is a structural limit.

### Throughput (the 120-request Paddle-source pass, 16 concurrent, 70 W cap, power-bound)

| arm | output tok/s | pages/h | peak VRAM | GPU-days for 300K pages | box cost at $8.18/day |
|---|---|---|---|---|---|
| Qwen3-14B-AWQ | 245 | 803 | 21.2 GB | **15.6** | $128 |
| Qwen3.6-27B 4-bit | 75 | 293 | 21.5 GB | **42.7** | $349 |

Every one of these GPU-days would be taken from the Paddle print lane and the Latin OCR queue (#6871), which run on the same card.

### Verdict and recommendation
- **Stay on Gemini for Chinese/Japanese print translation.** On the pilot pages, the best local model makes about 2× Flash's meaning errors. It also inverts sense, and it copies the house prompt's example into a page.
- **A hybrid (Qwen draft, Flash fix of flagged pages) does not pay.**
  - At 2–4 accuracy errors per page, nearly every page would need the fix, and no cheap flag finds the errors. The reversals and wrong names are fluent English.
  - The 14B's loops are catchable: the production guard refuses them as `runaway`. But a caught loop is still a page Flash must translate.
- **The GEX45 is worth more doing OCR.** Paddle reads ~3,300 pages/h on the card (#7184), against Qwen's 293 translated pages/h.
- **What would reopen this:**
  - a bigger card (48 GB+, so a 32B at 8-bit or a 70B at 4-bit);
  - an open model that beats hosted qwen3.8-flash on the 2026-09-14 pages.

  The judge and the harness here can be reused: `packets.mjs --pilot` and `score.mjs --round=pilot`.

### Threats and limits
- **n = 10 pages in the pilot**, 7 of them zh. The STOP rule judged the pooled result; zh alone was closer, though it still fired the error clause. A 57-page round could narrow the zh gap, but would be unlikely to close a +1.7 errors/page difference whose CI excludes 0.
- **A is a stored translation from 2026-10-06, and A has no replicate**, so the Flash-vs-Flash noise floor is unknown. The judge's own stability (α 0.93) is not the arm's stability.
- **One Japanese image was the whole spread.** The set was drawn with a hand-rolled image pick. CI's page-image-pick check later moved `draw.mjs` to `getPageSource`. Of the 17 ja pages, only ja-3b194c-p83 (a split spread) differs. It is not in the pilot, so no judged item changed.
- **The judge is a Claude model.** It may prefer Gemini's English style, but the deciding measure is counted accuracy spans with quotes, and the spot-checks above confirm them.
- **4-bit community quant of Qwen3.6-27B, thinking off.** Thinking on would cost ~5× the output tokens (#6742: 1,395 vs 232 tokens per item) on a card that already manages only 293 pages/h.
- **The prompt is Gemini's production prompt, unchanged.** A prompt tuned for Qwen, for example one without the pelican example, might remove one failure mode. It would not remove the reversals or the name errors.

**Artifacts.**
- In git:
  - `scripts/eval/qwen-translate-6101/`: draw, client, GPU tasks, packets, judge prompt and driver, score, mech, `pilot-ids.json`.
  - `scripts/eval/results/qwen-translate-6101/`: `report-rpilot.json`, `mech.json`, the pilot judge lines and key, `gpu.log`.
- Not in git: the set, with its CBETA source text (CC BY-NC-SA), and the raw Qwen outputs. They are kept in `/mnt/HC_Volume_105839809/jobs/qwen-translate-eval-6101/` on Hetzner and in `/root/jobs/qwen-translate-6101/` on gex45.
- Spend: $0. The GPU is flat-rate, and the judge ran on the Claude subscription (8 Opus calls).
