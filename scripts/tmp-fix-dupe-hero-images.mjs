import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function setFromMet(db, slug, objectId) {
  const obj = await (await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`)).json();
  if (!obj?.primaryImage) { console.log(`FAIL: ${slug}`); return; }

  const resp = await fetch(obj.primaryImage, { signal: AbortSignal.timeout(30000) });
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length < 30000) { console.log(`SKIP: ${slug} (too small)`); return; }

  const key = `artwork/collection-hero-${slug}.jpg`;
  await R2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: 'image/jpeg',
  }));
  const url = `${process.env.R2_PUBLIC_URL}/${key}`;

  await db.collection('collections').updateOne(
    { slug },
    { $set: {
      hero_image: url,
      hero_image_attribution: {
        title: obj.title, artist: obj.artistDisplayName || 'Unknown',
        date: obj.objectDate, museum: 'The Metropolitan Museum of Art',
        accession: obj.accessionNumber, object_id: obj.objectID, license: 'CC0',
      },
      updated_at: new Date(),
    }}
  );
  console.log(`[${slug}] "${obj.title?.slice(0, 50)}" (${obj.objectDate}) -> SET`);
  await new Promise(r => setTimeout(r, 500));
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  await setFromMet(db, 'illuminated-manuscripts', 470309); // Hours of Jeanne d'Evreux
  await setFromMet(db, 'sacred-objects', 472562);           // Fieschi Morgan Staurotheke
  await setFromMet(db, 'kepler-fludd-debate', 204716);     // Armillary sphere dish
  await setFromMet(db, 'nova-reperta', 659646);            // Nova Reperta title plate
  await setFromMet(db, 'newtons-other-science', 444408);   // Astrolabe
  await setFromMet(db, 'alchemical-emblem', 435904);       // Vanitas still life
  await setFromMet(db, 'robert-hooke-polymath', 188830);   // Curiosity cabinet
  await setFromMet(db, 'weapon-salve-controversy', 460129);// Apothecary jar
  await setFromMet(db, 'famous-women', 436986);            // Portrait of a Woman

  await client.close();
  console.log('\nDone — 9 duplicate images replaced');
}

main().catch(console.error);
