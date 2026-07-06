# Tier-0 Alignment Gold — #2885(b)  (2026-07-06)

**MEASURE-ONLY — no badge flips, no DB writes.** Answers: *is Tier-0 precise enough to auto-short-circuit (demote without an LLM), or must each match be verified?*

Draw: 130 pairs, seed 42, over 14741 eligible books / 23836 catalog rows.
Verdicts: 130 merged (52 from J1 independent subagents, 78 from J0 metadata). 63 pairs remain unresolved (J0 deferred, no J1 verdict yet) — excluded from rates and reported as coverage, never silently dropped.

## 1. Link precision — the auto-demote go/no-go

A catalog link with `same:false` is a **false merge** — Tier-0 would demote a genuine first. Census of ALL demote_candidate links + a sample of needs_review.

| stratum | link precision [Wilson 95%] |
|---|---|
| demote_candidate (ACTED ON) | 72.7% (16/22) [51.8%–86.8%] |
| ↳ link · generic-namesake | 66.7% (12/18) [43.7%–83.7%] |
| ↳ link · specific | 100.0% (4/4) [51.0%–100.0%] |

**False merges among acted-on links (6):**
- Opera Omnia Vol. 1 / Augustine of Hippo  ⇔  Opera omnia — _A is Vol.1 of a multi-volume set; B is the entire Opera Omnia container. A single volume/part != the whole collected-works container._
- Opera Omnia Vol. 2 / Augustine of Hippo  ⇔  Opera omnia — _A is Vol.2 of a multi-volume Opera Omnia set; B is the complete collected-works corpus. A numbered volume differs from the whole container._
- Opera Omnia Vol. 4 / Augustine of Hippo  ⇔  Opera omnia — _A is Vol.4 (one part) of the multi-volume Opera Omnia set; B is the complete collected-works container._
- Opera Omnia Vol. 5 / Augustine of Hippo  ⇔  Opera omnia — _A is Vol.5 of Augustine's Opera Omnia (one volume); B is the complete Opera Omnia container._
- Opera Omnia (vol. 2) / Giovanni Pico della Mirandola  ⇔  Opera omnia (1557-1573) — _A is vol.2 of the multi-volume Opera Omnia set; B is the complete Opera omnia (1557-1573). One volume of a set does not equal the whole container._
- Opera Omnia Vol. 3 / Augustine of Hippo  ⇔  Opera omnia — _A is Vol.3 of Augustine's multi-volume Opera Omnia; B is the whole collected-works container._

**Guard-rejection quality** (needs_review links, guard fired → NOT demoted): correctly-different — (0 resolved). A `same:true` here = a guard suppressed a real prior (miss → false-first risk).

## 2. work_id co-cluster homogeneity

Two of our books sharing a `work_id`. `same:false` = cluster impurity (a false merge in clustering).

> ⚠️ **J0 PRE-SCREEN ONLY (preliminary, not independently verified).** These rates come from the cheap metadata oracle, which is blind to volume-level impurity (it cannot see distinctions normalization strips) and is therefore biased toward `same` — treat as an upper bound. To verify: `node scripts/eval/ft-alignment-j1-prompts.mjs --kind cocluster` → run J1 → `ft-alignment-merge-j1.mjs` → re-score.

Overall: 100.0% (15/15) [79.6%–100.0%]

| slice | homogeneity [Wilson 95%] |
|---|---|
| source=work-merge:llm-verified (n=24) | 100.0% (5/5) [56.6%–100.0%] |
| source=local-mint (n=8) | 100.0% (6/6) [61.0%–100.0%] |
| source=work-merge:identical-title-deterministic (n=7) | 100.0% (3/3) [43.9%–100.0%] |
| source=legacy-seed (n=5) | — (0 resolved) |
| source=wikidata:P50 (n=5) | — (0 resolved) |
| source=resolve-work-ids:distinctive-title (n=1) | 100.0% (1/1) [20.7%–100.0%] |
| cocluster · generic-namesake | 100.0% (5/5) [56.6%–100.0%] |
| cocluster · specific | 100.0% (10/10) [72.2%–100.0%] |

## 3. Split candidates — clustering recall (under-merges)

Title-family collisions across DIFFERENT `work_id`s (series-guard-cleared). `same:true` = a **false split** — one work scattered across work_ids, so a real prior could go unmatched.

_J1-verified (independent judge; J0 defers all split pairs — it is normalization-blind here)._

False-split rate among title-family candidates: 40.0% (12/30) [24.6%–57.7%] are actually the same work (a recall miss). The complement were correctly separated (distinct volumes/works).

**False splits / recall misses (12):**
- [boehme-signature-all-things ≠ local:a:jakob-bohme:all-signature-things] De signatura rerum: das ist, Bezeichnung aller dingen / Boehme, Jacob
- [local:n:andrea-nerciat:telescope-zoroaster ≠ local:a:nerciat-andrea-de:cabala-divinatory-great-key-magi-telescope-zoroaster] Téléscope de Zoroastre, ou clef de la grande cabale divinatoire des mages / [Nerciat, Andrea de?]
- [local:n::hermetischer-rosenkrantz ≠ local:n::hermetic-rosary] Hermetischer Rosenkrantz / anonymous
- [local:n:collection-gangtey-monas:chen-gi-lo-mo-rgyus-snying-thig ≠ local:n:collection-gangtey-monas:chen-lo-mo-rgyus] sNying thig gi lo rgyus chen mo / Gangtey Monastery Collection
- [local:n:manuzio-paolo:ad-atticum-brutum-ciceronis-correctionibus-cum-epistolae-fratrem-manutii-pauli-q ≠ local:n:manuzio-paolo:ad-atticum-brutum-ciceronis-correctionibus-cum-epistolae-fratrem-manutij-pauli-q] M.Tullii Ciceronis Epistolae ad Atticum, ad M. Brutum, ad Quinctum fratrem, cum correctionibus Pauli Manutii / Manuzio, Paolo
- [local:n:cicero-marcus-tullius:orator ≠ Q2028309] Rhetoricorum ad C. Herennium libri 4. Incerto auctore. Ciceronis De inuentione libri 2. De oratore, ad Q. fratrem libri 3. Brutus, siue, De Claris oratoribus, liber 1. Orator ad Brutum, Topica ad Trebatium, Oratoriae partitiones, Initium libri de optimo genere oratorum. Corrigente Paulo Manutio, Aldi filio Orator Ciceronis ad M. / Marcus Tullius Cicero
- [local:n:collection-gangtey-monas:ba-bcud-gsal-gsang-klong-snying-sogs ≠ local:n:collection-drametse-mona:bcud-gsal-gsang-klong-snying-yang] Klong gsal gsang ba snying bcud sogs / Gangtey Monastery Collection
- [local:n:collection-gangtey-monas:byung-gnas-kyi-ma-pad-rabs-rgyan-rnam-skyes-thar ≠ local:n:collection-drametse-mona:byung-gnas-khrungs-kyi-pa-padma-rabs-rgyan-rgyas-rnam-thar] O rgyan pad ma 'byung gnas kyi skyes rabs rnam thar / Gangtey Monastery Collection
- [local:n:cicero-marcus-tullius:1-2-3-4-ad-brutum-brutus-ciceronis-claris-continentur-dicitur-eiusdem ≠ Q2028309] In hoc volumine haec continentur. Rhetoricorum ad C. Herennium lib. 4 M.T. Ciceronis de inuentione lib. 2. Eiusdem de oratore ad Quintum fratrem lib. 3. Eiusdem de claris oratoribus, qui dicitur Brutus lib. 1. Eiusdem Orator ad Brutum lib. 1. Eiusdem Topica ad Trebatium lib. 1. Eiusdem oratoriae partitiones lib. 1. Eiusdem de op / Marcus Tullius Cicero
- [local:a:heinrich-khunrath:chaos-general-hyleal-material-natural-prime-universal ≠ local:a:heinrich-khunrath:alchemists-alchemy-chaos-conforming-hyleal-is-material-natural-nature-prime-that] Vom hylealischen, das ist, pri-materialischen catholischen oder allgemeinen natürlichen Chaos, der naturgemässen Alchymiae und Alchymisten wiederholete, verneuerte und wolvermehrete naturgemäß-alchymisch- und rechtlehrende philosophische Confessio oder Bekandtniß Henrici Khunrath : deme beygef. ist e. treuhertzige Wahrnungs-Vermahnung an alle wahre Alchymisten, sich vor d. betrüger. Arg-Chymisten zu hüten / Khunrath, Heinrich
- [local:a:johann-michael-faust:illustratus-philaletha ≠ local:n:faust-johannes-michael:closed-entrance-illustrated-king-open-palace-philaletha] Philaletha illustratus / Faust, Johannes Michael
- [local:a:guglielmo-grataroli:alchemy-art-certain-doctrine-metallurgy-method-true ≠ local:a:guglielmo-grataroli:aenigmata-alchemiae-artisque-certusque-citra-comprehensus-doctrina-editis-elench] Verae Alchemiae Artisqve Metallicae, Citra Aenigmata, Doctrina, Certvsqve Modus : scriptis tum nouis tum ueteribus nunc primum & fideliter maiori ex parte editis, comprehensus ... / Grataroli, Guglielmo

## Decision

- Acted-on Tier-0 link precision: **72.7% (16/22) [51.8%–86.8%]**.
- In the generic-namesake stratum (where false merges concentrate): **66.7% (12/18) [43.7%–83.7%]**.
- Go/no-go: if the **lower CI bound** in the namesake stratum falls below the tolerated false-demote rate, Tier-0 must NOT auto-short-circuit there — each such match needs a Tier-2 (LLM) check before demoting.
- Coverage caveat: 63/130 pairs remain unresolved (no J1 verdict yet — chiefly the J0-deferred co-cluster pairs); rates above cover only resolved pairs.
