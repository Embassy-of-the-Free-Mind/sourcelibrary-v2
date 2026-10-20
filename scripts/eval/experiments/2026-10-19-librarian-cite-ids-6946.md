---
stage: pipeline
measure: [judged, preference]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Cite-by-ID test on 40 readers' questions. The model cites each page by an ID ([P7]) and the server writes the link; the top 6 search hits are shown whole. Wrong-page links rose 25 → 115 (11.4% → 19.5% of judged links) because the model cited 2.7× as many pages and mixed up IDs the way it mixed up page numbers. Wrong-fact rate fell 8.7% → 3.4%, and the judges preferred B 24 to 15. The same arm on gemini-3.8-flash (C) was worse again: 150 wrong-page links and time to done 1.8× slower. Gate not met."
status: rejected
decision: "Both arms land behind flags, off: LIBRARIAN_CITE_IDS=1 and LIBRARIAN_MODEL=gemini-3.8-flash. The default Librarian is unchanged (#6946)."
superseded_by: null
issue: [6946]
---
PRIOR ART: `scripts/eval/librarian-cite-prompt-6946/` (the previous arm test on this issue; its harness and gate shape are copied here). `scripts/eval/librarian-speed-6904/` (the 40 frozen questions and the blind X/Y preference judge; `build-packets.ts` gained `--pairs`). `scripts/eval/librarian-citations-6946/` (the per-link instrument `packet.ts`, shared with the weekly gauge, plus `load-support.ts`). The rule was registered in `scripts/eval/librarian-cite-ids-6946/PREREGISTRATION.md` and committed before any main-run turn (`66a617a83`).

## 2026-10-19 · Do page links land on the right page if the model cites an ID and the server writes the link? (#6946)

**Who it is for.** A reader who clicks a Librarian page link. The weekly gauge found 19 of 105 links on a page that does not say the thing. Two levers had already failed: the citation prompt (#6970) and the flash-lite router (#6956). This test tried two structural causes read from `librarian.ts`:
- each search hit reached the model cut to 1,200 characters;
- the model copied "p.323" by hand across a dozen passages.

**Design.**
- **A**: today's request (`gemini-3-flash-preview`, thinking LOW on tool rounds). Its system prompt is byte-identical to `main` at c5d82c327.
- **B**: cite by ID (`src/lib/embassy/cite-ids.ts`).
  - Every page a tool shows carries an ID. That covers search and find_passages hits, neighbour pages, get_book_page, read_nearby_pages, and an image's own page.
  - The prompt says to cite by ID only.
  - While the text streams, the server rewrites each ID as `[Page N](…?page=N)`. It puts the short title in front when the book is not linked just before. It drops an unknown ID.
  - The grounding, quote re-point and link checks then run unchanged on the rendered text.
  - The top 6 hits of each search are shown whole (cap 8,000 characters). Neighbour and nearby pages are shown up to 3,000 characters.
- **C**: B on `gemini-3.8-flash`, thinking LOW on tool rounds (#6909).
- **A2**: A again on 8 questions, for the noise floor.
- 40 questions, run in-process on Hetzner and interleaved, with the arm order rotating.
- **Instruments.**
  - Every page link the reader sees was labelled with the gauge's instrument: two Opus judges on whole pages, and a third on the 59 answers where they split.
  - #6904's blind preference judge compared B vs A and C vs B: two Opus judges, and a third on the 19 split pairs.

**The plumbing worked as designed.** B rendered 576 IDs and C 670. No ID was unknown, the model wrote no page link by hand, and no `[P…` token reached a reader. `thoughtsTokenCount` at LOW averaged 37 per turn on 3-flash and 115 on 3.8-flash, so LOW does take effect on 3.8.

**Results** (40 questions; wrong-page = `other` + `none`; `missing` excluded):

| arm | links / answer | judged links | cited | other | none | wrong fact | **wrong-page** | answers with one |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 5.6 | 219 | 175 | 13 | 12 | 19 (8.7%) | **25 (11.4%)** | 17 / 40 |
| B | 14.8 | 591 | 456 | 61 | 54 | 20 (3.4%) | **115 (19.5%)** | 33 / 40 |
| C | 16.8 | 670 | 501 | 57 | 93 | 19 (2.8%) | **150 (22.4%)** | 28 / 40 |
| A, control 8 | | 49 | 43 | 2 | 2 | 2 | 4 | 4 / 8 |
| A2, control 8 | | 50 | 43 | 2 | 1 | 4 | 3 | 3 / 8 |

- J1 and J2 agree on 0.92 of labels (wrong-page κ 0.82, 1,530 links).
- B has more wrong-page links than A on 29 questions, fewer on 2, and the same on 9. C: more on 26, fewer on 6.
- **What goes wrong.** B's IDs get mixed up much as page numbers did, and now across many more links:
  - 27 of B's 61 `other` links point to the right book but the wrong page, and 22 of those are within ±2 pages, usually a neighbour the model was shown.
  - 34 point to a different book than the one that says it. q09 alone (Paracelsus's tria prima) attaches claims to Schermann, Windelband and Helmont pages.
  - An opaque `P23` gives the model nothing to check against: it cannot see that the page is wrong.

| | A | B | C | A2 |
|---|---:|---:|---:|---:|
| first text p50 / p90 | 5.1 / 8.0 s | 3.4 / 8.9 s | 1.8 / 4.6 s | 4.4 / 6.5 s |
| done p50 / p90 | 11.7 / 15.8 s | 11.6 / 15.1 s | 21.1 / 29.3 s | 10.8 / 12.3 s |
| prompt tokens / turn (mean) | 26,734 | 30,347 (+14%) | 44,943 | 26,844 |
| rounds / turn | 2.00 | 2.05 | 2.77 | 2.00 |
| $ / turn | 0.0172 | 0.0187 | 0.0403 | 0.0173 |

Showing the top 6 hits whole cost about +3,600 prompt tokens per turn, about +$0.0015. Most of C's extra tokens come from its extra rounds.

**Preference** (blind X/Y, 40 pairs each, after the third judge):

| pair | wins | tie | grounding failure only-one |
|---|---|---:|---|
| B vs A | **B 24**, A 15 | 1 | B 10, A 8 (both 8) |
| C vs B | **C 21**, B 17 | 2 | C 9, B 7 (both 12) |
| A2 vs A (floor) | A2 4, A 4 | 0 | A2 3, A 2 |

Preference α 0.69 and grounding α 0.68: both **tentative**.

**Gate** (registered):

| | B vs A | C vs A | C vs B |
|---|---|---|---|
| G1 wrong-page drop ≥ 40% + noise 25% | −360% **fail** | −500% **fail** | −30% **fail** |
| G2 wrong-fact rate ≤ ref + 3.9 pts | 3.4% vs 8.7% pass | 2.8% vs 8.7% pass | 2.8% vs 3.4% pass |
| G3 preference net loss ≤ 0.125 | −0.225 pass | not judged (fails G1, G4) | −0.10 pass |
| G4 done p50 ≤ 1.15 × ref | 0.99× pass | 1.80× **fail** | — |
| G6 cited links ≥ 80% of ref | 456 vs 175 pass | 501 vs 175 pass | 501 vs 456 pass |

**Neither arm ships.** Both land behind flags, off.

**What it says.**
- Cite-by-ID removed hand-copying, and the errors moved to the IDs. The cause is the model choosing which page supports a claim, not the copying.
- Making a citation cheap made the model cite nearly three times as often. Wrong-page links rose faster than correct ones, in count and in rate.
- The judges still preferred B's answers, and its wrong-fact rate is less than half of A's. A guess, not separable here: the whole pages helped the prose, and the IDs hurt the links. Arm B changed both at once, so a test of whole pages without IDs would settle it.
- 3.8-flash (C) took more rounds and almost twice as long to finish. It streamed its first words sooner, but it did not link better.

**Spend.** 130 Librarian turns (2 smoke + 128 main), **$3.24** by the turns' own usage numbers, within the approved 170 turns and $6. No other Gemini. Judges were Opus via `claude -p` on the subscription: 240 + 59 per-link calls and 176 + 19 preference calls.

**Replicated?** No. n = 40 questions. The direction is not close: B is worse on 29 questions and better on 2.

**Artifacts.** `scripts/eval/librarian-cite-ids-6946/`:
- `run.ts` (arms switch `citeIds` and `model`), `score-links.mjs` (J1/J2/J3 merge, gates per arm vs reference, cite-ID accounting), `score-pref.mjs` (unblinds any arm pair), `PREREGISTRATION.md`;
- `results/`: `main.jsonl.gz` (all 128 turns: raw, final, sources, timings, usage incl. `citeIds`), `smoke.jsonl.gz`, `links/` (link lists and labels J1/J2/J3), `pref/` (key and verdicts), `links-scored.json.gz`.

To rebuild the packets, run `load-support.ts --arms=A,B,C,A2`, then `build-packets.ts --tag=<arm> --runs=J1,J2` for the per-link packets, and `librarian-speed-6904/build-packets.ts --pairs=A:B,B:C,A:A2` for the preference packets.

Re-score: `node scripts/eval/librarian-cite-ids-6946/score-pref.mjs <results>/pref --json=<pref.json>` then `node scripts/eval/librarian-cite-ids-6946/score-links.mjs <results>/links <main.jsonl, gunzipped> --pref=<pref.json>`.
