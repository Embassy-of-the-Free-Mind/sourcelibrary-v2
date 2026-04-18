#!/usr/bin/env node
/**
 * Batch import for GitHub issue #1041: Collection expansion
 * Chinese Theater, Renaissance European Theater, Asian Fable Traditions, Chinese Technology
 */

const API_BASE = 'https://sourcelibrary.org/api/import/ia';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const books = [
  // === CHINESE THEATER: Yuan Zaju ===
  { ia_identifier: '02111087.cn', title: '元曲選 (Selected Yuan Plays), Vol. 1', author: 'Zang Maoxun (臧懋循)', year: 1616, original_language: 'Chinese' },
  { ia_identifier: '02111088.cn', title: '元曲選 (Selected Yuan Plays), Vol. 2', author: 'Zang Maoxun (臧懋循)', year: 1616, original_language: 'Chinese' },
  { ia_identifier: '02111089.cn', title: '元曲選 (Selected Yuan Plays), Vol. 3', author: 'Zang Maoxun (臧懋循)', year: 1616, original_language: 'Chinese' },
  { ia_identifier: '02111090.cn', title: '元曲選 (Selected Yuan Plays), Vol. 4', author: 'Zang Maoxun (臧懋循)', year: 1616, original_language: 'Chinese' },
  { ia_identifier: '02111091.cn', title: '元曲選 (Selected Yuan Plays), Vol. 5', author: 'Zang Maoxun (臧懋循)', year: 1616, original_language: 'Chinese' },

  // === CHINESE THEATER: Ming Chuanqi ===
  { ia_identifier: 'pipa-ji', title: '琵琶記 (The Lute, 1597 Wanli illustrated ed.)', author: 'Gao Ming (高明)', year: 1597, original_language: 'Chinese' },
  { ia_identifier: '02111381.cn', title: '牡丹亭 (The Peony Pavilion)', author: 'Tang Xianzu (湯顯祖)', year: 1598, original_language: 'Chinese' },
  { ia_identifier: '02111355.cn', title: '六十種曲 (Sixty Plays), Vol. 1', author: 'Mao Jin (毛晉)', year: 1633, original_language: 'Chinese' },
  { ia_identifier: 'sheng-ming-za-ju2', title: '盛明雜劇 (Ming Zaju Anthology)', author: 'Shen Tai (沈泰)', year: 1629, original_language: 'Chinese' },

  // === RENAISSANCE EUROPEAN THEATER ===
  { ia_identifier: 'operahrosviteill00hrot', title: 'Opera Hrosvitae (Hrotsvitha of Gandersheim, 1501, Dürer woodcuts)', author: 'Hrotsvitha of Gandersheim', year: 1501, original_language: 'Latin' },
  { ia_identifier: 'everymanamoralp03evergoog', title: 'Everyman: A Moral Play', author: 'Unknown', year: 1485, original_language: 'English' },
  { ia_identifier: 'ita-bnc-in2-00002210-001', title: 'Orfeo (editio princeps, 1494)', author: 'Angelo Poliziano', year: 1494, original_language: 'Italian' },
  { ia_identifier: 'amintafavolabos01tassgoog', title: 'Aminta: Favola Boschereccia', author: 'Torquato Tasso', year: 1573, original_language: 'Italian' },
  { ia_identifier: 'ARes71610', title: 'Il Pastor Fido (1592)', author: 'Giovanni Battista Guarini', year: 1592, original_language: 'Italian' },
  { ia_identifier: 'ilteatrodellefau00scal', title: 'Il Teatro delle Favole Rappresentative (Commedia dell\'Arte scenarios)', author: 'Flaminio Scala', year: 1611, original_language: 'Italian' },
  { ia_identifier: 'bub_gb_xWsKZT3LoX4C', title: 'Poetica d\'Aristotele Vulgarizzata et Sposta (Castelvetro on Poetics)', author: 'Lodovico Castelvetro', year: 1570, original_language: 'Italian' },
  { ia_identifier: 'artenuevodehacer00vega', title: 'Arte Nuevo de Hacer Comedias (New Art of Writing Plays)', author: 'Lope de Vega', year: 1609, original_language: 'Spanish' },
  { ia_identifier: 'workesofbenjamin01jons', title: 'The Workes of Benjamin Jonson (1616 Folio)', author: 'Ben Jonson', year: 1616, original_language: 'English' },
  { ia_identifier: 'thomaskydsspani00schigoog', title: 'The Spanish Tragedy', author: 'Thomas Kyd', year: 1587, original_language: 'English' },
  { ia_identifier: 'bim_early-english-books-1475-1640_the-defence-of-poesie_sidney-sir-philip_1595', title: 'The Defence of Poesie', author: 'Sir Philip Sidney', year: 1595, original_language: 'English' },

  // === ASIAN FABLE TRADITIONS ===
  { ia_identifier: 'panchatantraaco02hertgoog', title: 'Panchatantra (Hertel critical Sanskrit edition)', author: 'Johannes Hertel (ed.)', year: 1915, original_language: 'Sanskrit' },
  { ia_identifier: 'PanchatantramWithSanskritCommentaryByGpShastri', title: 'Panchatantra with Sanskrit Commentary', author: 'G.P. Shastri (ed.)', year: 1925, original_language: 'Sanskrit' },
  { ia_identifier: 'in.ernet.dli.2015.292631', title: 'The Jataka (Pali text, Fausboll ed.), Vol. 1', author: 'V. Fausboll (ed.)', year: 1877, original_language: 'Pali' },
  { ia_identifier: 'kathasaritsagar00brocgoog', title: 'Kathasaritsagara (Ocean of Story, Sanskrit-German)', author: 'Somadeva; Hermann Brockhaus (ed.)', year: 1862, original_language: 'Sanskrit' },
  { ia_identifier: 'oceanofstorybein01somauoft', title: 'The Ocean of Story (Penzer/Tawney translation), Vol. 1', author: 'Somadeva; C.H. Tawney; N.M. Penzer', year: 1924, original_language: 'Sanskrit' },
  { ia_identifier: 'firstfourthbooks01mull', title: 'Hitopadesha (Max Müller interlinear Sanskrit)', author: 'Max Müller (ed.)', year: 1864, original_language: 'Sanskrit' },

  // === CHINESE TECHNOLOGY ===
  { ia_identifier: 'florasinensisfru00boym', title: 'Flora Sinensis (Jesuit bilingual botanical)', author: 'Michael Boym', year: 1656, original_language: 'Chinese-Latin' },
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
  console.log(`=== Issue #1041: Collection Expansion Import ===`);
  console.log(`Chinese Theater + Renaissance Theater + Asian Fables + Chinese Technology`);
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
