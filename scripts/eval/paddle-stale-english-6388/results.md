# #6388 stale English on Paddle-read Siku pages: results

computed 2026-10-11T17:14:47.525Z by score.mjs

- Controls: Opus 5/5, Gemini 3.1 Pro 5/5 — gate passed
- Headline (60 random books, page has a material OCR-caused English error): **68% (30/44; 53–80%)** — 16 unresolved, bounds 0.5–0.767
- Material TRANSLATION-caused error (random): 30% (13/44; 18–44%)
- Verdict retranslate-would-fix (random): 59% (26/44; 44–72%)
- Any material error (random): 82% (36/44; 68–91%)
- Per reviewer, OCR-material (random): Opus 50% (30/60; 38–62%), Gemini 80% (48/60; 68–88%)
- Agreement: verdict 42/80, OCR-material flag 53/80; 38 disagreements, 13 adjudicated
- Verdicts random: {"keep":8,"retranslate-would-fix":26,"bad-regardless":10}; top decile: {"retranslate-would-fix":7,"bad-regardless":3,"keep":1}

| old-vs-new CER | eligible pages | sampled (random) | OCR-material | TRANSLATION-material | would-fix verdict |
|---|---|---|---|---|---|
| 0–0.05 | 34,728 | 25 (25) | 47% (7/15; 25–70%) | 40% (6/15; 20–64%) | 40% (6/15; 20–64%) |
| 0.05–0.1 | 15,961 | 15 (15) | 83% (10/12; 55–95%) | 42% (5/12; 19–68%) | 83% (10/12; 55–95%) |
| 0.1–0.2 | 9,940 | 6 (6) | 100% (6/6; 61–100%) | 17% (1/6; 3–56%) | 83% (5/6; 44–97%) |
| 0.2–0.5 | 5,596 | 7 (7) | 60% (3/5; 23–88%) | 20% (1/5; 4–62%) | 60% (3/5; 23–88%) |
| 0.5–1 | 9,426 | 27 (7) | 77% (13/17; 53–90%) | 12% (2/17; 3–34%) | 53% (9/17; 31–74%) |

**Rule:** retranslate every stale page → 75,701 pages

## Controls

| qid | kind | Opus | Gemini |
|---|---|---|---|
| p02 | name | true (material) | true (material) |
| p13 | number | true (material) | true (material) |
| p17 | negation | true (material) | true (material) |
| p28 | name | true (material) | true (material) |
| p53 | number | true (material) | true (material) |

## Pages

| qid | arm | CER | title | p | O | G | ADJ | OCR-mat | TR-mat |
|---|---|---|---|---|---|---|---|---|---|
| p29 | random | 0 | 周元公集·卷一~卷四 (Collected Works  | 22 | keep | bad-regardless | bad-regardless | false | true |
| p50 | random | 0 | 文房四譜·卷一 (vol 1) | 52 | keep | keep |  | false | false |
| p57 | random | 0 | 植物名實圖考(十) | 18 | keep | keep |  | false | false |
| p76 | random | 0.007 | 御纂醫宗金鑑 | 104 | keep | keep |  | false | false |
| p07 | random | 0.0072 | 武備志(八十九) | 33 | retranslate-would-fix | retranslate-would-fix |  | true | true |
| p84 | random | 0.0119 | 易原·卷四~卷五 (vol 2) | 76 | keep | bad-regardless |  | null | null |
| p31 | random | 0.0122 | 武備志(八十五) | 5 | keep | retranslate-would-fix | keep | false | false |
| p71 | random | 0.013 | 武備志(三十九) | 9 | keep | bad-regardless |  | null | null |
| p55 | random | 0.0181 | 武備志(十三) | 55 | keep | bad-regardless |  | null | null |
| p25 | random | 0.0217 | 三才圖會(一百三) | 75 | keep | bad-regardless | bad-regardless | false | true |
| p72 | random | 0.0225 | 武備志(九十) | 17 | keep | bad-regardless |  | null | null |
| p59 | random | 0.0247 | 武備志(七十二) | 58 | bad-regardless | retranslate-would-fix |  | null | null |
| p65 | random | 0.0252 | 五燈會元·卷十六 (vol 16) | 30 | keep | bad-regardless |  | null | null |
| p40 | random | 0.0303 | 武備志(三十五) | 20 | bad-regardless | bad-regardless |  | true | false |
| p23 | random | 0.0314 | 五百石洞天揮塵 (Wubai Shi Dongtian  | 196 | bad-regardless | retranslate-would-fix | retranslate-would-fix | true | true |
| p52 | random | 0.0353 | 武備志(四十九) | 62 | keep | bad-regardless |  | null | null |
| p49 | random | 0.0368 | 本草綱目拾遺(八) | 116 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p41 | random | 0.0369 | 御定康熙字典·卷十九 (vol 54) | 5 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p79 | random | 0.039 | 救荒本草 (Jiuhuang Bencao: Famin | 70 | bad-regardless | bad-regardless |  | false | true |
| p43 | random | 0.0397 | 法書要錄·卷七~卷九 (vol 3) | 141 | bad-regardless | retranslate-would-fix |  | null | null |
| p60 | random | 0.0422 | 儒林外史(十九): The Scholars, vol  | 29 | keep | bad-regardless |  | null | null |
| p61 | random | 0.0449 | 養生類纂: Classified Compendium  | 23 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p26 | random | 0.0455 | 武備志(三十二) | 98 | keep | bad-regardless | keep | false | false |
| p78 | random | 0.0458 | 儒林外史(九): The Scholars, vol 9 | 67 | keep | bad-regardless |  | null | null |
| p73 | random | 0.0464 | 三才圖會(六) | 44 | retranslate-would-fix | retranslate-would-fix |  | true | true |
| p11 | random | 0.0545 | 御定康熙字典·卷八 (vol 43) | 5 | bad-regardless | bad-regardless |  | false | true |
| p82 | random | 0.0547 | 五燈會元·卷十四 (vol 14) | 4 | bad-regardless | bad-regardless |  | false | true |
| p67 | random | 0.0603 | 周易義海撮要·卷七 (vol 7) | 3 | keep | bad-regardless |  | null | null |
| p80 | random | 0.0612 | 三才圖會(四十一) | 7 | retranslate-would-fix | retranslate-would-fix |  | true | true |
| p77 | random | 0.0643 | 武備志(十七) | 57 | keep | bad-regardless |  | null | null |
| p27 | random | 0.0667 | 植物名實圖考(十五) | 77 | retranslate-would-fix | keep | retranslate-would-fix | true | false |
| p16 | random | 0.0717 | 駁五經異義疏證(三) (vol 3) | 102 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p36 | random | 0.0755 | 泰定養生主論 (三): Treatise on Nurt | 4 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p12 | random | 0.0763 | 巢氏諸病源候總論·卷四十七~卷五十 (vol 9) | 25 | retranslate-would-fix | bad-regardless | retranslate-would-fix | true | false |
| p32 | random | 0.0775 | 海國圖志(5) | 53 | bad-regardless | retranslate-would-fix | retranslate-would-fix | true | true |
| p63 | random | 0.0778 | 本草綱目拾遺(二) | 118 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p39 | random | 0.0851 | 禮記要義(二) (vol 2) | 108 | retranslate-would-fix | retranslate-would-fix |  | true | true |
| p85 | random | 0.0872 | 儒林外史(八): The Scholars, vol 8 | 26 | bad-regardless | retranslate-would-fix |  | null | null |
| p08 | random | 0.0919 | 元曲選 (Selected Yuan Plays), V | 131 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p20 | random | 0.0944 | 海國圖志(36) | 48 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p22 | random | 0.1212 | 三才圖會(二) | 58 | bad-regardless | retranslate-would-fix | retranslate-would-fix | true | false |
| p18 | random | 0.1234 | 新編直指算法統宗 (Suanfa Tongzong: S | 48 | retranslate-would-fix | retranslate-would-fix |  | true | true |
| p64 | random | 0.1237 | 武備志(七) | 52 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p24 | random | 0.129 | 植物名實圖考(二十二) | 115 | bad-regardless | bad-regardless |  | true | false |
| p83 | random | 0.1375 | 葉八白易傳·卷十一~卷十二 (vol 6) | 94 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p46 | random | 0.1667 | 抱朴子外篇 (卷二): Baopuzi, Outer C | 39 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p01 | random | 0.2 | 三才圖會(一百六) | 95 | keep | bad-regardless | keep | false | false |
| p58 | random | 0.2234 | 新編直指算法統宗 (Suanfa Tongzong: S | 19 | keep | bad-regardless |  | null | null |
| p21 | random | 0.2292 | 本草綱目·卷五十二 | 89 | keep | retranslate-would-fix | bad-regardless | false | true |
| p06 | random | 0.2538 | 御定康熙字典·卷六 (vol 41) | 9 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p04 | random | 0.2959 | 三才圖會(四十二) | 23 | keep | retranslate-would-fix | retranslate-would-fix | true | false |
| p81 | random | 0.3714 | 武備志(七十四) | 32 | keep | bad-regardless |  | null | null |
| p35 | random | 0.4416 | 御纂周易折中·卷二十一~卷二十二 (vol 26) | 113 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p44 | random | 0.5385 | 宣和書譜·卷七~卷十四 (vol 2) | 136 | keep | keep |  | false | false |
| p30 | random | 0.6271 | 羣書治要(一) (vol 1) | 10 | keep | bad-regardless | keep | false | false |
| p15 | top_decile | 0.7778 | 四書釋地補(二) (vol 2) | 7 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p70 | random | 0.7895 | 植物名實圖考(二十五) | 60 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p75 | top_decile | 0.7931 | 武備志(二十九) | 60 | keep | retranslate-would-fix |  | null | null |
| p34 | top_decile | 0.807 | 遵生八牋·卷十一~卷十二 (vol 9) | 57 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p66 | random | 0.8182 | 新校注古本西廂記 (Romance of the Wes | 46 | bad-regardless | bad-regardless |  | true | false |
| p03 | top_decile | 0.8218 | 御定孝經衍義·卷五十五~卷五十六 (vol 15) | 68 | retranslate-would-fix | retranslate-would-fix |  | true | true |
| p45 | top_decile | 0.8533 | 巢氏諸病源候總論·卷三十五~卷四十 (vol 7) | 25 | keep | bad-regardless |  | null | null |
| p54 | top_decile | 0.8871 | 周髀算經 (Zhou Bi Suanjing: Arit | 2 | keep | bad-regardless |  | null | null |
| p68 | top_decile | 0.8902 | 洞天奧旨 (Dongtian Aozhi: Esoter | 57 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p48 | top_decile | 0.913 | 遵生八牋·卷十四 (vol 11) | 131 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p19 | top_decile | 0.9565 | 武備志(四十五) | 69 | keep | retranslate-would-fix |  | null | null |
| p42 | top_decile | 0.9643 | 夢溪筆談 (Mengxi Bitan: Dream Po | 2 | bad-regardless | bad-regardless |  | true | false |
| p51 | top_decile | 0.9928 | 新編直指算法統宗 (Suanfa Tongzong: S | 46 | keep | retranslate-would-fix |  | null | null |
| p74 | top_decile | 0.9968 | 田間易學·卷五 (vol 7) | 129 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p05 | random | 1 | 武備志(七十三) | 89 | retranslate-would-fix | retranslate-would-fix |  | true | false |
| p09 | random | 1 | 武備志(四十一) | 99 | bad-regardless | bad-regardless |  | true | false |
| p10 | top_decile | 1 | 御定康熙字典·卷四 (vol 39) | 4 | keep | retranslate-would-fix |  | null | null |
| p14 | top_decile | 1 | 三才圖會(九十七) | 6 | keep | retranslate-would-fix |  | null | null |
| p33 | top_decile | 1 | 三才圖會(三十六) | 47 | keep | bad-regardless |  | null | null |
| p37 | top_decile | 1 | 三才圖會(一百五) | 24 | bad-regardless | bad-regardless |  | false | true |
| p38 | random | 1 | 武備志(五十九) | 48 | keep | retranslate-would-fix |  | null | null |
| p47 | top_decile | 1 | 海國圖志(47) | 74 | keep | retranslate-would-fix |  | null | null |
| p56 | top_decile | 1 | 三才圖會(六十二) | 70 | keep | keep |  | false | false |
| p62 | top_decile | 1 | 三才圖會(五十九) | 9 | bad-regardless | bad-regardless |  | true | false |
| p69 | top_decile | 1 | 四書大全論語集註大全·卷四~卷五 (vol 3) | 60 | retranslate-would-fix | retranslate-would-fix |  | true | false |
