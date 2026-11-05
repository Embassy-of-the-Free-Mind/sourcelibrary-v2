# Citation benchmark (#8161)

PRIOR ART: `scripts/eval/mcp-trigger-8154/` (does a model call the connector, with web tools off) and `scripts/eval/centaur-8161/` (three answers, with the address given). Neither asks whether an assistant finds us on its own.

**The question.** Someone asks an assistant a historical question with nothing installed. Does the answer link to Source Library? If "become the AI default" is happening, this number rises, and it can fall.

## What it runs

`panel.json` is fixed: 70 questions, drawn once by `draw-panel.mjs`.

| Stratum | n | Why |
|---|---|---|
| `topic` | 30 | History questions from #8154, unchanged. Written by the author |
| `work` | 20 | Random non-English editions we hold translated, volume slices excluded. A link to us is possible by construction |
| `modern` | 10 | From #8154. A link to us here is a false positive |
| `pointed` | 10 | `topic` questions plus "Use sourcelibrary.org to find it." The positive control, and the acceptance test on #8161 |

`topic` and `work` run twice per engine, and the second pass is the A-vs-A noise floor. Each run has web tools and no connector, in an empty directory, framed as `FRAMING` in `engines.mjs`.

| Engine | How | Runs on |
|---|---|---|
| `claude` | `claude -p`, Sonnet, WebSearch and WebFetch only | gex45, under the `dereklomas@gmail.com` login |
| `agy` | `agy -p`, `gemini-3.8-flash-low` | gex45 |

**Run it where the account name is clean.** A Claude Code session is told its account email. On an `@sourcelibrary.org` login that puts our domain in the model's context, which `canary.mjs` caught on the first try. `--bare` would remove it, but it authenticates by API key only, and Claude runs on the subscription here. Run `canary.mjs` first and read its output.

## The funnel

`score.mjs` reports each step per engine and stratum, per run and per question.

1. **Used search:** the model looked at all.
2. **Surfaced us:** `sourcelibrary.org`, or a tenant subdomain, appeared in what its tools returned. **Claude only:** agy's stream holds tool calls and no tool output, so this is "not measurable" for Gemini and never zero.
3. **Opened us:** it fetched one of our pages. `our search` and `llms.txt` count whether it used the way in that we built for it.
4. **Linked us:** the headline. Our URL is in the answer, and `--check-links` tests that each one opens. Gemini's grounding redirects are resolved to their real address first; any that fail to resolve are reported, not dropped.

agy is a coding agent with a shell, and no flag removes it, so its prompt tells it to use web tools only and `shell runs` counts any run that did not comply.

## Rule, fixed before the first run

Read per question over `topic` + `work`, Claude and Gemini separately. The surfaced rows apply to Claude only; Gemini is read from opened and linked.

| Result | Reading | What happens next |
|---|---|---|
| Surfaced on under 10% of questions | Search indexes do not reach us. Our fetch path is not the limit | Next work is discovery: what is indexed and how well, before more fetch features |
| Surfaced on at least 10%, linked on under half of those | We are seen and passed over | Next work is what the page shows a model, and why it preferred the others (read the answers) |
| Linked on at least half of those surfaced | The path works | Discovery volume is the lever, and this number is what to watch |
| `pointed` links a book or page of ours, with a URL that opens, on under 8 of 10, either engine. The bare homepage does not count | The no-install promise fails even when told where to go | Fix the first failing step before anything else. No paste-this sentence on /connect until it passes |
| `modern` links us on more than 0 | The detector or the isolation is broken | Discard the run and find out why |

**What a later run can show.** With 50 questions, 0 linked has a 95% upper bound of about 6%, so the baseline cannot separate zero from a few percent. A change counts only if it is larger than the A-vs-A disagreement.

## What it does not measure

- **Claude chat, ChatGPT, Grok, Perplexity.** No subscription CLI exists for them here. These are CLI agents with the same models and different search stacks and system prompts. It is a proxy to re-run and compare with itself, not a reading of what those products do.
- **Real readers' questions.** We hold no record of what people ask an assistant.
- **Whether a quotation is accurate.** Read the answers that link us by hand.
- Each run's `WebFetch` reaches our site as a real fetcher, so a run adds a little to any count of assistant fetches.

## Usage

```
node scripts/eval/citation-benchmark-8161/canary.mjs
node scripts/eval/citation-benchmark-8161/run.mjs <out-dir>
node scripts/eval/citation-benchmark-8161/score.mjs <out-dir> --check-links
```

`run.mjs` resumes from `runs.jsonl`, and it stops rather than retries on a limit.
