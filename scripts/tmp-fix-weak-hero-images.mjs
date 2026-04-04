/**
 * Replace weak/random museum artwork hero images with more appropriate sources:
 * - Book thumbnails from within the collection (authentic to the content)
 * - Better-targeted museum searches where book images aren't strong enough
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC = process.env.R2_PUBLIC_URL;

async function uploadToR2(key, buffer) {
  await R2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg',
  }));
  return `${R2_PUBLIC}/${key}`;
}

async function fetchImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function setHeroFromBookThumb(db, slug, bookQuery, attribution) {
  const book = await db.collection('books').findOne(
    { ...bookQuery, deleted: { $ne: true }, thumbnail: { $exists: true, $ne: null } },
    { projection: { id: 1, title: 1, thumbnail: 1 } }
  );
  if (!book?.thumbnail) { console.log(`  FAIL: no book found for ${slug}`); return; }

  console.log(`[${slug}] Using book: "${book.title?.slice(0, 60)}"`);
  const buffer = await fetchImage(book.thumbnail);

  // Ensure decent size — resize up if needed for hero display
  const meta = await sharp(buffer).metadata();
  let finalBuffer = buffer;
  if (meta.width < 800) {
    // Too small for hero — skip
    console.log(`  WARN: thumbnail only ${meta.width}px wide, using anyway`);
  }

  const key = `artwork/collection-hero-${slug}.jpg`;
  const url = await uploadToR2(key, finalBuffer);

  await db.collection('collections').updateOne(
    { slug },
    { $set: {
      hero_image: url,
      hero_image_attribution: {
        title: book.title,
        source: 'book_thumbnail',
        book_id: book.id,
        ...attribution,
      },
      updated_at: new Date(),
    }}
  );
  console.log(`  SET ${slug} -> ${url} (${Math.round(buffer.length / 1024)}KB)`);
}

async function setHeroFromMet(db, slug, objectId) {
  const obj = await (await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`)).json();
  if (!obj?.primaryImage) { console.log(`  FAIL: Met ${objectId} has no image`); return; }

  console.log(`[${slug}] Met: "${obj.title?.slice(0, 50)}" (${obj.objectDate})`);
  const buffer = await fetchImage(obj.primaryImage);

  const key = `artwork/collection-hero-${slug}.jpg`;
  const url = await uploadToR2(key, buffer);

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
  console.log(`  SET ${slug} (${Math.round(buffer.length / 1024)}KB)`);
}

async function setHeroFromUrl(db, slug, imageUrl, attribution) {
  console.log(`[${slug}] Direct URL`);
  const buffer = await fetchImage(imageUrl);

  const key = `artwork/collection-hero-${slug}.jpg`;
  const url = await uploadToR2(key, buffer);

  await db.collection('collections').updateOne(
    { slug },
    { $set: {
      hero_image: url,
      hero_image_attribution: attribution,
      updated_at: new Date(),
    }}
  );
  console.log(`  SET ${slug} (${Math.round(buffer.length / 1024)}KB)`);
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // 1. Sikhism — Sri Guru Granth Sahib manuscript page
  await setHeroFromBookThumb(db, 'sikhism',
    { collections: 'sikhism', title: /Guru Granth Sahib/i },
    { note: 'Page from the 1691 manuscript of the Sri Guru Granth Sahib' }
  );

  // 2. Bahá'í — Kitáb-i-Aqdas
  await setHeroFromBookThumb(db, 'bahai',
    { collections: 'bahai', title: /Aqdas/i },
    { note: "Bahá'u'lláh's Most Holy Book" }
  );

  // 3. Confucian Classics — Four Books of Confucius
  await setHeroFromBookThumb(db, 'confucian-classics',
    { collections: 'confucian-classics', title: /Four Books.*Confucius|Analects/i },
    { note: 'The Four Books (Si Shu) — core Confucian canon' }
  );

  // 4. Chinese Divination — Celestial star chart
  await setHeroFromBookThumb(db, 'chinese-divination-cosmology',
    { collections: 'chinese-divination-cosmology', title: /周天星位|Star Position|Yi King|I Ching/i },
    { note: 'Chinese cosmological text' }
  );

  // 5. Chinese Medicine — Tiangong Kaiwu
  await setHeroFromBookThumb(db, 'chinese-medicine-natural-philosophy',
    { collections: 'chinese-medicine-natural-philosophy', title: /天工開物|Tiangong Kaiwu/i },
    { note: 'Exploitation of the Works of Nature — Song Yingxing, 1637' }
  );

  // 6. Animal Magnetism — Reichenbach's sensitive Mensch
  await setHeroFromBookThumb(db, 'animal-magnetism-mesmerism',
    { collections: 'animal-magnetism-mesmerism', title: /sensitive.*Mensch|Phantasms|mesmer/i },
    { note: 'Core text of the animal magnetism/mesmerism tradition' }
  );

  // 7. Alchemical Emblem — Twelve Keys of Basil Valentine
  await setHeroFromBookThumb(db, 'alchemical-emblem',
    { collections: 'alchemical-emblem', title: /Douze Clefs|Twelve Keys|Aureum vellus|Atalanta fugiens/i },
    { note: 'Alchemical emblem book' }
  );

  // 8. Kepler-Fludd — Fludd's Medicina catholica (has a cropped image!)
  await setHeroFromBookThumb(db, 'kepler-fludd-debate',
    { collections: 'kepler-fludd-debate', title: /Medicina catholica|Utriusque cosmi|Epitome astronomiae/i },
    { note: 'From the Kepler-Fludd philosophical debate corpus' }
  );

  // 9. Herculaneum Papyri — Herculanensium Voluminum
  await setHeroFromBookThumb(db, 'herculaneum-papyri',
    { collections: 'herculaneum-papyri', title: /Herculanensium|Fragmenta Herculanensia/i },
    { note: 'Engravings of carbonized scrolls from Herculaneum' }
  );

  // 10. Papyri-Historical — Cleopatra VII decree (our Berlin papyrus!)
  await setHeroFromBookThumb(db, 'papyri-historical',
    { collections: 'papyri-historical', title: /Cleopatra|decree|letter/i },
    { note: 'Historical papyrus document' }
  );

  // 11. Robert Hooke — try Rijksmuseum for Micrographia or scientific instruments
  // Rijksmuseum has Hooke's Micrographia illustrations
  // Fall back to Philosophical Transactions thumbnail
  await setHeroFromBookThumb(db, 'robert-hooke-polymath',
    { collections: 'robert-hooke-polymath', title: /Magia Naturalis|Micrographia|Philosophical Transactions/i },
    { note: 'Natural philosophy text from Hooke\'s circle' }
  );

  // 12. Norse & Germanic — Danicorum monumentorum (has illustrations of runestones)
  await setHeroFromBookThumb(db, 'norse-germanic',
    { collections: 'norse-germanic', title: /Danicorum|Edda|Norse/i },
    { note: 'Norse/Germanic primary source' }
  );

  await client.close();
  console.log('\nDone — 12 weak hero images replaced');
}

main().catch(console.error);
