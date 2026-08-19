# Card round 1 — 2026-08-11

*Method: `.claude/docs/translation-card-method.md`. Sample: 12 cards from the
919-card phase-1 seed (6 with entries, 6 empty), random within strata, drawn
2026-08-11. Verifiers: 4 independent Claude subagents (subscription), unprimed
on the absence side. All card corrections applied same-day as reviewed edits
(review notes carry `card-round-1 2026-08-11`); nothing reader-visible changed
(the collection has no readers yet).*

## Scores

**Entry cards (6 cards, 14 checkable entry claims):**
- CONFIRMED with resolving records: 8 (incl. one title correction — Leeser 1848)
- Reclassified honestly: 1 (De Quincey 1824 = abridged free adaptation of
  Buhle, his own words: "abstracted, re-arranged… improved")
- WRONG attribution: 1 — the Gangtey card pinned Reynolds 1989 to the wrong
  text entirely (Reynolds translates Karma Lingpa's *gcer mthong rang grol*;
  the generator glossed the Tibetan title into English and grabbed the
  best-known "Self-Liberation…" translation). **The AI-conflation signature:
  a title gloss + a famous nearby work.**
- Filler/unverifiable-as-written: 3 entries across 2 cards ("Cyranides
  (various)", "Partial translations of the introduction", "None (complete
  edition)") — extraction noise, not knowledge.
- FABRICATED: **0**

**Empty cards (6):**
- Absence HELD under genuine refutation attempts: 5 of 6 — including two
  title-trap exclusions the verifiers caught (Kirton 1576 = Innocent III, not
  Arévalo; Wagenseil's *Tela Ignea Satanae* ≠ Grynaeus) and one constituent
  caveat added (Neyphug phur dbang vs Boord's byang gter translations).
- CATEGORY ERROR: 1 — Samuel Parker 1666 is an English original (EEBO A56390);
  the card should never have existed. Book-grain verdict also wrong.
- Missed priors: **0**
- Bonus metadata catch: the Ferdinand II "proclamation" is an anonymous
  partisan pamphlet — author field wrong on the book record.

## Error classes (per method doc)

| class | count | where the fix goes |
|---|---|---|
| fabricated_entry | 0 | — |
| wrong_attribution | 1 | card fixed; suggester rule: NEVER pin an entry via an English gloss of the title — require the prior's own identity to match |
| missed_prior | 0 | — |
| wrong_work_identity / category | 2 (Parker; Ferdinand author field) | cards fixed; book-grain records need the same fix (English-original screen; author correction) |
| entry hygiene (filler / uncited) | 3 entries | cards fixed; suggester rule: no citation → no entry (placeholder text is not an entry) |

Card-level defect rate (substantive): 2/12 ≈ 17% (Wilson 95% ≈ [5%, 45%] — round
2 should grow n before quoting this anywhere).

## What sharpened

1. **Suggester rule (adopted):** an entry requires its own citation — no
   placeholder text, no gloss-matched attributions. Both round-1 entry defects
   die under this one rule.
2. **Write-time consistency check (to add):** status `no_prior_known` with a
   non-empty entries list is a contradiction — reject at write.
3. **English-original screen** belongs before card creation (the Parker class) —
   `english-source-detect.mjs` exists for exactly this.
4. **The searches themselves are good.** Round 1 found zero missed priors and
   zero fabrications — consistent with the paper's finding that failures are
   identity/hygiene, not search competence. The card model concentrates
   exactly there, which is the point.

## Next round

Round 2: n=24 (grow the CI), stratified the same way + include 4 cards from the
62 sibling-disagreement set, and run the two new write-time rules on the
proposals before verifiers see them (measure how much the rules alone catch).
