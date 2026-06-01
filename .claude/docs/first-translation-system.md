# First-Translation Identification System

*Source of truth for "how do we decide a book is a first English translation, and how is that counted?" Last reconciled against live code + production data 2026-06-01. Sibling: `.claude/docs/author-identity-system.md`.*

**Related issues:** [#1974](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1974) (no automated setter for the flag — the central open gap) · [#2244](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2244) (backfill prior translations) · [#2332](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2332) (subsystem cleanup).

---

## 1. TL;DR — what to quote

- **Public "first translations" count = `is_first_translation:true ∧ visible:true ∧ pages_translated>0` ≈ 6,009** (2026-06-01). Do **not** quote raw `is_first_translation:true` (7,126 — includes hidden + untranslated).
- **Render gate = `is_first_translation && pages_translated > 0`** (`src/app/sitemap.ts:194`, `src/app/page.tsx:449`). The flag alone is a *bibliographic claim*, not "we have it readable." (CLAUDE.md "Visibility & Stats Invariants".)
- The count is **not** passively growing toward a larger number. Realizing more first translations requires a deliberate, reviewed batch (see §5, §6) — tracked in **#1974**.

## 2. The core mental model — flag vs. disposition

Two fields, written by different code, that can disagree. Understanding this is everything.

| | `is_first_translation` (boolean) | `translation_verification.disposition` (enum) |
|---|---|---|
| **Question it answers** | "Do we *claim* this is a first English translation?" (rendered / counted) | "What did catalog evidence conclude?" |
| **Written by** | enrichment (Phase 1.6), the 8-tool agent, reconcile/apply scripts | the nightly catalog crons, the 8-tool agent |
| **Values** | true / false / unset | confirmed_first · first_from_source · first_complete_translation · first_modern_translation · translation_found · needs_review |

Live drift: `is_first_translation:true` = 7,126 vs. `disposition=confirmed_first` = 7,909. They are **not** kept in lockstep by any recurring job (#1974, #2332).

## 3. Two verification engines (both live)

Confirmed by the `translation_verification.source` distribution: `catalog_search` 8,317 · `catalog_and_llm` 4,196 · `canonical_kanjur` 249 · `gemini_knowledge_lookup` 3.

### 3a. The 8-tool agent — `src/lib/verify-first-translation.ts` (`source: catalog_and_llm`) — BEST per-book method
A Gemini function-calling agent (≤10 rounds, `gemini-3.1-flash-lite`) that searches **seven** catalogs and then calls `make_determination`:
`search_local_catalogs` (Mongo `translation_catalogs`, ~12k scholarly records) · `search_open_library` · `search_google_books` · `search_internet_archive` · **`search_openalex`** (250M scholarly works — academic-press & journal translations) · **`search_loc`** (Library of Congress live) · `search_ustc` (verify the original work).
- OpenAlex + LoC are the recent additions that lift recall on academic-press translations (Brill/De Gruyter/OUP/CUP) the 3-catalog method misses.
- The model evaluates results for *semantic* relevance (not regex) and may only cite translations that appeared in tool results (no fabrication; unverifiable beliefs → `needs_review`).
- Writes **both** `is_first_translation` and `translation_verification` (couples them). `source: catalog_and_llm`, `stage: 2`.
- Invoked per-book by `cleanup-first-translation-claims.mjs` and `verify-istc-candidates.mjs` (run via `npx tsx`), and at pre-import candidate verification. **Not** on the nightly cron.

### 3b. The 3-catalog cron pipeline (`source: catalog_search`) — continuous backlog re-check
Two scripts, both flock-gated nightly on Hetzner. They write `disposition` only — **never the flag**.
- `enrichment/search-translation-evidence.mjs` (Stage 1) — OL + GB + IA + Gemini synthesis → evidence into `translation_verification`.
- `enrichment/validate-translation-evidence.mjs` (Stage 2) — Path A verifies catalog IDs resolve; Path B is an LLM knowledge check on no-result books → final `disposition`.

## 4. The five nightly Hetzner crons

Verified against live `crontab -l` on `root@46.224.122.120` (the committed `scripts/workers/crontab.production` is **stale** — see #2332 Task 0).

| Time (UTC) | Job | Command | Effect |
|---|---|---|---|
| 02:30 | ft-search | `search-translation-evidence.mjs --apply --limit 500` | Stage 1 evidence |
| 06:15 | ft-validate | `validate-translation-evidence.mjs --apply --limit 1000` | Stage 2 `disposition` |
| 03:40 | ft-audit | `audit-translation-claims.mjs --apply --limit 300 && apply-audit-verdicts.mjs --apply` | re-check `needs_review`, can flip flag |
| 04:40 | ft-discover | `discover-translations-estimate.mjs --save --limit 300 && apply-discovery-results.mjs --apply` | catch missed translations → flip true→false |
| 08:00 | ft-ground | `ft-ground-remediation.mjs --set unverified --limit 250` | grounded NOT-first **proposals** to `ft_reverify_proposal` (never the flag) |

**All five select books that are already flagged or already dispositioned.** None of them promote an *unflagged* book to `is_first_translation:true`. The apply-crons only ever flip the flag **true→false**. So the nightly pipeline can refine and *shrink* the count — never grow it.

## 5. How the flag is set / changed (and the #1974 gap)

1. **Origin — content enrichment, Phase 1.6** (`pipeline-orchestrator.mjs` → `src/lib/metadata-enrichment.ts:403`): on import, AI reads the book's own pages and sets `is_first_translation = (status ∈ {confirmed_first, likely_first})`. English → `not_applicable` → false. It cannot know about *external* prior translations. **Guarded by #2275:** it now DEFERS (won't overwrite the flag) when a catalog-grounded `source ∈ {catalog_search, catalog_and_llm, canonical_kanjur}` already exists. The content opinion is preserved in `ai_metadata.first_translation`.
2. **The 8-tool agent** (§3a) writes the flag directly — but only runs on books fed to it.
3. **`maintenance/reconcile-ft-from-catalog.mjs`** is the bridge from disposition → flag (A1: unset + catalog-says-no → **true**; A2/B → false). **It is NOT cronned.**
4. **apply-audit / apply-discovery crons** flip the flag, but in practice only downward.

**The gap (#1974):** nothing automatically promotes a never-assessed book into the FT pipeline. New non-ISTC imports may never get the flag; the ~1,981 non-English never-flagged readable books (see §7) sit invisible to all five crons. #1974 frames the fix: set-at-import via a shared `shouldFlagAsFirstTranslation()` helper, OR a periodic `--all-books` scanner cron, OR derive the flag at read-time from disposition.

## 6. Dispositions and the source-language rule

Set by `make_determination` (agent) or Stage 2 (cron). Live counts: `confirmed_first` 7,909 · `translation_found` 4,116 · `needs_review` 423 · `first_from_source` 66 · `first_complete_translation` 28 · `first_modern_translation` 14.

| Disposition | Meaning | Counts as first? |
|---|---|---|
| `confirmed_first` | No English translation of any kind found | yes |
| `first_from_source` | English exists from a *different* source language, not from THIS text (e.g. Greek→En exists, Latin→En doesn't) | yes |
| `first_complete_translation` | Only partials / excerpts / anthology selections exist | yes |
| `first_modern_translation` | Only old (pre-1900) translations exist | yes |
| `translation_found` | A complete modern English translation of THIS text exists | no |
| `needs_review` | Conflicting / inconclusive | no |

**Source-language rule (critical):** the claim is about *this specific text in its language*, not the underlying work. Ficino's Latin Iamblichus *De Mysteriis* is a first translation even though Taylor (1821) and Clarke (2003) translated the Greek original — a different-source-language translation does **not** count.

**Robust-verdict doctrine (#1974/#2271):** catalog identification is the only valid basis for declaring NOT-first (a prior translation is a *presence* fact that lives in catalogs). But Google Books has **recall failures** on famous non-Western works, so model memory is needed to catch those; catalog evidence catches memory's hallucinations on obscure works. The robust verdict is **catalog ∩ memory**; disagreements → human review. Declaring "first" from *absence* of evidence is the weak direction — never auto-promote to `true` on absence alone.

## 7. Coverage reality + the unflagged pool

- 67% of readable+visible books (10,273 / 15,320) have a disposition; **~5,047 unchecked — but only ~1 is flagged true**, so the nightly crons never reach them.
- That 5,047 = 1,213 English (non-candidates) + 2,810 enrichment-judged-`false` (1,852 non-English) + 2,236 never-flagged. **3,251 never got Stage-1 enrichment at all.**
- **Genuine uncounted-candidate pool ≈ 1,981 non-English, never-assessed readable books.**
- **Estimate (2026-06-01, real 8-tool agent, dry-run, n=40):** 75% returned a first disposition → ~1,486 projected. **But heavily caveated by non-Western catalog recall:** Tibetan 12/12 and Korean 2/2 came back `confirmed_first` only because OL/GB/IA/OpenAlex/LoC don't index those scripts — that's recall failure, not verification. Every *famous* work was correctly caught as `translation_found`. **Defensible promotable headroom ≈ +800–1,400** (the well-catalogued Western-language slice), lifting the public count toward ~7,000–7,400 — and only via a deliberate, reviewed `--unflagged search → validate → reconcile` batch (NOT the passive cron). Non-Western "firsts" need a different verification basis. Estimator: `scripts/enrichment/estimate-unflagged-agent.mjs` (dry-run, `npx tsx`).

## 8. The `translation_catalogs` collection

~12k records the agent's `search_local_catalogs` hits first (free, instant): UNESCO Index Translationum (~7.5k), Loeb, Brill, Penguin, CUA/Paulist, Godwin, HathiTrust. Schema: `source, author, author_normalized, english_title, original_title, translator, pub_year, publisher, series`. Harvested/aligned by `harvest-ft-into-translation-catalogs.mjs` + the USTC matcher; dedup-on-write.

## 9. Live numbers (2026-06-01)

| Metric | Count |
|---|---|
| `is_first_translation:true` (raw) | 7,126 |
| …`+ visible + pages_translated>0` (**quote this**) | **6,009** |
| Books with a `disposition` | 12,556 |
| Readable+visible total / checked / unchecked | 15,320 / 10,273 / 5,047 |
| Non-English never-flagged readable (candidate pool) | 1,981 |

## 10. Known limitations

1. **Absence ≠ proof.** `confirmed_first` means "no translation found in our tools," a strong signal but not certainty.
2. **Non-Western recall gap (empirically confirmed).** Tibetan, Korean, Egyptian, CJK scripts are poorly catalogued in OL/GB/IA/OpenAlex/LoC, so the method *defaults to "first"* on them — low confidence. Don't auto-promote non-Western confirmed_first; they need scholarly/alternative verification.
3. **`needs_review` from API failures** (e.g. GB 429) is noise, not genuine ambiguity — re-runnable.
4. **Multi-volume works** are assessed per volume.
5. **The flag is a claim.** Always require `pages_translated > 0` before rendering a badge.

## 11. Key files

| File | Role |
|---|---|
| `src/lib/verify-first-translation.ts` | 8-tool agent (best per-book verifier; writes flag + disposition) |
| `src/lib/metadata-enrichment.ts` | Phase 1.6 origin of the flag (content read), #2275-guarded |
| `scripts/enrichment/search-translation-evidence.mjs` | cron Stage 1 (evidence) |
| `scripts/enrichment/validate-translation-evidence.mjs` | cron Stage 2 (disposition) |
| `scripts/analysis/ft-ground-remediation.mjs` | grounded NOT-first proposals → `ft_reverify_proposal` |
| `scripts/maintenance/reconcile-ft-from-catalog.mjs` | disposition→flag bridge (NOT cronned) |
| `scripts/enrichment/cleanup-first-translation-claims.mjs` | run the agent on a batch (`npx tsx`) |
| `scripts/enrichment/estimate-unflagged-agent.mjs` | dry-run estimator for the unflagged pool |
| `pipeline-orchestrator.mjs` (Phase 1.6) | content classification + #2275 catalog-precedence guard |

## 12. Known debt → issues

- **#1974** — no automated setter for the flag (the central gap; §5). Includes the importer audit and the set-vs-scan-vs-derive decision.
- **#2244** — backfill prior translations (`translations_found`) via `discover-prior-translations.mjs`.
- **#2332** — subsystem cleanup: stale `crontab.production` (Task 0), archive genuinely-dead one-offs, the date-stamped schema fields (`*_2026_05_30`) that are now baked into live crons, a coverage metric, and flag↔disposition reconciliation.

## 13. Provenance

Reconciled 2026-06-01 by reading the live engines (`verify-first-translation.ts`, both cron scripts, orchestrator Phase 1.6), the live Hetzner crontab, and the recent handoffs (`2026-05-31-ft-1974-catalog-precedence-and-chip.md`, `2026-05-31-discover-prior-translations-2244.md`). Counts from live `bookstore` queries that day — re-verify if >14 days old. This rewrite replaced an earlier version whose architecture/numbers had drifted (it described a retired in-pipeline Phase 3.7 path).
