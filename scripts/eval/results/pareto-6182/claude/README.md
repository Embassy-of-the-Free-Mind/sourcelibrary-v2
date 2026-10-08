# #6182 Claude arms via subscription (job pareto-claude-sub-6182, 2026-10-07)

`PREREG-claude-arms.md` as amended at `1f8ec8215`: CS = `claude-sonnet-5-5`, CH = `claude-haiku-4-5-20251001`,
both as Claude Code subagents on the subscription. $0 billed, no API key and no OpenRouter.

- **Arms:** 536 pages each (tib-ref58 + tib-ref113 + xl), complete. The text is at `/root/pareto-claude-sub-6182/arms/{CS,CH}.jsonl`
  and stays on the box, like pareto-6182's arm files. Every page's `prompt` from `units.jsonl` was passed byte-for-byte (`cat`),
  ≤ 10 pages per subagent, ≤ 6 subagents at a time, page order by sha256(`6182:`+uid).
- **Incidents:**
  - CS-027 stopped on an output content filter at page 8. Pages 8–9 were re-run one per subagent and both passed.
  - CH-055 hit the session limit (429). Its 7 missing pages were re-run after the job resumed.
- **Format:** no preamble, fences or refusals. Two CH outputs carry a `<meta>Different text…</meta>` remark, which leaked from
  the previous page in the same subagent (2/536). Batching gives the subagent context from the earlier pages; pareto-6182's
  subscription `O` arm has the same caveat.
- **Cost** (`cost-summary.json`, `claude-sub-cost.mjs`): Anthropic list price ("subscription; API-list-equivalent").
  - Input tokens = the page's Gemini input count × k, where k is calibrated on the 3 pages the stopped OpenRouter job ran
    through Anthropic's tokenizer.
  - Output tokens = output chars ÷ chars-per-token from the same 3 pages.
  - `usage.jsonl` records Claude Code's per-subagent `subagent_tokens`. Those totals include roughly 20–35K tokens of subagent
    overhead per batch, so they give the upper bound quoted beside the estimate.
- **Judge packets** (same prompts, controls and gate as pareto-6182; companion instruments, because judging had started):
  - `tibjudge/key.json`: 171 sides × {CS, CH, FP, G38} + 8 PLANT + 4 DUP, 16 parts per judge.
    Built with `build-tib-packet.py --arms FP,G38,CS,CH --arms-dir /root/pareto-claude-sub-6182/arms`.
  - `xljudge/key.json`: 365 pages × {CS, CH, production engine, G38} + 8 PLANT + 4 DUP, 32 parts per judge
    (`build-claude-xl-packet.py`).
  - Inputs: `/root/pareto-claude-sub-6182/{tibjudge,xljudge}/in-J{1,2}-NN.jsonl`. They hold reference text and are never committed.
  - Prompts: `PROMPT.md` in the same directories, copied verbatim from pareto-6182.
- **Not judged yet:** 96 Opus judge runs (32 Tengyur + 64 xl). They queue behind pareto-6182's ~200 remaining Gemini judge runs
  on the same subscription.
