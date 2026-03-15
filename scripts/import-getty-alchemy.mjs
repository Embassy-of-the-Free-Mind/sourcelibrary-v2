#!/usr/bin/env node
/**
 * Import Getty Research Institute alchemy/esoterica from Internet Archive
 * Includes: 2 Hall collection overviews + ~20 major alchemical/hermetic rare books
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-getty-alchemy.mjs
 */

const API_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';
const API_KEY = process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!API_KEY) {
  console.error('Missing CRON_SECRET. Source .env.production.local first.');
  process.exit(1);
}

const BOOKS = [
  // Hall collection overviews
  { id: 'gri_33125008675973', title: 'Manly Palmer Hall collection of alchemical manuscripts, circa 1500-1825', author: 'Manly Palmer Hall Collection', categories: ['Alchemy', 'Hermetica'] },
  { id: 'gri_33125008676039', title: 'Manly Palmer Hall collection of alchemical manuscripts (second digitization)', author: 'Manly Palmer Hall Collection', categories: ['Alchemy', 'Hermetica'] },
  // Major Getty rare books — alchemy, Hermetica, Rosicrucianism
  { id: 'atalantafugiensh00maie', title: 'Atalanta Fugiens', display_title: 'Atalanta Fugiens (alchemical emblem book)', author: 'Michael Maier', language: 'Latin', published: '1618', categories: ['Alchemy', 'Hermetica'] },
  { id: 'utriusquecosmima01flud', title: 'Utriusque Cosmi Maioris scilicet et Minoris, Vol. 1', display_title: 'Utriusque Cosmi Historia, Vol. 1 (macrocosm & microcosm)', author: 'Robert Fludd', language: 'Latin', published: '1617', categories: ['Hermetica', 'Philosophy', 'Magic'] },
  { id: 'utriusquecosmima02flud', title: 'Utriusque Cosmi Maioris scilicet et Minoris, Vol. 2', display_title: 'Utriusque Cosmi Historia, Vol. 2 (macrocosm & microcosm)', author: 'Robert Fludd', language: 'Latin', published: '1617', categories: ['Hermetica', 'Philosophy', 'Magic'] },
  { id: 'dellelixirvitae00dona', title: "Dell'elixir vitae", display_title: "Dell'elixir vitae (On the Elixir of Life)", author: "Donato d'Eremita", language: 'Italian', published: '1624', categories: ['Alchemy'] },
  { id: 'aureumvellusoder01tris', title: 'Aureum Vellus, oder Prussianisch Prussianisch Prussianisch', display_title: 'Aureum Vellus (Splendor Solis — Golden Fleece)', author: 'Salomon Trismosin', language: 'German', published: '1598', categories: ['Alchemy', 'Hermetica'] },
  { id: 'quintaessentiada00thur', title: 'Quinta Essentia', display_title: 'Quinta Essentia (alchemical-medical treatise)', author: 'Leonhard Thurneisser', language: 'German', published: '1574', categories: ['Alchemy'] },
  { id: 'truefaithfulrela00deej', title: 'A True & Faithful Relation of What passed for many Yeers Between Dr. John Dee and Some Spirits', display_title: 'A True & Faithful Relation (Dee\'s angelic conversations)', author: 'John Dee; Meric Casaubon (editor)', language: 'English', published: '1659', categories: ['Magic', 'Hermetica'] },
  { id: 'musaeumhermeticu00meri', title: 'Musaeum Hermeticum', display_title: 'Musaeum Hermeticum (anthology of alchemical treatises)', author: 'Various', language: 'Latin', published: '1678', categories: ['Alchemy', 'Hermetica'] },
  { id: 'amphitheatrvmsap00khun', title: 'Amphitheatrum Sapientiae Aeternae', display_title: 'Amphitheatrum Sapientiae Aeternae (amphitheatre of eternal wisdom)', author: 'Heinrich Khunrath', language: 'Latin', published: '1609', categories: ['Alchemy', 'Hermetica', 'Magic'] },
  { id: 'theatrvmchemicvm00ashm', title: 'Theatrum Chemicum Britannicum', display_title: 'Theatrum Chemicum Britannicum (English alchemical poetry)', author: 'Elias Ashmole (editor)', language: 'English', published: '1652', categories: ['Alchemy'] },
  { id: 'monashieroglyphi00deej', title: 'Monas Hieroglyphica', display_title: 'Monas Hieroglyphica (hieroglyphic monad)', author: 'John Dee', language: 'Latin', published: '1591', categories: ['Hermetica', 'Magic'] },
  { id: 'chymischehochzei00rose', title: 'Chymische Hochzeit Christiani Rosencreutz', display_title: 'Chemical Wedding of Christian Rosenkreutz', author: 'Johann Valentin Andreae', language: 'German', published: '1616', categories: ['Alchemy', 'Hermetica'] },
  { id: 'famafraternitati00andr', title: 'Fama Fraternitatis', display_title: 'Fama Fraternitatis (founding Rosicrucian manifesto)', author: 'Johann Valentin Andreae (attributed)', language: 'German', published: '1615', categories: ['Hermetica'] },
  { id: 'geberisphilosoph00gebe', title: 'Summa Perfectionis Magisterii', display_title: 'Summa Perfectionis (summit of alchemical perfection)', author: 'Geber (Jabir ibn Hayyan)', language: 'Latin', published: '1542', categories: ['Alchemy'] },
  { id: 'johmichaelisfaus00faus', title: 'Compendium Alchymisticum Novum', display_title: 'Compendium Alchymisticum Novum (new alchemical compendium)', author: 'Johann Michael Faust', language: 'Latin', published: '1706', categories: ['Alchemy'] },
  { id: 'pretiosamargarit00laci', title: 'Pretiosa Margarita Novella', display_title: 'Pretiosa Margarita Novella (precious new pearl of alchemy)', author: 'Petrus Bonus; Janus Lacinius (editor)', language: 'Latin', published: '1546', categories: ['Alchemy'] },
  { id: 'lesdovzeclefsdep00basi', title: 'Les Douze Clefs de Philosophie', display_title: 'The Twelve Keys of Philosophy (alchemical keys)', author: 'Basilius Valentinus', language: 'French', published: '1660', categories: ['Alchemy'] },
  { id: 'herrngeorgiivonw00well', title: 'Opus Mago-Cabbalisticum et Theosophicum', display_title: 'Opus Mago-Cabbalisticum (magical-kabbalistic-theosophical work)', author: 'Georg von Welling', language: 'German', published: '1760', categories: ['Magic', 'Hermetica'] },
  { id: 'cabalaspiegelder00cust', title: 'Cabala, Spiegel der Kunst und Natur in Alchymia', display_title: 'Cabala, Mirror of Art and Nature in Alchemy', author: 'Stephan Michelspacher', language: 'German', published: '1663', categories: ['Alchemy', 'Hermetica'] },
  { id: 'dealchemiadialog00brac', title: 'De Alchemia Dialogi II', display_title: 'On Alchemy, Two Dialogues', author: 'Giovanni Braccesco', language: 'Latin', published: '1548', categories: ['Alchemy'] },
  { id: 'collectaneachemi00phil', title: 'Collectanea Chemica', display_title: 'Collectanea Chemica (collected chemical/alchemical writings)', author: 'Eirenaeus Philalethes et al.', language: 'English', published: '1893', categories: ['Alchemy'] },
];

async function importBook(book) {
  const payload = {
    ia_identifier: book.id,
    title: book.title,
    display_title: book.display_title || null,
    author: book.author,
    language: book.language || 'Multiple',
    published: book.published || 'Unknown',
    categories: book.categories,
  };

  const res = await fetch(`${API_BASE}/api/import/ia`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

async function main() {
  console.log(`\nGetty Alchemy/Esoterica Import${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`API: ${API_BASE}`);
  console.log(`Items: ${BOOKS.length}\n`);

  let imported = 0, failed = 0, skipped = 0;

  for (const book of BOOKS) {
    process.stdout.write(`[${book.id}] ${book.display_title || book.title}... `);

    if (DRY_RUN) {
      console.log('Would import');
      skipped++;
      continue;
    }

    try {
      const result = await importBook(book);
      if (result.success) {
        console.log(`Imported: ${result.pagesCreated} pages`);
        imported++;
      } else if (result.error?.includes('already exists')) {
        console.log(`Already exists (${result.existingId})`);
        skipped++;
      } else {
        console.log(`Error: ${result.error}`);
        failed++;
      }
    } catch (err) {
      console.log(`Error: ${err.message}`);
      failed++;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
