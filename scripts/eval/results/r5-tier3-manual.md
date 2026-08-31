# Round 5 — Tier 3: manual read (Claude, main session)

**Written BEFORE any Tier-1 or Tier-2 result was seen.** That ordering is the
whole point: a third tier that reads the other two first is not a third
observation, it is a rubber stamp.

**What this tier does that the other two cannot.** Tiers 1 and 2 search the open
web. This tier reads **our own scan** — the OCR of the actual pages, the
metadata, the slug, the page-type markers. Most of the findings below are
invisible to any amount of web searching, because they are defects in *our*
record rather than facts about the world.

**Method limit, stated up front.** I read the first four pages of each book by
ascending `page_number`. For several books those are covers, endpapers and
blanks, so my read is shallow on: Socinus (returned soft-hidden negative page
numbers), Tacitus, Lucan, Plato, Auctoritates. Where I judged those on domain
knowledge rather than on our pages, I say so and mark confidence accordingly.

| # | Book | Badge | My verdict | Conf | Basis |
|---|---|---|---|---|---|
| 1 | Wei Yuan, 海國圖志 "(41)" | badged | `needs_review` | low | **Volume identity is wrong.** Catalogued juan 41; the running headers on our own pages read 卷八十 (juan 80), 籌海總論四. A firstness claim keyed to the wrong juan is unassessable. |
| 2 | Drametse, "same as vol.187" | badged | `needs_review` | high (on the defect) | Title is a **cataloguing placeholder**. Text unidentified → an absence claim over it is meaningless (round-2 rule). Should not carry a public badge. |
| 3 | Gangtey, "Jam dpal nag po'i chos skor" | badged | `needs_review` | high (on the defect) | **Catalogued Tibetan; the scanned pages are Sanskrit in Newari/Prachalit/Ranjana script.** Metadata and scan disagree about what the book *is*. Cannot be judged until identity is resolved. |
| 4 | Bar Hebraeus, *Ascension of the Mind* | badged | `first_no_prior` (provisional) | moderate | No complete English known to me. But our copy is **Nau 1899 — a Syriac + FRENCH critical edition**; needs confirming we rendered the Syriac, not Nau's French. |
| 5 | Socinus, *Bibliotheca Fratrum Polonorum* | badged | `first_no_prior` (provisional) | moderate | Socinian corpus is largely un-Englished. But this is a multi-author **library** (Socinus, Crell, Schlichting, Wolzogen) — judge per content, not per volume. |
| 6 | Lazarone, *Quaestiones controversas* | badged | `first_no_prior` | high | 8-page 1620 legal disputation; the obscurity is real, not a search failure. |
| 7 | Porphyry *Isagoge* + Aristotle, **Vat. gr. 243** | badged | **NOT `first_no_prior`** — `first_from_source` at best | high | The Isagoge and Aristotle's logic are among the most-translated texts that exist. Defensible only as "first translation of THIS manuscript witness". An unqualified badge over-claims. |
| 8 | Bauhin, *Apotherapeia iatrikē* | badged | `first_no_prior` | moderate-high | 12-page 1581 medical disputation. |
| 9 | Jāmī, *Al-Durra al-Fākhira* | unbadged | `not_first` | high | **Nicholas Heer, *The Precious Pearl*, 1979** (I wrote "Yale" from memory; the oracle established it is **SUNY Press**, ISBN 0873953797 — my publisher was wrong, the prior was right). Our own record already carries Heer's English title. Separately: our scan's title page reads الطبعة الأولى ١٤٢٢هـ (2001 CE), so `published: 1480` is wrong and this is a **modern in-copyright print**. |
| 10 | Averroes, Hebrew comm. on *Physics* V | unbadged | `first_from_source` candidate | low-moderate | Averroes' Physics commentary has English scholarship; the Hebrew recension specifically may be un-Englished. |
| 11 | Avicenna, *al-Qānūn fī al-Ṭibb* | unbadged | `not_first` | high | O. C. Gruner, *A Treatise on the Canon of Medicine* (1930), Book I; later Bakhtiar editions. |
| 12 | Han Yu, *Changli xiansheng ji* | unbadged | `not_first` | moderate-high | Han Yu's prose is widely translated (Hartman 1986 and others). The English on p2 is a **Harvard-Yenching bookplate**, not a translation. |
| 13 | Tacitus, *Opera* (Elzevir 1665) | unbadged | `not_first` | very high | Domain knowledge; our pages are binding shots. |
| 14 | Lucan, *Pharsalia* | unbadged | `not_first` | very high | Marlowe 1600, Rowe 1718, Braund 1992. |
| 15 | Plato, *Platonis Opera* (Burnet 1902) | unbadged | `not_first` | very high | Burnet's OCT Greek text. |
| 16 | *Auctoritates Aristotelis* (1499) | unbadged | `needs_review` | moderate | No complete English of the **florilegium as a compilation** known to me (Hamesse's 1974 critical edition is Latin). Also: slug ends `-6` → **duplicate records** of this incunable. |

## What this tier found that web search structurally cannot

Five of sixteen books carry a defect in **our own record**, not in the world:

1. **Wei Yuan** — wrong juan number (41 vs 80 on the page).
2. **Gangtey** — catalogued language contradicts the script on the scan.
3. **Drametse** — placeholder title standing in for an unidentified text.
4. **Jāmī** — `published: 1480` against a 2001 imprint on the title page; a
   modern in-copyright edition sitting in the corpus.
5. **Auctoritates** — duplicate records (`-6` slug suffix).

Three of those five are **badged**, and in all three the badge is unassessable
rather than merely wrong: you cannot claim to be first to translate a text you
have not correctly identified. This is the work-identity dependency (#4329,
#2318) showing up as a first-translation error, exactly as the identity-family
ordering predicted.

**Prediction, recorded before the oracle reports:** tiers 1 and 2 will return
confident verdicts on books 1, 2 and 3 — because a searcher given a title and an
author has no way to discover that the title does not describe the book. If that
happens, it is not an oracle failure; it is evidence that **an identity screen
must run before the search tier**, not after it.
