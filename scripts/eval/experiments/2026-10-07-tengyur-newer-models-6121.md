---
stage: translation
measure: [judged_vs_reference, judged]
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: null
n_pages: 58
verdict: "gemini-3.8-flash (+0.39) and Opus (+0.64) beat the stored Tengyur English on 58 reference sides and pass the rule on both texts; gemini-3.5-flash does not (-0.01)."
status: undecided
decision: "Re-translating Pramana + Madhyamaka with G38 is pending Derek; the CLI run's apply gate stopped it, nothing written (#6361)"
superseded_by: null
issue: [6121, 6182, 6361]
---
## 2026-10-07 · Tengyur weak sections, round 2: do newer models (Gemini 3.8 / 3.5 Flash, Opus) fix them? (#6121)
<!-- PRIOR ART: 2026-10-07-tengyur-weak-section-levers-6121.md (round 1: same sample, same aligned references, same harness; context and Pro tested, no lever adopted, reviewer gate failed). Round 2 reuses all of it and changes only the arms. -->

**Question.** The Tengyur draft was made with `gemini-3-flash-preview`. Our key now lists `gemini-3.5-flash` and `gemini-3.8-flash`, and neither had been tried on Tibetan. Opus had only been tried on 84000's easier texts (#5713). On the weak sections, does any of them beat the stored English by more than a rerun of production does? And what would a re-translation cost?

**Answer.** **Yes, two of the three: `gemini-3.8-flash` (G38) and Opus (O) pass the preregistered rule on both texts that have a published reference.**
- **The rule on the reference texts:**
  - **G38:** Pramāṇa, Dharmottara D4231 against Stcherbatsky: fidelity +0.48 [+0.29, +0.68], p < 0.001, inversions 5 → 1. Madhyamaka, Candrakīrti D3862 against La Vallée Poussin: +0.30 [+0.12, +0.50], p = 0.005, inversions 8 → 2.
  - **O:** +0.79 and +0.50 on the same two texts, inversions 5 → 2 and 8 → 0.
  - **`gemini-3.5-flash` (G35) does not pass:** −0.01 pooled. It is the same as the stored English at about 2.3 times the cost.
- **The reviewers point the same way.** This round their gate passed: A 11/12 and B 10/12 on fresh plants, at the first attempt. Pooled over 60 random pages, reversal + agent findings per 100 pages: S 85, A 80, G35 58, G38 42, O 30.
- **Cost per 1,000 pages, Batch** (realtime is twice that):
  - G38: **$2.21**, against $1.74 for the production model;
  - G35: $5.07;
  - O at API list price: **$19.1**.
- **What a re-translation would cost with G38:** about $28 for Pramāṇa (12,784 pp), $52 for Pramāṇa + Madhyamaka, and $81 for all four sections (36,812 pp). The same with O at list price: $244, $451 and $703.

These are AI judges and reviewers (Opus), with a by-eye check by Claude. They are not a human review. O is the same model family as every judge (see Threats). G38 is not, and its result does not depend on that.

**Design** (preregistered at `1e92837cd` (first pushed as `33c2558fa`, re-signed for DCO), `scripts/eval/tengyur-levers/PREREG-R2.md`, before any round-2 arm output on the sample or the reference sides).
- **Reused from round 1, not redrawn:**
  - the 60-page sample (30 Pramāṇa, 10 each of Madhyamaka, Vinaya and Jātaka);
  - the 58 sides aligned to the published translations (28 of D4231, 30 of D3862);
  - the stored English (S) and round 1's production rerun (A, the A-vs-A floor);
  - the packet builders, the judge and reviewer prompts, and the analysis scripts (each given a round-2 switch).
- **New arms:**
  - **G38 and G35:** the production request unchanged (v13, `buildTranslationPrompt` + `PAGE_BREAK_SCOPED`, one page, no context, thinking budget 0, temperature 1.0, realtime).
    - Probe: 2 off-sample pages per model, then all 118 pages. Every call billed **0 thinking tokens** and finished `STOP`, in the house tag format.
  - **O:** Claude Opus as subagents on the subscription, at most 6 at a time.
    - Its instructions were the exact production prompt string for the page, one page, no context. It was not allowed other files, tools or extra instructions.
    - 12 runs of 10 pages.
- **Primary measure: fidelity against the published references.**
  - Two blind Opus judges scored all five arms of each side together, in random order (S and A were re-judged in this round). The prompt was round 1's `JUDGE-PROMPT-REF.md`, changed only to allow five candidates (`JUDGE-PROMPT-REF-R2.md`). 20 judge runs.
  - Controls: 6 planted reversals and 4 duplicates.
  - **Rule**, per text and pooled. An arm is worth a priced re-translation only if all three hold:
    - fid(X) − fid(S) > |fid(A) − fid(S)|;
    - a one-sided paired sign-flip p < 0.10;
    - total inversions(X) ≤ inversions(S).
- **Secondary measure: round 1's reviewers.** 300 items (60 pages × 5 arms) plus 20 fresh plants, two blind reviewer partitions, 64 runs.
  - The two planter defects behind round 1's gate failure were filtered: no-op flips, and "the opponent → we", which produced "we argues".
  - Gate: each reviewer finds at least 10 of the 12 reversal/agent plants, with up to two re-plants.

**Result 1 (primary): against the published translations** (`refjudge/scores.json`).
- **Judge gate passed:** plants 6/6 and 6/6, duplicates tied 4/4 and 4/4. The two judges were within one fidelity point on every side × arm.

| 58 sides | S | A | G35 | G38 | O |
|---|---|---|---|---|---|
| fidelity (1–5), mean of judges | 4.27 | 4.27 | 4.26 | **4.66** | **4.91** |
| … vs S [95 % CI] | — | 0.00 [−0.10, +0.11] | −0.01 [−0.13, +0.13] | **+0.39** [+0.25, +0.53] | **+0.64** [+0.49, +0.78] |
| sides better / worse than S | — | 8 / 11 | 11 / 14 | 29 / 3 | 42 / 1 |
| inversions (both judges summed) | 13 | 11 | 12 | 3 | 2 |
| omission sides, either judge | 13 | 13 | 10 | 2 | 0 |
| span off, either judge | 4 | 3 | 3 | 3 | 0 |

| rule | D4231 Pramāṇa (28) | D3862 Madhyamaka (30) | pool (58) |
|---|---|---|---|
| floor \|A − S\| | 0.07 | 0.07 | 0.00 |
| **G38** | +0.48, p < 0.001, inv 1 ≤ 5 → **passes** | +0.30, p = 0.005, inv 2 ≤ 8 → **passes** | +0.39, p < 0.001 → passes |
| G35 | +0.09, p = 0.24, inv 7 > 5 → no | −0.10, p = 0.90 → no | −0.01 → no |
| **O** | +0.79, p < 0.001, inv 2 ≤ 5 → **passes** | +0.50, p < 0.001, inv 0 ≤ 8 → **passes** | +0.64, p < 0.001 → passes |

- **O against G38, head to head:** +0.25 [+0.13, +0.37], with O better on 21 sides and worse on 3. On D4231 it is +0.30, and on D3862 +0.20.
- **G38 against G35:** +0.40 [+0.24, +0.54]. The newer and cheaper Flash is the better one.
- **The scale is relative.** S scores 4.27 here and scored 4.41 in round 1. The same text reads lower beside stronger candidates. Compare arms within a round, never across rounds.

**Result 2 (secondary): the reviewers on 60 random pages** (`r1/analysis.json`).
- **Gate passed at the first attempt:** reviewer A found 11 of 12 reversal/agent plants and reviewer B 10 of 12. Each caught 3 of 4 term plants. All 4 span plants were marked. No re-plant was needed.
- Reversal + agent findings per 100 pages, union of the two reviewers [95 % CI]:

| | S | A | G35 | G38 | O |
|---|---|---|---|---|---|
| **pool (60)** | 85 [62–110] | 80 | 58 [42–78] | **42** [27–57] | **30** [18–43] |
| Pramāṇa (30) | 87 | 77 | 60 | 43 | 33 |
| Madhyamaka (10) | 50 | 60 | 30 | 30 | 30 |
| Vinaya (10) | 120 | 90 | 70 | 30 | 20 |
| Jātaka (10) | 80 | 100 | 70 | 60 | 30 |
| all findings, pool | 308 | 305 | 240 | 163 | 85 |
| mean score / "light edits" share | 3.56 / 53 % | 3.51 / 50 % | 3.68 / 59 % | 4.04 / 80 % | 4.44 / 98 % |

- **Round 1's reviewer rule** (floor |A − S| = 5 pooled):
  - Pooled, all three arms pass: G38 p = 0.0003, O p = 0.0001, G35 p = 0.017.
  - Pramāṇa: all three pass.
  - Vinaya: G38 and O pass.
  - Jātaka: only O passes.
  - Madhyamaka: none passes (n = 10, p ≥ 0.31).
  - Sections at n = 10 are exploratory.
- **G35 passes with the reviewers but not against the references.** The references are the primary measure, so G35 is not worth a re-translation.

**Result 3: by eye, 20 findings read against the Tibetan** (`r1/byeye.tsv`). Seeded draw, 5 per arm (S, G38, G35, O), one per page.

| | confirmed | debatable | rejected | precision (debatable = ½) |
|---|---|---|---|---|
| S | 3 | 2 | 0 | 0.8 |
| G38 | 2 | 3 | 0 | 0.7 |
| G35 | 4 | 1 | 0 | 0.9 |
| O | 4 | 1 | 0 | 0.9 |
| **all** | **13** | **7** | **0** | |

- **Weighting by precision leaves the order unchanged:** S 68, G35 53, G38 29, O 27 per 100.
- **Errors still left in G38 and O:**
  - (O) an honorific ignored: ཞེན་པ་མངའ་བའི་རྒྱུ, the Buddha's apparent clinging, becomes "the cause of those who cling";
  - (O) a negation dropped across an e-text line break: མ་|བསྐལ་བ, "non-remoteness", becomes "Remoteness";
  - (G38) "makes the Primary Matrix … hollow", a verb the verse does not have;
  - (G38) the subjects (སྐྱེ་རྒུ) dropped as agents.
- **G35's confirmed errors include a reversed quantifier and a refuted view asserted.**
  - ཇི་ལྟར་ཡང་ ("in some way") becomes "in no way existent".
  - སྐྱོན་ནི་ཆེན་པོ ("a great fault") is dropped, so the English asserts that noble birth prevents insignificance.

**Cost** (billed tokens; `arms/ledger.jsonl`, `opus-cost.json`).
- **Gemini, per 1,000 pages** (thinking 0 on every call):

| model | realtime | Batch |
|---|---|---|
| gemini-3-flash-preview (A, round 1) | $3.47 | $1.74 |
| G38 `gemini-3.8-flash` | $4.42 | $2.21 |
| G35 `gemini-3.5-flash` | $10.14 | $5.07 |

- **O at API list price** (claude-opus-5-5, $4 in and $20 out per million tokens).
  - Measured on 3 pages: 4,900 input and 926 output tokens a page, so **$38.1 realtime and $19.1 Batch** per 1,000 pages, without thinking.
  - Prompt caching of the shared ~3.9K-token instruction block would bring the realtime figure to about $24.
- **O on the subscription:** the 118 pages took 12 subagent runs and 1.02M subagent tokens (8.6K a page), about 7 minutes at 6 concurrent.
  - A full four-section run would be about 3,700 runs and 320M tokens, roughly 36 hours at 6 concurrent before any usage limit.
  - That is not a production lane. The Anthropic API key on Hetzner is also dead (401).
- **Spend this round:** $1.75 Gemini of the $5 cap (endpoint `eval/tengyur-models-6121`), plus about $0.10 on OpenRouter for the Opus token counts. Judges and reviewers ran on the subscription.

**Consequences.**
1. **Decision (Derek), default: re-translate Pramāṇa and Madhyamaka with `gemini-3.8-flash` on Batch (about $52), keeping the production request otherwise unchanged.**
   - It passes the preregistered rule on both reference texts. It cuts reference inversions from 13 to 3, and reviewer reversal/agent findings from 85 to 42 per 100.
   - It costs 27 % more than the current model.
   - Vinaya and Jātaka have no reference. The reviewers favour G38 in Vinaya, but in Jātaka its edge (80 → 60) is within the noise. Adding both sections would cost $29 more.
2. **Opus is the ceiling:** +0.25 above G38 on the references, and the fewest findings on every instrument. At about $19 per 1,000 pages Batch it costs 9 times G38, and we have no working Anthropic key. Priced as an option, not the default.
3. **Do not use `gemini-3.5-flash` for Tibetan.** It equals the stored English at 2.3 times the cost.
4. **"Pro was unconfirmed" (round 1) is now moot.** A cheaper Flash beats the stored English on the reference texts, where Pro did not (+0.03).
5. **Before any re-translation ships:**
   - **The stored English becomes a revision, not a deletion** (preservation policy).
   - **Use the Tengyur lane's Batch path with `gemini-3.8-flash`.** That is a model switch in one lane, so `ai-models.md` and the translation routing note need the change.
   - **Spot-read 20 re-translated pages against the Tibetan before the full run.**
6. **Instrument note.** Round 1's reviewer gate failure was largely the planters. With the no-op flips and the "the opponent → we" swap filtered out, both reviewers passed at the first attempt.

**Threats.**
- **Self-preference:** O is judged by Opus. The reference anchors the primary measure and the arms were unlabelled. O's by-eye precision (0.9) is no worse than the other arms', so its findings are not being missed. Still, O's margin over G38 could be partly style.
- **References:** two texts, one per section. Stcherbatsky translates from the Sanskrit, and the judges were told the Tibetan decides.
- **Sections at n = 10** (reviewers) are exploratory.

**Replicated?** No, one run. G38's gain holds on two independent instruments (the references and the reviewers) and two texts. It is not replicated on a fresh sample.

**Artifacts** (`scripts/eval/results/tengyur-models-6121/`; code in `scripts/eval/tengyur-levers/`):
- **Arms:** `arms/{G38,G35,O}{,-ref}.jsonl`, `arms/probe-*.jsonl`, `arms/ledger.jsonl`, `opus-cost.json`.
- **Reference round:** `refjudge/key.json`, `refjudge/scores.json` (numbers only).
- **Review round:** `r1/key.json`, `r1/reviews/{A,B}-NN.json` (64), `r1/analysis.json`, `r1/byeye-draw.json`, `r1/byeye.tsv`, `controls-log-1.json`.
- **Code:**
  - `run-arms.mjs` gains G38/G35, `--ledger` and `--endpoint`;
  - `opus-arm.mjs` is new (O's prompts and ingest);
  - `build-ref-packet.py --round 2`, `score-ref.py --round 2`;
  - `build-controls.mjs --round 2`, `build-packet.mjs --models`, `analyze.py --models`, `byeye-draw.py --models`;
  - `JUDGE-PROMPT-REF-R2.md`.
- **Kept on the box, not committed:** `/root/tlev/ref/` (the references), `/root/tlev2/refjudge/` (judge packets and verdicts, which quote the references), `/root/tlev2/r1/items.jsonl` and `/root/tlev2/o/` (O's prompts and raw outputs).
- No writes to `books`, `pages` or `page_translations`.
