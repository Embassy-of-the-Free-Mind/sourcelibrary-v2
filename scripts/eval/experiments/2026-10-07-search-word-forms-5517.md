## 2026-10-07 · After the first word-form fix, which forms of a word still find a fraction of what their sibling finds? (#5517)
<!-- PRIOR ART: scripts/eval/experiments/2026-10-06-site-search-recall-5905.md scores /api/search for book recall on names and concepts; it has no word-form pairs. PR #5518 (the first fix) reported one number, the "botanical" filter going 0 → 114, and no query list. -->

- **Question.** #5518 folded word forms in the catalogue book lane and the collections lane, and the issue stayed open. Does a reader who types an adjective, a plural or an agent noun now get what the noun gets, and does the folding touch non-Latin queries?
- **Answer.** The issue's own examples were fixed by #5518 (botanical 122 books = botany 122). What was left is every word whose root has four letters, plus plurals in -es and agent nouns: the first rules needed five letters after the suffix. "magical" found 35 books where "magic" finds 176, "optical" 1 where "optics" finds 51 (97 before, 46 of them Coptic titles matched inside the word), "astronomer" 2 where "astronomy" finds 295, "witches" 27 of 52. After the second pass the typed form finds **0.98** of what its best sibling finds, up from **0.54** (mean of 24 queries that have siblings; a count ratio, capped at 1). The 13 non-Latin and control queries return the same book ids in the lane, before and after.
- **measure:** agreement between forms (how many books the lane returns for the typed form against the count for its sibling). It is not accuracy: nobody judged the added books relevant. Result lists for magical, optical, astronomer, herbal, witches and surgical were read by eye before and after, and the lane's losses and gains were read as titles.

### Design

- 38 fixed queries in `scripts/eval/search-word-forms/queries.json`: the issue's 3, 4 long-root adjectives, 8 short-root, 4 plurals, 3 agent nouns, 3 multi-word, 7 non-Latin (Chinese, Arabic, Hebrew, Devanagari, Greek, Cyrillic), 6 controls (Latin, German with an umlaut, two names, a word with no forms, a two-word Latin title).
- `lanes.harness.ts` runs this checkout's code on production data: the catalogue lane (`searchBookIds`, limit 1000, ids kept), the Atlas page stage (pages matched), and the real `/api/search` and `/api/search/unified` handlers. Before = `main` at 1fb8c4764. After = this PR. `compare.mjs` prints the table.

### Result (catalogue book lane, books for the typed form / for its best sibling)

| kind | queries | before | after |
|---|---|---|---|
| named in the issue | 3 | 1.00 | 1.00 |
| long root (astronomical, theological, anatomical, kabbalistic) | 4 | 0.91 | 1.00 |
| short root (magical, mystical, musical, medical, surgical, poetic, herbal, optical) | 8 | 0.19 | 1.00 |
| plural (witches, herbs, prophecies, emblems) | 4 | 0.84 | 0.90 |
| agent noun (alchemists, astronomer, magician) | 3 | 0.34 | 0.99 |
| multi-word | 2 | 0.20 | 1.00 |

- **On the route.** `/api/search` book rows in the first 50: optical 2 → 39, astronomer 2 → 46, magician 6 → 39, surgical 23 → 50, musical 24 → 45, mystical 30 → 49. Collections on the All tab: optical 0 → 3 (Optics first), magician 0 → 3 (Magic first).
- **Pages.** The Atlas page lane was left alone. Every form of every query matches at least 13,000 pages (non-Latin: 57 to 100,000+), so no reader gets an empty passage list from a word form, and widening there would only reorder.
- **What got worse.** (1) "herbs" 157 → 100 in the lane: the 76 lost titles were read and are all noise the old unanchored `%herb%` matched (Herbipolensis = Würzburg 30+, Herborn, Herbert, Scherbius, Guelpherbytanus). (2) "botanical" collections 2 → 1: stems now match only at the start of a word, so the collection whose description says "ethnobotanical" is no longer returned for "botanical"; Herbalism & Botany still is. The anchor is what stops "optical" returning every Coptic title. (3) One or two ids lost on astrological, astronomical, witches for the same reason (a stem inside a longer word).
- **Rejected on the way.** A single widened query: the lane returns an unordered sample of `limit` rows, so 40 of the 176 "magic" books at random could drop every title that says "magical". Shipped instead: the typed form's rows first, related forms fill the rest. A bare `herb` stem: it starts Herborn, an academy named in hundreds of imprints. A general -al or -er rule: "general" → "gener", "silver" → "silv". Ordering collections by size alone once folding widened them: "poetic" lost the Poetry collection; name matches now come first.
- **Latency.** Catalogue lane, 38 queries, two runs each: `searchBookIds` median 303–312 ms → 389–394 ms, p90 459–495 → 446–578; `searchBooksCatalog` median 125 → 162–193 ms. The second query runs in parallel and only when a word has related forms.
- **Caveats.** "botanical gardens" reaches books keyed botany + garden only through the Mongo fallback, a regex scan with a 3 s limit: 21 book rows in one run, 1 in the others (timed out, `degraded_lanes: ["book"]`, as before the change). The artwork lexical lane was counted directly (as typed → with forms: herbal 0 → 17, surgical 1 → 14, magician 10 → 37, Paracelsus 5 → 5), not through the route, whose artwork count mixes a vector lane that times out under load.
- *Replicated?* The after run was taken four times while the rules were tightened (the lane counts above are from the last; the earlier ones differ only where a rule changed). Before was run twice; lane counts agree. One after run lost the related-forms query for one word to a transient error and returned the typed rows only (179 → 12, back to 179 on four retries): that is the designed fallback.
- **Artifacts.** `scripts/eval/search-word-forms/` (queries, harness, compare, `results/2026-10-07-{before,after}.json`).
