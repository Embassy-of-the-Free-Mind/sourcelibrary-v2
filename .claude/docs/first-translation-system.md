# First-Translation Identification System

*Source of truth for "how do we decide a book is a first English translation, and how is that counted?" Last reconciled against live code + production data 2026-06-01. Sibling: `.claude/docs/author-identity-system.md`.*

> ## ⚠️ 2026-09-01 — the book-grain machinery this document describes is RETIRED (#4536)
>
> The nightly derive→reconcile actuators are off and their scripts deleted
> (`derive-ft-verdict-from-attempts.ts`, `reconcile-first-translation-flag.ts`,
> `derive-from-evidence.ts`). `books.is_first_translation` is frozen except
> through the **Translation Card** (`work_translation_history`) review process —
> see `.claude/docs/translation-card-method.md`. Read what follows as history of
> how the stored verdicts were produced, not as the live mechanism.

> ## ⚠️ 2026-08-01 — read [`first-translation-reference-set.md`](./first-translation-reference-set.md) before trusting any absence claim here
>
> An **evidence layer beneath this whole document** shipped in PR #3463 (#3459),
> after everything below was written. It replaces the unprovable assertion with a
> recorded, dated, reproducible **search** (`search_efforts`), and — crucially —
> it *measures* what that search is worth. The headline:
>
> - **Catalogue recall is 32.1%** (2026-08-07, after adding ESTC; 22% → 27% → 32.1%).
>   **Two of every three** known prior English translations are still invisible to
>   the reference set. **`none_found` is weak evidence and no count built on it
>   should be quoted.** Positive findings are unaffected.
> - A sample of the queue puts `none_found`'s **positive predictive value at ~50%**.
> - The cause is corpus, not matching, and ESTC (#3522, merged) bought +5.1 points —
>   but it covers imprints **1473–1800** while 80.8% of this corpus's known
>   Latin/Greek priors are post-1950 imprints, so the remaining loss sits in modern
>   scholarly publishing that no early-modern catalogue can reach. **Do not read the
>   gain as the problem receding.** (The old "the extract is 1.04% pre-1800" line was
>   retracted as a false diagnosis — see the reference-set doc §2b/§2c.)
>
> Any statement in this doc of the form "N books are first translations" or "N have
> no prior" was written without that measurement and should be re-derived. The
> verdict model, the badge, and the writer topology below remain accurate.

> **Scaling verification across the whole corpus (tiered census methodology — models, prompts, tools, cost, the ~5,000 estimate): [`first-translation-census-methodology.md`](./first-translation-census-methodology.md).**

**Related issues:** [#2567](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2567) (cluster map / tracking) · [#1974](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1974) (no automated setter — central gap) · [#2352](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2352) (work-keyed translation index) · [#2564](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2564) (measurement + effort-routing + single-writer) · [#2264](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2264) (work resolver) · [#2453](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2453) (works catalog) · [#2244](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2244) (backfill) · [#2332](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2332) (subsystem cleanup).

> **Refreshed 2026-06-19** with the First Principle (below), §0 (re-pinned numbers + skeptical findings), §14 (eval & validation), §15 (writer sprawl), §16 (architecture cluster), §17 (process invariant). The §1/§9 numbers are the 2026-06-01 reconciliation and have drifted — **§0 supersedes them.**

> **⚠️ Successor system in flight ([#2564](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/2564), PR #2573 — not yet merged).** This doc describes the *2026-06-01* engines (8-tool agent + 3-catalog cron + the boolean flag). The #2564 rebuild replaces the loose `disposition` with a **graded verdict model** (`src/lib/first-translation/`: `types.ts`, `derive.ts`, `attempt-log.ts`) where `is_first_translation` becomes a *single-writer derived read* of the verdict, plus a cheap grounded **Gemini enumeration instrument** (`scripts/eval/ft-gemini-adjudicate.mjs`) and an append-only **`first_translation_attempts`** evidence log. Until #2573 merges, treat §2–§8 below as the live system and the rebuild as the target. The instrument→sinks write contract (Mongo verdict + attempts log + Supabase `translation_catalogs`) is specced in **[ft-enumeration-three-sink-spec.md](./ft-enumeration-three-sink-spec.md)**; the human review/audit layer in **[ft-gold-annotator-brief.md](./ft-gold-annotator-brief.md)**; the write-up in **[ft-first-translation-paper.md](./ft-first-translation-paper.md)**. **(See the 2026-06-29 update below — the rebuild's data model AND an evidence-first loop have since MERGED; the single-writer/cascade/headline-switch have NOT. Read that before trusting §2–§8 as current.)**

---

## Update 2026-07-02 — first corpus-wide derive ran; guards fixed; execution checklist opened (#2933)

The ledger→verdict derivation (`derive-ft-verdict-from-attempts.ts`) ran corpus-wide for the first time. What happened and what it changed:

- **Two false-promote leaks found + fixed (PR #2932).** The unguarded run would have "evidence-backed" promoted **1,349** books incl. the Book of Kells facsimile and *Religio Medici*: (a) the backfill's mid-notes `status=not_applicable` form escaped `isNotApplicable`, so "original English work, FT doesn't apply" rows counted as absence votes; (b) `result:none` rows with NO recorded `sources_checked`/`queries` counted as absence votes and faked cross-family independence. Absence votes now require recorded search coverage. Post-fix: derivable verdicts 10,531 → 2,314; gate-passing promotes 1,349 → **36**; demotes 186 (unchanged — positive sightings).
- **2,314 graded verdicts are now materialized** on `books.first_translation` (an interim unguarded apply of 10,531 was fully reverted; 0 value drift on survivors). Public boolean untouched.
- **The 186-demote diff decomposes** (worksheet: `scripts/output/ft-demote-worksheet-2026-07-02.json`): 16 already Tier-2-confirmed (apply-ready) · 11 already Tier-2-REFUTED yet re-proposed (the refute-precedence gap — a higher-tier refute must beat an older "found" row; incl. De Voluptate) · 30 pre-1900-only priors + 47 partial/unknown-completeness priors (the verdict-grading collapse — derive maps any trustworthy found → `not_first`, contradicting §6's `first_modern`/`first_complete`) · **83 genuine modern-complete-prior candidates → ft-verify (Claude subagents) in progress**. Early rounds show the June pattern holding: Stage-1 "high-confidence" priors failing verification as partial / fabricated / wrong-source-language.
- **The nightly FT machinery is fully dormant**: ft-search/ft-validate `#PAUSED-GEMINI`; ft-audit, ft-discover, ft-ground all run with **0 eligible books** (scopes exhausted). §4's table describes crons that no longer do work.
- **~8,461 of the ledger's 28,200 book_ids are orphans** (match neither `books.id` nor `_id`; 42 in `deleted_books`) — read "books with durable evidence" as ~19,700.
- **All remaining wiring + retirement work is consolidated in issue #2933** (derive gaps A1/A2, promote eligibility gate, cron the derive+reconcile, retire dead crons + `reconcile-ft-from-catalog.mjs`, orphan tagging, dated-fields sweep, `isPublicFirst` headline decision).

## Update 2026-06-29 — evidence-first loop SHIPPED; what's live vs still aspirational

The #2564 rebuild's graded-verdict **data model is merged and an evidence-first loop now runs** — but the single-writer reconcile, the tier cascade, and the public-count switch are **still not wired**. Be precise about live-vs-target so you don't trust the wrong thing (the rest of this doc still describes the *designed* system in places, not the *wired* one).

**Now LIVE (merged):**
- The graded-verdict model (`src/lib/first-translation/`: `types.ts`, `derive.ts`, `attempt-log.ts`, `prior-evidence.ts`, `ft-prior-guard.ts`) — real and used.
- An evidence-first loop in four PRs — *keep → record → read → derive*:
  - **#2865** — the nightly grounded producers (`ft-ground-remediation`, `audit-translation-claims`, `discover-translations-estimate`) now **append** their search to `first_translation_attempts` instead of discarding it (the ledger was a frozen one-time backfill before).
  - **#2866** — the registry matcher (`ft-catalog-match.mjs --apply`) **records** guard-passing matches against our own `translation_catalogs` as found-prior attempts.
  - **#2868** — producers **read** the ledger before spending (skip a paid search when a trustworthy prior is already on record).
  - **#2871** — `derive-ft-verdict-from-attempts.ts` turns the accumulated ledger **into** a graded verdict (verdict = f(evidence)), hardened against two real legacy-backfill failure modes (studies miscounted as priors → false demotes; `not_applicable` collapsed into absence → false promotes).

**Still NOT wired (target, not reality — do not trust as done):**
- **The "single-writer reconcile" now RUNS NIGHTLY — unattended.** (This bullet previously claimed "on no cron"; that was stale.) The 05:30 Hetzner cron (`scripts/workers/crontab.production` line ~97) runs `derive-ft-verdict-from-attempts.ts --apply` then `reconcile-first-translation-flag.ts --apply --only-demotions --verdict=not_first,not_applicable --resolver=tier2_agent,human` — it derives verdicts from the attempts ledger and applies verified **demotions** with no human in the loop. Standing warning: writing evidence rows to `first_translation_attempts` is **actuation, not recording** — the next 05:30 run will act on them (exactly this consumed same-day evidence rows and removed 3 public badges in incident #3776). The other writers of `is_first_translation` are still Phase 1.6 enrichment + the nightly apply-crons (`apply-audit-verdicts`, `apply-discovery-results`). The writer sprawl (§15) #2564 set out to kill is still live.
- **The tier cascade (`resolve.ts`) is unwired** — no production caller. `derive-ft-verdict-from-attempts.ts` is the closest live thing, run manually, **verdict-only** (writes `book.first_translation`, never the boolean flag; gated on sign-off).
- **`isPublicFirst` is defined but unused** — the public count is still raw `is_first_translation`.
- **No measured accuracy yet.** The eval is still the spine gap (§14); a non-circular harness is tracked in **#2876**.

**The honest three numbers (2026-06-29):**
- **~5,818** — currently badged public (`is_first_translation ∧ visible ∧ pages_translated>0`). Mostly **weak legacy** evidence.
- **~6,283** — what the headline becomes if the ledger-derived verdicts are applied + reconciled (net **+466** evidence-backed firsts the legacy pipeline missed, **−1** over-claim).
- **~3,033** — the **defensible** count (`isPublicFirst`): badges resting on non-weak (actually verified) evidence. The gap from 6,283 is *unverified*, not necessarily wrong (a big slice is the non-Western catalog-blind pool).

**Gemini proposes, Claude disposes.** The cheap nightly engine is Gemini flash-lite (Google-Search-grounded; ~63% fabrication on "prior exists" → a proposer, untrustworthy alone). The trustworthy check is an **independent Claude Sonnet subagent** (agentic WebSearch/WebFetch, ~57k tokens/book, adversarial refute-framing) — a *different model family*, so a prior one fabricates the other catches. Never settle a public flip on Gemini alone. A 7-book Tier-2 test (2026-06-29) found only **~2/7** "moderate" Gemini-only promote candidates survive as clean firsts — the cheap grade over-counts ~3×.

Forward design + measurement: **#2876** (eval harness), **#2567** (cluster).

---

## First principle — a claim's strength must equal its verification

Everything in this system derives from one **asymmetry**: *"a prior English translation exists"* is settled by **one confirmed sighting** (a resolvable catalog record — monotonic, cheap, high-precision), whereas *"no prior exists"* is a claim about the **absence of evidence** — never absolute, only ever as strong as the breadth + documentation of the search ("first, as far as we looked, as of this date"). The whole architecture is consequences of this, not independent choices:

- **A positive ("found") may be trusted only when the sighting is *real*** — not a self-match (prior = the book's own record), not an anthology/study, same source-language, complete-not-partial, person-disambiguated author. A *fake* found is the failure mode (§17). The guards are just "confirm the sighting is real," made executable.
- **A negative ("first") is earned, not asserted** — its strength = documented search coverage: the effort tiers, the append-only attempt-log, and the bounded "none found in [sources] as of [date]." It is never "first, period."
- **The pieces interlock under one rule:** the registry accumulates *verified positives* (the flywheel + the #1974 setter); the effort tiers spend verification proportional to difficulty (and the tier that resolves a book *is* its confidence); stratified sampling buys a corpus claim with a bounded amount of verification and lets the CI carry the residual (and you must measure the measurer); the single-writer derivation is safe **exactly when its source is verified and dangerous exactly when it isn't.**

**Every first-translation error we've hit is the same error — a claim asserted beyond its verification:** the 155-book sweep trusted single-pass grounding-*absence* as a verified negative; the 125-conflict signal trusted a noisy script's *positives*; the 39-demotion trusted the disposition's *unverified positives* (and silently demoted a verified first — §17). 

**The standing test for any change to this system:** *does the strength of what we assert match the verification we actually did — in both directions?* (Don't over-claim a "first" from a blind search; don't over-trust a "found" from an unverified match. Mass-restore is as dangerous as mass-demote.)

## 0. Update 2026-06-19 — re-pinned numbers + skeptical findings

⚠️ The §1/§9 numbers are the 2026-06-01 reconciliation and have drifted. Live re-pin:

| Metric | 2026-06-01 | 2026-06-19 |
|---|---|---|
| `is_first_translation:true` (raw) | 7,126 | **6,908** |
| public (`+visible +pages_translated>0`) | 6,009 | **5,732** |
| `disposition=confirmed_first` | 7,909 | **7,668** |

**Stop quoting ~6,000 — it's 5,732 and falling** (crons only flip true→false). Four findings from a skeptical re-audit:

1. **The public count rests on the WEAK path.** By `source`: `catalog_search` ≈ 5,725; the "BEST" 8-tool agent (`catalog_and_llm`) appears on **~0** of the 5,732 public firsts. They were originated by content-enrichment (Phase 1.6, reading the book's own pages — structurally blind to *external* prior translations). The rigorous verifier has touched almost none of what we publicly badge.
2. **~⅓ is unverifiable by design.** 1,888 / 5,732 (33%) public firsts are non-Western (Tibetan 830, Chinese 442, Hebrew 163, Sanskrit 126…) where catalogs don't index → `confirmed_first` *defaults* (recall failure, not verification). Proven false-firsts here: Milarepa (Quintman 2010), Padmasambhava (Padmakara 1993). Treat as a distinct **"unverified — no catalog coverage"** class, not headline firsts.
3. **38 internal contradictions** (public firsts with `disposition: translation_found` yet still badged) + 124 `needs_review`. ⚠️ **Not** demote-on-sight (an earlier claim, now retracted): `translation_found` is itself a fallible match. The *Arithmologia* appears here matched to Godwin's *anthology* (a verified first that must NOT be demoted), alongside self-matches (book → its own catalog record) and source-language false matches (Latin *Timaeus* → a Greek-sourced English translation). They're a **hard-case benchmark**, not a no-oracle demote list (see #2564). Distinct from the noisier 173/125 `first_translation_conflict` signal from the secondary `discover-prior-translations.mjs`.
4. **Matching/reconcile failure, not a seeding gap.** `translation_catalogs` already holds Loeb (466) + the classics (Seneca 489, Caesar 357, Virgil 794, Pliny 266) — yet those books are still badged first. We hold the answer and don't match/reconcile it → measure **internal-match recall** (§14) before adding any source.

Forward design + cluster map: **#2567**. Eval + validator: §14. Writer sprawl: §15. Cluster: §16.

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

Verified against live `crontab -l` on `root@46.224.122.120`. The committed `scripts/workers/crontab.production` is a *derived snapshot* kept fresh by PR; a drift detector (`scripts/workers/sync-crontab.sh`, daily 04:00) logs if it diverges from live (#2332 Task 0 / #2342). **The live crontab is the source of truth.**

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

- 67% of readable+visible books (10,273 / 15,320) have a disposition; **~5,047 unchecked — but only ~1 is flagged true**, so the nightly crons never reach them. This ratio is now surfaced as `system_config.homepage_stats.verification_coverage` (`{ checked, readable, pct }`), refreshed by `prewarm-browse.mjs` / `update-homepage-stats.mjs` (#2332 Task 3 / #2344).
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
| Verification coverage (checked / readable) | 67.1% |
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
| `scripts/maintenance/{prewarm-browse,update-homepage-stats}.mjs` | write `homepage_stats.verification_coverage` (#2332 Task 3) |
| `pipeline-orchestrator.mjs` (Phase 1.6) | content classification + #2275 catalog-precedence guard |

## 12. Known debt → issues

- **#1974** — no automated setter for the flag (the central gap; §5). Includes the importer audit and the set-vs-scan-vs-derive decision. The "promote unflagged candidates" work (former #2332 Tasks 4 & 5) lives here.
- **#2244** — backfill prior translations (`translations_found`) via `discover-prior-translations.mjs`.
- **#2332** — subsystem cleanup: stale `crontab.production` (Task 0, done — #2342), archive genuinely-dead one-offs (Task 1, #2346), the date-stamped schema fields (`*_2026_05_30`) baked into live crons (Task 2, #2348), a coverage metric (Task 3, done — #2344), and flag↔disposition reconciliation.

## 13. Provenance

Reconciled 2026-06-01 by reading the live engines (`verify-first-translation.ts`, both cron scripts, orchestrator Phase 1.6), the live Hetzner crontab, and the recent handoffs (`2026-05-31-ft-1974-catalog-precedence-and-chip.md`, `2026-05-31-discover-prior-translations-2244.md`). Counts from live `bookstore` queries that day — re-verify if >14 days old. This rewrite (PR #2340) replaced an earlier version whose architecture/numbers had drifted (it described a retired in-pipeline Phase 3.7 path). **§0/§14/§15/§16 added 2026-06-19** from a three-part audit (code/data/eval) + skeptical live re-check; §0 numbers supersede §1/§9.

## 14. Eval & validation (the spine gap — now has a non-circular harness)

> **An indexed ledger of every eval/census run we've done — N, method, result, canonical artifact path, status — is in [`ft-eval-runs-ledger.md`](./ft-eval-runs-ledger.md).** Read it before running a new eval (so you don't redo one) or citing a result file (so you cite the canonical copy, not a `-rerun`/`-merged` stage).

> **Update 2026-06-29 (#2876): the measurement now exists.** `scripts/eval/ft-quality-harness.ts` (`npx tsx`) grades the STORED verdicts against gold we already hold — **zero token cost** — and emits a one-page precision / recall / κ / calibration report (`scripts/eval/results/ft-quality-report-<date>.md` + `.json`), broken out by stratum, non-Western reported separately. Three gold sources, none from the production verifier: (1) `translation_catalogs` priors → recall; (2) the adjudicated batches → precision (the 462-book Tier-2 study, the distilled #2564 census `ft-gold-census-2026-06-26.json`, the 33-case external-API Latin gold); (3) the `first_translation_attempts` ledger's cross-family votes → label-free Cohen's κ. Methods graded: M1 stored disposition, M2 `derive.ts`, M3 Tier-2 stored — each guarded against grading itself (circularity exclusion). Stats reuse `inference.ts` (Wilson CI) + the new pure `agreement.ts` (κ, unit-tested).
>
> **First numbers (2026-06-29, n=2,272 gold books):** M1 disposition precision(first) **58.9%** [55.1–62.6] (western **68.3%** vs non-Western **47.1%**); recall of catalog priors **72.4%** (western **74.7%** vs non-Western **47.7%**); **fabrication rate 56.8%** (precision of `not_first` = 43.2%, n=37 — the docs' "~63%" folklore, now measured). Cross-family κ **0.355** (fair) overall, 0.272 non-Western, with catalog↔model-knowledge κ=0.488 over 12,277 books. **Caveat:** the adjudicated gold is enriched for hard/suspect cases, so precision is a *lower bound* on the corpus rate — the fix is to draw the Tier-2 queue AS a stratified random sample (#2564 §F) so every census run's gold is corpus-representative. **Recall lever, quantified:** the catalog confirms a *complete* prior on only 121 of 1,436 matched books because `translation_catalogs.completeness` is mostly unset — filling that field is the highest-leverage unblock.
>
> Follow-ups this makes *measurable* (out of #2876 scope): wire `resolve.ts` to route effort by these per-stratum numbers; the paid Tier-2 census over promote candidates; switching the public headline to `isPublicFirst`.

The legacy, **circular** harness (superseded by the above for accuracy work):

- **Harness:** `scripts/eval/ft-eval.mjs` (`seed` → `run` → `report`). **Never run at scale:** `scripts/eval/ft-benchmark.json` has 0 cases, and `seed` pre-fills "expected" labels from the pipeline's *own* verdict (`ground_truth_source: 'NEEDS REVIEW — pre-filled…'`) → running as-is grades the pipeline against itself (circular). Still useful for *consistency/regression* baselines, not accuracy.
- **Partial ground truth:** `scripts/eval/ft-ground-truth.json` (**33** Latin cases, vetted vs 5 external APIs; *not* wired into `run()`). Manual census audits: Siku 8/58 (`docs/translation-gap-census-paper/manual-qc-audit.md`), Latin ~70% precision n=25 (`latin-qc-audit.md`). Pattern to copy: `scripts/eval/librarian-search/golden-set.json`.
- **Non-circular benchmark** = an **independent validator** (separate Claude Code window → later Gemini), adversarial, sources *independent of the production engine*, emitting a verdict **plus an append-only attempt log** (the evidence of absence). Silver-standard, human sample-audited. Spec: **`scripts/eval/ft-validator-runbook.md`**.
- **Metrics — report for BOTH paths** (8-tool agent AND the `catalog_search` cron that actually made the count): precision, negative-recall, **internal-match recall** (of priors already in `translation_catalogs`, what fraction does the verifier surface?), verdict stability.
- **Inference at scale:** run the effortful validator on a **work-uniform stratified random sample** (strata = source-path × language-indexing × single-work/container), estimate corpus rates with CIs, *measure the measurer* (audit the validator vs a human sub-sample), report non-Western separately. (#2564.)

## 15. Writer sprawl (the single-writer target)

**~37 scripts** write `is_first_translation` / `disposition` / `translation_verification` (103 files reference the flag; ~37 contain `$set`/`updateOne`/`updateMany` near it). The flag should become **derived single-writer from `disposition`** (#2564 / #2332) so it cannot drift. Active direct-writers to retire/centralize include: `src/lib/verify-first-translation.ts`, `src/lib/metadata-enrichment.ts` (Phase 1.6), `scripts/maintenance/reconcile-ft-from-catalog.mjs`, `scripts/maintenance/apply-audit-verdicts.mjs`, `scripts/maintenance/apply-discovery-results.mjs`, plus the archived `scripts/_archived/2026-06-ft-cleanup/bulk-flag-*.mjs`. A full active/archived inventory is the deliverable for the retire-list.

## 16. Architecture cluster (where this fits)

This doc is the current-state SoT for the *flag mechanics*. The forward design is a layered cluster (map: **#2567**):
- **Identity:** authors #2179 → work resolver #2264 → dedup-at-scale #2318
- **Works catalog (frame + denominator):** #2453 (generalizes Chinese #2452); IIIF census #2447
- **Translation registry (growing positive asset):** work-keyed index #2352 (membership test = the #1974 setter); backfill #2244; provenance bug #2476
- **Flag mechanics (this doc):** setter #1974 · cleanup #2332 · measurement/effort/single-writer #2564

## 17. Process invariant — never derive a destructive flag from an unverified match (incident 2026-06-19)

The first single-writer reconcile demoted 39 `not_first` derived from `disposition`, silently flipping genuine firsts to `false` — including the **Arithmologia**, whose `translation_found` cited Godwin's *Theatre of the World* (an **anthology**, not a translation) as the "prior." Root cause: `disposition: translation_found` is a **fallible match**, not verified truth, and deriving the flag from it laundered bad matches into live errors (worse than the drift it fixed — the drift was *masking* the bad disposition). Invariants for any flag-flipping batch:

- **Demotion requires evidence-quality guards, not just the enum:** prior is not a **self-match** (≠ the book's own catalog record), `completeness = complete`, **same source-language**, prior is a **translation** (not anthology/study), **person-disambiguated** author (namesake guard — Michael Alberti ≠ L.B. Alberti). Fail any → Tier-2/human, never auto-demote.
- **Batches must be reversible + audited** — record before/after per book; run only on guard-passing rows; route the rest to review.
- **A documented hazard must become a code guard** — a comment does not gate a batch job (the 6 false matches were posted before the batch and demoted anyway).
- **Mass-restore is as dangerous as mass-demote** — only 1 of the 6 worksheet-flagged "false matches" was ground-truth-verified (Arithmologia, restored); Avicenna's demotion was actually *correct* (a complete Bakhtiar 1999 prior exists). Heuristic flags are not verdicts.
- These books are the regression set for `ft-eval.mjs`. Full analysis: #2564.
