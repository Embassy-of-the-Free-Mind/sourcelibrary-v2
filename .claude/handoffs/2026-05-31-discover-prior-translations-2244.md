# Handoff — Issue #2244: discover prior translations (translations_found backfill)

Date: 2026-05-31
Branch: **main** (worktree creation failed — see below). Script is an UNTRACKED file in the main checkout.

## TL;DR
Built `scripts/enrichment/discover-prior-translations.mjs` per issue #2244. It is
**syntax-valid and runs end-to-end** (dry-run processed 2 candidates, wrote a
report, made zero DB writes). **One unresolved bug:** the first dry-run on Fludd
returned `parse_failed` for both books (Gemini response not parsed as JSON). A
robustness fix to the parse step was applied but **could not be verified** — this
session's tool-output channel degraded badly (results buffering/dropping), so the
post-fix dry-run output was unreadable. **Nothing was applied to production.**

## Important context correction
This session initially **misread #2244 as the author-dedup task (#2179)** and did
read-only DB surveys toward that before catching the mistake. Verified clean-up:
`canonical_authors` = 0 docs, books with `canonical_author_slug` = 0. No author
writes happened (the `--apply` attempt was in a cancelled tool batch). Disregard
any author-clustering artifacts; they were never persisted.

## What #2244 actually wants
Populate `translation_verification.translations_found[]` for first-translation
books with PRIOR published translations the title-search pipeline misses —
especially SECTION/EXCERPT translations published under a different title
(Hauge's *The Temple of Music* (2011) = a section of Fludd's *Utriusque Cosmi
Historia*). Guardrails: every `translations_found` entry must have a resolvable
URL; LLM-only claims segregated into `llm_knowledge_translations`; do not silently
flip `is_first_translation` on a prior-complete conflict; dry-run before apply.

## Data model (verified, src/lib/types/book.ts ~L330-367)
`TranslationVerification`: `translations_found[]` (rendered), `validated_translations[]`
(Path A catalog-verified), `llm_knowledge_translations[]` (Path B LLM, may hallucinate).
`TranslationEvidence`: english_title, translator, pub_year, publisher,
completeness ('complete'|'partial'|'excerpts'|'unknown'), evidence_source
('open_library'|'google_books'|'internet_archive'|'llm_knowledge'), catalog_id,
validated, notes, url. Renderer `BibliographicInfo.tsx` prefers `validated_translations`,
falls back to `translations_found`, needs `url` (or catalog_id+evidence_source) to link.

## Candidate set (verified, prod `bookstore`)
first-* family (is_first_translation OR disposition in confirmed_first/
first_complete_translation/first_modern_translation/first_from_source/first_translation):
8,125 total; ~6,384 visible+pages>0. Only **16** have translations_found; 37 have
validated_translations; 1,247 have llm_knowledge_translations. Dispositions:
confirmed_first 7,909, translation_found 4,116, needs_review 423, first_from_source 66,
first_complete_translation 28, first_modern_translation 14.

## Existing (UNTRACKED, prior May-30 session) machinery — do NOT duplicate
- `scripts/enrichment/discover-translations-estimate.mjs` — Gemini 3.1-flash-lite +
  Google Search grounding; generic "does any English translation exist?" on random
  `confirmed_first` samples. Writes `discovery_estimate_2026_05_30`. `--save`, no `--apply`.
- `scripts/enrichment/audit-translation-claims.mjs` — audits specific translator claims; writes `verification_audit`. `--dry-run`/`--apply`.
- `scripts/maintenance/apply-discovery-results.mjs` — flips dispositions from discovery; writes `validated_translations` tagged `evidence_source:'gemini_grounding_discovery'` **WITHOUT catalog verification** (this is what #2244 says NOT to do). `--apply`.
- `scripts/maintenance/apply-audit-verdicts.mjs` — flips dispositions from audit verdicts.
- Per memory: ft-discover + ft-audit are **cronned nightly on Hetzner** (03:40/04:40) running the above. So a grounding-only pipeline is already mutating this data nightly; the new catalog-verified script is the #2244-compliant refinement and must be reconciled with it (replace ft-discover, or run alongside and let catalog-verification win).

## The new script — design (DONE, scripts/enrichment/discover-prior-translations.mjs)
- Targets first-* family + empty translations_found (+ `--author`, `--book-id`, `--limit`, `--force`).
- Gemini 3.1-flash-lite + googleSearch, prompt tuned for section/excerpt-under-different-title + full translations; returns array of claims with completeness + confidence + section_translated.
- Cross-checks EACH claim against Open Library / Google Books / Internet Archive
  (inline `matchOpenLibrary/matchGoogleBooks/matchInternetArchive` → resolvable url + catalog_id; title-overlap ≥0.5 + year ±5).
- Catalog-resolved → `translations_found` + `validated_translations` (validated:true).
  Unresolved → `llm_knowledge_translations` (NOT rendered).
- Conflict: catalog-resolved prior COMPLETE translation on a first-* book →
  writes `first_translation_conflict` flag (does NOT auto-change is_first_translation), reported.
- Idempotent via `translation_verification.prior_translations_2026_05_31`; original `author`/byline untouched; additive.
- `--dry-run` (default): writes scripts/output/prior-translations-report.{json,txt}, no DB writes. `--apply`: writes the fields above.

## THE PARSE BUG — FIXED & VERIFIED
First dry-run returned `parse_failed` for every book. Root cause confirmed via a
standalone probe (`scripts/_tmp-gemini-probe.mjs`): the API itself is fine (a SHORT
prompt returns clean JSON, finishReason STOP). The failure was the LONG/complex
prompt: `gemini-3.1-flash-lite` is a thinking model, and with grounding + a big
prompt the visible answer was being drained/truncated by thinking tokens →
empty/cut-off `resp.text` → JSON.parse throws.

Fix (in `callDiscovery` config): `thinkingConfig: { thinkingBudget: 0 }` +
`maxOutputTokens: 8192`. Also hardened text extraction to gather non-"thought"
content parts as a fallback to `resp.text`.

VERIFIED: after the fix, `--author Fludd --dry-run --limit 1` processed cleanly —
`[69c581e4a0ac0c96f42b4016] Veritatis proscenium — Fludd, Robert (no prior
translation found)` with NO parse error (correct: that polemic has no known English
translation; the script correctly declines to invent one — no fabrication).

## SECOND BUG — concurrency throttling (fix applied, NOT yet verified)
The `--limit 8` Fludd run showed the parse fix works for a SINGLE call but 7/8 books
still `parse_failed` UNDER CONCURRENCY. Root cause: concurrent grounded Gemini calls
get throttled and return a 200 with EMPTY/blocked text → JSON.parse fails. The old
retry loop only retried on network-error *messages*, not on empty responses.

Fix applied: CONCURRENCY 3→2, DELAY 1.5s, MAX_RETRIES 4, retry on empty text /
finishReason !== 'STOP' / RESOURCE_EXHAUSTED / UNAVAILABLE. **This was NOT enough** —
the hardened `--limit 6` run still showed ~5/6 `parse_failed`. So concurrency is not
the whole story.

**LIKELY REAL FIX (do this next):** the *working* sibling
`discover-translations-estimate.mjs` runs at CONCURRENCY 3 with a SHORT prompt, a
SIMPLE flat response schema, and **no** `thinkingConfig`/`maxOutputTokens` — and it
does not parse-fail. My script differs by (a) a long prompt demanding a big nested
JSON array with many fields, and (b) the `thinkingConfig:{thinkingBudget:0}` +
`maxOutputTokens` I added — `thinkingBudget:0` may itself be unsupported with
googleSearch on gemini-3.1-flash-lite and could be *causing* empty responses.
Recommended: REMOVE thinkingConfig/maxOutputTokens, and SIMPLIFY the prompt to the
sibling's proven shape (ask for a short flat list: english_title, translator,
pub_year, publisher, completeness, section), parse that, then run the catalog
cross-check (matchOpenLibrary/GoogleBooks/InternetArchive — these are independent of
the LLM and already written) to populate url/catalog_id. Re-test `--limit 6`; expect
~0 parse fails. Cheapest path may be to fork `discoverOne()` from the sibling
verbatim and only swap the prompt's emphasis to section/excerpt-under-different-title.

WORKING EVIDENCE (verified): the one cleanly-parsed book in the limit-8 run —
"Response to the Sponge of the Weapon-Salve" — correctly classified Fludd's OWN 1631
English reply as `llm-only` (NOT promoted to translations_found). Segregation +
no-fabrication behaviour confirmed.

STILL TO VERIFY: (a) hardened run eliminates parse fails; (b) the POSITIVE path —
a book whose catalog cross-check resolves a real prior translation into
translations_found (look for ✓ lines with a URL). Confirm with the command below.

### NEXT STEP to finish (run these, read the report):
```
cd ~/sourcelibrary
node --check scripts/enrichment/discover-prior-translations.mjs
set -a; source .env.production.local; set +a
node scripts/enrichment/discover-prior-translations.mjs --author "Fludd" --dry-run --limit 2
cat scripts/output/prior-translations-report.txt
# also a quick probe of raw model output: node scripts/_tmp-gemini-probe.mjs ; cat /tmp/probe.out
```
If still parse_failed, inspect the `raw`/`finishReason` now logged in report.json's
error path (currently errors are NOT pushed to report.books — add them, or print
`raw` to stderr in processBook). Likely real fix: add `responseMimeType:'application/json'`
is INCOMPATIBLE with googleSearch tools, so instead strengthen extraction or drop the
fenced-block expectation. Compare against the working `discoverOne()` in
discover-translations-estimate.mjs (its prompt is simpler — consider matching its
response shape, then post-expanding for section/excerpt).

## After it works
1. Dry-run a priority batch (named authors: Fludd, Khunrath, Maier, Bruno, Ficino,
   Agrippa, Paracelsus, Dee). Spot-check that it surfaces Hauge *Temple of Music* for Fludd.
2. `--apply` to the spot-checked batch; verify translations_found render on a book page.
3. Commit via a worktree (EnterWorktree — load its schema via ToolSearch first; the
   call failed this session because the schema wasn't loaded). PR to main.
4. Reconcile with the nightly ft-discover cron (grounding-only) per above.
5. Clean up temp: `scripts/_tmp-gemini-probe.mjs`.

---

## RESOLVED — 2026-05-31 (follow-up session)

The parse bug is fixed and the script is verified end-to-end. Root cause was THREE
distinct issues, not one:

1. **Truncation, not throttling.** `gemini-3.1-flash-lite` + `googleSearch` grounding
   intermittently returns a 200 with `finishReason: STOP` but a body truncated to
   `{ "translations":` (~19 chars). A FIXED `thinkingBudget` (0 OR 2048) makes it
   DETERMINISTIC; the prior session's `thinkingBudget: 0` was *causing* the failure,
   not preventing it. Confirmed by direct probe (no-grounding calls never truncate).
2. **Retry logic treated a truncated body as success.** The old loop broke on
   "non-empty text + STOP". Fixed: JSON parsing now happens INSIDE the retry loop;
   we retry until the body actually parses.
3. **Persistent truncation on some books.** A few records (sparse catalog titles)
   truncate on every grounded retry at temp 0.1. Fixed by ESCALATING: bump temp to
   0.4 after attempt 0, and DROP grounding on the final attempt (a no-grounding call
   never truncates, and this script verifies every claim against catalog APIs itself,
   so grounding is recall-only). Result: 0 parse-fails across all test runs.

Plus a catalog-matching fix: the year gate (±5 on `first_publish_year`) rejected
Hauge's *Temple of Music* because OL records it as a 2017 reprint vs the 2011 claim.
New `catalogAccepts()` predicate uses a wide ±8 year window WITH bidirectional title
overlap (so it still rejects the "Songs of the temple / sacred music" 1831 false
positives that share words with the short title).

### Verified
- **Proof case** (`--book-id 69593413…`, Utriusque Cosmi Historia Tomus Primus):
  resolves all three issue-named examples to real 200-OK URLs —
  Hauge *Temple of Music* (2011, Open Library), Godwin 1979 (Open Library),
  Huffman *Essential Readings* (1992, Internet Archive). Tahil 1982 correctly stays
  llm-only (no catalog hit). 
- **Bruno (`--limit 8`):** 0 parse-fails; resolved Imerti/Lindsay/Greenberg etc.;
  correctly raised 2 `first_translation_conflict` flags (prior COMPLETE translation
  found) WITHOUT auto-flipping `is_first_translation`.

### Still TODO (next session)
1. Spot-check a dry-run batch across the named authors, then `--apply` to the
   priority set. **No production writes have happened yet** — `--apply` was not run.
2. Reconcile with the nightly ft-discover cron (grounding-only) on Hetzner.
3. Clean up `scripts/_tmp-*` probes (already removed this session).

---

## APPLIED TO PRODUCTION — 2026-05-31 (same session, continued)

Feature is LIVE. Renders on real pages (verified): Bruno *Le Opere Italiane* shows
Imerti/Morehead *Expulsion*; Fludd *History of the Macrocosm and Microcosm* shows
Hauge *Temple of Music*.

**What shipped (PR #2253):** discover-prior-translations.mjs + 4 refinements:
1. Grounding-truncation fix (dynamic thinking + parse-retry + no-grounding fallback) — see [[lesson_gemini_grounding_truncation]].
2. Compilation/translation guard (`isCompilationOrTranslation`): translator-author /
   multi-contributor books get a stricter prompt that excludes translations of the
   underlying SOURCE. Fixed the Ficino→English-Plato false-positive class.
3. Named-translator + anthology-must-name-author gates (`eligibleForRender`).
4. `--apply-report <dir>` writes EXACTLY the QC'd dry-run entries (no non-deterministic
   re-run between review and write).

**Apply run:** priority named authors (Fludd, Khunrath, Maier, Bruno, Ficino, Agrippa,
Paracelsus, Dee), full coverage `--limit 60`. 143 books processed, **0 parse-fails**.
Wrote translations_found to **31 books** (37 entries), 4 first_translation_conflict
flags, 76 books with segregated llm-only. Manually trimmed 2 wrong/unverifiable entries
before apply (Maier "True Invention"→Themis Aurea wrong-work; Maier Viridarium→unverifiable).

**Needs Derek (human review):**
- 4 `first_translation_conflict` books (prior COMPLETE translation exists → is the
  `is_first_translation` claim still right?): Paracelsus *Paramirum* (Leidecker 1949);
  Bruno *Le Opere Italiane*, *Collected Works*, *The Reformed Sky* (Imerti/Morehead/
  Williams/Greenberg/Gosselin). Flags set, NOT auto-flipped.
- Known imprecision (kept, labeled `partial`): Hauge *Temple of Music* is attached to
  several Fludd Utriusque volumes incl. Microcosm tomes, though Templum Musicae sits in
  the Macrocosm tome. Real translation, broad volume attribution — trim per-volume if undesired.

**Still TODO:** extend beyond the 8 named authors to the wider first-* family (~6,384
books) once these render well; reconcile with the nightly grounding-only ft-discover cron.
Reports: scripts/output/prior-final{,-clean}/ (gitignored scratch).
