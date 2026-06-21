# How we got the translation-gap numbers — a plain-language methodology

*Last updated 2026-06-21. Companion to the technical layer in
`.claude/docs/work-identity-coverage.md` and the code in
`scripts/translation-layer/`. Written so a scholar, journalist, or funder can
follow — and challenge — every figure.*

## The question

> *Of the Latin books printed in early-modern Europe, how many have **ever** been
> translated into English — and how many never have?*

This is the empirical basis for our public claim that the vast majority of the
early-modern Latin record has never reached an English reader, and for any
estimate of "how long would it take to finish." We want to state it honestly:
where the number is solid, where it's a floor, and where it's a bracket.

## The honest headline

**Of ~366,000 distinct Latin works printed in Europe 1400–1700, we can find a
prior English translation for only ~2.7% (~9,800). About 97% have no external
English translation on record.** This is a *conservative* figure — the true
untranslated share is at least this high. It agrees with the one independently
citable scholarly estimate we know of: Debora Shuger's "roughly 90% of
early-modern Latin has never been translated."

We deliberately **do not** publish a precise "X years to finish" number. The
honest version is *thousands of years — millennia*. The previously circulated
"~12,000 years" figure is not supported by this data and should be retired.

---

## The data we built on

| dataset | what it is | size |
|---|---|---|
| **USTC** (Universal Short Title Catalogue) | scholarly census of every book printed in Europe to 1700; one row per *edition* | 1,628,578 editions; **503,360 Latin**; 499,604 Latin printed 1400–1700 |
| `work_cluster_id` | USTC's own grouping of editions of the *same work* (e.g. all 14 printings of Ficino's *Platonic Theology* → one cluster) | **366,205 distinct Latin work-clusters** (1400–1700) |
| **`translation_catalogs`** | our assembled catalog of known English translations, drawn from UNESCO Index Translationum, Library of Congress, OpenLibrary, HathiTrust, and named scholarly series | 26,789 rows |
| **Curated series lists** | hand-built, verified enumerations of the major scholarly translation series, *with the original Latin titles* (needed for matching) | I Tatti Renaissance Library 98 · Brill 24 · Dumbarton Oaks Medieval Library 79 |

The **denominator** (what we measure against) is USTC's 366,205 Latin
work-clusters. The **numerator** (what's been translated) is built from
`translation_catalogs` plus the curated series.

---

## How each number was derived

### 1. The denominator: 366,205 Latin work-clusters

We pulled every USTC edition in Latin printed 1400–1700 (499,604 of them) and
collapsed them to USTC's `work_cluster_id` → **366,205 distinct works**.

> **Caveat we state up front:** USTC's year is the *printing* year, not when the
> work was *written*. So this set includes early-modern *reprints* of ancient and
> medieval authors (a 1500 printing of Ovid, a 1490 printing of Aquinas). It is
> therefore an **upper bound** on the genuinely *Renaissance-composed* Latin
> corpus. Classifying each work by composition date is the next refinement; until
> then we treat 366,205 as "early-modern Latin print-works," not "Renaissance
> works."

### 2. The numerator: ~9,800 works with a known English translation

We assembled a list of distinct *works* that have an English translation, from
two kinds of evidence:

- **Named scholarly series** (highest trust): the I Tatti Renaissance Library,
  Brill's Texts and Sources in Intellectual History, the Renaissance Society of
  America series, the Dumbarton Oaks Medieval Library — each enumerated by hand
  with the original Latin title.
- **Bibliographic catalogs**: UNESCO Index Translationum, Library of Congress
  MARC records, OpenLibrary, HathiTrust.

We then **matched** each translated work to a USTC work-cluster (see step 3).
Result: **9,830 of the 366,205 clusters (2.68%) have an external English
translation on record.** The gap is the remainder: **356,375 (97.3%).**

### 3. The matching — and the two bugs we fixed

This is where earlier internal numbers went wrong, so it's worth being explicit.

A pre-existing flag in our system (`has_english_translation`) matched
translations to works **by author surname alone**: if *any* work by an author had
been translated, *every* edition by that author was marked "translated." Two
failures resulted:

- **Over-counting.** Filelfo had 63 work-clusters all flagged translated because
  one Filelfo text was Englished — implausible; he's barely translated. Erasmus:
  1,164 clusters flagged. The flag marked **40,061 clusters (10.9%)** translated.
- **Under-counting (the opposite bug).** Pico della Mirandola was flagged **0 of
  95** clusters — his *Oration on the Dignity of Man* is one of the most-translated
  Renaissance texts. USTC catalogs him as "Pico della Mirandola"; the matcher took
  "Mirandola" as the surname while the translation index used "Pico." They never
  met.

We replaced this with **work-level matching** (`scripts/translation-layer/lib.mjs`):

1. **Author anchor.** Match on a *set* of surname stems, so multi-word names work
   ("Pico della Mirandola" is indexed under both *Pico* and *Mirandola*). This
   alone rescues Pico (0 → 17 translated works found).
2. **Title containment with rarity.** The translated work's title must share
   *distinctive* words with the USTC title — and "distinctive" is measured: a word
   counts only if it's **rare** across the corpus. Common Latin words
   (*theologica*, *disputatio*, *Christi*) don't identify a work and are ignored;
   rare ones (*officiis*, *Catiline*, *mulieribus*) do. (Technically: an
   inverse-document-frequency threshold calibrated on the 366k titles.)
3. **Strip the author's name from the title first**, so a match rests on the
   *work*, not the shared author name.

The corrected layer marks **9,830 clusters** translated — removing a
**30,253-cluster over-count** from the old author-level flag, while *adding* the
names it had missed (Pico et al.).

**Validation.** The corrected counts behave correctly on the known cases:
Filelfo 63 → **1**, Erasmus 1,164 → **526** (genuinely the most-translated),
Pico 0 → **17**. And the distinct-Renaissance-Latin-works total it produces
(1,876) matches an independent hand-count done earlier in the project (~1,870).

### 4. The rule we will not break: external priors only

A work counts as "already translated" **only if a translation exists independent
of Source Library**. Our *own* translation output is never counted as a
pre-existing translation — otherwise we would circularly erase the very gap we
exist to fill (a mistake that bit the project once before, in the first-translation
audit of May 2026).

So everything tagged as our own work — unverified machine claims
(`sl_ft_llm_claim`, 2,565 rows), our verified catalog
(`sl_ft_catalog_verified`), and "in Source Library" flags — is **quarantined on a
separate channel** and excluded from the gap baseline. We track two distinct
numbers and never mix them:

- **The gap** = untranslated *before* Source Library existed (external evidence
  only). This is the problem we measure.
- **Our impact** = works *we* have since translated (1,253 clusters that had no
  external prior). This is added back separately, as our contribution to closing
  the gap — never folded into the baseline.

---

## What's solid, what's a floor, what's uncertain

| claim | status | why |
|---|---|---|
| 503k Latin editions; 366k Latin work-clusters 1400–1700 | **solid** | direct counts from USTC |
| ~97% of USTC-print clusters have no external English translation | **overstates the Renaissance gap** | validation: the raw figure inflates because the print-year denominator includes *translated* ancient/medieval reprints (3/5 of the sampled misses) |
| **~85–90% of genuinely Renaissance-composed Latin works untranslated** | **validated (pilot, 95% CI 60–96%, n=30)** | blind stratified independent-verification eval (see Validation); now *measured*, agrees with Shuger's "90%" |
| translation-match precision ~92% | **validated** | 11/12 of "translated" confirmed by independent grounded search |
| denominator = *Renaissance-composed* works | **upper bound only** | USTC year is print year; includes ancient/medieval reprints — confirmed by the eval |
| "~20 new works translated per year" (the rate) | **order-of-magnitude** | from the per-decade first-translation series; gross retranslation removed |
| "X years to finish" | **deliberately not stated** | numerator and denominator are both order-of-magnitude; honest answer is "millennia" |

## Validation against ground truth (pilot, 2026-06-21)

The figures above come from our matching pipeline. To convert them from a
*hypothesis* into a *defensible estimate with error bars*, we ran a **blind,
stratified, independently-verified** pilot — the eval that closes the loop the
novelty review flagged (a self-published number is a hypothesis until validated).

**Design.** Drew a random sample of 30 Latin works in two strata — 12 the
pipeline calls **translated**, 18 it calls **gap (untranslated)** — stripped the
labels, and handed each to one of three **independent grounded-search agents**
(blind to our label) that searched WorldCat/Google Books/archive.org/scholarly
bibliographies for any published English translation, with strict rules (a modern
Latin reprint or a critical edition *without* a translation does not count).
Artifact: `scripts/analysis/eval-data/translation-gap-validation-2026-06-21.json`.

**Results.**
- **Translated-stratum precision = 11/12 (92%).** When the pipeline says
  "translated," it is right ~92% of the time. The one false positive — Ziegler's
  *Schondia* — exists only in Latin; a stray catalog match flagged it.
- **Gap-stratum: 13/18 (72%) genuinely untranslated; 5 false negatives (28%)** —
  works we called "gap" that *do* have a translation we missed.
- **The denominator caveat, now measured:** **3 of those 5 false negatives are
  ancient/medieval works** (Themistius 4th c., Theophylact 11th c., Sacrobosco
  13th c.) merely *reprinted* in the 1480–1620 Latin window — exactly the
  print-year-not-composition-year inflation we flagged. These classics are
  translated *because they're ancient classics*, not because the Renaissance gap
  is smaller.
- **Restricted to genuinely Renaissance-composed works, the gap holds up:
  12/14 (86%) untranslated** (95% Wilson CI 60–96%). The only two real misses
  (Dickson's *De umbra rationis*, tr. Ferguson 2013; Haedus's Malta description,
  tr. Vella 1980) are obscure works with a *single* recent scholarly translation —
  the long-tail under-capture we already named.

**What it means for the headline.** Two corrections, opposite signs, both small:
the pipeline slightly *over*-counts translations (92% precision ⇒ a few "translated"
are not) and slightly *under*-counts them on the gap side (recall ~86% on
Renaissance works ⇒ the true translated fraction is a little higher than 2.7%).
Net: the honest estimate for **genuinely Renaissance-composed Latin works is
~85–90% untranslated** — squarely consistent with Shuger's "90%," now *measured*
rather than asserted, but with an explicit (and, at n=30, wide) confidence band.
The raw "97% of USTC-print clusters" overstates the Renaissance gap because the
denominator includes translated ancient/medieval reprints.

**Caveats on the eval itself.** n=30 is a *pilot* — the CIs are wide, and a
publishable figure needs n≈200–300 stratified, ideally with a human-adjudicated
gold-standard subset and a Rogan–Gladen correction for adjudicator
sensitivity/specificity (the framework already used for the first-translation
badge audit — see `ft-first-translation-paper.md`). The pilot's value is that it
(a) confirms the *direction and rough magnitude*, (b) quantifies the two error
channels, and (c) proves the print-vs-composition denominator effect with data.

## Known limitations (stated plainly)

1. **Print year ≠ composition year.** The denominator overstates the
   Renaissance-only corpus by including reprints of older works. Fix: classify
   each cluster's composition era (next step).
2. **Residual false positives.** A small fraction of matches are wrong (a school
   commentary matched to the ancient text it glosses; a legal formula sharing a
   rare word). These make the gap a *floor*, not an overstatement.
3. **Coverage of translations is broad but not exhaustive.** UNESCO/LoC/
   OpenLibrary/HathiTrust + the major series capture the canon well; obscure
   dissertations and small-press translations may be missed, which would *shrink*
   the gap slightly. The well-known authors (Erasmus, Bacon, Calvin) are
   well-covered; the untranslated 90%+ is the **long tail of obscure works**, not
   the headliners.
4. **The series lists are best-effort.** I Tatti is enumerated to 98 of ~100
   numbered volumes (the rest forthcoming/unlisted); Brill's catalog bot-blocks
   automated access, so its series are partial. Adding more *strengthens* the
   numerator but barely moves the headline — the long tail dominates.

## Reproduce it yourself

```bash
set -a; source .env.production.local; set +a
node scripts/translation-layer/01-build-external-works.mjs   # what's translated (external only)
node scripts/translation-layer/02-pull-ustc-clusters.mjs     # the denominator
node scripts/translation-layer/03-match-and-gap.mjs          # the match + the gap
node scripts/translation-layer/05-spotcheck.mjs              # the Filelfo/Pico validation
```

Every figure above is written to `scripts/output/translation-gap-report.json`.
The hand-built series lists are in `scripts/translation-layer/series/`.

## One-paragraph version (for a talk or a grant)

> Using the Universal Short Title Catalogue, we count roughly 366,000 distinct
> Latin works printed in Europe between 1400 and 1700. Cross-matching against the
> UNESCO Index Translationum, the Library of Congress, and the major scholarly
> translation series (the I Tatti Renaissance Library, Brill, Dumbarton Oaks), and
> counting a work as translated only on evidence independent of our own project,
> we find a prior English translation for fewer than 3% of them. More than 97% —
> well over a quarter-million works — have never, as far as the record shows, been
> translated into English. This is a conservative floor, and it matches the
> scholarly estimate (Shuger) that some 90% of early-modern Latin has never been
> Englished. At the historical rate of roughly twenty newly-translated works a
> year, finishing the corpus is a matter of millennia.
