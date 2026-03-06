import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Extract CRON_SECRET properly (handles quotes)
const env = readFileSync('.env.production.local', 'utf8');
const cronSecret = env.match(/CRON_SECRET="?([^"\n]+)"?/)?.[1]?.trim();
if (!cronSecret) { console.error('No CRON_SECRET found'); process.exit(1); }

const BASE = 'https://sourcelibrary.org/api/import/ia';

const imports = [
  { ia_identifier: 'chaldanoracles00juligoog', title: 'The Chaldaean Oracles', author: 'G.R.S. Mead', year: 1908, original_language: 'Greek' },
  { ia_identifier: 'hin-wel-all-00002642-001', title: 'Magia Philosophica: Oracula Chaldaica', author: 'Francesco Patrizi', year: 1593, original_language: 'Latin' },
  { ia_identifier: 'platonostimaiost00platuoft', title: 'Platōnos Timaios', author: 'Plato', year: 1888, original_language: 'Greek' },
  { ia_identifier: 'collectiondesanc01bert', title: 'Collection des Anciens Alchimistes Grecs, vol. 1', author: 'Marcellin Berthelot', year: 1887, original_language: 'Greek' },
  { ia_identifier: 'collectiondesanc23bert', title: 'Collection des Anciens Alchimistes Grecs, vol. 2', author: 'Marcellin Berthelot', year: 1887, original_language: 'Greek' },
  { ia_identifier: 'collectiondesan04bertgoog', title: 'Collection des Anciens Alchimistes Grecs, vol. 3', author: 'Marcellin Berthelot', year: 1888, original_language: 'Greek' },
  { ia_identifier: 'macrobiusfrancis00macruoft', title: 'Macrobii Commentarii in Somnium Scipionis', author: 'Macrobius', year: 1893, original_language: 'Latin' },
  { ia_identifier: 'bub_gb__06gJAfC39cC', title: 'Apologiae duae et Dialogus cum Tryphone', author: 'Justin Martyr', year: 1722, original_language: 'Greek' },
  { ia_identifier: 'sanctiirenaeiep01harvgoog', title: 'Sancti Irenaei Adversus Haereses', author: 'Irenaeus of Lyon', year: 1857, original_language: 'Greek' },
  { ia_identifier: 'theodosianilibr01sirmgoog', title: 'Theodosiani Libri XVI, vol. 1', author: 'Theodosius II', year: 1905, original_language: 'Latin' },
  { ia_identifier: 'theodosianilibr02sirmgoog', title: 'Theodosiani Libri XVI, vol. 2', author: 'Theodosius II', year: 1905, original_language: 'Latin' },
  { ia_identifier: 'hermetica0003walt', title: 'Hermetica, vol. 1', author: 'Walter Scott', year: 1926, original_language: 'Greek' },
  { ia_identifier: 'dasbuchhenochhrs00flem', title: 'Das Buch Henoch', author: 'Henoch', year: 1901, original_language: 'Ethiopic' },
  { ia_identifier: 'stoicorumveterum0000arni', title: 'Stoicorum Veterum Fragmenta, vol. 1: Zeno', author: 'Hans von Arnim', year: 1903, original_language: 'Greek' },
  { ia_identifier: 'stoicorumveterum02arniuoft', title: 'Stoicorum Veterum Fragmenta, vol. 2: Chrysippus', author: 'Hans von Arnim', year: 1903, original_language: 'Greek' },
  { ia_identifier: 'stoicorumveterum03arniuoft', title: 'Stoicorum Veterum Fragmenta, vol. 3: Chrysippus (Ethica)', author: 'Hans von Arnim', year: 1903, original_language: 'Greek' },
  { ia_identifier: 'hin-wel-all-00002183-001', title: 'Kirani Kiranides', author: 'Kyranides', year: 1638, original_language: 'Latin' },
  { ia_identifier: 'philostratuslife0001fcco', title: 'Life of Apollonius of Tyana, vol. 1', author: 'Philostratus', year: 1912, original_language: 'Greek' },
  { ia_identifier: 'philostratuslife0002fcco_c5k3', title: 'Life of Apollonius of Tyana, vol. 2', author: 'Philostratus', year: 1912, original_language: 'Greek' },
  { ia_identifier: 'bub_gb_orMCAAAAYAAJ', title: 'Aratus cum Scholiis', author: 'Aratus', year: 1828, original_language: 'Greek' },
  { ia_identifier: 'b30540094', title: 'Plutarchi De Iside et Osiride', author: 'Plutarch', year: 1744, original_language: 'Greek' },
  { ia_identifier: 'CatalogusCodicumAstrologorumGraec1', title: 'Catalogus Codicum Astrologorum Graecorum, vol. 1', author: 'Various', year: 1898, original_language: 'Greek' },
  { ia_identifier: 'TheNagHammadiLibrary_201701', title: 'The Nag Hammadi Library', author: 'James M. Robinson', year: 1977, original_language: 'Coptic' },
  { ia_identifier: 'sepherharazimboo0000unse', title: 'Sepher ha-Razim: The Book of the Mysteries', author: 'Michael Morgan', year: 1983, original_language: 'Hebrew' },
];

console.log(`Importing ${imports.length} books...\n`);

let success = 0, failed = 0, dupes = 0;
for (const book of imports) {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cronSecret}`,
      },
      body: JSON.stringify(book),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`OK   ${book.title} → ${data.bookId || 'created'} (${data.pagesCreated || '?'} pages)`);
      success++;
    } else if (data.error?.includes('already exists')) {
      console.log(`DUPE ${book.title} (${data.existingId})`);
      dupes++;
    } else {
      console.log(`ERR  ${book.title}: ${data.error || res.status}`);
      failed++;
    }
  } catch (e) {
    console.log(`ERR  ${book.title}: ${e.message}`);
    failed++;
  }
  // Small delay to not hammer the API
  await new Promise(r => setTimeout(r, 2000));
}

console.log(`\nDone: ${success} new, ${dupes} already existed, ${failed} failed`);
