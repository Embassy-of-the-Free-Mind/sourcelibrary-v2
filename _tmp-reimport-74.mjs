import { MongoClient } from 'mongodb';

// Books to reimport with alternative IA identifiers to try
// Strategy: search IA for each, try multiple patterns, check image accessibility
const REIMPORT_LIST = [
  // Each entry: { title, author, language, year, ia_alternatives: [...], collections: [...] }
  // Will search IA API for more alternatives at runtime
];

async function checkImageAccess(iaId) {
  try {
    const url = `https://archive.org/download/${iaId}/page/n5_medium.jpg`;
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
    return resp.status < 400;
  } catch {
    return false;
  }
}

async function searchIA(query, rows = 10) {
  try {
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl=identifier,title,creator,date,mediatype&rows=${rows}&output=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.response?.docs || [];
  } catch {
    return [];
  }
}

async function findAccessibleEdition(searchQuery, excludeId) {
  const results = await searchIA(searchQuery);
  // Filter to texts only, exclude the blocked one
  const candidates = results.filter(r =>
    r.mediatype === 'texts' && r.identifier !== excludeId
  );

  // Check each for image access
  for (const candidate of candidates) {
    const accessible = await checkImageAccess(candidate.identifier);
    if (accessible) {
      return candidate;
    }
  }
  return null;
}

async function reimportBook(bookData, iaIdentifier) {
  const url = 'https://sourcelibrary.org/api/import/ia';
  const body = {
    ia_identifier: iaIdentifier,
    title: bookData.title,
    author: bookData.author,
    year: bookData.year || undefined,
    original_language: bookData.language,
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { success: false, error: data.error || `HTTP ${resp.status}` };
    }
    return { success: true, bookId: data.id || data.bookId, url: data.url };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function assignCollections(db, bookId, collections) {
  if (!collections?.length) return;
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { collections } }
  );
}

// The actual reimport list with search queries and metadata
const BOOKS = [
  {
    title: 'The Secret Teachings of All Ages',
    author: 'Manly P. Hall',
    language: 'English',
    year: 1928,
    originalIa: 'secretteachingso0000hall_b2g3',
    searchQuery: 'title:"secret teachings of all ages" AND creator:hall AND mediatype:texts',
    collections: ['magic', 'secret-societies'],
  },
  {
    title: 'The Book of the Dead',
    author: 'E.A. Wallis Budge',
    language: 'Egyptian',
    originalIa: 'bookofdead00bud',
    searchQuery: 'title:"book of the dead" AND creator:budge AND mediatype:texts',
    collections: ['sacred-texts'],
  },
  {
    title: 'The Book of the Dead: The Papyrus of Ani',
    author: 'E.A. Wallis Budge',
    language: 'Egyptian',
    originalIa: 'egyptianbookofde00erne_0',
    searchQuery: 'title:"papyrus of ani" AND creator:budge AND mediatype:texts',
    collections: ['sacred-texts'],
  },
  {
    title: 'The Book of Black Magic and of Pacts',
    author: 'Arthur Edward Waite',
    language: 'English',
    originalIa: 'bookofblackmagic0000wait',
    searchQuery: 'title:"book of black magic" AND creator:waite AND mediatype:texts',
    collections: ['magic', 'demonology'],
  },
  {
    title: 'The Book of Ceremonial Magic',
    author: 'Arthur Edward Waite',
    language: 'English',
    originalIa: 'bookofsacredmagi01waitiala',
    searchQuery: 'title:"ceremonial magic" AND creator:waite AND mediatype:texts',
    collections: ['magic'],
  },
  {
    title: 'Harmonia Macrocosmica',
    author: 'Andreas Cellarius',
    language: 'Latin',
    year: 1660,
    originalIa: 'andreas-cellarius-harmonia-macrocosmica-1660',
    searchQuery: 'title:"harmonia macrocosmica" AND mediatype:texts',
    collections: ['astrology', 'natural-philosophy', 'art-illustrated'],
  },
  {
    title: 'Kebra Nagast',
    author: 'E. A. Wallis Budge',
    language: 'Egyptian',
    originalIa: 'queenofshebahero0000unse',
    searchQuery: 'title:"kebra nagast" AND mediatype:texts',
    collections: ['sacred-texts', 'theology'],
  },
  {
    title: 'The Confucian Analects',
    author: 'Confucius / James Legge',
    language: 'Chinese',
    originalIa: 'confuciananalect00conf',
    searchQuery: 'title:"confucian analects" AND creator:legge AND mediatype:texts',
    collections: ['chinese-classics', 'classical-philosophy'],
  },
  {
    title: 'De Vitis Philosophorum',
    author: 'Diogenes Laertius',
    language: 'Greek',
    originalIa: 'diogenislaertiiv0000unse',
    searchQuery: 'title:"diogenis laertii" OR title:"lives of eminent philosophers" AND creator:diogenes AND mediatype:texts',
    collections: ['classical-philosophy'],
  },
  {
    title: 'Herodoti Historiae',
    author: 'Herodotus',
    language: 'Greek',
    originalIa: 'herodotihistoria0001hero',
    searchQuery: 'title:"herodoti historiae" OR title:"history of herodotus" AND mediatype:texts',
    collections: ['classical-philosophy', 'literature'],
  },
  {
    title: 'The Buddhism of Tibet, or Lamaism',
    author: 'L. Austine Waddell',
    language: 'English',
    originalIa: 'buddhismoftibeto00wadduoft',
    searchQuery: 'title:"buddhism of tibet" AND creator:waddell AND mediatype:texts',
    collections: ['indic-traditions', 'theology'],
  },
  {
    title: 'The Gods of Northern Buddhism',
    author: 'Alice Getty',
    language: 'English',
    originalIa: 'godsofnorthernbu00gettuoft',
    searchQuery: 'title:"gods of northern buddhism" AND mediatype:texts',
    collections: ['indic-traditions', 'theology'],
  },
  {
    title: 'Divine Love and Divine Wisdom',
    author: 'Emanuel Swedenborg',
    language: 'English',
    originalIa: 'divineloveanddi00sweduoft',
    searchQuery: 'title:"divine love" AND title:"divine wisdom" AND creator:swedenborg AND mediatype:texts',
    collections: ['theology', 'mysticism'],
  },
  {
    title: 'Conjugial Love',
    author: 'Emanuel Swedenborg',
    language: 'English',
    originalIa: 'conjugialloveaf00sweduoft',
    searchQuery: 'title:"conjugial love" AND creator:swedenborg AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'The Principia; or, The First Principles of Natural Things',
    author: 'Emanuel Swedenborg',
    language: 'Latin',
    originalIa: 'principiaorfirst00sweduoft',
    searchQuery: 'title:"principia" AND creator:swedenborg AND mediatype:texts',
    collections: ['natural-philosophy', 'theology'],
  },
  {
    title: 'The Soul, or Rational Psychology',
    author: 'Emanuel Swedenborg',
    language: 'English',
    originalIa: 'soulsorrational00sweduoft',
    searchQuery: 'title:"rational psychology" AND creator:swedenborg AND mediatype:texts',
    collections: ['theology', 'renaissance-philosophy'],
  },
  {
    title: 'The Book of the Thousand Nights and a Night, Vol. 1',
    author: 'Richard F. Burton',
    language: 'English',
    originalIa: 'thousandnightsni01burt',
    searchQuery: 'title:"thousand nights and a night" AND creator:burton AND mediatype:texts',
    collections: ['literature'],
  },
  {
    title: 'Process and Reality',
    author: 'Alfred North Whitehead',
    language: 'English',
    originalIa: 'processrealitygi00alfr',
    searchQuery: 'title:"process and reality" AND creator:whitehead AND mediatype:texts',
    collections: ['theology', 'classical-philosophy'],
  },
  {
    title: 'The Religious System of the Amazulu',
    author: 'Henry Callaway',
    language: 'English',
    originalIa: 'religioussystemo00calluoft',
    searchQuery: 'title:"religious system" AND title:"amazulu" AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'West African Studies',
    author: 'Mary Kingsley',
    language: 'English',
    originalIa: 'westafricanstudi00kinguoft',
    searchQuery: 'title:"west african studies" AND creator:kingsley AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'Ashanti',
    author: 'Robert Sutherland Rattray',
    language: 'English',
    originalIa: 'ashanti00rattuoft',
    searchQuery: 'title:"ashanti" AND creator:rattray AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'Religion and Art in Ashanti',
    author: 'Robert Sutherland Rattray',
    language: 'English',
    originalIa: 'religionartinash00rattuoft',
    searchQuery: 'title:"religion and art in ashanti" AND creator:rattray AND mediatype:texts',
    collections: ['theology', 'art-illustrated'],
  },
  {
    title: 'The Village Gods of South India',
    author: 'Henry Whitehead',
    language: 'English',
    originalIa: 'villagegodsofsou00whituoft',
    searchQuery: 'title:"village gods of south india" AND mediatype:texts',
    collections: ['indic-traditions', 'theology'],
  },
  {
    title: 'The Melanesians',
    author: 'Robert Henry Codrington',
    language: 'English',
    originalIa: 'melanesiansstudie00codr',
    searchQuery: 'title:"melanesians" AND creator:codrington AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'The Native Tribes of Central Australia',
    author: 'Baldwin Spencer and F. J. Gillen',
    language: 'English',
    originalIa: 'nativetribesofce00spen',
    searchQuery: 'title:"native tribes of central australia" AND mediatype:texts',
    collections: [],
  },
  {
    title: 'Hellenistic Mystery-Religions',
    author: 'Richard Reitzenstein',
    language: 'English',
    originalIa: 'hellenisticmyste0000reit',
    searchQuery: 'title:"hellenistic mystery" AND creator:reitzenstein AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'The Literature of the Ancient Egyptians',
    author: 'Adolf Erman',
    language: 'English',
    originalIa: 'literatureofanc00erma',
    searchQuery: 'title:"literature" AND title:"ancient egyptians" AND creator:erman AND mediatype:texts',
    collections: ['theology', 'sacred-texts'],
  },
  {
    title: 'The Kojiki: Records of Ancient Matters',
    author: 'Basil Hall Chamberlain',
    language: 'English',
    originalIa: 'TheKojikiBasilChamberlainTranslation',
    searchQuery: 'title:"kojiki" AND creator:chamberlain AND mediatype:texts',
    collections: ['indic-traditions'],
  },
  {
    title: "Tibet's Great Yogi Milarepa",
    author: 'W.Y. Evans-Wentz',
    language: 'English',
    originalIa: 'tibetsgreatyogim00kazi',
    searchQuery: 'title:"milarepa" AND creator:evans-wentz AND mediatype:texts',
    collections: ['indic-traditions', 'mysticism'],
  },
  {
    title: 'Epic Mythology',
    author: 'Edward Washburn Hopkins',
    language: 'English',
    originalIa: 'epicmythology00hopk',
    searchQuery: 'title:"epic mythology" AND creator:hopkins AND mediatype:texts',
    collections: ['classical-philosophy'],
  },
  {
    title: 'Music Explained as Science and Art',
    author: "Antoine Fabre d'Olivet",
    language: 'French',
    originalIa: 'musicexplainedas00fabr',
    searchQuery: 'title:"music explained" AND creator:olivet AND mediatype:texts',
    collections: ['mysticism'],
  },
  {
    title: 'On the Sensations of Tone',
    author: 'Hermann von Helmholtz',
    language: 'English',
    originalIa: 'onsensationsofto0000helm',
    searchQuery: 'title:"sensations of tone" AND creator:helmholtz AND mediatype:texts',
    collections: ['medicine'],
  },
  {
    title: 'Korean Folk Tales: Imps, Ghosts, and Fairies',
    author: 'Im Pang (tr. James Gale)',
    language: 'English',
    originalIa: 'koreanfolktalesi00impa',
    searchQuery: 'title:"korean folk tales" AND mediatype:texts',
    collections: ['literature', 'chinese-classics', 'demonology'],
  },
  {
    title: 'Sri Ramakrishna, the Great Master',
    author: 'Swami Saradananda',
    language: 'English',
    originalIa: 'sriramakrishnagr0000sara',
    searchQuery: 'title:"sri ramakrishna" AND title:"great master" AND mediatype:texts',
    collections: ['indic-traditions', 'mysticism'],
  },
  {
    title: 'A Prose English Translation of the Harivamsha',
    author: 'Manmatha Nath Dutt',
    language: 'Sanskrit',
    originalIa: 'AProseEnglishTranslationOfHarivamsh',
    searchQuery: 'title:"harivamsha" AND creator:dutt AND mediatype:texts',
    collections: ['indic-traditions', 'literature'],
  },
  {
    title: 'Zuni Fetishes',
    author: 'Frank Hamilton Cushing',
    language: 'English',
    originalIa: 'zuifetishes00cush',
    searchQuery: 'title:"zuni fetishes" AND creator:cushing AND mediatype:texts',
    collections: ['indic-traditions'],
  },
  {
    title: 'Algic Researches',
    author: 'Henry Rowe Schoolcraft',
    language: 'English',
    originalIa: 'algicresearchesc01scho',
    searchQuery: 'title:"algic researches" AND creator:schoolcraft AND mediatype:texts',
    collections: [],
  },
  {
    title: 'The Seven Valleys and The Four Valleys',
    author: "Bahá'u'lláh",
    language: 'English',
    originalIa: 'sevenvalleysfour0000baha',
    searchQuery: 'title:"seven valleys" AND title:"four valleys" AND mediatype:texts',
    collections: ['sacred-texts', 'theology'],
  },
  {
    title: 'Contra Scholarii pro Aristotele Obiectiones',
    author: 'George Gemistos Plethon',
    language: 'Greek',
    originalIa: 'georgiigemistipl0000gemi',
    searchQuery: 'title:"gemisti plethonis" OR creator:"gemistos" AND mediatype:texts',
    collections: [],
  },
  {
    title: 'Hayti, or the Black Republic',
    author: 'Spenser St. John',
    language: 'English',
    originalIa: 'haaborblackrepub00stjouoft',
    searchQuery: 'title:"hayti" AND title:"black republic" AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'Ancient Buddhism in Japan, Vol. 1',
    author: 'M.W. de Visser',
    language: 'English',
    originalIa: 'cu31924023416945',
    searchQuery: 'title:"ancient buddhism in japan" AND creator:visser AND mediatype:texts',
    collections: ['indic-traditions'],
  },
  {
    title: 'Recherches sur les superstitions en Chine, Part 1',
    author: 'Henri Doré',
    language: 'French',
    originalIa: 'recherchessurles01dorgoog',
    searchQuery: 'title:"superstitions en chine" AND creator:dore AND mediatype:texts',
    collections: ['chinese-classics'],
  },
  {
    title: 'The Sacred Formulas of the Cherokees',
    author: 'James Mooney',
    language: 'English',
    originalIa: 'thesacredformula24788gut',
    searchQuery: 'title:"sacred formulas" AND title:"cherokees" AND mediatype:texts',
    collections: ['magic', 'sacred-texts'],
  },
  // Atkinson books
  {
    title: 'The Art of Logical Thinking',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'theartoflogicalt41838gut',
    searchQuery: 'title:"art of logical thinking" AND creator:atkinson AND mediatype:texts',
    collections: ['renaissance-philosophy'],
  },
  {
    title: 'How to Read Human Nature',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'howtoreadhumanna41501gut',
    searchQuery: 'title:"how to read human nature" AND creator:atkinson AND mediatype:texts',
    collections: ['renaissance-philosophy'],
  },
  {
    title: 'Thought-Culture; or, Practical Mental Training',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'thoughtcultureor41519gut',
    searchQuery: 'title:"thought culture" AND creator:atkinson AND mediatype:texts',
    collections: ['mysticism'],
  },
  {
    title: 'Practical Psychomancy and Crystal Gazing',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'practicalpsychom43954gut',
    searchQuery: 'title:"practical psychomancy" AND creator:atkinson AND mediatype:texts',
    collections: ['magic', 'mysticism'],
  },
  {
    title: 'Practical Mental Influence',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'PracticalMentalInfluenceACourseOfLessonsOnMentalVibrations',
    searchQuery: 'title:"practical mental influence" AND creator:atkinson AND mediatype:texts',
    collections: ['mysticism'],
  },
  {
    title: 'Reincarnation and the Law of Karma',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'reincarnationand26364gut',
    searchQuery: 'title:"reincarnation" AND title:"law of karma" AND creator:atkinson AND mediatype:texts',
    collections: ['indic-traditions', 'mysticism'],
  },
  {
    title: 'The Secret of Success',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'TheSecretOfSuccess_201303',
    searchQuery: 'title:"secret of success" AND creator:atkinson AND mediatype:texts',
    collections: ['mysticism'],
  },
  {
    title: 'Mind and Body; or, Mental States and Physical Conditions',
    author: 'William Walker Atkinson',
    language: 'English',
    originalIa: 'mindandbodyormen44029gut',
    searchQuery: 'title:"mind and body" AND creator:atkinson AND mediatype:texts',
    collections: ['mysticism'],
  },
  {
    title: 'The Human Aura',
    author: 'Swami Panchadasi (William Walker Atkinson)',
    language: 'English',
    originalIa: 'human_aura_panchadasi',
    searchQuery: 'title:"human aura" AND (creator:panchadasi OR creator:atkinson) AND mediatype:texts',
    collections: ['mysticism', 'natural-philosophy'],
  },
  // Remaining theology
  {
    title: 'Indian Philosophy, Volume I',
    author: 'S. Radhakrishnan',
    language: 'English',
    originalIa: 'indianphilosophy0001sarv',
    searchQuery: 'title:"indian philosophy" AND creator:radhakrishnan AND mediatype:texts',
    collections: ['indic-traditions', 'classical-philosophy'],
  },
  {
    title: 'A History of Indian Philosophy, Volume 1',
    author: 'Surendranath Dasgupta',
    language: 'English',
    originalIa: 'historyofindianp0001dasg',
    searchQuery: 'title:"history of indian philosophy" AND creator:dasgupta AND mediatype:texts',
    collections: ['indic-traditions', 'classical-philosophy'],
  },
  {
    title: 'Samayasara, or The Nature of the Self',
    author: 'Kundakunda',
    language: 'Sanskrit',
    originalIa: 'samayasaraornatu0000kund',
    searchQuery: 'title:"samayasara" AND mediatype:texts',
    collections: ['indic-traditions', 'mysticism'],
  },
  {
    title: 'Samayasara: The Soul-Essence',
    author: 'Kundakunda',
    language: 'Sanskrit',
    originalIa: 'samayasarathesou0000kund',
    searchQuery: 'title:"samayasara" AND title:"soul" AND mediatype:texts',
    collections: ['indic-traditions', 'mysticism'],
  },
  {
    title: 'Der Jainismus: Eine indische Erlösungsreligion',
    author: 'Helmuth von Glasenapp',
    language: 'German',
    originalIa: 'isbn_3487006286',
    searchQuery: 'title:"jainismus" AND creator:glasenapp AND mediatype:texts',
    collections: ['indic-traditions', 'theology'],
  },
  {
    title: 'The Ethical and Political Works of Motse (Mozi)',
    author: 'Y.P. Mei',
    language: 'Chinese',
    originalIa: 'ethicalpolitical0000moti',
    searchQuery: 'title:"motse" OR title:"mozi" AND creator:mei AND mediatype:texts',
    collections: ['chinese-classics', 'classical-philosophy'],
  },
  {
    title: 'Economic Harmonies',
    author: 'Frédéric Bastiat',
    language: 'French',
    originalIa: 'economicharmonie00bast',
    searchQuery: 'title:"economic harmonies" AND creator:bastiat AND mediatype:texts',
    collections: ['renaissance-philosophy'],
  },
  {
    title: 'I Libri della Famiglia',
    author: 'Leon Battista Alberti',
    language: 'Italian',
    originalIa: 'ilibridellafamig00albe',
    searchQuery: 'title:"libri della famiglia" AND creator:alberti AND mediatype:texts',
    collections: ['renaissance-philosophy'],
  },
  {
    title: 'The Peoples of Southern Nigeria, Vol. 1',
    author: 'P. Amaury Talbot',
    language: 'English',
    originalIa: 'peopleofsouther01talb',
    searchQuery: 'title:"peoples of southern nigeria" AND creator:talbot AND mediatype:texts',
    collections: [],
  },
  {
    title: 'The Peoples of Southern Nigeria, Vol. 3',
    author: 'P. Amaury Talbot',
    language: 'English',
    originalIa: 'peopleofsouther03talb',
    searchQuery: 'title:"peoples of southern nigeria" AND creator:talbot AND mediatype:texts',
    collections: [],
  },
  // Armenian texts
  {
    title: 'De Deo (Refutation of Sects)',
    author: 'Eznik of Kolb',
    language: 'Armenian',
    originalIa: 'dedeo0000ezni',
    searchQuery: 'title:"de deo" AND creator:eznik AND mediatype:texts',
    collections: ['theology'],
  },
  {
    title: 'Speaking with God from the Depths of the Heart (Narek)',
    author: 'Gregory of Narek',
    language: 'Armenian',
    originalIa: 'speakingwithgodf0000grig',
    searchQuery: 'title:"narek" OR (title:"speaking with god" AND creator:gregory) AND mediatype:texts',
    collections: ['mysticism', 'theology'],
  },
  {
    title: 'Armenian Apocrypha Relating to Patriarchs and Prophets',
    author: 'Michael E. Stone',
    language: 'Armenian',
    originalIa: 'armenianapocryph0000unse',
    searchQuery: 'title:"armenian apocrypha" AND creator:stone AND mediatype:texts',
    collections: ['sacred-texts', 'theology'],
  },
  // Others
  {
    title: 'Old Georgian Gospels: Adysh Manuscript (897 AD)',
    author: 'Robert P. Blake (ed.)',
    language: 'Armenian',
    originalIa: 'oldgeorgianversi0000unse',
    searchQuery: 'title:"old georgian" AND title:"gospels" AND mediatype:texts',
    collections: ['theology', 'sacred-texts'],
  },
  {
    title: 'The Geneva Bible (1560, Facsimile)',
    author: 'William Whittingham et al.',
    language: 'English',
    originalIa: 'genevabiblefacsi0000unse',
    searchQuery: 'title:"geneva bible" AND mediatype:texts',
    collections: ['sacred-texts', 'theology'],
  },
  {
    title: 'Ofudesaki: The Tip of the Writing Brush',
    author: 'Nakayama Miki',
    language: 'Japanese',
    originalIa: 'ofudesakitipofwr0000unse',
    searchQuery: 'title:"ofudesaki" AND mediatype:texts',
    collections: ['sacred-texts', 'theology'],
  },
  {
    title: 'The Treatise on the Apostolic Tradition of St. Hippolytus',
    author: 'Hippolytus of Rome',
    language: 'Greek',
    originalIa: 'treatiseonaposto0000hipp',
    searchQuery: 'title:"apostolic tradition" AND creator:hippolytus AND mediatype:texts',
    collections: ['theology', 'sacred-texts'],
  },
  {
    title: 'The Book of the Thousand Nights and a Night, Vol. 5',
    author: 'Richard F. Burton',
    language: 'English',
    originalIa: 'thousandnightsni05burt',
    searchQuery: 'title:"thousand nights" AND creator:burton AND mediatype:texts',
    collections: ['literature'],
  },
  {
    title: 'The Book of the Thousand Nights and a Night, Vol. 6',
    author: 'Richard F. Burton',
    language: 'English',
    originalIa: 'thousandnightsni06burt',
    searchQuery: 'title:"thousand nights" AND creator:burton AND mediatype:texts',
    collections: ['literature'],
  },
  {
    title: 'Ancient Buddhism in Japan, Vol. 2',
    author: 'M.W. de Visser',
    language: 'English',
    originalIa: 'cu31924023416960',
    searchQuery: 'title:"ancient buddhism in japan" AND creator:visser AND mediatype:texts',
    collections: ['indic-traditions'],
  },
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const results = { found: [], notFound: [], imported: [], failed: [] };

  console.log(`Searching for alternative editions of ${BOOKS.length} books...\n`);

  // Phase 1: Find accessible alternatives
  for (let i = 0; i < BOOKS.length; i++) {
    const book = BOOKS[i];
    process.stdout.write(`[${i+1}/${BOOKS.length}] ${book.title.substring(0, 50)}... `);

    // Check if already reimported (search by title)
    const existing = await db.collection('books').findOne(
      { title: { $regex: new RegExp(book.title.substring(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
      { projection: { id: 1, title: 1, _id: 0 } }
    );
    if (existing) {
      console.log(`ALREADY EXISTS: ${existing.title.substring(0, 40)}`);
      continue;
    }

    const alt = await findAccessibleEdition(book.searchQuery, book.originalIa);
    if (alt) {
      console.log(`FOUND: ${alt.identifier}`);
      results.found.push({ ...book, altIa: alt.identifier, altTitle: alt.title });
    } else {
      console.log('NOT FOUND');
      results.notFound.push(book);
    }

    // Rate limit IA API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Search Results ===`);
  console.log(`Found alternatives: ${results.found.length}`);
  console.log(`Not found: ${results.notFound.length}`);

  // Phase 2: Import the ones we found
  if (results.found.length > 0) {
    console.log(`\n=== Importing ${results.found.length} books ===\n`);

    for (const book of results.found) {
      process.stdout.write(`Importing: ${book.title.substring(0, 50)} (${book.altIa})... `);

      const result = await reimportBook(book, book.altIa);
      if (result.success) {
        console.log(`OK (${result.bookId})`);
        // Assign collections
        if (book.collections?.length) {
          await assignCollections(db, result.bookId, book.collections);
        }
        results.imported.push({ ...book, bookId: result.bookId });
      } else {
        console.log(`FAILED: ${result.error}`);
        results.failed.push({ ...book, error: result.error });
      }

      // Rate limit imports
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n=== Final Results ===`);
  console.log(`Imported: ${results.imported.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Not found on IA: ${results.notFound.length}`);

  if (results.notFound.length > 0) {
    console.log(`\nBooks without alternatives (need manual search):`);
    for (const b of results.notFound) {
      console.log(`  - ${b.title} [${b.language}] (${b.originalIa})`);
    }
  }

  if (results.failed.length > 0) {
    console.log(`\nFailed imports:`);
    for (const b of results.failed) {
      console.log(`  - ${b.title}: ${b.error}`);
    }
  }

  await client.close();
}

main();
