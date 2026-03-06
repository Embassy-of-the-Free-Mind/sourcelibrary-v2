import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Check near-misses - tags that are short forms of existing books
const nearMisses = [
  'Asclepius', 'Enneads', 'Hermetica', 'Hermeticum', 'Philo', 
  'Josephus', 'Golden Ass', 'Stromateis', 'Confessions',
  'Almagest', 'De anima', 'Moralia', 'Epistles', 'Timaeus',
  'Republic', 'Phaedrus', 'Symposium', 'Parmenides', 'Sophist',
  'Cratylus', 'Iliad', 'Odyssey', 'Frogs', 'Knights', 'Peace',
  'Satyricon', 'Apologia', 'Annales', 'Calcidius', 'Damascius',
  'Eunapius', 'Nicomachus', 'Sallustius', 'Vitruvius', 'Hierocles',
  'Marinus', 'Procopius', 'Cornutus', 'Basil', 'Eusebius',
  'Ephrem', 'Nag Hammadi', 'Dead Sea Scrolls', 'Hekhalot',
  'Hymn of the Pearl', 'Orphica', 'PGM', 'Proverbs', 'Kings',
  'Somnium', 'Philocalia', 'Philokalia', 'Aratus', 'Archytas',
  'Philolaus', 'Alcinous', 'Numenius', 'Bardaisan', 'Evagrius',
  'Mani', 'Augustine', 'Julian'
];

for (const tag of nearMisses) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const results = await db.collection('books').find({
    deleted: { $ne: true },
    $or: [
      { title: { $regex: new RegExp(escaped, 'i') } },
      { display_title: { $regex: new RegExp(escaped, 'i') } },
      { author: { $regex: new RegExp(escaped, 'i') } },
    ]
  }, { projection: { _id: 1, title: 1, display_title: 1, author: 1 } }).limit(3).toArray();
  
  if (results.length > 0) {
    console.log(`\n"${tag}" → NEAR MATCHES:`);
    for (const r of results) {
      console.log(`  ${r.display_title || r.title} [${r.author || 'no author'}] (${r._id})`);
    }
  } else {
    console.log(`"${tag}" → NO MATCH AT ALL`);
  }
}

await client.close();
