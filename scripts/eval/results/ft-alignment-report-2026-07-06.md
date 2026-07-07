# Tier-0 Alignment Gold — #2885(b)  (2026-07-06)

**MEASURE-ONLY — no badge flips, no DB writes.** Answers: *is Tier-0 precise enough to auto-short-circuit (demote without an LLM), or must each match be verified?*

Draw: 130 pairs, seed 42, over 14741 eligible books / 23836 catalog rows.
Verdicts: 130 merged (102 from J1 independent subagents, 28 from J0 metadata). 29 pairs remain unresolved (J0 deferred, no J1 verdict yet) — excluded from rates and reported as coverage, never silently dropped.

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

Overall: 71.4% (35/49) [57.6%–82.2%]

| slice | homogeneity [Wilson 95%] |
|---|---|
| source=work-merge:llm-verified (n=24) | 75.0% (18/24) [55.1%–88.0%] |
| source=local-mint (n=8) | 75.0% (6/8) [40.9%–92.9%] |
| source=work-merge:identical-title-deterministic (n=7) | 100.0% (7/7) [64.6%–100.0%] |
| source=legacy-seed (n=5) | 0.0% (0/5) [0.0%–43.4%] |
| source=wikidata:P50 (n=5) | 80.0% (4/5) [37.6%–96.4%] |
| source=resolve-work-ids:distinctive-title (n=1) | — (0 resolved) |
| cocluster · generic-namesake | 75.0% (21/28) [56.6%–87.3%] |
| cocluster · specific | 66.7% (14/21) [45.4%–82.8%] |

**Impure co-clusters (14):**
- [corpus-hermeticum] Mercvrii Trismegisti Liber De Potestate Et Sapientia Dei / Hermes, Trismegistus, ca. 2./4. Jh.  ⇔  Hermetica: The Ancient Greek and Latin Writings Attributed to Hermes Trismegistus, Volume II
- [seneca-epistulae-morales] Seneca Moral Essays Vol. 1 (Providence, Constancy, Anger, Clemency) / Seneca  ⇔  Seneca Epistulae Morales Vol. 3 (Letters 93-124)
- [local:a:peter-thyraeus:demoniacs] Daemoniaci cum Locis Infestis et Terriculamentis Nocturnis / Petrus Thyraeus  ⇔  Daemoniaci
- [local:corpus-alchemicorum-graecorum] Collection des anciens alchimistes grecs, Vol. 1 / Marcellin Berthelot  ⇔  Collection des Anciens Alchimistes Grecs, vol. 3
- [local:a:michael-maier:chymicum-naturae-scrutinium-secretioris-secretorum] Arcana arcanissima / Maier, Michael  ⇔  Secretioris naturae secretorum scrutinium chymicum
- [local:a:chen-shiduo:esoteric-grotto-heavens-meanings] 洞天奧旨 (Dongtian Aozhi: Esoteric Meanings of the Grotto Heavens) Vol 7 / Chen Shiduo  ⇔  洞天奧旨 (Dongtian Aozhi: Esoteric Meanings of the Grotto Heavens) Vol 1
- [Q66041147] Aesthetica, Pars Altera (Vol. 2) / Alexander Gottlieb Baumgarten  ⇔  Aesthetica
- [ji-great-meaning-five-elements] 五行大義 (Wuxing Dayi: Great Meaning of the Five Elements) Vol 1 / Xiao Ji  ⇔  五行大義 (Wuxing Dayi: Great Meaning of the Five Elements) Vol 2
- [delafosse-hautsenegalniger-vol] Haut-Senegal-Niger, Vol. 3 / Maurice Delafosse  ⇔  Haut-Senegal-Niger, Vol. 1
- [local:a:fyodor-dostoyevsky:diary-writer] Дневник писателя за 1877 г. / Фёдор Достоевский  ⇔  Дневник писателя за 1876 г.
- [local:a:alberti-michael:abstinence-as-averting-death-disease-dissertation-from-means-medical-medicines-p] Dissertatio Inauguralis Medica, De Abstinentia Medici Ab Aegrotis Famam Et Vitam Nonnunquam Conservante : = Wie sich die Medici bißweilen mit Nutzen der Francken enthalten / Alberti, Michael, 1682-1757; Stegmann, Johann Josua  ⇔  Dissertatio Inauguralis Medica, De Abstinentia A Medicis Et Medicamentis, Morbos Mortemque Interdum Avertente : = Wie sich die Menschen bißweilen mit Nutzen der Aertzte und Artzeneyen enthalten
- [local:a:peter-martyr-d-anghiera:decades-novo-octo-orbe] De Orbe Novo Decades (Editio Princeps) / Peter Martyr d'Anghiera  ⇔  De Orbe Novo Decades Octo
- [oviedo-historia-general-natural-las] Historia General y Natural de las Indias Vol. 2 / Gonzalo Fernandez de Oviedo  ⇔  Historia General y Natural de las Indias Vol. 1
- [local:a:zhou-dunyi:quanshu-siku] 周元公集·卷五~卷九 (Collected Works of Zhou Dunyi, juan 5-9) — Siku Quanshu / （宋）周惇頣 (Zhou Dunyi)  ⇔  周元公集·卷一~卷四 (Collected Works of Zhou Dunyi, juan 1-4) — Siku Quanshu

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

## 4. J0 ↔ J1 agreement (cheap-oracle data-quality check)

Of 14 pairs judged by BOTH J0 and J1, they agree on 14 (100.0%).

## Decision

- Acted-on Tier-0 link precision: **72.7% (16/22) [51.8%–86.8%]**.
- In the generic-namesake stratum (where false merges concentrate): **66.7% (12/18) [43.7%–83.7%]**.
- Go/no-go: if the **lower CI bound** in the namesake stratum falls below the tolerated false-demote rate, Tier-0 must NOT auto-short-circuit there — each such match needs a Tier-2 (LLM) check before demoting.
- Coverage caveat: 29/130 pairs remain unresolved (no J1 verdict, or J1 returned "uncertain") — 28 link/needs_review, 1 cocluster; rates above cover only resolved pairs.
