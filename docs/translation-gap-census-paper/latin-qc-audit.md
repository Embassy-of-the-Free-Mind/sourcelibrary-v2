# Manual QC audit — Latin (USTC) census, error bars (2026-05-31)

Mirror of the Siku Quanshu QC, applied to the Latin half. The Latin ~2% rests on
**author-surname matching** (USTC author ↔ translation-catalogue author, + 120+
Latin→English aliases): 499,607 Latin editions / 362,263 distinct works / 49,306
authors → 2.18% of authors with ≥1 translation, ~0.99% of works (estimated),
12.83% of editions by a translated author. The flag `ustc_editions.has_english_
translation` is **author-derived** (one translated work flags all that author's
editions). Goal: put error bars on this via two hand-audits.

## Audit A — precision of the flag at the *work* level (n=25 flagged-true)

Sampled 25 editions flagged translated; hand-checked whether *this specific work*
has an English translation.

- **~17–18 genuine** (≈70%): Tacitus *Agricola*, Kempis *Imitatio Christi*,
  Terence (comedies/Flores ×3), Cicero *Rhetorica*, Ausonius (Loeb), Ovid
  *Metamorphoses* speeches, Tertullian *De Pallio*, Cassian *Conferences*, Hermes
  *Pimander* (Copenhaver), Euclid *Elements* defs, Erasmus *De conscribendis
  epistolis* / *Colloquies* / *Paraphrase on John* (CWE).
- **~7 false positives** (≈30%): minor works of translated authors not themselves
  translated — Grotius's wedding poem (*Carmen in domumductionem*), Erasmus's
  grammar *De octo partium orationis*, Durand's legal *Speculum* (3rd/4th parts),
  Vossius's *Latina grammatica*, Dorat's funeral oration — plus **same-surname
  collisions**: an *almanac* by "Regnerus Agricola" (flagged via a translated
  Agricola), "Andrew Hunter" *Pyramis Germano-Britannica*.

→ **Author-flag work-level precision ≈ 70%.** It overcounts because translated
authors have many untranslated minor works, and because surname matching collides
across distinct people.

## Audit B — base-rate sanity (n=50 random Latin works)

A random edition-drawn, dedup-to-works sample: 41/50 unflagged are
**confirmed-pattern untranslated** (almanacs, funeral/commemorative orations,
university dissertations, papal bulls, polyglot dictionaries, local histories) —
the genuine obscure bulk. The 9 flagged are all famous authors (Cicero, Erasmus,
Poliziano, Boethius, Alciati); hand-checked ~4–5 are real work-level translations.

## Key methodological finding: the sampling *unit* dominates the rate

**Edition-weighted sampling over-represents translated works**, because famous
(translated) authors have far more editions than obscure ones. A clean work-level
rate needs **work-uniform sampling** from the 362,263 distinct works, not
edition-drawn sampling. The census's ~0.99% work figure is an *estimate* derived
from author counts, not a directly-sampled work rate.

## Error-bar conclusion (Latin)

The Latin work-level rate is **~1–2%**, order-of-magnitude robust (the obscure
bulk is genuinely untranslated), but the precise figure is **unit-sensitive** and
the author-flag has **~70% work-level precision** with **unmeasured recall**
(name-match failures for genuinely-translated lesser authors cut the other way).
A defensible published figure needs the same gold-standard as Chinese:
**work-uniform sampling + per-work verification**.

This is the same lesson both corpora teach — heuristic matching (author names for
Latin, titles for Chinese) has limited precision/recall, so the honest rate
requires per-work human verification. That convergence *strengthens* the paper's
method argument and the headline (~2% Latin, ~1–2% Chinese).

## Next (paper checklist)
- Build a **work-uniform** Latin sampler (dedup works first, sample from works)
  and run a per-work verification (web/OpenLibrary + LLM adjudication) for a
  directly-measured rate + Wilson CI.
- Quantify flag **recall**: sample flagged-*false* works by mid-tier authors and
  check for missed translations (the name-match-failure direction).
