import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config({ path: '.env.production.local' });

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const SUB_COLLECTIONS = {
  magical_papyri: {
    slug: 'papyri-magical',
    name: 'Greek Magical Papyri',
    subtitle: 'Spells, amulets, and ritual handbooks from Greco-Roman Egypt',
    description: 'The physical papyrus fragments behind the famous Papyri Graecae Magicae (PGM) collection. Love spells, healing incantations, oracle questions, demon invocations, and protective amulets — written in Greek, Coptic, and Demotic between the 1st century BCE and 5th century CE. Many come from the legendary Theban Magical Library.',
    color: 'violet',
    order: 30.1,
  },
  literary_classical: {
    slug: 'papyri-literary',
    name: 'Literary Papyri',
    subtitle: 'Homer, Sappho, Euripides, and lost works on papyrus',
    description: 'Fragments of classical Greek literature preserved on papyrus in the sands of Egypt. Includes the oldest surviving Greek book roll (Timotheus, 4th c. BCE), fragments of Sappho, Euripides, Menander, and multiple Homer manuscripts — some used as school texts, others as luxury copies.',
    color: 'sage',
    order: 30.2,
  },
  historical_documentary: {
    slug: 'papyri-historical',
    name: 'Historical Documents',
    subtitle: 'Decrees, letters, and contracts from the ancient world',
    description: 'Original administrative documents, royal decrees, and private letters from Ptolemaic and Roman Egypt. Includes a decree bearing the signature of Cleopatra VII, speeches of Emperor Claudius, the oldest dated Greek text (310 BCE), and the famous letter of the soldier Apion to his father.',
    color: 'gold',
    order: 30.3,
  },
  christian: {
    slug: 'papyri-christian',
    name: 'Early Christian Papyri',
    subtitle: 'Hymns, amulets, and apocrypha from late antique Egypt',
    description: 'Christian texts on papyrus from the 4th-8th centuries CE — liturgical hymns, protective amulets inscribed with the Lord\'s Prayer, apocryphal dialogues between Jesus and Nathanael, and fragments of early church worship.',
    color: 'rust',
    order: 30.4,
  },
  philosophical: {
    slug: 'papyri-philosophical',
    name: 'Philosophical Papyri',
    subtitle: 'Plato, Stoics, and ancient commentary on papyrus',
    description: 'Fragments of philosophical texts preserved on papyrus — quotations from Plato\'s Philebus and Phaedrus, Stoic works by Hierocles, and Didymos\'s commentary on Demosthenes.',
    color: 'sage',
    order: 30.5,
  },
  homer_educational: {
    slug: 'papyri-school',
    name: 'School Papyri',
    subtitle: 'Ancient education through Homer glossaries and exercises',
    description: 'Papyri from ancient schools — Homer glossaries for students learning Greek, wax tablet scholia, and writing exercises. Direct evidence of how classical education worked in Greco-Roman Egypt.',
    color: 'gold',
    order: 30.6,
  },
};

async function downloadAndUploadImage(url, bookId, side) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    const ext = 'jpg';
    const key = `papyri/${bookId}/${side}.${ext}`;
    
    await R2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    }));
    
    return `${R2_PUBLIC_URL}/${key}`;
  } catch (e) {
    console.error(`  Failed to upload ${url}: ${e.message}`);
    return null;
  }
}

async function main() {
  const data = JSON.parse(
    (await import('fs')).readFileSync('scripts/output/berlin-papyri-pilot.json', 'utf8')
  );
  const items = data.items;
  
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  
  // 1. Create sub-collections
  console.log('=== Creating sub-collections ===\n');
  for (const [key, col] of Object.entries(SUB_COLLECTIONS)) {
    await db.collection('collections').updateOne(
      { slug: col.slug },
      {
        $set: {
          slug: col.slug,
          name: col.name,
          subtitle: col.subtitle,
          description: col.description,
          color: col.color,
          order: col.order,
          parent: 'ancient-papyri',
          type: 'curated',
          published: true,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    console.log(`  Created: ${col.slug} (parent: ancient-papyri)`);
  }
  
  // 2. Import each papyrus as a book entry
  console.log('\n=== Importing papyrus entries ===\n');
  let imported = 0, failed = 0;
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const subCol = SUB_COLLECTIONS[item.category];
    if (!subCol) {
      console.log(`  [${i+1}/${items.length}] SKIP: unknown category ${item.category}`);
      continue;
    }
    
    console.log(`[${i+1}/${items.length}] ${item.title}...`);
    
    // Check for duplicate
    const existing = await db.collection('books').findOne({
      $or: [
        { 'external_id': item.id },
        { title: item.title, author: 'Berlin Papyrus Collection' }
      ]
    });
    if (existing) {
      console.log(`  SKIP: already exists (${existing.id})`);
      continue;
    }
    
    // Download and upload images to R2
    const bookId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const uploadedImages = [];
    
    if (item.images) {
      for (const [side, img] of Object.entries(item.images)) {
        const url = img.original_url;
        if (!url) continue;
        console.log(`  Uploading ${side}...`);
        const r2Url = await downloadAndUploadImage(url, bookId, side);
        if (r2Url) {
          uploadedImages.push({
            side,
            url: r2Url,
            source_url: url,
            preview_url: img.preview_url,
          });
        }
      }
    }
    
    if (uploadedImages.length === 0) {
      console.log(`  SKIP: no images available`);
      failed++;
      continue;
    }
    
    // Create book entry
    const bookDoc = {
      id: bookId,
      title: item.title,
      display_title: item.title,
      author: 'Berlin Papyrus Collection',
      description: item.description,
      resource_type: 'papyrus_fragment',
      external_id: item.id,
      external_source: 'berlpap',
      external_url: item.item_url,
      
      // Metadata
      year: item.date,
      language: item.language || 'Greek',
      material: item.material,
      contributing_library: 'Ägyptisches Museum und Papyrussammlung, Staatliche Museen zu Berlin',
      provenance_location: item.provenance,
      inventory_number: item.inventory_number,

      // Catalog cross-references
      catalog_numbers: item.catalog_numbers,
      pgm_designation: item.pgm_designation,

      // Source tracking
      berlpap_url_id: item.url_id,
      berlpap_item_url: item.item_url,
      
      // Images
      thumbnail: uploadedImages[0].url,
      papyrus_images: uploadedImages.map(img => ({
        side: img.side,
        url: img.url,
        source_url: img.source_url,
      })),
      
      // Collection membership
      collections: ['ancient-papyri', subCol.slug],
      collection_primary: subCol.slug,
      
      // Visibility
      visible: true,
      pages_count: uploadedImages.length,
      
      // Provenance tracking
      field_provenance: {
        title: { source: 'berlpap', method: 'catalog', date: new Date().toISOString() },
        description: { source: 'berlpap', method: 'catalog', date: new Date().toISOString() },
        thumbnail: { source: 'berlpap', method: 'image_download', confidence: 1.0, date: new Date().toISOString() },
      },
      
      created_at: new Date(),
      updated_at: new Date(),
    };
    
    if (item.significance) {
      bookDoc.editorial_note = item.significance;
    }
    
    await db.collection('books').insertOne(bookDoc);
    imported++;
    console.log(`  OK: ${bookId} (${uploadedImages.length} images)`);
    
    // Brief delay to avoid hammering Berlin servers
    await new Promise(r => setTimeout(r, 500));
  }
  
  // 3. Update collection counts
  console.log('\n=== Updating collection counts ===\n');
  const allSlugs = ['ancient-papyri', ...Object.values(SUB_COLLECTIONS).map(c => c.slug)];
  for (const slug of allSlugs) {
    const count = await db.collection('books').countDocuments({
      collections: slug,
      deleted: { $ne: true },
      $or: [{ pages_count: { $gt: 0 } }, { resource_type: 'papyrus_fragment' }],
    });
    await db.collection('collections').updateOne(
      { slug },
      { $set: { book_count: count, updated_at: new Date() } }
    );
    console.log(`  ${slug}: ${count} items`);
  }
  
  await client.close();
  
  console.log(`\n=== DONE ===`);
  console.log(`Imported: ${imported}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${items.length - imported - failed}`);
}

main().catch(console.error);
