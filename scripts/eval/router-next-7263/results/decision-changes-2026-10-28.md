## A. new evidence, unsplit (agy-gpu-7263 -> router-next-unsplit)
- latin-lite: HOLD → agy-flash-low-read -> HOLD → gpu>agy-flash-low
## B. split (router-next-unsplit base -> each script cell), only where different
- latin-lite/manuscript (26,268 waiting): HOLD → gpu>agy-flash-low -> UNTESTED (manuscript)
- latin-flash3/manuscript (76,402 waiting): HOLD → 3flash>agy-flash-low -> UNTESTED (manuscript)
- latin-flash3/unknown (549,086 waiting): HOLD → 3flash>agy-flash-low -> HOLD → 3flash
- german-lite/manuscript (9,007 waiting): keep -> UNTESTED (manuscript)
- german-flash3/manuscript (1,784 waiting): keep -> UNTESTED (manuscript)
- german-flash3/unknown (211,906 waiting): keep -> HOLD (unknown: < 10 pages a route) → 3flash>opus
- german-tr-flash3/manuscript (6,074 waiting): HOLD → flash3 -> HOLD (manuscript: < 10 pages a route) → flash3
- german-tr-lite/manuscript (430 waiting): HOLD → flash-lite -> HOLD (manuscript: < 10 pages a route) → flash-lite
- french-lite/manuscript (7,780 waiting): switch → lite>agy-flash-low -> UNTESTED (manuscript)
- greek-flash3/manuscript (46,508 waiting): held -> planned → 3flash>opus
- tibetan-tr/manuscript (0 waiting): HOLD → agy-flash-low@4 -> HOLD → opus-cli
- tibetan-yigdzin/print (5,745 waiting): switch → yigdzin>agy-flash-low -> keep (UNTESTED)
- tibetan-yigdzin/unknown (2,329 waiting): switch → yigdzin>agy-flash-low -> HOLD (unknown: < 10 pages a route) → yigdzin>opus
- zh-paddle-dice-lt090/manuscript (453,715 waiting): HOLD → paddle>agy-flash-high -> HOLD → paddle>opus
- zh-6561-served/manuscript (0 waiting): HOLD → paddle -> keep
- chinese-flash3/manuscript (10,501 waiting): HOLD → 3flash -> UNTESTED (manuscript)
- chinese-flash3/unknown (8,656 waiting): HOLD → 3flash -> UNTESTED (unknown)
- hebrew-flash3/print (5,497 waiting): HOLD → 3flash>agy-flash-low -> HOLD → 3flash
- hebrew-flash3/manuscript (14,620 waiting): HOLD → 3flash>agy-flash-low -> HOLD (manuscript: < 10 pages a route) → 3flash>opus
- arabic-flash3/manuscript (14,395 waiting): HOLD → 3flash>agy-flash-low -> HOLD (manuscript: < 10 pages a route) → 3flash>opus
- arabic-flash3/unknown (9,073 waiting): HOLD → 3flash>agy-flash-low -> HOLD → 3flash
- zh-lite/manuscript (173 waiting): HOLD → agy-flash-low-read -> HOLD (manuscript: < 10 pages a route) → lite
- greek-lite/manuscript (30,117 waiting): held -> planned → lite>opus
- sanskrit-lite/manuscript (2,480 waiting): HOLD → agy-flash-low-read -> UNTESTED (manuscript)
- sanskrit-lite/unknown (395 waiting): HOLD → agy-flash-low-read -> UNTESTED (unknown)
- arabic-lite/print (17,312 waiting): HOLD → agy-flash-low-read -> HOLD → agy-flash-low-read-diplomatic
- arabic-lite/manuscript (10,347 waiting): HOLD → agy-flash-low-read -> HOLD → lite>opus
- italian-lite/manuscript (1,748 waiting): HOLD → lite -> UNTESTED (manuscript)
- spanish-lite/manuscript (451 waiting): HOLD → lite -> HOLD (manuscript: < 10 pages a route) → lite
- korean-lite/unknown (0 waiting): HOLD → agy-flash-low-read -> HOLD (unknown: < 10 pages a route) → lite
- russian-lite/print (18,930 waiting): switch → agy-flash-low-read -> HOLD → agy-flash-low-read
- russian-lite/manuscript (22 waiting): switch → agy-flash-low-read -> UNTESTED (manuscript)
- portuguese-lite/manuscript (138 waiting): HOLD → lite -> HOLD (manuscript: < 10 pages a route) → lite
- portuguese-lite/unknown (0 waiting): HOLD → lite -> HOLD (unknown: < 10 pages a route) → lite
- danish-lite/manuscript (5 waiting): HOLD → lite -> UNTESTED (manuscript)
- danish-lite/unknown (0 waiting): HOLD → lite -> HOLD (unknown: < 10 pages a route) → lite
- hindi-lite/unknown (0 waiting): HOLD → lite -> HOLD (unknown: < 10 pages a route) → lite
- middle-english-lite/manuscript (1,564 waiting): HOLD → lite -> HOLD (manuscript: < 10 pages a route) → lite
- middle-english-lite/unknown (0 waiting): HOLD → lite -> HOLD (unknown: < 10 pages a route) → lite
- mhg-lite/manuscript (743 waiting): HOLD → lite -> HOLD (manuscript: < 10 pages a route) → lite
- mhg-lite/unknown (0 waiting): HOLD → lite -> HOLD (unknown: < 10 pages a route) → lite
- old-french-lite/manuscript (382 waiting): HOLD → lite -> HOLD (manuscript: < 10 pages a route) → lite
- ottoman-lite/manuscript (126 waiting): HOLD → agy-flash-low-read -> HOLD (manuscript: < 10 pages a route) → lite
- ottoman-lite/unknown (0 waiting): HOLD → agy-flash-low-read -> HOLD (unknown: < 10 pages a route) → lite
- tamil-lite/manuscript (14 waiting): HOLD → agy-flash-low-read -> UNTESTED (manuscript)
- tamil-lite/unknown (0 waiting): HOLD → agy-flash-low-read -> HOLD (unknown: < 10 pages a route) → lite
- turkish-lite/print (1 waiting): HOLD → lite -> keep (UNTESTED)
- turkish-lite/manuscript (49 waiting): HOLD → lite -> HOLD (manuscript: < 10 pages a route) → lite
- turkish-lite/unknown (0 waiting): HOLD → lite -> HOLD (unknown: < 10 pages a route) → lite
## C. calibrated prior (sensitivity) differs
- zh-6561-served/manuscript: keep paddle>opus -> calibrated: switch paddle>opus
- arabic-flash3/print: HOLD 3flash>agy-flash-low -> calibrated: HOLD 3flash
## tests [('latin-lite/print', ['lite>agy-flash-low']), ('latin-flash3/manuscript', ['3flash', '3flash>agy-flash-low']), ('zh-paddle-dice-lt090/manuscript', ['paddle>agy-flash-low'])]
ROW latin-lite/print 835238 HOLD → gpu>agy-flash-low ('gpu>agy-flash-low', 0.82, 'lite>opus', 0.85, 0.65)
ROW latin-lite/manuscript 26268 UNTESTED (manuscript) None
ROW latin-flash3/print 692318 HOLD → 3flash>agy-flash-low None
ROW latin-flash3/manuscript 76402 UNTESTED (manuscript) None
ROW latin-flash3/unknown 549086 HOLD → 3flash None
ROW zh-paddle-dice-lt090/manuscript 453715 HOLD → paddle>opus ('paddle>agy-flash-high', 0.56, 'paddle>opus', 0.84, 0.03)
