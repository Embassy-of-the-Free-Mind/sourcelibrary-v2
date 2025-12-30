import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db();
  
  // Update Vatican Library imports
  const vaticanResult = await db.collection('books').updateMany(
    { 'image_source.provider_name': 'Vatican Library' },
    {
      $set: {
        'image_source.license': 'CC-BY-NC-4.0',
        'image_source.license_url': 'https://creativecommons.org/licenses/by-nc/4.0/',
        'image_source.attribution': 'Images © Biblioteca Apostolica Vaticana'
      }
    }
  );
  console.log(`Updated ${vaticanResult.modifiedCount} Vatican Library books`);
  
  // Update Bodleian Library imports
  const bodleianResult = await db.collection('books').updateMany(
    { 'image_source.provider_name': 'Bodleian Library' },
    {
      $set: {
        'image_source.license': 'CC-BY-NC-4.0',
        'image_source.license_url': 'https://creativecommons.org/licenses/by-nc/4.0/',
        'image_source.attribution': '© Bodleian Libraries, University of Oxford'
      }
    }
  );
  console.log(`Updated ${bodleianResult.modifiedCount} Bodleian Library books`);
  
  // Update Gallica imports  
  const gallicaResult = await db.collection('books').updateMany(
    { 'image_source.provider_name': { $regex: /Gallica/i } },
    {
      $set: {
        'image_source.license': 'publicdomain',
        'image_source.license_url': null,
        'image_source.attribution': 'Source: Bibliothèque nationale de France'
      }
    }
  );
  console.log(`Updated ${gallicaResult.modifiedCount} Gallica books`);
  
  // Update IRHT imports
  const irhtResult = await db.collection('books').updateMany(
    { 'image_source.provider_name': { $regex: /IRHT/i } },
    {
      $set: {
        'image_source.license': 'CC-BY-NC-4.0',
        'image_source.license_url': 'https://creativecommons.org/licenses/by-nc/4.0/',
        'image_source.attribution': '© IRHT-CNRS'
      }
    }
  );
  console.log(`Updated ${irhtResult.modifiedCount} IRHT books`);
  
  await client.close();
}

main().catch(console.error);
