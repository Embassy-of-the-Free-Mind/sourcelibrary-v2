## 2026-10-02 · Can a $0 reference table settle translation-note facts before a model is paid to? (#5647 stages 1–2)
<!-- PRIOR ART: 2026-10-02-note-facts-full-tibetan-run-5624.md (PR #5640) judged all 359 candidate notes with subagents; this builds the standing $0 lane that #5647 asks for and scores it against those verdicts. 2026-10-02-are-the-facts-translation-notes-add-right-5624.md (PR #5632) supplied the page-apparatus controls (A09, A14). -->

**Question.** #5624 found 18 of 359 candidate notes in the Tibetan run wrong or partly wrong, all identifications or Sanskrit equivalents, at ~24M tokens of subagent time. #5647 (Derek approved 2026-10-02) asks for a standing lane that settles what it can for $0 and pays a model only for the rest. How much can a table settle, and is it safe — does a `conflict` mean wrong, and does a `match` ever hide a wrong note?

**Design.** $0. Writes only the new `note_claims` collection. No note was corrected.
- **Stage 1, extract** (`scripts/maintenance/note-claims-extract.mjs`). It uses the #5624 cue filter, ported verbatim from `candidate-filter.py` into `scripts/lib/note-claims.mjs`. There is one row per candidate `<note>`, plus one per name or number in `<summary>`, `<keywords>` and headings. Each row carries page id, book id, note text, claim kind, the parsed claim (Sanskrit forms grouped as alternatives, the quoted Tibetan) and the translation's `content_hash`. The script is idempotent on (hash, extractor version): a re-run wrote 0 rows, and a changed translation replaces its page's rows.
- **Stage 2a, Tibetan↔Sanskrit table** (`scripts/maintenance/build-tib-skt-table.mjs`). The table has 52,990 pairs, and every row names its source and licence:
  - 84000 TEI glossaries for the 396 Kangyur texts already on the box (25.7K pairs). Licence: CC BY-NC-ND 3.0, checked in each file's `<availability>`.
  - The 84000 glossary dump from christiansteinert/tibetan-dictionary (18.4K pairs, same licence).
  - The Mahāvyutpatti, DILA digital edition (9.4K pairs, no licence stated).
  - Rangjung Yeshe 3.0 (552 pairs, © E. P. Kunsang). Only entries marked `Skt.`, a bracketed IAST compound, or a bare name are used.

  The table stays on Hetzner (`/root/factcheck-lane/refs/`) and is **not in git**: the builder refuses to write inside the repo. Each claim group gets a Tibetan anchor, either the Tibetan the note quotes or a table form found in the page OCR with `translit-skeleton.mjs`. Rules:
  - **match**: every alternative is in the anchor's set.
  - **conflict**: an authoritative source (84000 or the Mahāvyutpatti) holds the anchor and the claimed form is not in its set.
  - **no-entry** in five cases: a name the table gives two referents (`ambiguous-name`); Rangjung Yeshe is the only source (it can confirm, never refute); the anchor came only from the page; a names-only table entry faces a lowercase term; or there is no anchor.

  Names in the note that the table knows as Sanskrit count as *implicit* claims only when the note quotes the Tibetan. They can conflict but never match.
- **Stage 2b, page apparatus** (same matcher). A name from the summary, keywords or a heading is checked against the page OCR, after removing the OCR's own `<image-desc>`/`<warning>`, and against the translation body. A heading number is checked against the page's numerals, Arabic or Chinese (一百四十九 → 149). Absence counts as a conflict only when the OCR is ≥60% Latin, Greek or Cyrillic script (numbers: also Han). Diagram pages and names in the book's own title or author are no-entry.
- **Validation** (`scripts/eval/note-claims-validate-5647.mjs`). It scores the 359 notes *as judged*, using the note text from PR #5640's `candidates.json`, since 18 have been corrected since. Only their OCR is read from production. The comparison is with the worst verdict per note.
- **In-sample warning.** Five rules were added after reading lane-vs-verdict disagreements on these 359 or on the run: and-vs-or grouping, implicit only with a quoted Tibetan, page anchors cannot refute, the `-deva` suffix fold, and the negation skip. So the confusion table below is in-sample. The run's six post-cutoff conflicts are the out-of-sample read. Each rule has a unit test, and each test goes red when its rule is deleted (`tests/unit/note-claims.test.ts`, negative controls run).

**Result 1: validation against the 359 #5624 verdicts.**

| lane ↓ / verdict → | wrong | partly-wrong | correct | unverifiable | no-claim | total |
|---|---:|---:|---:|---:|---:|---:|
| **match** | **0** | **0** | 45 | 3 | 0 | 48 |
| **conflict** | 3 | 0 | 1 | 2 | 0 | 6 |
| **no-entry** | 8 | 7 | 144 | 61 | 85 | 305 |

- **"Match must not hide a known wrong": met.** 0 of 18 wrong or partly-wrong notes are `match`. N186 (blo gros brtan pa → "Sthiramati"; the referent is Dṛḍhamati) would have matched, because 84000 gives both names. It is `no-entry` only because of the `ambiguous-name` rule.
- **"Every conflict is wrong or partly-wrong": not met as written. 3 of 6 are.** The other three are cases where the table is right and the verdict is not:
  - **N053** (judged *correct*): rang bzhin stong pa nyid = svabhāva-śūnyatā. 84000 (Toh 8, Toh 11) and the Mahāvyutpatti give prakṛtiśūnyatā. The same #5624 verifier's evidence for N050, the adjacent page of the same book, reads "prakṛtiśūnyatā is rang bzhin stong pa nyid". **This is a verifier error.** N053 should be counted wrong, which makes the corpus figure 19/359.
  - **N019** (unverifiable): rab kyi rtsal gyis rnam par gnon pa = "Vikrāntagāmin". 84000 Toh 10, Toh 113 and the Mahāvyutpatti give **Suvikrāntavikrāmin**. Wrong.
  - **N233** (unverifiable): shin tu dga' = "Sudamsana". 84000 gives **Supriya**; Sudarśana is legs mthong. Likely wrong.

  Adjudicated, all 6 conflicts are wrong notes. Derek should confirm N053 before #5624's 18 is restated.
- **Recall is low: 3 of 18 known wrongs.** 12 of the 18 make no Sanskrit claim with a quoted Tibetan: "likely Garab Dorje's father", "founded by Atisha", "Taurus, Aquarius, Capricorn", a date. A Tibetan↔Sanskrit table cannot reach those, and they are stage 3's job. Of the 6 Sanskrit-equivalent wrongs, the table settles 3. N186 is ambiguous. N232 (dga' ba'i sde → "Harisena") is held only by Rangjung Yeshe ("Priyasena"), which may not refute. The Musulundha/Mucilinda claim quotes no Tibetan.

**Result 2: the whole envelope** (`tibetan-retranslation-4523`, translations written since 2026-10-01, run 2026-10-02 ~22:04 UTC).
- **Frame:** 94,439 pages, 157,654 notes, 1,255 candidate notes on 1,079 pages of 526 books, and 27,376 apparatus names/numbers. 333 candidates predate the #5624 snapshot (it had 359; 18 have been corrected and some pages retranslated since). 922 postdate it, which is the #5647 pilot stratum, grown from 217.
- **Notes:** 129 match, **9 conflict**, 1,117 no-entry.
  - The no-entry reasons: the kind is not covered by a v1 table for 973 notes (identification 461, description 244, other 156, attribution 55, date 45, place 12), and 144 are Sanskrit claims with no anchor, an ambiguous name, or similar.
  - Sanskrit-equivalent notes alone: 129 match, 8 conflict, 137 no-entry of 274.
  - **#5624's fixes are visible:** the corrected N050, N193 and N221 now `match`.
- **The 9 note conflicts, read against the cited entries** (in `results/note-claims-5647/run-summary.json` with URLs):
  - wrong (6): "Sanskrit: Dzogchen" (Dzogchen is the Tibetan name; the Sanskrit is mahāsandhi); shed bdag = "ātman or puruṣa" ×2 (84000: mānava); N053; N019; N233 (likely).
  - partly-wrong (2): "Sthira-datta" (84000 attests Dṛḍhadatta); Phal po che = "Daśabhūmika Sūtra" (it is the Avataṃsaka; the Daśabhūmika is one chapter).
  - debatable (1): byang chub tu sems bskyed = "bodhicitta". The phrase is generating the mind for awakening, so the gloss is loose rather than false.
  - Out of sample (the 6 post-cutoff conflicts): 3 wrong, 2 partly-wrong, 1 debatable. **No conflict is on a note the author reads as correct.**
- **Apparatus:** 19,545 match, 7,795 no-entry, 36 conflicts on 13 pages.
  - The first run, before the script gate, gave **7,343** conflicts. On Tibetan pages, "Dzogchen", "Padmasambhava" and "Vinaya" are absent from the OCR because Tibetan writes rdzogs chen, padma 'byung gnas, 'dul ba. Absence is not evidence there.
  - A second pass, still without the `<image-desc>` strip, gave 81: diagram pages whose "OCR" is the reading model's English.
  - Of the final 13 pages, 12 carry descriptive keywords on illegible or tabular pages ("Javanese script", "Latin manuscript", "Astronomy"). They are not wrong facts.
  - One is a real signal: book `69e7966280b52390feb195ff` p.23. Its OCR is "[illegible — approximately 2 lines …]", yet the summary names Changlo-chen, Dharmakirti and Trolung. The translation asserts content the page does not show (#5152's class).
  - **Positive controls:** stage 2b flags #5632 A09 (heading "Volume 139"; the page's numerals do not include it) and A14 (Suda summary/keywords Nicostratus, Nicon, Nicophon).
  - **On a Tibetan run, 2b is a review signal, not a repair signal.**

**Result 3: stage-3 estimate** (paid; not run; needs its own envelope).
- **Inputs.** 873 candidate notes are no-entry, excluding the 244 bare mantra/dharani descriptions. With 1 seeded false claim per batch of 20, that makes 917 checks in 44 requests.
- **Model.** `gemini-3-flash-preview`, grounded (`googleSearch`), `thinkingBudget: 512`. Flash-lite does not ground, and `-1` suppresses grounding (measurement-instruments.md).
- **Unit price.** **$0.014 per search query** (`GROUNDED_SEARCH_USD_PER_QUERY`, from the 2026-09-26 billing export). Tokens are $0.50 / $3.00 per M, halved on batch.
- **Tokens.** About 14K in and 3K out per request: $0.70 realtime, $0.35 batch.
- **Search.** $12.84 at 1 query per check, **$19.26 at 1.5 (central)**, $51.35 at 4. The FT skeptic prompt fired a median of ~16 per *book* and up to 1,290 in one call, so the envelope must cap it.
- **Recommendation.** **About $20 for the current backlog; an envelope of $60 covers the high case.** Steady state is about **$0.20 per 1,000 newly translated pages** (high $0.54). The cost is search queries, not tokens.

**Consequences.**
1. The table is safe and narrow. Across 359 + 1,255 notes, no `match` hid a wrong and no conflict fell on a note read as correct. But it settles only 11% of candidates and 3 of 18 known wrongs. Stage 3 is where the recall is.
2. **N053 should be re-judged wrong.** #5624's corpus figure becomes 19/359. N019 and N233 should move from unverifiable to wrong or likely-wrong. The 9 run conflicts are repair candidates for the `translation-text-repair.mjs` door. **None was written:** repair is separate and human-approved, per #5647.
3. Stage 2b should not run on a Tibetan envelope except as a review queue. Its value is on Latin, Greek and Chinese pages. The one live signal it found here (an illegible page with a named summary) belongs with #5152.
4. v2 ideas, not built: scope the 84000 glossary by text (page→Toh concordance, `/root/tibetan-reocr/concordance-eap.jsonl`) so ambiguous names like blo gros brtan pa resolve; the Tengyur glossaries; a Sanskrit-fold for apparatus names (śiva rātri ≠ "Shivaratri" today).

**Replicated?** In-sample on the 359, with five rules added after reading disagreements. Out of sample, on the 6 post-cutoff run conflicts, the author read every conflict against its cited entry, but no second reader checked. Unit tests pin each rule and go red without it.

**Artifact.** `scripts/eval/results/note-claims-5647/`:
- `validation.json`: 359 rows, the confusion table, the acceptance lists.
- `run-summary.json`: frame, counts, the 9 note conflicts and 36 apparatus conflicts with URLs and evidence, and the stage-3 estimate.

The claim rows are in Mongo `note_claims` (28,631 rows). The table is on Hetzner only. Cost: $0.
