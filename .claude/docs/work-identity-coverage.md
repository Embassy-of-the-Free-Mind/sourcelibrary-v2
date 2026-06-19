# Work identity & original-vs-translation coverage

How we answer **"do we hold the source-language *original* of a work we have in
translation?"** — reliably, by query, instead of guessing. Umbrella: issue #2318
(work-level dedup / work identity). Sibling system: the **author** thesaurus
(`.claude/docs/author-identity-system.md`) — this is the **work** layer.

## The mistake this exists to prevent (2026-06-17)
`books.text_role = 'modern-translation'` does **NOT** mean we lack the original.
The original almost always sits in the catalog as a **separate, unlinked book**.
Inferring gaps from the half-filled `original_edition_id` link produced a badly
wrong gap list (claimed Plato, Aristotle, Zohar, Avicenna, the Greek Magical
Papyri, etc. "missing" when we hold them all in their source language). **Never
infer a gap from "we have a translation that isn't linked to an original."**
Cluster editions by a shared **`work_id`** and read coverage off the cluster.

## The data model
- **`books.work_id`** — a Wikidata QID (`Q200655`) or a works-catalog id
  (`catalog:pandit:108641`, or a bare BDRC/gretil id). The join key. Multiple of
  our books (originals + translations + editions) share one `work_id` = one work.
- **`books.work_title`**, **`work_id_source`** (`wikidata:P50` |
  `resolve-work-ids:author+title` | `coverage-demo` | …), **`work_id_confidence`**.
- `text_role` (original | period-translation | modern-translation) and
  `original_language` still matter — coverage reads them per cluster.

## How you know a book "fits" a work_id — the fit rule
Hardened over many spot-checked passes against real failures. **Author anchor is
the linchpin; a title match without author agreement is what burns you.**

1. ~~**External-id bridge** (deterministic).~~ **DEAD (verified 2026-06-19): 0
   books carry `openlibrary_work`/`oclc`/`lccn`.** The "~2.5k carry one" claim
   was wrong; this resolves nothing today.
2. **Author-anchored title match** — resolve `author_id` → canonical author →
   authority id, look **only** at works by that author (collapses ~10–80k
   candidates to a handful), then match the title. Requirements that earn a HIGH:
   - **Containment** — the work's canonical name sits *inside* the book title
     (book = an edition *of* that work). Rejects "Rāmāyaṇa" → "Adbhuta Rāmāyaṇa".
   - **Specificity** — the work is a real name, not a generic stub ("Muhūrta",
     "Gaṇita", "Fragments", "Opera") that many distinct works trivially contain.
   - **Strip the author's own name** from both sides before scoring — else every
     work snaps to a container that merely shares the author name.
3. **Distinctive-title fallback** for anonymous classics (Vedas, sutras) — a
   shared token counts only if it is **rare** in the candidate set (low document
   frequency), killing common words like "siddhānta"/"cintāmaṇi".
4. Everything else → LOW → **queued for review, never auto-written.**

**Only HIGH confidence is auto-written**, always with a backup in
`scripts/output/`. Full per-match evidence (author, similarity, containment) is
written to `/tmp/*proposals*.json`.

## The tools (all standalone scripts; `set -a; source .env.production.local; set +a`)
| Script | Does | PR |
|---|---|---|
| `scripts/analysis/work-coverage.mjs` | Clusters editions by `work_id`, reports BOTH / original-only / **CONFIRMED-gap** for work_id-keyed works; everything without a work_id is **"unknown coverage," never a gap**. `--backfill` writes `have_original`/`original_missing`. | #2536 |
| `scripts/analysis/resolve-work-ids.mjs --lang=sanskrit` | Author-anchored resolver against the local Supabase **`works`** catalog (Sanskrit/Chinese/Tibetan/Pali/Hebrew/Arabic-islamicate/Khmer). `--apply` writes HIGH. | #2539 |
| `scripts/analysis/resolve-work-ids-wikidata.mjs --lang=greek\|latin` | Author-anchored resolver against **Wikidata** directly (SPARQL P50) — for traditions the local catalog lacks (Greek, Latin). `--apply` writes HIGH. | #2545 |
| `scripts/maintenance/audit-language-mismatch.mjs` | Standing check: compares `ai_metadata.language` (the pipeline's content-read) to the catalog `language`; flags `language_review`. **Cronned weekly on Hetzner** (Sun 06:30). `--retag-english` retags English-detected-as-original. | #2529 |
| `scripts/maintenance/classify-language-mismatch-content.mjs` | Triages the non-English `language_review` queue by reading pages (stopword density); fixes only Latin/Greek-readable vernacular, leaves the rest. | #2534 |

## Candidate-source coverage (what each tradition can resolve against)
- **Sanskrit** — local `works` catalog (pandit/GRETIL/wikidata-sanskrit, romanized
  + authored + QID'd). **Works well.** ~103 linked, ~97%.
- **Greek, Latin** — **not in the local catalog at all** → Wikidata-direct. Works
  well for named classical authors. Greek 183, Latin 745 (~98%/~95%).
- **Pali** — local catalog is BDRC Cambodian manuscripts (Khmer script, no
  authors); Wikidata yields ~0 because the canon is **anonymous** (no P50). Needs
  a **title-direct** path, not author-anchored. *Open.*
- **Tibetan (30k) / Chinese (11k) / Hebrew / Arabic** — present in the local
  catalog but native-script titles vs our English-ish titles; low match value
  without transliteration. (Gemini *can* transliterate Khmer/Tibetan/Hanzi Pali
  accurately — demonstrated — so a transliterate-then-match path is feasible.)

## Current state (2026-06-18)
Reliable coverage **797 works** (52 both / 643 original-only / 102 confirmed gaps);
**10,076 works still "unknown"** (no work_id). Coverage of *what we hold* is
trustworthy; the **gap side still inherits `text_role` accuracy** — a source-
language original mistagged `modern-translation` shows as a false gap (e.g.
Āryabhaṭīya). Clean `text_role` before trusting the gap list.

## Open levers
- **Embedding clustering = candidate generator, NOT an auto-writer (tested to
  exhaustion 2026-06-19, #1634).** Reusing stored embeddings (`book_embeddings`
  ~36K; `page_translations` ~4.3M incl. the OCR tail embedded that day, 4%→96%
  labeled coverage) gives good cross-author *recall* (book-emb intra-work cos
  0.88 vs cross 0.73) but **no aggregation reaches a precision-first (~95%)
  within-author gate**: book mean-pool 62%, page mean-pool 70%, page max-pair
  47% (boilerplate — title pages / series headers / shared prefaces — makes
  *different* works by one author share max-cos=1.0 page pairs). So clustering
  is a **review-queue generator** (embeddings recall → title-anchor gate →
  human review), never blind auto-write. Tool:
  `scripts/analysis/cluster-works-by-embedding.mjs`. Title-anchor resolvers
  (#2539/#2545) stay the precision instrument. (The OCR embed was still worth
  it as an independent *search*-coverage win — 35.5K original-language pages
  now indexed.)
- ~~**Wire the external-id bridge** (OpenLibrary-work/OCLC).~~ DEAD (verified
  2026-06-19): 0 books carry `openlibrary_work`/`oclc`/`lccn`. The "~2.5k
  carry one" claim was wrong.
- **Title-direct path for Pali / anonymous works** (Tipiṭaka, Vedas, sutras).
- **Transliterate-then-match** for Tibetan/Chinese/Pali catalogs (Gemini).
- **`text_role` cleanup** so the gap side is as trustworthy as the covered side.
- Re-run resolvers periodically as `author_id`/catalog coverage grows.
