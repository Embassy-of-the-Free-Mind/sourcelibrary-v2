# Test-set inventory (#264, stage 1 step 1)

Generated 2026-11-13 by `scripts/eval/test-set-264/inventory.mjs` (read-only). Router table `2026-11-01-validated-7263`.

Cells are the router's OCR cell ids; cells under 20K pages waiting are pooled into one `other-<script>` cell per writing script. A reference passes when none of #264's rules applies; canonical references pass but are counted apart, and the gap is to the cell's target in **non-canonical** referenced books. A judged page passes when it came from a random draw, the task is OCR, and the verdict is on the route judge's scale.

## Per cell

| cell | pages waiting | target books | refs mapped | refs pass | of which canonical | fail: model-made | fail: own output | fail: no leaf check | fail: no text | books, non-canonical ref | gap to target (ref) | judged pages | judged pass | books judged | gap to target (judged) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `latin-lite/print` | 835,238 | 50 | 49 | 38 | 1 | 8 | 3 | 0 | 0 | 16 | 34 | 188 | 174 | 103 | 0 |
| `latin-lite/manuscript` | 26,268 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 30 | 15 | 14 | 10 | 20 |
| `latin-flash3/print` | 692,318 | 50 | 131 | 119 | 0 | 6 | 6 | 0 | 0 | 90 | 0 | 269 | 266 | 213 | 0 |
| `latin-flash3/manuscript` | 76,402 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 30 | 16 | 16 | 11 | 19 |
| `latin-flash3/unknown` | 549,086 | 50 | 20 | 18 | 0 | 0 | 2 | 0 | 0 | 7 | 43 | 92 | 92 | 66 | 0 |
| `german-lite/print` | 409,596 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 | 488 | 340 | 76 | 0 |
| `german-flash3/print` | 139,496 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 | 142 | 65 | 35 | 15 |
| `german-flash3/unknown` | 211,906 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 | 43 | 16 | 16 | 34 |
| `french-lite/print` | 143,663 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 | 75 | 67 | 57 | 0 |
| `greek-flash3/print` | 208,482 | 50 | 38 | 0 | 0 | 0 | 0 | 38 | 15 | 0 | 50 | 109 | 107 | 93 | 0 |
| `greek-flash3/manuscript` | 46,508 | 30 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 30 | 11 | 11 | 7 | 23 |
| `greek-flash3/unknown` | 164,160 | 50 | 20 | 0 | 0 | 0 | 0 | 20 | 11 | 0 | 50 | 65 | 65 | 56 | 0 |
| `tibetan-yigdzin/manuscript` | 272,550 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 | 117 | 117 | 91 | 0 |
| `zh-paddle-dice-lt090/manuscript` | 453,715 | 50 | 17 | 0 | 0 | 0 | 0 | 17 | 4 | 0 | 50 | 130 | 124 | 64 | 0 |
| `chinese-flash3/print` | 84,721 | 30 | 6 | 0 | 0 | 0 | 0 | 6 | 2 | 0 | 30 | 149 | 139 | 127 | 0 |
| `zh-frame-6871/manuscript` | 22,220 | 30 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 30 | 34 | 34 | 31 | 0 |
| `hebrew-flash3/unknown` | 31,242 | 30 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 30 | 44 | 44 | 41 | 0 |
| `greek-lite/manuscript` | 30,117 | 30 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 30 | 256 | 256 | 16 | 14 |
| `sanskrit-lite/print` | 36,624 | 30 | 9 | 0 | 0 | 0 | 9 | 9 | 0 | 0 | 30 | 256 | 255 | 13 | 17 |
| `italian-lite/print` | 45,202 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 30 | 45 | 40 | 13 | 17 |
| `latin-blank/print` | 2,070,214 | 50 | 273 | 180 | 0 | 85 | 0 | 8 | 8 | 73 | 0 | 36 | 36 | 33 | 17 |
| `german-blank/print` | 320,128 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 | 6 | 6 | 6 | 44 |
| `french-blank/print` | 36,242 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 30 | 19 | 19 | 19 | 11 |
| `english-blank-pre1800/unknown` | 41,224 | 30 | 22 | 0 | 0 | 22 | 0 | 0 | 0 | 0 | 30 | 3 | 3 | 3 | 27 |
| `other-latin-script` | 53,114 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 30 | 83 | 68 | 63 | 0 |
| `other-tibetan` | 8,074 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 2 | 2 | 2 | 13 |
| `other-cjk` | 54,457 | 30 | 12 | 0 | 0 | 0 | 0 | 12 | 9 | 0 | 30 | 167 | 165 | 75 | 0 |
| `other-hebrew` | 20,117 | 30 | 4 | 0 | 0 | 0 | 4 | 4 | 0 | 0 | 30 | 23 | 23 | 22 | 8 |
| `other-arabic` | 58,034 | 30 | 11 | 0 | 0 | 0 | 11 | 11 | 0 | 0 | 30 | 335 | 332 | 78 | 0 |
| `other-greek` | 12,799 | 15 | 2 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 15 | 15 | 8 | 7 | 8 |
| `other-indic` | 3,165 | 15 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 15 | 2 | 2 | 2 | 13 |
| `other-cyrillic` | 18,952 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 5 | 3 | 3 | 12 |
| **all cells** | 7,176,034 | 1160 | 619 | 355 | 1 | 121 | 37 | 132 | 52 | 186 | 1037 | 3240 | 2909 | 1452 | 312 |

## Not in any cell

References: 453 of 1072.

| why | records |
|---|---:|
| Greek text by none: no router cell (not waiting, or no cell for this engine) | 139 |
| Paddle text with Kanripo dice >= 0.90 or unscreened: not waiting | 84 |
| English text by flash3: no router cell (not waiting, or no cell for this engine) | 83 |
| English text by lite: no router cell (not waiting, or no cell for this engine) | 58 |
| English text by other: no router cell (not waiting, or no cell for this engine) | 30 |
| no router cell for language Syriac | 19 |
| no router cell for language Persian | 10 |
| Chinese text by none: no router cell (not waiting, or no cell for this engine) | 10 |
| English, no stored text, 1800 or later or undated: no cell | 6 |
| Latin text by agy: no router cell (not waiting, or no cell for this engine) | 5 |
| Sanskrit text by flash3: no router cell (not waiting, or no cell for this engine) | 4 |
| Hebrew text by lite: no router cell (not waiting, or no cell for this engine) | 1 |
| Latin text by other: no router cell (not waiting, or no cell for this engine) | 1 |
| English text by agy: no router cell (not waiting, or no cell for this engine) | 1 |
| no router cell for language Ancient Greek | 1 |
| no router cell for language Syriac, with many headings and subscriptions to the sections of the book in Arabic either alone or mixed with Syriac. | 1 |

Judged pages: 2050 of 5290.

| why | pages |
|---|---:|
| Latin text by agy: no router cell (not waiting, or no cell for this engine) | 613 |
| Paddle text with Kanripo dice >= 0.90 or unscreened: not waiting | 278 |
| English text by flash3: no router cell (not waiting, or no cell for this engine) | 115 |
| French text by agy: no router cell (not waiting, or no cell for this engine) | 111 |
| English text by lite: no router cell (not waiting, or no cell for this engine) | 111 |
| no router cell for language Persian | 60 |
| English text by other: no router cell (not waiting, or no cell for this engine) | 57 |
| no router cell for language Syriac | 54 |
| no router cell for language Japanese | 53 |
| Spanish text by agy: no router cell (not waiting, or no cell for this engine) | 51 |
| no router cell for language Dutch | 47 |
| Italian text by flash3: no router cell (not waiting, or no cell for this engine) | 43 |
| no router cell for language Egyptian hieroglyphs | 41 |
| Sanskrit text by flash3: no router cell (not waiting, or no cell for this engine) | 40 |
| German text by agy: no router cell (not waiting, or no cell for this engine) | 37 |
| Russian text by flash3: no router cell (not waiting, or no cell for this engine) | 34 |
| Tibetan text by none: no router cell (not waiting, or no cell for this engine) | 34 |
| Italian text by agy: no router cell (not waiting, or no cell for this engine) | 34 |
| Korean text by flash3: no router cell (not waiting, or no cell for this engine) | 26 |
| French text by flash3: no router cell (not waiting, or no cell for this engine) | 21 |
| Spanish text by none: no router cell (not waiting, or no cell for this engine) | 15 |
| Italian text by none: no router cell (not waiting, or no cell for this engine) | 13 |
| Spanish text by flash3: no router cell (not waiting, or no cell for this engine) | 12 |
| Hebrew text by lite: no router cell (not waiting, or no cell for this engine) | 12 |
| no router cell for language Armenian | 10 |

## Wave-2 panels mapped to cells

The eight sets the 38 engines were scored on (`/root/engine-wave2-6011/sets.json`, #6011). Books: library book ids, or for external pages the scan or manuscript the slug names.

| set | pages | books | library pages | external pages | ref passes rules | ref fails a rule | no record in refs/ | frame cells (pages) |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| latin | 158 | 158 | 96 | 62 | 92 | 4 | 62 | latin-flash3/print 74; (none: external page (no library book)) 62; latin-lite/print 10; latin-blank/print 7; (none: Latin text by agy: no router cell (not waiting, or no cell for this engine)) 4; latin-flash3/unknown 1 |
| english | 44 | 44 | 44 | 0 | 0 | 44 | 0 | (none: English text by flash3: no router cell (not waiting, or no cell for this engine)) 32; (none: English text by lite: no router cell (not waiting, or no cell for this engine)) 12 |
| latin-script-other | 23 | 23 | 0 | 23 | 0 | 0 | 23 | (none: external page (no library book)) 23 |
| greek | 127 | 126 | 114 | 13 | 0 | 114 | 13 | (none: Greek text by none: no router cell (not waiting, or no cell for this engine)) 90; greek-flash3/print 17; (none: external page (no library book)) 13; greek-flash3/unknown 5; other-greek 1; (none: no router cell for language Ancient Greek) 1 |
| chinese-manuscript | 503 | 501 | 503 | 0 | 0 | 71 | 432 | (none: Paddle text with Kanripo dice >= 0.90 or unscreened: not waiting) 310; zh-paddle-dice-lt090/manuscript 90; chinese-flash3/print 66; (none: Chinese text by none: no router cell (not waiting, or no cell for this engine)) 33; zh-frame-6871/manuscript 3; other-cjk 1 |
| chinese-print | 19 | 19 | 19 | 0 | 0 | 19 | 0 | (none: Paddle text with Kanripo dice >= 0.90 or unscreened: not waiting) 17; chinese-flash3/print 2 |
| armenian | 5 | 3 | 0 | 5 | 0 | 0 | 5 | (none: external page (no library book)) 5 |
| syriac | 40 | 2 | 0 | 40 | 0 | 0 | 40 | (none: external page (no library book)) 40 |

## The issue's counts, reproduced

| count | value |
|---|---:|
| records | 1072 |
| made_by_engine | 241 |
| model_transcription | 99 |
| model_made_union | 241 |
| model_made_overlap | 99 |
| own_output_5695 | 41 |
| own_output_all | 52 |
| no_leaf_check_field | 401 |
| leaf_check_ok | 671 |
| canonical_field_true | 5 |
| canonical_field_missing | 401 |
| canonical_from_source | 266 |
| no_text | 118 |
| external | 0 |
| pass_all_rules | 355 |
| pass_all_rules_noncanonical | 354 |
| by_source_canonical | {"Perseus":101,"First1K":48,"Kanripo":94,"CBETA":18} |
| judged_pages | 5290 |
| judged_rows | 11360 |
| judged_books | 2821 |
| judged_pass | 2909 |
