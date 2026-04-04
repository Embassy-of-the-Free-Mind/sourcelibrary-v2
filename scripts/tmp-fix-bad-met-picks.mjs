/**
 * Fix ~26 bad Met artwork picks — replace with book thumbnails from within each collection.
 * These are all cases where the Met search returned something tangentially related at best.
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC = process.env.R2_PUBLIC_URL;

// slug -> regex to find the most representative book in the collection
const FIXES = {
  'courts-of-wonder': /Wunderkammer|Kunstkammer|Curiosit|Museum Wormianum|Imperato/,
  'sumerian-mesopotamian': /Gilgamesh|Enuma Elish|Epic of Creation|Code of Hammurabi/,
  'music-of-the-spheres': /Harmonices Mundi|Musurgia Universalis|Boethius.*Music|De Musica/,
  'bestiary-tradition': /Bestiar|Physiologus|Historia Animalium|Aldrovandi/,
  'forbidden-books': /Index.*Prohibitorum|Malleus Maleficarum|De Revolutionibus/,
  'women-of-the-secret-tradition': /Hildegard|Scivias|Julian.*Norwich|Marguerite Porete/,
  'sympathy-of-all-things': /De Sympathia|Magnetismo|Sympathia|Ficino.*De Vita/,
  'ficinos-circle': /Platonic Theology|De Vita|Marsilio Ficino|Theologia Platonica/,
  'ancient-greek-religion': /Orphic Hymns|Eleusinian|Iliad|Odyssey|Hesiod.*Theogony/,
  'perennial-philosophy': /Perennial|Philosophia Perennis|Steuco|De Perenni/,
  'global-demonology': /Compendium Maleficarum|Malleus|Demonolog|De Praestigiis/,
  'byzantine-bridge': /Hagia Sophia|Corpus Hermeticum|Plethon|Michael Psellus/,
  'ancient-engineering': /Vitruvius|De Architectura|Archimedes|Pneumatica|Hero of Alexandria/,
  'manichaeism': /Manichaean|Kephalaia|Psalm-Book|Coptic|Turfan/,
  'armenian-golden-age': /Armenian|Narek|Narekatsi|Mesrop|Mashtotz/,
  'celtic': /Book of Kells|Mabinogion|Leabhar Gabh|Lebor|Celtic/,
  'ancient-egyptian': /Book of the Dead|Papyrus of Ani|Pyramid Text|Egyptian/,
  'apocrypha': /Book of Enoch|Gospel of Thomas|Nag Hammadi|Apocryphon|Pseudepigrapha/,
  'ayurveda': /Sushruta|Charaka|Ayurveda|Materia Medica.*India/,
  'indian-mathematical-tradition': /Aryabhata|Brahmagupta|Lilavati|Surya Siddhanta|Indian.*Math/,
  'beguine-mystics': /Hadewijch|Mechthild|Flowing Light|Marguerite|Mirror.*Simple/,
  'dutch-golden-age-of-science': /Huygens|Leeuwenhoek|Stevin|Swammerdam|Biblia Naturae/,
  'indigenous-traditions': /Popol Vuh|Chilam Balam|Codex|Quetzalcoatl|Aztec/,
  'islamic-philosophy-meets-christian-mysticism': /Ibn Arabi|Avicenna|Averroes|Fusus al-Hikam|Hayy ibn Yaqzan/,
  'behmenist-underground': /Aurora|Mysterium Magnum|Böhme|Boehme|Signatura Rerum/,
  'sacred-books-of-the-east': /Bhagavad Gita|Upanishad|Rig Veda|Zend-Avesta|Dhammapada/,
};

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  let fixed = 0, failed = 0;

  for (const [slug, titleRegex] of Object.entries(FIXES)) {
    console.log(`[${slug}]`);

    // Find the best book matching the regex
    let book = await db.collection('books').findOne(
      { collections: slug, deleted: { $ne: true }, thumbnail: { $exists: true, $ne: null }, title: titleRegex },
      { projection: { id: 1, title: 1, thumbnail: 1 } }
    );

    // Fallback: largest book in collection (most pages = most important)
    if (!book) {
      book = await db.collection('books').findOne(
        { collections: slug, deleted: { $ne: true }, thumbnail: { $exists: true, $ne: null }, pages_count: { $gt: 50 } },
        { projection: { id: 1, title: 1, thumbnail: 1 }, sort: { pages_count: -1 } }
      );
    }
    if (!book) {
      book = await db.collection('books').findOne(
        { collections: slug, deleted: { $ne: true }, thumbnail: { $exists: true, $ne: null } },
        { projection: { id: 1, title: 1, thumbnail: 1 }, sort: { pages_count: -1 } }
      );
    }

    if (!book?.thumbnail) { console.log('  FAIL: no book found'); failed++; continue; }

    console.log(`  Book: "${book.title?.slice(0, 55)}"`);

    try {
      const resp = await fetch(book.thumbnail, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) { console.log(`  FAIL: HTTP ${resp.status}`); failed++; continue; }
      const buffer = Buffer.from(await resp.arrayBuffer());

      if (buffer.length < 5000) { console.log(`  WARN: only ${buffer.length}B — very small`); }

      const key = `artwork/collection-hero-${slug}.jpg`;
      await R2.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg',
      }));
      const url = `${R2_PUBLIC}/${key}`;

      await db.collection('collections').updateOne(
        { slug },
        { $set: {
          hero_image: url,
          hero_image_attribution: { title: book.title, source: 'book_thumbnail', book_id: book.id },
          updated_at: new Date(),
        }}
      );

      fixed++;
      console.log(`  SET (${Math.round(buffer.length / 1024)}KB)`);
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Fixed: ${fixed}, Failed: ${failed}`);

  await client.close();
}

main().catch(console.error);
