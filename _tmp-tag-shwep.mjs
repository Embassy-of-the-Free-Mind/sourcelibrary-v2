import { MongoClient, ObjectId } from 'mongodb';

// Primary source authors/works cited on SHWEP episodes, cross-referenced against
// our book collection. No broad names (Plato, Aristotle, Homer) that match 50+ books.
// Updated from crawled episode show notes (eps 0-44, 133-214).
const allTags = [
  // Hermetica
  'Hermes Trismegistus', 'Corpus Hermeticum', 'Asclepius', 'Poimandres',
  // Neoplatonists
  'Plotinus', 'Enneads', 'Porphyry', 'Iamblichus', 'De Mysteriis',
  'Proclus', 'Elements of Theology', 'Damascius', 'Simplicius', 'Olympiodorus',
  'Marinus', 'John Philoponus', 'Hypatia', 'Hierocles',
  // Roman-era authors
  'Plutarch', 'Apuleius', 'Golden Ass', 'Numenius',
  'Ptolemy', 'Tetrabiblos', 'Vettius Valens', 'Firmicus Maternus',
  'Aelius Aristides', 'Artemidorus', 'Oneirocritica',
  'Apollonius', 'Philostratus', 'Nicomachus',
  'Galen', 'Lucian', 'Marcus Aurelius', 'Epictetus', 'Cornutus',
  'Eunapius', 'Eusebius', 'Procopius', 'Horapollo',
  // Pre-Socratic / Classical
  'Orpheus', 'Herodotus', 'Hippocrates', 'Aristophanes',
  'Diogenes Laertius', 'Aristoxenus', 'Archytas', 'Philolaus',
  'Vitruvius', 'Strabo', 'Aratus',
  // Early Christian
  'Clement of Alexandria', 'Stromateis', 'Origen', 'Contra Celsum',
  'Augustine', 'Marius Victorinus', 'Evagrius', 'Evagrius Ponticus',
  'Gregory of Nyssa', 'Gregory of Nazianzus',
  'Pseudo-Dionysius', 'Dionysius the Areopagite',
  'Maximus the Confessor', 'Calcidius',
  'Justin Martyr', 'Lactantius', 'Rabanus Maurus',
  // Late antiquity
  'Macrobius', 'Martianus Capella', 'Synesius', 'Synesius of Cyrene',
  'Stephanos of Alexandria', 'Zosimus',
  'Emperor Julian', 'Sallustius', 'Alexander of Aphrodisias', 'Alcinous',
  'Michael Psellos', 'Theon of Alexandria',
  // Newly imported authors (Mar 2026)
  'Diodorus Siculus', 'Dio Chrysostom', 'Sextus Empiricus',
  'Ammianus Marcellinus', 'Josephus', 'Isocrates',
  'Palladius', 'Rufinus', 'Valerius Maximus', 'John Lydus',
  'Liber de causis', 'Theologumena Arithmeticae',
  // Jewish / Near Eastern
  'Philo', 'Sefer Yetzirah', 'Nag Hammadi', 'Dead Sea Scrolls',
  'Valentinus', 'Basilides', 'Mani',
  'Hekhalot', 'Testament of Solomon', 'Book of Enoch',
  // Oracles and magic
  'Chaldean Oracles', 'Sibylline Oracles',
  'Greek Magical Papyri', 'PGM',
  // Alchemy
  'Turba Philosophorum', 'Emerald Tablet', 'Jabir ibn Hayyan',
  // Utopias & pseudo-Aristotelian
  'Thomas More', 'Tommaso Campanella', 'Secretum secretorum',
  // Zoroastrian
  'Zoroaster',
  // Specific Platonic dialogues (not 'Plato' which matches 60+ books)
  'Timaeus', 'Republic', 'Symposium', 'Phaedo',
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const tagPatterns = allTags.map(tag => ({
    tag,
    // Use word boundaries to avoid partial matches (e.g. "Philo" matching "Philosophy")
    pattern: new RegExp('\\b' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'),
  }));

  // First, REMOVE all existing shwep tags (clean slate)
  const removeResult = await db.collection('books').updateMany(
    { collections: 'shwep' },
    { $pull: { collections: 'shwep' } }
  );
  console.log('Removed shwep tag from', removeResult.modifiedCount, 'books');

  const books = await db.collection('books').find(
    { deleted: { $ne: true } },
    { projection: { _id: 1, title: 1, display_title: 1, author: 1, language: 1, thumbnail: 1, year: 1 } }
  ).toArray();

  console.log('Total books:', books.length);

  const matchingIds = new Set();
  const tagCounts = {};
  for (const { tag, pattern } of tagPatterns) {
    let count = 0;
    for (const b of books) {
      if (pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')) {
        matchingIds.add(b._id.toString());
        count++;
      }
    }
    if (count > 0) tagCounts[tag] = count;
  }

  // Show per-tag counts for audit
  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  console.log('\nPer-tag match counts:');
  for (const [tag, count] of sorted) {
    console.log(`  ${tag}: ${count}`);
  }

  console.log('\nTotal unique books matching:', matchingIds.size);

  const matchingObjectIds = [...matchingIds].map(id => new ObjectId(id));

  const result = await db.collection('books').updateMany(
    { _id: { $in: matchingObjectIds } },
    { $addToSet: { collections: 'shwep' } }
  );
  console.log('Tagged:', result.modifiedCount, 'books');

  // Language breakdown
  const langAgg = await db.collection('books').aggregate([
    { $match: { collections: 'shwep' } },
    { $group: { _id: '$language', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  const languages = langAgg.map(l => ({ lang: l._id || 'Unknown', count: l.count }));
  console.log('\nLanguages:', JSON.stringify(languages));

  // Sample books for collection card
  const sampleBooks = await db.collection('books').find(
    { collections: 'shwep', thumbnail: { $exists: true, $ne: null } },
    { projection: { _id: 1, title: 1, display_title: 1, author: 1, thumbnail: 1 } }
  ).limit(6).toArray();

  const sampleForCollection = sampleBooks.map(b => ({
    id: b._id.toString(),
    title: b.display_title || b.title,
    author: b.author,
    thumbnail: b.thumbnail,
  }));

  const featuredImages = sampleBooks.slice(0, 3).map(b => b.thumbnail).filter(Boolean);

  // Update collection metadata
  await db.collection('collections').updateOne(
    { slug: 'shwep' },
    { $set: {
      book_count: matchingIds.size,
      languages,
      sample_books: sampleForCollection,
      featured_images: featuredImages,
      updated_at: new Date(),
    }}
  );
  console.log('Collection metadata updated');

  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
