# First-Translation Identification — a history of the attempts

*How "is this the first English translation of this work?" went from a one-line
heuristic to a per-book, cross-model, evidence-logged census — and the seven
months of wrong turns in between. Companion to the source-of-truth
(`first-translation-system.md`) and the scaling playbook
(`first-translation-census-methodology.md`).*

This document exists because the project kept re-learning the same lessons. It is
deliberately candid about what broke. The short version: **for most of its life
the system optimized for coverage and for estimates, and repeatedly mistook
those for verification.** Every era produced a real artifact and a real lesson;
the lessons compounded into the current design.

### Sources & confidence (read this first)
A history of a system that nearly failed from *fabricated evidence* must itself be
sourced, not embellished. Every dated claim is tagged to one of: **commit** `hash`
(verified in `git log`); **#NNNN** (issue/PR, state checked via `gh` 2026-06-27);
**blog** (a dated public `/blog/...` snapshot); **eval** (a stored file under
`scripts/eval/results/`); or **⚠ unverified** (a characterization I could not pin
to an artifact — plausible, not fact; collected at the end). Dates are
commit-authored dates. Repo's first commit `2025-12-12`; first FT commit
`2026-02-23` (`ecab6aea`).

---

## Era 0 — The heuristic badge (Feb 2026)
- **What we built:** a "First Translation" badge, a `/search?first_translation=true`
  filter, and a classification script (`ecab6aea`, 2026-02-23). `is_first_translation`
  was set by heuristic — non-English original + we have a translation ≈ "first."
- **What it got right:** shipped the *experience* — the badge is genuinely the
  most compelling thing about the catalog, and putting it in front of readers
  early was correct.
- **The original sin:** a heuristic dressed as a fact. "First translation" is a
  hard bibliographic *absence* claim ("no prior English version exists anywhere"),
  and we were asserting it from "we happen to have translated this."

## Era 1 — The Gemini verifier (late Feb – Mar 2026)
The first serious attempt to *check* the claim. This is the "older Gemini system."
- **What we built:** `verify-first-translation.ts` — a multi-stage Gemini
  pipeline with Google Search grounding and function-calling. Catalog-search
  tools were added over weeks: Internet Archive, OpenAlex, Library of Congress,
  ISTC (`2094df8c`, `b5a289dc`, `26d2642f`). A disposition taxonomy
  (`confirmed_first`, `translation_found`, `first_from_source`, …), evidence
  URLs, source-language precision, concurrent-run guards, an eval framework.
- **What it got right:** the *shape* of the answer — grounded search, a graded
  disposition instead of a boolean, captured evidence URLs. This architecture is
  still the Tier-1 layer today.
- **What broke (discovered later):**
  - **Single-model trust.** Gemini alone was treated as ground truth. We later
    measured it **fabricates ~63% of its "a prior translation exists" claims**
    (plausible translator + year + publisher, no real book).
  - **Silent catalog failure.** For an unknown stretch, **all three catalog APIs
    were returning 100% NONE** — every book looked like a first because the
    lookups were quietly dead (fixed only in late May, `e33581e9` / #1979).
  - **Definition drift.** What counts ("≥90% translated, ≥10 pages, no
    bilingual") was tightened repeatedly (`bb4c6646`) — the target kept moving.

## Era 2 — Wiring into the pipeline + the public claims (Mar 2026)
- **What we built:** moved verification into the enrollment phase, then deferred
  it to Phase 3.7 (`f5c72c5e`, `54d6b447`); prioritized first-translations in the
  OCR/translation sort order; put the count on the homepage; published the
  **"2,000 first translations"** blog with data visualizations.
- **The trap we walked into:** the public number outran the evidence. The blog
  posts were edited again and again to re-pin numbers (`92c77b3e`, `cc12deb8`,
  `77a06661` "qualify first-translations claim" after peer review). We were
  publishing a headline built on Era-1's unverified disposition.

## Era 3 — Scale, census tracking, incunabula (Apr 2026)
- **What we built:** census-tracking metrics + live snapshots (`394edbf5`),
  warehouse support, and **pre-import** FT verification for ISTC incunabula
  (`226b9900`, `61b23ff9`) — checking a book is a first *before* acquiring it.
- **What it got right:** verifying at acquisition time is the right instinct.
- **What it papered over:** "census tracking" counted *flagged* books, not
  *verified* ones. The dashboards looked healthy while resting on the same soft
  disposition.

## Era 4 — The reckoning (late May 2026)
The cracks became undeniable, and the commit log turns into a diagnosis log.
- **What surfaced:**
  - The catalog APIs had been returning 100% NONE (#1979).
  - **Content enrichment was silently overwriting the catalog FT verdict**
    (`9f97b675`, `f698004b`, #1974) — one writer clobbering another.
  - Attempts to reconcile the flag concluded it was **"not auto-reconcilable"**
    (`066470d5`, #2262); a strict re-verifier's dry-run (#1974) showed how much
    was wrong.
  - The doctrine commit: **"catalog identification is the only valid basis for
    NOT_FIRST"** (`b5117c90`, #2271).
- **The named problems:**
  - **#1974 — there is no trustworthy automated setter** for `is_first_translation`.
  - **#2332 — subsystem sprawl:** ~37 scripts wrote the flag, with date-stamped
    field names and no coverage metric.
- **What we built in response (Jun 1):** rewrote the source-of-truth doc to match
  reality (`ab59e121`), archived 9 dead one-offs, stabilized field names, added a
  `verification_coverage` stat (#2332). Cleanup, not yet a cure.

## Era 5 — The rebuild: graded verdicts + the First Principle (Jun 19 2026, #2564)
The architectural reset. The core idea: **claim-strength must equal verification
strength**, enforced in code, not convention.
- **What we built:**
  - A **graded verdict model** (`src/lib/first-translation/`): 8 verdicts +
    orthogonal qualifiers (evidence_strength, our_completeness, match_key),
    replacing the loose disposition (`a053a219`).
  - A **single-writer derived rule** — `is_first_translation` becomes a *derived
    read* of the verdict; one reconcile writer, no more sprawl (`3a55824b`).
  - An **append-only provenance log** (`first_translation_attempts`) — the
    evidence of absence, accumulated monotonically.
  - A **stratified-inference harness** (Wilson CI + FPC) and a **recall sampler**
    over the never-assessed pool (`059394b8`, `3ad9cc20`).
  - The **"How Many First Translations, Really?"** blog — the honest public
    accounting (`6f91939a`).
- **The lessons written into doctrine:**
  - **First Principle:** "claim-strength must equal verification" (`14c23766`).
  - **§17 process invariant:** "never derive a destructive flag from an
    unverified match" (`44285e47`).
  - The **evidence-quality guard** (`c5dd74e6`) — born from a near-disaster (see
    below).
- **What the rebuild *measured* but did not yet *do*:** it produced estimates
  (the 462-book stratified study: ~46% of badged books genuine; the n≈1000
  recall: ~25% of the unbadged pool genuine) and a *proposed* reconcile. It did
  not yet verify books one-by-one and write the result back. The instrument
  existed; the census had not been run.

### The near-disaster that shaped the guard — the *Arithmologia*
A single-writer reconcile, run blindly, would have **demoted genuine first
translations** because it trusted `disposition: translation_found` as truth.
Kircher's *Arithmologia* was about to lose its badge on the strength of a cited
"prior" that was actually **Godwin's anthology** — a real citation to the wrong
kind of source. This produced the rule that a cited prior only counts if it is a
*trustworthy sighting* (not a self-match, anthology, or partial), and the
broader principle that **a mass demote is as dangerous as a mass over-claim.**

## Era 6 — Production verification: the census, run for real (Jun 26–27 2026)
The session that turned the instrument into recorded, per-book truth.
- **Merged the #2564 cluster:** graded-verdict core (#2573), evidence-quality
  guard (#2579) + its wiring into the derived rule (#2751), the reader-facing
  badge-evidence panel (#2643), and a projection-bug fix where the guard was
  silently bypassed (#2752).
- **Added the missing tier — cross-model verification.** The key realization:
  Gemini *proposes* (Tier 1, cheap, ~63% false on "prior exists"); an
  **independent Claude Sonnet subagent** *disposes* (Tier 2, adversarial, real
  web research, evidence logged). Different model families → uncorrelated blind
  spots. This is what makes a verdict trustworthy enough to drive a public badge.
- **Ran the first two production censuses:**
  - **Demote census — 145** reconcile demotion candidates. Result: **56 were
    genuine firsts (39%)** a blanket apply would have wrongly stripped; 89 valid
    demotes. Applied with backup + 145 provenance records.
  - **Promote census — 346** blocked-promotion candidates (visible + translated,
    first-family disposition, held by the hygiene gate). Final (after re-running
    28 nightly session-limit failures): **217 promoted** (genuine missed firsts,
    `evidence_strength: moderate` — 192 `none_found` + 25 `only_partial`), **124
    left unbadged**, and **5 HELD for human review** — books whose author field is
    an existing translator/editor (e.g. Duyvendak's *Book of Lord Shang*), i.e.
    re-hosted *published* translations, not our firsts. That contamination mode is
    unique to the promote direction and is why promotes were graded `moderate`,
    not `strong`. Applied with backup + 346 provenance records; blocked-promotion
    pool dropped 1,045 → 704.
- **Wrote the standing plan:** the scaling methodology doc (#2779), the
  whole-corpus census tracking issue (#2780), and this history (#2787).
- **Self-caught process debt (the lesson, live):** both apply scripts wrote
  `is_first_translation` *directly* via `bulkWrite` instead of writing only the
  verdict and letting the single-writer reconcile materialize the flag — adding
  two more flag-writers to the very sprawl #2564 exists to kill. Data stayed
  consistent (reconcile shows 0 pending), but the *pattern* was the anti-pattern.
  Recorded so the next worker uses the verdict-only path (see the methodology
  doc's "canonical apply path").

---

## The recurring failure modes (what we kept re-learning)
1. **Coverage mistaken for verification.** Flagging many books fast felt like
   progress; it produced a number, not a verified claim.
2. **Estimating mistaken for recording.** Stratified samples answered "what's the
   rate?" — they never wrote a per-book verdict anyone could cite.
3. **Silent breakage.** Catalog APIs returning 100% NONE; key drift; one writer
   overwriting another. The system reported health while quietly wrong.
4. **Single-model trust.** Believing one model's grounded answer. The fix was not
   a better model but a *second, independent* one as an adversarial check.
5. **Claims outrunning evidence.** The public count led the verification by
   years. The First Principle exists to forbid exactly this.
6. **Destructive flips from unverified matches.** The *Arithmologia* near-miss:
   a confident mass action on soft evidence cuts both ways — over-claiming and
   erasing genuine firsts are the same mistake.

## Where it stands
- **The instrument works and is proven.** Per-book, cross-model, adversarial,
  fully auditable (every query + source + verdict in the provenance log), gated
  on human sign-off before any public flip.
- **The numbers, honestly (SUPERSEDED 2026-08-31 by round 5, PR #4524: the
  canonical estimate is now **~8,565, 95% CI 7,362–9,768** over a 16,151 pool —
  the figure below used the pre-July `not_applicable` rubric):** of ~14,106
  FT-eligible books, the old estimate was
  **~5,000 genuine first English translations (range ~4,000–6,500)** — close to
  the count we badge today, but composed of *substantially different books*
  (~1,900 over-claims roughly cancel ~1,900 missed firsts). Rigorously verified
  so far: a few hundred and climbing, one signed batch at a time.
- **The remaining work** is tracked in #2780 (whole-corpus census) and #2567
  (the translation/works knowledge layer it feeds).

The throughline: the hard part was never the AI's ability to research a book —
it was building a system honest enough to know which of its own claims it had
actually earned.

---

## Measured numbers, with their sources
- **462-book stratified study of badged firsts:** ~46% genuine / 18% already-
  translated / 30% not-a-clean-claim / 6% unresolved → ~3,774 defensible (95% CI
  ~3,300–4,300). **blog** `/blog/counting-first-translations`; **eval**
  `scripts/eval/results/ft-tier2-verdicts-final.json` (462 rows).
- **Unbadged recall sample:** ~25% genuine (Gemini, n≈1000); the smaller stored
  passes are **eval** `ft-recall-verdicts.json` (40), `-150.json`, `-73.json`.
- **33-case ground truth:** **eval** `scripts/eval/results/ft-groundtruth-worklist.json`.
- **Era-6 production runs:** demote 145 → 56 keep / 89 demote; promote 346 → 217
  promote / 124 leave / 5 hold. Evidence + backups: `scripts/output/ft-evidence-2026-06-26/`.
- **Catalog-NONE fix:** **commit** `e33581e9` (#1979), 2026-05-25.
- **Content-enrichment overwriting the catalog verdict:** **commit**s `9f97b675`,
  `f698004b` (#1974), 2026-05-31.
- **"not auto-reconcilable" diagnosis:** **commit** `066470d5` (#2262), 2026-05-31.

## Claims I could not verify (⚠ treat as uncertain)
- **How long the catalog APIs returned 100% NONE.** The *fix* is dated
  (`e33581e9`, 2026-05-25) but I did not pin when the breakage *began*, so "for an
  unknown stretch" is honest and the duration is unknown.
- **"~63% of Gemini's 'prior exists' claims were fabricated."** This figure is
  cited in `.claude/skills/ft-verify/SKILL.md` and the #2564 validation notes; I
  did **not** re-derive it against ground truth in the Era-6 runs. Directionally
  trusted (it's why cross-model verification exists), but not freshly measured.
- **Era-by-era badged counts.** I have dated public snapshots ("~2,000" Mar 2026
  per the blog; "5,696 badged" in `/blog/counting-first-translations`; ~5,570
  FT-eligible badged pre-session 2026-06-26) but not a continuous series, so the
  growth curve between snapshots is interpolated, not measured.
- **The Era-6 Claude Tier-2 precision/recall.** Validated by an 8/8 pilot's face
  validity and per-book evidence, **not** scored against the 33-case gold set this
  round. Running that eval is an open task (#2780).
