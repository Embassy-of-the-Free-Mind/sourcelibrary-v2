# Chinese library: a walkthrough as a Chinese reader, an English reader and an MCP user (2026-11-04)

PRIOR ART: `2026-11-03-chinese-translation-strata-5274.md` measures translation quality on a stratified
sample and is not repeated here. This record covers what that one does not: what each kind of reader meets.

**Who it is for:** whoever picks up #8035, #7175 or #7537. **Method:** a clean headless Chrome (zh-CN and en-US,
1366px and 390px) on live production, live `/api/search`, the public MCP tools, a read-only census of `books`, and
page scans opened by eye. **Not tested:** access from mainland China (GreatFire has no data for the domain; no
vantage point inside the firewall), real readers, usage figures. **The pages read by eye are showcase books chosen
by hand, not a random sample;** the quality rates remain those in the 2026-11-03 record.

## Corpus (visible, `pages_count > 0`, Chinese + Classical Chinese)
12,964 volumes, 1,318 distinct `work_id`, 1.95M pages. Any English: 22.4% of volumes (2,906). At least 90% in
English: 17.8%. 12,058 volumes come from the Siku lane: 经 (KR1) 5,313, 子 (KR3) 6,487, 佛 (KR6) 258, none in 史 (KR2)
or 集 (KR4). Whole classes are absent (#8053). A title regex over live books found no 漢書, 資治通鑑, 楚辭, 文選,
杜工部集 or 永樂大典; a regex is not a holdings check, and `check_duplicate` cannot settle it (below).

## By eye (10 scans opened for text, 2 star-map scans, 1 French page; of p.173–178, p.174–177 were opened and p.173 and 178 are their partners by the stored text)
| Page | Transcription | English |
|---|---|---|
| 本草綱目 卷十六 p.56 (Siku, PaddleOCR) | matches the scan throughout | sound; 藏器 (an attribution) reads as a heading |
| 性命圭旨 p.60, 61, 301, 302 | near-perfect | p.60 and 301–302 sound, p.61 carries stray `<margin>` tags |
| 性命圭旨 p.173–178 | **each pair holds the other's text** | same; withheld, see below |
| 陳道翁就正篇 p.28 (Gemini 3 Flash) | **本穴 misread as 根元 twice; 而不自知落于以心逐氣之病 became 而不知調心。心逐氣之病** | English follows the misread: "not how to regulate the mind" is not on the leaf |
| 西洋新法曆書 p.30–31 | star maps, no text | descriptive notes, consistent with the scans |

**Contained in this run** (`containment-on-finding.md`): 性命圭旨 p.173–178 withheld by eye, read back 6/6, book
already held. Image key order was tested as a detector and **rejected**: 174 of 360 steps in this book run backward,
but that is ordinary right-to-left order, and p.60, 61, 301 and 302 have backward keys and correct text. Only two
Chinese books show the pattern, which therefore bounds nothing. Together with p.270 and p.333–334 (#7263 pilot), these
are local stretches whose cause is not established. A clue: the search index still returns the correct English for
p.175. Comparing the index text with Mongo at N±1 would be a $0 screen.

## Chinese reader (/zh)
Works: Simplified interface, 四部 entry at `/zh/collections`, 中文 pane by default, honest "not yet checked" line,
no horizontal scroll on the phone, sign-in by email (Google is blocked in China, so this matters).

| Finding | Evidence |
|---|---|
| First hit for 道德經 is Julien's 1842 French edition, labelled 中文; its French appears under 中文原文 | `/zh/book/dao-de-jing-laozi`, title page and p.20 by eye |
| Simplified queries are weaker: 13 of 18 differing title pairs reach the top 5 against 18 of 18 traditional (rank 1: 10 against 17) | `/api/search`, `language=Chinese`; 红楼梦 rank 7, 金刚经 12, 史记 14 |
| 史記 ranks 5th for its own title, even in traditional | same test |
| Search results show English titles; a book page shows 本草綱目·卷十六 and a result shows "Dream of the Red Chamber" | `/zh/search` by eye |
| Book "about" text is English on /zh; only 3.9% of volumes have `localized.zh` | `/zh/book/*`, census |
| Authors romanised, "LAOZI" in capitals, date "588–公元前1，作者成年时期" | `/zh/book/dao-de-jing-laozi` |
| Filter list mixes English names and internal shelves: "Eternity spot-check shelf(15)", "Slime Moulds(25)", "Atharvaveda…(0)" | `/zh/search`; the QA shelf is on `/search` too |
| Count mislabelled: "12,878 部" on the home page; these are volumes (12,972 册 / 1,150 种 on `/zh/collections`) | by eye |
| Hero sells "AI 翻译", a poor first line for a reader who came for the originals | `/zh` |
| The "newest translated" shelf closely matches the books contained by hand on 11-03 (三才圖會, 植物名實圖考, 營造法式, 欽定新曆測驗紀略, 皇極經世書, 農政全書) | home; sort is `last_translated`, mechanism not traced |
| 0 of 126 sitemaps list a `/zh` URL; English book pages do not name their zh alternate (`hreflang` en,x-default), so the pair is not reciprocal | sitemap sweep, page head |
| The 中学西传 showcase cannot be read in Chinese: Flora Sinensis has 71 pages in `translations.zh`, nothing reads them until #7541 lands, and #7541 is CONFLICTING | #7537, `gh pr view 7541` |
| #7537 step 1 holds on the evidence available: no Google Fonts host among the requests; only GA hosts are Google, and async. Its "measure from the mainland" and WeChat preview steps have no recorded result | request log, #7537 |
| "Skip to main content" is English | page text |
| One 500 on the phone reader, 0 of 3 on retest | not reproduced |

## English reader
Works: `/search?q=Tao Te Ching` leads with collections and clean suggestions; side-by-side reader; AI label on the
English; cross-language concept search returns strong Daoist passages.

| Finding | Evidence |
|---|---|
| 77.6% of volumes have no English, and an English reader meets them unexplained | census; `/book/vol-17-23` |
| "Tao Te Ching" English is a translation of Julien's French, and neither page nor summary says so | `/book/dao-de-jing-laozi` p.20 |
| "Classical Chinese Texts: 86" presented as the shelf, while nearly all of the 12,878 "Chinese" are classical | `/search`, `/languages` |
| `/languages` card shows raw strings as a range: "0701-0800 - 清嘉慶4 Qing Jiaqing 4 (1799)" | by eye |
| Date wrong on Siku copies: 本草綱目 "1596" over a leaf headed 欽定四庫全書; 11,479 of the Siku volumes have no year ("Unknown") although the copy is datable | scan, census |
| Slugs like `/book/vol-3-32` on 88.7% of volumes | census |
| A collection links to a book hidden for rights: `tiangong-kaiwu-exploitation-of-the-works-of-nature` is a 404 | `/collections/chinese-natural-knowledge` |

## MCP user
Works: `search_concept`, `search_translations` (a copied unquoted Han phrase found its page, n=1), `concept_vocabulary`,
continuity hints, shortlinks, three-layer quotes, a recovery message on `no_translation`.

| Finding | Evidence |
|---|---|
| **`check_duplicate` fails its positive controls.** 本草綱目 + 李時珍 (135 volumes held): "Likely safe to import", matches 普濟方. 史記 + 司馬遷: "new". It also reports "No author" when an author was passed. The tool's own description makes it the answer to "do you hold X?" | `normalizeAuthor`/`normalizeTitle` strip Han (`[^\w\s]`, ASCII `\w`), `normalization` returns empty strings; `src/lib/holdings-check.ts`, "No author" branch |
| `list_books search=道德經` returns 1,424 books, a 藥師經 fourth: it matches single characters | call log; same shape as #6877 |
| `language="Classical Chinese"` reports "at least 6" (real: 86): the count timed out | call log |
| `text_role` unclassified and no `translation_note` on Julien's French; Mongo holds `text_role: original` and `languages: ["Chinese"]` | `get_book`, census |
| Citations: BibTeX key `@book{1596,` (Han author stripped, so keys collide); `year = {n.d.}` and a raw catalogue string as title on 性命圭旨 | `get_quote` |
| Markup inside text the tool says to copy verbatim: `<term>`, `<gloss>`, `<note>`, `<column-break/>` | `get_quote` |
| `get_book` on one volume is about 10K tokens by eye of the response (some 70 chapters, 20 themes, 15 quotes) | call log |
| `/connect` says "15,000 rare books" against 70,799 on `/languages`, English only | by eye |
| The default client (Claude) is not offered in mainland China, so the MCP audience there is unclear | not measured |

## Not established
Mainland access and speed; how many pages share the 性命圭旨 text exchange; whether "newest translated" is driven by
repair writes; how often readers hit any of this.
