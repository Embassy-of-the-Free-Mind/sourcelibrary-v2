# Daoist Alchemy / Neidan — Acquisition List (want → dedupe → get)

Working list for disciplined acquisition: define the canonical corpus, mark what we
already HOLD, and acquire only the GAPS. Built 2026-06-01 against a keyword inventory
of current holdings. Source via the repos in `chinese-iiif-sources.md` (IA
`universallibrary` .cn has been the productive one).

## HAVE (deduped inventory)
- **周易參同契 Cantong qi** — 發揮 (Yu Yan, `06048996`, translated, visible) · 分章注 (Chen Zhixu, `06048999`/`06049000`) · 古文集解 (`06049001-03`) · Zhu Xi 考異 (NDL) · Zuihō 吹唱 (NDL). *Multiple recensions — legit, not dups.*
- **抱朴子 Baopuzi** — Inner Chapters ×2 (`06049004-07` Siku + `06076375`) ⚠ **DUPLICATE** · Outer Chapters (`06076379-82`) · Old MS (NDL).
- **雲笈七籤 Yunji qiqian** — juan **81–122 only** (`06050877-886`). ⚠ **juan 1–80 missing.**
- **神仙傳 Shenxian zhuan** (Ge Hong, `06050867-68`).
- **磻溪集 Panxi ji** (Qiu Chuji, `02099863-64`).
- **Daozang** — Zhengtong Daozang vol.5 · "The Taoist Canon" (`daozang_202302`) · Daozang jinghua · 道藏目錄詳註 catalogues (`06050892-94`).
- **黃庭經 Huangting jing** — only embedded inside Daozang vol.5 (no standalone).
- **陰符經 Yinfu jing** (NDL annotated) · 養生 compendia (`02093825/29`, `02093830`).

## WANT → GAP (deduped; not held)
Priority: ★★★ canonical / high-demand · ★★ important · ★ desirable.

### Neidan (internal alchemy) — the core gap
- ★★★ **悟真篇 Wuzhen pian** (Zhang Boduan) — *Chinese original still unsourced as a clean scan* (only English translations open). Needs Harvard CURIOSity / NLC browser route.
- ★★★ **周易參同契 正文** — the bare base text (we have only commentaried recensions).
- ★★★ **鍾呂傳道集 Zhong-Lü chuandao ji** — foundational Zhong-Lü neidan dialogue.
- ★★ **入藥鏡 Ruyao jing** (Cui Xifan) · **金丹四百字 Jindan sibai zi** (Zhang Boduan).
- ★★ **靈寶畢法 Lingbao bifa** · **中和集 Zhonghe ji** (Li Daochun) · **大丹直指 Dadan zhizhi** (Qiu Chuji).
- ★★ **修真十書 Xiuzhen shishu** — major neidan anthology (contains Wuzhen pian, Cuixu pian, etc.).
- ★ **金丹大成集 Jindan dacheng ji** (Xiao Tingzhi) · **諸家神品丹法** · **翠虛篇 Cuixu pian** (Chen Nan) · **規中指南**.

### Daoist scriptures / canon
- ★★★ **黃庭經 Huangting jing** — standalone (we only have it inside Daozang vol.5).
- ★★ **雲笈七籤 juan 1–80** — complete the encyclopedia we half-hold.
- ★★ **太平經 Taiping jing** · **度人經 Duren jing** (Lingbao) · **清靜經 Qingjing jing**.
- ★ **真誥 Zhen'gao** (Shangqing) · **上清大洞真經** · **黃帝陰符經 正文** (bare base).

### Waidan (operative alchemy) & hagiography
- ★★ **黃帝九鼎神丹經訣** · **太清金液神丹經** (waidan classics).
- ★ **列仙傳 Liexian zhuan** · **歷世真仙體道通鑑**.

### Quanzhen
- ★ **重陽全真集** (Wang Chongyang) · **甘水仙源錄**.

## Acquired via enumerate→dedupe→source (2026-06-01)
- **Round 1** (`daoist-alchemy-ia-batch.mjs`, 26 books): Cantong qi 分章注+集解, Baopuzi Outer, Yunji qiqian 81–122, Shenxian zhuan, Panxi ji, 養生 vol.1s.
- **Round 2** (`daoist-alchemy-ia-batch-2.mjs`, 14 books): **真誥 Zhen'gao** (Shangqing, 5 vols) + completed partial sets (周易參同契發揮 vols 2–3; 泰定養生主論 vols 2–5; 養生類纂 vols 2–4).
- Method: enumerate IA `universallibrary` Daoist/alchemy → exact-dedupe on `ia_identifier` → **subject-filter** (the keyword net catches Confucian/math/official/drama false positives — discard) → import hidden → tag.

## Still to source (gaps not in IA universallibrary, or behind JS viewers)
悟真篇 Wuzhen pian (Chinese original) · Cantong qi 正文 (bare) · 鍾呂傳道集 · 入藥鏡 · 金丹四百字 · 中和集 · 修真十書 · 黃庭經 standalone · 雲笈七籤 juan 1–80 · 太平經 (real one) · 度人經 · 清靜經 · 列仙傳 · 重陽全真集. → need Harvard CURIOSity / NLC (browser-capture) or other repos.

## Process
1. ✅ Want-list defined + deduped against holdings (this doc).
2. ⏳ **Source** each GAP (manifest/IA id) via `chinese-iiif-sources.md` — IA `universallibrary` .cn first, then browser-capture (Harvard/NLC) for what's only behind JS viewers.
3. Import the sourced gaps (hidden) → OCR/translation → **QA pass** (Classical Chinese) → flip visible.

## Open dedup decision
- **Baopuzi Inner Chapters ×2** (`06049004-07` Siku vs `06076375`) — pick one to keep, retire the other (needs confirmation; do NOT delete unilaterally).
