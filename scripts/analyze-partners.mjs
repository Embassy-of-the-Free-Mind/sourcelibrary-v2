import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find hidden partner books that already have significant OCR
  console.log('=== HIDDEN GEMS: Partner books with OCR already done ===\n');
  
  const hiddenWithOcr = await db.collection('books').find({
    hidden: true,
    'image_source.provider': { $nin: ['efm', null] },
    pages_ocr: { $gt: 10 }
  }).project({
    id: 1, title: 1, author: 1, language: 1, year: 1,
    'image_source.provider': 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    read_count: 1
  }).sort({ pages_ocr: -1 }).limit(50).toArray();

  console.log('Hidden books with OCR (' + hiddenWithOcr.length + '):');
  for (const b of hiddenWithOcr) {
    const ocrPct = b.pages_count > 0 ? Math.round((b.pages_ocr || 0) / b.pages_count * 100) : 0;
    const trPct = b.pages_count > 0 ? Math.round((b.pages_translated || 0) / b.pages_count * 100) : 0;
    console.log(
      '  ' + (b.image_source?.provider || '?').padEnd(6) +
      (b.title || '').substring(0, 55).padEnd(57) +
      (b.author || '').substring(0, 25).padEnd(27) +
      String(b.year || '').padStart(5) + ' ' +
      String(b.pages_count || 0).padStart(5) + 'p ' +
      String(ocrPct).padStart(3) + '% ocr ' +
      String(trPct).padStart(3) + '% tr ' +
      String(b.read_count || 0).padStart(3) + 'r'
    );
  }

  // Curated list: Spiritually important hidden texts
  console.log('\n\n=== SPIRITUAL/ESOTERIC HIGHLIGHTS (all hidden partner books) ===\n');
  
  // Search for key spiritual/esoteric terms in titles
  const spiritualTerms = [
    'Zohar', 'Kabbal', 'Hermet', 'Emerald', 'Gnostic', 'Nag Hammadi',
    'Corpus Hermeticum', 'Picatrix', 'Ars Notoria', 'Goetia', 'Key of Solomon',
    'Sepher', 'Sefer', 'Bahir',
    'Yoga', 'Tantra', 'Upanishad', 'Bhagavad', 'Vedanta', 'Chakra', 'Kundalini',
    'Tao', 'Dao', 'I Ching', 'Yi Jing', 'Zhuangzi', 'Laozi',
    'Sufi', 'Rumi', 'Ibn Arabi',
    'Meister Eckhart', 'Eckhart', 'Bonaventure', 'Dionysius', 'Mystical',
    'Theologia', 'Pistis Sophia', 'Enoch',
    'Paracelsus', 'Agrippa', 'Trithemius', 'Bruno', 'Dee',
    'Rosicrucian', 'Fama Fraternitatis', 'Chemical Wedding', 'Chymical',
    'Alchemy', 'Alchim', 'Philosopher.*Stone', 'Chrysopoeia',
    'Bestiary', 'Voynich',
    'Buddh', 'Lotus Sutra', 'Diamond Sutra', 'Prajnaparamita',
    'Neoplatoni', 'Proclus', 'Plotinus', 'Iamblichus', 'Porphyry',
    'Orphic', 'Eleusinian', 'Mystery', 'Initiation',
    'Swedenborg', 'Boehme', 'Böhme',
    'Fludd', 'Kircher', 'Maier', 'Khunrath'
  ];
  
  const regexPattern = spiritualTerms.join('|');
  const spiritual = await db.collection('books').find({
    hidden: true,
    'image_source.provider': { $nin: ['efm', null] },
    $or: [
      { title: { $regex: regexPattern, $options: 'i' } },
      { author: { $regex: regexPattern, $options: 'i' } }
    ]
  }).project({
    id: 1, title: 1, author: 1, language: 1, year: 1,
    'image_source.provider': 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    read_count: 1
  }).sort({ read_count: -1, year: 1 }).toArray();

  console.log('Spiritual/esoteric hidden books (' + spiritual.length + '):\n');
  
  // Group by topic
  const groups = {
    'KABBALAH & JEWISH MYSTICISM': [],
    'HERMETICA & NEOPLATONISM': [],
    'ALCHEMY': [],
    'EASTERN (YOGA, TANTRA, BUDDHISM, TAOISM)': [],
    'CHRISTIAN MYSTICISM': [],
    'RENAISSANCE MAGIC & OCCULT': [],
    'ROSICRUCIAN': [],
    'OTHER ESOTERIC': []
  };

  for (const b of spiritual) {
    const t = (b.title || '').toLowerCase();
    const a = (b.author || '').toLowerCase();
    const entry = {
      provider: (b.image_source?.provider || '?').substring(0, 5),
      title: (b.title || '').substring(0, 60),
      author: (b.author || '').substring(0, 30),
      year: b.year,
      pages: b.pages_count || 0,
      lang: (b.language || '?').substring(0, 6),
      reads: b.read_count || 0,
      ocrPct: b.pages_count > 0 ? Math.round((b.pages_ocr || 0) / b.pages_count * 100) : 0,
    };

    if (t.match(/zohar|kabbal|sepher|sefer|bahir/i)) groups['KABBALAH & JEWISH MYSTICISM'].push(entry);
    else if (t.match(/hermet|corpus|emerald|neoplatoni|proclus|plotinus|iamblichus|porphyry|orphic/i) || a.match(/proclus|plotinus|iamblichus|porphyry|hermes/i)) groups['HERMETICA & NEOPLATONISM'].push(entry);
    else if (t.match(/alchem|alchim|chrysopoeia|philosopher.*stone|turba/i)) groups['ALCHEMY'].push(entry);
    else if (t.match(/yoga|tantra|upanishad|bhagavad|vedanta|chakra|kundalini|tao|dao|i.ching|zhuangzi|laozi|buddh|sutra|prajnaparamita/i)) groups['EASTERN (YOGA, TANTRA, BUDDHISM, TAOISM)'].push(entry);
    else if (t.match(/eckhart|bonaventure|dionysius|mystical|theologia|pistis|enoch|swedenborg|boehme|böhme/i) || a.match(/eckhart|swedenborg|boehme|böhme/i)) groups['CHRISTIAN MYSTICISM'].push(entry);
    else if (t.match(/agrippa|picatrix|ars notoria|goetia|key of solomon|trithemius|bruno|dee|magic/i) || a.match(/agrippa|paracelsus|trithemius|bruno|dee/i)) groups['RENAISSANCE MAGIC & OCCULT'].push(entry);
    else if (t.match(/rosicrucian|fama|chemical wedding|chymical/i)) groups['ROSICRUCIAN'].push(entry);
    else groups['OTHER ESOTERIC'].push(entry);
  }

  for (const [group, books] of Object.entries(groups)) {
    if (books.length === 0) continue;
    console.log(group + ' (' + books.length + '):');
    for (const b of books.slice(0, 15)) {
      console.log(
        '  ' + b.provider.padEnd(6) +
        b.title.padEnd(60) +
        b.author.padEnd(30) +
        String(b.year || '').padStart(5) + ' ' +
        String(b.pages).padStart(4) + 'p ' +
        b.lang.padEnd(7) +
        String(b.ocrPct).padStart(3) + '% ' +
        String(b.reads).padStart(2) + 'r'
      );
    }
    console.log('');
  }

  // Vatican highlights
  console.log('\n=== ALL VATICAN LIBRARY BOOKS (hidden) ===\n');
  const vatican = await db.collection('books').find({
    hidden: true,
    'image_source.provider': 'vatican'
  }).project({
    id: 1, title: 1, author: 1, language: 1, year: 1,
    pages_count: 1, pages_ocr: 1, read_count: 1
  }).sort({ year: 1 }).toArray();
  
  for (const b of vatican) {
    console.log(
      '  ' + (b.title || '').substring(0, 60).padEnd(62) +
      (b.author || '').substring(0, 30).padEnd(32) +
      String(b.year || '').padStart(5) + ' ' +
      (b.language || '?').padEnd(8) +
      String(b.pages_count || 0).padStart(5) + 'p'
    );
  }

  // LOC highlights (Eastern texts)
  console.log('\n=== ALL LIBRARY OF CONGRESS BOOKS (hidden) ===\n');
  const loc = await db.collection('books').find({
    hidden: true,
    'image_source.provider': 'loc'
  }).project({
    id: 1, title: 1, author: 1, language: 1, year: 1,
    pages_count: 1, pages_ocr: 1, read_count: 1
  }).sort({ year: 1 }).toArray();
  
  for (const b of loc) {
    console.log(
      '  ' + (b.title || '').substring(0, 60).padEnd(62) +
      (b.author || '').substring(0, 30).padEnd(32) +
      String(b.year || '').padStart(5) + ' ' +
      (b.language || '?').padEnd(8) +
      String(b.pages_count || 0).padStart(5) + 'p'
    );
  }

  // Wellcome highlights
  console.log('\n=== ALL WELLCOME COLLECTION BOOKS (hidden) ===\n');
  const wellcome = await db.collection('books').find({
    hidden: true,
    'image_source.provider': 'wellcome'
  }).project({
    id: 1, title: 1, author: 1, language: 1, year: 1,
    pages_count: 1, pages_ocr: 1, read_count: 1
  }).sort({ year: 1 }).toArray();
  
  for (const b of wellcome) {
    console.log(
      '  ' + (b.title || '').substring(0, 60).padEnd(62) +
      (b.author || '').substring(0, 30).padEnd(32) +
      String(b.year || '').padStart(5) + ' ' +
      (b.language || '?').padEnd(8) +
      String(b.pages_count || 0).padStart(5) + 'p'
    );
  }

  await client.close();
}
main();
