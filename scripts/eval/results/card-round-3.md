# Card round 3 — 2026-08-11

*Sample: 28 cards (16 entry-cards from the unverified tail, 6 English-original
suspects — cards whose works have English-language sibling books, 6
generic-title empties). Verifiers: 4 unprimed Claude subagents. 26 card
corrections applied same-day. Collection still has no readers.*

## Scores

**Entry claims (~44 checked, unverified-tail stratum):**
- FABRICATED: **2** (a "Jacobi 1951 Theological Works of Paracelsus" — conflated
  title; "Riddle 1992 A Treatise on Poisons" — invented from generic
  descriptions). **Cumulative: 5, all real-author/invented-title.**
- WRONG-content/wrong-text pins: **13** — the round's dominant class: medical
  works pinned as theological (Sigerist, Weeks), a *Lamia* translation pinned
  to the *Miscellanea* (Celenza), anthologies pinned to hymns they don't
  contain (SMR, Black 2004 ×2, Jacobsen, ANET — the ETCSL per-composition
  bibliographies were decisive), Badger pinned to the wrong volume AND wrong
  direction of Assemani, Stump's Latin-Boethius translation pinned to a codex
  carrying Planudes' GREEK Boethius, a study (Grafton) and a wrong archive.org
  item (Berwick link → Tredwell 1886).
- Material misdescription: Duckwitz "Speculum Historiale" = Book III of 31, a
  thesis.
- CONFIRMED clean: the famous ones — I Tatti Miscellanies 2020 (first into any
  modern language), La Peyrère 1655/56, Blount 1680/Berwick 1809/Conybeare
  1912 chain, Brown 1924, Kramer 1969, Trizin Tsering 2007, Kirkconnell 1973
  (partial).
- **One first-translation claim STRENGTHENED:** Paracelsus' theological corpus
  is genuinely untranslated — all four entries died, honestly emptying the card.

**Node addressing (the round's biggest structural finding):**
- **4 of 5 QID-keyed suspect cards are mis-keyed:** Q4071312 = *Asclepius*, not
  the Corpus Hermeticum (the flagship Pymander card!); Q134480351 = Vasubandhu's
  commentary, not the Diamond Sutra; Q138752489 = a Venetian translation-item;
  Q42425573 = the Potts ENGLISH translation, at volume grain. All → work-merge
  queue with target QIDs identified.
- Duplicate-work: the Mani bKa' 'bum splits across two collection-local ids —
  translations were already being pinned to both.
- Container: Valla's Opera Omnia card carried constituent-work translations as
  if the container were translated.

**Absence claims:**
- Testable absences attacked: 1 refuted at CYCLE level but not at the card's
  volume grain (Phurdrup dGongs 'dus Na — Lotsawa House's Lama Gongdü series
  exists; the volume's contents are unenumerated). Recorded as a GRAIN error,
  not a missed prior; cumulative clean-miss count stays **0/14**.
- UNIDENTIFIABLE: 5 of 6 generic-title cards ("…sogs" miscellany labels,
  generic ritual titles) — absence untestable; the class should be excluded
  from card generation.
- CATEGORY ERROR: 2 more English originals (Southcott 1813; Vaughan's Magia
  Adamica — our book is the GERMAN translation of his English original, the
  inverted case). English-original screen: 3 rounds, 5 instances — top priority.

## Error classes (trend)

| class | r1 | r2 | r3 | note |
|---|---|---|---|---|
| fabricated_entry | 0 | 3 | 2 | 5 total, one signature; verification-only catch |
| wrong_attribution/content | 1 | 4 | 13 | explodes on the unverified tail; ETCSL-style per-work bibliographies are the antidote |
| missed_prior | 0 | 0 | 0 (1 grain) | searches remain unbeaten |
| node mis-key / category / grain | 2 | 4 | 12 | THE dominant defect class overall — identity, not search |
| entry hygiene | 3 | 4 | 8 dedupes/fillers | write-rules catch most; dedupe rule still pending |

## What sharpened

1. **The QID layer needs its own audit** — 4/5 sampled QID cards mis-keyed.
   Rule: a card keyed to a QID must verify P31 is a WORK (not
   version/edition/translation) and the label matches the card title. Cheap,
   scriptable, and exactly the lesson-verify-every-wikidata-qid memory predicted.
2. **"…sogs"/volume-label containers excluded from card generation** as a class.
3. **English-original screen is now non-negotiable** before card creation
   (5 instances in 3 rounds), including the INVERTED case (our book is a
   translation OF an English original).
4. **Per-work scholarly bibliographies beat open-web search** for entry
   verification (ETCSL's per-composition bibliographies settled 6 claims
   decisively). Where a tradition has one, the verifier should start there.
5. The unverified tail's entry defect rate (~35%) vs the verified head's (~10%)
   quantifies exactly what "verified" buys — and why the label rule reads only
   clean, reviewed cards.
