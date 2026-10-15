---
stage: metadata
measure: accuracy
languages: [la, grc, lzh, ja, sa, ar, fa, he, en, de]
scripts: []
canons: []
n_books: 318
n_pages: null
verdict: "A lean catalogue-only prompt (100 books a call, ~30 output tokens a book) dates works as well as the first run's full prompt (Sonnet 85.2% vs 85.4% high/medium, n=318), at 14× fewer output tokens a book; Haiku fails (75.0%). Wikidata alone does NOT date the library's works: an author's lifespan passes on gold (90.1%) but contradicts a model date on 17% of 3,791 library works, mostly because books.author_id names the translator or editor, and a work_id item disagrees on 19% of 276 (it often names an edition item)."
status: informational
decision: "Bulk route: edition by rule (now incl. catalogue windows), work by lean Sonnet for every work, a Wikidata work-item date stored only where it meets the model's window, the author's Wikidata window as prompt context and a recorded check. #6721."
superseded_by: null
issue: [6721]
---
## 2026-10-15 · Can a lean catalogue-only prompt, and Wikidata, date a library's works?

**Why.** The first library run (#6721, 2026-10-14) spent ~430 output tokens a book (reasoning, notes, layer prose) and
carried the full `claude -p` system prompt every 15 books. The entry above showed catalogue fields date the work as well
as the opening leaves, so the question was how little a call can carry, and whether Wikidata can replace the model.

**Design.** Same 318 Wikidata-gold works and 130 imprint editions as the entries above; `score.mjs`; bar = HIT ≥ 85%
on high/medium rows. Lean work prompt: title, English title, author (+ the author's Wikidata birth/death when
`author_id` resolves), catalogue date, language; 100 books a call; the reply is one line per book,
`{"i","w":[from,to],"y","c"}`. Sealed `claude -p` with `--system-prompt` (one line, in place of the Claude Code
system prompt) and `--effort low`. Lean edition prompt: books no rule dates, 700 characters of leaves, 25 a call,
`{"i","e","y","b":"t|c|m","x":evidence,"c"}`, title-page claims still checked verbatim. Wikidata arms use no model:
the author's window [birth + 15, death] (capped at the edition), and the `work_id` item's P571/P577/P1191.

**Result (gold).**

| arm | work HIT high/med (CI) | n | median window | mean interval score | edition exact | out tokens / book |
|---|---|---:|---:|---:|---|---:|
| Sonnet lean@100 | 85.2% (81–89) | 297 | 2 y | 724 | – | ~30 |
| Sonnet lean@100 + work item where the windows meet | 85.5% (81–89) | 304 | 0 y | – | – | ~30 |
| Haiku lean@100 | 75.0% (70–80) | 288 | 6 y | 536 | – | ~150 (thinks at `--effort low`) |
| Gemini 3.8 Flash low lean@100 (agy) | 83.2% (79–87) | 316 | 2 y | – | – | – (marks 2 of 318 low; all rows 82.7%) |
| Gemini 3.8 Flash low lean edition@25 | – | – | – | – | 91.5% (85–95), title_page kept 109 (108 exact) | – |
| author lifespan only (no model) | 90.1% (86–93) | 262 | 50 y | 348 | – | 0 |
| Sonnet lean edition@25 (catalogue date withheld) | – | – | – | – | 90.0% (84–94), title_page kept 94/94 exact | ~60 |
| *first run: Sonnet b15, full prompt + leaves* | 85.4% (81–89) | 268 | 6 y | 824 | 93.8% | ~430 |

On the 56 gold works with no author dates (the residual a model must date unaided) lean Sonnet scores 37/46; the first
run's full prompts scored 32/44, 32/38 and 33/42 on the same books.

**Result (library, against the first run's 5,198 model-dated works).** The author's window excludes the model's year
on 641 of 3,791 works (17%), and reading them, the model is usually right: `author_id` names the translator or editor
(R. H. Charles → *1 Enoch*, James Legge → *Li Ki*, Thomas Taylor → *Orphic Hymns*, Burnouf → *Bhāgavata Purāṇa*), or the
work is pseudepigraphal (Geber → Jābir) or the author legendary (Vyasa, Homer). Where the window holds it is ~50 years
wide and would replace exact dates (*Principia* 1687 → 1657–1727). The `work_id` item disagrees by > 50 years on 52 of
276 (19%): `work_id` often names an edition item (Loeb *Iliad* P577 1973, a 1720 *Iliad*). With a ±25-year agreement
tolerance a neighbouring work's item wins (Kepler's *Apologia* 1622 → *Harmonices Mundi* 1619), so agreement means the
windows meet. Gold built from famous works under their real authors hides all of this.

Also found: Wikidata century precision for BCE years must map −400 to 400–301 BCE (a first fetch put it a century early).

**Replicated?** No.

**Artifact.** `scripts/lib/date-works.mjs` (`buildLeanPrompt`, `parseLeanReply`, `buildLeanEditionPrompt`,
`wikidataWork`, `authorWindowOf`, `catalogueWindow`), `scripts/maintenance/library-dating/wikidata-dates.mjs`; arms
under `/mnt/HC_Volume_105839809/jobs/library-dating-lean/lean/ref/` on Hetzner; #6721.
