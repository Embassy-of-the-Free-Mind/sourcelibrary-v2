# First-translation — the canonical verdict contract + unified oracle prompt

*One output schema for BOTH the Tier-1 (Gemini) adjudicator and the Tier-2 (Claude) oracle, so they can be compared head-to-head (#2880), and one unified oracle prompt for evaluating a book of unknown direction. Created 2026-06-29 to fix three pilot blockers: (1) the two tiers emitted different contracts; (2) the Tier-2 `ft-verify` skill's contract had no `not_applicable`; (3) the oracle had no source-thoroughness floor. This doc is the single source of truth — `ft-gemini-adjudicate.mjs` already emits this contract; the `ft-verify` skill and any pilot harness must emit it too.*

> **Where "read our own DB first" lives — NOT here.** Aligning the work (`work_id`) and checking our own holdings/`translation_catalogs` is **Tier-0: a deterministic, pre-LLM stage** that short-circuits to `not_first` before any model runs. The prompts below are the **external web-search** tiers that handle only what Tier-0 couldn't resolve. Priming rule: **production** Tier-1/2 may be primed with our prior evidence (read-before-spend, efficiency); the **pilot oracle must NOT be primed** — it produces ground truth, so it researches independently to avoid inheriting our registry's errors.

---

## 1. The canonical verdict contract (both tiers emit exactly this)

```
{
  "book_id": "<id>",
  "work_identified": "<the work, disambiguated from parent/sibling/edition>",
  "verdict": "first_no_prior | first_from_source | first_complete | first_modern | not_first | not_applicable | unverifiable | needs_review",
  "prior_relationship": "same_text | same_work_diff_edition | different_source_language | related_distinct_work | partial | adaptation | null",
  "our_completeness": "complete | partial | unknown",
  "evidence_strength": "strong | moderate | weak",
  "match_key": "work_id | author_title | transliteration | none",
  "confidence": "high | medium | low",
  "prior_translations_found": [
    {"english_title":"...","translator":"...","pub_year":"1976","publisher":"...","completeness":"complete|partial|excerpt|unknown","source_url":"<resolvable URL the claim rests on>"}
  ],
  "queries_run": ["every search you ran, verbatim"],
  "sources_consulted": [{"url":"...","found":"<one line: what it showed>"}],
  "reasoning": "<= 400 chars: why this verdict, citing the prior or the bounded absence"
}
```

**Verdict meanings (and how each maps to the badge):**
| verdict | meaning | badge effect |
|---|---|---|
| `first_no_prior` | no English of the work in any form | **first** |
| `first_from_source` | our text is a distinct intermediary never Englished, though the underlying work has been (narrow) | **first** |
| `first_complete` | only partial/excerpt English exists AND our item is verified complete | **first** |
| `first_modern` | only pre-1900 English exists | **first** |
| `not_first` | a complete modern English translation of the work exists (from ANY source language) | **demote** |
| `not_applicable` | **our item is itself already in English** (an English original or an English edition/translation), OR wordless visual art with no translatable prose | **remove** |
| `unverifiable` | competent sources are catalogue-blind; search can't be bounded | not a first |
| `needs_review` | evidence conflicts or work identity unresolved | not a first |

**Hard rules on the contract:**
- `prior_translations_found` is `[]` unless a prior English exists. Every entry MUST carry a real translator + year you actually found — **never a placeholder, never a guess**. (`prior_found` is derived downstream as `length>0`; do not emit it.)
- `evidence_strength`: `strong` only if a prior was positively found OR absence was confirmed in competent tradition-appropriate sources; `moderate` for a well-searched bounded absence; `weak` if competent sources could not be searched. A blind Western-catalogue miss on a non-Western text is `weak`, never proof of a first.
- **`not_applicable` is NARROW (revised 2026-06-30, #2880 Round 1).** It means ONLY: our item is *already English* (English original, or an existing English edition/translation), or it is wordless visual art. A **multi-work container / anthology / single volume of a larger set / scripture-or-liturgy compilation is NOT automatically `not_applicable`** — the question is still "does a complete prior English of THIS content exist?" If a prior does → `not_first`; if none does and we produced the first English of that material → it is a **first** (`first_no_prior`/`first_complete`), even though the cataloguing unit is a volume or a compilation. "Container" and "scripture copy" are cataloguing abstractions, not translation facts. (Rationale: Round 1's strict NA rule undercounted the badged genuine-first rate by ~27 points — 50%→77% — by disqualifying untranslated Tibetan/Chinese/Hebrew material we were in fact first to English. When the claim is honest, **word it around the material/volume actually translated**, not the implied complete parent work.)

This is identical to what `scripts/eval/ft-gemini-adjudicate.mjs` already returns — so a Gemini run and a Claude run are directly comparable verdict-for-verdict. (NB: the Tier-1 Gemini prompt still carries the OLD broad NA rule; reconciling it is hypothesis **H1** in the #2880 Round-2 A/B — see `ft-pilot-round-1.md` §9.)

---

## 2. The unified oracle prompt (Tier-2 Claude; one prompt, unknown direction)

Use this for a book whose direction is unknown (a random-sample book in #2880, or any first-pass). It folds the skill's separate demote/promote prompts into one and emits the canonical contract above. (The skill's directional demote/promote prompts remain valid when you ALREADY know the direction from a Stage-1 verdict.)

> You are auditing a "first English translation" claim for a library. Decide whether OUR book is the FIRST complete English translation of THIS specific text — by doing REAL `WebSearch`/`WebFetch` and actively trying to **REFUTE** the claim (find a prior). AI tends to wrongly assume "no prior" — fight that bias.
>
> OUR BOOK: "<work>" by <author> — source language <lang>. Our record IS the source-language original and we have produced an English translation of it, so a plain source-language original is a **valid** candidate — do NOT mark `not_applicable` merely because it is in its original language.
>
> **Thoroughness floor — before concluding `none`/`first`, you MUST consult at least:** WorldCat, archive.org, **and** one tradition-appropriate catalogue/scholarship for <lang>. Weight library catalogues, scholarly publishers, and digital archives (HathiTrust, Brill, Cambridge/OUP, university presses, ESTC/VD16/VD17, tradition catalogues). **DISTRUST** aggregator / file-share / forum / AI-mirror sites (Scribd, dokumen.pub, pdfcoffee, blogspot, reddit, ebay, goodreads, grokipedia) — never conclude "a prior exists" from those alone.
>
> Disambiguate THIS work from parent/sibling/derivative works and other editions. **Source-language rule (decisive):** if a complete modern English translation of THIS WORK exists from ANY source language, the verdict is `not_first` — even if our copy is in a different language than the prior translator used. Use `first_from_source` ONLY when our text is a distinct, separately-citable intermediary never Englished while the underlying work has been.
>
> `not_applicable` ONLY if: our item is **already in English** (an English original, or an existing English edition/translation), OR it is wordless visual art with no translatable prose. A **multi-work container / anthology / single volume of a larger set / scripture-or-liturgy compilation is NOT `not_applicable`** by itself — judge it like any other text: if a complete prior English of THIS content exists → `not_first`; if none does and our English is the first rendering of that material → a **first** (`first_no_prior`/`first_complete`). "Container" / "scripture copy" are cataloguing labels, not translation facts. (If our item is itself a translation INTO another non-English language, e.g. a Dutch edition of a Portuguese work, weigh whether the underlying work has a prior English → `not_first`, else treat our rendering on its merits.)
>
> Return ONLY the JSON contract (the schema in §1). Every `prior_translations_found` entry MUST have a real translator + year you actually found — never a guess. If your "no prior" rests only on weak sources, set `evidence_strength: weak`.

---

## 3. Why these three fixes (the pilot blockers)

1. **Unified contract** — #2880 compares Gemini-vs-Claude on the same books; they must speak the same verdict language. The Tier-2 `ft-verify` skill previously returned a 4-value `result` (`complete_prior_found | only_partial_exists | none_found | uncertain`) with **no `not_applicable`** — uncomparable to Tier-1's 8-verdict schema and unable to express the ~30% of cases that are ill-posed. Both now emit §1.
2. **Unified oracle prompt** — a random-sample book has no pre-assigned demote/promote direction, so the skill's directional split doesn't fit. §2 decides candidate-or-not and prior-or-not in one pass.
3. **Thoroughness floor** — observed oracle effort ranged 5–72 tool calls; the floor standardizes what "no prior" means so the *ground truth* is consistent.

## 4. Adoption checklist
- `scripts/eval/ft-gemini-adjudicate.mjs` — already emits §1. ✅ (reference implementation)
- `ft-verify` skill (currently **untracked** in the main checkout) — update its contract to §1 and add the §2 unified prompt; keep the directional demote/promote prompts as the "known-direction" sub-mode. Then commit it to the repo (it should not live untracked).
- the #2880 pilot harness — embed §2 as the oracle prompt and §1 as the `StructuredOutput` schema; run Tier-1 (`ft-gemini-adjudicate.mjs`) as the baseline arm against the same gold.
- Prompt *improvements* beyond these correctness fixes (e.g. "require a fetchable catalog URL for any claimed prior", "confidence:low when a verdict rests only on grounding snippets") are **hypotheses to A/B inside #2880**, not blind edits.
