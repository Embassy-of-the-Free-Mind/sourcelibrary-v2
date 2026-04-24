/**
 * Prototype: Search-driven exhibition layout for Courts of Wonder
 *
 * This script writes a curated exhibition layout to the curation_drafts collection,
 * built from content discovered via MCP search tools (images, translations, quotes).
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const COLLECTION_SLUG = 'courts-of-wonder';

const layout = {
  collection_slug: COLLECTION_SLUG,
  status: 'draft',
  created_at: new Date(),
  method: 'search-driven-manual', // vs 'ai-generated' from curate-collection.mjs
  curation: {
    layout: [
      // 1. HOOK — the thesis
      {
        component: 'hook',
        text: 'Before there were museums, there were courts of wonder — places where a prince\'s power was measured not in armies but in astonishments.'
      },

      // 2. DESCRIPTION — expanded editorial
      {
        component: 'description',
        paragraphs: [
          'Rudolf II\'s Prague, James I\'s London, Frederick II\'s Sicily — these courts attracted alchemists, engineers, and natural philosophers the way Renaissance Florence attracted painters. The books in this collection are the artifacts those encounters produced: manuals for building singing automata, catalogs of mineral cabinets, treatises on monsters and marvels, and the occult philosophies that gave it all meaning.',
          'What unites them is a shared conviction that knowledge could be made spectacular. A hydraulic organ that mimicked birdsong was not mere entertainment — it was proof that the engineer understood nature\'s hidden mechanisms. A cabinet of rare stones was not a rich man\'s hobby — it was a microcosm, a world in miniature that demonstrated the collector\'s mastery of creation.',
          'These books let you enter those courts. You can read Hero of Alexandria\'s instructions for building a mechanical blackbird, or Bernard Palissy\'s plans for a grotto embedded with jaspers and crystals. You can browse Aldrovandi\'s catalog of prodigies, or study the Rosicrucian cosmology that Robert Fludd presented to King James. The wonder is still here — it just takes a different form now.'
        ]
      },

      // 3. QUOTES — primary source voices
      {
        component: 'quotes',
        items: [
          {
            text: 'I will make several rare stones embedded, that I will have brought from diverse lands and countries, such as Chalcedonies, Jaspers, Porphyries, Marbles, Crystals, and other pebbles rich and pleasant to the sight... without any polishing, and will be so well joined inside the incision that one will make in the said rock, that there will be no appearance of artifice, but it will seem that the said things have thus come from their own nature.',
            attribution: 'Bernard Palissy',
            source: 'A True Recipe (1563)',
            book_id: '69a683fe256d25f466059dc0',
            page: 73,
            url: 'https://sourcelibrary.org/q/BgzOduaOvwm78YCoGZV'
          },
          {
            text: 'No man will be found who will not be forced to confess them as true, after he has seen the things I have prepared in my cabinet, to satisfy all those who would not otherwise put faith in my writings.',
            attribution: 'Bernard Palissy',
            source: 'Admirable Discourses (1580)',
            book_id: '69a6827ed5bf106c72bb8d6f',
            page: 7,
            url: 'https://sourcelibrary.org/q/BgzO2XwUK7D3FNUuVnj'
          },
          {
            text: 'Use also another such construction for the sounding of a trumpet and the rendering of a blackbird\'s song; and again to construct the small automaton having all the pipes shortened within the base.',
            attribution: 'Hero of Alexandria',
            source: 'Pneumatica (c. 60 CE, in Corpus Hermeticum ms.)',
            book_id: '695230c6ab34727b1f044784',
            page: 136,
            url: 'https://sourcelibrary.org/q/BejFoukEepZzy8QxSzA'
          }
        ]
      },

      // 4. FEATURED IMAGE — Kircher's automaton
      {
        component: 'featured_image',
        image_url: 'https://images.sourcelibrary.org/archived/69520516ab34727b1f04245b/374.jpg',
        caption: 'A hydraulic musical automaton from Kircher\'s Musurgia Universalis (1650): a pinned cylinder, water wheel, and mechanical figures produce music in a grotto setting — the kind of marvel that princes commissioned to astonish their guests.',
        book_id: '69520516ab34727b1f04245b',
        page: 374,
        gallery_url: 'https://sourcelibrary.org/gallery/image/69520517ab34727b1f0425d1-0'
      },

      // 5. SECTIONS — thematic groupings discovered via search
      {
        component: 'sections',
        items: [
          {
            title: 'Mechanical Marvels',
            description: 'The engineering manuals behind courtly automata — singing birds, water organs, self-moving machines. These texts traveled from Hellenistic Alexandria through the Islamic golden age to Renaissance European courts.',
            period: '60 CE – 1725',
            books: [
              {
                book_id: '695230c6ab34727b1f044784',
                note: 'Hero of Alexandria\'s Pneumatica — the foundational text on automata, bound with the Corpus Hermeticum in this extraordinary manuscript'
              },
              {
                book_id: '69c1b7b68522835be8448dbb',
                note: 'Taqi al-Din\'s Sublime Methods in Spiritual Devices — Ottoman mechanical engineering at its peak'
              },
              {
                book_id: '695aa9a4be4023bd34bd6b7d',
                note: 'Hero\'s On Automata in Baldi\'s Italian translation — mechanics elevated to a mathematical discipline'
              },
              {
                book_id: '69a5b9eed76b98f272fcf668',
                note: 'Ramelli\'s Various and Ingenious Machines — 195 plates of devices dedicated to Henri III of France'
              },
              {
                book_id: '69a5f6cd1cf742c3604142ea',
                note: 'Schott\'s Hydraulic and Pneumatic Mechanics — water-powered dragons and mechanical spectacles'
              }
            ]
          },
          {
            title: 'Cabinets of Curiosity',
            description: 'The proto-museums where nature\'s wonders were collected, classified, and displayed. Minerals that grew in the earth\'s womb, fossils that defied explanation, monsters that challenged the boundary between natural and supernatural.',
            period: '1502 – 1655',
            books: [
              {
                book_id: '69a683fe256d25f466059dc0',
                note: 'Palissy\'s True Recipe — the potter-geologist designs a grotto cabinet with jaspers, crystals, and hidden water-spouts'
              },
              {
                book_id: '69a6827ed5bf106c72bb8d6f',
                note: 'Palissy\'s Admirable Discourses — "things I have drawn from the womb of the earth, which bear certain witness"'
              },
              {
                book_id: '6958e972813ea03889c33412',
                note: 'Aldrovandi\'s Musaeum Metallicum — minerals treated as living things gestating in the earth\'s viscera'
              },
              {
                book_id: '69b302f6118d89b507bc1d4f',
                note: 'Ole Worm\'s Museum — the Danish physician who demanded empirical observation over ancient authority'
              },
              {
                book_id: '69a5b9a2d76b98f272fcefd4',
                note: 'Gesner\'s Book on Fossil Objects — categorizing stones by their "resemblances" to celestial and natural forms'
              }
            ]
          },
          {
            title: 'Wonder Literature',
            description: 'Catalogs of marvels, prodigies, and monsters from Arabic, Greek, and Latin traditions. These books treated the world itself as a court of wonder — every creature, every anomaly, a sign to be read.',
            period: '350 BCE – 1667',
            books: [
              {
                book_id: '69908ad8285673ff8cb80bac',
                note: 'Al-Qazwini\'s Wonders of the Lands — curating the world as a "museum of divine intention"'
              },
              {
                book_id: '6953b56577f38f6761bd979d',
                note: 'The Book of Wonders — illustrated marvels from the Jalayirid court in Baghdad'
              },
              {
                book_id: '6958e96f813ea03889c33051',
                note: 'Aldrovandi\'s History of Monsters — from divine symmetry to the corruption of birth'
              },
              {
                book_id: '69b3014578de5de2306d4981',
                note: 'Antigonus\'s Collection of Wonderful Tales — ancient travelogue of impossible events'
              },
              {
                book_id: '69b3015078de5de2306d4b63',
                note: 'Phlegon\'s Book of Marvels — ghosts who return from the dead to warn generals'
              }
            ]
          },
          {
            title: 'Court Natural Philosophy',
            description: 'The occult philosophies, alchemical systems, and cosmological visions that princes patronized — not as entertainment, but as frameworks for understanding reality. These are the big theoretical works that gave the courts their intellectual architecture.',
            period: '1597 – 1667',
            books: [
              {
                book_id: '6de72244-de19-430f-803b-730baec31ca6',
                note: 'King James I\'s Daemonologie — the monarch as demonologist, personally defining the boundaries of the supernatural'
              },
              {
                book_id: '69af0a0838c4473825f1ae5f',
                note: 'Kircher\'s Magneticum Naturae Regnum — the magnetic sympathy that connects all things in nature'
              },
              {
                book_id: '697a3055a3866af9498458ac',
                note: 'Gaffarel\'s Unheard-of Curiosities — talismanic sculpture, signatures in nature, wood that mimics human forms'
              },
              {
                book_id: '69529492b184004c526a1963',
                note: 'Bacon\'s New Organon — deviating instances, nature\'s "monsters" as keys to understanding natural law'
              }
            ]
          }
        ]
      },

      // 6. FEATURED IMAGE — Aldrovandi's girl with hypertrichosis
      {
        component: 'featured_image',
        image_url: 'https://images.sourcelibrary.org/archived/6958e96f813ea03889c33051/32.jpg',
        caption: 'A girl with hypertrichosis, from Aldrovandi\'s History of Monsters (1642). She was exhibited at European courts as a "wonder" — the boundary between scientific curiosity and spectacle was the territory these courts inhabited.',
        book_id: '6958e96f813ea03889c33051',
        page: 32,
        gallery_url: 'https://sourcelibrary.org/gallery/image/6958e96f813ea03889c33071-0'
      },

      // 7. READING PATHS
      {
        component: 'reading_paths',
        items: [
          {
            title: 'The Engineer\'s Path',
            description: 'Follow the transmission of mechanical knowledge from Alexandria to the Ottoman and European courts',
            audience: 'Interested in how things work',
            books: [
              '695230c6ab34727b1f044784',  // Hero, Pneumatica
              '69c1b7b68522835be8448dbb',  // Taqi al-Din
              '69a5b9eed76b98f272fcf668',  // Ramelli
              '69a5f6cd1cf742c3604142ea',  // Schott
              '69520516ab34727b1f04245b'   // Kircher, Musurgia
            ]
          },
          {
            title: 'The Collector\'s Path',
            description: 'From Palissy\'s grottos to Ole Worm\'s museum — how the cabinet of curiosities became the modern museum',
            audience: 'Interested in natural history and collecting',
            books: [
              '69a683fe256d25f466059dc0',  // Palissy, True Recipe
              '69a5b9a2d76b98f272fcefd4',  // Gesner, Fossils
              '6958e972813ea03889c33412',  // Aldrovandi, Musaeum
              '69b302f6118d89b507bc1d4f',  // Ole Worm
              '69b51ed747b06ecd5819734d'   // Kircher, Mundus Subterraneus
            ]
          },
          {
            title: 'The Occultist\'s Path',
            description: 'The esoteric worldview behind the courts — from Dee\'s angel conversations to Fludd\'s cosmic diagrams',
            audience: 'Interested in philosophy and the occult',
            books: [
              '6de72244-de19-430f-803b-730baec31ca6', // James, Daemonologie
              '697a3055a3866af9498458ac',  // Gaffarel, Curiosities
              '69af0a0838c4473825f1ae5f',  // Kircher, Magneticum
              '69529492b184004c526a1963'   // Bacon, Novum Organum
            ]
          }
        ]
      },

      // 8. GALLERY GRID — thematic images
      {
        component: 'gallery_grid',
        title: 'Visual Treasury',
        images: [
          'https://images.sourcelibrary.org/archived/69520516ab34727b1f04245b/374.jpg',  // Kircher automaton
          'https://images.sourcelibrary.org/archived/69a5f6cd1cf742c36041443a/336.jpg',  // Schott dragon
          'https://images.sourcelibrary.org/archived/69906f5b4b3bd4d1fffd0739/59.jpg',   // Blue unicorn
          'https://images.sourcelibrary.org/archived/69a5e9fd787d6e9b8d42ea49/205.jpg',  // Alfonso X games
          'https://images.sourcelibrary.org/archived/6958e96f813ea03889c33051/32.jpg',   // Aldrovandi girl
          'https://images.sourcelibrary.org/archived/69527367ab34727b1f048f38/519.jpg',   // Kircher giant
          'https://images.sourcelibrary.org/archived/6958e96c813ea03889c32bf7/906.jpg',   // Dürer rhino
          'https://images.sourcelibrary.org/archived/6953b56577f38f6761bd979d/69.jpg',    // Book of Wonders demon
          'https://images.sourcelibrary.org/archived/695591547bd6d2cd1d618a62/154.jpg'    // Basilius alchemist
        ]
      },

      // 9. STATS
      {
        component: 'stats',
        items: [
          { label: 'Books', value: '663' },
          { label: 'Languages', value: '12' },
          { label: 'Earliest', value: '60 CE' },
          { label: 'Latest', value: '1725' }
        ]
      },

      // 10. TIMELINE
      {
        component: 'timeline',
        items: [
          { year: '60 CE', event: 'Hero of Alexandria writes the Pneumatica — the foundational text on automata and hydraulic marvels' },
          { year: 1240, event: 'The Bodleian Bestiary illustrates unicorns, dragons, and the natural wonders that medieval courts collected' },
          { year: 1283, event: 'Alfonso X commissions the Book of Games at his Castilian court' },
          { year: 1400, event: 'The Book of Wonders compiled at the Jalayirid court in Baghdad' },
          { year: 1563, event: 'Palissy publishes A True Recipe, describing his grotto cabinet with rare stones' },
          { year: 1588, event: 'Ramelli dedicates his 195 machine plates to Henri III of France' },
          { year: 1597, event: 'King James publishes Daemonologie, defining supernatural boundaries for his realm' },
          { year: 1617, event: 'Robert Fludd publishes his cosmic philosophy, Utriusque Cosmi Historia' },
          { year: 1642, event: 'Aldrovandi\'s History of Monsters catalogs prodigies exhibited at European courts' },
          { year: 1650, event: 'Kircher publishes Musurgia Universalis with diagrams of hydraulic musical automata' },
          { year: 1655, event: 'Ole Worm publishes his Museum catalog, demanding empirical observation over ancient authority' }
        ]
      }
    ]
  }
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Check for existing draft
  const existing = await db.collection('curation_drafts').findOne({ collection_slug: COLLECTION_SLUG });
  if (existing) {
    console.log('Existing draft found, replacing...');
    await db.collection('curation_drafts').deleteOne({ _id: existing._id });
  }

  await db.collection('curation_drafts').insertOne(layout);
  console.log('Exhibition layout saved to curation_drafts for', COLLECTION_SLUG);
  console.log('Components:', layout.curation.layout.map(b => b.component).join(', '));
  console.log('\nPreview at: https://sourcelibrary.org/collections/courts-of-wonder');

  await client.close();
}

main().catch(console.error);
