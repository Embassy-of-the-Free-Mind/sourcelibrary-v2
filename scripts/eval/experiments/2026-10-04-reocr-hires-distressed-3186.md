## 2026-10-04 · Does re-reading distressed pages from the upgraded master fix them? (#3186 gated re-OCR pilot)
<!-- PRIOR ART: the July 2026 #3186 pilot (issue comment, 48 pages, LLM judge, distressed pages 8 wins / 3 losses / 2 ties) used the same distress signals but an automated judge and mixed providers; 2026-10-0x reocr-lift-5700 re-read #5695 track pages at the pipeline's 1500 px. This is the first by-eye read of palm-leaf Pali and Chester Beatty Arabic from the upgraded masters. -->

**Question.** Manchester Pali palm leaves were OCR'd from 1000–2000 px images of 5–16K px masters (#5795: unreadable by eye and engine). Now that the masters are archived, does a fresh production-prompt read from the master turn the distressed pages into usable text?

**Design.**
- **Pages.** 40 pages from 27 resolution-upgraded books: 31 Manchester Pali (18 books) and 9 Chester Beatty Arabic (9 books), one page per book first. A page counts as distressed when its stored OCR has ≥3 `<unclear>`, OR is under 45% of its book's median length, OR is empty, OR `loopVerdict` refuses it. Only pages whose OCR predates their image upgrade were drawn.
- **Request.** `archived_photo` (the upgraded master) downscaled to ≤3072 px long side, sent with the live default OCR prompt (Standard OCR v19.1) + document context, `gemini-3-flash-preview`, temperature 0.1, 16,384 tokens, thinking off. Realtime. **Nothing written to pages.** The production re-OCR scripts stamp `ocr.updated_at`, which queues a retranslation through the 07:30 staleness cron.
- **Judge.** By eye: master crops read against old and new text, line by line where the script allowed.
- **Spend.** $0.71 realtime (42 calls incl. 2 retries after 429), envelope `reocr-hires-3186` on a pseudo book id.

**Result.** **Blanket re-OCR of upgraded palm-leaf Pali on Flash is not justified; Arabic codices gain.**

| | pages | WIN | LOSS | new read loops (unusable) | both wrong | tie / unverifiable |
|---|---:|---:|---:|---:|---:|---:|
| Manchester Pali | 31 | 6 | 1 | 12 | 7 | 5 (2 binding leaves, 3 unverifiable) |
| Chester Beatty Arabic | 9 | 3 | 1 | 0 | 0 | 5 (4 non-text pages, 1 faded fihrist) |

- **Wins are real reading.** Abhidhammāvatāra p23: the old read called the Sinhala script "Telugu" and was 1,100 `<unclear>`; the new one opens "ඉති අභිධම්මාවතාරෙ විභ…", as the leaf does. Ijtimāʿ al-Shaml p104: "فتقصر عن بلوغ النهاية في ذلك فيكون الوارد عليها من قبل وارد النفس" verbatim. al-Shifāʾ p53 and al-Fuṣūl p55 are verbatim too.
- **Pali failure modes at high resolution.** 12/31 reads degenerate into repetition loops (11 hit the token ceiling at $0.051 each). Several reads come out in the wrong script (Thai, Khmer, romanized) or recite a canonical passage from memory instead of the leaf: the Buddha-guṇa formula, Dhammapada 179ff, the Janavasabha opening.
- **The worst loss is scripture.** Hijazi Qur'an p36 (the leaf is Q 39:11–15) came back as 23,685 characters of clean Qur'an from al-Qaṣaṣ to al-Aḥzāb, with one `<unclear>`. None of it is on the leaf.
- **The "short" signal misfires on non-text pages.** 6/40 picks were endpapers, labels and blank leaves.

**Replicated?** No. n=40, one engine, one judge (by eye). Direction agrees with July on codices; contradicts it on palm leaves, which July did not sample.

**Artifact.** Harness `scripts/eval/reocr-hires-3186/pilot.mjs`. Per-page verdicts with quotes in the #3186 comment of 2026-10-04 (`verdicts.tsv`, Hetzner `/root/rearchive-logs/2026-10/reocr-pilot/`).
