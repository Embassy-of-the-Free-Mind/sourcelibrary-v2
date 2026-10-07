## 2026-10-03 · Does a grounded Gemini verifier find the wrong translation notes the $0 table cannot? (#5647 stage 3)
<!-- PRIOR ART: 2026-10-02-note-fact-check-lane-stages-1-2-5647.md (PR #5670) built stages 1–2 and the stage-3 estimate this run executes; 2026-10-02-note-facts-full-tibetan-run-5624.md (PR #5640) is the subagent sweep whose 359 verdicts are the calibration set here. -->

**Question.** Stages 1–2 left 885 candidate notes `no-entry`: no reference table covers identifications, attributions or dates. Derek approved 2026-10-03 a paid stage 3: about $20, a $60 envelope, and a hard stop at $30. Can a grounded `gemini-3-flash-preview` find the wrong notes among the 885? Does it reproduce the #5624 verdicts?

**Design.** Script: `scripts/maintenance/note-claims-verify.mjs` (plan → run → report).
- **Frame.**
  - The 885 `no-entry` candidate notes, excluding the 253 bare mantra/dharani descriptions. All 885 were current: no page had been retranslated since extraction.
  - A calibration set: the 305 #5624-judged notes that stage 2 left `no-entry`, as judged. 202 of them are word-for-word a main note on the same page, so they share that note's verdict. 103 were sent on their own.
- **Requests.** 50 requests. Each had 20 claims plus one fresh false claim (the seed) at a random position, with opaque ids.
  - 34 seeds were hand-written in the notes' style: "Tibetan: zhi ba lha; Sanskrit: Śāntarakṣita"; "Ganden, founded by the Fifth Dalai Lama in 1642".
  - 16 seeds took a note the table had matched and swapped its Sanskrit for one the table does not give.
  - None of #5624's 16 seeds was reused.
- **Model.** `gemini-3-flash-preview`, `google_search`, `thinkingBudget: 512`, temperature 0.1.
- **Verdicts.** correct / wrong / partly-wrong / unverifiable, each with a source URL. A non-unverifiable verdict with no URL was recorded as unverifiable (2 cases).
- **Lane: Batch API.** A one-request probe confirmed that an inline batch request with `google_search` returns `groundingMetadata`. It was sent in waves of up to 8 requests. Each wave was priced on collection, before the next was sent (spend-controls failure mode 4).
- **Spend.**
  - Every usage row is on book_id `note-factcheck-5647`, the envelope's only member. The envelope therefore meters this job alone, opens no pause bypass, and stays apart from `tibetan-retranslation-4523`.
  - Tokens are logged through `logUsage` (batch rate). Searches go through `grounding-budget` `record` ($0.014 per query).
  - The stop rule ran before each wave: measured envelope spend plus a worst case of 70 queries per request had to stay under $30. A wave averaging more than 3 queries per claim would also have ended the run.
- **Grounding is read from `webSearchQueries`, never from the answer text.** On the first prompt (v1), **8 of 22** parsed answers ran **zero** searches. They still cited plausible 84000 and Treasury of Lives URLs. So:
  - A response with 0 queries is not accepted. It is re-sent, up to 4 attempts, and every attempt is metered.
  - From r003 onward the prompt (v2) says that an answer it did not search for is not accepted. That cut zero-search answers to 4 of 39. 14 requests were accepted on v1 and 35 on v2.
  - Per item, `searched` records whether some query of the request shares a distinctive word with the note. `groundingChunks` cannot answer this: it lists only the few spans the answer cited (72 of 865 URLs).

**Cost (meter, Supabase `gemini_usage`, book_id `note-factcheck-5647`): $22.62.**
- Search: $22.40 for 1,600 queries, including the 1-query probe. That is 1.55 queries per check, against the 1.5 central estimate.
- Tokens: $0.22.
- 82 requests were sent for 49 accepted. The extra 33 were ungrounded retries, "operation was cancelled" or empty responses, and one wave orphaned by a kill, which was collected and metered by hand.
  - Two early cancelled attempts (no output, no cost) were overwritten before attempts were archived. The other 80 are on the box.
- The envelope was closed after the run.

**Result 1: seeds. 48 of 49 caught (98%)**: 47 `wrong` and 1 `partly-wrong`. The bar was 90%. One seed sat in the request that never searched (r040).
- The only miss was a table seed ('Dul ba phran tshegs = "bodhichitta"). The verifier's own evidence says "not bodhichitta", but it answered unverifiable.

**Result 2: calibration against #5624. Agreement 154 of 219 (70%) on the 4-class verdicts; 4 of 15 known errors found.**

| #5624 ↓ / stage 3 → | correct | unverifiable | partly-wrong | wrong |
|---|---:|---:|---:|---:|
| correct (143) | 124 | 16 | 1 | 2 |
| unverifiable (61) | 31 | 26 | 1 | 3 |
| partly-wrong (7) | 4 | 1 | **2** | 0 |
| wrong (8) | 3 | 3 | 0 | **2** |
| no-claim (85) | 12 | 72 | 1 | 0 |

- **The seed rate does not measure recall on the real errors.** The verifier caught 98% of the planted errors but only **27% (4/15)** of the known real ones.
  - It calls 7 known errors correct. Examples:
    - N186 Sthiramati: 84000 has two referents for blo gros brtan pa.
    - N222 Mi-skyes "Ajata": #5624 read it as a misreading of me skyes.
    - N332: Minling Terchen's dates are attached to the wrong person.
    - N093: Pema Lingpa as an incarnation of Guru Rinpoche.
  - These are the subtle cases: the right name in the wrong place, or a plausible relation. The seeds were flagrant swaps.
  - **A 90% seed bar on seeds this easy is a weak gate.** The next run's seeds should be drawn from the #5624 error shapes.
- The verifier is more generous than #5624 on unverifiable notes: 31 of 61 became correct.

**Result 3: the 885 notes.**
- **Verdicts:** 527 correct, 311 unverifiable, **11 wrong**, 16 partly-wrong. 20 got no verdict: request r040 ran no search in 4 attempts.
- 109 of the 527 "correct" verdicts have no query naming the note. Treat those as unsearched.
- **The 11 `wrong` verdicts, each read against its source by hand: 3 hold.**
  - Applied:
    - Musulundha "a Naga or local deity" → king of the gods in the Heaven Free from Strife (84000 Toh 287, same text).
    - "Shanavasa, the father of Upagupta" → the father is Gupta, a perfume merchant (84000 Toh 340 and Toh 1-6). Śāṇakavāsin, named earlier in the same passage, was Upagupta's teacher.
    - rta thul = "Ajita" → Aśvajit (84000 in ten texts; Mahāvyutpatti 1042).
  - **Verifier wrong (5):**
    - The Tibetan alphabet: the list contains tsa, tsha, dza, zha, za and 'a, which are Tibetan-only letters.
    - "Yama" for the Yāma heaven: the verifier read it as Yama, lord of death.
    - It checked the running text instead of the note (Vyāsa).
    - The note reports the text's own gloss (Padma, the water deity).
    - mer mer po: the cited medical paper contradicts the Mahāvyutpatti (kalala).
  - **Not a note error, or not settled (3):**
    - "Akashagarbha" for 'Od srung is an error in the running text.
    - "The omniscient Dharmākara" is more likely Situ Paṇchen Chökyi Jungné than either the note's or the verifier's candidate.
    - The verifier's Jyeṣṭharāja = Gaṇeśa has no source for this passage.
  - **Precision of `wrong`: 3 of 11.** A grounded `wrong` is a candidate for a human read, not a repair signal.

**Repairs applied: 9 notes, 0 skipped** (`scripts/maintenance/fix-note-facts-5647.mjs`, the #5624 door).
- Each repair wrote a `page_revisions` row first (source `note-factcheck-5647`), with before and after hashes.
- Human-edited pages and changed text were guarded. Both Supabase mirrors were re-synced: 9 books, and 9 `page_translations` rows.
- **Stage 2 (6):**
  - "Sanskrit: Dzogchen" → mahāsandhi.
  - shed bdag "ātman or puruṣa" → mānava, ×2.
  - **N053** svabhāva-śūnyatā → prakṛti-śūnyatā.
  - N019 Vikrāntagāmin → Suvikrāntavikrāmin.
  - N233: the unsupported "Sudamsana" was dropped, not replaced. 84000's only Sanskrit for shin tu dga' is Supriya, a gandharva, which is another referent.
- **Stage 3 (3):** as listed above.
- Running-text errors found on the way (Ajita for Aśvajit; Akashagarbha for 'Od srung; "Shana") were **not** touched.

**Consequences.**
1. **Stage 3 as built does not reproduce #5624.** On the real errors its recall is 27%, and on its own `wrong` verdicts its precision is 27%. It cost $22.62 for 3 repairs. It is not ready to run unattended on new pages.
2. **The grounded verifier must be gated on search, not on the prompt.** Half of the v1 answers ran no search and still cited URLs. The `accepted` rule (queries > 0, re-send otherwise) is now in the script. The per-item `searched` flag is a proxy.
3. Seeds should copy the real error shapes: a wrong referent for a correct name, a relation off by one, dates attached to the wrong person. Then the seed rate would say something about recall.
4. **Review list (not applied):** 16 partly-wrong, 8 wrong not applied (with the reason), 311 unverifiable, and 20 unverified, in `results/note-claims-5647/stage3/review-list.json`.
   - One partly-wrong verdict falls on #5624's own N018 fix ("Musulundha … acting as a teacher"). The verifier says he is taught, not teaching. It is worth a look.

**Replicated?** No. It is one run, partly on two prompt versions (v1 for 14 accepted requests, v2 for 35). The hand reads of the 11 `wrong` verdicts are one reader's, against the sources named.

**Artifact.** `scripts/eval/results/note-claims-5647/stage3/`:
- `summary.json`: meter, seeds, verdict counts and the calibration tables.
- `verdicts.json`: every non-seed item.
- `seeds.json`.
- `review-list.json`.
- `repairs-applied.json`.

Verdicts are also on `note_claims.verify` for the 865 answered main notes. Raw responses for every attempt are on Hetzner in `/root/factcheck-lane/stage3/`.
