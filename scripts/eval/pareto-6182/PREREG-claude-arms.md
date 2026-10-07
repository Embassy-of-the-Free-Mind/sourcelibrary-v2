# #6182 amendment: Claude arms via OpenRouter (job pareto-claude-6182)

PRIOR ART: `PREREG.md` (this directory; the pages, the request, both rules, the judges and the margin, all
unchanged here) and `PREREG-open-arms.md` if present (the open-model arms added the same way). Written
2026-10-07, committed before any Claude output on a judged page exists. Derek, 2026-10-07: "we have an
openrouter key", so Claude is a priced lane, not only the subscription ceiling `O`.

Nothing in `PREREG.md` changes: same pages, same production request, same judges and controls, same
rules A and B, same 0.25 margin and 8-per-100 reversal margin. This adds arms only.

## Arms (OpenRouter Batch API, `POST /api/v1/batches`, endpoint `/v1/messages`, provider pinned to Anthropic)
| label | model (OpenRouter slug) | Batch list price $/M in / out | pages |
|---|---|---|---|
| CS | `anthropic/claude-sonnet-5.5` | 1 / 5 | tib-ref58, tib-ref113, xl (536) |
| CH | `anthropic/claude-haiku-4.5` | 0.5 / 2.5 | tib-ref58, tib-ref113, xl (536) |
| CO | `anthropic/claude-opus-5.5` | 2 / 10 | 30 sides of tib-ref58 (seeded draw 6182 below) |

- **Request:** each unit's `prompt` from `/root/pareto-6182/units.jsonl` byte-for-byte, as the only user
  message; no system prompt, no tools; `max_tokens` = the unit's `max_out` (+ 8,192 where thinking cannot
  be turned off). Sampling parameters are not sent (the 5.x models reject them). Thinking: the lowest the
  model accepts (Haiku 4.5: off; Sonnet 5.5: off if accepted, else effort `low`; Opus 5.5: effort `low`,
  it cannot be disabled). Billed thinking is recorded per page.
- The `:batch` ids on OpenRouter's model list are price rows only; they 404 on chat/completions. Batch
  pricing is only reached through `/api/v1/batches` with the plain slug (checked 2026-10-07).
- `tib-rev` is not run (PREREG: S, FP, G38 only, for reviewer load).
- **CO's 30 pages** = the first 30 of tib-ref58's page ids sorted by sha256(`6182:` + page_id). They
  all have round 2's subscription Opus output (`/root/tlev/arms/O-ref.jsonl`). CO answers one question:
  do the OpenRouter output and the **billed** price match the subscription arm `O` (round 2 estimated
  $19.1 / 1,000 pages Batch)? Compared on fidelity (the same judges), output length, and $/1,000.
- **Format check before any judged output:** 3 pages per model (the first 3 of the CO draw), the same
  check the Gemini probes used (house tags present, no preamble, finish = end_turn). An arm that fails
  gets one prompt-wrapper fix; if it still fails it is dropped and reported as dropped.

## Measurement
Fidelity, reversals and $/1,000 pages under PREREG's rule B, by pareto-6182's judges. Claude arms join the
Gemini arms of the same page in one judge item when the judging has not started yet. Otherwise they are
judged in a separate packet with the same prompt and controls, and that is stated. **Self-preference:**
every judge is Opus. Any Claude arm on the frontier is reported with that caveat. A Claude arm can be
recommended under rule B only if it also leads on the non-Claude judge, if one runs (judge-fable-6182 is
Claude too, so not that one). Otherwise it is "on the frontier, judge-confounded".

**Cost:** $/1,000 pages = OpenRouter's billed `usage.cost` for the batch ÷ pages × 1,000 (thinking
included), beside the list-price arithmetic from the returned tokens. Cap **$10** total on OpenRouter for
this job (`/root/pareto-claude-6182/ledger.jsonl`). Until the shared credit is topped up (0.76 USD left at
12:51 UTC), at most 0.35 USD is spent, on the format checks only.

Reference texts stay on the box; nothing here writes to `pages`, `books` or `page_translations`.
