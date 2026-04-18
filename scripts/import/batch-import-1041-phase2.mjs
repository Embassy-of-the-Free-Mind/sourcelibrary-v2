#!/usr/bin/env node
/**
 * Issue #1041 Phase 2: Additional IA-ready books
 * Gallica (Corneille, Moliere, Racine) need IIIF import — handled separately
 * LOC items (Tiangong Kaiwu, Bencao Gangmu) need direct download — handled separately
 */

const API_BASE = 'https://sourcelibrary.org/api/import/ia';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const books = [
  // === CHINESE THEATER: Western Chamber variants ===
  { ia_identifier: '02111240.cn', title: '西廂記 (Romance of the Western Chamber, Ming annotated ed.)', author: 'Wang Shifu (王實甫); Wang Jide (王驥德, commentary)', year: 1614, original_language: 'Chinese' },
  { ia_identifier: '02110809.cn', title: '董解元西廂記 (Dong Jieyuan\'s Western Chamber, Jin dynasty precursor)', author: 'Dong Jieyuan (董解元)', year: 1190, original_language: 'Chinese' },

  // === CHINESE THEATER: Tang Xianzu & Kunqu ===
  { ia_identifier: 'm_042_yumingtang_v02_0001', title: '玉茗堂集 (Tang Xianzu Collected Works), Vol. 2', author: 'Tang Xianzu (湯顯祖)', year: 1617, original_language: 'Chinese' },
  { ia_identifier: 'kunqucuicunchuji16kuns', title: '崑曲粹存初集 (Kunqu Treasures)', author: 'Various', year: 1925, original_language: 'Chinese' },

  // === CHINESE TECHNOLOGY: IA-available ===
  { ia_identifier: '02092259.cn', title: '武備志 (Wubei Zhi, Military Technology Compendium)', author: 'Mao Yuanyi (茅元儀)', year: 1621, original_language: 'Chinese' },
  { ia_identifier: 'q_099_kaogong_v01_0001', title: '考工記圖 (Kaogong Ji, Illustrated Record of Crafts)', author: 'Dai Zhen (戴震, commentary)', year: 1746, original_language: 'Chinese' },
  { ia_identifier: '02098268.cn', title: '三才圖會 (Sancai Tuhui, Illustrated Encyclopedia of Three Realms)', author: 'Wang Qi (王圻)', year: 1609, original_language: 'Chinese' },
  { ia_identifier: '06061737.cn', title: '夢溪筆談 (Dream Pool Essays)', author: 'Shen Kuo (沈括)', year: 1088, original_language: 'Chinese' },

  // === ASIAN FABLES: Heidelberg illuminated MS (IIIF, but IA may have surrogates) ===
  // Buch der Beispiele — skipping, needs Heidelberg IIIF

  // === RENAISSANCE THEATER: More IA-available ===
  // Marlowe — search for IA identifier
  // Shakespeare First Folio — Bodleian IIIF, not IA

  // === FABLES: Directorium Humanae Vitae ===
  { ia_identifier: 'bpt6k209277j', title: 'Directorium Humanae Vitae (Latin Panchatantra, John of Capua)', author: 'John of Capua', year: 1480, original_language: 'Latin' },
];

async function importBook(book, index) {
  console.log(`\n[${index + 1}/${books.length}] Importing: ${book.title} (${book.year})`);
  console.log(`  IA: ${book.ia_identifier}`);

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify(book),
    });

    const data = await res.json();

    if (res.ok) {
      console.log(`  ✓ Imported: ${data.id || data._id || 'OK'}`);
      return { success: true, title: book.title, id: data.id || data._id };
    } else {
      console.log(`  ✗ Failed: ${data.error || data.message || JSON.stringify(data)}`);
      return { success: false, title: book.title, error: data.error || data.message };
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    return { success: false, title: book.title, error: err.message };
  }
}

async function main() {
  console.log(`=== Issue #1041 Phase 2: Additional IA Imports ===`);
  console.log(`Books to import: ${books.length}\n`);

  const results = [];

  for (let i = 0; i < books.length; i++) {
    const result = await importBook(books[i], i);
    results.push(result);
    if (i < books.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n=== SUMMARY ===`);
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  const dupes = results.filter(r => !r.success && r.error?.includes('already'));
  console.log(`Imported: ${successes.length}/${books.length}`);
  console.log(`Already existed: ${dupes.length}`);
  console.log(`Failed: ${failures.length - dupes.length}`);

  if (failures.filter(f => !f.error?.includes('already')).length > 0) {
    console.log(`\nReal failures:`);
    failures.filter(f => !f.error?.includes('already')).forEach(f => console.log(`  - ${f.title}: ${f.error}`));
  }

  if (successes.length > 0) {
    console.log(`\nNew imports:`);
    successes.forEach(s => console.log(`  - ${s.title} → ${s.id}`));
  }
}

main().catch(console.error);
