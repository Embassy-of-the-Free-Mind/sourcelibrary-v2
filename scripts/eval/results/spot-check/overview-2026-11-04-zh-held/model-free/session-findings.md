# zh-held-quality-8053 findings so far (2026-11-04, session 1)
## Provenance (Mongo, four works = 167 books, 24,602 pages; hold zh-histories-7546 also covers 7 reference books, excluded)
- OCR: one route. paddle / PaddleOCR-VL-1.6-0.9B, lane paddle-zh-2026-10, 2026-10-28T13:45–15:09Z: 23,853 pages. 749 pages no OCR.
- English: one route. gemini-3.8-flash-low, source ai, call_site scripts/batch/cli-translate.mjs (Siku lane, FIRST_HOLD=zh-histories-7546), 2026-10-29T01:33–17:08Z: 22,072 pages. ALL before the #7914 STOP (2026-10-30T14:06Z). 0 after.
- Hold release text says translation "is Derek's decision", yet Siku lane translated them 10-29 (zh-histories-7546 is in SIKU_LANE_HOLDS, FIRST_HOLD). Report it.
## Counts (shiji-dice/counts.jsonl, counts-summary.txt)
- no OCR 749 (shiji 268, hanshu 292, hhs 108, sgz 81); no English 2,530; OCR-but-no-English 1,781 (body Han <20: 327; 20–99: 718; ≥100: 736)
- 736 ≥100-Han untranslated are table (表) volumes with 0 English: Shiji vols 8,10,11,12 ; Hanshu vols 6,8,9,10,11 (+ a few)
- English latin chars per source Han: p5 3.83, p50 7.74, p95 10.61; English <1x source: 2 pages; <0.5x: 0
- loop guard (gpuLoopVerdict) on stored OCR: 41 (tail_runaway 35, repetition_loop 2, repeated_lines 4); char run >40: 0. e.g. Shiji vol1 p13 = TOC recited juan list
- numeral-dominated OCR (>60% numerals): 110 pages: Shiji vol8 58 (0 EN), vol10 30 (0 EN), vol9 18 (18 EN), Hanshu vol5 4 (3 EN). English mostly digits: 2 pages.
## Dice (lane-stored ocr.qa_screen, WYG; shiji-dice/wyg-stored.jsonl) — not recomputed
- Hanshu 7,561 screened: median 0.939, <0.6 769 (10.2%); bins [0-.2:717, .2-.3:21, .3-.4:6, .4-.5:4, .5-.6:21, .6-.7:17, .7-.8:41, .8-.9:727, .9-1:6007]. Low concentrated in 表 vols 6–11 (+5)
- Hou Hanshu 6,188: median 0.944, <0.6 89 (1.4%); bins [41,8,2,4,34,17,58,617,5407]
- Sanguozhi 3,598: median 0.822, <0.6 1,662 (46%); bins [1610,21,24,1,6,12,55,1258,611]. Kanripo KR2a0012 (WYG AND master) holds only 魏志 files 000–030: all 15 蜀志/吳志 vols have NO witness → 100% "low". Wei-zhi alone low ~150.
- Not screened <20 Han: hanshu 104, hhs 72, sgz 38. Shiji: not screened (no WYG).
- Shiji vs master (TLS edition, Zhonghua 1959 base, no 三家注; my windowed Dice, shiji-dice/shiji-master.jsonl; script q/shiji-master.mjs): 6,174 screened, 118 short; median 0.43, p25 0.20, p75 0.67; bins [0-.2:1511, .2-.3:748, .3-.4:647, .4-.5:651, .5-.6:630, .6-.7:629, .7-.8:562, .8-.9:477, .9-1:319]. Depressed by commentary absent from witness.
- 5 lowest (≥100 Han, one per vol), opened by eye: Shiji vol8 p188 (table; OCR = numeral loop not on leaf, no EN); vol9 p24 (table; OCR numeral grid not on leaf; EN translates it → CONTAINED); vol44 p106 (正義論例 phonetic glossary, OCR fine, absent from TLS; margin garble 令×5 → EN "Order Order…"); vol1 p46 (Qing editors list front matter, OCR right, absent from TLS); vol10 p23 (table; OCR = leaf text with every line REVERSED). => low Dice = witness lacks the content, or table pages; not prose misreads.
## Juan questions
- Hanshu: vol24 labelled 31–32 is 33–35; vol25 labelled 33–35 is juan 36 leaves 1a–36a only (WYG 036 has 52 leaves): juan 36 leaves 36b–52b and ALL of juan 37 are missing from the set. vol26 = 38–40 (starts 038-1a). vol8 "15下" = juan 16. vol12 "20上~下" = 21 律曆志. vol17 "二十五六" = 26.
- Shiji vol40 (06054534, 6ae0bd884adf2ffb52f72549) "卷一百七": p2 heading 史記卷一百十七 司馬相如列傳第五十七; 50 版心 headers 卷一百十七 → juan 117 confirmed.
## Review (overview-2026-11-04-zh-held, seed 2026110401, 8 books x 4 pages, 192 pp)
- report.md written; book_checks 48 rows recorded (method shelf-overview v2). cost $15.55 API-eq overview + $2.61 retest, $0.081/page
- serious (CI by book): shiji 13% (3–22), hanshu 13% (0–25), hhs 6% (0–19), sgz 6% (0–16), print-ocr 13% (3–22), control 19% (3–38). wrong leaf 0 everywhere. OCR/EN: 4.53/4.47, 4.25/3.94, 4.09/4.16, 4.47/4.28, 3.94/—, 4.00/3.69. show/cav/don't: 2/6/0, 0/8/0, 0/8/0, 2/6/0, 2/6/0, 2/2/4.
- control translation route: 24/32 pages gemini-3-flash-preview (old Batch lane), 4 opus, 4 flash-low; 5 of 8 books are 佩文韻府/駢字類編 encyclopaedias.
- Hanshu reviewer split into 3 forks of itself (all Opus per modelUsage).
- Reread (zh-sanguozhi, shuf): serious κ 0.65 [0.00,1.00] BELOW 0.7; 31/32 agree; OCR ρ 0.64, EN ρ 0.71; verdict 8/8. agreement.md in scratch → copy to run dir.
- Second reader (SECOND-READER.md v1, 2 claude -p Opus calls, second/out/*.json): held 23/24 confirmed, 1 real_not_serious (hanshu f74449 p40); control 10/11 confirmed, 1 real_not_serious (e2285e p5 O5). reclassified 0. By stratum: shiji 7/7, hanshu 6/7, hhs 4/4, sgz 2/2, print 4/4, control 10/11.
- Classes held: garbled 欽定四庫全書 margin → OCR line (次定曰事全焉 etc.) → English invents commentator "Ci Ding"/lacuna/marginal note: 6 distinct books (hanshu f729b9 p107, f72939 p10; hhs f754d4 p131,p199; shiji f725c5 p59, f7166f p113, f7185a p60). Owner issue #5142 (O11). Also seam T6 (2), T8 reversal (shiji f72384 p25 此太過 'excess'→'deficiency'), T10 sexagenary gloss (sgz).
- control: invented poets/headwords from shredded OCR in 駢字類編/佩文韻府 (by eye: 159fde p106 Xue Lin/Liu Shaohu/Chi Hui), 44,500 qing → 4,450,000; same as #5600 arm B.
- print: O5 line dropped (楚辭集註), O6 明→非 negation (尚書韻), O7 dose dropped (金匱要略), O1 invented Ricci line (遠鏡說 69af121cf78a272df25b564a p3, hidden, OCR only, no EN).
## Containment (done)
- 6ae0bb3a4adf2ffb52f7136a (Shiji vol9, juan 15 table) p24 withheld by eye, --issue=8053, revisions 1. Book already held zh-histories-7546. TODO: label #8053 `contained` + one line.
- Not contained (precedent 2026-10-30 #5600 doc: invented note on a page whose body is the leaf = finding): the 7 held Ci Ding pages, control p106/p29/p216.
## Release mechanics (code read)
- releaseBook --to ocr_complete → orchestrator Phase 3.5 gate (only <10% OCR sent back: n/a), Phase 3.7 transliteration (PAID Gemini lite, non-Latin ocr_complete books), translate phase: Chinese → routing row flash-measured, channel batch = PAID Gemini API; would translate 1,781 OCR'd-untranslated pages incl. table numeral garbage (minus SKIP page types).
- Siku lane stops touching them once released (it selects held books only).
- bulk-ocr-new (src/app/api/admin/bulk-ocr-new/route.ts) selects ANY non-deleted book with un-OCR'd pages sorted by human_read_count/read_count; hold guard observe-only → 749 un-OCR'd pages are a paid-read risk once visible.
- Finalize Phase 9 auto-unhides books with hidden:true and NO hidden_reason. These have no hidden_reason!
- English: per-page withholding only (translation_withheld via withhold-stale-translations); reader already labels AI English "AI translation, not yet reviewed by a scholar." and book_checks warnings show (#6199).
- => recommendation A shape: unhide (visible) while KEEPING the pipeline hold (no --release-held), so no lane queues anything; English withheld needs withhold --by-eye-pages=all per book (mass; Derek) or a new book-level flag.
