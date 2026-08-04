# Pages with a genuine second OCR pass (2026-08-03)
Inventory of pages carrying **two or more independent model passes over the same leaf**.
Built from `page_revisions` (field `ocr`) with the #3473 filters in
`scripts/lib/revision-pairs.mjs` — a revision alone does not mean the page was read twice.
## Headline
- revisions read: **191,221**
- pages carrying at least one stored OCR revision: **164,664**
- **pages genuinely OCR'd 2+ times: 97,421** (59.2% of them)
- usable pair transitions: **117,729**
- pages whose ONLY revision is the e-rara shift sweep (not a second read): **55,841**
- pairs demoted by the per-book shift verdict (unverified leaf in a demonstrably shifted book): **1,822**
- live page doc missing (book purged): 5,185
## Why pairs were excluded
`ok` is the usable population. Every other row is a pair that *looks* like a second
read from inside `page_revisions` and is not one.
| reason | pages |
|---|---:|
| ok | 117,729 |
| text-move-source | 56,822 |
| different-leaf | 5,330 |
| different-script | 3,809 |
| book-shifted | 1,822 |
| human-edit | 21 |
| derived-text | 1 |

## Leaf evidence on the usable pages
`verified-same-leaf` = both passes printed the same page number, so they demonstrably
read one leaf. `unverified-leaf` = at least one side printed no page number; the pair
survives on the book-level verdict, which is weaker evidence. Report the split — do not
quote the total as if it were all verified.
| evidence | pages |
|---|---:|
| verified-same-leaf | 63,776 |
| unverified-leaf | 33,645 |

## Reads per page
| independent reads | pages |
|---|---:|
| 2 | 80,338 |
| 3 | 13,858 |
| 4 | 3,225 |

## By language
| language | pages |
|---|---:|
| Latin | 32,656 |
| German | 23,695 |
| English | 17,042 |
| Greek | 5,370 |
| French | 4,521 |
| auto-detect | 2,082 |
| Dutch | 1,300 |
| Italian | 1,283 |
| Tibetan | 1,167 |
| Chinese | 1,102 |
| Persian | 650 |
| Korean | 555 |
| Lb | 484 |
| Middle English | 460 |
| Sanskrit | 452 |
| Arabic | 440 |
| Hebrew | 322 |
| Polish | 315 |
| Armenian | 253 |
| Classical Chinese | 242 |

## By model transition
| prior → current | pages |
|---|---:|
| gemini-3-flash-preview→gemini-3-flash-preview | 55,485 |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 46,280 |
| gemini-3.1-flash-lite→gemini-3.1-flash-lite | 12,269 |
| gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,160 |
| gemini-3.1-flash-lite→gemini-3-flash-preview | 634 |
| gemini-2.5-flash→gemini-3-flash-preview | 571 |
| gemini-3-flash-preview→gemini-3.1-flash-lite | 554 |
| gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 409 |
| ?→gemini-3.1-flash-lite-preview | 292 |
| gemini-2.5-flash→claude-sonnet-4-6 | 47 |
| gemini-3-flash-preview→claude-sonnet-4-6 | 27 |
| gemini-2.0-flash→claude-sonnet-4-6 | 1 |

## Books
- shifted (their images moved under their text): **39**
- clean: **1,244**
- insufficient evidence (fewer than 3 pairs printing a page number): **268**
## Source labels

All source labels recognised.

Rows: `double-ocr-pages-2026-08-03.jsonl` · summary: `double-ocr-pages-2026-08-03.json`