# NDL lane pilot (#4925) — pages read against the image, 2026-09-30

Reader: Claude (claude-opus-5-5). "Image" = the R2 page image opened at ~1,900 px; "column level" = column starts and
lengths matched, not every character; "known text" = checked against a canonical text I know independently of the page.

## The seeded by-eye packet (seed 4925, one page per book)

| page | stored (Gemini) | NDL | how checked |
|---|---|---|---|
| Ise monogatari vol.1 p.48 | flash-lite: 「昔男ありけり…」 — **not on the page** (invented) | dan 15–16 column by column: 昔みちのくにゝて…しのふ山忍ひてかよふみちもかな／人のこゝろのおくも見るへく…みよのみかとにつかうまつりて; ~4 slips in ~150 chars (十五→十人, 明 for な, やかしき・せりつね for むかしき・ありつね) | image + known text |
| Kanze-ryū utaibon vol.6 p.26 | none (first write) | *Sakuragawa* (桜子) on both leaves, coherent; slips 議 for 縁, ずきぬ for さかぬ; first line is noise from the red performance marks | image |
| Nōgyō zensho vol.10 p.28 | none | both leaves correct: 薄荷 cultivation, 香薷・澤瀉・麦門冬 第廿二–廿四, 丹波; rare-kanji slips 画 for 薷, 馬 for 瀉 | image |
| Anma tebiki p.50 | none | three body texts correct (辛 for 章, す for 漕); the three **boxed headings (櫓盪の手, 臍上の手) come out as ten noise lines** (十月／の／五／大郎／□□) | image |
| Nihon saijiki vol.3–4 p.28 | none | all 11 columns correct; one spurious first line (同十三日) from the margin folio | image |

## Paired pages (both readings exist; one per book, seed 11)

| page | stored (Gemini) | NDL | how checked |
|---|---|---|---|
| Bunshō p.12 (MS) | flash-lite: a 6-line lament not on the page | 9 columns fitting the page's 9, the *Bunshō sōshi* plot (蔵…さてすへつくへき子はあるか) | image, column level + known plot |
| Genji monogatari (woodblock) p.28 — *hikiuta* | loop; invented 僧都…いとどあはれ | real Kokinshū poems with the page's source notes: 春のよのやみはあやなし梅花 (KKS 41), 梅の花たちよるはかり (KKS 35) | image + known text |
| Ganzan Daishi omikuji p.21 | the large verse right (仙鶴立高枝…), but lot number wrong (十三 for 三十), a modern-Japanese gloss **not on the page**, left leaf skipped | the printed kana fortunes read (此みくじにあふ人は…うせ物出ずまち人きたらず; 大本 作凶); **the large verse characters mangled** | image — **mixed** |
| Utaibon vol.6 p.22, Kōshoku ichidai otoko p.10 | an invented passage; a loop of short words | coherent Sakuragawa / Saikaku prose | text only (not image-checked) |

**Tally:** NDL gives the page's text on 9 of the 10 pages opened, with character slips concentrated in rare kanji. On the
omikuji it is mixed. Where a Gemini reading existed, it was invented or a loop on 3 of 4 image-checked pages and partly
right on 1. NDL's failure mode is visible, not hidden: **large display type (boxed headings, omikuji verses) and margin
marks become short noise lines** at the top of the page.
