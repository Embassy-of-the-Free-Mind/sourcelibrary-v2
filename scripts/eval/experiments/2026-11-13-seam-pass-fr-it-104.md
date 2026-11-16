---
stage: translation
measure: [judged]
languages: [fr, it]
scripts: [Latn]
canons: []
n_books: 51
n_pages: 399
router_evidence: "none — a seam term on french-cli-agy4 and italian-cli-agy4, not page-acceptance k/n for rules.json; recorded in scripts/eval/estimator/router-table/2026-11-13-seam-pass-fr-it-104.json and as evidence on both rows of scripts/lib/translation-routing-table.json (seam_pass 'edit-before' on French only)"
defect_rates: scripts/eval/route-judge-6740/results/seam-fr-it-104/defect-rates.json
verdict: "French passes the pre-registered rule. Over 72 stored French block starts (44 books), the built seam pass cut broken joins from 15/72 to 6/72 (9 better, 0 worse, sign p=0.002, 8 books). Inside-block joins were unchanged at 6/72, with no new leak. On the 18 pages it changed, the page judge accepted 15/18 against 14/18 stored, with no new wrong text. Italian fails. The stored Italian has 0/27 broken block starts, so the pass had nothing to repair, and on 1 of the 3 pages it changed it broke a sound join (a word hyphenated across the page break read as a doubled catchword; confirmed by eye)."
status: adopted
decision: "seam_pass 'edit-before' on french-cli-agy4 (PR on v3#104). No change on italian-cli-agy4. After the merge, the sample's judged-better French repairs are written under run id seam-fr-it-104-<ts>."
landed: scripts/lib/translation-routing-table.json
superseded_by: null
issue: [104, 8399, 7118]
feeds: route
---
## 2026-11-13 · Does the seam pass help French and Italian too? (v3#104)
<!-- PRIOR ART: 2026-11-08-seam-pass-stage-8399.md (the stage, the #7118 seam judge, the planted defects, the rule's
clauses and the noise floor are reused unchanged; this asks the same question on two more cells). Harness:
scripts/eval/seam-prevent-7118/seam-fr-it-104.mjs. -->

**Answer for Derek.** French: turn it on. The pass fixes most of the broken page breaks at the start of each 4-page call
(15 → 6 in 72) and makes no page worse. Italian: leave it off. The stored Italian had no broken block start in the
sample, and the one real edit the pass made there broke a correct join.

### What ran
- **Pre-registered** on v3#104 (comment 6847449929) before any model call. This run followed it.
- **Sample** (seed 104, Mongo reads only). Visible French/Italian books routed to `french-cli-agy4` / `italian-cli-agy4`,
  pages translated by agy `gemini-3.8-flash-low` through `cli-translate.mjs`. Each block is one whole stored production
  call of 2 to 4 pages, all prose, with eligible English on the page before. French: 72 blocks from 44 books (at most 2
  a book). Italian: only 7 books hold a usable multi-page call. 14 primary blocks plus 13 from a deeper stratum gives 27
  (18 of them in 3 books). The draw was re-checked byte for byte against the committed one before the stage ran.
- **Arms.** A = the stored English. S = the built stage (`seamStage`, edit-before on), one agy Flash-low call per block
  at the turn into it: 99 calls on the `.agy-milo` pool, all answered, 0 stale blocks. L = S with the page before
  locked (reported only). Nothing was written to a page.
- **Seam judge.** The #7118 prompt on Opus 5.5, blind version names, both orders, at the block start (S) and at one
  seeded turn inside each block (T). 198 joins, 396 calls, all parsed. Each call also carried a copy of A and a planted
  defect.
- **Page judge.** route-judge-6740, Opus with the image open, one page a call, on every page S changed (21 pages,
  13 books), A and S each, plus 6 wrong-page controls a language and 3 repeats of A. paired-arm.mjs `check` passed (R1
  waived as pre-registered: up to four changed pages a book).
- **By eye.** Five joins, both scans (below), recorded as `seam-fr-it-104-by-eye` book_checks rows (reader_warning false).
- **Cost.** About 460 Opus calls on the subscription (list price $19.78 for the seam judge), 99 agy calls. $0 paid.

### Results (per 100 joins; S = block start, T = inside a block, lane = 0.75 T + 0.25 S)

| cell | arm | S | T | lane | new leaks |
|---|---|---|---|---|---|
| French (72 blocks, 44 books) | A stored | 15/72 (20.8) | 6/72 | 11.5 | — |
| | S pass | 6/72 (8.3) | 6/72 | 8.3 | 0 |
| | L locked | 14/72 (19.4) | 6/72 | 11.1 | 0 |
| Italian (27 blocks, 7 books) | A stored | 0/27 | 2/27 | 5.6 | — |
| | S pass | 0/27 | 2/27 | 5.6 | 0 |

French S against A: 9 better, 0 worse, sign p = 0.002, from 8 books. Δ −12.5 per 100 [−20.8, −5.6], against the 1.7
floor. Lane Δ −3.1 [−5.2, −1.4]. Most of the gain again comes from editing the page before the block: locked, S falls
by only 1 (L against A: 1 better, 0 worse). Of the 33 French block starts that open mid-sentence, A breaks 8 and S breaks 2.

**Page judge, pages the pass changed** (Opus, image open):

| cell | pages (books) | accept A | accept S | gained / lost | wrong text A / S / new in S | wrong-page accepted | repeat flips |
|---|---|---|---|---|---|---|---|
| French | 18 (11) | 14/18 | 15/18 | 2 / 1 | 1 / 1 / 0 | 0/6 | 0/3 |
| Italian | 3 (2) | 2/3 | 1/3 | 0 / 1 | 0 / 1 / 1 | 0/6 | 1/3 |

**Controls.** Same text twice: French 144/144, Italian 54/54 (≥ 95%). Planted defects caught: 143/144 and 52/52 (≥ 80%).
No wrong-page control accepted. Neither language is void.

**What the stage did.** French: 72 turns, 19 labelled broken by the pass (5 catchword, 5 omission, 4 broken_syntax,
3 duplication, 2 other). It changed 12. It edited the page before on 10 and the first page on 8. The span and size guards
refused 6, and 1 came back with no repair. Italian: 27 turns, 4 labelled broken (3 broken_syntax, 1 catchword) where the seam judge found
none. It changed 2 and refused 2.

### The rule (pre-registered, per language)
| clause | French | Italian |
|---|---|---|
| 1. fewer broken block starts (Δ < −1.7, lane not up, sign p < 0.05, ≥ 3 books) | pass (−12.5, p 0.002, 8 books) | fail (0 → 0) |
| 2. no new leak | pass (0) | pass (0) |
| 3. pages not worse (accept S ≥ A − max(2, flips), no new wrong text) | pass (15 vs 14, 0 new) | fail (1 new wrong text) |
| 4. controls | pass | pass |
| **verdict** | **pass** | **fail** |

Italian is a fail, not "cannot decide": clause 1 fails on the size of the change, not on the sign test or the book
count, and clause 3 fails too. The primary 14-block stratum gives the same picture (0/14 broken at S in every arm).

### Five joins opened by eye (both scans)
1. **Italian, *L'Idea de' Pittori* pp.25|26, where the pass made it worse.** p.25 ends "& ori-" with the catchword
   "gine,"; p.26 opens "gine, e luogo proprio". It is one word, *origine*, split across the leaf. The stored English
   ("intellect and origin, / and the proper place") is right. The pass read the split as a doubled catchword. It cut
   "and origin" from p.25 and wrote "is the origin and proper place" on p.26, a verb the source does not have. The page
   judge's wrong-text call on S is right. This is a failure mode of the pass's prompt: a hyphenated word whose second half
   is also the catchword.
2. **French, *L'escole des filles* pp.151|152, the French page that lost acceptance.** The catchword "prie" is printed
   at the foot of p.151 and again at the head of p.152. A renders it twice ("I beg you." / "I ask,"), and S removes the
   doubled "I ask,". The repair is correct. The lost acceptance on p.151 comes from a defect at its head that is
   byte-identical in A and S, so it is judge variance, not the pass.
3. **French, *Collection des Anciens Alchimistes Grecs* III pp.129|130, a major break.** "du Scoliaste de Pin-" /
   "dare (p. 81)". A gives "Scholiast of Pin..." / "(p. 81)" and never names Pindar. S gives "Pin-" / "dar (p. 81)".
   The repair is correct.
4. **French, Huygens *Œuvres* XXI pp.793|794 (bilingual), a page that gained acceptance.** The Latin p.793 ends "nec
   ſuperat;", and the French facing page opens "périeure —", the end of *supérieure*. A renders it as a stray "rior,"
   and S deletes it. Better, but "superior" is lost in both. The gain in acceptance is within noise: the same two
   defects are flagged in A and S.
5. **French, *Correspondance de Christophe Plantin* pp.268|269, an edit at a join both seam-judge orders called ok.**
   "…qui ont sceu et bien esprouvé le contraire" / "de leurs calumniations": one sentence. A closes it early ("the
   contrary." / "of their slanders.") and S joins it ("the contrary" / "to their slanders."). The repair is correct,
   and the judge had missed this break. Separately, the stored English of p.268 renders the carried-over footnote word
   "latine." as a heading, "A note regarding the Latin text:". The pass does not touch it. It is recorded as a
   `misleads` defect on the page: the rest of the note is the leaf's text, so the page was not withheld.

So the judges' calls held on all five. The one Italian edit is a real regression. The French edits are repairs, one
of them partial.

### Limits
- One stored read per block. There is no second production read here, so the noise floor is v2#8399's Latin/German swing
  (S 1.7). French's gap (12.5) is seven times that.
- Italian rests on 7 books, and the stored Italian blocks were nearly clean at the block start. That says the Italian
  @4 English rarely breaks there, not that the pass would work on Italian that did.
- The page judge saw 21 changed pages. "No new wrong text" in French is 0/18, which bounds the rate below about 17% (95%).
- `defect-rate.py` was not run. It reads its own fixed corpus and has no input for an outside packet. The same per-route
  rates (misleads and wrong text per 1,000 words, mean fidelity) are in `defect-rates.json`, computed from this run's
  verdicts. French A and S are equal on both (1.96 and 0.15). Italian S has 0.77 wrong text against 0. The pre-registered
  page clause (3) is the test that decides.

### Written after the rule passed
The 9 French joins the seam judge scored better (stored broken, pass sound; 0 scored worse) were written to the served
pages through `scripts/lib/seam-pass.mjs` applySeamPass (health check, neighbour gate, one revision row per page) under run
`seam-fr-it-104-20261113130231`: 13 pages in 8 books, 9 of 9 joins, none skipped. The other 5 joins the pass changed (3 French
the judge scored sound both ways, 2 Italian) stay as stored. Manifest and the rows written:
`scripts/eval/results/seam-fr-it-104/apply/`; undo with `seam-repair.mjs undo --out=<a dir holding that manifest.jsonl>`.
