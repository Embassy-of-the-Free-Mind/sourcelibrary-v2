# Decision-card audit (#5873), replayed from stored results

## flash-translation-5740 · T2
- card: routing · tier: large · sufficient: **false**
  - Greek: n 75, decision, cleared true
  - missing — preregistration: margin and minimum effect were not fixed before the run
  - missing — judge: not calibrated against readers of the original (required: large stake, absolute threshold, or same model family as the candidate)
  - missing — replication: none on ≥ 30 fresh books under the same rule

## flash-translation-5740 · T4
- card: routing · tier: medium · sufficient: **false**
  - Arabic: n 20, exploratory, cleared false, short by 10
  - Persian: n 12, exploratory, cleared false, short by 18
  - Hebrew: n 15, exploratory, cleared false, short by 15
  - Aramaic: n 5, exploratory, cleared false, short by 25
  - missing — preregistration: margin and minimum effect were not fixed before the run
  - missing — per-language evidence: Arabic (n 20, short by 10), Persian (n 12, short by 18), Hebrew (n 15, short by 15), Aramaic (n 5, short by 25)

## flash-translation-5740 · T5
- card: routing · tier: large · sufficient: **false**
  - Pali: n 16, exploratory, cleared false, short by 14
  - Sanskrit: n 28, exploratory, cleared false, short by 2
  - Chinese: n 24, exploratory, cleared false, short by 6
  - missing — preregistration: margin and minimum effect were not fixed before the run
  - missing — judge: not calibrated against readers of the original (required: large stake, absolute threshold, or same model family as the candidate)
  - missing — per-language evidence: Pali (n 16, short by 14), Sanskrit (n 28, short by 2), Chinese (n 24, short by 6)
  - missing — replication: none on ≥ 30 fresh books under the same rule

## reocr-backfill-a5-5700
- card: backfill · tier: large · sufficient: **false**
  - Arabic: n 9, exploratory, cleared false, short by 41
  - Chinese: n 5, exploratory, cleared false, short by 45
  - Greek: n 14, exploratory, cleared false, short by 36
  - Pali: n 6, exploratory, cleared false, short by 44
  - Persian: n 6, exploratory, cleared false, short by 44
  - Sanskrit: n 10, exploratory, cleared false, short by 40
  - missing — preregistration: margin and minimum effect were not fixed before the run
  - missing — sample: pages were selected (low scorers); a backfill is sized on a random page of the stratum
  - missing — undo: no revision row per page with a restore proven on one page
  - missing — judge: wrong-page, planted-change and duplicate controls did not all pass
  - missing — judge: not calibrated against readers of the original (required: large stake, absolute threshold, or same model family as the candidate)
  - missing — per-language evidence: Arabic (n 9, short by 41), Chinese (n 5, short by 45), Greek (n 14, short by 36), Pali (n 6, short by 44), Persian (n 6, short by 44), Sanskrit (n 10, short by 40)
  - missing — replication: none on ≥ 30 fresh books under the same rule

## folio-markers-5678
- card: prompt · tier: medium · sufficient: **false**
  - latin: n 70, decision, cleared false
  - non_latin: n 30, directional, cleared false
  - missing — guards: a preregistered guard failed
  - missing — per-language evidence: latin (n 70: the effect does not clear the floor and the minimum effect), non_latin (n 30: the effect does not clear the floor and the minimum effect)
  - missing — pool or replication: a medium stake needs a registered homogeneous pool at decision grade, decision grade alone, or a replication

## persian-hidden-flash-5795
- card: routing · tier: medium · sufficient: **false**
  - Persian: n 27, exploratory, cleared false, short by 3
  - missing — preregistration: margin and minimum effect were not fixed before the run
  - missing — per-language evidence: Persian (n 27, short by 3)
  - missing — pool or replication: a medium stake needs a registered homogeneous pool at decision grade, decision grade alone, or a replication

## ocr-trust-gate-5761
- card: gate · hold · sufficient: **false**
  - Greek manuscripts: n 12, 2.54 [1.86, 3.23], provisional, 18 books to a standing gate
  - Greek print 1450–1599: n 15, 3.4 [2.86, 3.94], provisional, 15 books to a standing gate
  - Persian: n 12, 2.96 [2.39, 3.52], provisional, 18 books to a standing gate
  - Latin incunabula: n 10, 3.55 [2.89, 4.21], not supported, 20 books to a standing gate
  - missing — preregistration: the threshold was not fixed before the run
  - missing — stratum Latin incunabula: upper bound 4.21 is not under 4

## vernacular-pooling-t3
- pooling allowed: false; differ from the pool: French

