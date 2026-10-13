---
stage: translation
measure: judged_vs_reference
languages: [sa, pi, lzh]
scripts: [Deva, Latn, Hani]
canons: [sanskrit, pali, chinese-classics, chinese-buddhist]
n_books: 57
n_pages: 57
verdict: "Flash beats lite beyond the A-vs-A floor for Sanskrit (p 0.009); Pali ahead but fragile; Chinese ahead (p 0.002) but lite's run-to-run instability exceeds the margin."
status: superseded
decision: "Absorbed by #5695 T5; flash now routes Sanskrit, Pali and Chinese translation (PR #5740)"
superseded_by: "2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md"
issue: [5606, 4742]
---
## 2026-10-02 · Should Sanskrit, Pali and classical Chinese translate on flash instead of lite? Blind A/B against published English, with an A-vs-A floor (#5606)

**Question.** Every language except Tibetan and BPH translates on `gemini-3.1-flash-lite` (`getTranslateModelForBook`). #4742 found lite inverting negations and collapsing lists in canonical Tibetan, and Tibetan moved to flash. The Eternity corpus (#5513, #5494, #5566) is mostly Sanskrit, Pali and classical Chinese. Does lite fail the same way there? Derek approved the run on 2026-10-02, with a hard cap of $10.

**Design.**
- **Sample: 57 pages from 57 books, one page per book.**
  - Pali: 16 pages. PTS editions, plus the BJT print and a Sri Lankan ola-leaf manuscript, both in Sinhala script.
  - Sanskrit: 21 pages (20 test pages and 1 control). Śāstra, epic, kāvya and Veda, plus two Buddhist texts (Saddharmapuṇḍarīka, Prasannapadā).
  - Classical Chinese: 20 pages (19 test pages and 1 control). The Zhuangzi ×5, Laozi, Liezi, Shijing, Mozi and Xunzi; the Analects ×3 (Zhu Xi commentary editions); the Diamond Sūtra ×3; the Awakening of Faith ×3; and the Lotus ch. 25.
- **How pages were drawn.** Candidates are drawn with seed 5606 from the 20–80 % interior of each book (`draw-candidates.mjs`). The first candidate whose passage can be located in an open English is kept.
- **References, all open and recorded per page in `sample.json`:**
  - Pali: located automatically in SuttaCentral `bilara-data` (`align-pali.py`, shingle retrieval over the Mahāsaṅgīti root, with Sinhala transliterated). The English is Sujato's (suttas) or Brahmali's (Vinaya), both **CC0**.
  - Sanskrit and Chinese: cut verbatim by reference-cutter agents from pre-1931 translations under a written brief (`REF-AGENT-BRIEF.md`). Translators: Thibaut, Woods, Bühler, Telang, Kern, Ganguli, Dutt, Tawney, Shamasastry, Pancham Sinh, Whitney, Wilson, Griffith, Arnold, Ryder, Garbe, Stcherbatsky 1927; Legge, Giles 1912, Gemmell 1912, Richard 1907, Soothill 1930, Mei 1929, Dubs 1928. All are public domain in the US.
- **Exclusions, decided before any arm ran (11 books):**
  - The "Sanskrit" Nyāyabindu is Stcherbatsky's 1904 Tibetan edition (a metadata error).
  - Two pages are bilingual: one carries Monier-Williams's English notes, the other Julien's French.
  - One page holds a single closing sentence.
  - Six books had candidate pages that were front matter only (the Bṛhadāraṇyaka, and the 禮記 / 尚書 / 論語 / 孟子 / 中庸 commentary editions). Several 6a3c… Chinese books have OCR on only their first 25 pages.
  - The Platform Sūtra has no reachable 1930 English.
- **Arms.**
  - `gemini-3-flash-preview` (**flash**) vs `gemini-3.1-flash-lite` (**lite**), plus a second independent lite job (**lite-rerun**) as the A-vs-A noise floor.
  - One file-based Batch job per arm: the production single-page prompt v13 from the DB, with adjacent OCR, from the stored `pages.ocr.data`.
  - The production chained lane's generationConfig (no temperature, so the API default; thinkingBudget 0).
  - Metered on the `gemini_usage` ledger: `tibetan-mt-ab/batch-arms.mjs --production-config --meter --cap-usd 10`.
  - Nothing was written to `pages`.
- **Judges.** Two Claude subagents on the subscription, Opus and Sonnet, as in #4742. Hetzner's Anthropic API key was not used.
  - They worked blind, with labels shuffled per page (seed 5606) and keys kept out of reach. The packets pin each candidate's text hash.
  - They read the source first and the reference as the check on meaning. The rubric is #4742's, with the two failure classes that run found by eye added as flags (`JUDGE-PROMPT.md`): fidelity 1–5, omission, invention, negation **inversion**, **list collapse**, **term misparse**, and a ranking that allows a TIE.
  - Chunks of ≤ 6 pages. A refusal is shown to the judge as a refusal, not as a blank page (#5581).

**Controls first.**
- **Same-arm duplicates** (one arm shown twice, 3 pages per language): **9/9 ties for each judge.**
- **Positive control** (the reference itself as a candidate):
  - Sanskrit (Thibaut): Sonnet 5/5. Opus gave 5/5 but flagged invention, correctly: the cut runs one example past the page's last words.
  - Chinese (Giles): the in-packet control carried Giles's pre-page and post-page sentences, and both judges flagged them. A supplementary control trimmed to the page scored **5 (Sonnet) and 4 (Opus, "drops 九成")**, ranked first by both.
  - Pali: the in-packet control id was stale (the aligner moved that book to page 147). A supplementary control (AN 10.73, Sujato) scored 4/4. Both judges named the one real defect: the CC0 cut starts after the page's opening sentence.
  - No control was scored below 4 for anything but a real defect of the cut.
- **Judge agreement:** exact fidelity 69 / 73 / 75 % (Pali / Sanskrit / Chinese), within one point 100 / 98 / 98 %.
- **One refusal.** Lite returned RECITATION (empty) on the Mahāsatipaṭṭhāna ola-leaf page (Pali). Lite-rerun and flash translated it.

**Result (pooled over two judges; test pages; counts are judge-pages).**

| language | arm | fidelity median | mean | invention | omission | inversion | list collapse | term misparse | 1st place O / S | $/page Batch (metered) |
|---|---|---|---|---|---|---|---|---|---|---|
| Pali (16) | flash | **5** | 4.50 | 19 % (6) | 16 % | 1 | 0 | 4 | 13 / 11 | $0.00171 |
| | lite | 4 | 3.97 | 6 % (2) | 28 % | 1 | 0 | 11 | 7 / 7 | $0.00080 |
| | lite-rerun | 4 | 4.00 | 12 % (4) | 22 % | 3 | 1 | 13 | 8 / 4 | $0.00081 |
| Sanskrit (20) | flash | 4 | **4.08** | 22 % (9) | 20 % | 2 | 2 | 11 | 14 / 13 | $0.00212 |
| | lite | 4 | 3.78 | 20 % (8) | 35 % | 3 | 5 | 17 | 6 / 10 | $0.00101 |
| | lite-rerun | 4 | 3.68 | 18 % (7) | 30 % | 2 | 6 | 16 | 3 / 7 | $0.00099 |
| Chinese (19) | flash | 4 | **4.11** | 26 % (10) | 8 % | 2 | 0 | 6 | 15 / 12 | $0.00146 |
| | lite | 4 | 3.87 | 5 % (2) | 24 % | 2 | 2 | 17 | 6 / 9 | $0.00068 |
| | lite-rerun | 4 | 3.58 | 13 % (5) | 24 % | 7 | 4 | 19 | 3 / 4 | $0.00067 |

**Against the noise floor** (wins / ties / losses on the judges' ranking, judge-pages):

| language | flash vs lite | flash vs lite-rerun | **A-vs-A: lite-rerun vs lite** | permutation p (flash ≡ lite) | rule |
|---|---|---|---|---|---|
| Pali | 18 / 6 / 8 | 17 / 8 / 7 | 5 / 14 / 13 (net −0.25) | 0.025 | met; **not** met without the refusal page (p 0.042, margin 0.27 < floor 0.33) |
| Sanskrit | 22 / 9 / 9 | 27 / 1 / 12 | 14 / 13 / 13 (net +0.03) | **0.009** | **met** |
| Chinese | 21 / 7 / 10 | 29 / 3 / 6 | 7 / 9 / 22 (net −0.40) | **0.002** | **not met**: margin vs the better lite run 0.29 < floor 0.40 |

- **The rule** was written down after the pooled pair counts were seen, so it is not preregistered (`noise-floor.py`). Flash wins a language beyond the floor if both hold:
  - the exchangeability permutation (are the three arms interchangeable on each page?) gives p < 0.05;
  - flash's net margin over **each** lite run exceeds the A-vs-A |net margin|.
- **Sanskrit clears both, robustly.** Flash beats both lite runs by 0.33–0.38 net, against an A-vs-A floor of 0.03. Lite's misses are the classes #4742 named:
  - It turns the Lotus's *anyatra upasaṃkrāntānām* ("unless they come to him") into "if he happens to visit them".
  - It has the Vetāla eat the flesh in Kathāsaritsāgara 32.49 and reverses "I am not satisfied, bring more".
  - It makes the Arthaśāstra's paramour-murder clause "insults a man or drowns herself".
  - It drops *kuśīlava* from the performer list.
  - On the 1492 Gītā manuscript it translates the corrupt OCR literally ("Rudra-net"), where flash recovers 11.21–25.

  Flash is not clean. It reverses a Yogasūtra compound ("regardless of" for *-apekṣa*), and its inventions are mostly added notes and glosses.
- **Pali: flash ahead, not robust.** Median 5 vs 4; term misparse 4 vs 11/13. Examples from the judges:
  - Lite reads the third-jhāna close as the first-jhāna formula.
  - Lite-rerun turns *maccurājassa pāraṃ* ("past the King of Death") into "to the King of Death".

  The margin over the floor depends on the one RECITATION page, and n = 16.
- **Chinese: flash ahead by the permutation test (p 0.002), but the floor is the finding.** The two lite runs differ from each other by more than flash beats the better one. Lite-rerun inverts three times as often as lite (7 vs 2), for example:
  - Shijing 俾也可忘 becomes "How can I ever forget him?";
  - 安(能)誅之 becomes doubt.

  Lite at production temperature is unstable on classical Chinese. This matches #5568, where two lite translations of the same text differed materially on 58 % of pages. Flash vs the worse lite run is 29–6.
- **Invention runs the other way in Pali and Chinese.** Flash has 6 vs 2/4 (Pali) and 10 vs 2/5 (Chinese).
  - By the judges' reasons, most are added `<note>`s and glosses that assert things the page does not carry: biographical identifications, "context: daughter offered", a meta summary.
  - A few are in the body: "by his own actions", a clause appended from the next page's OCR (the prompt carries adjacent OCR), and Gītā content supplied where the OCR is garbage.
  - In #4742's handoff rule (invention ≤ best + 5 pp), flash would fail that gate in Pali and Chinese. It passes in Sanskrit (22 vs 18–20 %).

**Decision taken / deferred.**
- **Sanskrit:** the rule was met. A `tier:hold` routing PR adds Sanskrit to flash, beside Tibetan (Derek decides).
  - Backlog on 2026-10-02: 39,250 untranslated, non-withheld OCR'd pages in 2,111 Sanskrit books (2,954 of them in visible books).
  - At this run's metered Batch rates: lite ≈ $40, flash ≈ $85, **Δ ≈ $45**.
- **Pali:** not changed. The result is directional and fragile (backlog 3,340 pages, Δ ≈ $3 if Derek wants it anyway).
- **Chinese:** not changed by this rule. The open question is lite's instability at production temperature, not flash vs lite. Worth its own run: temperature 0 vs default on lite, the #5568 follow-up.

*Measure:* judged (preference + absolute fidelity, source-grounded, against a human reference). *Grade:* exploratory (16 / 20 / 19 referenced books per language; < 30). *Replicated?* No. This is the first run of Sanskrit, Pali and Chinese against references. The flash > lite direction matches #4742 (Tibetan) and the 2026-09-14 classical-Chinese preview A/B, judged without a reference (flash 31–16 over lite), and the size of the floor matches #5568. Same-family limitation as #4742: both judges are Claude models. The references anchor them and the A-vs-A sits inside the packet, but a non-Claude judge or a reader of the language was not used.

*Cost:* Gemini **$0.198** metered (3 Batch jobs × 57 requests; `gemini_usage` endpoint `scripts/eval/translation-ab-5606`), against an estimate of $0.23 and a cap of $10. Judges, reference cutting and controls ran on the subscription.

*run_id:* `translation-ab-5606-2026-10-02`.

*Artifacts:* `results/translation-ab-5606-2026-10-02/`:
- `sample.json` (every row, each reference's source, URL and licence, the exclusions);
- `<Lang>/` (ids, refs, packet, key, both judges' verdicts, results);
- `control-{Pali,Chinese}/`;
- `arms/` (all 171 outputs, `jobs.json` with the meter);
- `noise-floor.json`, `backlog-cost.json`.

*Scripts:* `translation-ab-5606/{draw-candidates.mjs, align-pali.py, assemble-sample.py, noise-floor.py, JUDGE-PROMPT.md}`, plus opt-in flags added to `tibetan-mt-ab/{batch-arms,build-judge-packet,score}.mjs` (defaults unchanged).
