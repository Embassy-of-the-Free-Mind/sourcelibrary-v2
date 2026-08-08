# Work identity & "do we have the original?"

**Read this when:** Reasoning about translation gaps, missing works, acquisitions at scale, or writing `books.work_id`.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

**Why this layer earns maintenance at all: `.claude/docs/identity-stack-rationale.md`**
(measured; the reader-facing failure, the compounding cost, and the case against).

**Start with the architecture map: `.claude/docs/translation-works-architecture.md`**
— it ties together work identity, the #2453 catalog, the translation gap/registry,
holdings, and first-translation into one stack (coordination home: #2567).

The **work** layer (sibling to the author thesaurus). "Is *this* translation a
work we also hold the source-language original of?" is answered by clustering
editions under a shared **`books.work_id`** (Wikidata QID or works-catalog id),
NOT by the `original_edition_id` link (which is half-filled). Umbrella: #2318.

- **CRITICAL invariant:** `text_role:'modern-translation'` does **not** mean we
  lack the original — it usually sits as a separate, *unlinked* book. **Never
  infer a gap from an unlinked translation.** Cluster by `work_id` and read
  coverage with `scripts/analysis/work-coverage.mjs`, which reports anything
  without a `work_id` as "unknown coverage," never a gap. (Inferring gaps the
  wrong way once claimed Plato/Zohar/Avicenna "missing" when we hold them.)
- **Assigning `work_id`** (the "fit" rule): author-anchor + title **containment**
  + **specificity** (reject generic stubs/containers like "Fragments"/"Muhūrta")
  + rare-token fallback for anonymous works. HIGH-confidence only is auto-written,
  always with a backup. Resolvers: `resolve-work-ids.mjs` (local `works` catalog —
  Sanskrit) and `resolve-work-ids-wikidata.mjs` (Wikidata P50 — Greek/Latin).
- **Merging fragmented work_ids (#3759):** `scripts/maintenance/merge-work-clusters.mjs`
  (run with `node --env-file`; it imports the canon registry). HIGH lanes — canon gold
  seeds + identical-title — auto-write with backup; the containment fit rule only ever
  QUEUES to `work_merge_queue` (status=pending, human review). Retired ids are kept on
  every edition in **`books.work_id_aliases`** (indexed); `/work/[id]` resolves an alias
  via `src/lib/work-alias.ts` and 307s to the survivor, so old URLs stay citable.
  Provenance log: `work_id_merges`. Two hazards the tool guards, don't relax them:
  ids SHARED between canon entries are combined volumes (Iliad+Odyssey), never merged;
  and a work_id whose books carry >1 distinct title is POLLUTED — its representative
  can't speak for it (the Ellis Yoruba/Tshi/Ewe case), so it is excluded from auto-merge.
  After any apply, run `node scripts/workers/sync-books-catalog.mjs` (books_catalog
  carries work_id).
- Full design, tool list, per-tradition candidate coverage, and open levers:
  **`.claude/docs/work-identity-coverage.md`**.
- **Acquiring works we're missing — read FIRST, don't reinvent:**
  **`.claude/docs/finding-missing-works-acquisition.md`**. TWO layers, don't conflate:
  **(1) our works system IS `books.work_id`** — ~99% coverage across ALL traditions
  (Chinese, Latin, Greek, Tibetan, Arabic…), USTC-independent; **(2) USTC is just ONE
  external universe** (continental print, 1450–1700) to diff against for *unheld* works,
  NOT our works system (use Wikidata P50 for what USTC misses). The "enumerate IA →
  title-cluster → diff → import" shortcut is a known trap — it over-reports gaps and
  re-imports works we hold (the divergent-title tail; our own Pymander is 35 editions
  across 12 work_ids). We are NOT thin on Latin — verify a gap before any "dump."
