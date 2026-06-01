#!/usr/bin/env node
/**
 * Batch import of Daoist / alchemical Chinese rare-book editions from the
 * Internet Archive `universallibrary` collection (National Library of China /
 * Million Books Project scans of Qing-dynasty woodblock editions). All are
 * public-domain by age, public on IA since 2009, with clean IIIF v3 manifests.
 *
 * Sourced 2026-06-01 (audit + research agent). The "clean IIIF" repositories
 * (Waseda IIIF host, NDL public IIIF API, Digital Bodleian, Kyoto RMDA) turned
 * out NOT to expose manifests for these specific Daoist texts — Waseda Daoist
 * records sit on the legacy kosho image server, NDL rare books are
 * in-library-only, Bodleian Sinica Daoist titles are catalogued-not-digitized.
 * IA universallibrary was the productive source. See
 * .claude/docs/chinese-iiif-sources.md.
 *
 * EXCLUDED (already held): 周易參同契發揮 (Yu Yan, 06048996-98.cn) — we have it;
 * Baopuzi Inner Chapters; Cantong qi commentaries by Zhu Xi / Zuihō.
 * NOTE: multi-volume works import as one book per IA volume (IA scans are
 * per-fascicle). Grouping into a single work is a follow-up (work_id).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/daoist-alchemy-ia-batch.mjs --dry-run
 *   node scripts/import/daoist-alchemy-ia-batch.mjs --commit
 */

const COMMIT = process.argv.includes('--commit');
const CRON_SECRET = process.env.CRON_SECRET;
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }
const BASE = 'https://sourcelibrary.org/api/import/ia';

// Curated batch. 06048999.cn (分章注 vol.1) already imported separately.
const BOOKS = [
  // --- 周易參同契 Cantong qi: base text (分章注, Chen Zhixu) — completes the base ---
  { id: '06049000.cn', title: '周易參同契分章注 (卷中~卷下) — Cantong qi, Chapter-Divided Commentary, vols. 2–3', author: '魏伯陽 Wei Boyang; comm. 陳致虛 Chen Zhixu', year: 1300, lang: 'Chinese' },
  // --- 古文參同契集解 (guwen recension) ---
  { id: '06049001.cn', title: '古文參同契集解 (卷上) — Ancient-Text Cantong qi, Collected Explanations, vol.1', author: '魏伯陽 Wei Boyang (attrib.); comm. 蔣一彪 Jiang Yibiao', year: 1546, lang: 'Chinese' },
  { id: '06049002.cn', title: '古文參同契集解 (卷中) — Ancient-Text Cantong qi, Collected Explanations, vol.2', author: '魏伯陽 Wei Boyang (attrib.); comm. 蔣一彪 Jiang Yibiao', year: 1546, lang: 'Chinese' },
  { id: '06049003.cn', title: '古文參同契集解 (卷下) — Ancient-Text Cantong qi, Collected Explanations, vol.3', author: '魏伯陽 Wei Boyang (attrib.); comm. 蔣一彪 Jiang Yibiao', year: 1546, lang: 'Chinese' },
  // --- 抱朴子外篇 Baopuzi Outer Chapters (never fully translated — first-translation opportunity) ---
  { id: '06076379.cn', title: '抱朴子外篇 (卷一) — Baopuzi, Outer Chapters, vol.1', author: '葛洪 Ge Hong (284–363)', year: 320, lang: 'Chinese' },
  { id: '06076380.cn', title: '抱朴子外篇 (卷二) — Baopuzi, Outer Chapters, vol.2', author: '葛洪 Ge Hong (284–363)', year: 320, lang: 'Chinese' },
  { id: '06076381.cn', title: '抱朴子外篇 (卷三) — Baopuzi, Outer Chapters, vol.3', author: '葛洪 Ge Hong (284–363)', year: 320, lang: 'Chinese' },
  { id: '06076382.cn', title: '抱朴子外篇 (卷四) — Baopuzi, Outer Chapters, vol.4', author: '葛洪 Ge Hong (284–363)', year: 320, lang: 'Chinese' },
  // --- 神仙傳 Shenxian zhuan (Biographies of Divine Immortals) ---
  { id: '06050867.cn', title: '神仙傳 (卷一~卷五) — Biographies of Divine Immortals, vol.1', author: '葛洪 Ge Hong (284–363)', year: 320, lang: 'Chinese' },
  { id: '06050868.cn', title: '神仙傳 (卷六~卷十) — Biographies of Divine Immortals, vol.2', author: '葛洪 Ge Hong (284–363)', year: 320, lang: 'Chinese' },
  // --- 雲笈七籤 Yunji qiqian (Daoist encyclopedia; juan 81–122, upper half) ---
  { id: '06050877.cn', title: '雲笈七籤 (卷81–86) — Yunji qiqian (Seven Tablets in a Cloudy Satchel)', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050878.cn', title: '雲笈七籤 (卷87–94) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050879.cn', title: '雲笈七籤 (卷95–99) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050880.cn', title: '雲笈七籤 (卷100–103) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050881.cn', title: '雲笈七籤 (卷104–107) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050882.cn', title: '雲笈七籤 (卷108–111) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050883.cn', title: '雲笈七籤 (卷112) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050884.cn', title: '雲笈七籤 (卷113–116) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050885.cn', title: '雲笈七籤 (卷117–120) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  { id: '06050886.cn', title: '雲笈七籤 (卷121–122) — Yunji qiqian', author: '張君房 Zhang Junfang (Song)', year: 1029, lang: 'Chinese' },
  // --- 磻溪集 Panxi ji (Quanzhen neidan poetry, Qiu Chuji) ---
  { id: '02099863.cn', title: '棲霞長春子丘神仙磻溪集 (1) — Panxi Anthology of the Immortal Qiu Changchun, vol.1', author: '丘處機 Qiu Chuji (1148–1227)', year: 1200, lang: 'Chinese' },
  { id: '02099864.cn', title: '棲霞長春子丘神仙磻溪集 (2) — Panxi Anthology of the Immortal Qiu Changchun, vol.2', author: '丘處機 Qiu Chuji (1148–1227)', year: 1200, lang: 'Chinese' },
  // --- 養生 longevity / alchemical-medicine compendia ---
  { id: '02093830.cn', title: '泰定養生主論 — Treatise on Nurturing Life', author: '王珪 Wang Gui (Yuan)', year: 1338, lang: 'Chinese' },
  { id: '02093825.cn', title: '養生類纂 — Classified Compendium on Nurturing Life', author: '周守忠 Zhou Shouzhong', year: 1220, lang: 'Chinese' },
  { id: '02093829.cn', title: '養生月覽 — Monthly Almanac for Nurturing Life', author: '周守忠 Zhou Shouzhong', year: 1220, lang: 'Chinese' },
];

async function importOne(b, attempt = 1) {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ ia_identifier: b.id, title: b.title, author: b.author, year: b.year, original_language: b.lang }),
      signal: AbortSignal.timeout(150000),
    });
    const data = await res.json();
    if (res.ok && data.success) return { id: b.id, ok: true, pages: data.pagesCreated, bookId: data.bookId };
    // transient Mongo timeout → one retry
    if (attempt < 3 && /timed out|MongoNetwork|ECONN/i.test(JSON.stringify(data))) {
      await new Promise(r => setTimeout(r, 4000));
      return importOne(b, attempt + 1);
    }
    return { id: b.id, ok: false, err: data.error || data.details || JSON.stringify(data).slice(0, 120) };
  } catch (e) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 4000)); return importOne(b, attempt + 1); }
    return { id: b.id, ok: false, err: e.message };
  }
}

async function main() {
  console.log(`${COMMIT ? 'IMPORT' : 'DRY-RUN'} — ${BOOKS.length} Daoist/alchemy IA editions\n`);
  if (!COMMIT) { BOOKS.forEach(b => console.log(`  · ${b.id.padEnd(14)} ${b.title.slice(0, 60)}`)); return; }
  const results = [];
  for (const b of BOOKS) {
    const r = await importOne(b);
    results.push(r);
    console.log(`  ${r.ok ? '✓' : '✗'} ${b.id.padEnd(14)} ${r.ok ? `${r.pages}p → ${r.bookId}` : 'ERR ' + r.err}`);
    await new Promise(r => setTimeout(r, 2500));
  }
  const ok = results.filter(r => r.ok);
  console.log(`\nDone: ${ok.length}/${results.length} imported, ${ok.reduce((s, r) => s + (r.pages || 0), 0)} pages.`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.log('FAILED:', failed.map(r => r.id).join(', '));
}
main().catch(e => { console.error(e); process.exit(1); });
