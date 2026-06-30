# Titles, names, and work identity — principles

Why this exists: a recurring class of bug (most visibly in first-translation
badges) traces to one root cause — **a book's title is asked to be the work's
identity, and it can't be.** This doc states the principles that resolve it. It
is the conceptual companion to the build specs in the work-identity system
(`work-identity-coverage.md`, #2318), the works catalog (#2453), and the FT
verification runbook (`ft-verification-runbook.md`). Worked examples at the end
are real cases from the 2026-06-30 non-Latin audit (#2900/#2904/#2905).

## The root problem: a title does five jobs, and they conflict
A single title string is silently asked to be all of:
1. **Identity** — *what work is this?*
2. **Findability** — the strings a reader will search (famous name, script, gloss).
3. **Claim-bearing** — the "First Translation" / completeness badges attach to
   whatever the title appears to be *about*.
4. **Provenance honesty** — it must not imply we did more than we did.
5. **Language** — original script, transliteration, and English gloss all pull on it.

Almost every over-claim we have found is the title optimized for **findability**
("call it *Tao Te Ching* so people find it") at the cost of **identity** and
**claim-accuracy** (the FT badge then reads as "first English of the Tao Te Ching"
— false). You cannot satisfy all five in one string. Stop trying; separate them.

## Principle set A — the title itself
1. **The title names the work we hold, not the famous ancestor it descends from.**
   The unit of identity is the specific edition / recension / commentary, because
   that is what a first-translation claim is *about*.
2. **Lead with identity; keep the famous name in a findable-but-secondary slot.**
   Never drop "Daodejing" — put it in the tail/alt-names. The claim-bearing *head*
   must be a thing we can truthfully claim a first of.
3. **Title and claim are coupled — never ship them diverging.** Before any badge:
   "first translation of *what, exactly* — and does the title say that?" If they
   disagree, fix one.
4. **Name the layer.** Base text / recension-edition / apparatus (commentary) are
   three different things; a claim must say which. Most over-claims are
   layer-confusion.
5. **Lead with the work's own name** (transliteration + script), gloss in English —
   not an English retelling as the primary title. (Same *ad fontes* instinct as
   `feedback_go_to_original_sources`.)
6. **A commentary is part of identity when it is what the book substantively is**
   (Or Yakar, Parimelazagar, 老子元翼). The commentator often belongs at the front.
7. **Title is stable identity; the slug/URL is frozen.** Correct titles freely;
   never regenerate the slug (it breaks links). Title edits are additive-corrective.

## Principle set B — the language axis
Two things people conflate and must not:
- **The work's name** is *multilingual and plural*: original script, transliteration,
  conventional English name, variants. Carry **every** form; findability is the
  *union*, never a choice. (Tirukkural must be found by "Tirukkural," "திருக்குறள்,"
  "Kural," and "Sacred Couplets" alike.)
- **"We have it in English"** is a *state of our holding* (`pages_translated` → the
  green "Translated" badge / filter), surfaced **beside** the title, never inside
  it. The moment "(English Translation)" goes into a title you get collisions and
  false claims.

8. **Display leads with what the reader can read, anchored to the original**
   (transliteration + short gloss; script secondary). Not bare script (unreadable),
   not bare English (loses identity).
9. **The English title is a gloss, not the identity.** Conventional names are fine
   labels; an invented English title that implies we Englished the whole work, or
   that collides with a real published translation, is the failure.
10. **Display and SEO emphasize different forms of the same name-set.** Most
    discovery traffic is English, so `<title>`/meta/structured-data foreground the
    English-findable forms even while the on-page H1 leads with the transliteration.
    Same data, context-tuned rendering — findability never requires corrupting the
    display identity.

## Principle set C — canonical works (the cure)
The title problems are symptoms; the canonical **work** is the cure.
- A **work** (one canonical entity) owns the multilingual name-set, the author
  (via the thesaurus), the language, and relationships to other works.
- A **book** is a *manifestation* of a work; it owns *this* recension, *this*
  commentary, our scan, our translation.
- **The first-translation claim is a predicate on `(work, source-language)`** — not
  a property of a title string. This single move makes the over-claim class
  structurally impossible: a claim can't misread onto the wrong text because it's
  bound to a work.

**The grain question is the only hard one.** What counts as one work? The test:

> **Two things are the same work iff a first-translation claim about one is a claim
> about the other.**

- Daodejing ≠ Jiao Hong's 老子元翼 (translating the base text doesn't translate the
  commentary) → **distinct works**, edge `commentary-on`.
- Ibn Tibbon's Hebrew *Moreh* vs the Judeo-Arabic *Dalālat* → same work, different
  source-language recensions; the FT predicate is **per source-language** (which is
  exactly why source-language is a matcher guard).

**Canonical cuts both ways — beware false canonicalization.** "Canonical" must not
mean "lump." The author thesaurus already taught this (name-matching anchored
"William Law" → the famous Shirer; see `lesson_author_grounding_wrong_famous_person`).
The works analogue is merging a commentary into its base work, or a recension into
"the work," collapsing the very distinctions that carry the claim. The #2318 fit
rule (containment + specificity, reject generic containers) is the guardrail.
Canonical means *resolve to the right grain*, not *collapse to the famous one*.

## Principle set D — sub/supertitles are a tree, not a string
A title is a **path through a typed graph**, and the hard cases are disagreements
about the tree. Above a work: series ("SBE Vol. 39"), canon (Kangyur, Daozang,
Taishō), collected-works ("Ekiken Zenshū"), parent-work (the Gītā inside the
Mahābhārata). Below: volume/part, recension, commentary, scope. Complications:

1. **Grain floats — "part-of" doesn't decide the work.** The Gītā is a *section* of
   the Mahābhārata yet a primary work; the Bhīṣma Parva isn't. **Reception decides,
   not containment** — so clean part-of metadata (Toh hierarchy, TEI) never settles
   work-grain.
2. **Fragmentation — one work scattered across many books** (Mahābhārata Vols. 1–7).
   The FT claim is about the *complete* text; completeness must be **assembled
   across manifestations**, never asserted per volume.
3. **The super-relation is overloaded** — series ≠ canon ≠ collected-works ≠
   parent-work. A series is a publication container (no intellectual identity); a
   canon is a curated corpus (its own significance + name-set). Don't flatten them.
4. **Claims hide in the sub/supertitle.** "Vol. 1" implies *incomplete*; "Complete
   Works" implies *complete*; "Selected" implies *partial*. The completeness
   classifier already keys off these tokens — the subtitle is doing claim-bearing
   work on the completeness axis.
5. **The famous name sits at an unpredictable level** (canon / work / sub-section).
   You cannot assume "the searchable name is the top title" — index every level.
6. **Multilingual × levels multiplies** — the canon has its own names (Kangyur =
   བཀའ་འགྱུར་ = "Translated Word"), the work its own, the commentary its own. The
   name-set is a bag **per node of the path**, not per book.
7. **Display must linearize a tree** — and every linearization can drop the
   load-bearing level. A card wants the recognizable name; a citation wants the full
   path; SEO wants the English forms. Require each linearization to preserve the
   claim-bearing node and ≥1 searchable name.
8. **Super/sub is relative, not a fixed field.** The Vinayavastu is *sub* to the
   Kangyur but *super* to the Pravrajyāvastu. Model parent/child edges; super/sub
   are directions of traversal.
9. **Two overlapping trees that disagree (the deep one):** a *structural*
   containment tree and a *reception/significance* tree. **The FT grain follows
   reception; structure follows the other.** Their divergence is where over-claims
   breed.

## Principle set E — the claim has three states, not two
A first-translation predicate on `(work, source-language)` is **proven-first /
proven-not / unproven** — uncertainty is first-class. Today the system can render
"confident first" (gold badge) or "hide it," and *both lie* about an unproven case.
The honest surface must be able to say *"plausibly first, one unresolved prior —
help us check,"* not collapse to a badge. `needs_review` is that state; render it,
don't override it with a confident verdict. **Operational rule: never show a
confident first badge while a credible prior is unresolved.**

## The one-line synthesis
**Identity lives on the work; the book is a manifestation; the FT claim is a
three-state predicate on `(work, source-language)`; and titles, names, layers, and
"we translated it" are all projections of that.** Pathological as a string, trivial
as a typed work-graph.

## The cheap test (use this until the graph exists)
> If a reader who knows the field would read the title + "First Translation" badge
> together and think *"wait, that's been translated for a century,"* the title is
> naming the wrong layer.

That one mental test catches the whole class.

---

## Worked examples (2026-06-30 non-Latin audit)
- **老子元翼 / "Dao de jing yuan yi" (Chinese)** — was titled "Tao Te Ching with
  Commentary," so the FT badge read as *first English of the Tao Te Ching* (false —
  Chalmers 1868 / Legge 1891). The book is actually Jiao Hong's **老子元翼**, an
  anthology of 64 commentaries — a *distinct work* (`commentary-on` the Daodejing),
  with no prior English of the anthology. **Action:** retitled to lead with the
  anthology (Tao Te Ching kept in-title for findability); badge KEPT and now honest;
  base-text translations render as the soft "Related translations found." A clean
  *proven-first* after reframe.
- **Tirukkural with Parimelazagar commentary (Tamil)** — base text Englished since
  Pope 1886 → base-text claim false. The narrow claim (first complete English of the
  *Parimelazagar commentary*) is **unproven**: Issac T. Thangaiya, *Tirukkural in
  English with Parimelazhakar Commentary* (Madras, 1955) exists but its
  commentary-language is unverifiable without a physical copy (balance leans
  Tamil-only). **Action:** title kept (already names the commentary); badge HEDGED
  (`is_first_translation:false`, `verdict:needs_review`) — no confident first while
  the prior is unresolved; physical-copy todo logged (Roja Muthiah / IAS Chennai).
  The keystone *unproven* example.
- **Pa'amon ve-Rimon (Hebrew)** — recorded author "Cordovero" corrected to Mordechai
  ben Jacob Peshibrom (composite volume); the stored Gemini disposition had even
  reasoned about the wrong work (*Pardes Rimonim*). Lesson: re-derive work identity
  from the title yourself; don't trust a stored disposition's identity.
- **"Immanuel Franco — Tercera parte del sedur" / "Abulafia — Collection of
  kabbalistic works" (Hebrew)** — *proven-not* and *ill-posed*: liturgy with a
  complete prior English (Levi 1789–93), and a manuscript miscellany (a container,
  not a work). Demoted. Containers and liturgy fail the grain test outright.
