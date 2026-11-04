---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "With only web fetch and the new llms.txt, Claude Code on Sonnet searched, read and cited in 3 of 3 questions, with no connector. Of 8 quoted strings, 5 matched the fetched page text, 2 matched search snippets and were labelled as snippets, and 1 was the reader's own slogan. n = 3, Claude Code only."
status: adopted
decision: "Ship the new llms.txt. Do not promise this on /connect until it has been tried in Claude chat and ChatGPT, whose fetchers may refuse a URL the model built itself."
issue: [8161]
---

PRIOR ART: `2026-11-04-mcp-trigger-instructions-8154.md` (the same questions of behaviour, with the connector). This one has no connector.

## 2026-11-04 · Can an assistant do the whole job with nothing installed?

**Method.** Three questions through `claude -p --model sonnet`, with WebFetch the only tool. The draft `llms.txt` opening was pasted into the prompt, because it was not deployed yet. Each quotation was then checked against the quote API for the pages that run fetched, and against the search output. The answers are in `scripts/eval/centaur-8161/`.

**Result.**

| Question | Fetches | Quotations found on a fetched page |
|---|---|---|
| Ficino on the immortality of the soul | 3 | 1 of 1 |
| Serious belief in natural magic in the 1500s | 2 | 1 of 3; the other 2 are search snippets, labelled as such, and both are in the search output |
| Did Paracelsus say "the dose makes the poison"? | 3 | 3 of 4; the other is the reader's slogan, which the answer says is not in the text |

**What the answers showed.**
- The stance held. The Paracelsus answer opens "Yes, in substance, but not in those words", gives the Latin, and notes that the edition is about 117 years after his death.
- **A provenance gap.** Two answers said the metadata does not state whether the English is machine-made. The quote API says `trans. Source Library`, and nothing more. The rule in `llms.txt` asks for something the API does not yet supply per page.
- **A limit of the tool.** One answer reported that its fetch tool capped quotations at about 125 characters. Long quotations need the connector.
- The first run also produced a search with a degraded lane, which the answer reported rather than hid.

**What this does not show.** Claude chat, ChatGPT or Grok. Whether an assistant would find `llms.txt` unprompted, since it was pasted in here. Accuracy of the translations themselves. Three questions, written by the author.
