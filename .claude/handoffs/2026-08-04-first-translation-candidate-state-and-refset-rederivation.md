# First-translation: candidate state, the two screens, and the reference-set re-derivation

*2026-08-01 → 08-04. Technical postmortem. Everything below is measured against
production on the date given.*

## What changed, in one line

The badge's default flipped from "assert the negative" to **"candidate until a
prior is linked"**, the two screens that default requires were built and run over
the whole eligible pool, and the reference set was re-derived from source for the
first time since the bilingual fix — which did **not** move recall.

## Merged

| PR | what |
|---|---|
| #3544 | §2b correction — one "absent" prior was present; reconciled with a second session's independent correction |
| #3555 | the two candidate guards + behavioural tests |
| #3566 | one shared page sampler; the `noTimeout` fix that had failed to ship |
| #3577 | epigraphy wrapper family reaching quotable text |
| #3523 | badge coverage gate (`isTranslationReadable`) |
| #3587 | the `candidate` state in `derive.ts` |
| #3613 | two more `withMongo` watchdog truncations + a wrong runbook line |
| #3615 | `rebuild-reference-set.mjs` — rebuild and *prove it landed* |
| #3563 | (someone else's) the `041$a` bilingual filter fix — merged and run |

## The numbers, as they stand

- **Eligible pool:** 17,071 live non-English books. 2,348 already English are ineligible.
- **Both screens complete over all 17,071.** `english_source` 354 · `foreign_source`
  16,268 · `no_ocr` 389 · `undetermined` 60. Translator-as-author: **117 held**, 15 badged.
- **Flagged/held: 440 — 2.6% of the pool.** Candidate-by-default does not collapse
  under its own guards.
- **26 live badges are contradicted by a screen**; **158** are contradicted by
  `translation_classification`. Both are bounded review lists, unadjudicated.
- **Reference set: 126,558** (was 118,352), 21,195 bilingual. Verified against the
  extract on disk, not the log.
- **Catalogue recall: 27.0% → 27.5%.** See below — this is the headline finding.

## The headline finding: the re-derivation did not fix recall

The `041$a` ordering bug was real and its fix recovered 8,206 rows. **Recall moved
0.5 points.** And the two works the entire diagnosis was built on —
*Rhetorica ad Herennium* (Caplan's Loeb) and *De secretis mulierum* (Lemay 1992) —
are **still absent** after the fix, confirmed by querying `title`, `uniform_title`
and `author`.

That independently corroborates the third explanation already recorded in
CLAUDE.md: **the real gate is that `041$h` is required at all.** Records are
discarded for lacking a "language of the original" subfield, and no amount of
fixing the item-language *test* recovers them.

So the causal history is now: three explanations, two measured wrong. This session
is the evidence closing out the second. **The hub doc has no mention of `041$h`
and should get this.**

## Five failures where the instrument lied, not the thing measured

Recorded because the rate — five in one session — is itself the finding.

1. **`pgrep -f ft-source-language-screen` matched its own ssh command line.** Reported
   RUNNING for a job that had stopped 7,500 books earlier. Check a pidfile.
2. **Sampler tests passed against a deliberately broken sampler.** Every fixture had
   the book's body at the front, so "sample from page 1" scored correctly by accident.
   Fixed by putting English at *both* ends of the fixture.
3. **A projection made every badge look unconfirmed.** A corpus run returned
   `confirmed: 0` — "all 5,947 badges unsupported". The query dropped a field the
   gate reads; without it, 96% classify as confirmed.
4. **A completed-looking ingest wrote nothing.** 43-of-43 extraction, full stats
   block, exit 0 — and Mongo unchanged, because `--load` was missing from the
   documented runbook.
5. **A partial load looked identical to a complete one.** The watchdog killed it at
   part 30 of 43; 120,976 of 126,558 rows, exit 0.

The generalisation, which is already CLAUDE.md doctrine and was re-earned five
times: **when something looks clean, suspect the instrument** — and verify by
reading the *destination*, never the log.

## Two new invariants (proposed to CLAUDE.md in this PR)

**`noTimeout` trades silent truncation for silent hang.** Removing `withMongo`'s
300s watchdog is correct — truncation is worse — but the inverse search then hung
for 2h48m at 0.0% CPU with nothing to kill it, having written 1,500 of 10,126
efforts. Both failure modes are silent. The real fix is progress reporting and a
liveness check; `noTimeout` alone is half an answer.

**JSON round-tripping a Mongo document destroys its Date types.** Finishing the
wedged upsert from the saved JSON wrote `run_at` as a **string** on 10,126 docs
where the writer stores a `Date`. BSON orders strings and dates as separate type
classes, so `latestEffortPerBook()` — which the whole `search_efforts` design
depends on — would never have interleaved them correctly. Caught only because a
verification query returned 0 where it should have returned 10,126. All 10,126
repaired. **The shortcut around a hung process introduced a subtler bug than the
hang.**

## Open, in priority order

1. **Badge copy.** The `candidate` state exists in `derive.ts` and renders nowhere.
   The two states must look different or the over-claim is merely multiplied.
   Derek's call — he wants the badge to *expand to show the search*, not be replaced
   by it.
2. **`041$h`.** The actual recall gate, now twice-confirmed. Relaxing it is the next
   real gain; ESTC (#3522) is being worked in `feat-bib-records` on `feat/estc-ingest`.
3. **Three review lists:** 117 translator holds · 26 screen-contradicted badges ·
   158 classifier-contradicted badges.
4. **`ft-translation-queue.mjs` sampling** — fixed in #3566 by sharing one sampler.
   Worth re-running the queue; its old output dropped genuine candidates.
5. **Consolidation.** CLAUDE.md is 716 lines / 21.6K words, its largest section is
   the reference-set one, and the hub doc it points at lacks the `041$h` narrative.
   17 FT/works docs. 27 open PRs, 12 worktrees.

## Reproducing any of this

```
node scripts/enrichment/rebuild-reference-set.mjs            # verify current state
node scripts/enrichment/rebuild-reference-set.mjs --rebuild  # re-derive, then verify
```

⚠️ **Requires a residential IP.** loc.gov sits behind a Cloudflare bot challenge and
403s every part from the Hetzner box. This is why the extract kept living on a
laptop, and it is why the artifacts behind the 27% figure existed only inside one
session's private worktree until #3615.
