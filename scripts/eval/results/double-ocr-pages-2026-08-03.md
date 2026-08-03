# Pages with a genuine second OCR pass (2026-08-03)
Inventory of pages carrying **two or more independent model passes over the same leaf**.
Built from `page_revisions` (field `ocr`) with the #3473 filters in
`scripts/lib/revision-pairs.mjs` — a revision alone does not mean the page was read twice.
## Headline
- revisions read: **191,221**
- pages carrying at least one stored OCR revision: **164,664**
- **pages genuinely OCR'd 2+ times: 98,214** (59.6% of them)
- usable pair transitions: **118,560**
- pages whose ONLY revision is the e-rara shift sweep (not a second read): **55,841**
- pairs demoted by the per-book shift verdict (unverified leaf in a demonstrably shifted book): **2,487**
- live page doc missing (book purged): 5,185
## Why pairs were excluded
`ok` is the usable population. Every other row is a pair that *looks* like a second
read from inside `page_revisions` and is not one.
| reason | pages |
|---|---:|
| ok | 118,560 |
| text-move-source | 56,822 |
| different-leaf | 7,643 |
| book-shifted | 2,487 |
| human-edit | 21 |
| derived-text | 1 |

## Leaf evidence on the usable pages
`verified-same-leaf` = both passes printed the same page number, so they demonstrably
read one leaf. `unverified-leaf` = at least one side printed no page number; the pair
survives on the book-level verdict, which is weaker evidence. Report the split — do not
quote the total as if it were all verified.
| evidence | pages |
|---|---:|
| verified-same-leaf | 63,998 |
| unverified-leaf | 34,216 |

## Reads per page
| independent reads | pages |
|---|---:|
| 2 | 81,094 |
| 3 | 13,894 |
| 4 | 3,226 |

## By language
| language | pages |
|---|---:|
| Latin | 32,712 |
| German | 23,696 |
| English | 17,052 |
| Greek | 5,516 |
| French | 4,521 |
| auto-detect | 2,083 |
| Tibetan | 1,355 |
| Dutch | 1,300 |
| Italian | 1,283 |
| Chinese | 1,157 |
| Persian | 674 |
| Korean | 645 |
| Sanskrit | 577 |
| Lb | 499 |
| Middle English | 460 |
| Arabic | 443 |
| Hebrew | 335 |
| Polish | 315 |
| Armenian | 253 |
| Classical Chinese | 245 |

## By model transition
| prior → current | pages |
|---|---:|
| gemini-3-flash-preview→gemini-3-flash-preview | 55,635 |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 46,661 |
| gemini-3.1-flash-lite→gemini-3.1-flash-lite | 12,322 |
| gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,282 |
| gemini-3.1-flash-lite→gemini-3-flash-preview | 637 |
| gemini-3-flash-preview→gemini-3.1-flash-lite | 625 |
| gemini-2.5-flash→gemini-3-flash-preview | 572 |
| gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 429 |
| ?→gemini-3.1-flash-lite-preview | 322 |
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