# Judging the aliveness ontology (#6720)

Three judgments, made by Claude subagents (no paid API) over packets that `packets.py` cuts from the measurement
outputs. Each judge gets a slice of nodes and writes three files into `verdicts/` (committed here; `edges-lead.jsonl` is the session lead's overrides, read last). `build.py` reads only these
files; nothing a judge writes reaches the page unless it points at a candidate that `measure.mjs` already verified as
verbatim on its page.

## 1. Terms → `terms-<k>.jsonl`

Follow `.claude/docs/concept-aliases/JUDGE-RUBRIC.md` exactly (variant / equivalent / related / reject; adversarial
bar; names of people and places always reject; under 0.6 confidence must be related or reject). The concept is the
node's `label` with the meaning in its `gloss`. Judge every candidate and every seed form; a seed form that pulled
in a homograph (`ki` = Hebrew "for", `mana` = manna, `lares` in a list of Roman gods with no sense of place) is
rejected with the reason. One line per node:

    {"node": "<id>", "verdicts": [{"term_key": "...", "tier": "variant|equivalent|related|reject", "confidence": 0.0, "reason": "..."}]}

## 2. Passages → `passages-<k>.jsonl`

Each node has up to 14 candidate quotes, spread across centuries. Pick **two to five** a curious reader should read
to learn what the concept is, what was believed about it, or what people did with it. Order them best first; the
page shows the first three.

Keep a candidate only if:
- it uses the word **in the node's sense** (not "spirit of wine" for vital spirits, not a person named Mana, not
  "death" as a plot event when the node is death-as-extinguished-heat — for broad nodes, prefer passages that state
  a doctrine about the thing);
- it says something: a definition, a claim, an instruction, an experience. Not a title, a list of contents, a
  catalogue entry, an index, or a bare mention;
- it reads as a sentence a reader can follow out of context.

Prefer, among those that qualify: the oldest work, a different tradition or language from the other picks, a
practitioner's own words over a modern scholar's summary. A node may get **zero** picks if no candidate qualifies:
write `"picks": []` and say why. Never edit a quote.

    {"node": "<id>", "picks": [{"idx": 3, "why": "one line"}], "note": "optional, e.g. why none qualified"}

## 3. Edges → `edges-<k>.jsonl`

Each edge carries a one-line `claim` (scholarly background) and up to six candidate passages from pages that print
both ends. Decide whether **one passage, read on its own, states the relation** the edge type names:

- `translates`: the passage gives one term as the rendering, equivalent or translation of the other.
- `analogue`: the passage compares the two across traditions or calls them alike.
- `descends`: the passage says the later concept or school comes from, follows, revives or reworks the earlier.
- `belongs`: the passage attributes the concept to the doctrine or school (Paracelsus's archeus; the Stoics' pneuma).
- `cultivates`: the passage says the practice produces, strengthens, conserves or restores the target.
- `opposes`: the passage sets one against the other.

Co-occurrence is not a statement. If two words sit in one list, or the passage states some other relation, the
verdict is `not_stated`. When unsure, `not_stated`: a background edge says honestly what it is; a wrongly backed
edge puts a false citation on the page.

    {"key": "<from>|<type>|<to>", "verdict": "stated|not_stated", "idx": 2, "reason": "one line", "judge": "<model>"}

`idx` is required when stated and is the candidate that states it.
