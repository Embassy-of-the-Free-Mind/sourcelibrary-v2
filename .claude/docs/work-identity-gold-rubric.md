# Work-identity gold-labeling rubric

The instrument that turns the resolver probe's *lower bounds* into a real
precision/recall number + inter-rater κ. You are labeling **book PAIRS** as
**same work / different work / ambiguous**. Companion to
`title-and-work-identity-principles.md`, issue #2909.

## The question
> Are book A and book B **manifestations of the same work**?

A *work* is one intellectual creation. A *manifestation* is a particular edition,
printing, translation, or volume of it. You are judging the work, not the copy.

## Decision rules (these encode the grain policy — apply them, don't re-litigate)
**SAME work:**
- Two editions / printings of the same text (incl. different years): *Horologium
  Oscillatorium* (1673) and *Horologium Oscillatorium* → **same**.
- A translation and its original, or two translations of one text: source-language
  recensions of one work are **same** (the first-translation predicate is then
  per *source-language* — that's a separate axis, not this label).
- Volumes / parts of ONE work: *Plauti Comoediae* Vol. I and Vol. II → **same**
  (one work, read in two volumes). *(Policy under decision #2909-B; for the gold,
  label volumes of one work as SAME and let κ on `hard_volume` reveal disagreement.)*

**DIFFERENT works:**
- A base text and a commentary ON it: Cicero's *Epistolae* vs Manuzio's
  *Commentarius in epistolas Ciceronis* → **different** (the commentary is its own
  creation, even if bound together).
- **Numbered / lettered SERIES ITEMS** — distinct texts that share a generic base
  title and differ only by a number, dedicatee, or section-letter:
  "Proverbs: collection 10" vs "collection 11"; "A Balbale to Inana" vs "…for
  Šu-Suen"; Tibetan pecha "…rgyud mi" vs "…rgyud phi"; "Bodleian MS Barocci 6"
  texts → **different**. *(This is the #1 false-positive in the probe's over-split
  tiers — the tokenizer drops the distinguishing token. Watch for it.)*
- Different works merely sharing an author, editor, or publisher: Sallust's
  *Catilina* and Cicero's *Epistolae*, both ed. Aldo Manuzio → **different**.
- A multi-work container vs one of its constituents: an anthology vs a text inside
  it → **different** (the container is a separate question; see the compilation-
  as-work vs container test in the principles doc).

**AMBIGUOUS** (use it honestly — these define the grain boundary, they are not
labeler failures):
- Collected-works editions with different titles ("Opera Omnia" vs "Lucubrationes
  Omnes" of Jerome) — same work or different compilation?
- An edited compilation whose selection/arrangement may itself be a work (Jiao
  Hong's 老子元翼).
- Recension vs revision where you can't tell if the text is materially different.

## Process
1. **Two independent labelers.** Do not confer. Each labels every pair from the
   metadata + the two book URLs (open them if unsure).
2. Fill `label` ∈ {`same`,`different`,`ambiguous`}, optional `confidence`
   ∈ {`high`,`low`}, and `notes` (esp. *why* on ambiguous).
3. Do **not** look at `probe_prediction` while labeling — it's there for the
   scorer, not for you. (Ideally strip it first.)
4. Run `scripts/eval/score-work-gold-set.mjs A.jsonl B.jsonl` → probe precision per
   stratum + Cohen's κ between labelers.

## What each stratum measures
- `control_same` / `control_diff` — sanity floor; labelers must agree ~100% or the
  labeling is broken.
- `random_within` — resolver **precision** on the *ordinary* "same"-assertion
  (de-biased, not cherry-picked).
- `random_pair` — base rate / **specificity** (almost all different; surprises are
  interesting).
- `oversplit_high` / `oversplit_med` — the probe's "you missed a merge" calls;
  fraction labeled `same` = probe over-split **precision** (expect series-item
  contamination to drag `high` below the "near-certain" I first claimed).
- `overmerge` — the probe's "you merged wrongly" calls; fraction labeled
  `different` = probe over-merge precision (expect many false positives from
  name-variants / translation editions).
- `anchor_miss` — recall against external (Wikidata QID) truth.
- `hard_commentary` / `hard_volume` — the grain-boundary strata; κ here is the real
  signal (low κ ⇒ the policy is under-specified, not the resolver wrong).

## Reading the result
- κ per stratum **first**: a resolver can't beat the ceiling set by human
  agreement. Low κ on `hard_*` = fix the *policy*, not the code.
- Then probe precision per stratum → the ranked fix-list.
- **Recall caveat:** this pair set bounds recall (via oversplit + anchor_miss) but
  does not close it. A true recall number needs a per-book sibling-search frame —
  a separate, costlier labeling task.
