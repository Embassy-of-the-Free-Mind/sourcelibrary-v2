# Pages with a genuine second translation pass (2026-08-03)
Inventory of pages carrying **two or more independent model passes over the same leaf**.
Built from `page_revisions` (field `translation`) with the #3473 filters in
`scripts/lib/revision-pairs.mjs` — a revision alone does not mean the page was read twice.
## Headline
- revisions read: **134,544**
- pages carrying at least one stored OCR revision: **133,287**
- **pages genuinely translated 2+ times: 70,508** (52.9% of them)
- usable pair transitions: **70,555**
- pages whose ONLY revision is the e-rara shift sweep (not a second read): **54,221**
- pairs demoted by the per-book shift verdict (unverified leaf in a demonstrably shifted book): **1,193**
- live page doc missing (book purged): 1,749
## Why pairs were excluded
`ok` is the usable population. Every other row is a pair that *looks* like a second
read from inside `page_revisions` and is not one.
| reason | pages |
|---|---:|
| ok | 70,555 |
| text-move-source | 55,317 |
| derived-text | 2,882 |
| book-shifted | 1,193 |
| different-leaf | 62 |
| human-edit | 48 |

## Leaf evidence on the usable pages
`verified-same-leaf` = both passes printed the same page number, so they demonstrably
read one leaf. `unverified-leaf` = at least one side printed no page number; the pair
survives on the book-level verdict, which is weaker evidence. Report the split — do not
quote the total as if it were all verified.
| evidence | pages |
|---|---:|
| unverified-leaf | 69,720 |
| verified-same-leaf | 788 |

## Reads per page
| independent reads | pages |
|---|---:|
| 2 | 70,462 |
| 3 | 45 |
| 4 | 1 |

## By language
| language | pages |
|---|---:|
| Latin | 18,925 |
| Tibetan | 17,738 |
| English | 7,011 |
| German | 4,811 |
| Sanskrit | 3,363 |
| French | 2,581 |
| Greek | 2,501 |
| Arabic | 1,750 |
| Korean | 1,681 |
| Dutch | 1,650 |
| Ge'ez | 1,034 |
| Hebrew | 1,023 |
| Italian | 1,011 |
| Chinese | 768 |
| Persian | 741 |
| auto-detect | 549 |
| Russian | 451 |
| Hindi | 404 |
| Japanese | 245 |
| Spanish | 201 |

## By model transition
| prior → current | pages |
|---|---:|
| gemini-3-flash-preview→gemini-3-flash-preview | 27,709 |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 27,572 |
| gemini-3.1-flash-lite→gemini-3.1-flash-lite | 7,912 |
| gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 6,507 |
| gemini-2.5-flash→gemini-3.1-flash-lite-preview | 401 |
| gemini-3.1-flash-lite→gemini-3-flash-preview | 163 |
| gemini-2.5-flash→gemini-3-flash-preview | 150 |
| gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 56 |
| gemini→gemini-3-flash-preview | 22 |
| gemini-2.5-flash→? | 19 |
| gemini-3-flash-preview→gemini-3.1-flash-lite | 17 |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite | 13 |
| gemini-2.0-flash→gemini-3-flash-preview | 9 |
| gemini-2.0-flash-exp→gemini-3-flash-preview | 2 |
| gemini-2.5-flash→claude-sonnet-4-6 | 1 |
| gemini-2.5-flash→gemini-2.5-flash | 1 |
| ?→gemini-2.0-flash | 1 |

## Books
- shifted (their images moved under their text): **3**
- clean: **85**
- insufficient evidence (fewer than 3 pairs printing a page number): **244**
## Source labels

All source labels recognised.

Rows: `double-translation-pages-2026-08-03.jsonl` · summary: `double-translation-pages-2026-08-03.json`