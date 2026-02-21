import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const leo = await db.collection('books').find({
    hidden: { $ne: true },
    $or: [
      { author: { $regex: /vinci/i } },
      { author: { $regex: /leonardo/i } }
    ]
  }).project({
    _id: 1, id: 1, title: 1, author: 1, year: 1, language: 1,
    'image_source.provider': 1, pages_count: 1, pages_ocr: 1,
    pages_translated: 1, read_count: 1, 'pipeline_auto.status': 1
  }).sort({ pages_count: -1 }).toArray();

  console.log('Leonardo da Vinci visible books:', leo.length);

  // Categorize: KEEP the major works, HIDE the Ravaisson-Mollien fragments and duplicates
  const keep = [];
  const hide = [];

  for (const b of leo) {
    const t = (b.title || '').toLowerCase();
    const id = b.id || String(b._id);

    // KEEP: Major codices and primary works
    const isKeep =
      // Major codices
      t.includes('codex arundel') ||
      t.includes('codex forster') ||
      t.includes('codex trivulzianus') ||
      t.includes('codex madrid') ||
      t.includes('codex atlanticus') ||
      t.includes('volo degli uccelli') || t.includes('flight of birds') ||
      // Major compilations
      t.includes('notebooks of leonardo') ||
      t.includes('literary works') && t.includes('vol. i') ||  // keep vol I, hide vol II (it's the commentary/notes volume)
      t.includes('i manoscritti di leonardo') && !t.includes('anatomia') ||
      // Key treatises
      (t.includes('trattato della pittura') && !t.includes('editio princeps') && !t.includes('manzi')) || // keep the clean 1651
      t.includes('del moto e misura') ||
      t.includes('leonardo prosatore') ||
      // Intellectual/philosophical
      t.includes('denker, forscher') ||
      t.includes('thoughts on art');

    if (isKeep) {
      keep.push(b);
    } else {
      hide.push(b);
    }
  }

  console.log('\nKEEP (' + keep.length + '):');
  for (const b of keep.sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0))) {
    const prov = (b.image_source?.provider || '?').substring(0, 8);
    console.log(
      '  ' + prov.padEnd(9) +
      (b.title || '').substring(0, 62).padEnd(64) +
      String(b.year || '').padStart(5) + ' ' +
      String(b.pages_count || 0).padStart(5) + 'p'
    );
  }

  console.log('\nHIDE (' + hide.length + '):');
  for (const b of hide.sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0))) {
    const prov = (b.image_source?.provider || '?').substring(0, 8);
    console.log(
      '  ' + prov.padEnd(9) +
      (b.title || '').substring(0, 62).padEnd(64) +
      String(b.year || '').padStart(5) + ' ' +
      String(b.pages_count || 0).padStart(5) + 'p'
    );
  }

  if (process.argv.includes('--execute')) {
    const ids = hide.map(b => b._id);
    const result = await db.collection('books').updateMany(
      { _id: { $in: ids } },
      { $set: { hidden: true } }
    );
    console.log('\nHidden ' + result.modifiedCount + ' Leonardo books');
    const newVisible = await db.collection('books').countDocuments({ hidden: { $ne: true } });
    console.log('New visible count: ' + newVisible);
  } else {
    console.log('\nDry run. Use --execute to apply.');
  }

  await client.close();
}
main();
