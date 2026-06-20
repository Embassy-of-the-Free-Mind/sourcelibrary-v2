# FT Enumeration → Three-Sink Write Spec (issue #2564)

**Status (2026-06-20):** changes #1–#2 (instrument: evidence capture + durability)
**implemented** in the `feat+ft-rebuild` worktree (uncommitted; issue #2564 comment 17:37).
Change #3 sink wiring: **Sink C (Supabase `translation_catalogs`) — PR #2633** (base main);
**Sink A (Mongo `first_translation_attempts` population) — PR #2634** (stacked on #2573);
**Sink B** already works under `--apply-verdicts`. The grounded re-run is unblocked once
Sink A merges and a ~20-book validation pass confirms evidence density.
**Owner of the worktree:** `feat+ft-rebuild` (PR #2573). **Sign-off gate:** Derek, on
(a) any `book.first_translation` verdict flip and (b) the Supabase catalog write.
**Author:** 2026-06-20. See [first-translation-system.md](./first-translation-system.md) §8 for the catalog layer.

> **Root cause the parallel fix surfaced (keep this — it explains the whole incident):**
> `config.thinkingConfig: { thinkingBudget: -1 }` **suppresses `groundingMetadata`
> entirely** — no `webSearchQueries`, no `groundingChunks`. So the killed run wasn't just
> failing to *record* the search trail; with that flag set, the metadata proving it
> searched never came back at all. **Fix already applied: drop `thinkingConfig`, keep
> `temperature: 0.1`**; the existing parse-inside-retry loop covers the occasional
> truncation the flag was meant to suppress. (Same flag is the likely real cause of the
> "62% structured-output failure" once blamed on `gemini-3-flash-preview` — it parses
> 3/3 clean with the flag removed.) The §3a extraction below now actually returns data.

> **One field-shape reconciliation needed before wiring.** The implemented instrument
> emits a single `prior_ref` object (translator/year/title). `ft-ingest-verdicts.ts`'s
> existing `Verdict` interface expects an **array** `prior_translations_found[]` (a book
> can have >1 prior; e.g. a partial *and* a complete). **Pick the array** — change the
> instrument to emit `prior_translations_found: [...]` (one entry is fine), so the ingest
> consumes it unchanged and Sink C can iterate. Don't add a second one-off field name the
> ingest then has to special-case.

---

## 0. Why this exists (the incident)

The first 7,306-book grounded enumeration run (PID 51482, `ft-gemini-adjudicate.mjs`)
was **killed at 2h18m on 2026-06-20** because, even at completion, it would have
produced an **unauditable** result:

1. **No durable write.** A single `writeFileSync` at the end of the loop
   (`ft-gemini-adjudicate.mjs:132`) — no checkpoint, no SIGINT flush. A crash anywhere
   = total loss of the grounded searching done so far. At 2h18m the output file did not
   yet exist; everything was in memory.
2. **The searching wasn't saved.** Per book it emits only
   `verdict, prior_relationship, evidence_strength, our_completeness, match_key,
   prior_found(bool), confidence, reason(≤280 chars)`. It discards **which sources were
   checked, the queries issued, and the identity of the prior found** (translator / year
   / title). That identity is exactly what (a) the `first_translation_attempts` evidence
   log needs, (b) the human-review/audit layer audits, and (c) the Supabase
   `translation_catalogs` row stores.

The evidence trail is the whole point — "evidence of absence" only counts if the
absence (and any found prior) is reconstructable. This spec makes the instrument
capture that evidence and fan it out to all three sinks.

---

## 1. The pipeline and the three sinks

```
ft-gemini-adjudicate.mjs            INSTRUMENT — grounded Gemini, one record per book
        │  writes <out>.jsonl  (incremental; see §4)
        ▼
ft-ingest-verdicts.ts               FAN-OUT — reads the JSONL, writes the sinks
        ├─► SINK A  first_translation_attempts   (Mongo, append-only evidence log)
        │           — appendAttempt(); always written, no gate
        ├─► SINK B  book.first_translation         (Mongo, resolved verdict)
        │           — only under --apply-verdicts  (Derek gate)
        │                 │
        │                 ▼
        │       reconcile-first-translation-flag.ts   materializes is_first_translation
        │       (single writer of the boolean; --apply, Derek gate)
        │
        └─► SINK C  translation_catalogs            (Supabase secondrenaissance,
                    source='sl_ft_llm_claim')        — only when a prior was found;
                    via the harvest writer (§5.3); --apply (Derek gate)
```

Sinks A and B already have a writer (`ft-ingest-verdicts.ts`). Sink C has a writer
(`harvest-ft-into-translation-catalogs.mjs`) but today it reads the **old**
`translation_verification.llm_knowledge_translations[]` field, not the enumeration
output. The work is: **enrich the instrument's record, then point all three sinks at
it.** Nothing here needs a green-field collection.

---

## 2. Canonical schemas (do not invent new shapes)

These already exist in the `feat+ft-rebuild` worktree — match them exactly.

- **Verdict taxonomy + resolved record:** `src/lib/first-translation/types.ts`
  — `FirstTranslationVerdict`, `FirstTranslation` (the `book.first_translation` object),
  `FIRST_FAMILY`.
- **Evidence log row:** `src/lib/first-translation/attempt-log.ts` —
  `FirstTranslationAttempt`. **It already declares the fields the run was dropping:**
  `sources_checked: string[]`, `queries?: string[]`, `found_refs?: string[]`,
  `result: 'found'|'none'`, `evidence_strength`, `independence_score?`, `model?`,
  `cost_usd?`, `notes?`. They are simply never populated — this spec fills them.
- **Ingest's expected input shape:** `ft-ingest-verdicts.ts` `interface Verdict` already
  expects `prior_translations_found?: Array<Record<string,string>>`, `sources_checked?`,
  `work_identified?`, `reasoning?`. **The instrument's current output does not match this
  interface** (it emits `prior_found:boolean` + `reason`, not `prior_translations_found[]`
  + `reasoning`). Closing that mismatch is change #1.
- **Supabase row shape:** `translation_catalogs` columns —
  `source, author, author_surname, canonical_author, english_title, original_title,
  canonical_work, translator, pub_year, publisher, series, completeness` (+ lowercased
  index columns auto-derived). Built by `buildRow()` in
  `harvest-ft-into-translation-catalogs.mjs:116`.

---

## 3. Change #1 — enrich the instrument's per-book record  ✅ IMPLEMENTED (uncommitted)

File: `scripts/eval/ft-gemini-adjudicate.mjs`. Done in the worktree per issue comment
17:37 — grounding-metadata extraction is wired and verified on live calls (queries
5/4/12 per book on obscure probes; `prior_ref` correct on the found case). The contract
below is the target; the **only** delta from what was built is the `prior_ref`→
`prior_translations_found[]` array reconciliation noted in the banner above.

### 3a. Capture evidence from grounding metadata (free, reliable — not model-claimed)

`queries[]` and `sources_checked[]` must come from the **grounding metadata**, not from
asking the model to self-report. The proven extraction lives at
`scripts/enrichment/verify-translation-claims.mjs:341-346`:

```js
const candidate     = resp.candidates?.[0];
const groundingMeta = candidate?.groundingMetadata;
const queries       = groundingMeta?.webSearchQueries || [];                  // → attempt.queries
const chunks        = groundingMeta?.groundingChunks || [];
// ⚠️ NOT c.web.uri — verified 2026-06-20 it is a vertexaisearch.cloud.google.com
// REDIRECT for every chunk, so hostname-dedup collapses all sources to one useless
// domain. The real source domain (worldcat.org, abebooks.com…) is in c.web.TITLE.
const sources       = [...new Set(chunks.filter(c => c.web?.title)
                        .map(c => c.web.title))];                             // → attempt.sources_checked
```

`queries` is the actual Google searches Gemini issued — **this is the load-bearing search
evidence** and it populates reliably (10/23/4 per book observed). `sources_checked` is
**best-effort**: Gemini frequently runs the queries but attaches no `groundingChunks`, so
the cited-domain list is often sparse or empty even on a thorough search. Both are immune
to the model self-reporting diligence. **Acceptance (§8): require non-empty `queries` for
`none` cases, not non-empty `sources_checked`.**

### 3b. Capture the prior's identity from structured output

Change the JSON contract the prompt asks for (`ft-gemini-adjudicate.mjs:77-79`). Replace
the bare `prior_found: true|false` with a structured list, and rename `reason`→`reasoning`
and add `work_identified` to match the ingest interface:

```jsonc
{
  "book_id": "...",
  "work_identified": "<the work, disambiguated from parent/sibling/edition>",
  "verdict": "first_no_prior|first_from_source|first_complete|first_modern|not_first|not_applicable|unverifiable|needs_review",
  "prior_relationship": "same_text|same_work_diff_edition|different_source_language|related_distinct_work|partial|adaptation|null",
  "evidence_strength": "strong|moderate|weak",
  "our_completeness": "complete|partial|unknown",
  "match_key": "work_id|author_title|transliteration|none",
  "confidence": "high|medium|low",
  "prior_translations_found": [          // [] when none — REPLACES prior_found:boolean
    { "english_title": "...", "translator": "...", "pub_year": "1976",
      "publisher": "...", "completeness": "complete|partial|excerpt|unknown",
      "source_url": "<the grounding URL the claim rests on>" }
  ],
  "reasoning": "<= 400 chars; why this verdict, citing the prior or the bounded absence>"
}
```

Rules to keep in the prompt (already present, keep them): the source-language rule,
"never answer absence without having searched," conservative `evidence_strength`. Add:
**"when `prior_translations_found` is non-empty, every entry MUST carry a real
translator and year you actually found — never a placeholder."** (The downstream
junk-translator guard in §5.3 is the backstop, but the prompt should not invite it.)

`prior_found` (boolean) is now derived downstream as
`prior_translations_found.length > 0` — do not emit it separately.

### 3c. Attach the run-level fields the attempt log wants

For each record also stamp: `model` (the `MODEL` const), `cost_usd` (already computed by
`costOf()`), and an ISO `date` (stamp once at process start — `new Date()` is fine in a
plain node script; it's only banned inside workflow runtimes).

---

## 4. Change #2 — incremental, resumable persistence  ✅ IMPLEMENTED (uncommitted)

Done in the worktree per issue comment 17:37: each result is `appendFileSync`'d to a
`<out>.jsonl` sidecar the instant it completes (sync write = atomic per line across the
concurrent workers); on restart, already-done `book_id`s are read from the sidecar and
skipped, so re-running the same command resumes; the consolidated `<out>.json` is rebuilt
from the sidecar at the end. The design below documents that contract.

File: `scripts/eval/ft-gemini-adjudicate.mjs` (imports for `appendFileSync`/`existsSync`
are already present at line 19).

- **Write JSONL, one line per completed book**, via `appendFileSync(outFile, JSON.stringify(rec)+'\n')`
  inside the worker the instant `adjudicate()` returns — **not** a single `writeFileSync`
  at the end. Delete the line-132 end-of-run write.
- **Resume by skip:** at startup, if `outFile` exists, read it, collect the set of
  `book_id`s already present, and have workers skip any worklist item already done. A
  re-run after a crash then only does the remainder. (7,306 items, grounded, ~3h — this
  matters.)
- Keep the stderr progress line (`done/total ($cost)`); it's the only live signal since
  the file is the source of truth.
- Output filename: `.jsonl` not `.json` (it's line-delimited now). Update the ingest to
  read JSONL (`split('\n').filter(Boolean).map(JSON.parse)`).

This trades the old all-or-nothing run for one where a crash at 75% keeps 75% of the
~$75 spend.

---

## 5. Change #3 — wire all three sinks off the enriched record  ⬅ THE REMAINING WORK

The instrument now *emits* the evidence (§3/§4); nothing yet *consumes* it. This is the
open work that blocks the re-run — Sink A is unpopulated, Sink C doesn't exist yet.

### 5.1 Sink A — `first_translation_attempts` (Mongo, append-only) — no gate

`ft-ingest-verdicts.ts` already calls `appendAttempt()`. With the enriched record it now
populates the fields that were empty:

```js
const found = (v.prior_translations_found ?? []).length > 0;
appendAttempt(db, {
  attempt_id: makeAttemptId(v.book_id, 'gemini_verifier', now),   // method: gemini_verifier (see AttemptMethod)
  book_id: v.book_id,
  date: now,
  method: 'gemini_verifier',
  match_key: v.match_key,
  sources_checked: v.sources_checked ?? [],     // ← now populated (§3a)
  queries: v.queries ?? [],                      // ← now populated (§3a)
  result: found ? 'found' : 'none',
  found_refs: [],                                // registry ids — empty until #2453 registry lands
  evidence_strength: v.evidence_strength,
  model: v.model,
  cost_usd: v.cost_usd,
  notes: `${v.work_identified ? `[${v.work_identified}] ` : ''}${v.reasoning ?? ''}`.trim(),
});
```

Note the method is `gemini_verifier` (the `AttemptMethod` superset in `attempt-log.ts:24`),
not `tier2_agent` — keep the two instruments distinguishable in the log. **Append the
human-readable prior into `notes`** too (translator/year/title) so a reviewer auditing the
log sees the match without a registry join.

### 5.2 Sink B — `book.first_translation` (Mongo) — `--apply-verdicts` gate

Already implemented in `ft-ingest-verdicts.ts:84-104`. No change beyond reading the new
field names. Leave the gate: it writes the resolved verdict only under
`--apply-verdicts`, and **never flips `is_first_translation`** — that stays the exclusive
job of `reconcile-first-translation-flag.ts --apply` (the single boolean writer), which
applies the `canPromoteToFirst()` bidirectional hygiene gate. Two gates, two sign-offs.

### 5.3 Sink C — `translation_catalogs` (Supabase) — `--apply` gate

The harvest writer `harvest-ft-into-translation-catalogs.mjs` already has everything
needed — `buildRow()`, the junk-translator/English-source guards (lines 94-153), and
**dedup-on-write** (per-row SELECT on `author_surname_lower + english_title_lower +
translator + pub_year` before INSERT, lines 158-204). Add a **third input pass** that
reads the enumeration's found priors instead of the old Mongo field:

- New mode `--from-enum <out.jsonl>`: for each record with
  `prior_translations_found.length > 0`, build one row per prior via the existing
  `buildRow(book, prior, 'sl_ft_llm_claim', skipReasons)` (fetch the book's
  `author/title/display_title/language` from Mongo by `book_id` for the original-side
  fields). Run it **through the same dedup + guards** — do not bypass them; the junk
  guards exist because earlier harvests injected ~50 placeholder rows (2026-05-30 audit).
- A found prior is "a translation that exists in the world," so it is a legitimate
  catalog row **regardless of our verdict** — even `not_first` books contribute their
  prior. (`first_no_prior` books contribute nothing to Sink C — there is no prior to
  catalog; their value is the badge via Sink B.)
- Keep dedup keyed on (surname, english_title, translator, year), **not** on our book id
  — `translation_catalogs` is a flat world-catalog with no SL foreign key (see caveat §7).

---

## 6. Run order and commands

```bash
set -a; source .env.production.local; set +a

# 1. INSTRUMENT — grounded enumeration, incremental + resumable (re-run safe)
node scripts/eval/ft-gemini-adjudicate.mjs \
     scripts/eval/results/ft-enum-delta-worklist.json \
     scripts/eval/results/ft-gemini-enum-delta.jsonl --concurrency=10
#   (~$75, ~3h, grounded → cannot batch. Crash-safe: just re-run to resume.)

# 2. SINK A (always) + SINK B (dry-run report unless --apply-verdicts)
npx tsx scripts/eval/ft-ingest-verdicts.ts \
     scripts/eval/results/ft-gemini-enum-delta.jsonl              # report only
npx tsx scripts/eval/ft-ingest-verdicts.ts \
     scripts/eval/results/ft-gemini-enum-delta.jsonl --apply-verdicts   # after Derek diff sign-off

# 3. Materialize the boolean (single writer; after Derek sign-off)
npx tsx scripts/maintenance/reconcile-first-translation-flag.ts            # dry-run diff
npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --apply    # WRITES is_first_translation

# 4. SINK C — Supabase catalog (dry-run unless --apply)
node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs \
     --from-enum scripts/eval/results/ft-gemini-enum-delta.jsonl           # dry-run
node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs \
     --from-enum scripts/eval/results/ft-gemini-enum-delta.jsonl --apply   # WRITES Supabase
```

Step 1 is the only paid step. **Do not launch it until changes #1–#3 are in** — a re-run
without them reproduces the unauditable result that got the first run killed.

---

## 7. Caveats / open decisions

- **Mongo ⇄ Supabase divergence.** `translation_catalogs` exists in **both** Mongo
  (~24,040) and Supabase (~26,789) and they have **drifted apart** (sync unresolved — see
  [project_ustc_translation_census]). This spec writes the Supabase copy (the census /
  translation-gap reads from there). Decide explicitly whether Mongo also needs the rows
  or whether Supabase is canonical for `sl_ft_llm_claim`; do not silently widen the drift.
- **No SL foreign key in the catalog.** `translation_catalogs` is a flat catalog of
  world translations with no link back to our `books` or to USTC
  (`translation_catalog_ustc_links` is empty). Dedup is bibliographic
  (author+title+translator+year), so a prior we find that already sits in the catalog
  from `loc_marc`/`openlibrary` is correctly skipped, not duplicated.
- **`found_refs` stays empty** until the #2453 prior-translations registry exists; the
  human-readable prior lives in `notes` (Sink A) and as a real row (Sink C) in the
  meantime.
- **Two sign-off gates, not one.** Verdict flips (Sink B / reconcile) and the public
  catalog write (Sink C) are independent decisions. Either can be approved without the
  other.

---

## 8. Acceptance checklist

- [ ] Instrument writes JSONL incrementally; killing + re-running resumes (no dup `book_id`s).
- [ ] Each record carries `queries[]` + `sources_checked[]` from grounding metadata, and
      `prior_translations_found[]` with real translator/year/title when a prior exists.
- [ ] `first_translation_attempts` rows show non-empty `queries` (load-bearing) and, when
      present, `sources_checked`, plus the prior in `notes` (spot-check ≥5 `found` and ≥5
      `none`). Do NOT fail a `none` row for empty `sources_checked` — that's expected.
- [ ] `ft-ingest-verdicts.ts` consumes the JSONL with no field-name mismatch.
- [ ] Sink C dry-run shows priors routed through the junk/English-source guards and
      dedup (no placeholder translators, no English-source rows).
- [ ] Both write steps remain gated; `is_first_translation` only moves via
      `reconcile-first-translation-flag.ts --apply`.
