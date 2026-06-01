#!/usr/bin/env node
/**
 * Round 2 — Daoist gaps found by enumerating IA `universallibrary` Daoist/alchemy
 * holdings and deduping against ours (2026-06-01). Two kinds:
 *  (a) complete multi-volume works we'd only partially imported, and
 *  (b) 真誥 Zhen'gao — a canonical Shangqing scripture, not previously held.
 * Subject-filtered: the keyword enumeration also returned many false positives
 * (Confucian/official/math/literary texts) which are deliberately excluded.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/import/daoist-alchemy-ia-batch-2.mjs --commit
 */
const COMMIT = process.argv.includes('--commit');
const CRON_SECRET = process.env.CRON_SECRET;
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }
const BASE = 'https://sourcelibrary.org/api/import/ia';

const BOOKS = [
  // 真誥 Zhen'gao — Tao Hongjing's redaction of the Shangqing revelations (juan 1–20)
  { id: '06050869.cn', title: '真誥 (卷一~卷四) — Zhen\'gao (Declarations of the Perfected), vol.1', author: '陶弘景 Tao Hongjing (456–536)', year: 499, lang: 'Chinese' },
  { id: '06050870.cn', title: '真誥 (卷五~卷八) — Zhen\'gao, vol.2', author: '陶弘景 Tao Hongjing (456–536)', year: 499, lang: 'Chinese' },
  { id: '06050871.cn', title: '真誥 (卷九~卷十二) — Zhen\'gao, vol.3', author: '陶弘景 Tao Hongjing (456–536)', year: 499, lang: 'Chinese' },
  { id: '06050872.cn', title: '真誥 (卷十三~卷十六) — Zhen\'gao, vol.4', author: '陶弘景 Tao Hongjing (456–536)', year: 499, lang: 'Chinese' },
  { id: '06050873.cn', title: '真誥 (卷十七~卷二十) — Zhen\'gao, vol.5', author: '陶弘景 Tao Hongjing (456–536)', year: 499, lang: 'Chinese' },
  // 周易參同契發揮 (Yu Yan) — completes vol.1 (06048996) we already hold
  { id: '06048997.cn', title: '周易參同契發揮 (卷中) — Cantong qi, Elucidation (Yu Yan), vol.2', author: '魏伯陽 Wei Boyang; comm. 俞琰 Yu Yan', year: 1284, lang: 'Chinese' },
  { id: '06048998.cn', title: '周易參同契發揮 (卷下) — Cantong qi, Elucidation (Yu Yan), vol.3', author: '魏伯陽 Wei Boyang; comm. 俞琰 Yu Yan', year: 1284, lang: 'Chinese' },
  // 泰定養生主論 — completes vol.1 (02093830)
  { id: '02093831.cn', title: '泰定養生主論 (二) — Treatise on Nurturing Life, vol.2', author: '王珪 Wang Gui (Yuan)', year: 1338, lang: 'Chinese' },
  { id: '02093832.cn', title: '泰定養生主論 (三) — Treatise on Nurturing Life, vol.3', author: '王珪 Wang Gui (Yuan)', year: 1338, lang: 'Chinese' },
  { id: '02093833.cn', title: '泰定養生主論 (四) — Treatise on Nurturing Life, vol.4', author: '王珪 Wang Gui (Yuan)', year: 1338, lang: 'Chinese' },
  { id: '02093834.cn', title: '泰定養生主論 (五) — Treatise on Nurturing Life, vol.5', author: '王珪 Wang Gui (Yuan)', year: 1338, lang: 'Chinese' },
  // 養生類纂 — completes vol.1 (02093825)
  { id: '02093826.cn', title: '養生類纂 (二) — Classified Compendium on Nurturing Life, vol.2', author: '周守忠 Zhou Shouzhong', year: 1220, lang: 'Chinese' },
  { id: '02093827.cn', title: '養生類纂 (三) — Classified Compendium on Nurturing Life, vol.3', author: '周守忠 Zhou Shouzhong', year: 1220, lang: 'Chinese' },
  { id: '02093828.cn', title: '養生類纂 (四) — Classified Compendium on Nurturing Life, vol.4', author: '周守忠 Zhou Shouzhong', year: 1220, lang: 'Chinese' },
];

async function importOne(b, attempt = 1) {
  try {
    const res = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ ia_identifier: b.id, title: b.title, author: b.author, year: b.year, original_language: b.lang }), signal: AbortSignal.timeout(150000) });
    const data = await res.json();
    if (res.ok && data.success) return { id: b.id, ok: true, pages: data.pagesCreated, bookId: data.bookId };
    if (attempt < 3 && /timed out|MongoNetwork|ECONN/i.test(JSON.stringify(data))) { await new Promise(r => setTimeout(r, 4000)); return importOne(b, attempt + 1); }
    return { id: b.id, ok: false, err: data.error || data.details || JSON.stringify(data).slice(0, 120) };
  } catch (e) { if (attempt < 3) { await new Promise(r => setTimeout(r, 4000)); return importOne(b, attempt + 1); } return { id: b.id, ok: false, err: e.message }; }
}

async function main() {
  console.log(`${COMMIT ? 'IMPORT' : 'DRY-RUN'} — ${BOOKS.length} round-2 Daoist editions\n`);
  if (!COMMIT) { BOOKS.forEach(b => console.log(`  · ${b.id.padEnd(14)} ${b.title.slice(0, 60)}`)); return; }
  const results = [];
  for (const b of BOOKS) { const r = await importOne(b); results.push(r);
    console.log(`  ${r.ok ? '✓' : '✗'} ${b.id.padEnd(14)} ${r.ok ? `${r.pages}p → ${r.bookId}` : 'ERR ' + r.err}`); await new Promise(r => setTimeout(r, 2500)); }
  const ok = results.filter(r => r.ok);
  console.log(`\nDone: ${ok.length}/${results.length} imported, ${ok.reduce((s, r) => s + (r.pages || 0), 0)} pages.`);
  const failed = results.filter(r => !r.ok); if (failed.length) console.log('FAILED:', failed.map(r => r.id).join(', '));
}
main().catch(e => { console.error(e); process.exit(1); });
