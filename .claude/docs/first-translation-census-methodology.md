# First-Translation Census — methodology, models, prompts, tools

**Goal:** for every eligible book in the library, produce an *evidence-backed,
per-book* answer to "is this the first English translation of this work?" — and
from that, a defensible library-wide count. This is the operational playbook for
scaling the verification across the whole corpus.

This is the **measurement/resolution layer** of the first-translation system
(umbrella #2564; architecture map #2567). It sits on top of the graded-verdict
model (`src/lib/first-translation/`), the single-writer reconcile, and the
append-only provenance log. Read those first: `.claude/docs/first-translation-system.md`.

---

## 1. The universe (snapshot 2026-06-26)

| set | count |
|---|---|
| Visible books | 30,963 |
| **Readable** (visible + `pages_translated > 0`) | **15,809** |
| **FT-eligible** (readable + non-English original) | **14,106** |
| — currently badged (`is_first_translation:true`) | 5,570 |
| — unbadged, previously assessed | 4,277 |
| — unbadged, **never assessed** | 4,259 |
| — carrying a **rigorous graded verdict** | **181 (~1.3%)** |

English-origin readable books (~1,703) are excluded — a "first *English*
translation" of an English-original work is ill-posed.

Top eligible languages: Latin 5,050 · German 1,847 · Tibetan 1,470 · French 910
· Greek 796 · Chinese 683 · Dutch 478 · Italian 415 · Sumerian 377 · Sanskrit
348 · Russian 247 · Hebrew 204.

**The gap this methodology closes:** 14,106 eligible books, only 181 truly
verified. Everything else rests on the weak legacy `translation_verification.disposition`
(~53% reliable, per Derek's contradiction audit) or nothing at all.

---

## 1b. The durability principle — evidence outlives the approach
The verification *approach* will keep changing (it already went heuristic →
Gemini → Claude → whatever's next). The **evidence** a run leaves behind must
not. So separate the two:

- **Evidence = durable, approach-agnostic facts.** "On date D, approach A ran
  queries Q against sources S and found / didn't find prior P (with URL)." True
  forever, regardless of who produced it or who reads it. Stored append-only in
  `first_translation_attempts`, tagged with `method` (the approach) so a future
  instrument can tell whose evidence it is.
- **Verdict = a disposable interpretation** derived from the accumulated pile.
  Any new approach recomputes the verdict over all prior evidence; it never
  resets the pile.

Three consequences every approach must honor:
1. **Read before you spend.** Before verifying a book, load its prior attempts
   (`loadPriorEvidence` / `summarizePriorEvidence` in `prior-evidence.ts`):
   short-circuit on an already-found, URL-backed prior; skip queries/sources
   already covered; treat absence from N *independent* approaches as stronger
   than one pass.
2. **Land findings in the durable registry.** A found prior is the most reusable
   artifact in the system — write it to `translation_catalogs` (Sink C) so other
   approaches *and* other features (work-identity census #2567) inherit it
   instead of re-discovering it.
3. **Derive the verdict from the pile, not from the run.** Swapping approaches
   should recompute, never overwrite. `strongestAttempt` + the derived rule are
   the start; the goal is verdict = f(accumulated evidence + independence).

The payoff: when the approach changes again, the next instrument inherits every
attempt ever logged as a head start. Years of search evidence keep paying off
instead of evaporating — the antidote to the history's "every approach starts
over" waste.

## 2. Why a tiered census, not a single pass

Two hard-won constraints shape the design:

1. **Single-pass AI cannot be trusted on the consequential direction.** ~63% of
   the Gemini adjudicator's "a prior translation exists" claims were fabricated
   (plausible translator + year + publisher, no real book). A demotion built on
   that erases a genuine first (the #2564 *Arithmologia*/Godwin-anthology
   incident).
2. **A sample gives a number, not a badge.** Stratified sampling estimates the
   corpus rate (±CI), but every public "First Translation" badge is a per-book
   claim that must be individually defensible. So we need a *census* where the
   claim is public, and may use *calibrated estimates* only where it is not.

The answer is the #2564 **effort-tier router** (`src/lib/first-translation/resolve.ts`):
match cost to difficulty, put cheap deterministic tiers in front of the
expensive agent, and **cross-check every consequential flip with a different
model family** to break correlated error.

---

## 3. The funnel (Stages A–F)

### Stage A — Stratify & structural pre-filter (free, code)
Partition the 14,106 by: badged vs unbadged; assessed vs never; language family;
catalogue density. **Structurally resolve the non-claims without any search:**
- `content_type:'artwork'` / image volumes → `not_applicable`.
- Multi-work containers (`Opera Omnia`, `Florilegium`, `Miscellanea`, collected
  letters, manuscript miscellanies) → `not_applicable` (claim ill-posed).
- Original-language critical editions (title/markers indicate the source text,
  not a translation) → `not_applicable`.

The badged-set sample showed **~30%** of badge errors are exactly these — and
they need no web research. This is the cheapest, highest-leverage filter.

### Stage B — Tier 0: registry/work linkage (free, instant)
If `books.work_id` clusters this edition with a known prior English edition, or
`translation_catalogs` / `original_edition_id` records a prior English
translation of the work → `not_first`, `strong`, **DONE**. No model call.
(Finishing `work_id` clustering, #2318, directly increases Tier-0 yield.)

### Stage C — Tier 1: Gemini catalog sweep (cheap, scalable)
`scripts/eval/ft-gemini-adjudicate.mjs` — one grounded Gemini call per book.
Fast (~cents/book; Batch API halves it) over everything Stages A/B didn't
resolve. Produces a **candidate** verdict + confidence + cited prior + the real
grounding trail. **Guardrail:** Tier-1 "prior found" is never a final demote
(63% fabrication); Tier-1 "no prior" is only a weak first-candidate.

### Stage D — Tier 2: Claude subagent census (expensive, accurate)
The validated instrument (`ft-verify` skill). Independent **Claude Sonnet**
subagent per book, real web research, structured evidence captured. Run it on
the **consequential** set, not blindly on all 14k:
- every book that will **carry a public badge** (each public claim individually verified),
- every Tier-1 **"prior found"** before any demote (catch the 63% fabrication),
- a **calibration sample per stratum** to measure Tier-1's error where Tier-2 is not run in full.

### Stage E — Single-writer reconcile + provenance + sign-off
`scripts/maintenance/reconcile-first-translation-flag.ts` materializes
`is_first_translation` from the graded verdicts (the ONLY writer). Each verified
attempt is appended to `first_translation_attempts`. Every public-claim batch is
**backed up and signed off by Derek** before the flag flips.

### Stage F — Statistical closure (sampling and badging are ONE pass)
**The core principle:** estimating the corpus rate and verifying individual books
are not two efforts — they are the same pass viewed two ways. Running them
separately (the 462-book sample to estimate, the census to badge) is half the
history's wasted motion. Unify them:

- **Every Tier-2 batch IS a random sample → always compute the estimate over it.**
  Whatever set you verify, run the stratified estimator
  (`src/lib/first-translation/inference.ts`, Wilson 95% + FPC) across the strata
  you touched. Each run yields a CI'd corpus number *for free* — never schedule a
  separate "measurement study."
- **Draw the per-book work-queue AS a seeded random sample per stratum**
  (density × language-family × disposition). Then the badges you earn double as
  the calibration set for the strata you don't fully census — verification and
  calibration are the same books. Use `scripts/eval/ft-stratified-sample.ts` to
  draw the queue so the order is itself a valid sample, not an arbitrary list.
- **Closure:** fully-censused strata → hard per-book counts; sampled strata →
  count ± Wilson 95% CI (FPC-corrected) from the *same* verified books.
- **One pipeline, two outputs every run:** per-book verdicts (the badges) **and**
  a confidence-bounded corpus total ("N individually verified + M estimated
  within ±X"). The estimate sharpens monotonically as the census proceeds,
  because every verified book is also a sampled book.

---

## 4. Models

| stage | model | why |
|---|---|---|
| Tier 1 adjudicator | **`gemini-3-flash-preview`** + Google Search grounding (`tools:[{googleSearch:{}}]`, `temperature:0.1`) | cheap, grounds aggressively (~18 queries/book); Batch API halves cost. **Do NOT set `thinkingConfig.thinkingBudget:-1`** — it suppresses `groundingMetadata` and truncates output. |
| Tier 1 fallback gate | `gemini-3-flash-preview` (`scripts/eval/ft-verify-gate.mjs`) | cheap/scalable fallback when Tier-2 volume is too large |
| Tier 2 verifier | **Claude Sonnet (`claude-sonnet-4-6`)** subagents, `general-purpose` agent type | different model family from Gemini → uncorrelated blind spots; richer auditable evidence (45–72 tool calls/book) |
| Human tier | specialist review | the only layer that removes *correlated* error (e.g. an obscure old scholarly edition both models miss) — route famous-adjacent cases here |

**Model independence is the point.** Gemini (Tier 1) proposes; Claude (Tier 2)
disposes; the two are trained and search differently, so a prior fabricated by
one is caught by the other. Never settle a public flip on a single model family.

---

## 5. Prompts

> **Canonical output contract + the unified Tier-2 oracle prompt: [`ft-verdict-contract.md`](./ft-verdict-contract.md).** Both tiers emit ONE schema so they're comparable head-to-head (#2880); the unified oracle prompt handles a book of unknown direction (random sample) and includes `not_applicable` + a source-thoroughness floor. The directional demote/promote prompts below remain valid when the direction is already known.

### Tier 1 — Gemini adjudicator (`ft-gemini-adjudicate.mjs`)
> You are a first-translation adjudicator. Decide whether OUR book is the FIRST
> English translation of THIS specific text. Use Google Search to investigate.
> … [work/author/lang injected] …
> Return ONLY JSON: `{book_id, work_identified, verdict, prior_relationship,
> evidence_strength, our_completeness, match_key, confidence,
> prior_translations_found:[{english_title,translator,pub_year,publisher,completeness,source_url}],
> reasoning (≤400 chars)}`

Verdict taxonomy is shared with the graded model: `first_no_prior |
first_from_source | first_complete | first_modern | not_first | not_applicable |
unverifiable | needs_review`. The **real** evidence is Gemini's
`groundingMetadata` (actual queries + source URLs), captured even on parse
failure so the search trail is never lost — not the model's self-report.

### Tier 2 — Claude subagent, PROMOTE / refute framing (defend or earn a badge)
Used for unbadged candidates and any currently-badged book we are defending
(the unifying question "does a complete prior English translation exist?"):
> You are verifying a "first English translation" claim for a library audit. We
> are about to claim that "<work>" by <author> (language: <lang>) is a FIRST
> complete English translation — i.e. NO complete prior English translation
> exists. BE SKEPTICAL and try to REFUTE this by FINDING a prior complete English
> translation. AI tends to wrongly assume "no prior" — fight that bias with REAL
> web research.
> Do real WebSearch/WebFetch across WorldCat, archive.org, Google Books,
> HathiTrust, Open Library, the publisher, tradition-appropriate catalogues for
> <lang>, and scholarship. Disambiguate same-named works/authors; separate THIS
> work from related works/editions.
> Critically, also determine whether the book is even an English-translation
> candidate at all. If it is itself an original-language edition / critical text,
> OR a translation INTO another language, OR a multi-work container / anthology /
> manuscript-miscellany, then result = "not_applicable".
> Decide result: complete_prior_found | only_partial_exists | none_found |
> not_applicable | uncertain.
> Return ONLY the JSON contract.

### Tier 2 — Claude subagent, DEMOTE framing (verify a *specific cited* prior)
Used when Tier-1 cited a concrete prior and we want it checked before demoting:
> Stage 1 says a PRIOR English translation of this work exists — be skeptical, AI
> invents plausible translators/years. WORK: "<work>" by <author> (<lang>).
> CLAIMED prior: <translator>, <year>. Do REAL web research … confirm whether
> THIS specific translation actually exists, and whether it is COMPLETE or only
> partial/excerpt. Return ONLY JSON.

### Tier 2 — JSON contract (StructuredOutput schema)
```
{ result: "complete_prior_found|only_partial_exists|none_found|not_applicable|uncertain",
  prior: string, evidence_url: string, is_book_a_translation: boolean,
  queries_run: string[], sources_consulted: [{url, found}], reasoning: string }
```

### Survivor / decision rules
- **KEEP badge (genuine first):** `none_found` | `only_partial_exists`.
- **DEMOTE (remove badge):** `complete_prior_found` | `not_applicable`.
- **`uncertain` → human tier.**
- A DEMOTE on a *cited* prior survives only if `confirmed_complete` with a real
  URL; `confirmed_partial`/`not_found` → the badge was right, keep it.

---

## 6. Tools & infrastructure

- **Web research (Tier 2):** `WebSearch` + `WebFetch` (the subagent's own
  tools). Catalogues consulted: WorldCat, archive.org, Google Books, HathiTrust,
  Open Library, publisher sites, tradition-appropriate sources (e.g. Don Karr's
  Kabbalah bibliography, Buddhist canon catalogues), academic scholarship.
- **Web research (Tier 1):** Gemini Google Search grounding (`googleSearch` tool).
- **Orchestration:** the **Workflow** tool — `pipeline()` fan-out, one subagent
  per book, `schema` forces the JSON contract (validated at the tool layer, model
  retries on mismatch), `model:'sonnet'`, `agentType:'general-purpose'`,
  background run, concurrency auto-capped (~16). Embed the worklist in the script
  (the `args` global is unreliable for large arrays — pass data as a `const`).
- **Skill:** `.claude/skills/ft-verify/SKILL.md` — the canonical Tier-2 process
  (batching, prompts, evidence capture, survivor rules).
- **Single writer:** `scripts/maintenance/reconcile-first-translation-flag.ts`
  (dry-run default; `--apply`; `--verdict=` to scope; `--only-demotions`).
  Reads the derived rule (`src/lib/first-translation/derive.ts`) — never
  reimplements it. **Projection must include `translation_verification.translations_found`**
  or the evidence-quality guard is silently bypassed (fixed PR #2752).
- **Evidence-quality guard:** `src/lib/ft-prior-guard.ts` (`evaluatePrior`) — a
  cited prior only justifies a demote if it's a trustworthy sighting (not
  SELF_MATCH / ANTHOLOGY / PARTIAL); else → `needs_review`. Wired into `derive.ts`
  (PR #2751).
- **Provenance:** `first_translation_attempts` (append-only; never updated).
  Schema in `src/lib/first-translation/attempt-log.ts`:
  `{attempt_id, book_id, date, method, match_key, sources_checked, queries,
  result, priors[], evidence_strength, independence_score, model, notes}`.
  `book.first_translation.best_attempt_id` points at the strongest attempt.
- **Inference:** `src/lib/first-translation/inference.ts` — Wilson 95% CI +
  FPC-corrected stratified estimator + sample-size suggester (Stage F).
- **Stratified sampler:** `scripts/eval/ft-stratified-sample.ts`.

---

## 7. Cost & scale

Tier 2 ≈ **58k tokens / ~50 tool-calls per book**.

| target | books | ~tokens | ~wall-clock (16-wide, background) |
|---|---|---|---|
| Consequential set (badged 5,570 + high-prior unbadged ~2,000) | ~7,500 | ~440M | ~1–2 weeks of batches |
| Full eligible census | 14,106 | ~820M | multi-week |

Stages A/B/C cut the Tier-2 load substantially — only the genuine ambiguous
middle needs the expensive agent. Every paid/large run is gated on Derek's
cost sign-off.

---

## 8. Current best estimate (how many of the ~16k are firsts)

> **SUPERSEDED (2026-08-31, round 5 — PR #4524):** the current canonical estimate is **~8,565 books never previously translated into English, 95% CI 7,362–9,768**, over a 16,151-book pool. The ~5,000 below was built on the pre-July `not_applicable` rubric (46% badged-genuine) that Derek's July 2026 policies replaced; it is kept as history. See `scripts/eval/results/ft-pilot-round-5.md` and the runs ledger.

| pool | books | genuine-first rate | genuine firsts |
|---|---|---|---|
| Badged eligible | 5,570 | 46–66% | ~2,560–3,680 |
| Unbadged eligible | 8,536 | ~25% (Gemini sample; Claude census refining) | ~1,900 (±~750) |
| **Total** | **14,106** | | **≈ 5,000 (range ~4,000–6,500)** |

**~5,000 genuine first English translations** — close to today's badged count,
but composed of substantially *different books*: we over-claim ~1,900
(containers / already-translated) and under-claim ~1,900 (never-flagged firsts).
The errors nearly cancel in the total while being wrong book-by-book — which is
exactly why the per-book census matters more than the headline.

Sharpening levers: the promote-census of the high-prior unbadged stratum
(replaces the 25% estimate with a hard rate) and Tier-2 over the badged set
(replaces the 46–66% band with a real number).

---

## 9. Production runs to date (the first Tier-2 batches)

- **Demote census — 145** reconcile demotion candidates (8 pilot + 137 workflow),
  2026-06-26: **56 genuine firsts (39%), 89 valid demotes**, 0 uncertain.
  Applied (89 demoted, 56 confirmed) with backup + 145 provenance records.
  Evidence: `scripts/output/ft-evidence-2026-06-26/`.
- **Promote census — 346** visible+translated shim-blocked candidates: in
  progress / first run of the recover-missed-firsts direction.

Headline finding: a blanket `--apply` would have wrongly stripped 39% of its
demotion candidates — the census, not a sample, is what surfaced that.

---

## 10. Open levers (tracked separately)
- **`work_id` clustering (#2318)** — raises Tier-0 yield (free resolutions).
- **Public headline** counts raw `is_first_translation`, not `isPublicFirst`
  (which excludes weak) — switching it lowers the number to the defensible set; a
  product decision.
- **Retire the ~8 active legacy setters** of `is_first_translation`
  (pipeline-orchestrator, verify-translation-claims, reconcile-ft-from-catalog,
  apply-audit-verdicts, apply-discovery-results, classify-first-translations,
  search-translation-evidence) so the reconcile is the sole writer; requires the
  reconcile to run on a schedule.
