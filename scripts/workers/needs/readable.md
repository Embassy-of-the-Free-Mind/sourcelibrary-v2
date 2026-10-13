# Needs map: Readable

**Purpose:** a reader can read the book in English, and read its original legibly.
**Built:** 2026-10-11 by job `needs-readable-6359`, part of #6359 step 2. Read-only, $0.
All counts are live books (`visible: true && pages_count > 0`, n = 42,300) on `bookstore`,
queried 2026-10-11 unless a line says otherwise. Ranked queue: `readable.json` next to this file.

## 1. The number

**`readable_in_english` = 20,220 live books (2026-10-11), 47.8% of 42,300.**

- **How measured:** the named view in `.claude/docs/translation-state.md`: rung `readable`/`complete`
  (≥ 90% of translatable pages translated, with OCR covering ≥ 90% of the book), plus English
  originals at `transcribed`/`translating`. sync-worker stamps `books.translation_state`;
  `scripts/lib/homepage-stats.mjs` counts it into `system_config.homepage_stats.readableInEnglish`
  (updated 2026-10-11 05:18Z). A fresh recount today matched it exactly: 17,575 translated from
  other languages + 2,645 English originals. Every live book carries a v1 stamp.
- **Trend:** 14,852 on 2026-09-30 (#3402) to 20,220 on 2026-10-11, up 5,368 in 11 days.
  The main sources are preview-stub re-entry (#4719), the Paddle Siku lane (#5600) and the Tengyur (#5497).
- **Ladder today (live):** complete 11,995 · readable 7,505 · translating 1,274 · transcribed 9,546 ·
  transcribing 11,718 · no_text 166 · no_pages 96.
- **How to catch it being gamed:** the number rises if the denominator shrinks or if bad text is counted.
  1. *Denominator.* Today only 12 readable books are readable because `pages_translatable` < whole,
     and 38 have `pages_translated < 0.5 · pages_count` with pages_count > 30 (the #5063 / `fully-translated-coverage.mjs` FAIL rule).
     The reconciling audit that is meant to watch this, `translation-state-audit.mjs` (#5290), **does not exist yet.**
  2. *Bad text counted as readable.* 1,869 readable books are under a pipeline hold. Of those,
     **235 are Tibetan books held under #4523** (OCR invents Sanskrit scripture on Tibetan folios)
     and ~33 more are held for wrong-leaf or invented text (#4790, #6056, #5826, #5700, #6420).
     A further 1,511 readable Chinese books (Paddle lanes) serve English translated from an OCR that
     Paddle has since replaced (#6388). The view counts all of these.
  3. *Outside check:* a by-eye sample of pages from readable books, with image, OCR and English side by side
     (the #5826 quality gate: 10 books × 3 pages per 300 books or 7 days). The 2026-10-10 run was
     **NO-GO: 4 of 30 pages carried text not on the leaf, rendered as fluent English.**
     Pair the headline with that gate's latest fabricated-page rate. Neither number counts without the other.

## 2. Asked

- **Reader translation requests (feedback widget, "Translation requested for …"):** 132 requests on 85 books,
  2026-06-12 to 2026-10-08. **72 of the 85 books are now readable/complete. 13 are not**
  (10 at `transcribing`, 2 `translating`, 1 `no_text`). Among them: Plotinus *Enneaden* (German, 0/391, requested 10-08),
  Soarez *De arte rhetorica* (0/135, 10-08), Paracelsus *Bücher und Schrifften* (374/477, 3 requests),
  Greek *Historiae* (0/288), *Characteres Aegyptii* (1/129), Leowitz (108/171),
  the Greek Poimandres (1/246). The tracking issue #3087 has not been updated since 2026-08-31,
  and its checklist mixes fulfilled and open asks. #4482 asks to route these into the nearly-finished sweep.
- **Feedback mentioning translation, OCR or legibility:** 245 of 551 rows (regex screen, all time).
  80 since August: 40 in Aug, 27 in Sep, 13 in Oct so far.
  Besides requests, the recurring ask is **reading flow**: scroll from the scan into OCR and then the English,
  and back (three messages, 2026-08-29 to 10-03, including Derek's; #5219). Others: OCR off by default on mobile,
  and "retranslate this page, not the whole book" (09-29).
  Translation-quality reports came from the MCP channel: Llull *Ars brevis* (10-09), Plato 1550 p.527 (09-30), *Red Lion* (09-08).
- **Canon gaps (`canon-gap-status-2026-10.json`, counted 2026-10-07):** Eternity shelf 226/278 readable.
  Derge Tengyur 213/213 readable, scholar review pending (#5800). CBETA Chan 17/99 readable, 19 texts to translate (#5566).
  Kangyur 0/103 readable, all held (#5665, closed). Mongolian Kanjur 0/108, no engine reads the script.
  Sefaria Zohar 10/36, blocked on refused-page re-OCR (#3878).
  Perseus Latin 1,174/1,292 live and Greek 991/1,098 live: no plan yet (#6220).
- **Derek, 2026-10-10:** made the translate quality gate standing (#5826). Decided and approved the Greek
  flash-lite re-OCR and retranslation, ≈ $13 (#5813), and Kraken text on the 715 Gemini-refused English pages (#4686).
  **Neither has run:** the job landed on the ARM box, which has no Kraken.

## 3. In motion

Finishing these comes before starting anything new.

- **Translate quality gate NO-GO** (`qg_translate_202610101657_1rqt`, #5826, PR #6422 `tier:hold`).
  The brake only takes effect once #6422 merges; until then the flag does nothing.
  Once it merges, translation enrolment pauses until a person records a GO naming the fix:
  (1) gate handwritten books of every language in `OCR_TRUST_TABLE` (#5700),
  (2) refuse pages whose OCR declares English whatever `books.language` says (T12, cf. #4937).
  Merging without the GO stops the lanes that are moving this number.
- **Preview-stub re-entry (#4719):** started 2026-10-01 by a Hetzner driver, with envelopes of $2,000 for OCR and $1,000 for translation.
  The cohort was 13,015 books, then 5,121 after Chinese was held. Stop date is 11-15.
  Today 7,213 live books still fit the stub shape (> 60 pp, 1–30 pp OCR'd), out of 21,215 corpus-wide.
  The largest backlog rung is Latin `transcribing`: 7,319 books.
- **Paddle Siku Chinese (#5600 done 10-05, #6388 eval running 10-11):** 1,033,868 pages written, 6.5% flagged by the QA screen.
  751 books / 75,701 pages carry stale English translated from the superseded reading.
  The pre-registered eval decides whether to retranslate. Old-vs-new CER p90 is .693.
- **Tengyur retranslation (#6361, #6420):** 6,492 pages re-read. Convergent check: 2/40 pages worse, both restored. Scholar review is #5800.
- **CBETA Chan (#5566):** 19 texts left to translate.
- **Translation-state migration (#3402):** steps 1–3 closed. Open: #5288 (Supabase catalog columns / browse filter / collection `book_count`),
  #5289 (hard-coded headline figures, public copy), #5290 (the audit), #5291 (delete the legacy flags), #5292 (inputs).
  In #5292, today's count shows **0** live books without `pages_translatable` (the issue says 10,282), so its first item looks done.
- **Merged in the last day:** #6444 (the reader no longer shows "[Blank page]" filler as a translation, #5903; production check by eye still pending) and
  #6417 (translation prompts follow the routed model, #6122; §3 still open: re-enrol the 72 parked runs).
- **Decided, not run:** #5813 (Greek, ≈ $13) and #4686 (Kraken, needs an x86 box).

## 4. Found, not fixed

- **9,010 live Chinese books are OCR'd with no English** (`transcribed`; 9,033 non-English books, 1,375,177 translatable pages in all).
  They are held `paddle-zh-5600-ocr-only` / `gpu-backlog-5660` on purpose. This is the single largest block of the backlog.
  Translating it is a spend decision that waits on #6388. At the Tengyur batch rate ($0.0018/page, `canon-gap-status`) it would cost roughly $2.5K.
- **651 non-English books sit at ≥ 75% translated with 24,553 pages left.** This is the cheapest readable gain: about $30–45 at batch rates, through the nearly-finished sweep.
  #4685 says ~60% of the missing pages in 90–99% books are real text the pipeline dropped. Its reader "Untranslated" strip
  (branch `feat/reader-untranslated-pages-4685`) never became a PR.
- **Books OCR'd out of band never enter the translate lane (#4691).** The fix changes paid cron selection, so it is on the hold list.
- **Contained text still counted as readable:** see §1 item 2. No issue says whether the view should exclude contained holds.
- **Translation defects in readable books, with no owner:** carry-over from the previous page (#5026, 21/228 pairs),
  drift across block boundaries (#5021, ~3%), English written where OCR declined (#4584),
  a `translation.language: en` that is not English (#4937), and LaTeX served in place of Greek (#4580, ≥ 19 live books).
- **The original is not legible:** loop OCR on 841 books (#3878), Russian OCR on Gesner's Latin (#5215, 341/825 pp),
  Cyrillic poison in six books (#4808), black scans beside English in 10 public Siku books (#6305),
  and IA wrong-page delivery at 5.4% (#4790).
- **Truncated ingests wear a 100% badge (#4442):** e.g. Avicenna's *Canon* is 1 page, live and "complete".
- **No random-sample fidelity audit of the English we serve (#5274).** Every quality claim rests on the
  30-page gate and lane-specific evals.
