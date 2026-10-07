# #6182 amendment: open and non-Gemini arms (job pareto-open-6182)

PRIOR ART: `PREREG.md` (this directory, `1c6dd00bd`): its pages, request, judges, controls, gate, rule B
and margin are adopted unchanged. This file only ADDS arms. It does not draw a sample, change a page set
or touch rule A. Written 2026-10-07 and committed before any arm output on a judged page exists. Before
writing it, 3-page format probes ran on off-sample pages (`/root/po6182/probe-units.jsonl`: 2 Greek pages
whose reference is withheld + 1 Tengyur side outside every set, round 1–2 sample and controls), $0.074
OpenRouter, $0 Gemini.

Derek, 2026-10-07: "we should run qwen or some other model on it maybe? didn't google output a new gemma?"

## Arms (exact ids, read 2026-10-07 from the Gemini API model list and OpenRouter `/api/v1/models`)
| label | model | endpoint | probe (3 pages) |
|---|---|---|---|
| GM31 | `gemma-4-31b-it` (open weights) | Gemini API; fallback OpenRouter `google/gemma-4-31b-it` | format 3/3 |
| GM26 | `gemma-4-26b-a4b-it` (open weights, MoE) | Gemini API; fallback OpenRouter `google/gemma-4-26b-a4b-it` | format 3/3 |
| QMX | `qwen/qwen3.6-max-preview` (closed) | OpenRouter | echo 1/3 → wrapper → 3/3 |
| QPL | `qwen/qwen3.6-plus` (closed) | OpenRouter | format 3/3 |
| Q27 | `qwen/qwen3.6-27b` (open weights) | OpenRouter | format 3/3 |
| DSP | `deepseek/deepseek-v4-pro` (open weights) | OpenRouter | echo 1/3 → wrapper → 3/3 |
| ~~DSF~~ | `deepseek/deepseek-v4-flash` | OpenRouter | echo 1/3 → wrapper → still 1/3: **dropped** |

**Dropped:** `deepseek-v4-flash` reproduced the Greek source instead of translating it on 1 of 3 pages,
both before and after the one allowed wrapper fix (the same page; served both times by the Baidu
provider). The brief allows one wrapper fix, so the arm is out.
**Tibetan-adapted model (time-boxed, 10 min):** none qualifies. The ACL 2026 continual-pretraining
Tibetan models (Qwen2.5-7B dense and a 50B-A10B MoE) have no public weights or endpoint that I could
find; the public `pkupie/Qwen2.5-{1.5B,3B}-bo-cpt` and `gemma-3-4b-bo-cpt` are base checkpoints with
no instruction tuning and cannot follow a 9,000-character output contract. MITRA-MT is not re-run (#4742).

## Request (as PREREG.md, with three stated differences)
Each unit's prompt string from `/root/pareto-6182/units.jsonl`, byte-identical to the Gemini arms', as
the only user message; temperature 1.0; max output = the unit's `max_out`. Realtime, one call per page.
1. **Thinking off.** Gemma 4 thinks by default (2,237–3,969 thought tokens on the probe, MAX_TOKENS on the
   Tengyur side); it refuses `thinkingBudget` and `thinkingLevel: low` (400) and bills 0 thoughts at
   `thinkingLevel: minimal`, which it runs at (as PREREG.md does for `gemini-3.5-flash-lite`).
   OpenRouter arms send `reasoning: {enabled: false}`; every probe call billed 0 reasoning tokens.
   Billed reasoning tokens are recorded per row.
2. **Wrapper (QMX, DSP only):** one system line before the unchanged user prompt: "Return only what the
   instructions below ask for: the English translation of the page, with the tags they define. Do not
   reproduce the source-language text."
3. **No Batch tier.** These models have no Batch API on OpenRouter, so $/1,000 pages is the billed
   realtime `usage.cost` (OpenRouter's own figure), not halved. Gemma on the Gemini API bills $0; its
   $/1,000 is plotted at OpenRouter's list price for the same model from its measured tokens, and the $0
   is stated beside it. Self-hosted cost of the open-weights arms (GM31, GM26, Q27, DSP) on our GPU
   lease is reported only if throughput can be measured within $2; otherwise "not measured".
Runner: `run-open-arms.mjs`. Outputs `/root/po6182/arms/<ARM>.jsonl`, in run-arms.mjs's row shape.

## Pages and order (no new sample)
- **Tibetan (primary):** `tib-ref58` + `tib-ref113`, 171 sides, every arm.
- **xl:** the 365 pages, every arm the spend allows (below).
- `tib-rev` (reviewers): only arms that land inside the Tibetan margin (at most two, the two highest
  fidelity), and only if pareto-6182's reviewer gate passes; same packet, prompt, partitions and gate.
- **Spend order**, fixed here: Gemma (both, $0) on all sets; then OpenRouter arms in price order DSP, QPL,
  Q27, QMX, Tibetan first, then xl. An arm starts a set only if the remaining cap covers the whole set at
  1.3 × its probe price; partial arms are not judged. **Cap $5** across OpenRouter and Gemini (ledger
  `/root/po6182/ledger.jsonl`). The OpenRouter balance is shared with pareto-claude-6182 and was $0.76 on
  2026-10-07; this job spends at most $0.35 of it until Derek tops it up.

## Instrument: pareto-6182's judges, in a companion packet
The open arms cannot be added to pareto-6182's items after they are judged, so they are judged in a
companion packet built the same way: two blind Opus judges, `JUDGE-PROMPT-REF-R3.md` (Tengyur) and
`translation-vs-reference/JUDGE-PROMPT.md` (xl), verbatim; labels shuffled per item (seed 6182); the same
controls per judge and packet (8 PLANT, 4 DUP) and the same gate (≥ 6/8 plants, ≥ 3/4 duplicate ties; one
re-run on fresh controls, else "instrument failed"). Each item holds the open arms for the page **plus two
anchors from pareto-6182's arm files: production (FP on the Tengyur, the page's production engine on xl)
and `gemini-3.8-flash` (G38)** — at most 8 candidates.
- Primary: paired Δ(arm − production) per page inside the same item, mean and seeded bootstrap 95 % CI.
- **Anchored fidelity** for the frontier: fid(production in pareto-6182's packet) + Δ(arm − production in
  this packet). The raw fidelity and the anchor drift (production in this packet − production in
  pareto-6182's, and the same for G38) are reported; a drift of G38 − FP beyond 0.25 between the two
  packets is stated as a threat to the anchoring.
- Reversals/inversions per 100 pages as PREREG.md (either judge).

## Rule (PREREG.md rule B, unchanged)
Per stratum: the frontier over all arms (Gemini and open), the dominated arms named; **best** = highest
fidelity; **inside the margin** = fidelity ≥ fid(best) − 0.25 and reversals ≤ rev(best) + 8 per 100;
**recommended** = the cheapest arm inside the margin. An open arm becomes a **routing proposal** only if
the decision card's effect rule holds against production (cheaper → non-inferior, Δ's lower bound > −0.25;
costlier → Δ's CI excludes 0, outside the A-vs-A floor, Δ ≥ 0.25), with the same book-count grades. A
closed preview model (QMX) or a provider-only model is reported but flagged: no routing on a preview id.

## Threats
- A companion packet is a second instrument run; anchoring through production assumes the judges score
  production the same way in both. The drift is measured and reported, not assumed.
- Judges are Opus; none of these arms is Claude, so self-preference does not favour them.
- OpenRouter routes each call to a provider of its choice; the provider is recorded per row.
