# FT badge sign-off — CUMULATIVE diff (all 22 badged candidates, Rounds 1–4)

*Independent Stage-2 `ft-verify` re-check of every BADGED demote/remove candidate the #2880 pilot surfaced across all four rounds. **Measure-only — NO badges flipped.** Goes to Derek for sign-off; flips need explicit approval + a backup + the `first_translation_attempts` provenance write (deferred to apply, see Logging below).*

> **Why this binding step:** the pilot oracle is a single Tier-2 pass. CLAUDE.md requires an INDEPENDENT re-verify before any public bibliographic flip — and it earns its keep: **3 of 22 oracle-proposed demotes were wrong** (a partial-only prior or a different-recension prior the oracle over-trusted as "complete"). A blanket apply would have wrongly stripped 3 genuine firsts.

## Result: 20 valid (3 remove + 17 demote) · **3 SAVED** (badge stands)

### SAVED — oracle was wrong, badge STANDS (do NOT flip)
| book_id | work | why the demote is invalid |
|---|---|---|
| 69e787604a6785cfd60cb761 | Bum Tha (Śatasāhasrikā Prajñāpāramitā vol. tha) | 84000/Sparham published only ch. 1–28 (~8 of 12 vols); our vol. tha (vol. 10) is **not yet in English** — partial prior |
| 69ae9cde0cfd89c490b715d1 | Herculaneum Volumina V (Philodemus, *Rhetorica*) | Hubbell 1920 is **"a paraphrase, not a translation"** (his own preface, gaps by conjecture); modern Chandler 2005 covers only Books 1–2 — no complete modern prior |
| 69e7887a4a6785cfd60d113d | Atiśa Tārā phreng-mo divination (Drametse/Bhutan) | Nielsen 2019 translates a **different recension** (Drikung Kagyu, Kham/Nangchen) with "very different contents" — not a prior for our Drametse text |

### VALID REMOVE (3) — already-English / wordless art
| book_id | work | round | basis |
|---|---|---|---|
| 69aec4473b6ebce5e0ee5929 | The Federalist (1788) | R1 | English original |
| 699246babc722ec0ee8120e8 | Wycliffe Bible Vol. 2 | R4 | Middle English (already English) |
| 69b4cce0d5b6c3815e1a2892 | Moninckx Atlas vol. 9 | R3 | wordless botanical plates |

### VALID DEMOTE (17) — confirmed complete + modern prior
| book_id | work | round | confirmed prior |
|---|---|---|---|
| 69dbcbea1040d1d5e20bb356 | (ps-)Seneca, De quattuor virtutibus | R1 | Barlow 1969 + James 1924 |
| 69c1baee8522835be845b7b6 | Festival prayer book (maḥzor) | R1 | S&P Prayer Book 1965 |
| 69b525c12f891867c1ae4ac0 | Raleigh, Waerachtighe Beschryvinghe (Dutch) | R1 | Raleigh's English original 1596 |
| 69b4c08186a5921d5bc4418f | Ficino, Corpus Hermeticum | R2 | Copenhaver 1992 |
| 69a5e484006a4098422176a4 | Chronicle of Zuqnin (Cod. Vat. Syr. 162) | R2 | Harrak 2017+1999 |
| 69b51e19efd8df28f2db0768 | Pymander/Rosselli vol. 1 | R3 | Copenhaver 1992 |
| 69b51e18768235dc6598c1b7 | Pymander/Rosselli vol. 6 | R3 | Copenhaver 1992 / Mead 1906 |
| 69d5acf04dc55b8478dde728 | Ge'ez Psalter | R3 | NETS 2007 + all English Psalters |
| 6953a82c77f38f6761bd0bc5 | Armenian NT (trilingual) | R3 | KJV 1611 + modern (scripture) |
| 69dfede68d34461cbe7f4df4 | Genji Monogatari vol. 1 | R3 | Seidensticker 1976 / Tyler 2001 |
| 69e747e685f786e884a49e40 | Poetic Edda | R3 | Bellows 1923 / Larrington 1996 |
| c4aa9f54-…-9b786b4d9954 | Boethius, Consolation | R4 | Watts 1969 / Walsh 1999 |
| 69c72aca6a0f3d112faf6f49 | van Helmont, Adumbratio Kabbalae | R4 | Spector 2012 (Brill) |
| 697b079ae303c59b5d833abc | (ps-)Tauler, Exercitia | R4 | Cruikshank 1875/1906 |
| 6a09dd2724d4d312f5c30ebe | Galen, jeu de la paume (French) | R4 | Singer 1997 / Johnston 2018 |
| 69a5e461006a409842216e78 | Cod. Vat. Syr. 160 (Life of Symeon) | R4 | Doran 1992 (Lent 1915 is wrong recension — verify corrected the grounds) |
| 69c1bc3e8522835be84620a8 | Yemenite Hebrew Bible | R4 | KJV 1611 + JPS/Alter (scripture) |

## On sign-off (Derek-gated; NOT done here)
For each of the **20 valid** (and ONLY those 20 — leave the 3 SAVED untouched):
1. Back up the affected `books` docs first.
2. Set `is_first_translation:false` (+ remove the public claim) for the 17 demotes; for the 3 removes, additionally clear the candidate state.
3. **Write the provenance** to `first_translation_attempts` via `appendAttempt()` with `method:'claude_subagent_verify'`, the per-book `queries_run` + `sources_consulted` + verdict + prior + url.

## Logging status (answer to "is all logging in place")
- **Durable file logging — IN PLACE.** Every verify wrote a per-book JSON with `queries_run` + `sources_consulted` + verdict + reasoning: `scripts/eval/results/ft-verify/` (R1/R2, 7 files) and `ft-verify-r3r4/` (R3/R4, 16 files), consolidated `ft-verify-r3r4-2026-06-30.json`. Full audit trail on disk.
- **Mongo `first_translation_attempts` provenance — deliberately DEFERRED to apply.** This is the binding write per the `ft-verify` skill, but it belongs to the sign-off-gated apply, not the measure-only pilot (matching the R1/R2 signoff pattern). It is **safe** to write — `derive-from-evidence.ts` never auto-flips the public `is_first_translation` boolean (that needs the sign-off-gated reconcile), and the discover-prior cron is guarded against url-less/fabricated priors (#2892/#2244) — but the established pattern is to write it as step 3 of apply.

## Provenance
23 independent `general-purpose`/`sonnet` subagents total (7 R1/R2 earlier + 16 R3/R4), real WebSearch/WebFetch, directional demote/remove prompts requiring a COMPLETE + MODERN (post-1900) prior for a demote to survive. Raw per-book JSON in `scripts/eval/results/ft-verify/` and `ft-verify-r3r4/`.
