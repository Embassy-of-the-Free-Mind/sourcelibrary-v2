# /learn/maya: item bank and judgements

PRIOR ART: src/app/api/learn/route.ts (quiz questions built at request time, no stored answer key) and the review queues' `volunteer_ratings` table (Supabase; rows keyed on a client-sent volunteer id, no answer or try). Neither stores an item with its evidence, a learner's attempt, or a gold flag, so this is two new Mongo collections. Looked in `.claude/docs/`, `scripts/eval/INDEX.md`, `src/lib/review-queue.ts`.

**Read this when:** changing `/learn/maya`, its API (`src/app/api/learn/maya/*`), `build-maya-items.mjs`, or anything that reads `learn_maya_items` / `learn_maya_judgements` (#6921).

## Who it is for

A learner who reads no Maya, on a phone, 10–20 minutes at a time; and an occasional expert (an epigrapher) arriving from a link. Every item is a real crop of the Dresden Codex or a real word in a colonial Yucatec text. The learner tries first, then sees the AI's reading and the evidence, then judges the reading. Those judgements are the data that tell us where the AI is right.

## `learn_maya_items`

One document per item, `_id` stable (`num-41-pos-L1`, `day-32-day-g4-3`, `word-zac`). Written only by `build-maya-items.mjs` (dry run by default, `--apply` upserts) from `maya-item-sources.json`, plus the expert route's `review`/`gold` update.

```
node --env-file=.env.production.local scripts/learn/build-maya-items.mjs [--apply] [--out=items.json]
```

| field | meaning |
|---|---|
| `rung` | `numeral` · `day-sign` · `word` (glyph captions become a fourth rung once #6903 reports; see `RUNGS` in `src/lib/learn-maya.ts`) |
| `status` | `live` (in rotation) · `heldout` (the 10-item check only, never revealed) · `retired` |
| `order` | teaching order inside the rung (numerals: dots-only first, red and zero later) |
| `prompt` | `{ kind: count \| pick \| gloss, text, options? }` (`options` = the sign + 3 day signs chosen deterministically from the id) |
| `image` | numeral/day sign: `{ book_id, leaf, codex_page, src, box:[x,y,w,h] normalised on the full leaf, color }`, served through `/api/crop-image` |
| `word` | `{ headword, form (as spelled in the line), source: { book_id, page_number, title, line (verbatim page text), url } }` |
| `answer` | numeral `{ value }` (what is PAINTED); day sign `{ sign, coefficient, position }`; word `{ gloss_es (verbatim dictionary OCR), gloss_en (verbatim from the dictionary page's translation), keywords, number }` |
| `note` | teaching note, e.g. a scribal slip Förstemann corrects |
| `ai` | `{ reading, confident, model, run }`: numerals and day signs are Opus arm B of `dresden-opus-test` (#6559); words are the site's translation of the dictionary page |
| `evidence[]` | `{ kind: leaf \| forstemann \| dictionary \| source, label, url, text? }`, page-linked `https://sourcelibrary.org/book/<id>?page=N` |
| `gold` | `{ is_gold, basis, checked_by_eye }`. Numerals and day signs are gold at build (Förstemann's value or the table arithmetic, every crop checked by eye). Words start not gold; an expert "AI is right" makes an item gold, "AI is wrong" removes gold |
| `links` | `word_id` (numeral/day sign → its Yucatec word), `numeral_ids` / `day_sign_ids` (word → crops showing it), `glyph_sign` |
| `review` | the last expert verdict `{ verdict, correction, note, by (user id), at }` |
| `provenance` | `{ builder, issue, built_at }` |

**Rules the builder enforces:** a gloss is taken from the dictionary page's own text (OCR line and its translation line), never written by hand or by a model; a source line must occur verbatim in that page's text as the reader shows it (tags stripped), or the item is refused. A numeral's `value` is what is painted; where the scribe erred, `note` says so and gives Förstemann's correction.

**Adding items:** measure the box on the leaf, render it and look at it before adding it to `maya-item-sources.json` (a crop that shows a neighbour's dot teaches the wrong number). Day signs need Förstemann's identification for that slot.

Phase 1 bank (2026-10-18): 53 numerals (leaves 27, 32, 41 = codex 48, 53, 62), 36 day signs (leaves 9, 32 = codex 9c, 53), 54 words (Pío Pérez and Motul vol. 1; lines from the Chumayel, the 1913 Chumayel facsimile and a Caste War letter). Ten held out.

## `learn_maya_judgements`

Signed-in learners only, and the learner is the session's user id (`src/app/api/learn/maya/judgements/route.ts`); a client-sent id is ignored. Signed-out learners keep their progress in `localStorage` (`sl-learn-maya-v1`) and send nothing, matching the review queues' 2026-08-05 decision (`src/lib/volunteer-id.ts`).

| field | meaning |
|---|---|
| `kind` | `judgement` (one item) · `check` (one held-out check) |
| `item_id`, `rung` | the item judged |
| `learner` | `{ kind: 'user', id }` |
| `tier` | `learner` · `expert` |
| `answer`, `correct` | the learner's try and whether it matched the key |
| `verdict` | `agree` · `disagree` · `unsure` (on the AI reading) |
| `correction` | optional free text, ≤500 chars. **Untrusted input**: shown as text in the expert queue, never acted on |
| `items_seen` | how many items the learner had done, i.e. their level when judging |
| `score`, `total`, `answers[]` | for `check` |
| `created_at` | time |

Nothing here is public. The expert queue (`/learn/maya/expert`, `withInnerCircleAuth`, grantable through a `memberships` row so an outside epigrapher needs no editor role) shows learners as counts only. An item is queued when a learner disagrees or two are unsure, and no expert has ruled since (`needsExpert`).

## Who reads these

No cron or worker reads either collection today. When the #6903 harness starts re-scoring the AI on gold items, it will read `learn_maya_items` where `gold.is_gold`; an expert's verdict then changes what the AI is scored against.

## Extension point: glyph captions (#6903)

The next rung is `glyph` (add it to `RUNGS` in `src/lib/learn-maya.ts`; the page needs no new screen, since a glyph block is an `image` item with a `pick` or `gloss` prompt). #6903 measured the AI side as weak there: Opus read 0 of 55 unseen blocks (it said "unread" honestly); Gemini 4 Argon read about 31% exactly but was confidently wrong on about 20 of 64. So for this rung:

- show the AI's guess as its reading, and keep its measured accuracy off the page; use it to route items to the expert queue (an item from a weak arm goes to the queue on the first learner dispute, or before any);
- published readings (e.g. Vail & Hernández) are private answer keys only: never shown, quoted or stored in `learn_maya_items`;
- gold for a glyph item comes from an expert verdict, not from the build.
