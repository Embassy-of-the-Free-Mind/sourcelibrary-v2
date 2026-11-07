---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 2979
n_pages: null
verdict: "Model-merged clusters that no second judge saw hold a different work 8.0% of the time [4.1–15.0], about 159 of 1,987. Legacy seed clusters are also at 8.0% [3.2–18.8], about 14 of 169. Wikidata/catalogue is 5/95 (5.3%), or 4/95 (4.2%) on clear calls only. Clusters that passed the October second judge are 0/100 [0–3.7], rule merges 0/50 and Kanripo 0/50. Title+author sits between the lines at 3.0%. These are floors, read from records with one image and a few title pages opened. The planted gate passed at 60/60."
status: informational
decision: "Over-merging is a real gap in two routes and a borderline one in a third, so #8293 proposes a sized lane to judge, read and split them. Nothing was repaired. The October second judge is not the problem, and #8291 stays open until this lands."
superseded_by: null
issue: [8291, 8293, 7761, 4246, 3258]
router_evidence: "none — a catalogue-identity measurement, no OCR or translation route"
feeds: [repair]
---
## 2026-11-07 · How many live work_id clusters hold more than one work, per way the cluster was made? (#8291)
<!-- PRIOR ART: scripts/eval/work-recall/merge-precision.mjs judges PROPOSED merge groups and cannot sample live clusters or plant errors; gap-validation-cluster-audit.mjs and work-grouping-check.mjs audit USTC clusters and the phase-11 graph, not books.work_id; 2026-10-30-verified-work-merges-7761.md measured the merge lane before it applied, this measures what is live afterwards. -->

**Why.** #7761 measured what `work_id` misses. Nothing had measured what it wrongly joins in live clusters, and the fix for each is opposite.

**Frame.** 71,228 live books (`visible: true`, `pages_count > 0`), 541 with no `work_id`, 49,918 ids, **5,432 clusters with 2+ books** (26,201 books). Read-only; nothing in production was written.

**The route mapping in the brief was wrong, so I changed it.** A row in `work_id_merges` does not mean a model merged the id. Of 1,733 rows, 1,272 are llm-verify + Sonnet; 461 are identical-title, volume-set, edition-conflict, canon-registry or hand. And 1,987 model-merged clusters carry `work_id_source: work-merge:llm-verified` with no llm row (1,957 no row at all, 30 only a rule row), because `llm-verify-work-merges.mjs --apply` writes books and no row. They predate the October second judge. Routes below use both the rows and the book-level source.

**Method.** A seeded sha256 draw per route (`overmerge-8291-2026-11-07`); all 95 Wikidata/catalogue clusters. `claude -p --model sonnet`, no tools, 6 clusters a call, 117 calls on the subscription, sees title, author, year, language and page count. Second read by me, route-blind, of everything flagged plus 30 random `all_same_work` and 20 random `contains_volume_or_part`: 168 clusters. Three routes got a 6+ top-up (65 clusters), used only in size bands and book rates, never in a headline rate.

**Gate, read before any rate.** Planted clusters built from two live work_ids, each read first: **60/60 caught [94–100]**, easy 30/30, hard 30/30, all as `contains_different_work`. Known-good controls: 29/30 `all_same_work`, 1 container (Joubert's *De peste* in French really does add other pieces), 0/30 different-work false alarms. Passed.

### Result: uniform draw, confirmed on second read

| route | clusters | books | n | different work | est. clusters | container | books in affected clusters | #8291 line |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| model merge, no second judge | 1,987 | 6,507 | 100 | **8 (8.0%)** [4.1–15.0] | ~159 [81–298] | 17 | 13.0% [5.6–20.6] | **≥5%: repair proposed** |
| legacy seed | 169 | 641 | 50 | **4 (8.0%)** [3.2–18.8] | ~14 [5–32] | 3 | 6.9% [0.9–14.5] | **≥5%: repair proposed** |
| Wikidata / catalogue (census) | 95 | 344 | 95 | **5 (5.3%)**, 4 clear | the 5 named | 23 | 8.4% [1.6–17.3] | **≥5%, only with the arguable call** |
| title + author | 823 | 2,063 | 100 | 3 (3.0%) [1.0–8.5] | ~25 [8–70] | 3 | 4.4% [1.2–8.7] | between the lines |
| model merge, second-judged | 1,252 | 3,505 | 100 | 0 [0–3.7] | 0 | 6 | 1.1% [0–3.6] | under 2% on the point; interval reaches 3.7 |
| rule merge | 250 | 963 | 50 | 0 [0–7.1] | 0 | 0 | 0 | under 2% on the point; interval reaches 7.1 |
| Kanripo | 856 | 12,178 | 50 | 0 [0–7.1] | 0 | 0 | 0 | under 2% on the point; interval reaches 7.1 |

"Books in affected clusters" is post-stratified by size band with a cluster bootstrap, and counts every book in a cluster, not just the odd one out. Across all routes that is roughly 1,050 of 26,201 books (4%), or 7.5% without Kanripo. Summing the routes gives about 203 clusters, 3.7% of the frame.

**Volume-or-part, which is not an over-merge** (judge counts, uniform draw): second-judged 3/100, no second judge 16/100, title + author 20/100, Wikidata 27/95, legacy 30/50, rule 48/50, Kanripo 50/50. The rubric calls these different records and #8291 reports them apart. In the 20 I read, 18 were volumes and 2 were the same work.

**Size matters.** Rates rise with cluster size in every route with hits except legacy seed, whose bands are too thin to say (1/7 and 0/7 above two books). No second judge: 2 books 4/62, 3–5 books 4/32, 6+ books 4/25. Title + author: 1/81, 2/17, 3/25. Wikidata: 1/46, 1/34, 3/15. The 6+ top-up found the only different-work cluster in the second-judged route: Buxtorf's Chaldaic grammar filed with the Zohar.

### Sensitivity: where the label's bar moves the number

| route | clear only | + arguable (headline) | + clear containers | + all containers |
|---|---:|---:|---:|---:|
| model merge, no second judge | 7.0% | 8.0% | 17.0% | 25.0% |
| legacy seed | 8.0% | 8.0% | 12.0% | 14.0% |
| Wikidata / catalogue | **4.2%** | **5.3%** | 17.9% | 29.5% |
| title + author | 3.0% | 3.0% | 4.0% | 6.0% |
| model merge, second-judged | 0 | 0 | 1.0% | 6.0% |
| rule merge, Kanripo | 0 | 0 | 0 | 0 |

- **The arguable call decides Wikidata's line.** It is `catalog:bdrc:WAEAP676-12-16`, a generic title over what are probably separate texts. One more cluster, `catalog:pandit:41774`, stayed undecided.
- **Containers would put title + author and the second-judged route over 5%,** but only with the arguable ones: an edition of a work that adds commentary or other pieces, such as a 1720 Grotius *De iure belli* that adds *De mari libero*. #8291's threshold counts different works, so containers stay out of the headline.

### How far to trust this

- **These are floors.** The second read covered 168 of 610 clusters. It found no misses in the 30 `all_same_work` or the 20 volume clusters, which only bounds the miss rate near 7% across both (0/50). Of the 27 `unsure`, 4 were different works.
- **Records hide some of it.** Chrysostom's *Lucubrationes* was three different works under one catalogue title (*De fato et providentia*, homilies on Romans, commentary on Galatians), which the judge called `unsure` and only title-page OCR settled. Planted pairs are two clearly titled works, so 60/60 says nothing about this kind of error.
- **By evidence.** Of the 28 different-work labels (uniform and top-up), 27 come from records and 1 from OCR. Only one claim here was checked by eye: the Suetonius 1518 volume, where Erasmus's preface on page 9 presents Suetonius with the Historia Augusta writers. It is a clear container. OCR also cleared the Clm 18971 *Asclepius* and a Rasatarangini pair as the same work.
- **The judge needed the second read.** Of its 28 different-work calls, 23 held: 3 were volumes (Adam-Tannery's *Oeuvres de Descartes* and a Loeb Statius among them) and 2 containers. Container calls held 57/63.
- **The second-judged 0/100 flatters itself somewhat.** The October gate and this judge are the same kind of reader on the same records, so what October missed this judge tends to miss too. 0/100 against 8/100 is unlikely to be chance (one-sided Fisher p = 0.003), and it matches the gate doing its job, but it is not an independent check.
- **Kanripo and rule merge have thin second reads:** 4/50 and 3/50. The judge called nearly all of them volumes, which is expected of Kanripo's per-juan records, and the 20 volume reads back that up.

### What the different-work errors look like

- **A generic head covering separate pieces** (no second judge): Redi on insects and on vipers, Estienne's separate garden booklets, Aretius on 1 and on 2 Corinthians, Alberti's two dissertations.
- **The wrong work filed under a name** (Wikidata and no second judge): *Liber aggregationis* under *Secreta mulierum*, Boethius *De institutione musica* under the *Arithmetica*, Lull's *Ars generalis ultima* under *Ars brevis*.
- **A Wikidata id on a shelf of a whole author:** `Q108374728` (Aristotle, Ptolemy and Hero) and `Q135214551` (Cicero and a Macrobius codex).
- **A narrow shape in title + author:** Tesla's separate patents under one generic title (3 clusters, one of them a top-up) and the empty-author key `local:n::1`, which files Otogizoshi with Solovyov's letters. Empty-author `local:n::` keys come to 31 clusters and 86 books.

### What follows

#8293 proposes the repair, sized: judge about 2,000 clusters (~330 calls), read about 610, split about 170 [86–330]. It needs a split writer first and a log row on the `--apply` path. Containers need typed relations (#3258) rather than splits. Nothing was repaired here. The list: `scripts/eval/work-recall/overmerge-confirmed-8291.jsonl` (28 different work, 62 container, with bar, evidence and note). Script: `scripts/eval/work-recall/overmerge-audit.mjs`; planted set: `overmerge-planted-8291.jsonl`.
