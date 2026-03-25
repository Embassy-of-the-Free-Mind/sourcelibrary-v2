#!/usr/bin/env node
/**
 * Create visual art collections and assign artworks to them.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/create-art-collections.mjs
 */

import { MongoClient } from 'mongodb';

const COLLECTIONS = [
  {
    slug: 'ficinos-florence',
    name: "Ficino's Florence",
    subtitle: 'The visual world of the Platonic Academy',
    description: `The painters who worked in the orbit of Marsilio Ficino and the Medici. Botticelli's mythological paintings are visual translations of Ficino's Neoplatonic philosophy — beauty as the soul's path back to the divine. Fra Angelico painted the convent where the Academy met. Ghirlandaio, Filippino Lippi, and Piero di Cosimo filled Florentine churches and palaces with images shaped by the same intellectual currents.\n\nEvery painting here can be cross-referenced with the philosophical texts that inspired it — texts that Source Library translates into English for the first time.`,
    color: '#c9a86c',
    order: 1,
    artistMatch: ['Sandro Botticelli', 'Fra Angelico', 'Domenico Ghirlandaio', 'Filippino Lippi', 'Piero di Cosimo', 'Fra Filippo Lippi', 'Benozzo Gozzoli', 'Andrea del Verrocchio', 'Cosimo Rosselli', 'Domenico Veneziano'],
  },
  {
    slug: 'before-ficino',
    name: 'Before Ficino',
    subtitle: 'Florence when the Renaissance began',
    description: `The painters who came just before the Neoplatonic turn — what Florence looked like when Ficino was born. Masaccio invented perspective. Uccello was obsessed with geometry. Gentile da Fabriano brought International Gothic splendor. Andrea del Castagno painted warriors and scholars with a new, fierce naturalism.\n\nThese artists created the visual language that Botticelli and his generation would transform with Ficino's philosophy.`,
    color: '#8b9a7d',
    order: 2,
    artistMatch: ['Masaccio', 'Paolo Uccello', 'Gentile da Fabriano', 'Lorenzo Monaco', 'Andrea del Castagno', 'Alessio Baldovinetti'],
  },
  {
    slug: 'school-of-athens',
    name: 'The School of Athens',
    subtitle: 'Roman frescoes and the unity of knowledge',
    description: `Raphael's Vatican frescoes synthesize the entire classical and Neoplatonic philosophical tradition into a single visual program. The School of Athens depicts Plato, Aristotle, Pythagoras, and Plotinus — philosophers whose works Source Library translates. Perugino, Pinturicchio, and Signorelli painted alongside Raphael in the Vatican and across central Italy.\n\nPiero della Francesca and Mantegna brought mathematical precision and classical gravitas to painting — the visual equivalent of the humanist rediscovery of antiquity.`,
    color: '#7c5db5',
    order: 3,
    artistMatch: ['Raphael', 'Pietro Perugino', 'Pinturicchio', 'Piero della Francesca', 'Andrea Mantegna', 'Luca Signorelli', 'Melozzo da Forlì'],
  },
  {
    slug: 'haarlem-mannerists',
    name: 'Haarlem Mannerists',
    subtitle: 'The virtuoso printmakers of the Dutch golden age',
    description: `Hendrick Goltzius was the supreme virtuoso of the burin — his engravings achieve effects that seem impossible in metal. Jan Saenredam translated Goltzius's designs into prints that circulated across Europe. Cornelis Drebbel, also from the Haarlem circle, was an alchemist, inventor, and engraver who built a working submarine and a perpetual motion clock.\n\nTheir prints — mythological, allegorical, technical — represent the visual culture of the Dutch Republic at its most ambitious.`,
    color: '#9e4a3a',
    order: 4,
    artistMatch: ['Hendrick Goltzius', 'Hendrick Goltzius (after)', 'Jan Saenredam', 'Cornelis Drebbel'],
  },
  {
    slug: 'leonardo-drawings',
    name: 'Leonardo\'s Notebooks',
    subtitle: 'Drawings, studies, and inventions',
    description: `Leonardo da Vinci's drawings are where his mind is most visible — anatomical studies, engineering designs, botanical observations, grotesque faces, and compositional sketches for paintings. His notebooks embody the Renaissance ideal of the universal mind, moving fluidly between art and science, observation and imagination.\n\nFicino's contemporary and fellow member of the Medici circle, Leonardo represents the Neoplatonic conviction that understanding nature's forms is itself a spiritual practice.`,
    color: '#6b6560',
    order: 5,
    artistMatch: ['Leonardo da Vinci'],
  },
  {
    slug: 'the-visionary',
    name: 'The Visionary',
    subtitle: 'Art that sees beyond the material',
    description: `Hieronymus Bosch painted hell, paradise, and the grotesque transformations between them. El Greco dissolved solid form into mystical flame. William Blake engraved his own prophecies in illuminated books that fuse poetry and image. Michelangelo's Sistine ceiling maps the Neoplatonic journey from creation to judgment.\n\nThese artists share a conviction that visible reality is not the whole story — that art can reveal what lies beyond.`,
    color: '#4a3a6e',
    order: 6,
    artistMatch: ['Hieronymus Bosch', 'El Greco', 'William Blake', 'Michelangelo'],
  },
  {
    slug: 'hermetic-image',
    name: 'The Hermetic Image',
    subtitle: 'Visual language of the Western esoteric tradition',
    description: `Robert Fludd's cosmological diagrams, engraved by Matthäus Merian. Athanasius Kircher's encyclopedic illustrations spanning Egypt to China. Depictions of Hermes Trismegistus from medieval mosaics to Renaissance engravings. The Rosicrucian manifestos' symbolic imagery.\n\nThese images ARE the philosophical arguments — visual theology that cannot be fully translated into words. Many come from books already in Source Library.`,
    color: '#8b6914',
    order: 7,
    artistMatch: ['Robert Fludd', 'Athanasius Kircher'],
    categoryMatch: ['Hermes Trismegistus', 'Rosicrucianism'],
  },
  {
    slug: 'emblems-great-work',
    name: 'Emblems & the Great Work',
    subtitle: 'Alchemical imagery as philosophical argument',
    description: `Michael Maier's Atalanta Fugiens — 50 emblems combining image, motto, and music to guide the alchemical practitioner. The Splendor Solis — illuminated plates depicting the stages of the Great Work in stunning color. Heinrich Khunrath's Amphitheatrum Sapientiae Aeternae — the alchemist's laboratory as temple.\n\nIn these works, the image is not illustration but instruction. Each emblem encodes a stage of the opus — the transformation of matter and soul.`,
    color: '#c9a86c',
    order: 8,
    artistMatch: ['Michael Maier', 'Splendor Solis', 'Heinrich Khunrath'],
    categoryMatch: ['Emblemata', 'Alchemical symbols'],
  },
  {
    slug: 'alchemists-studio',
    name: "The Alchemist's Studio",
    subtitle: 'Genre paintings of alchemists at work',
    description: `David Teniers the Younger painted the alchemist's laboratory dozens of times — cluttered tables, smoking furnaces, scattered manuscripts, the practitioner hunched over his work. These genre scenes document the material reality of alchemical practice in the 17th century, oscillating between sympathetic portraiture and gentle satire.\n\nThey are the visual complement to the theoretical texts Source Library translates.`,
    color: '#7a5c3a',
    order: 9,
    artistMatch: ['David Teniers the Younger'],
    categoryMatch: ['Alchemists in art'],
  },
  {
    slug: 'rudolf-prague',
    name: "Rudolf II's Prague",
    subtitle: "The occult emperor's court",
    description: `Rudolf II, Holy Roman Emperor, assembled the most extraordinary court in Europe — Arcimboldo painted composite heads from fruits and books, Spranger created Mannerist mythologies of extreme elegance, Hoefnagel documented nature with microscopic precision, and Sadeler engraved it all for circulation.\n\nThis was the court where John Dee and Edward Kelley performed angelic conversations, where Kepler calculated planetary orbits, where the boundaries between science, art, and magic did not exist.`,
    color: '#5a3a7a',
    order: 10,
    artistMatch: ['Giuseppe Arcimboldo', 'Bartholomeus Spranger', 'Hans von Aachen', 'Joris Hoefnagel', 'Aegidius Sadeler', 'Various (Rudolf II court)'],
  },
  {
    slug: 'the-cosmos',
    name: 'The Cosmos',
    subtitle: 'The Renaissance picture of the universe',
    description: `Armillary spheres, celestial globes, zodiac imagery, and Dürer's celestial maps. These objects and images represent the Renaissance understanding of cosmic order — concentric spheres, planetary influences, zodiacal signs, and the music of the heavens.\n\nThis is the visual cosmology that Ficino, Agrippa, and Fludd wrote about — and that Source Library's texts describe in detail.`,
    color: '#1a3a5a',
    order: 11,
    categoryMatch: ['Zodiac in art', 'Armillary spheres', 'Celestial globes', 'Mantegna Tarocchi'],
  },
  {
    slug: 'memento-mori',
    name: 'Memento Mori',
    subtitle: 'Remember that you will die',
    description: `Holbein's Dance of Death — woodcuts showing Death claiming pope and peasant alike. Vanitas still lifes with skulls, hourglasses, and guttering candles. The ever-present awareness of mortality that drove the search for the philosopher's stone, the elixir of life, the transmutation of the perishable into the eternal.\n\nThese images are the visual counterpart to the ars moriendi tradition and the alchemical quest for immortality.`,
    color: '#3a3a3a',
    order: 12,
    artistMatch: ['Hans Holbein the Younger'],
  },
  {
    slug: 'portraits-tradition',
    name: 'Portraits of the Tradition',
    subtitle: 'The faces of the prisca theologia',
    description: `John Dee, Edward Kelley, Paracelsus — engraved portraits of the figures whose texts Source Library translates. When you read Dee's Monas Hieroglyphica, see the man who wrote it. When you read Paracelsus on the diseases of miners, see the physician who descended into the shafts.`,
    color: '#6b5a4a',
    order: 13,
    categoryMatch: ['John Dee', 'Edward Kelley', 'Paracelsus'],
  },
  {
    slug: 'classical-mysteries',
    name: 'The Classical Mysteries',
    subtitle: 'Orpheus, Psyche, and the gods of transformation',
    description: `Orpheus descends to the underworld and returns — the original katabasis. Psyche's trials lead to union with Eros — the soul's journey to the divine, as Apuleius tells it. Circe transforms men with her pharmakeia. Prometheus steals fire from the gods.\n\nThese myths are not decorative — they are the narrative theology of the ancient mystery traditions. Every Renaissance Neoplatonist read them as allegories of spiritual transformation. Ficino translated the Orphic Hymns. Apuleius's Golden Ass encodes an Isiac initiation. The paintings here visualize the same philosophical arguments Source Library's texts make in words.`,
    color: '#6a4e8a',
    order: 14,
  },
  {
    slug: 'kabbalah-sacred-geometry',
    name: 'Kabbalah & Sacred Geometry',
    subtitle: 'The architecture of the invisible',
    description: `The Tree of Life — ten sephirot mapped onto the body of God and the structure of creation. The vesica piscis, the ouroboros, the labyrinth. Diagrams that claim to show the hidden geometry of reality.\n\nThese images circulated alongside the Kabbalistic and Hermetic texts Source Library translates — visual arguments for a cosmos built on number, proportion, and sacred pattern.`,
    color: '#2a4a6a',
    order: 15,
  },
  {
    slug: 'medieval-illuminations',
    name: 'Medieval Illuminations',
    subtitle: 'Cosmic visions from the manuscript tradition',
    description: `Hildegard von Bingen's fiery cosmic egg. The Voynich manuscript's undeciphered botanical and astronomical diagrams. The Hortus Deliciarum's encyclopedic illustrations. The Liber Floridus's mappae mundi and cosmological wheels.\n\nBefore print, knowledge was transmitted through hand-painted manuscripts where image and text were inseparable. These illuminations are not illustrations — they are the arguments themselves, visual theology painted in gold leaf and lapis lazuli.`,
    color: '#8a5a2a',
    order: 16,
    artistMatch: ['Hildegard von Bingen', 'Lambert of Saint-Omer', 'Herrad of Landsberg'],
  },
  {
    slug: 'esoteric-engravers',
    name: 'The Esoteric Engravers',
    subtitle: 'Masters of the printed image',
    description: `Matthäus Merian engraved the plates for Fludd's Utriusque Cosmi and Maier's Atalanta Fugiens — the two most important illustrated esoteric books of the 17th century. Wenzel Hollar documented everything from shells to cathedrals with exquisite precision. Jacques Callot's Temptation of St Anthony is a visionary fever dream in copper.\n\nThese engravers gave physical form to the ideas in the texts Source Library translates. Without Merian, Fludd's cosmology would have no image. Without Sadeler, Rudolf II's court would be invisible.`,
    color: '#5a4a3a',
    order: 17,
    artistMatch: ['Matthäus Merian', 'Wenzel Hollar', 'Jacques Callot', 'Aegidius Sadeler'],
  },
  {
    slug: 'art-of-altdorfer-baldung',
    name: 'Witchcraft & the Uncanny',
    subtitle: 'The dark side of the Renaissance',
    description: `Hans Baldung Grien's witches fly and conjure. Altdorfer's forests glow with supernatural light. Grünewald's Isenheim Altarpiece shows Christ's body in extremis and the Resurrection as pure radiance.\n\nThese artists explored what lay outside the classical order — the nocturnal, the chthonic, the ecstatic. Their work is the visual equivalent of the magical and demonological texts in Source Library's collection.`,
    color: '#3a4a3a',
    order: 18,
    artistMatch: ['Hans Baldung Grien', 'Albrecht Altdorfer', 'Matthias Grünewald'],
  },
  {
    slug: 'venetian-mystery',
    name: 'The Venetian Mystery',
    subtitle: 'Color, light, and enigma',
    description: `Giorgione's Tempesta remains unexplained after five centuries. Titian's sacred and profane love invites Neoplatonic readings. Caravaggio's chiaroscuro makes divine intervention look like a streetlight.\n\nThe Venetian tradition privileged color over line, sensation over intellect — a different path to the same mysteries the Florentine Neoplatonists pursued through philosophy.`,
    color: '#4a2a1a',
    order: 19,
    artistMatch: ['Giorgione', 'Caravaggio', 'Titian', 'Giovanni Bellini', 'Paolo Veronese'],
  },
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const collections = db.collection('collections');
  const books = db.collection('books');

  for (const col of COLLECTIONS) {
    console.log(`\n━━━ ${col.name} ━━━`);

    // Build match query for artworks
    const orConditions = [];
    if (col.artistMatch?.length) {
      orConditions.push({ author: { $in: col.artistMatch }, resource_type: { $exists: true } });
    }
    if (col.categoryMatch?.length) {
      orConditions.push({ harvest_category: { $in: col.categoryMatch }, resource_type: { $exists: true } });
    }
    // Fallback: also match commons_categories
    if (col.categoryMatch?.length) {
      orConditions.push({ commons_categories: { $in: col.categoryMatch }, resource_type: { $exists: true } });
    }
    // NOTE: Title/regex matching removed — use classify-artworks-gemini.mjs for collection assignment

    const query = orConditions.length === 1 ? orConditions[0] : { $or: orConditions };
    const matchingArtworks = await books.find(query, { projection: { id: 1, slug: 1, thumbnail: 1, thumbnail_blob: 1 } }).toArray();
    console.log(`  ${matchingArtworks.length} artworks match`);

    if (matchingArtworks.length === 0) {
      console.log(`  Skipping — no artworks yet (will be populated when import reaches these categories)`);
    }

    // Add collection slug to each matching artwork's collections array
    if (matchingArtworks.length > 0) {
      const result = await books.updateMany(
        { _id: { $in: matchingArtworks.map(a => a._id) } },
        { $addToSet: { collections: col.slug } }
      );
      console.log(`  Tagged ${result.modifiedCount} artworks with collection '${col.slug}'`);
    }

    // Get featured images for the collection (top 4 artworks by... whatever looks good)
    const featured = matchingArtworks.slice(0, 4).map(a => ({
      extracted_url: a.thumbnail_blob || a.thumbnail,
      thumbnail_url: a.thumbnail,
    }));

    // Upsert the collection document
    await collections.updateOne(
      { slug: col.slug },
      {
        $set: {
          slug: col.slug,
          name: col.name,
          subtitle: col.subtitle,
          description: col.description,
          color: col.color,
          order: col.order,
          book_count: matchingArtworks.length,
          featured_images: featured,
          collection_type: 'visual_art',
          updated_at: new Date(),
        },
        $setOnInsert: {
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(`  Collection '${col.slug}' upserted`);
  }

  // Summary
  const totalCollections = await collections.countDocuments({ collection_type: 'visual_art' });
  const totalTagged = await books.countDocuments({ resource_type: { $exists: true }, collections: { $exists: true, $ne: [] } });
  console.log(`\n━━━ DONE ━━━`);
  console.log(`${totalCollections} art collections created`);
  console.log(`${totalTagged} artworks assigned to collections`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
