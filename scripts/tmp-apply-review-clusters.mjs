#!/usr/bin/env node
/**
 * Apply manually reviewed edition clusters from the review list.
 * Each cluster is a set of book titles that should share a work_id.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const clusters = [
  {
    work_id: 'ptolemy-cosmographia',
    titles: ['Cosmographia (Geography)', 'Cosmographia / Ptolemy (VLF 57)'],
  },
  {
    work_id: 'poliziano-miscellanea',
    titles: ['Miscellaneorum Centuria Prima', 'Miscellanea centuria una'],
  },
  {
    work_id: 'pico-opuscula',
    titles: ['Opuscula', 'Opuscula cum Vita'],
  },
  {
    work_id: 'meydenbach-hortus-sanitatis',
    titles: ['Hortus Sanitatis', 'Ortus sanitatis'],
  },
  {
    work_id: 'abenragel-de-judiciis-astrorum',
    titles: ['De Judiciis Astrorum', 'Libri de Iudiciis Astrorum', 'De iudiciis astrorum'],
  },
  {
    work_id: 'ptolemy-quadripartitum',
    titles: ['Quadripartitum et Centiloquium', 'Quadripartitum (with Centiloquium, Hermes, Bethem, Mashallah, Zahel)', 'Liber Quadripartiti Ptolomei (1493 incunabulum)'],
  },
  {
    work_id: 'theophrastus-historia-plantarum',
    titles: ['Theophrasti De Historia Plantarum (1483 Incunabulum)', 'De historia plantarum libri IX'],
  },
  {
    work_id: 'albumasar-introductorium',
    titles: ['Introductorium in Astronomiam (1489)', 'Albumasar Introductorium in astronomiam; Prognosticon 1481'],
  },
  {
    // Extend existing busto-sphaera-mundi cluster
    work_id: 'busto-sphaera-mundi',
    titles: ['Sphaera Mundi cum Commentariis (1485)'],
  },
  {
    work_id: 'hermes-pimander',
    titles: ['Trismegistus De potestate et sapientia Dei, Ficino interprete', 'Mercurius Trismeg. De potestate et sapientia Dei, et alia Ficini Opera'],
  },
  {
    work_id: 'plato-opera-ficino',
    titles: ['Platonis Opera Marsilio Ficino interprete', 'Platonis Dialogi Marsilio Ficino interprete'],
  },
  {
    // Extend existing ficino-three-books-life
    work_id: 'ficino-three-books-life',
    titles: ['Ficini De triplici vita', 'De triplici vita (Pre-editio princeps MS, 1489)'],
  },
  {
    work_id: 'ficino-theologia-platonica',
    titles: ['Marsilii Ficini Theologia platonica', 'Theologia Platonica (editio princeps, 1482)', 'Marsilii Ficini In theologiam platonicam'],
  },
];

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  let totalUpdated = 0;

  for (const cluster of clusters) {
    console.log(`\n${cluster.work_id}:`);
    for (const title of cluster.titles) {
      // Only set work_id where it's missing — never overwrite
      const result = await db.collection('books').updateMany(
        {
          title,
          status: 'published',
          $or: [{ work_id: { $exists: false } }, { work_id: null }],
        },
        { $set: { work_id: cluster.work_id, updated_at: new Date() } }
      );
      if (result.modifiedCount > 0) {
        console.log(`  ✓ "${title}" → ${result.modifiedCount} book(s) updated`);
        totalUpdated += result.modifiedCount;
      } else {
        console.log(`  - "${title}" — already linked or not found`);
      }
    }
  }

  console.log(`\nTotal books updated: ${totalUpdated}`);

  // Verify final count
  const total = await db.collection('books').countDocuments({
    status: 'published',
    work_id: { $exists: true, $ne: null },
  });
  console.log(`Total books with work_id: ${total}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
