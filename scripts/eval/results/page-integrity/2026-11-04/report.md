# Page integrity draw 2026-11-04 (#8040)

n = 200 pages judged of 200 drawn, one per book, seed 20261104, frame 70942 visible books. Opus via claude -p, sealed, images opened (AI reviewers). 121 pages carry a transcription, 67 carry English (10 more have it withheld), 36 a stored printed number; 3 hold Claude-made text.

| defect | k/n (%, 95% Wilson) |
|---|---|
| text: a neighbour's leaf | 0/121 (0%, 0–3.1) |
| text: other book or elsewhere | 2/121 (1.7%, 0.5–5.8) |
| text: empty where the leaf has text | 76/200 (38%, 31.6–44.9) |
| english: renders a neighbour | 0/67 (0%, 0–5.4) |
| english: invents | 0/67 (0%, 0–5.4) |
| number: stored printed number differs from the print | 1/35 (2.9%, 0.5–14.5) |
| number: the leaf has a number and none is stored | 73/108 (67.6%, 58.3–75.7) |
| number: frame differs from the print | 103/108 (95.4%, 89.6–98) |
| order: backward | 0/194 (0%, 0–1.9) |
| order: jumbled | 0/194 (0%, 0–1.9) |
| split: two leaves in a frame | 7/200 (3.5%, 1.7–7) |
| split: one plate cut in two | 0/200 (0%, 0–1.9) |
| repeat: a neighbour is the same leaf | 1/200 (0.5%, 0.1–2.8) |

Judge: planted controls missed 4/38 (10.5%, 4.2–24.1). Flags asked again blind: 11 of 11 repeated; clean pages asked again: 10 of 10 stayed clean. Control classes under the registered bar: none.

| control | caught |
|---|---|
| shift_run | 4/5 |
| number_stamp | 3/4 |
| neighbour_text | 4/5 |
| wrong_image_other_book | 5/5 |
| order_backward | 4/5 |
| two_leaves | 4/4 |
| english_other_book | 5/5 |
| english_neighbour | 5/5 |

### By language group
| | n | text not this leaf | English not this text | stored number wrong | order wrong | split |
|---|---:|---|---|---|---|---|
| CJK | 43 | 0/39 (0%, 0–9) | 0/5 (0%, 0–43.4) | — | 0/43 (0%, 0–8.2) | 0/43 (0%, 0–8.2) |
| English | 15 | 1/14 (7.1%, 1.3–31.5) | 0/9 (0%, 0–29.9) | 1/8 (12.5%, 2.2–47.1) | 0/15 (0%, 0–20.4) | 1/15 (6.7%, 1.2–29.8) |
| German | 22 | 0/8 (0%, 0–32.4) | 0/4 (0%, 0–49) | 0/4 (0%, 0–49) | 0/22 (0%, 0–14.9) | 0/22 (0%, 0–14.9) |
| Latin | 84 | 1/34 (2.9%, 0.5–14.9) | 0/26 (0%, 0–12.9) | 0/13 (0%, 0–22.8) | 0/82 (0%, 0–4.5) | 0/84 (0%, 0–4.4) |
| Romance + Dutch | 17 | 0/12 (0%, 0–24.2) | 0/12 (0%, 0–24.2) | 0/6 (0%, 0–39) | 0/15 (0%, 0–20.4) | 1/17 (5.9%, 1–27) |
| other Latin script | 1 | 0/1 (0%, 0–79.3) | 0/1 (0%, 0–79.3) | 0/1 (0%, 0–79.3) | 0/1 (0%, 0–79.3) | 0/1 (0%, 0–79.3) |
| other script | 18 | 0/13 (0%, 0–22.8) | 0/10 (0%, 0–27.8) | 0/3 (0%, 0–56.1) | 0/16 (0%, 0–19.4) | 5/18 (27.8%, 12.5–50.9) |

### By whether a repair touched the book
| | n | text not this leaf | English not this text | stored number wrong | order wrong | split |
|---|---:|---|---|---|---|---|
| #5021 touched this book | 0 | — | — | — | — | — |
| #5021 not touched | 200 | 2/121 (1.7%, 0.5–5.8) | 0/67 (0%, 0–5.4) | 1/35 (2.9%, 0.5–14.5) | 0/194 (0%, 0–1.9) | 7/200 (3.5%, 1.7–7) |
| #5803 touched this book | 1 | 1/1 (100%, 20.7–100) | — | 0/1 (0%, 0–79.3) | 0/1 (0%, 0–79.3) | 0/1 (0%, 0–79.3) |
| #5803 not touched | 199 | 1/120 (0.8%, 0.1–4.6) | 0/67 (0%, 0–5.4) | 1/34 (2.9%, 0.5–14.9) | 0/193 (0%, 0–2) | 7/199 (3.5%, 1.7–7.1) |
| #5699 touched this book | 0 | — | — | — | — | — |
| #5699 not touched | 200 | 2/121 (1.7%, 0.5–5.8) | 0/67 (0%, 0–5.4) | 1/35 (2.9%, 0.5–14.5) | 0/194 (0%, 0–1.9) | 7/200 (3.5%, 1.7–7) |
| #5056 touched this book | 4 | 0/4 (0%, 0–49) | 0/4 (0%, 0–49) | 0/2 (0%, 0–65.8) | 0/4 (0%, 0–49) | 0/4 (0%, 0–49) |
| #5056 not touched | 196 | 2/117 (1.7%, 0.5–6) | 0/63 (0%, 0–5.7) | 1/33 (3%, 0.5–15.3) | 0/190 (0%, 0–2) | 7/196 (3.6%, 1.7–7.2) |

### Positives
| page | flags | repeated on re-judge | language | repairs touching the book |
|---|---|---|---|---|
| [b18b1a f.1](https://sourcelibrary.org/book/69e795ea80b52390feb18b1a/page-number/1) | split:two_leaves | split:two_leaves | other script | none |
| [0cfe15 f.22](https://sourcelibrary.org/book/69ac7fdd6a7dbd267e0cfe15/page-number/22) | text:other, number:label_disagrees | text:other, number:label_disagrees | English | none |
| [b2395c f.175](https://sourcelibrary.org/book/6a089ad2c00e102b3bb2395c/page-number/175) | split:two_leaves | split:two_leaves | English | none |
| [57a5f6 f.9](https://sourcelibrary.org/book/69b525aa29577f283b57a5f6/page-number/9) | split:two_leaves | split:two_leaves | Romance + Dutch | none |
| [aa3e47 f.266](https://sourcelibrary.org/book/69e7ac1e5f1a22ab19aa3e47/page-number/266) | split:two_leaves | split:two_leaves | other script | none |
| [21e634 f.444](https://sourcelibrary.org/book/6a14e148311a9edd4621e634/page-number/444) | split:two_leaves | split:two_leaves | other script | none |
| [cab898 f.57](https://sourcelibrary.org/book/69aebfdee997cc01b0cab898/page-number/57) | text:other | text:other | Latin | #5803 |
| [fabc80 f.195](https://sourcelibrary.org/book/6ac4f7d2e4016f24bafabc80/page-number/195) | repeat:next | order:jumbled, repeat:next | other script | none |
| [b1690d f.2](https://sourcelibrary.org/book/69e792bd80b52390feb1690d/page-number/2) | split:two_leaves | split:two_leaves | other script | none |
| [b16917 f.2](https://sourcelibrary.org/book/69e792c180b52390feb16917/page-number/2) | split:two_leaves | split:two_leaves | other script | none |
