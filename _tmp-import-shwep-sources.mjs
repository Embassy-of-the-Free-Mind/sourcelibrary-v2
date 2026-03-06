// Import SHWEP primary sources via direct API calls with curl-style approach
// These are the books we need to close SHWEP episode gaps

const BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';

const imports = [
  // Ep 172: Porphyry — Select Works (Thomas Taylor 1823)
  // Contains: De Abstinentia, De Antro Nympharum, Letter to Anebo fragments
  {
    ia_identifier: 'selectworksporp00taylgoog',
    title: 'Select Works of Porphyry',
    author: 'Porphyry',
    year: 1823,
    original_language: 'English',
    note: 'Covers eps 172 — Porphyry works in English translation',
  },

  // Ep 172: Arguments against Christians (Lardner compilation)
  {
    ia_identifier: 'argumentsofcelsu37696gut',
    title: 'Arguments of Celsus, Porphyry, and the Emperor Julian, Against the Christians',
    author: 'Thomas Taylor (translator)',
    year: 1830,
    original_language: 'English',
    note: 'Covers ep 172 — fragments of anti-Christian polemics',
  },

  // Ep 201: Theologoumena Arithmeticae (De Falco Greek/Latin 1922)
  {
    ia_identifier: 'falco-theologumena-arithmeticae-gr-lat-1922',
    title: 'Theologumena Arithmeticae',
    author: 'Iamblichus',
    year: 1922,
    original_language: 'Greek',
    note: 'Covers ep 201 — Pythagorean number symbolism',
  },

  // Ep 225: Niebuhr Travels through Arabia (English translation)
  {
    ia_identifier: 'travelsthroughar00nieb',
    title: 'Travels through Arabia and Other Countries in the East',
    author: 'Carsten Niebuhr',
    year: 1792,
    original_language: 'English',
    note: 'Covers ep 225 — Mandaeans',
  },

  // Ep 296: Suda Lexicon (Bekker edition, 1854)
  {
    ia_identifier: 'suidaelexiconexr00suid',
    title: 'Suidae Lexicon',
    author: 'Suidas',
    year: 1854,
    original_language: 'Greek',
    note: 'Covers ep 296 — Byzantine encyclopedia',
  },

  // Ep 296-298: Damascius — Problèmes et solutions (Chaignet, 3 vols)
  {
    ia_identifier: 'problmesetsolut00chaigoog',
    title: 'Problèmes et solutions touchant les premiers principes, Vol. 1',
    author: 'Damascius',
    year: 1898,
    original_language: 'Greek',
    note: 'Covers eps 296-298 — Damascius on first principles',
  },
  {
    ia_identifier: 'problmesetsolut01chaigoog',
    title: 'Problèmes et solutions touchant les premiers principes, Vol. 2',
    author: 'Damascius',
    year: 1898,
    original_language: 'Greek',
    note: 'Covers eps 296-298',
  },
  {
    ia_identifier: 'problmesetsolut02chaigoog',
    title: 'Problèmes et solutions touchant les premiers principes, Vol. 3',
    author: 'Damascius',
    year: 1898,
    original_language: 'Greek',
    note: 'Covers eps 296-298',
  },

  // Ep 298: Zacharias Scholasticus — Patrologia Orientalis vol 2
  {
    ia_identifier: 'patrologiaorient02pariuoft',
    title: 'Patrologia Orientalis, Tome II (inc. Vie de Sévère)',
    author: 'Zacharias Scholasticus',
    year: 1903,
    original_language: 'Syriac',
    note: 'Covers ep 298 — Life of Severus',
  },

  // Ep 309: Goldziher Muhammedanische Studien
  {
    ia_identifier: 'muhammedanisches00gold',
    title: 'Muhammedanische Studien',
    author: 'Ignaz Goldziher',
    year: 1889,
    original_language: 'German',
    note: 'Covers ep 309 — early Islam and hadith studies',
  },
];

console.log(`Importing ${imports.length} books...\n`);

for (const item of imports) {
  const { note, ...importData } = item;
  console.log(`${item.ia_identifier} — ${item.title}`);
  console.log(`  ${note}`);

  try {
    const resp = await fetch(`${BASE}/api/import/ia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(importData),
    });
    const data = await resp.json();
    if (resp.ok) {
      console.log(`  OK: ${data.url || data.bookUrl || JSON.stringify(data).substring(0, 100)}`);
    } else {
      console.log(`  ERROR ${resp.status}: ${data.error || data.message || JSON.stringify(data).substring(0, 150)}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  console.log();
  await new Promise(r => setTimeout(r, 2000));
}

console.log('Done!');
