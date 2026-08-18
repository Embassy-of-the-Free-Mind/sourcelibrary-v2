# Artwork → book linking: state, and what the next session should do

**Issue:** #4037. **Merged so far:** #4036, #4038 (canonical artwork URLs), #4041
(invariants), #4042 (slug transliteration), #4045 (deploy purge gate), #4047
(error-reporter loop). **Open:** #4050 — resolver + review queue, checks green.

## Where the work stands

`scripts/lib/artwork-work-resolver.mjs` resolves a name written by artwork
enrichment to a book or an author. `scripts/artwork-links/build-review-queue.mjs`
runs it over the corpus and writes a queue to `scripts/output/` (gitignored,
~11MB). **Nothing is written to Mongo.** A resolved link renders as "read the
full text with translation" — a public claim — so the write path is deliberately
unbuilt until a human has read a slice of the queue.

Run: `node --env-file=.env.production.local scripts/artwork-links/build-review-queue.mjs`

Current result over 12,513 visible artworks / 15,190 references:

| | |
|---|---|
| artworks with a **book** link | 1,946 (1,787 readable) |
| artworks with an **author** link | 8,343 |
| unresolved | 2,224 |
| links to hidden books | 189 — flagged do-not-ship |
| links to held-but-unprocessed books | 17 |

## Does this need LLMs? Mostly NO — measured 2026-08-19

The instinct is to reach for embeddings or a model. The corpus says the cheaper
layers are not exhausted yet:

- **`work_id` is NOT a shared external identity layer.** 76,194 books carry one,
  but only **1,334 are Wikidata QIDs**; 61,531 are `local-synthetic` and 13,249
  "other". It groups our own editions of one work — useful for picking the best
  edition to link to, useless for cross-lingual aliases.
- **Authors ARE externally anchored: 4,586 have `wikidata_id`.** That is a real
  hook for multilingual name forms.
- **But `authors.aliases[]` is empty on ALL 6,291 entries.** Nobody has pulled
  the labels/aliases the QIDs already entitle us to. That is a fetch, not a model.
- **Only 3,107 of 24,912 artworks carry `author_id`.** Person references are
  being matched by string when an identity join is available for a fraction of
  them and backfillable for the rest.

So the ladder, cheapest first:

1. **Backfill `authors.aliases[]` from the 4,586 Wikidata ids.** Deterministic,
   verifiable, and directly raises recall on person references (the largest
   bucket — 8,343 artworks). Verify each QID's `P31` before trusting it
   (human vs work vs edition) — see `lesson_verify_every_wikidata_qid`.
2. **Backfill artwork `author_id`** so person links resolve by identity.
3. **Wikidata QIDs for WORKS**, obtained by title+author lookup. This is what
   fixes "Golden Legend" ↔ "Legenda aurea" — a title-alias problem no amount of
   string normalisation solves. Deterministic lookup, human-reviewed.
4. **Embeddings** (`book_embeddings` in Supabase, see `.claude/docs/embeddings.md`)
   as a fuzzy middle tier before any model — semantic title similarity, no
   generation, no fabrication risk.
5. **An LLM ONLY for the ambiguous tail**, and only producing citations into a
   review queue. The tail is genuinely judgement: is "Book of Revelation" a link
   to our Vulgate? "Islamic Geometric Patterns", "Gregorian Chant" and "Tarot de
   Marseille" are references to *traditions*, not books, and should resolve to
   nothing. Repo precedent says do not skip verification here — 12.2% fabrication
   in the note-quality eval (#3308), and FT claims needed independent agents.

**Do not start at step 5.** Steps 1–2 are a day's work and move the biggest bucket.

## The four defects already found (all pinned by tests)

Each produced a plausible-looking WRONG link, and each was caught by reading the
sample rather than by anything failing:

1. Person name resolving as a work — "Marsilio Ficino" prefix-matched the book
   *Marsilio Ficino Epistolae*, aiming all 2,047 Ficino refs at one volume.
2. Name-form variation — catalogue "Pico della Mirandola, Giovanni" vs
   enrichment "Pico della Mirandola" missed, then fell through to *Opera Omnia*.
3. Generic titles crossing authors — *Opera Omnia*; and "Ovid, Metamorphoses"
   could land on Apuleius' *Metamorphoseon Libri XI*.
4. "Author, Work" read as a person — "Raphael, Transfiguration" matched a book
   by "Götz, Raphael".

**The lesson to carry:** every one was found by reading actual rows. Aggregate
counts looked fine throughout. Read the queue before trusting any number in it.

## Next concrete steps

1. Merge #4050 (green).
2. Read ~50 rows of the queue, both `kind: work` and `kind: author`. Reject rate
   is the number that decides whether a write path is safe.
3. Steps 1–2 of the ladder above.
4. THEN a write path: augment `enrichment.cross_references[]` in place (no new
   top-level field on `books` — see `field-sprawl.md`), with `source_book`
   reserved for hard provenance only.
5. Separately: the hard-provenance channel — Deutsche Fotothek's `aus:` field
   names the source book AND printed page in the Commons wikitext, and MS
   shelfmarks identify manuscripts. That channel is what links the
   *Aurora consurgens* ouroboros folio to the manuscript we hold complete
   (`/book/zurich-zentralbibliothek-ms-rh-172-aquinas`, page 45).

## Unrelated things this session surfaced, not yet acted on

- `/api/presence/count` is now the top source of 504s (9,108/hour measured).
- `authorSlug()` still deletes æ/œ/ß/ø/þ/ð/ł the way `slugifyText` no longer
  does — but it is computed live, so changing it rewrites existing `/author/`
  URLs and needs the canonical-redirect map regenerated.
- 33 files build slugs with their own regex instead of importing `slugify.ts`;
  most are in `scripts/import/`, where a bad slug becomes a permanent URL.
- 22,767 books with >20pp OCR have no `visible` field at all — intentional QA
  gate or drift is undetermined, and nobody can currently tell.
