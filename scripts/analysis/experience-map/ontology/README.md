# The vocabulary of aliveness (#6720)

An ontology of aliveness for the experience-atlas site: 108 concepts (principles, doctrines, practices, states,
opposites) across five senses (feeling alive, the world as alive, made things as alive, the inhabited world,
prolonged life), 158 typed relations, the library's own terms for each, corpus counts by work date, and verbatim
passages. Output: `ontology.json` here, and `aliveness-ontology.html` for https://experience-atlas.vercel.app
(the site is not in this repo; deploy the built page from there).

Cost: $0. Mongo and Atlas Search read-only; judging by Claude subagents.

## Files

| file | what |
|---|---|
| `seed-nodes.json` | the concepts: kind, senses, tradition, era, gloss, original-script forms, the phrases counted. Hand-authored; glosses are scholarly background (claude-opus-5-5). |
| `seed-edges.json` | relations with a one-line background claim, optional `cue_from`/`cue_to` phrases for finding passages, and the descent `chains` the page shows |
| `measure.mjs` | `counts` (Atlas `$searchMeta` book facet per node), `passages` (verbatim candidate quotes from live books, spread by century), `edges` (pages naming both ends), `baseline` (the corpus by century), `verify` (re-reads every quoted page) |
| `terms.py` | alias candidates from the page-terms bridges (#4695); curated concepts come from `src/data/concept-aliases.json` |
| `packets.py` | cuts judge packets, eight slices |
| `JUDGING.md` | what the judges decide (terms by `.claude/docs/concept-aliases/JUDGE-RUBRIC.md`; passages; edges) |
| `verdicts/` | the judges' record; `edges-lead.jsonl` holds the session lead's overrides |
| `build.py` | writes `ontology.json` and the page |

## Rebuild

    E=/root/sourcelibrary/.env.production.local; export ONTO_OUT=$JOB_SCRATCH/ontology
    node --env-file=$E measure.mjs counts && node --env-file=$E measure.mjs passages && node --env-file=$E measure.mjs edges
    node --env-file=$E measure.mjs baseline
    python3 terms.py $ONTO_OUT && python3 packets.py $ONTO_OUT 8      # then judge (JUDGING.md) into verdicts/
    mkdir -p $ONTO_OUT/site && curl -sL https://experience-atlas.vercel.app/peace -o $ONTO_OUT/site/peace.html
    python3 build.py $ONTO_OUT $ONTO_OUT/site [--patch-nav]
    node --env-file=$E measure.mjs verify                              # exit 1 if any quote has left its page

`--patch-nav` adds the Vocabulary link to the other site pages present in the site directory.

## Things to know

- **Counts are phrase matches, and a node is only as precise as its phrases.** Broad ones (death, vigour, longevity,
  spiritus, Daoist, mana) count every use and are flagged `broad`. `lucene.standard` folds case, not accents, so
  accented and plain spellings are both listed. CJK phrases match per character: 氣 counts every page that prints it.
- **The book facet stops at 1,000 books.** Dates and traditions are computed over live books in that facet;
  `books_capped_at_1000` marks the nodes where the long tail is missing.
- **Work dates, not edition dates.** Every book is dated by `books.source_work_dates_meta.work.year` (schema 2, #6721),
  recorded as `work:<basis>`; the edition year stays beside it (`edition_year`, `by_century_edition`). A date is
  *sourced* when its basis is wikidata, author_lifespan, title_page or colophon, and each strip's caption gives the
  sourced share of its dated pages; the rest are model_knowledge. Re-date the existing measurements without
  re-querying Atlas with `measure.mjs redate` (keeps candidate order, which the verdicts index by), then
  `measure.mjs baseline` and `build.py`. The older chain (dated-works.jsonl, `source_work_dates`, edition year) is
  only a fallback for a book without a schema-2 date.
- **Earliest/latest attestation is fragile** (a modern editor's note in an edition of Homer dates "archeus" to
  800 BCE). The page shows the span holding 90% of dated pages and the peak century; `first`/`last` stay in the JSON
  with that caveat.
- **Every strip leans to the 16th–17th centuries partly because the library does.** `baseline` is the denominator,
  shown at the top of the page.
- **An edge is `passage` only if a judge found one page that states it.** Co-occurrence alone never counts. The
  rest are `background`, with the claim and the model named.
