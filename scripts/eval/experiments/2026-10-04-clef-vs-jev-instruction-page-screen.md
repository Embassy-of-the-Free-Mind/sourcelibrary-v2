## 2026-10-04 — Is Cloudflare's Clef a substitute for Jev as a page screen? — RESULT

PRIOR ART: scripts/eval/experiments/2026-09-24-can-jev-typesafe-s-typed-decision-model-screen-pages.md — the Jev-only pilot this re-runs; its results were not committed, so all three models are re-run here.

**Headline: a tie on quality; Jev stays the default on price.** Cloudflare's Clef (27B) and Clef-flash (9B),
released 2026-10-01 on Workers AI and drop-in compatible with Jev's System One API, were run beside Jev on the
same 519 pages as the 2026-09-24 instruction-page pilot (same two `noul` questions, 8 concurrent, 0 failures).
Jev reproduced its pilot exactly (rubric AUC 0.943, 0.99 on the confident subset, κ 0.746 @0.3) — the positive
control that the harness and labels are unchanged.

| model | rubric AUC | AUC (judge conf ≥0.85) | naive AUC | κ @0.3 | P/R @0.5 | random flagged ≥0.5 | blog positives ≥0.5 | $ / 519 calls | median latency (laptop) |
|---|---|---|---|---|---|---|---|---|---|
| Jev | 0.943 | 0.990 | 0.892 | 0.746 | 0.98 / 0.69 | 3/133 | 74/94 | $0.019 | 0.36 s |
| Clef | 0.944 | 0.986 | **0.914** | 0.733 | 0.91 / **0.80** | 3/133 | **84/94** | $0.099 | 0.52 s |
| Clef-flash | 0.936 | 0.986 | 0.881 | 0.678 | 0.93 / 0.68 | 3/133 | 78/94 | $0.037 | 0.33 s |

Rubric scores correlate r ≈ 0.92 between every pair. Ranking quality (AUC) is indistinguishable. Clef is
**calibrated more permissively** — at 0.5 it trades precision for recall — and is less sensitive to question
wording (naive AUC 0.914 vs 0.892). Cloudflare's "2.5× / 13× faster than Jev" did not show from a laptop over
REST (network-bound); it may hold inside a Worker binding. The one random page all three flag ≥0.8 is a Masonic
ritual giving a hand sign — a plausible true find, as in the pilot.

**What this changes.** For text screens, nothing: Jev is 5× cheaper than Clef at the same AUC. Clef's distinct
assets are (1) **image input** (up to 4 per request) — the untested lever, e.g. page image vs text "is this the
same leaf?" for the wrong-leaf family (#3368, #5683) — and (2) **Apache-2.0 open weights**, which make a
corpus-wide self-hosted run possible instead of per-token billing.

**Not shown.** Labels are Sonnet judges. English translations only. No image input tested. Latency measured from
one laptop. *Replicated?* The Jev arm replicates the 2026-09-24 pilot. **Artifact:**
`scripts/eval/jev/clef-vs-jev-instruction.py`; summary `scripts/eval/results/clef-vs-jev-instruction-2026-10-04.json`.
Clef is called at `api.cloudflare.com/client/v4/accounts/<acct>/ai/run/@cf/cloudflare/clef[-flash]` with
`CF_ANALYTICS_TOKEN` (the only SL Cloudflare token with Workers AI scope; `CLOUDFLARE_API_TOKEN` 401s). The Clef dollar figures are list price; the account is on the Workers **free** plan (10,000 neurons/day), which this run fit inside and a follow-up image test then exhausted (HTTP 429). Real spend $0.019 (Jev).
