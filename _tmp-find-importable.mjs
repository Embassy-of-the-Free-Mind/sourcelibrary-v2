import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

// Load crawled data
const lines = readFileSync('src/data/shwep-crawled.jsonl', 'utf8').trim().split('\n');
const allWorks = new Map(); // work -> { eps: [], count }

for (const line of lines) {
  try {
    const ep = JSON.parse(line);
    if (!ep.citedWorks || !ep.n) continue;
    for (const work of ep.citedWorks) {
      const clean = work.replace(/[.,;:]+$/, '').trim();
      if (clean.length < 5) continue;
      if (!allWorks.has(clean)) allWorks.set(clean, { eps: [], count: 0 });
      const w = allWorks.get(clean);
      w.eps.push(ep.n);
      w.count++;
    }
  } catch {}
}

// Connect to DB
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = await client.db('bookstore').collection('books').find(
  { deleted: { $ne: true } },
  { projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1 } }
).toArray();

// Check if work matches any book
function hasMatch(work) {
  const lower = work.toLowerCase();
  return books.some(b => {
    const t = (b.title || '').toLowerCase();
    const dt = (b.display_title || '').toLowerCase();
    const a = (b.author || '').toLowerCase();
    // Exact or substantial substring match
    if (t === lower || dt === lower || a === lower) return true;
    if (lower.length >= 10) {
      if (t.includes(lower) || dt.includes(lower) || a.includes(lower)) return true;
      if (lower.includes(t) && t.length >= 10) return true;
      if (lower.includes(dt) && dt.length >= 10) return true;
    }
    return false;
  });
}

// Identify ANCIENT/MEDIEVAL PRIMARY SOURCES vs modern scholarship
// Primary sources: works BY ancient/medieval authors, not ABOUT them
function isModernScholarship(work) {
  // Journal names
  if (/^(Journal|Proceedings|Transactions|Bulletin|Zeitschrift|Revue|Annales|Archives|Archiv|Studia|Studies|Studien|Acta|Eranos|Hermathena|Phronesis|Mnemosyne|Semeia|Gnosis:|Classical |Catholic |Hebrew |Dumbarton|Downside|Historisches|International Journal|Symbolae|Vigiliae|Vigiliæ|Internet Encyclopedia|Stanford Encyclopedia|Real-Encyclop|Orientalism)\b/i.test(work)) return true;
  // Modern book patterns
  if (/: (A |An |The |Essays|Studies|Collected|Selected|New|From|Between|Linking|A Guide|A Study|A History|A Commentary|The )/i.test(work)) return true;
  if (/(Introduction to|History of|Dictionary of|Guide to|Encyclopedia of|Handbook of)\b/i.test(work)) return true;
  // Publisher/university
  if (/\b(University|Press|Oxford|Cambridge|Princeton|Harvard|Brill|Springer)\b/i.test(work)) return true;
  // Citation abbreviations
  if (/^(In |Adv\.|De gen\.|Contr\.|Comm\.|Dem\.|Ecl\.|Prep\.|Vit\.|Phil\.|P\. Oxy|Præp|Theol\.)/.test(work)) return true;
  if (/^[A-Z][a-z]+\. [A-Z]/.test(work) && work.length < 20) return true; // abbreviated refs
  return false;
}

// Looks like an ancient text title?
function looksLikePrimarySource(work) {
  // Latin/Greek titles
  if (/^(De |In |Ad |Pro |Contra |Super |Epistol|Stromata|Kyranid|Korê|Timæus|Phædrus|Theætetus|Phænomena|Apotelesmatik|Ambiguu|Codex|Sefer|Kitāb|Sūrat|Gospel of|Acts of|Book of|Life of|On the |Against |Apocryphon|Recognitions|Extracts of|Letter to|Dialogue with|Hymn|Oracles|Kephalaia)/.test(work)) return true;
  // Known ancient works/authors that might have editions on IA
  if (/\b(Chaldæan|Chaldaean|Chaldäi|Poimandres|Hermetica|Hermes Trismeg|Zosime|Olympiodor|Macrobius|Hierocles|Nicomachus|Vettius Valens|Proclus.*Elements|Proclus.*Hymns|Plotinus.*Enneads|Diogenes Laertius|Stoicorum Veterum|Catalogus Codicum|Collection des Anciens Alchimistes|Corpus inscriptionum)\b/.test(work)) return true;
  return false;
}

// Find importable primary sources
const importable = [];
const maybeImportable = [];

for (const [work, data] of allWorks) {
  if (hasMatch(work)) continue;
  if (isModernScholarship(work)) continue;
  
  if (looksLikePrimarySource(work)) {
    importable.push({ work, ...data });
  } else if (data.count >= 3 && !work.startsWith('Corrige') && work.length > 10) {
    maybeImportable.push({ work, ...data });
  }
}

importable.sort((a, b) => b.count - a.count);
maybeImportable.sort((a, b) => b.count - a.count);

console.log(`\n=== LIKELY IMPORTABLE PRIMARY SOURCES (${importable.length}) ===\n`);
for (const { work, count, eps } of importable) {
  console.log(`  ${count.toString().padStart(2)}x  ${work}`);
}

console.log(`\n=== FREQUENTLY CITED, POSSIBLY IMPORTABLE (${maybeImportable.length}) ===\n`);
for (const { work, count } of maybeImportable) {
  console.log(`  ${count.toString().padStart(2)}x  ${work}`);
}

await client.close();
