---
stage: metadata
measure: [judged, agreement]
languages: [de]
scripts: [Latn]
canons: []
n_books: 1000
n_pages: null
verdict: "Of German works first printed 1400–1700 (phase-11 frame, 221,931 works with a USTC edition), 6 of 999 well-posed in a uniform draw were composed in German and have a published English translation: 0.60% [0.28–1.30], about 1,330 works [610–2,890]. Adjusted for Gemini's measured sensitivity (4 of 9 on the 254 double-read works), about 1.1% [0.3–3.6], or 2,400 [620–8,000]. All six were first printed in the 1500s (6/141); none of the 841 works from the 1600s were. Any published English, including German editions that are themselves translations of Latin or other works: 2.4% [1.6–3.5] (24/999), about 5,300 [3,600–7,900]. Excluding newspaper issues does not change the counts, because no issue is a positive. Luther: 6 drawn, 5 in English, but only 1 composed in German. 2026-11-03."
status: informational
decision: "No write. The German N figure for the #7956 article is ~1,300 [600–2,900] uncorrected; the sensitivity-adjusted ~2,400 rests on 9 double-read positives and is the better point, with a wide interval. The Luther-only prior of ~300–860 is compatible: 1 of 6 drawn Luther works is a German composition in English."
superseded_by: null
issue: [7954, 7751]
---
## 2026-11-03 · How many German works first printed 1400–1700 have ever been published in English? n=1,000 (#7954)
<!-- PRIOR ART: scripts/eval/experiments/2026-10-30-translation-share-by-language.md (the n=300 October run, same frame, seed, prompt, instrument and origin rules; this run extends its German draw to 1,000); scripts/analysis/translation-share-sample.mjs, gap-validation-cli-adjudicate.mjs, translation-share-estimate.mjs (sampler, adjudicator and estimator, unchanged). -->

**Question.** The October run (n=300) found exactly one work composed in German with an English translation. That gives a 95% interval of 130–4,200 works, which is too wide to use. This run extends the same seeded draw to 1,000 works to narrow it. It is a measurement only. Nothing was written to Mongo, Supabase, `translation_catalogs` or any store a cron reads.

**Frame and draw.** Phase-11 German works with at least one USTC edition: **221,931**. Of these, 69,646 are newspaper issues (every edition has no sn), which leaves 152,285 without them. The draw is `translation-share-sample.mjs --lang german --n 1000 --seed 7751`. The shuffle is seeded, and it was asserted that GE001–GE300 are the same works, with the same blind cards, as October (0 mismatches). Of the 1,000 drawn, 314 are newspaper issues.

**Instruments** (October's, unchanged):
- **Gemini on all 1,000:** `gap-validation-cli-adjudicate.mjs --lang german --engine agy`, Gemini 3.8 Flash-low with grounded `search_web`. October's 300 verdicts were kept and 700 new ones run, this time on the default agy pool; October used the second account. All 1,000 calls searched, and none failed.
- **Blind Sonnet second read on 254:** `--model sonnet --subset 200`. The seeded 200-subset of the 1,000 contains only 6 of October's 60, so the new 200 were run (194 calls) and October's 60 kept, 254 in all. The union over-weights GE001–GE300 slightly. That does not bias the sensitivity estimate, because both subsets are random with respect to the verdict.
- **Tiebreak on the 7 disputes:** a third Sonnet read, given both verdicts, that has to open the URLs. In two of them (GE177 from October, GE983 new), Gemini claimed a translation and the tiebreak rejected it. Five are new: Sonnet found a translation and the tiebreak confirmed it. The five ran with `CLAUDE_PACE_OFF=1` at concurrency 2, because the box's pace guard held the job's own children past the 15-minute call timeout.

**Binary rule:** translated vs not found. Unsure and container verdicts are left out of the denominator; one container (GE121, a hymnal) was dropped, leaving n = 999 well-posed works.

**Origin tags** were hand-assigned from each positive's own prior, quote and URL text, using October's rules (`origin-tags.json`):
- **N:** composed in German.
- **V:** the edition is a translation of a third-language work that exists in English.
- **E:** translated from English.
- **X:** the evidence does not support the claim.

October's four German tags were kept unchanged (GE097 V, GE157 E, GE171 V, GE193 N). No X was found among the 24.

### Result

| measure | all works (n=999) | → works in frame (×221,931) | excl. newspaper issues (n=685) | → works (×152,285) |
|---|---|---|---|---|
| **N: composed in German, in English** | **0.60% [0.28–1.30]** (6) | **1,333 [612–2,894]** | 0.88% [0.40–1.90] (6) | 1,334 [612–2,890] |
| N, adjusted for Gemini sensitivity | 1.10% [0.28–3.60] | 2,444 [622–7,998] | — | — |
| N + V | 2.10% [1.38–3.19] (21) | 4,665 [3,060–7,085] | 3.07% [2.01–4.64] (21) | 4,669 [3,067–7,068] |
| any English (N+V+E, minus X) | 2.40% [1.62–3.55] (24) | 5,332 [3,594–7,878] | 3.50% [2.37–5.16] (24) | 5,336 [3,602–7,858] |
| Gemini alone, any English | 2.1% [1.4–3.2] (21) | | | |

All intervals are Wilson 95%. The adjusted N row counts the 2 N positives in the double-read subset (2/254) at face value and scales the 4 that Gemini found outside it (4/745) by 1/sensitivity (0.444). Its interval comes from a 4,000-rep parametric bootstrap over both counts and the 9-positive sensitivity. It rests on only nine positives, so treat its interval as indicative.

Positives by origin: **N 6, V 15, E 3, X 0.** No positive is a newspaper issue, so excluding issues changes the denominator, not the count.

**By century of first printing** (well-posed works):

| century | n | any English | N |
|---|---|---|---|
| 1400s | 8 | 0 | 0 |
| 1500s | 141 | 14 (9.9%) | 6 (4.3%) |
| 1600s | 841 | 9 (1.1%) | 0 |
| 1700 | 9 | 1 | 0 |

The 1600s carry the newspaper issues and the bulk of the frame. Every German-composed translation found is a sixteenth-century Reformation, mining or catechetical text.

**The six N positives:**

| key | author | short title | first print (frame) | English translation | URL |
|---|---|---|---|---|---|
| GE193 | Osiander, Andreas | *Catechismus odder kinderpredigt* (Brandenburg-Nuremberg) | 1533 | Thomas Cranmer, 1548, via Justus Jonas's 1539 Latin | https://www.worldcat.org/title/836814234 |
| GE502 | Ercker, Lazarus | *Beschreibung allerfürnemisten mineralischen Ertzt und Berckwercksarten* | 1574 | Sir John Pettus, *Fleta Minor*, 1683; A. G. Sisco & C. S. Smith, 1951 | https://www.worldcat.org/oclc/6817296 |
| GE506 | anonymous | *Probier buechlin auff gold, silber, kupffer und bley* | 1539 | A. G. Sisco & C. S. Smith, *Bergwerk- und Probierbüchlein*, 1949 | https://www.worldcat.org/oclc/894982 |
| GE540 | Spangenberg, Johann | *Auslegunge der Episteln und Evangelien … in Frag[stücken]* | 1553 | Matthew Carver, *The Christian Year of Grace* (Concordia); the 2018 date is the model's, not confirmed on a page | https://www.cph.org/catalog/product/view/id/26272 |
| GE591 | Luther, Martin | *Der gros catechismus und kinder lehre* (Large Catechism) | 1551 | J. Stirewalt, in the Henkel *Book of Concord*, 1851 (and many since) | https://archive.org/details/christianbookofc00henk |
| GE736 | Karlstadt, Andreas | *Wider die alte und newe papistische Messen* | 1524 | Amy Nelson Burnett, *The Eucharistic Pamphlets of Andreas Bodenstein von Karlstadt*, 2011 | https://www.psupress.org/books/titles/978-1-935503-16-3.html |

"First print (frame)" is the earliest year among the editions phase 11 grouped into the work. For GE591 that is 1551, not 1529, because this cluster holds the later editions.

**The V and E positives** (for the record):
- **V:** GE097 de la Puente (Spanish); GE171 Tasso (Italian); GE179 the Dutch war declaration of 1675; GE230 and GE656 Spalatin's German versions of Luther's Latin *Tessaradecas* and *Confitendi ratio*; GE338 Spandounes (Italian); GE370 Daza (Spanish); GE440 and GE785 Luther's Latin Psalm lectures in German (Ps 2, Ps 130); GE509 Erasmus *De pueris* (Latin); GE532 the *Spiritual Combat* (Italian/Spanish); GE646 Bourignon (French; the 1699 English was made from this German edition); GE770 Charles V's answer to Paul III, 1543 (English from the Latin, moderate evidence); GE826 Campion *Decem rationes* (Latin); GE858 Hornschuch *Orthotypographia* (Latin).
- **E:** GE157 Pearse; GE409 Joseph Hall; GE690 Burnet.

**Second opinion and sensitivity** (254 double-read works):
- Agreement 247/254, κ = 0.52.
- Truth is agreement where the two reads agree, and the tiebreak where they do not. On that basis there are **9 confirmed translations, and Gemini found 4: sensitivity 0.44.** October measured 0.62, pooled over five languages.
- Gemini missed both N positives in the subset (GE540, GE736). It also missed three V positives: two contemporary pamphlets (GE179, GE770) and a 1915 Luther volume (GE230).
- Gemini's two claims in the subset that the tiebreak rejected (GE177, GE983) give a specificity of 0.992 (243/245).
- The estimator's pooled Rogan–Gladen correction of the any-English share gives 2.9% [0.0–11.5].
- Because Gemini misses about half, the 745 single-read works almost certainly hold more N positives than the 4 found. That is why the adjusted row is the better point estimate, even though its interval is wide.

**Luther cross-check.** 6 of the 1,000 drawn works are Luther's, which puts about 1,330 [610–2,890] Luther works in the frame (the brief counted 1,507). Five of the six are in English (GE230, GE440, GE591, GE656, GE785), but four of those five are German versions of his Latin (V). Only the Large Catechism (GE591) is N. GE697, the 1521 *Antwort … vor K.M. und Fursten des Reichs* (Worms), was single-read by Gemini as not found, and may be a miss. Luther "any English" at 5/1,000 gives about 1,110 [470–2,590], against the brief's ~300–860 (9 of 25 random Luther works in English). The two overlap. With six works, the sample cannot distinguish them. What it does show is that most Luther-in-English in this frame is the V kind, which the N count excludes.

**Other.** Catalogued recall (`ext` among positives) is 1 of 24 (GE502). Source Library holds 112 of the 1,000 drawn and has 2 readable. 594 of the cards are anonymous.

**Caveats**
- **Gemini sensitivity is about 0.44 here.** Uncorrected shares are low, and the N count most of all: both double-read N positives were Gemini misses. The adjustment rests on 9 positives.
- **Origin tags were read from the verdict text, and the URLs were not reopened.** GE770 (V) and GE540's translation year are moderate.
- **The frame year is the cluster's earliest edition, not the composition date.** Wrong merges, about 5 in 30 for German in October, can attach a later edition to an earlier work, or the reverse.
- **The instrument account changed.** October's 300 Gemini reads ran on the second agy account and the 700 new ones on the default pool. The model, prompt and tool gate are the same.

**Replicated?** The blind Sonnet second read on 254 works, with a third read on all 7 disputes.

**Artifacts** (box clawdbot, `$JOB_SCRATCH/artifacts/` = `/mnt/HC_Volume_105839809/jobs/german-share-7954/artifacts/`; `scripts/output/` is gitignored):
- `german-{frame,blind,grouping}.json`
- `german-{agy,sonnet,tiebreak}-verdicts.jsonl`
- `german-final-verdicts.jsonl`, `german-estimate.json`, `summary.json`, `origin-tags.json`, `german-report-7954.json`
- The pristine October inputs are in `../october/`.

**Cost.** Gemini: 700 Flash-low calls, 2.2% of the default pool's weekly allowance (17.1% → 14.9% remaining). Claude: 200 Sonnet reads (194 plus 6 retried for a JSON close-quote quirk) and 5 tiebreaks on the box subscription. The account meter went 72% → 81%, but that meter is shared with this job session and other jobs. $0 API.
