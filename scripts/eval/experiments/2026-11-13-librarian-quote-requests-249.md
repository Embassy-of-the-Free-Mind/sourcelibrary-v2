---
stage: pipeline
measure: [none]
feeds: prompt
landed: src/lib/embassy/librarian.ts
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Null on the headline: with the old routing 24 of 24 quote-request first turns already kept a quotation, so the run cannot show the new routing prevents the live failure. Requiring find_passages first did what it does by construction (24 of 24 first rounds, was 15) at no cost in time or money."
status: adopted
decision: "Quote requests call find_passages in their first round, on by default in src/lib/embassy/librarian.ts; LIBRARIAN_QUOTE_REQUESTS=0 turns it off (v3#249). Adopted as a guarantee, not on a measured gain."
superseded_by: null
issue: [249]
---
PRIOR ART: `scripts/eval/librarian-followup-8151/run.ts` (the in-process harness with interleaved arms that this copies; it replays follow-ups and counts searches). `scripts/eval/librarian-grounding/` (20 general questions, one arm, scored for citations). Harness: `scripts/eval/librarian-quote-requests-249/`.

## 2026-11-13 · Does a reader who asks for an author's words get a quotation that is on a page? (v3#249)

**Who it is for.** A reader who types "What did Ficino say about melancholy? Quote him." On 2026-11-13 that first turn ran one `search`, got title pages and prefaces, and quoted from memory. Both quotations were on no page read and were removed; the answer arrived with none.

**Design.**
- 12 quote-request questions, one per tradition, written before any run (`questions.json`, frozen). The first is the live turn; the others use the phrasings the detector is meant to catch ("quote him", "in his own words", "the exact words", "what did X say").
- The production agent in-process against production data, first message of a thread, no history. Answer model `gemini-3-flash-preview`, the production model, under Derek's 2026-11-13 authorisation of up to 60 paid test turns for v3#249.
- **Arms:** A = quote requests off (the turn as it ran before). B = quote requests on: the prompt lines, and the first round must call `find_passages`, `get_book_page` or `read_nearby_pages`. After the run, B was narrowed to `find_passages` alone on a first message and run once more on the first 10 questions (below).
- Each question twice per arm, interleaved, so 24 turns an arm. Both arms run the same grounding pass (the one in PR #262), so the difference is the routing alone.
- **What is counted:** a blockquote left in the answer the reader sees, after the grounding pass has removed every quotation it could not find on a page the turn read. No judge read the answers.

**Decision rule, written while the run was in progress and before any result was read.** B goes on by default if all three hold: turns with at least one kept blockquote, B ≥ A; turns that lost a blockquote, B ≤ A; median time to done, B no more than 5 s slower than A. With 24 turns an arm, a difference of fewer than about 5 turns is inside what two runs of the same arm can differ by, so a small gap in either direction is reported as no difference.

**What this does not show.**
- That a kept quotation is the BEST passage for the question, or that the answer is better overall. It shows the words are on a page the turn read.
- Anything about first messages that are not quote requests: by the detector's pattern those are 97% of first messages (858 of 881 in the 30 days to 2026-11-13).

**Result: the headline did not move, because the old routing did not fail on this set.**

| | A: as before (n=24) | B: first design (n=24) | B as shipped (n=10) |
|---|---:|---:|---:|
| turns with at least one kept blockquote | 24 | 24 | 10 |
| turns that lost a blockquote | 0 | 1 | 0 |
| blockquotes kept, total | 49 | 55 | 23 |
| turns with an unsupported inline quote (marks removed) | 7 | 3 | 0 |
| first round called `find_passages` | 15 | 24 | 10 |
| first round was `search` alone (the live failure's shape) | 1 | 0 | 0 |
| first-round page reads by a made-up book id that found nothing | 0 | 21 of 22 | 0 |
| answer opened twice (opening removed by the grounding pass) | 4 | 0 | 0 |
| time to done, median | 14.4 s | 12.7 s | 13.4 s |
| first text, median | 7.2 s | 7.8 s | 9.3 s |
| output tokens a turn | 1,102 | 3,685 | 900 |
| answer-model cost a turn | $0.0162 | $0.0228 | $0.0136 |

- **By the decision rule:** kept, B = A; lost a blockquote, 1 against 0, inside the noise the rule names; time, B is not slower. The rule passes, and it passes because nothing differs, not because B won.
- **The live failure did not reproduce.** In arm A the one `search`-only first round (Paracelsus, repeat 1) still ended with two kept quotations. Production's own record agrees it is uncommon: of the 7 quote-request first turns in the last 30 days that carry a grounding trace, 6 kept a quotation and 1, the Ficino turn, did not. A set of 12 questions cannot measure a failure that rare, and this one did not.
- **The unsupported-inline-quote gap is not evidence either.** A's own two repeats gave 5 and 2 turns of 12; the arms differ by less than A differs from itself.
- **The first design of B was wrong and the run caught it.** It let the first round call `get_book_page` and `read_nearby_pages` as well. With no tool result yet the model had no book id, so it made one up: 22 such reads over 24 turns, 21 found nothing, and the other read the Poimandres for a question about the Emerald Tablet. That is also where B's 3.3 times the output tokens went. B as shipped allows `find_passages` alone on a thread's first message; the confirmation run (the first 10 questions, once each) has no failed read and fewer output tokens than A.
- **A prompt clause was dropped.** B's lines asked for one edition when several editions of a work came back (finding 5 of the issue). Answers citing more than one book: 22 of 24 in A, 21 of 24 in B. The clause did nothing and is not in the shipped lines.
- **What a reader loses:** the opening sentences that stream while the search runs. A quote request now shows search steps until the answer starts, about 2 s later than before by the median of 10 turns.

**Why it is adopted anyway.** The issue asks that a quote request read pages before it quotes. This makes that true on every turn instead of 15 in 24, it costs nothing measurable, and one environment variable turns it off. It is a guarantee about the first step, with no measured gain in what the reader ends up with.

**Spend.** 59 Librarian turns on `gemini-3-flash-preview` (1 smoke, 48, 10) of the 60 authorised: $1.09 in answer-model tokens by the harness's count, plus 55 `find_passages` re-ranks at about $0.011, about $0.60. No billing read.

**Replicated?** No. One run; A and B interleaved, B-as-shipped run afterwards and not interleaved.

**Artifact.** `scripts/eval/librarian-quote-requests-249/results/run1.jsonl` (A and the first B), `results/run2-b2.jsonl` (B as shipped). `run.ts --out=<file> --summary` reprints the per-arm counts.
