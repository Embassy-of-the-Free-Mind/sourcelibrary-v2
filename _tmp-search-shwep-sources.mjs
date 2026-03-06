// Check what we already have, then search IA for the rest
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const allBooks = await db.collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } }
).toArray();

const candidates = [
  { id: 1, eps: [55], title: 'Adversus Haereses', author: 'Irenaeus', dbSearch: /irena/i, lang: 'Latin' },
  { id: 2, eps: [55], title: 'Refutatio Omnium Haeresium', author: 'Hippolytus', dbSearch: /hippolyt/i, lang: 'Greek' },
  { id: 3, eps: [55], title: 'Table Talk', author: 'Plutarch', dbSearch: /plutarch/i, lang: 'Greek' },
  { id: 4, eps: [61,62], title: 'Book of Enoch', author: 'Enoch', dbSearch: /enoch/i, lang: 'Ethiopic' },
  { id: 5, eps: [63], title: 'Hekhalot Rabbati', author: 'anonymous', dbSearch: /hekhalot|heikhalot/i, lang: 'Hebrew' },
  { id: 6, eps: [121], title: 'Procli Philosophica Minora', author: 'Proclus', dbSearch: /proclus|procli/i, lang: 'Greek' },
  { id: 7, eps: [123], title: 'De Principiis', author: 'Origen', dbSearch: /origen/i, lang: 'Latin' },
  { id: 8, eps: [172], title: 'De Abstinentia', author: 'Porphyry', dbSearch: /porphyr/i, lang: 'Greek' },
  { id: 9, eps: [172], title: 'De Antro Nympharum', author: 'Porphyry', dbSearch: /antro nympharum|cave.*nymph/i, lang: 'Greek' },
  { id: 10, eps: [172], title: 'Letter to Anebo', author: 'Porphyry', dbSearch: /anebo/i, lang: 'Greek' },
  { id: 11, eps: [172], title: 'Adversus Christianos', author: 'Porphyry', dbSearch: /porphyr.*christian|porphyr.*adversus/i, lang: 'Greek' },
  { id: 12, eps: [172], title: 'Oracula Chaldaica', author: 'Julian', dbSearch: /oracula chaldaica|chaldaean oracle|chald.*oracle/i, lang: 'Greek' },
  { id: 13, eps: [201], title: 'Introductio Arithmetica', author: 'Nicomachus', dbSearch: /nicomachus|nicomach/i, lang: 'Greek' },
  { id: 14, eps: [201], title: 'Theologoumena Arithmeticae', author: 'Iamblichus', dbSearch: /theologoumena/i, lang: 'Greek' },
  { id: 15, eps: [201], title: 'De Vita Pythagorica', author: 'Iamblichus', dbSearch: /iamblich.*pythag|vita pythagorica/i, lang: 'Greek' },
  { id: 16, eps: [225], title: 'Reisen im Orient', author: 'Niebuhr', dbSearch: /niebuhr.*reisen|reisen.*orient/i, lang: 'German' },
  { id: 17, eps: [233,239], title: 'Collection des Anciens Alchimistes Grecs', author: 'Berthelot', dbSearch: /berthelot.*alchimiste|anciens alchimiste/i, lang: 'French' },
  { id: 18, eps: [242], title: 'Opera of Gregory of Nyssa', author: 'Gregory of Nyssa', dbSearch: /gregor.*nyss|gregorii nysseni/i, lang: 'Greek' },
  { id: 19, eps: [250,296], title: 'Lives of the Sophists', author: 'Eunapius/Philostratus', dbSearch: /eunapius|lives.*sophist/i, lang: 'Greek' },
  { id: 20, eps: [296,297,298], title: 'Vita Isidori', author: 'Damascius', dbSearch: /damasci/i, lang: 'Greek' },
  { id: 21, eps: [296], title: 'Suidae Lexicon', author: 'Suidas', dbSearch: /suidae|suda.*lexicon/i, lang: 'Greek' },
  { id: 22, eps: [298], title: 'Life of Severus', author: 'Zacharias', dbSearch: /zachari.*sever|vie de s[eé]v[eè]r/i, lang: 'Syriac' },
  { id: 23, eps: [300], title: 'Lives of Eminent Philosophers', author: 'Diogenes Laertius', dbSearch: /diogenes laert/i, lang: 'Greek' },
  { id: 24, eps: [300], title: 'Prolegomena to Platonic Philosophy', author: 'Anonymous', dbSearch: /prolegomena.*platon/i, lang: 'Greek' },
  { id: 25, eps: [309], title: 'Muhammedanische Studien', author: 'Goldziher', dbSearch: /goldziher|muhammedanische/i, lang: 'German' },
  { id: 26, eps: [320], title: 'Ambigua', author: 'Maximus Confessor', dbSearch: /maximus.*confessor|maximi.*ambigua/i, lang: 'Greek' },
];

console.log('=== CHECKING EXISTING COLLECTION ===\n');

const alreadyHave = [];
const needToFind = [];

for (const c of candidates) {
  const matches = allBooks.filter(b => {
    const t = (b.title || '') + ' ' + (b.display_title || '');
    const a = b.author || '';
    return c.dbSearch.test(t) || c.dbSearch.test(a);
  });

  if (matches.length > 0) {
    alreadyHave.push({ ...c, matches });
    console.log(`HAVE [${c.id}] ${c.title} (${c.author}) — ${matches.length} match(es):`);
    for (const m of matches.slice(0, 5)) {
      const pct = m.pages_count ? Math.round((m.pages_translated || 0) / m.pages_count * 100) : 0;
      console.log(`  ${m._id} — ${(m.display_title || m.title).substring(0, 90)} (${m.pages_count || 0}pp, ${pct}% translated)`);
    }
    if (matches.length > 5) console.log(`  ... and ${matches.length - 5} more`);
  } else {
    needToFind.push(c);
    console.log(`MISSING [${c.id}] ${c.title} (${c.author})`);
  }
  console.log();
}

console.log(`\n=== SUMMARY ===`);
console.log(`Already have: ${alreadyHave.length}/${candidates.length}`);
console.log(`Need to find: ${needToFind.length}/${candidates.length}`);

if (needToFind.length > 0) {
  console.log('\n=== NEED TO IMPORT ===\n');
  for (const c of needToFind) {
    console.log(`[${c.id}] ${c.title} — ${c.author} (${c.lang}) — eps: ${c.eps.join(',')}`);
  }
}

// Now search IA for the missing ones
console.log('\n\n=== SEARCHING INTERNET ARCHIVE ===\n');

const iaSearches = {
  2: ['creator:hippolytus refutatio', 'title:philosophumena', 'title:refutation heresies hippolytus'],
  4: ['title:"book of enoch"', 'title:"liber henoch"', 'title:enoch ethiopic'],
  5: ['title:hekhalot', 'title:heikhalot'],
  9: ['porphyry "antro nympharum"', 'porphyry "cave of the nymphs"'],
  10: ['porphyry anebo', 'epistula anebonem porphyry'],
  11: ['porphyry "against the christians"', 'porphyry adversus christianos'],
  12: ['title:"oracula chaldaica"', 'title:"chaldaean oracles"', 'title:"chaldean oracles"'],
  13: ['nicomachus arithmetic', 'nicomachi arithmetica'],
  14: ['theologoumena arithmeticae', 'iamblichus theology arithmetic'],
  15: ['iamblichus "vita pythagorica"', 'iamblichus pythagorean life'],
  16: ['niebuhr "reisen" orient', 'carsten niebuhr reisebeschreibung'],
  17: ['berthelot "alchimistes grecs"'],
  18: ['gregorii nysseni opera', '"gregory of nyssa" opera'],
  19: ['eunapius "lives of the sophists"', 'philostratus eunapius vitae sophistarum'],
  20: ['damascius isidori', 'damascii vitae isidori'],
  21: ['suidae lexicon', '"suda" lexicon greek'],
  22: ['zacharias scholasticus severus', '"vie de sévère" zacharie'],
  24: ['prolegomena platonic philosophy anonymous'],
  25: ['goldziher muhammedanische studien'],
  26: ['maximus confessor ambigua', '"maximi confessoris"'],
};

async function searchIA(query) {
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query + ' mediatype:texts')}&fl=identifier,title,creator,date,language,imagecount&sort=downloads+desc&rows=5&output=json`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    return data.response?.docs || [];
  } catch (e) {
    return [];
  }
}

const importList = [];

for (const c of needToFind) {
  const searches = iaSearches[c.id] || [];
  let bestMatch = null;

  for (const q of searches) {
    const docs = await searchIA(q);
    if (docs.length > 0) {
      // Prefer older editions, more pages
      for (const d of docs) {
        if (!bestMatch || (d.imagecount > 50 && (!bestMatch.imagecount || d.imagecount > bestMatch.imagecount))) {
          bestMatch = d;
        }
      }
      // Show all results for this search
      console.log(`[${c.id}] ${c.title} — search: "${q}"`);
      for (const d of docs.slice(0, 3)) {
        const mark = d === bestMatch ? ' <<<' : '';
        console.log(`  ${d.identifier} — ${d.title} | ${d.creator || '?'} | ${d.date || '?'} | ${d.imagecount || '?'}pp${mark}`);
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (bestMatch) {
    importList.push({
      ...c,
      ia_id: bestMatch.identifier,
      ia_title: bestMatch.title,
      ia_date: bestMatch.date,
      ia_pages: bestMatch.imagecount,
    });
    console.log(`  >> BEST: ${bestMatch.identifier}\n`);
  } else {
    console.log(`[${c.id}] ${c.title} — NO RESULTS on IA\n`);
  }
}

console.log('\n=== FINAL IMPORT LIST ===\n');
for (const item of importList) {
  console.log(`${item.ia_id}`);
  console.log(`  Title: ${item.ia_title}`);
  console.log(`  Our title: ${item.title} — ${item.author}`);
  console.log(`  Language: ${item.lang} | Episodes: ${item.eps.join(',')}`);
  console.log();
}
console.log(`Total to import: ${importList.length}`);

await client.close();
