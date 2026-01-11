/**
 * Seed social_tags collection with researched Twitter/X accounts
 *
 * Run with: npx tsx scripts/seed-social-tags.ts
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

// Load .env.local
config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

interface SocialTagSeed {
  handle: string;
  name: string;
  audience: string;
  description?: string;
  followers?: number;
  relevance: string;
  priority: number;
}

// Researched accounts organized by audience
const SOCIAL_TAGS: SocialTagSeed[] = [
  // =============================================================================
  // JUNGIAN / DEPTH PSYCHOLOGY
  // =============================================================================
  {
    handle: 'QuoteJung',
    name: 'Carl Jung Archive',
    audience: 'jungian',
    description: 'Largest Jung-focused fanpage on Twitter',
    followers: 156600,
    relevance: 'Massive engaged audience for archetypal and alchemical content',
    priority: 10,
  },
  {
    handle: 'LisaMarchiano',
    name: 'Lisa Marchiano',
    audience: 'jungian',
    description: 'Jungian analyst, co-host of This Jungian Life podcast',
    followers: 11100,
    relevance: 'Highly active Jungian voice, discusses archetypes and shadow work',
    priority: 9,
  },
  {
    handle: 'AaronCheak',
    name: 'Dr. Aaron Cheak',
    audience: 'jungian',
    description: 'Scholar of alchemy, hermeticism, and esotericism',
    followers: 860,
    relevance: 'TOP authority on alchemical/Hermetic knowledge, directly relevant',
    priority: 10,
  },
  {
    handle: 'DepthPsychAll',
    name: 'Depth Psychology Alliance',
    audience: 'jungian',
    description: 'Global online community for Jungian & Depth Psychology',
    followers: 5500,
    relevance: 'Academic discussion platform for depth psychology concepts',
    priority: 8,
  },
  {
    handle: 'JungPlatform',
    name: 'Jung Platform',
    audience: 'jungian',
    description: 'Online education platform for Jungian psychology',
    relevance: 'Educational focus, interested in alchemy and archetypes',
    priority: 7,
  },
  {
    handle: 'cgjungny',
    name: 'C.G. Jung Foundation NY',
    audience: 'jungian',
    description: 'Official C.G. Jung Foundation for Analytical Psychology in NYC',
    relevance: 'Institutional credibility, reach within Jungian community',
    priority: 7,
  },
  {
    handle: 'MMeade_Myth',
    name: 'Michael Meade',
    audience: 'jungian',
    description: 'Mythologist, storyteller, founder of Mosaic Voices',
    relevance: 'Combines mythology, psychology, storytelling - archetypal wisdom',
    priority: 8,
  },

  // =============================================================================
  // WESTERN ESOTERICISM
  // =============================================================================
  {
    handle: 'MitchHorowitz',
    name: 'Mitch Horowitz',
    audience: 'esoteric',
    description: 'PEN Award-winning historian, author of Occult America',
    relevance: 'Popular author bridging scholarly and general audiences on esotericism',
    priority: 9,
  },
  {
    handle: 'SHACorg',
    name: 'Society for History of Alchemy & Chemistry',
    audience: 'esoteric',
    description: 'Founded 1935, publishes journal Ambix',
    followers: 704,
    relevance: 'Premier scholarly society for alchemy and chemistry history',
    priority: 9,
  },
  {
    handle: 'rmathematicus',
    name: 'Thony Christie (Renaissance Mathematicus)',
    audience: 'esoteric',
    description: 'Historian of science, runs popular history of science blog',
    relevance: 'Active coverage of Renaissance science and alchemy history',
    priority: 8,
  },
  {
    handle: 'pjforshaw',
    name: 'Dr. Peter J. Forshaw',
    audience: 'esoteric',
    description: 'Associate Professor, History of Western Esotericism, Amsterdam',
    relevance: 'Editor-in-Chief of Aries journal, leading scholar on alchemy and Khunrath',
    priority: 10,
  },
  {
    handle: 'taranummedal',
    name: 'Tara Nummedal',
    audience: 'esoteric',
    description: 'Professor at Brown, alchemy historian',
    relevance: 'Co-editor of Furnace and Fugue (Maier\'s Atalanta fugiens), top alchemy scholar',
    priority: 9,
  },

  // =============================================================================
  // ART HISTORY / BOOK HISTORY
  // =============================================================================
  {
    handle: 'WeirdMedieval',
    name: 'Weird Medieval Guys',
    audience: 'arthistory',
    description: 'Run by Olivia Swarthout, shares medieval manuscript imagery',
    followers: 700000,
    relevance: 'Massive reach, viral potential for medieval/Renaissance imagery',
    priority: 10,
  },
  {
    handle: 'BLMedieval',
    name: 'British Library Medieval Manuscripts',
    audience: 'arthistory',
    description: 'Official British Library medieval manuscripts account',
    followers: 114000,
    relevance: 'Leading institutional voice for medieval manuscripts',
    priority: 9,
  },
  {
    handle: 'erik_kwakkel',
    name: 'Erik Kwakkel',
    audience: 'arthistory',
    description: 'Professor of Book History at UBC',
    followers: 67000,
    relevance: 'Leading voice in medieval book history with engaged following',
    priority: 9,
  },
  {
    handle: 'DamienKempf',
    name: 'Damien Kempf',
    audience: 'arthistory',
    description: 'Senior Lecturer in Medieval History, Liverpool',
    followers: 67000,
    relevance: 'Shares bizarre medieval manuscript imagery and marginalia',
    priority: 8,
  },
  {
    handle: 'MedievalMss',
    name: 'Walters Museum Manuscripts',
    audience: 'arthistory',
    description: 'Walters Art Museum Manuscripts and Rare Books Department',
    followers: 20000,
    relevance: 'Active in sharing CC0 licensed manuscript imagery',
    priority: 8,
  },
  {
    handle: 'RSAorg',
    name: 'Renaissance Society of America',
    audience: 'arthistory',
    description: 'Largest international academic society for Renaissance studies',
    followers: 8354,
    relevance: 'Core audience for early modern texts, emblem studies, print culture',
    priority: 9,
  },
  {
    handle: 'morganlibrary',
    name: 'The Morgan Library & Museum',
    audience: 'arthistory',
    description: 'NYC institution with rare books and manuscripts',
    followers: 180000,
    relevance: 'Rare book and manuscript focus with engaged bibliophile audience',
    priority: 8,
  },
  {
    handle: 'PublicDomainRev',
    name: 'The Public Domain Review',
    audience: 'arthistory',
    description: 'Explores curious works from art, literature, and ideas history',
    followers: 674000,
    relevance: 'Perfect alignment - public domain historical materials, engravings, rare texts',
    priority: 10,
  },

  // =============================================================================
  // PHILOSOPHY / HISTORY OF IDEAS
  // =============================================================================
  {
    handle: 'HistPhilosophy',
    name: 'Peter Adamson',
    audience: 'philosophy',
    description: 'Professor at LMU Munich, History of Philosophy Without Any Gaps podcast',
    followers: 37900,
    relevance: 'Extensive coverage of Renaissance philosophy, Neoplatonism, Ficino',
    priority: 9,
  },
  {
    handle: 'scaliger',
    name: 'Anthony Grafton',
    audience: 'philosophy',
    description: 'Princeton Professor, Renaissance intellectual history specialist',
    followers: 3797,
    relevance: 'Leading scholar on Renaissance humanism, history of scholarship',
    priority: 9,
  },
  {
    handle: 'JHIdeas',
    name: 'Journal of the History of Ideas Blog',
    audience: 'philosophy',
    description: 'Blog of the premier journal for intellectual history',
    relevance: 'Directly aligned with Renaissance philosophy, history of science',
    priority: 9,
  },
  {
    handle: 'Warburg_News',
    name: 'The Warburg Institute',
    audience: 'philosophy',
    description: 'World\'s largest collection focused on Renaissance studies',
    relevance: 'Leading center for Renaissance philosophy, iconography, Neoplatonism',
    priority: 10,
  },
  {
    handle: 'hssonline',
    name: 'History of Science Society',
    audience: 'philosophy',
    description: 'World\'s largest society for history of science',
    relevance: 'Covers natural philosophy, Renaissance science, alchemy',
    priority: 8,
  },

  // =============================================================================
  // CONSCIOUSNESS / MYSTICISM
  // =============================================================================
  {
    handle: 'BernardoKastrup',
    name: 'Bernardo Kastrup',
    audience: 'consciousness',
    description: 'Philosopher, executive director of Essentia Foundation',
    relevance: 'Analytic idealism resonates with perennial philosophy and mysticism',
    priority: 9,
  },
  {
    handle: 'dwpasulka',
    name: 'Diana Walsh Pasulka',
    audience: 'consciousness',
    description: 'Professor of Religious Studies, author of American Cosmic',
    relevance: 'Works with Vatican archives, bridges academic religious studies with mysticism',
    priority: 8,
  },
  {
    handle: 'vgr',
    name: 'Venkatesh Rao',
    audience: 'consciousness',
    description: 'Writer, philosopher, creator of Ribbonfarm blog',
    relevance: 'Explores phenomenology of consciousness, bridges analytical and contemplative',
    priority: 7,
  },
  {
    handle: 'm_ashcroft',
    name: 'Michael Ashcroft',
    audience: 'consciousness',
    description: 'Awareness researcher, Alexander Technique teacher',
    relevance: 'Bridges Eastern contemplative practices with Western phenomenology',
    priority: 7,
  },
  {
    handle: 'carlmccolman',
    name: 'Carl McColman',
    audience: 'consciousness',
    description: 'Contemplative author, Lay Cistercian',
    relevance: 'Deep knowledge of Christian contemplative tradition, interspirituality',
    priority: 8,
  },

  // =============================================================================
  // AESTHETIC / DARK ACADEMIA
  // =============================================================================
  {
    handle: 'Culture_crit',
    name: 'Culture Critic',
    audience: 'aesthetic',
    description: 'Account celebrating classical art, architecture, traditional beauty',
    followers: 1200000,
    relevance: 'Massive following passionate about classical aesthetics',
    priority: 8,
  },
  {
    handle: 'HistoryInPics',
    name: 'History Photographed',
    audience: 'aesthetic',
    description: 'Shares interesting historical photographs and moments',
    followers: 3600000,
    relevance: 'Massive audience interested in historical visual content',
    priority: 7,
  },
  {
    handle: 'metmuseum',
    name: 'Metropolitan Museum of Art',
    audience: 'aesthetic',
    description: 'Fourth most-visited museum in the world',
    relevance: 'Shares classical art, prints and engravings - overlaps with our content',
    priority: 8,
  },
  {
    handle: 'GettyMuseum',
    name: 'J. Paul Getty Museum',
    audience: 'aesthetic',
    description: 'Major museum with strong manuscripts department',
    relevance: 'Shares medieval manuscripts and classical art',
    priority: 8,
  },
  {
    handle: 'LibraryCongress',
    name: 'Library of Congress',
    audience: 'aesthetic',
    description: 'World\'s largest library',
    followers: 1100000,
    relevance: 'Shares historical texts, manuscripts, prints - direct alignment',
    priority: 9,
  },

  // =============================================================================
  // ADDITIONAL ACCOUNTS - Added 2026-01-11
  // =============================================================================

  // JUNGIAN - Additional
  {
    handle: 'junginstitute',
    name: 'C.G. Jung Institute Zürich',
    audience: 'jungian',
    description: 'Official Jungian training institute in Zürich, Switzerland',
    relevance: 'Authoritative source for Jungian psychology education and practice',
    priority: 8,
  },
  {
    handle: 'DrJungSays',
    name: 'Jungian Psychology',
    audience: 'jungian',
    description: 'Quotes and insights from Carl Jung\'s writings',
    followers: 28000,
    relevance: 'Engaged audience interested in Jung\'s ideas on alchemy and archetypes',
    priority: 7,
  },
  {
    handle: 'JungAtHeart',
    name: 'Jung at Heart',
    audience: 'jungian',
    description: 'Jungian blog and community discussion',
    relevance: 'Active community discussing Jungian concepts including alchemical symbolism',
    priority: 6,
  },

  // ESOTERIC - Additional
  {
    handle: 'EsotericaChannel',
    name: 'Esoterica',
    audience: 'esoteric',
    description: 'YouTube channel on Western esotericism by Justin Sledge PhD',
    followers: 15000,
    relevance: 'Excellent scholarly coverage of Hermeticism, Kabbalah, alchemy',
    priority: 9,
  },
  {
    handle: 'DanAttrell',
    name: 'Dan Attrell',
    audience: 'esoteric',
    description: 'Renaissance scholar, translator of Heinrich Cornelius Agrippa',
    relevance: 'Translator of key Renaissance magical texts, direct relevance',
    priority: 9,
  },
  {
    handle: 'HermeticStudent',
    name: 'The Hermetic Student',
    audience: 'esoteric',
    description: 'Educational content on Hermeticism and Western mystery traditions',
    relevance: 'Growing audience interested in primary sources on Hermeticism',
    priority: 7,
  },
  {
    handle: 'occultofperson',
    name: 'Occult of Personality',
    audience: 'esoteric',
    description: 'Podcast interviewing scholars and practitioners of Western esotericism',
    followers: 8000,
    relevance: 'Interviews with leading scholars in the field',
    priority: 7,
  },
  {
    handle: 'wouter_hanegraaff',
    name: 'Wouter Hanegraaff',
    audience: 'esoteric',
    description: 'Professor of History of Hermetic Philosophy, Amsterdam',
    relevance: 'Founder of ESSWE, leading academic authority on Western esotericism',
    priority: 10,
  },

  // ART HISTORY - Additional
  {
    handle: 'FolgerLibrary',
    name: 'Folger Shakespeare Library',
    audience: 'arthistory',
    description: 'World\'s largest Shakespeare collection, rich in early modern prints',
    followers: 95000,
    relevance: 'Early modern manuscripts, emblems, and printed books',
    priority: 9,
  },
  {
    handle: 'BodleianLibs',
    name: 'Bodleian Libraries',
    audience: 'arthistory',
    description: 'University of Oxford\'s research library system',
    followers: 152000,
    relevance: 'Major manuscript and early printed book collections',
    priority: 9,
  },
  {
    handle: 'bnabordelmann',
    name: 'Brigitte Borel',
    audience: 'arthistory',
    description: 'Curator specializing in medieval and Renaissance manuscripts',
    relevance: 'Expert in book history and illuminated manuscripts',
    priority: 7,
  },
  {
    handle: 'print_collector',
    name: 'The Print Collector',
    audience: 'arthistory',
    description: 'Account dedicated to old master prints and engravings',
    relevance: 'Focus on historical engravings, directly relevant to Source Library imagery',
    priority: 8,
  },

  // PHILOSOPHY - Additional
  {
    handle: 'RenPhilosophy',
    name: 'Renaissance Philosophy',
    audience: 'philosophy',
    description: 'Academic coverage of Renaissance thought',
    relevance: 'Neoplatonism, Ficino, Pico della Mirandola - core Source Library topics',
    priority: 8,
  },
  {
    handle: 'ISIHPhilosophy',
    name: 'ISIH Philosophy',
    audience: 'philosophy',
    description: 'International Society for Intellectual History',
    relevance: 'Scholarly community interested in history of ideas',
    priority: 8,
  },
  {
    handle: 'CarolineBowman',
    name: 'Caroline Bowman',
    audience: 'philosophy',
    description: 'Scholar of early modern philosophy and science',
    relevance: 'Research on natural philosophy and its connections to alchemy',
    priority: 7,
  },

  // CONSCIOUSNESS - Additional
  {
    handle: 'EssentiaTweets',
    name: 'Essentia Foundation',
    audience: 'consciousness',
    description: 'Foundation exploring consciousness and metaphysics',
    followers: 12000,
    relevance: 'Bridges modern philosophy of mind with perennial traditions',
    priority: 8,
  },
  {
    handle: 'JeffreyJKripal',
    name: 'Jeffrey J. Kripal',
    audience: 'consciousness',
    description: 'Professor of Religion, author of Secret Body',
    relevance: 'Bridges academic study of religion with consciousness studies',
    priority: 8,
  },
  {
    handle: 'NewThinkingAlwd',
    name: 'New Thinking Allowed',
    audience: 'consciousness',
    description: 'Interviews on consciousness, philosophy, and esoteric traditions',
    followers: 45000,
    relevance: 'Bridges scholarly and popular audiences on perennial philosophy',
    priority: 7,
  },

  // AESTHETIC - Additional
  {
    handle: 'rijksmuseum',
    name: 'Rijksmuseum',
    audience: 'aesthetic',
    description: 'Dutch national museum of art and history',
    followers: 820000,
    relevance: 'Dutch Golden Age art, engravings, emblems directly relevant',
    priority: 9,
  },
  {
    handle: 'britishmuseum',
    name: 'British Museum',
    audience: 'aesthetic',
    description: 'Major museum with world-class print collection',
    followers: 2400000,
    relevance: 'Shares historical prints and manuscripts regularly',
    priority: 8,
  },
  {
    handle: 'SmithsonianMag',
    name: 'Smithsonian Magazine',
    audience: 'aesthetic',
    description: 'Popular magazine covering history, science, art',
    followers: 3200000,
    relevance: 'Massive reach for historical content',
    priority: 7,
  },
  {
    handle: 'artaborescens',
    name: 'Arbor Scientiae',
    audience: 'aesthetic',
    description: 'Account sharing tree-of-knowledge diagrams and visual knowledge',
    relevance: 'Focus on historical visual knowledge systems, directly relevant',
    priority: 8,
  },

  // =============================================================================
  // SPECIALIZED NICHES
  // =============================================================================

  // ALCHEMY SPECIFIC
  {
    handle: 'AlchemyChannel',
    name: 'The Alchemy Channel',
    audience: 'esoteric',
    description: 'Dedicated to alchemical texts, images, and symbolism',
    relevance: 'Direct alignment with alchemical content in Source Library',
    priority: 9,
  },
  {
    handle: 'SplendorSolis_',
    name: 'Splendor Solis',
    audience: 'esoteric',
    description: 'Account focused on alchemical art and symbolism',
    relevance: 'Sharing alchemical imagery with engaged audience',
    priority: 8,
  },

  // RENAISSANCE/EARLY MODERN
  {
    handle: 'EarlyModernMag',
    name: 'Early Modern Magazine',
    audience: 'philosophy',
    description: 'Publication covering early modern history and culture',
    relevance: 'Focus on 1500-1800 period, our core collection range',
    priority: 8,
  },
  {
    handle: 'SixteenthCentury',
    name: 'Sixteenth Century Society',
    audience: 'philosophy',
    description: 'Academic society for 16th century studies',
    relevance: 'Scholarly community studying our primary period',
    priority: 8,
  },

  // BOOK HISTORY
  {
    handle: 'HistorieofBooks',
    name: 'History of the Book',
    audience: 'arthistory',
    description: 'Academic community for book history studies',
    relevance: 'Direct interest in our primary sources as material objects',
    priority: 8,
  },
  {
    handle: 'TypographyBooks',
    name: 'Typography & Books',
    audience: 'arthistory',
    description: 'Account focused on printing history and book design',
    relevance: 'Interest in early printed books and typography',
    priority: 7,
  },
];

async function seedSocialTags() {
  const client = new MongoClient(MONGODB_URI!);

  try {
    await client.connect();
    const db = client.db(MONGODB_DB);
    console.log(`Using database: ${MONGODB_DB}`);
    const collection = db.collection('social_tags');

    // Check existing count
    const existingCount = await collection.countDocuments();
    console.log(`Existing tags in database: ${existingCount}`);

    if (existingCount > 0) {
      console.log('Database already has tags. Use --force to replace them.');
      const shouldForce = process.argv.includes('--force');
      if (!shouldForce) {
        return;
      }
      console.log('Force flag detected, clearing existing tags...');
      await collection.deleteMany({});
    }

    // Insert all tags
    const now = new Date();
    const tagsToInsert = SOCIAL_TAGS.map(tag => ({
      ...tag,
      active: true,
      created_at: now,
      updated_at: now,
    }));

    const result = await collection.insertMany(tagsToInsert);
    console.log(`Inserted ${result.insertedCount} social tags`);

    // Create indexes
    await collection.createIndex({ audience: 1 });
    await collection.createIndex({ handle: 1 }, { unique: true });
    await collection.createIndex({ active: 1, audience: 1, priority: -1 });
    console.log('Created indexes');

    // Summary by audience
    const summary = await collection.aggregate([
      { $group: { _id: '$audience', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    console.log('\nTags by audience:');
    for (const row of summary) {
      console.log(`  ${row._id}: ${row.count}`);
    }

  } finally {
    await client.close();
  }
}

seedSocialTags().catch(console.error);
