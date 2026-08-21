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

## Wikidata QIDs: verify every one, and never gate authors on `P31 = Q5`

**Never accept a QID from recall or a bare search hit (#3742/#3766, 2026-08-08).** Guessing produced *Good Will Hunting* for Anacreon; `wbsearchentities` ranks the Cherubini opera above the poet. Two anchors were already wrong in production: `authors/sextus` → `Q1270100`, the *Sentences of Sextus* (a **text** used as a person, four visible books), and `authors/longinus` → `Q436634`, Cassius Longinus — the Neoplatonist to whom *On the Sublime* was wrongly ascribed rather than its author.

- **Works: check `P31` is a work class, NOT `Q3331189` ("version, edition, or translation").** Wikidata routinely carries a work and its editions under the same `P50` and the *same English label* — Polybius has three items labelled "The Histories". `resolve-work-ids-wikidata.mjs` had no such filter, containment tied all three at 1.00, and the tie-break kept whichever row SPARQL returned first: the same book resolved to `Q250816` or `Q53748127` depending on row order, **at HIGH confidence, auto-applied**. Fixed in #3766; ties now demote instead of guessing.
- **Authors: use a DENYLIST (`scripts/lib/author-anchor-classes.mjs`), never `P31 = Q5`.** Demanding "human" flags 38 anchors here and most are correct — Homer (`Q21070568`, "human whose existence is disputed"), Hermes Trismegistus (pseudonym/epithet), Orpheus, Enoch, Vyāsa, the Sibyl, Chiron. **Attributed and legendary authorship is what this corpus is largely made of**; gating on Q5 would silently skip its core. Deny only disambiguation pages and work classes. Standing sweep: `scripts/audit/author-anchor-validity.mjs` (20 bad anchors; worst is `mao-yuanyi-compiler`, 105 books pointed at the *Wubei Zhi* itself). It cannot catch "right class, wrong person" — the Cassius Longinus case passes and always will.
- **A wrong anchor fails SILENTLY.** `P50` of a text returns no works, and the run prints `HIGH 0` — identical to a clean empty result. Same for a SPARQL 502/429, which is why failures are now reported and `--apply` refuses on an incomplete fetch.
- **The resolver is author-anchored and near-exhausted** (683 books; a full Latin re-run yielded 0 new HIGH). Where Wikidata models an author at *fragment* granularity — Sappho has ~208 items like "Sappho fr. 174 Voigt" against our whole-corpus editions — it safely returns NO-MATCH rather than mis-matching, so hand-adjudicate those. The leverage is upstream in `author_id` coverage, not in the matcher.
