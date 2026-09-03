# Spend audit → the thinking-token default, and three instruments that couldn't see it

**2026-09-03.** Started as "how much do we spend each month?" Ended with a merged fix, a new
reconciliation instrument, and four corrections to my own published claims.

*Credential findings from this session are deliberately **not** here — they are in the private ops
repo (`security/2026-09-03-credential-posture.md`, ops issue #14). This repo is public.*

---

## The finding

August billed **$8,389.32** for Gemini. Our meters reported **$499.74**. A 17× gap, and it had
been open since June while the pipeline was nominally *paused*.

Cause: `performOCRWithBuffer()` in `src/lib/ai.ts` — the Lambda OCR path — passed no
`generationConfig` at all. Gemini 3.x defaults thinking **on**, and Google bills reasoning tokens at
the output rate. Our meter recorded `candidatesTokenCount`, which **excludes**
`thoughtsTokenCount`. So the bill counted them and the ledger did not.

Every batch script already set `thinkingBudget: 0`. The guard existed; it never travelled to the
worker. (Same shape as the "a guard travels with the FILE, not the pattern" lesson.)

### It buys nothing — measured, not assumed

20 real pages, run twice against the **same image**, varying only `thinkingBudget`. 12 Classical
Chinese + 8 Latin. Latin means, per page:

| | thinking ON | thinking OFF |
|---|---|---|
| visible transcription tokens | 1,122 | **1,149** |
| reasoning tokens (billed as output) | **7,648** | 0 |
| words captured | 523 | **541** |
| cost/page | $0.0281 | $0.0052 |

**Thinking off produced 2.4% more output and 3.4% more words.** One page returned an empty
transcription in both arms; with thinking on the model spent **10,967 reasoning tokens** getting
there.

Worth ~**$2,000/month** — revised *down* from an initial $5,000, which had applied the ratio to
every output token on the bill instead of to the affected call paths.

---

## What shipped

- **#4591** (merged) — `thinkingBudget: 0` on all six paths in `src/lib/ai.ts`; meter now counts
  `thoughtsTokenCount`. *Authored by a peer session, not this one.*
- **PR #4601** (merged) — `scripts/audit/spend-reconcile.mjs`, plus corrections to **two** price
  tables that had drifted from Google and from each other.
- **PR #4614** (open, green) — flags the provenance gap in `data-provenance.md`.
- **PR #4622** (open) — the generalisable measurement lesson + a stale stat in `CLAUDE.md`.
- **Issues filed:** #4599 (unlogged calls), #4600 (no Lambda CI), #4613 (generation params as
  provenance).

### `spend-reconcile.mjs` — what it does

Billed tokens (Cloud Monitoring) × live prices (**Cloud Billing SKU catalogue API** —
`cloudbilling.googleapis.com/v1/services/AEFD-7695-64FA/skus`, 634 SKUs, no console needed), diffed
against `gemini_usage`. Reports **meter coverage**, computes R2 from Cloudflare analytics, names
every vendor it cannot read, and **exits 2 on price drift**.

```
node --env-file=.env.production.local scripts/audit/spend-reconcile.mjs --month=2026-08
```

---

## THE BIG OPEN ITEM

**#4591 is merged but NOT deployed.** The OCR Lambda has no CI — it ships by hand via
`scripts/aws-lambda/build-lambda.sh` → `package-lambda.sh` → `aws lambda update-function-code`.
Hetzner's hourly auto-pull ran 12 minutes *before* the merge. **None of the ~$2,000/month is being
saved yet**, and nothing warns you. That is #4600.

The `sourcelibrary` IAM user cannot even read Lambda config (`AccessDeniedException` on
`GetFunctionConfiguration`), so deployed-vs-`main` is currently unanswerable from a script.

---

## Four corrections I had to make to my own published claims

Recorded because the *pattern* is the lesson: every one came from measuring, and none from
re-reasoning.

1. **"`MODEL_PRICING` is 3–5× below list"** — wrong for the model carrying ~90% of spend.
   `gemini-3-flash-preview` at `$0.50/$3.00` is **exactly correct**. Only the flash-lite row was
   wrong. The claim came from a summary of Google's pricing *page*; the SKU catalogue is the
   authority.
2. **The Monitoring `thinking_enabled` label** — reads `"true"` even on requests that set
   `thinkingBudget: 0`. **Never cite it as evidence of thought billing.** Use tokens-per-page.
3. **"$5,000/month"** — too crude, revised to ~$2,000 by attributing calls to code paths.
4. **"`page.ocr` never carries `prompt_hash`"** — I had 0/300 recent pages; one indexed probe found
   a `source=pipeline_preview` row from 2026-05-29 that does. Corrected to "no *current* writer
   emits them; historical coverage **unmeasured**" — `ocr.source` has no index, so a per-source
   count is a ~20M-doc scan not worth the production load for a footnote.

Also worth knowing: **Cloud Monitoring's `crossSeriesReducer=REDUCE_SUM` double-counts token series
~1.9×.** Align per series and sum them yourself. Monthly project totals were unaffected; daily spike
figures were not.

---

## Traps found along the way

- **`gcloud billing projects list` default-paginates** — six projects are billing-enabled, not the
  five an unpaginated call returns.
- **92% of Gemini tokens bill to a project named `booksplit`**, not `Sourcelibrary`. Proven by
  sha256-matching Hetzner's live keys against every key in all three projects. The spend *is* ours,
  but two of the three projects also host other PlayPower products' keys, so the Source Library share
  is unmeasured.
- **`GEMINI_API_KEY_TIER3` == `GEMINI_API_KEY_2`** (and `_7` == `_5`). ~20 scripts open with
  `TIER3 || GEMINI_API_KEY` believing they reach a higher tier. They do not — and the 429 failover
  retries into the *same* quota bucket.
- **A quoted `.env` value** silently becomes a malformed Cloudflare `accountTag` and returns *"not
  authorized for that account"* — reads as a permissions problem, isn't one.
- **A test was defending the wrong price.** `model-pricing-single-source.test.ts` pinned
  `0.075/0.30` as canonical with `0.25/1.50` as `DISPUTED_LEGACY`. Backwards, and it turned the
  correction red for months. Its justification — "closest fit to recorded costs" — was circular,
  because recorded `cost_usd` is computed *from* that constant. Generalised into
  `invariants/tests-that-are-not-guards.md`.

---

## Where to pick up

1. **Deploy the Lambda** (#4600) — this is the money.
2. **Audit every Gemini call site** (#4599) — ~250K calls/month log nothing, ~58% of the token
   volume, and most were never checked for a thinking budget. Bigger than the path just fixed.
3. **Generation params as provenance** (#4613) — `thinkingBudget`, `temperature` and
   `maxOutputTokens` are recorded nowhere, and they diverged between paths (Lambda ran OCR at
   **temperature 1.0**, unset → model default; Hetzner at 0.1). Because they change the output, the
   `page_revisions` double-OCR corpus currently mixes model instability with unrecorded config
   change. Fix should include a **negative marker** — record that a value was *not* captured, rather
   than leaving the field absent, since absent reads as "no thinking, temperature 0" to anyone
   assuming defaults.
4. **Merge PRs #4614 and #4622.**
5. **Atlas billing** is still the one vendor with no number at all.
