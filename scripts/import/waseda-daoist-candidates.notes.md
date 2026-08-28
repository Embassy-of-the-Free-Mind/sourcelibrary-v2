# Waseda Kotenseki — Daoist/medical/divination candidate enumeration notes

Date: 2026-08-28. Companion to `waseda-daoist-candidates.json`. Enumeration only — nothing imported.

## Headline surprise: `chi*` does NOT mean "Chinese"

Our reference doc (`.claude/docs/chinese-iiif-sources.md`) says "Chinese works live under `chi*` shelfmarks."
**That is wrong.** Waseda's kotenseki shelfmarks are ordered by the *iroha* syllabary, and `chi` = チ = **芸術 (Arts)**:
chi01 総記, chi02 芸術史, chi03 書画, chi04 絵画, chi05 浮世絵・錦絵, chi06 書 (calligraphy, 2,829 recs),
chi07 彫塑, chi08 建築, chi09 美術工芸, chi10 金石・拓本, chi11 音楽, chi12 能楽, chi13 演劇.
The doc's example `chi06_04710` is a Kang Youwei calligraphy scroll — Chinese *content*, filed under *calligraphy*.
Chinese classics are instead spread across the subject classes below (and the bunko/special collections).

## How enumeration was done

1. **Category browse** (complete id lists, no titles):
   `https://www.wul.waseda.ac.jp/kotenseki/html/` → 238 prefix dirs → `html/{prefix}/index.html` lists every record id.
   Record page: `html/{prefix}/{id}/index.html`; each ends with a machine-readable `<!---------DCSET ... ---------->`
   comment block (A000 id, A100 title, A150 author, A180 imprint, A200 keywords/classification, A210 call no).
2. **Full category → subject map**: fetched all 238 category indexes + 1 sample record each, reading the A200
   subject keyword. Saved at scratchpad `waseda-category-map.json` (session-temp). Key rows below.
3. **Keyword search harvest**: `search.php?cndbn={term}&szlmt=500` (GET works; `szlmt` up to 500/page).
   The search matches titles, notes AND the keyword/classification field (e.g. `cndbn=道家類` hits records
   classified 子部 道家類). ~60 subject terms (道教, 道家, 老子, 参同契, 悟真, 内丹, 黄庭, 神仙, 本草, 傷寒,
   素問, 鍼灸, 周易, 易経, 卜筮, 風水, 宝巻 …). Search result rows carry title/author/imprint/keywords, so no
   per-record fetch was needed for search hits.
4. **IIIF verification**: for each candidate, GET
   `https://iiif.archive.waseda.jp/iiif/manifest/ktnsk/{id}/manifest.json` (IIIF Presentation v2), count
   `sequences[0].canvases`. 404 → flagged `usable:false` (legacy-viewer-only).

## Category → prefix map (subject classes relevant to the mission)

| prefix | subject | records |
|---|---|---|
| ro11 | 哲学－中国哲学総記 | 56 |
| ro12 | 哲学－経学 (classics studies; Yijing commentaries live here) | 1,229 |
| ro13 | 哲学－諸子 (the masters: Laozi, Zhuangzi, Daoists, Mohists…) | 677 |
| ro09 | 哲学－倫理学 (incl. 善書 morality books) | 398 |
| ha06 | 宗教－道教 (Daoism proper — tiny!) | 7 |
| ha04/ha05 | 宗教－仏教 | 160/99 |
| ni05 | 理学－天文学 付・暦学 | 440 |
| ni02 | 理学－数学 (和算) | 206 |
| ru05 | 地理－地理(中国) | 242 |
| ri08 | 歴史－中国史 | 76 |
| he16–he21 | 文学－中国文学 (総記/漢詩/詞曲/漢文/中国小説) | ~740 |
| ho04/ho05 | 語学－漢語 / 近代中国語 | 241/33 |
| nu08/nu09 | 伝記－中国人 | 19/9 |
| **bunko19** | **風陵文庫** — Sawada Mizuho's Chinese popular-religion collection; classified in full 四部 style, incl. 子部 第14 道家類 (道經, 戒律, 威儀, 讚頌表奏, 道教系民間宗教 經/寶卷…) | 1,685 |
| i12 | 下村文庫 — 中国史・中国思想, Ming editions, 漢籍 | 164 |
| i17 | 服部文庫 — 儒学・漢詩 漢籍 | 722 |
| i04 | 総類－叢書 (congshu sets, incl. 経訓堂叢書 etc.) | 2,611 |

Medicine: **ya09 = 医学－古方 (classical/traditional medicine), 700 records** — the big medical class
(mixed Chinese classics and Japanese kanpō/Edo works); plus ya01–ya10 minor medical classes (~83 records).
Chinese medical classics also surface via title searches (本草, 傷寒, 素問…) in i04 congshu and bunko collections.

## IIIF hit rate — the bad news

- The legacy DB has an explicit IIIF facet: `search.php?cndbn=&szlmt=500&cndiiif=1` returns **90 records
  total for the entire database** (mostly chi13 theater programs, bunko30, a few others).
  Positive control: the known-good `chi06_04710` shows up under the facet; 老子 (91 hits) ∩ IIIF = 0; 道教 (60 hits) ∩ IIIF = 0.
- Waseda's newer Cultural Resources platform (`archive.waseda.jp/archive/`, Backbone SPA over a JSON API at
  `archive/wake_api/*.php` — e.g. `commonSearch.php?arg={"search_key":"道教","pagination":{...}}&lang=jp`)
  indexes kotenseki as subDB_id 19 and finds more hits (道教 → 199 across museums+library), but its
  `getImageViewer.php` for kotenseki records returns legacy `image.php` URLs, **not IIIF manifests**, for the
  records we probed.
- Direct manifest probes (`ktnsk/{id}`) for every capped candidate: see JSON `manifest_http_status`; final
  counts in the summary below.
- **Definitive inventory found**: `https://iiif.archive.waseda.jp/iiif/manifest/ktnsk/` is an open Apache
  directory index of every kotenseki manifest on the IIIF host — **443 total** (breakdown by prefix:
  128 bunko3x, 66 chi13 theater, 56 he02, 52 he13 Edo fiction, 17 ru04, 12 wa03, 12 he12, 8 ks_003
  sutra items, 7 chi03, minor others). So IIIF coverage is a curated highlights set, not a rolling
  digitization frontier. **Intersection with our 2,216-record subject pool: 2 records** —
  `bunko19_f0399_0002` 嘆世無為巻 (Luo Qing's baojuan, 2 canvases — sample-only, not a full scan) and
  `ru11_00874` (an Inō Tadataka map that matched the 天文 term, off-mission). Plus, on the host but not
  in the pool: `ro12_01134` 礼記子本疏義 (Tang MS Liji subcommentary, 5 canvases) and two 大般若経
  fragments (`i04_03164_0131/0132`) — appended to the JSON as bonus usable records.
- Legacy records still expose full-resolution page JPEGs under
  `https://archive.wul.waseda.ac.jp/kosho/{prefix}/{id}/…` (linked from each record page) — the realistic
  bulk-import path for this corpus would be a directory-walker importer over those JPEG dirs, NOT IIIF.
  Not verified in this pass.

## Summary counts (final, 2026-08-28)

- Subject pool enumerated (union of ~64 keyword searches + ha06 category): **2,216 unique records**;
  1,921 classified into mission-relevant buckets (alchemy 38, daoism 275, popular-religion 195,
  medicine 328, divination 191, masters-philosophy 446, astronomy 441, classics 7).
- Capped verified list (per-category quotas so baojuan didn't crowd out the rest): **253 records**
  in the JSON — daoism 90, medicine 50, daoist-alchemy 38, divination 37, popular-religion 35,
  buddhist-classics 2, classics-studies 1.
- Manifest verification (GET each `ktnsk/{id}/manifest.json`): **4 usable (200 + canvases), 249
  legacy-viewer-only (404)** — a 1.6% IIIF hit rate, fully explained by the 443-manifest host inventory.
  The 4 usable: 嘆世無為巻 (bunko19_f0399_0002, 2 canvases — sample only), 礼記子本疏義 Tang MS
  (ro12_01134, 5), two 大般若経 fragments (i04_03164_0131/0132, 3+1). All four look like exhibition
  highlights with partial canvas sets, not full digitizations.

## Consequences for acquisition

1. **Waseda kotenseki is NOT a viable IIIF import source for Daoist/medical/divination material.**
   The reference doc's ease=5 rating rests on a false premise (chi* = Chinese) and a highlights-only
   IIIF host. Recommend downgrading it in `chinese-iiif-sources.md`.
2. The catalog itself is excellent and now enumerated: the 253-record JSON carries title/author/imprint/
   keywords/record_url for each, so if we ever build a **kosho JPEG directory-walker importer**
   (`archive.wul.waseda.ac.jp/kosho/{prefix}/{id}/…`, openly served), the same list becomes immediately
   actionable. Waseda's terms allow research/educational use with credit.
3. The 風陵文庫 (bunko19, 1,685 records — Daoist canon-class scriptures, sectarian baojuan, liturgy,
   precepts, collected by Sawada Mizuho) is a corpus we have not seen elsewhere in our source table;
   worth a dedicated look if the JPEG path is ever built.

## Caveats

- Classification is keyword-driven; expect ~10-20% category noise (e.g. Edo Japanese 養生 works under
  medicine, 黄庭堅 poetry anthologies under alchemy, おみくじ books under divination). Each row carries
  `keywords` + `matched_terms` for downstream filtering; rows are candidates for human review, not
  auto-import.
- Searches capped at 500 rows/page; 諸子 (680) and 天文 (573) were truncated — irrelevant to the capped
  list since those buckets were priority-filler only.
- `title` is the kanji line only; romaji and multi-work title statements are trimmed to `title_full`-style
  data in the scratch pool, not the JSON.

Scratch artifacts (session-temp, not committed): `waseda-category-map.json`, `waseda-pool.json`,
`waseda-terms-done.json`, `ktnsk-available.txt`, scripts `waseda-{map,map2,harvest,supplement,verify,finalize}.mjs`
in the session scratchpad.
