---
stage: metadata
measure: [judged, agreement]
languages: [la, de, fr, it, es, nl]
scripts: [Latn]
canons: []
n_books: 528
n_pages: null
verdict: "Dating each prior by its English translation, not its edition: of 528 visible not_first books, 49 (44 works) rest only on Middle English, early modern (pre-1900) or partial English (read 1), and an independent blind Sonnet read agrees for 28 books (23 works). After a by-eye pass, 24 books (19 works) are recommended: 18 first_modern, 6 first_complete. Positive control (Bartholomaeus Anglicus, 6 copies) comes out first_modern on both reads. Census: Latin 1400-1700, any English 15.1% [12.8-17.8] of works (all-print) vs readable modern English 9.5% [7.7-11.6]; Renaissance-composed 6.7% [5.0-8.9] vs 2.2% [1.4-3.4]. Five vernaculars, modern English: German 0.3%, French 1.7%, Italian 2.7%, Spanish 2.7%, Dutch 1.0% (n about 300 each); composed in the language AND modern: 0.0, 0.0, 1.0, 1.3, 0.0%. 2026-10-30."
status: informational
decision: "No write. Promotions staged in scripts/analysis/eval-data/ft-modern-candidates-2026-10-30.jsonl for Derek. Resolver fix (tr_year/register on the prior shape, first_modern by translation date) in PR #7798."
superseded_by: null
issue: [7797, 7751, 2684]
---
## 2026-10-30 · If a prior is dated by when its English was made, not by its edition, how many not_first badges and how much of the census change? (#7797)
<!-- PRIOR ART: .claude/skills/ft-verify (independent Sonnet reads; its first_modern note is the rule applied here), scripts/lib/ft-demote-screen.mjs (first_modern_candidate signal, dates by pub_year only, so it cannot see this class), scripts/analysis/gap-validation-* (the June Latin study whose translated verdicts are re-dated), PR #7791 translation-share verdicts (the five-language sample). None records a translation's own date or register, which is the field this needs. -->

**Question.** Derek, 2026-10-30: "translated" means readable by a modern reader in English. The model already says so (`not_first` = a complete MODERN English translation exists; `first_modern` = only antiquated, pre-1900, English). But the resolver dated each prior by its edition's `pub_year`, so Seymour's 1975 Oxford text of Trevisa's c.1398 *De proprietatibus rerum* read as a 1975 translation. This run dates every defeating prior by the translation itself and stages what changes. Nothing was written to `books`, `translation_catalogs`, `first_translation_attempts` or any store a cron reads.

**Instrument.** Every read is a lean `claude -p --model sonnet` with WebSearch/WebFetch, on the main box's subscription (milolomas account, clean env, never the API), one call per work, about 6 searches allowed. Each prior gets: `tr_year` (when the ENGLISH was first made or published), `register` (`middle_english` before 1500; `early_modern` 1500-1899 unmodernised; `modern` 1900 or later, or modernised spelling AND wording; a critical edition or facsimile keeps the old register), `scope` (complete, substantial = at least half, selections), and evidence (title, translator, publisher, URL, quoted line). Cost: 787 calls, $57.30 API-equivalent (sum of `total_cost_usd`), $0 billed; the account moved 5-hour 3% to 40%, week 0% to 5%. Median 2-4 turns a call: these are shallow searches (see caveats).

### Part 1. The 528 visible `not_first` books

**Set.** `visible: true`, `pages_count > 0`, `first_translation.verdict: not_first`: 528 books (tier1_catalog 407, tier2_agent 83, gemini_verifier 32, translation_card_review 2, tier0_linked 1, no resolver 3). `prior_refs` is null on 527 of them, so the priors come from `first_translation_attempts.priors` (2,486 attempt rows), `books.prior_translation` and `translation_verification.translations_found`, deduplicated per work.

**Grouping.** 528 books into 423 works (`work_id` plus the title head, so a `work_id` that lumps *Brutus* with *De oratore* still splits). Read 1 runs once per work.

**Read 1** (sees the recorded priors) dates every real, same-text prior and says whether a complete or substantial modern English translation exists. A work is a **candidate** when no real prior is modern AND complete/substantial and read 1 does not say one exists: `first_modern` if an antiquated complete/substantial prior exists, `first_complete` if only selections do.

**Read 2** (blind: author, title, language and date only; no priors, nothing from read 1) is told to find a complete English translation made in 1900 or later. **Both agree** only when read 1 is a candidate, read 2 finds no modern complete/substantial translation, AND both answer `modern_complete_exists: "no"` outright ("unclear" does not count).

| | books | works |
|---|---|---|
| visible `not_first` | 528 | 423 |
| read 1: a modern complete/substantial prior stands (stays `not_first`) | 433 | 333 |
| read 1: every recorded prior rejected (fabricated, different work, a study) | 46 | 46 |
| **read 1: candidate** | **49** | **44** |
| of which `first_modern` / `first_complete` | 35 / 14 | 31 / 13 |
| read 2 found a modern complete or substantial translation | 10 | |
| read 1 or read 2 answered "unclear" | 11 | |
| **both reads agree** | **28** | **23** |
| **recommended after the by-eye pass** | **24** (18 `first_modern`, 6 `first_complete`) | **19** |

By resolver (candidates / both agree): tier1_catalog 37 / 19, tier2_agent 10 / 8, gemini_verifier 2 / 1, others 0 / 0.

**Positive control.** All six Bartholomaeus Anglicus copies (five in the set, plus `69f32e09876dd827cbc43713`, which has no verdict at all) come out `first_modern` on BOTH reads: Trevisa c.1398 (printed 1495; Seymour critical text 1975-88, Middle English), Batman 1582 (early modern), *Mediaeval Lore* 1893/1905 (selections, modernised). The instrument passes.

**By-eye pass over the 28 agreed books.** Four excluded:
- Thomas Vaughan, *Magia Adamica* (`6981920896d524cea5bb59f1`): both reads say it was WRITTEN in English (1650). Our German 1735 edition translates from English, so the verdict is `not_applicable`. My classifier counted the English original as a prior; the reads themselves said it plainly.
- Ortelius, *Belgii veteris typus* (`69b525db29577f283b57bf11`): a single map sheet. A first-translation claim is ill-posed (likely `not_applicable`).
- *Kitāb al-Aghānī* Vols. 1-3 and Bedjan's *Acta martyrum* Vol. 1: `first_complete` is gated on OUR item being complete, and these are volumes.

Four kept and flagged in the file (`by_eye_note`): Aquinas' *Catena aurea* rests on Newman's 1841 translation (pre-1900 by the rule, Victorian English by eye); Albertus' *De mirabilibus mundi* rests on Best & Brightman 1973, an old-spelling critical edition of the c.1560 text (antiquated, as intended); Pseudo-Proclus *Sphaera* is excerpted from Geminus, which Evans & Berggren translated in 2006; Ficino's Latin Pimander is `first_modern` only under the source-language rule (Copenhaver 1992 is from the Greek). Of the 18 `first_modern` promotions, the newest complete prior is 1500-1799 for 17 and 1800-1899 for 1 (the *Catena*). None rests on Middle English alone.

**By eye: 20 random candidates** (seed 7797, from the 49).

| book | author | title | read 1 | read 2 | both agree | by eye | why |
|---|---|---|---|---|---|---|---|
| [96741e](https://sourcelibrary.org/book/69e534dad48480a38696741e) | Abu al-Faraj al-Isfahani | Book of Songs, Vols. 1–3 | first_complete | first_complete | yes | agree, but gated | Only selections (Sawa 2016, 2019). Ours is Vols. 1-3 of 20+, so first_complete fails the our-item-complete gate. |
| [8c5d36](https://sourcelibrary.org/book/69bfcca98ab50eb88e8c5d36) | John Chrysostom | Bodleian Library MS. Barocci 229 | first_modern | not_first | no | right to hold | The reads disagree on which text the manuscript holds (Matthew vs Genesis homilies). Identity first. |
| [f9b6f8](https://sourcelibrary.org/book/697b07993311b160c0f9b6f8) | Vrillac, Pierre de | Significant Motives for Leaving the Papacy | first_modern | no_english_found | yes | plausible | English 1621 from the French; Read 2 says our copy is the 1624 German version. Check the source-language rule. |
| [288eb7](https://sourcelibrary.org/book/69b21c1179013c3863288eb7) | Giovanni Lorenzo Anania | On the Nature of Demons | first_modern | not_first | no | right to hold | Read 2 counted Source Library's own translation as a prior; Read 1 found a 2023 Quail translation it marked unreal. Needs a look. |
| [85a52d](https://sourcelibrary.org/book/69c88a0d6c6f3cc53c85a52d) | [Maier, Michael] | Silentium post clamores, das ist, Apologi und Verantwortung | first_modern | first_modern | no | plausible, held | Russell 1676 only. Held because Read 1 said "unclear". |
| [649f0e](https://sourcelibrary.org/book/69b51d60261c58d636649f0e) | Maier, Michael | A Serious Game | first_modern | first_modern | yes | yes | Hall (as J. de la Salle) 1654 is the only English. |
| [e7177b](https://sourcelibrary.org/book/69907bdc5f855ec553e7177b) | Zakariya al-Qazwini | ʻAjāʼib al-makhlūqāt (MS Nn.3.74) | first_complete | first_complete | yes | yes | Only selections (Carboni 2015, Zadeh 2023). Our item is a manuscript; completeness not checked. |
| [1d3f13](https://sourcelibrary.org/book/69ac8e62e54b190acc1d3f13) | Isaac La Peyrere | Theological System Based on the Pre-Adamite Hypothesis | first_modern | first_modern | yes | yes | Anonymous 1655 English only. |
| [099aaa](https://sourcelibrary.org/book/69dbc8711040d1d5e2099aaa) | Bartholomaeus Anglicus | On the Properties of Things | first_modern | first_modern | yes | yes (control) | Trevisa 1398 (Seymour 1975 ed.), Batman 1582; Mediaeval Lore is selections. |
| [ea1ac1](https://sourcelibrary.org/book/69c1138537989a445aea1ac1) | John Calvin | Complete Works | first_modern | not_first | no | right to hold | Collected works, a container: not_applicable, not first_modern. |
| [eb5b9f](https://sourcelibrary.org/book/69a5f088b29703bc86eb5b9f) | Nerses Shnorhali (Nerses IV th | The Letters of Nerses the Gracious | first_complete | first_complete | yes | yes | Single letters only in English (1996, 2022). |
| [cc6072](https://sourcelibrary.org/book/69b6542618b87551bfcc6072) | Curione, Celio Augustino | Caelii Augustini Curionis Sarracenicae historiae libri III | first_modern | first_modern | yes | yes | Newton 1575 only. |
| [560632](https://sourcelibrary.org/book/69b4d647853c26e0d1560632) | Suchten, Alexander von | One Book on the Secrets of Antimony | first_modern | first_modern | no | plausible, held | 1670 Dr. C. only; held because Read 1 said "unclear". |
| [2dda3a](https://sourcelibrary.org/book/69b418b02b0edf3eaa2dda3a) | Pseudo-Solomon | True Keys of Solomon: French MS, 18th C. | first_complete | no_english_found | no | right to hold | Peterson excerpts only; Read 2 unsure. |
| [27cabc](https://sourcelibrary.org/book/69b52be83dd6d9423027cabc) | Marsilio Ficino | Ficino, Exposition on Hermes Trismegistus | first_modern | first_modern | yes | depends on a rule | Everard 1650 from Ficino's Latin; Copenhaver 1992 is from the Greek. First_modern only under the source-language rule. |
| [bc6466](https://sourcelibrary.org/book/6952d1a477f38f6761bc6466) | Kepler, Johannes | On the New Star in the Foot of the Serpent-bearer | first_complete | first_complete | no | plausible, held | One chapter in English (Graney 2018). Read 2 unsure. |
| [84b35c](https://sourcelibrary.org/book/69c824346c6f3cc53c84b35c) | [Cyranus] | Mysteria physico-medica, ob augustissimos suos natales | first_modern | first_modern | yes | yes | 1685 Magick of Kirani; Waegeman 1987 is book 1 amulets only. |
| [d99e3a](https://sourcelibrary.org/book/6975158da88d83c830d99e3a) | Trissmosin, Salomon | The Golden Fleece | first_complete | first_complete | yes | yes | Selections only; a compilation. |
| [2420b7](https://sourcelibrary.org/book/6984e8498a2f054f912420b7) | Comenius, Jan Amos | A Forerunner of Universal Wisdom | first_modern | first_modern | no | plausible, held | Hartlib 1642 only; Read 1 said "unclear". |
| [f4a6bc](https://sourcelibrary.org/book/69dbcc5c0f8c5edf20f4a6bc) | Thomas Aquinas | Golden Chain on the Four Gospels | first_modern | first_modern | yes | rule says yes; eye says doubtful | Newman 1841: pre-1900 by the rule, but Victorian English a modern reader reads easily. |

12 of the 20 agreed. Of those 12: 8 hold cleanly, 1 is plausible pending a source-language check (Vrillac), 1 fails the completeness gate (*Aghānī*), 1 depends on the source-language rule (Ficino), 1 is doubtful by eye (*Catena*, 1841). All 8 the reads did not agree on were right to hold: an identity dispute, a container, our own translation counted as a prior, or an "unclear".

**By eye: 10 random books that stay `not_first`** (seed 7797, from the 433).

| book | author | title | read 1 | read 2 | both agree | by eye | defeating modern translation |
|---|---|---|---|---|---|---|---|
| [0b463f](https://sourcelibrary.org/book/69dbcb3d1040d1d5e20b463f) | Plinius Secundus, Gaius (Pliny | Natural History | not_first | - | no | yes | Loeb (Rackham et al.), 1938-62. |
| [de0b07](https://sourcelibrary.org/book/69d5ad674dc55b8478de0b07) | Baegun (백운) | 직지심체요절 (Anthology of Great Buddhist Priests' Zen Teachings,  | not_first | - | no | yes | Cho and Jorgensen 2005, complete. |
| [c42099](https://sourcelibrary.org/book/69afeea157adc49dbfc42099) | Anonymous Sumerian | An Adab to An for Šu-Suen (Šu-Suen E) | not_first | - | no | yes | ETCSL translation (Zolyomi 2000). |
| [858d72](https://sourcelibrary.org/book/69c87e976c6f3cc53c858d72) | Vanderbeeg, I.C/von/[Orschall, | Manuductio hermetico-philosophica, oder richtige Handleitung | not_first | - | no | probably | McLean, Gold Unclothed 2025; Amazon is the only link. |
| [60769a](https://sourcelibrary.org/book/69ac5ef58efc70d51760769a) | Christiaan Huygens | Various Works, Volume 1 | not_first | - | no | yes, as a container | Blackwell 1986 Horologium; our volume is a multi-work Opera varia. |
| [2961ed](https://sourcelibrary.org/book/69b51e0dcf111105c42961ed) | Hermes, Trismegistus, ca. 2./4 | The Centiloquy, with poems on Hermes by Hilarius Mantuanus | not_first | - | no | yes | Holden 2008 (Five Medieval Astrologers). |
| [90b4cb](https://sourcelibrary.org/book/69b21e1b94025df5d290b4cb) | Plutarch; ed. Gregorios N. Ber | Moralia, Vol. 4 | not_first | - | no | yes | Loeb Moralia, Babbitt et al., 1927-. |
| [73de22](https://sourcelibrary.org/book/6991eaaf2f801130a473de22) | Leonardo da Vinci (ed. Ravaiss | The Manuscripts of Leonardo da Vinci, Vol. 5 | not_first | - | no | yes | Venerella 1999-2002. |
| [fc3867](https://sourcelibrary.org/book/694e7c5146953358dafc3867) | Comenius, Jan Amos (1592-1670) | The Vestibule of Comenius | not_first | - | no | weak | Only a 2017 "modernised retelling" posted on the Textkit forum. Not a published translation. |
| [776f69](https://sourcelibrary.org/book/6992ce7477d26f9321776f69) | Guru Gobind Singh; scribed by  | Sri Guru Granth Sahib | not_first | - | no | yes | Gopal Singh 1960, Talib 1984, Khalsa 2000. |


9 of 10 hold. The Comenius *Vestibulum* is defeated only by a forum post.

**Output.** `scripts/analysis/eval-data/ft-modern-candidates-2026-10-30.jsonl` (the same file as `scripts/output/ft-modern-candidates.jsonl` on the job box): the 49 candidates plus the extra control, each with book id, title, current verdict, resolver, proposed verdict, both reads (priors with tr_year, register, scope, URL, quote; queries; reasoning), `both_agree`, `recommended`, `by_eye_note`. Raw `claude -p` outputs: `/mnt/HC_Volume_105839809/jobs/ft-modern-7797/ft-modern-7797-raw.tgz` on main.

### Part 2. Census: any English vs readable modern English

**Rule.** (a) is the existing rule: a published English translation of any date. (b) is readable modern English: a real, same-text translation in the `modern` register, complete or substantial. Only the "translated" verdicts were re-checked (read 1 prompt, given the study's own cited priors); the `not_found` verdicts were not re-searched. A re-check that confirmed no English at all still counts under (a), as the study measured it; the "confirmed" column shows how many it could re-confirm.

**Latin** (June study, #2684, n=1000 clusters, the 846 well-posed). The sample is stratified (pipeline-translated stratum 216 of 6,744 clusters; gap stratum 630 of 158,737), so shares are population-weighted ratio estimates, as in `gap-validation-counts.mjs`. The 95% interval is Wilson at the Kish effective n (bootstrap variance, 4,000 draws, seed 7797). Per-stratum Wilson intervals are in `modern-english-census-2026-10-30.json`. (a) reproduces the paper's figures (15.08%, 6.72%).

| Latin, 1400-1700 USTC clusters | (a) any English | re-check confirms any English | **(b) modern English** |
|---|---|---|---|
| all print | 15.1% [12.8-17.8] | 11.9% [9.9-14.3] | **9.5% [7.7-11.6]** (by-eye corrected 10.0% [8.2-12.2]) |
| Renaissance-composed | 6.7% [5.0-8.9] | 4.2% [2.9-5.9] | **2.2% [1.4-3.4]** |

Strata, (b): translated stratum 148/216 (all) and 34/82 (Renaissance); gap stratum 44/630 and 8/553.

**The five vernaculars** (PR #7791, n about 300 each, a simple random draw, so plain Wilson). (a) is #7791's "any English (minus X)". N = composed in that language (#7791's origin tag).

| | n | (a) any English | **(b) modern English** | N, any English | **N, modern English** |
|---|---|---|---|---|---|
| German | 299 | 1.3% [0.5-3.4] (4) | **0.3% [0.1-1.9]** (1) | 0.3% [0.1-1.9] (1) | **0.0% [0.0-1.3]** (0) |
| French | 299 | 7.0% [4.6-10.5] (21) | **1.7% [0.7-3.9]** (5) | 1.3% [0.5-3.4] (4) | **0.0% [0.0-1.3]** (0) |
| Italian | 295 | 4.1% [2.3-7.0] (12) | **2.7% [1.4-5.3]** (8) | 1.7% [0.7-3.9] (5) | **1.0% [0.3-2.9]** (3) |
| Spanish | 299 | 4.7% [2.8-7.7] (14) | **2.7% [1.4-5.2]** (8) | 1.7% [0.7-3.9] (5) | **1.3% [0.5-3.4]** (4) |
| Dutch | 299 | 6.0% [3.8-9.3] (18) | **1.0% [0.3-2.9]** (3) | 0.7% [0.2-2.4] (2) | **0.0% [0.0-1.3]** (0) |

What drops out: the French and Dutch positives are mostly contemporary English pamphlets, Stuart declarations and *Gazette de Londres* issues (the re-check could not re-confirm 8 of the French 21, all *Gazette de Londres* issues; 10 of the 21 are E-tagged, editions translated FROM English). Every N-tagged positive in German, French and Dutch is an early modern English version, 1548-1632 where dated (Osiander 1548, the 1587 *Lyste des armes*, the 1590 *Memoire*, Guillemeau 1612, Oldenbarnevelt 1618, Puget de la Serre 1632). The modern N positives are Italian (Merici, Bellarmino, Catherine of Siena) and Spanish (López de Gómara, Teresa, *Siete Partidas*, a 1953 *capitulaciones*).

### Part 3. Resolver fix

PR #7798: `tr_year` and `register` on `CatalogPrior` / `PriorTranslation`. `isAntiquatedPrior()` lets a stated register decide, then the translation's year, then `pub_year`. When every decisive prior is antiquated, tier 0 proposes `first_modern`, weak and non-terminal (a catalog cannot establish that no modern translation exists). The Trevisa / Seymour 1975 case is the unit test.

### Caveats

- **Shallow searches.** Median 2-4 turns a call: most reads ran one or two searches. A modern translation a quick search misses would leave a book wrongly staged, which is why read 2 exists and why "unclear" never counts as agreement. Read 2 found a modern translation for 10 of 49 candidates. Read 2's own miss rate is unmeasured.
- **The 1900 line.** By the brief's taxonomy, 1800-1899 is `early_modern`. A Bohn or Oxford Movement translation is readable to a modern reader. Only one recommended promotion (*Catena aurea*, 1841) turns on it, but the census (b) column moves more: a 19th-century complete translation does NOT count as modern here.
- **Source language in the Latin re-check.** The re-check prompt said "THIS text", so for Latin versions of Greek works it sometimes counted only translations of the Latin. By eye, 8 of the 18 ancient/medieval rows that lost (b) have a modern English translation it missed or set aside (Loeb Plutarch twice, Paton's Polybius, Duff's *Disticha Catonis* twice, Showerman's *Heroides*, Knox's Vulgate, a modern Ovid). The all-print (b) is a floor; with those 8 it is 10.0%. The Renaissance-composed figure is unaffected.
- **46 books lost every recorded prior on read 1** (41 of them tier1_catalog): fabricated, a different work, or a study. That is a separate finding. They may be `first_no_prior`, but this run did not test it, and no second read ran on them.
- **Read 2 can cite Source Library.** On Anania, read 2 named Source Library's own translation as a prior. The prompt did not forbid it; the reads did not agree there, so nothing is staged on it.
- **Grouping.** Read 1 ran once per work. A group can still lump two texts; the per-book rows carry the group id.
- **Wilson on a weighted estimate** uses the Kish effective n, an approximation. Bootstrap percentile intervals are within 0.2 points of it.
