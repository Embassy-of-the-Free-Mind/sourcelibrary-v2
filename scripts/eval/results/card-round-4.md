# Card round 4 — 2026-08-11

*Sample: 24 cards (12 entry from the unverified tail, 8 empty, 4 random) + a
new LIVE-RENDER bucket (4 production pages checked against their Mongo cards).
Verifiers: 5 unprimed subagents + inline render checks. 23 card corrections
applied same-day. The cards are LIVE on production throughout this round.*

## The round's pre-finding: regeneration clobbers review

Before sampling, a routine reseed **restored two spot-check-removed
fabrications onto a live card** — the seeder rebuilds entries from the
append-only ledger, where bad priors live forever; reviewed corrections lived
only on the cards. Caught minutes later by post-write verification; all 42
prior-round corrections reapplied; the seeder now skips any card with a
round stamp (PR #3928). New error class: `regeneration_clobbers_review`.
Standing rule: **verify after every bulk write to a live store.**

## Live-render bucket (new this round) — paid off immediately

- **A Southcott English original wore the "First Translation" chip in
  production** — the English-original class proven reader-visible; silenced
  by card edit within minutes.
- The search-record line rendered **raw grounding URLs**; fixed with hostname
  collapse + display names (PR #3930).
- Vives and Viridarium rendered their priors correctly in the plain voice.

## Scores

**Entry claims (~60 checked):**
- **FABRICATED: 3** — "Yirmeyahu 2020 Or Yakar" (also wrong-work: that's
  Cordovero's commentary), "Whitfield 2014 Cosmographia" (absent from his own
  bibliography), "Ethan Lin 2026" (Amazon returns zero results for the alleged
  Amazon book). **Cumulative: 8.** The signature is now precise: *fabrications
  cluster at recent dates with hyper-specific titles* — exactly where a
  verifier's priors are weakest.
- **MISSED REAL TRANSLATIONS FOUND: 3** — Sherwood 1917 (Vives *De
  subventione*, predates the card's 1999 entry), Berg 2003 (complete 23-vol
  Zohar), Skinner/Clark 2019–21 (*Ars Notoria*). First finds in this
  direction; all at entry level on container-adjacent cards.
- Wrong-text pins: 6 (Betty→Theophilus with the container mechanism PROVEN —
  our Gesner 1546 edition is the *Ad Autolycum* editio princeps bound with the
  Melissa; Dawson+Dyson→De regimine Judaeorum; Vollert→Compendium;
  Chapman→the 1636 Harmonie; Beveridge 1851 disproven by checking all three
  Tracts TOCs).
- Reclassified: Peterson (edition of Turner 1657, not a translation event);
  Soncino Zohar partial *per its own translators' preface*; Collins 1939 =
  Part II of De articulis only — **Part I remains untranslated** (a live
  first-translation opportunity); Kravitz = second-hand via Lucas's French.
- Dedupe carnage: Zohar 13→3, Aquinas 17→1(+moves), La Peyrère 6→1.
- Work-level identity: **Viridarium mis-attributed** (Stolcius, not Maier —
  books metadata fix); Clavius card's slug says "spinoza-works" (mis-key).

**Absence claims (12 attacked):**
- **FIRST REFUTATION in the method's history**: Clavius *Gnomonices* — a
  complete English translation published 2026-08-07 by Ars Astronomica…
  **AI-assisted, self-described "reading grade," translated with Claude.**
  → POLICY QUESTION (Derek): does an AI-assisted web translation defeat a
  first-translation claim? By that standard our own output defeats absence
  claims. Entry listed with its nature stated; badge semantics await the call.
- HELD: 5 (incl. two cycles positively identified — Terdak Lingpa's Rigdzin
  Thugtik; Jamgön Kongtrul's Tsasum Gongdü — real bibliography, no English).
- CATEGORY ERROR: 2 more English originals (Southcott 5th part — third
  Southcott instance; Westcott, with **~17 more Westcott English pamphlets in
  the same pipeline**). Cumulative English-original instances: 7.
- UNIDENTIFIABLE / SHELF-UNIT: 5 — including the round's structural insight:
  **Tibetan archival bundles contain heavily-translated canonical
  constituents** (Kunzang Mönlam, Heart Sutra, Three Principal Aspects), so a
  bundle-level absence claim is not merely untestable but *misleading*.
- METADATA: Vitringa's Dutch book is itself a translation (d'Outrein 1715,
  from Latin — stated on its own title page); original_language fix owed.

## Error classes (trend)

| class | r1 | r2 | r3 | r4 |
|---|---|---|---|---|
| fabricated_entry | 0 | 3 | 2 | 3 (cum. 8; recent-date signature confirmed) |
| missed_prior (clean, at claim grain) | 0 | 0 | 0 | 0 — but 1 REFUTATION by 2026 AI translation (policy) + 3 missed entries found |
| wrong_attribution/content | 1 | 4 | 13 | 6 |
| node/category/grain | 2 | 4 | 12 | 9 (incl. 2 English originals, 5 bundles) |
| entry hygiene (dupes/fillers) | 3 | 4 | 8 | ~30 collapsed |
| regeneration_clobbers_review | — | — | — | 1 (guarded, PR #3928) |

## Rules earned this round

1. **English-original screen is now blocking** — 7 instances in 4 rounds; the
   Westcott class alone is ~17 more cards. Wire `english-source-detect.mjs`
   into card generation as a hard gate.
2. **Entry dedupe by translation EVENT** (translator+work, year-fuzzy) — the
   Zohar's 13→3 proves string-level dedupe insufficient.
3. **Bundle exclusion widened**: 'thor bu'/'sna tshogs'/'sogs'/truncated
   ritual titles → `text_unidentified` at generation, never `no_prior_known`.
4. **Post-write verification after every bulk write to a live store**
   (the reseed lesson, now standing).
5. **Container mechanism documented**: entries pin to whatever volume the
   ledger row touched; decomposition (constituent work cards) is the fix —
   Gesner/Aquinas/Vives/Valla now all demonstrate it.
6. **Policy queue for Derek**: AI translations as defeaters; informal web
   translations as entries (currently retained, labeled).
