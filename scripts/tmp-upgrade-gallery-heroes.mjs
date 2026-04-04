/**
 * Upgrade 50 collections from gallery-crop hero images to proper museum artwork
 * or high-quality book thumbnails. Uses Met + Cleveland CC0 APIs.
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/tmp-upgrade-gallery-heroes.mjs
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

// slug -> { met: objectId } or { query: "search terms" } or { book: regex for title }
// Curated picks based on collection themes
const UPGRADES = {
  // Major collections
  'chinese-classics': { book: /四書|Four Books|Analects|論語/ },
  'courts-of-wonder': { met: 436532 }, // "The Unicorn in Captivity" — Cloisters tapestry
  'sumerian-mesopotamian': { met: 327523 }, // "Cylinder seal and modern impression: bull-man combating lion"
  'music-of-the-spheres': { met: 436576 }, // "Allegory of Music" — Laurent de La Hyre
  'bestiary-tradition': { met: 471882 }, // "The Unicorn Defends Himself" tapestry
  'forbidden-books': { met: 337492 }, // "Index Librorum Prohibitorum" era — try book burning
  'women-of-the-secret-tradition': { met: 437397 }, // "The Sorceress" — Dosso Dossi
  'rosicrucian-moment': { book: /Fama Fraternitatis|Chemical Wedding|Rosicruc/ },
  'maps-of-the-invisible': { book: /Utriusque Cosmi|Cosmographia|Mundus Subterraneus|Kircher/ },
  'sympathy-of-all-things': { met: 436004 }, // Poussin landscape or similar
  'ficinos-circle': { met: 437430 }, // "Portrait of a Young Man" — Botticelli (Ficino's era)
  'ancient-greek-religion': { met: 255960 }, // "Marble column from the Temple of Artemis"
  'perennial-philosophy': { met: 437329 }, // "Saint Jerome in His Study" — van Eyck
  'agrippas-world': { book: /De Occulta Philosophia|Three Books.*Occult/ },
  'theatres-of-machines': { book: /Theatrum Machinarum|Diverse et Artificiose|Ramelli/ },
  'esoteric-capitalism': { book: /Ars Mercatoria|mercator|Summa de Arithmetica/ },
  'grimoire-tradition': { book: /Clavicula Salomonis|Key of Solomon|Lemegeton|Grimoire/ },
  'global-demonology': { met: 436573 }, // "The Temptation of Saint Anthony" — Schongauer
  'star-science': { book: /Astronomicum Caesareum|Harmonices Mundi|Almagest|Ptolem/ },
  'invention-of-method': { book: /Novum Organum|Discours de la méthode|Method/ },
  'art-of-memory': { book: /Ars Memorandi|Theatre of Memory|Giordano Bruno/ },
  'anatomical-revolution': { met: 337497 }, // Michelangelo "Studies for the Libyan Sibyl" — anatomy drawing
  'byzantine-bridge': { met: 466306 }, // Byzantine icon or mosaic
  'sacred-books-of-the-east': { book: /Sacred Books of the East|Rig Veda|Upanishad/ },
  'behmenist-underground': { book: /Aurora|Mysterium Magnum|Jacob Boehme|Böhme/ },
  'indigenous-traditions': { met: 316299 }, // Oceanic/indigenous artifact
  'renaissance-literary-imagination': { met: 437394 }, // "Calumny of Apelles" or literary painting
  'encyclopedists': { book: /Encyclopédie|Diderot|Ephraim Chambers/ },
  'ancient-engineering': { met: 551622 }, // Roman engineering artifact
  'islamic-philosophy-meets-christian-mysticism': { met: 446560 }, // "The Archangel Gabriel" — Islamic painting
  'manichaeism': { query: 'manichaean manuscript leaf painting fragment' },
  'chinese-astrology': { book: /星|astrology|celestial|天文/ },
  'dutch-golden-age-of-science': { met: 437880 }, // "The Geographer" or "Astronomer" — Vermeer
  'armenian-golden-age': { met: 447869 }, // Armenian manuscript page
  'celtic': { met: 464260 }, // Celtic brooch or manuscript
  'mining-metals-and-fire': { book: /De Re Metallica|Agricola|Pirotechnia|Biringuccio/ },
  'rhineland-mystics': { book: /Meister Eckhart|Tauler|Theologia Germanica|Suso/ },
  'ancient-egyptian': { met: 544890 }, // Book of the Dead papyrus
  'apocrypha': { met: 475514 }, // Apocryphal manuscript leaf
  'printing-press-revolution': { book: /Gutenberg|Psalterium|Biblia|42-line|Mainz/ },
  'ayurveda': { query: 'indian ayurveda herbal manuscript painting botanical' },
  'indian-mathematical-tradition': { query: 'indian astronomy mathematical manuscript diagram' },
  'making-things-visible': { book: /Perspectiva|optics|Kircher|Ars Magna/ },
  'confucianism': { book: /Confucius|Analects|Great Learning|中庸/ },
  'chinese-daoist-magic': { book: /道藏|Daoist|thunder|talisman|符/ },
  'orphism-mysteries': { met: 437153 }, // "Oedipus and the Sphinx" — Ingres (Greek mystery theme)
  'beguine-mystics': { met: 459052 }, // Medieval woman in devotion
  'shinto': { query: 'japanese shinto shrine torii painting' },
};

async function fetchMetObject(id) {
  const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
  return r.ok ? r.json() : null;
}

async function searchMet(query) {
  const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true&isPublicDomain=true`);
  if (!r.ok) return [];
  const d = await r.json();
  return d.objectIDs?.slice(0, 8) || [];
}

async function findMetArtwork(spec) {
  if (spec.met) {
    const obj = await fetchMetObject(spec.met);
    if (obj?.primaryImage && obj.isPublicDomain) return obj;
  }
  if (spec.query) {
    for (const id of await searchMet(spec.query)) {
      const obj = await fetchMetObject(id);
      if (obj?.primaryImage && obj.isPublicDomain) return obj;
      await new Promise(r => setTimeout(r, 150));
    }
  }
  return null;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  let upgraded = 0, bookSource = 0, metSource = 0, failed = 0;

  for (const [slug, spec] of Object.entries(UPGRADES)) {
    console.log(`\n[${slug}]`);

    try {
      let imageUrl, attribution;

      if (spec.book) {
        // Use book thumbnail from collection
        const book = await db.collection('books').findOne(
          { collections: slug, deleted: { $ne: true }, thumbnail: { $exists: true, $ne: null }, title: spec.book },
          { projection: { id: 1, title: 1, thumbnail: 1 } }
        );
        if (!book) {
          // Fallback: any book in collection
          const fallback = await db.collection('books').findOne(
            { collections: slug, deleted: { $ne: true }, thumbnail: { $exists: true, $ne: null } },
            { projection: { id: 1, title: 1, thumbnail: 1 } }
          );
          if (!fallback) { console.log('  FAIL: no books'); failed++; continue; }
          imageUrl = fallback.thumbnail;
          attribution = { title: fallback.title, source: 'book_thumbnail', book_id: fallback.id };
          console.log(`  Book (fallback): "${fallback.title?.slice(0, 50)}"`);
        } else {
          imageUrl = book.thumbnail;
          attribution = { title: book.title, source: 'book_thumbnail', book_id: book.id };
          console.log(`  Book: "${book.title?.slice(0, 50)}"`);
        }
        bookSource++;
      } else {
        // Use Met artwork
        const obj = await findMetArtwork(spec);
        if (!obj) { console.log('  FAIL: no Met artwork'); failed++; continue; }
        imageUrl = obj.primaryImage;
        attribution = {
          title: obj.title, artist: obj.artistDisplayName || 'Unknown',
          date: obj.objectDate, museum: 'The Metropolitan Museum of Art',
          accession: obj.accessionNumber, object_id: obj.objectID, license: 'CC0',
        };
        console.log(`  Met: "${obj.title?.slice(0, 50)}" (${obj.objectDate})`);
        metSource++;
      }

      // Download and upload
      const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) { console.log(`  FAIL: HTTP ${resp.status}`); failed++; continue; }
      const buffer = Buffer.from(await resp.arrayBuffer());

      const key = `artwork/collection-hero-${slug}.jpg`;
      await R2.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg',
      }));
      const r2Url = `${R2_PUBLIC}/${key}`;

      await db.collection('collections').updateOne(
        { slug },
        { $set: { hero_image: r2Url, hero_image_attribution: attribution, updated_at: new Date() } }
      );

      upgraded++;
      console.log(`  SET (${Math.round(buffer.length / 1024)}KB)`);
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Upgraded: ${upgraded} (${metSource} Met, ${bookSource} book)`);
  console.log(`Failed: ${failed}`);

  await client.close();
}

main().catch(console.error);
