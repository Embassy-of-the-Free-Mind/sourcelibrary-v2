#!/usr/bin/env node
/**
 * Create sub-collection documents and classify books into them.
 * Pass 1: Rule-based (categories, language, author, year)
 * Pass 2: Gemini for unassigned books
 *
 * Usage:
 *   node scripts/create-subcollections.mjs [--parent alchemy] [--dry-run] [--gemini-only] [--skip-gemini]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const GEMINI_ONLY = args.includes('--gemini-only');
const SKIP_GEMINI = args.includes('--skip-gemini');
const parentFilter = args.find(a => a.startsWith('--parent='))?.split('=')[1]
  || (args.includes('--parent') ? args[args.indexOf('--parent') + 1] : null);

// ─── Sub-collection definitions ───

const SUBCOLLECTIONS = {
  alchemy: [
    { slug: 'paracelsian-medicine', name: 'Paracelsian Medicine', subtitle: 'Spagyric medicine, chemical remedies, and iatrochemistry in the tradition of Paracelsus' },
    { slug: 'rosicrucian-alchemy', name: 'Rosicrucian Alchemy', subtitle: 'The alchemical current within the Rosicrucian movement' },
    { slug: 'laboratory-chemistry', name: 'Laboratory Chemistry', subtitle: 'Alchemy transitioning toward empirical chemistry: assaying, distillation, early chymistry' },
    { slug: 'spiritual-alchemy', name: 'Spiritual Alchemy', subtitle: 'Alchemical allegory as inner transformation — emblem books, mystical chemistry' },
  ],
  'classical-philosophy': [
    { slug: 'platonic-tradition', name: 'Platonic Tradition', subtitle: "Plato's dialogues and the Platonic lineage through Ficino and the Florentine Academy" },
    { slug: 'neoplatonism', name: 'Neoplatonism', subtitle: 'Plotinus, Porphyry, Iamblichus, Proclus, and their commentators' },
    { slug: 'stoic-moral-philosophy', name: 'Stoic & Moral Philosophy', subtitle: 'Cicero, Seneca, Marcus Aurelius, Epictetus, and Renaissance moral philosophy' },
    { slug: 'aristotelian-tradition', name: 'Aristotelian Tradition', subtitle: "Aristotle's works and the vast commentary tradition from Averroes to Renaissance Scholasticism" },
  ],
  'natural-philosophy': [
    { slug: 'cosmology-astronomy', name: 'Cosmology & Astronomy', subtitle: 'From Ptolemy to Copernicus, Brahe, Kepler, and Galileo — the investigation of the heavens' },
    { slug: 'mathematics-harmony', name: 'Mathematics & Harmony', subtitle: 'The Pythagorean tradition of number, geometry, and music as keys to cosmic order' },
    { slug: 'natural-magic-sympathies', name: 'Natural Magic & Sympathies', subtitle: 'The theory of hidden virtues, sympathies, and natural powers in the created world' },
    { slug: 'geography-exploration', name: 'Geography & Exploration', subtitle: 'Cosmography, maps, travel accounts, and the science of place' },
    { slug: 'early-modern-science', name: 'Early Modern Science', subtitle: 'Mechanics, optics, experimental method — where observation began to displace ancient authority' },
  ],
  theology: [
    { slug: 'biblical-exegesis', name: 'Biblical Exegesis', subtitle: 'Commentaries, translations, and scholarly editions of scripture' },
    { slug: 'christian-mystical-theology', name: 'Christian Mystical Theology', subtitle: 'Theology as the experience of God — Eckhart, Ruysbroeck, John of the Cross' },
    { slug: 'philosophical-theology', name: 'Philosophical Theology', subtitle: 'Theology in dialogue with Platonic, Aristotelian, and Hermetic philosophy' },
    { slug: 'theosophical-tradition', name: 'Theosophical Tradition', subtitle: 'Boehme, Swedenborg, Saint-Martin, Blavatsky — the tradition of divine wisdom' },
    { slug: 'reformation-theology', name: 'Reformation Theology', subtitle: 'Luther, Calvin, and the Reformed tradition — confessions, catechisms, and systematic theology' },
  ],
  mysticism: [
    { slug: 'christian-mysticism-sub', name: 'Christian Mysticism', subtitle: 'Pseudo-Dionysius, Meister Eckhart, Teresa of Ávila, John of the Cross — the Western mystical tradition' },
    { slug: 'theosophical-occult', name: 'Theosophical & Occult', subtitle: 'Blavatsky, Steiner, Besant — the 19th-century synthesis of East and West' },
    { slug: 'german-speculative-mysticism', name: 'German Speculative Mysticism', subtitle: 'Jacob Boehme and the Protestant mystical underground — Weigel, Schwenckfeld, Eckartshausen' },
    { slug: 'jewish-kabbalistic-mysticism', name: 'Jewish & Kabbalistic Mysticism', subtitle: 'The Zohar, Sefer Yetzirah, Hasidic masters, and the scholarly study of Kabbalah' },
    { slug: 'sufi-eastern-mysticism', name: 'Sufi & Eastern Mysticism', subtitle: 'Rumi, Hafiz, Ibn Arabi — mystical traditions of the Islamic world and Asia' },
  ],
  hermetica: [
    { slug: 'corpus-hermeticum', name: 'Corpus Hermeticum', subtitle: "The primary Hermetic texts and their Renaissance commentators — Ficino's translation, the Asclepius" },
    { slug: 'rosicrucian-tradition', name: 'Rosicrucian Tradition', subtitle: 'Fama Fraternitatis, Fludd, Maier — the society that may or may not have existed' },
    { slug: 'paracelsian-hermetica', name: 'Paracelsian Hermetica', subtitle: "Paracelsus's Hermetic writings and the medical-mystical tradition he inspired" },
    { slug: 'hermetic-revival', name: 'Hermetic Revival', subtitle: "Freemasonry's Hermetic wing, Martinism, the occult revival of the 18th–19th centuries" },
  ],
  literature: [
    { slug: 'ancient-epic-drama', name: 'Ancient Epic & Drama', subtitle: 'Homer, Hesiod, the Greek tragedians, Virgil, Ovid — the foundations of Western literature' },
    { slug: 'renaissance-letters', name: 'Renaissance Letters & Humanism', subtitle: 'Petrarch, Boccaccio, humanist dialogues — the culture of the studia humanitatis' },
    { slug: 'oriental-classics', name: 'Oriental Classics in Translation', subtitle: 'Sanskrit epics, Persian poetry, Arabic literature reaching Western readers through translation' },
    { slug: 'history-political-thought', name: 'History & Political Thought', subtitle: 'Thucydides, Tacitus, Machiavelli — historical and political writing as literature' },
  ],
  medicine: [
    { slug: 'herbals-botany', name: 'Herbals & Botany', subtitle: 'Dioscorides, Fuchs, Culpeper — the botanical tradition linking medicine to the study of plants' },
    { slug: 'galenic-classical-medicine', name: 'Galenic & Classical Medicine', subtitle: 'Galen, Hippocrates, Avicenna — the foundational texts transmitted from antiquity' },
    { slug: 'paracelsian-iatrochemistry', name: 'Paracelsian & Iatrochemistry', subtitle: 'Chemical medicine, spagyrics — the Paracelsian revolution' },
    { slug: 'early-modern-medicine-sub', name: 'Early Modern Medicine', subtitle: 'Vesalius, Harvey, Sydenham — observation and experiment displacing ancient authority' },
  ],
  magic: [
    { slug: 'ritual-ceremonial-magic', name: 'Ritual & Ceremonial Magic', subtitle: 'Solomonic grimoires, Agrippa Book III, conjuration, spirit-working' },
    { slug: 'natural-magic-sub', name: 'Natural Magic', subtitle: "Della Porta's Magia Naturalis, Bacon's experimental program, the tradition of natural wonders" },
    { slug: 'divination-oracles', name: 'Divination & Oracles', subtitle: 'Geomancy, chiromancy, physiognomy, dream interpretation, lot books' },
  ],
  astrology: [
    { slug: 'jyotisha-indian-astrology', name: 'Jyotisha: Indian Astrology', subtitle: 'The Sanskrit astrological tradition — Brihat Parashara Hora Shastra, Varahamihira' },
    { slug: 'horoscopic-western-astrology', name: 'Horoscopic Astrology', subtitle: "Ptolemy's Tetrabiblos, Abu Ma'shar, Lilly — natal and horary astrology" },
    { slug: 'celestial-divination', name: 'Celestial Divination', subtitle: 'Omens, portents, cometary interpretation, mundane astrology, almanacs' },
  ],
  'chinese-classics': [
    { slug: 'confucian-classics', name: 'Confucian Classics', subtitle: 'The Five Classics, Four Books, and their vast commentary tradition — Confucius, Mencius, Zhu Xi, Wang Yangming' },
    { slug: 'daoist-classics', name: 'Daoist Classics', subtitle: 'Laozi, Zhuangzi, Daodejing commentaries, inner alchemy, and the Daoist canon' },
    { slug: 'chinese-buddhist-texts', name: 'Chinese Buddhist Texts', subtitle: 'Sutras in Chinese translation, Chan/Zen texts, Dunhuang manuscripts, and the Chinese Buddhist canon' },
    { slug: 'chinese-medicine-natural-philosophy', name: 'Chinese Medicine & Natural Philosophy', subtitle: 'Huangdi Neijing, Bencao Gangmu, materia medica, and traditional Chinese cosmology' },
    { slug: 'chinese-divination-cosmology', name: 'Chinese Divination & Cosmology', subtitle: 'Yi Jing and commentaries, feng shui, Chinese astrology, numerology, and cosmographic texts' },
    { slug: 'chinese-history-statecraft', name: 'Chinese History & Statecraft', subtitle: 'Dynastic histories, military strategy, political philosophy — Sun Tzu, Legalism, and the historiographic tradition' },
  ],
  'indic-traditions': [
    { slug: 'jyotisha-vedic-astrology', name: 'Jyotisha & Vedic Astrology', subtitle: 'Varahamihira, Parashara, Brihat Samhita — the Sanskrit astrological tradition and its vast commentarial literature' },
    { slug: 'vedanta-darshana', name: 'Vedanta & Darshana', subtitle: 'Shankaracharya, Ramanuja, the Brahma Sutras, and the six classical schools of Indian philosophy' },
    { slug: 'puranas-epics', name: 'Puranas & Epics', subtitle: 'The Mahabharata, Ramayana, Puranas, and the mythological literature of the Hindu tradition' },
    { slug: 'yoga-tantra-mysticism', name: 'Yoga, Tantra & Mysticism', subtitle: 'Patanjali, Hatha Yoga, Kundalini, tantric texts, and the experiential traditions of India' },
    { slug: 'indian-mathematics-astronomy', name: 'Indian Mathematics & Astronomy', subtitle: 'Aryabhata, Brahmagupta, Bhaskara — the mathematical and astronomical achievements of classical India' },
    { slug: 'indian-buddhist-jain', name: 'Buddhist & Jain Texts', subtitle: 'Pali canon, Mahayana sutras, Abhidharma, and Jain philosophical literature in the Indian context' },
  ],
  'islamic-philosophy': [
    { slug: 'falsafa', name: 'Falsafa', subtitle: 'Avicenna, Averroes, Al-Farabi, Al-Kindi — the Aristotelian philosophical tradition in the Islamic world' },
    { slug: 'sufism-islamic-mysticism', name: 'Sufism & Islamic Mysticism', subtitle: 'Ibn Arabi, Al-Ghazali, Al-Qushayri, Rumi — the inner path of Islam' },
    { slug: 'islamic-medicine-science', name: 'Islamic Medicine & Science', subtitle: 'The Canon of Medicine, optics, algebra — the golden age of Islamic natural philosophy' },
    { slug: 'islamic-occult-sciences', name: 'Islamic Occult Sciences', subtitle: 'Al-Buni, Jabir ibn Hayyan, astrology, alchemy, and the lettristic tradition' },
    { slug: 'judeo-islamic-philosophy', name: 'Judeo-Islamic Philosophy', subtitle: 'Maimonides, Judeo-Arabic texts, and the rich philosophical exchange between Jewish and Islamic thinkers' },
    { slug: 'quran-islamic-theology', name: 'Quran & Islamic Theology', subtitle: 'Quran editions, tafsir commentaries, kalam theology, and Islamic sacred texts' },
  ],
  'sumerian-mesopotamian': [
    { slug: 'royal-court-poetry', name: 'Royal & Court Poetry', subtitle: 'Hymns and praise poems for Sumerian and Babylonian kings — Šulgi, Išme-Dagan, Hammurabi, and the ideology of sacred kingship' },
    { slug: 'divine-hymns', name: 'Divine Hymns & Temple Songs', subtitle: 'Hymns to Enlil, Inana, Nanna, Enki, and the great gods — the liturgical poetry of Mesopotamian temples' },
    { slug: 'myths-epics', name: 'Myths & Epics', subtitle: 'Gilgamesh, Enmerkar, Lugalbanda, the Flood — the narrative imagination of the ancient Near East' },
    { slug: 'wisdom-debate-literature', name: 'Wisdom & Debate Literature', subtitle: 'Proverb collections, dialogues, disputations, and diatribes — the philosophical voice of Sumer' },
  ],
  'slavic-tradition': [
    { slug: 'russian-religious-philosophy', name: 'Russian Religious Philosophy', subtitle: 'Solovyov, Berdyaev, Bulgakov, Frank, Florensky — the great tradition of Russian philosophical theology' },
    { slug: 'russian-theosophy-occultism', name: 'Russian Theosophy & Occultism', subtitle: 'Blavatsky, Ouspensky, Gurdjieff — the Russian contribution to the Western esoteric tradition' },
    { slug: 'russian-literary-social-thought', name: 'Russian Literary & Social Thought', subtitle: 'Herzen, Chaadaev, Chernyshevsky, Lavrov — philosophy, criticism, and the Russian intelligentsia' },
    { slug: 'slavic-esoteric-translations', name: 'Slavic Esoteric Translations', subtitle: 'Western mystical and Masonic works in Russian translation — Eckartshausen, Saint-Martin, and the Masonic underground' },
  ],
};

// ─── Rule-based classification ───

function lc(s) { return (s || '').toLowerCase(); }
function hasCat(cats, ...targets) { return targets.some(t => cats.includes(t)); }
function authorMatch(author, ...patterns) {
  const a = lc(author);
  return patterns.some(p => a.includes(p));
}

const RULES = {
  alchemy: (b) => {
    const cats = (b.categories || []).map(lc);
    if (hasCat(cats, 'rosicrucianism')) return 'rosicrucian-alchemy';
    if (hasCat(cats, 'paracelsian') || authorMatch(b.author, 'paracels', 'helmont', 'croll'))
      return 'paracelsian-medicine';
    if (hasCat(cats, 'chemistry') && !hasCat(cats, 'hermeticism', 'mysticism'))
      return 'laboratory-chemistry';
    if (hasCat(cats, 'spiritual-alchemy', 'mysticism') || authorMatch(b.author, 'boehme', 'böhme'))
      return 'spiritual-alchemy';
    return null;
  },
  'classical-philosophy': (b) => {
    const cats = (b.categories || []).map(lc);
    const a = lc(b.author);
    if (a.includes('aristotl') || a.includes('averro') || hasCat(cats, 'aristotelianism', 'scholasticism'))
      return 'aristotelian-tradition';
    if (hasCat(cats, 'neoplatonism') || authorMatch(b.author, 'plotin', 'porphyr', 'iamblich', 'proclus'))
      return 'neoplatonism';
    if (hasCat(cats, 'florentine-platonism') || authorMatch(b.author, 'plato', 'ficino', 'pico'))
      return 'platonic-tradition';
    if (hasCat(cats, 'stoicism') || authorMatch(b.author, 'cicero', 'seneca', 'marcus aurelius', 'epictetus', 'xenophon'))
      return 'stoic-moral-philosophy';
    return null;
  },
  'natural-philosophy': (b) => {
    const cats = (b.categories || []).map(lc);
    if (hasCat(cats, 'astronomy', 'cosmology')) return 'cosmology-astronomy';
    if (hasCat(cats, 'mathematics', 'music')) return 'mathematics-harmony';
    if (hasCat(cats, 'geography', 'cartography')) return 'geography-exploration';
    if (hasCat(cats, 'natural-magic')) return 'natural-magic-sympathies';
    if ((b.year || 0) >= 1600 && !hasCat(cats, 'hermeticism', 'astrology', 'alchemy', 'natural-magic'))
      return 'early-modern-science';
    return null;
  },
  theology: (b) => {
    const cats = (b.categories || []).map(lc);
    if (hasCat(cats, 'biblical-studies', 'bible')) return 'biblical-exegesis';
    if (hasCat(cats, 'christian-mysticism')) return 'christian-mystical-theology';
    if (hasCat(cats, 'theosophy') || authorMatch(b.author, 'boehme', 'böhme', 'swedenborg', 'blavatsky', 'saint-martin'))
      return 'theosophical-tradition';
    if (hasCat(cats, 'neoplatonism', 'prisca-theologia', 'florentine-platonism'))
      return 'philosophical-theology';
    if (hasCat(cats, 'reformation', 'protestantism') || authorMatch(b.author, 'luther', 'calvin', 'melanchthon'))
      return 'reformation-theology';
    return null;
  },
  mysticism: (b) => {
    const cats = (b.categories || []).map(lc);
    const lang = lc(b.language);
    if (hasCat(cats, 'jewish-kabbalah') || lang === 'hebrew') return 'jewish-kabbalistic-mysticism';
    if (hasCat(cats, 'sufism', 'islamic-mysticism') || ['arabic', 'persian'].includes(lang))
      return 'sufi-eastern-mysticism';
    if (hasCat(cats, 'theosophy') && (b.year || 0) > 1800) return 'theosophical-occult';
    if (authorMatch(b.author, 'boehme', 'böhme', 'weigel', 'schwenckfeld', 'eckartshausen') || (lang === 'german' && hasCat(cats, 'christian-mysticism')))
      return 'german-speculative-mysticism';
    if (hasCat(cats, 'christian-mysticism')) return 'christian-mysticism-sub';
    return null;
  },
  hermetica: (b) => {
    const cats = (b.categories || []).map(lc);
    if (hasCat(cats, 'rosicrucianism')) return 'rosicrucian-tradition';
    if (hasCat(cats, 'paracelsian') || authorMatch(b.author, 'paracels', 'helmont'))
      return 'paracelsian-hermetica';
    if (hasCat(cats, 'prisca-theologia') || (hasCat(cats, 'hermeticism') && (b.year || 9999) < 1600 && !hasCat(cats, 'rosicrucianism', 'paracelsian')))
      return 'corpus-hermeticum';
    if ((b.year || 0) >= 1750 || hasCat(cats, 'freemasonry', 'theosophy'))
      return 'hermetic-revival';
    return null;
  },
  literature: (b) => {
    const cats = (b.categories || []).map(lc);
    const lang = lc(b.language);
    if (authorMatch(b.author, 'homer', 'hesiod', 'virgil', 'ovid', 'euripid', 'sophocl', 'aeschyl', 'aristophan'))
      return 'ancient-epic-drama';
    if (['greek', 'latin'].includes(lang) && (b.year || 9999) < 600) return 'ancient-epic-drama';
    if (hasCat(cats, 'history', 'politics') || authorMatch(b.author, 'thucydid', 'tacitus', 'machiavell', 'livy'))
      return 'history-political-thought';
    if (['sanskrit', 'arabic', 'persian', 'tamil', 'telugu', 'chinese'].includes(lang))
      return 'oriental-classics';
    if ((b.year || 0) >= 1350 && (b.year || 9999) <= 1600 && ['italian', 'latin'].includes(lang))
      return 'renaissance-letters';
    return null;
  },
  medicine: (b) => {
    const cats = (b.categories || []).map(lc);
    if (hasCat(cats, 'botany', 'herbalism')) return 'herbals-botany';
    if (hasCat(cats, 'paracelsian') || authorMatch(b.author, 'paracels', 'helmont'))
      return 'paracelsian-iatrochemistry';
    if (authorMatch(b.author, 'galen', 'hippocrat', 'avicenn', 'dioscorid') || ((b.year || 9999) < 1500 && !hasCat(cats, 'botany', 'paracelsian')))
      return 'galenic-classical-medicine';
    if ((b.year || 0) >= 1500 && !hasCat(cats, 'botany', 'herbalism', 'paracelsian', 'astrology'))
      return 'early-modern-medicine-sub';
    return null;
  },
  magic: (b) => {
    const cats = (b.categories || []).map(lc);
    if (hasCat(cats, 'divination')) return 'divination-oracles';
    if (hasCat(cats, 'ritual-magic', 'ceremonial-magic', 'goetia'))
      return 'ritual-ceremonial-magic';
    if (hasCat(cats, 'natural-magic')) return 'natural-magic-sub';
    return null;
  },
  astrology: (b) => {
    const lang = lc(b.language);
    if (['sanskrit', 'tamil', 'telugu', 'hindi'].includes(lang)) return 'jyotisha-indian-astrology';
    const cats = (b.categories || []).map(lc);
    if (hasCat(cats, 'divination') || lc(b.title).match(/almanac|prognosti|omen|portent|comet/))
      return 'celestial-divination';
    if ((b.year || 9999) < 1700 && ['latin', 'english', 'french', 'german', 'arabic', 'greek'].includes(lang))
      return 'horoscopic-western-astrology';
    return null;
  },
  'chinese-classics': (b) => {
    const cats = (b.categories || []).map(lc);
    const t = lc(b.title);
    const a = lc(b.author);
    // Daoism — check category and known authors/titles
    if (hasCat(cats, 'daoism') || t.includes('dao de jing') || t.includes('daodejing') || t.includes('tao te') || t.includes('taoism') || t.includes('taoist')
      || a.includes('laozi') || a.includes('lao tzu') || a.includes('zhuangzi') || a.includes('chuang tzu'))
      return 'daoist-classics';
    // Buddhism
    if (hasCat(cats, 'buddhism') || t.includes('sutra') || t.includes('dunhuang') || t.includes('pelliot')
      || t.includes('buddhis') || t.includes('chan ') || t.includes('zen '))
      return 'chinese-buddhist-texts';
    // Divination & cosmology — Yi Jing, astrology, divination
    if (hasCat(cats, 'divination', 'astrology') || t.includes('yi jing') || t.includes('i ching') || t.includes('yi king')
      || t.includes('hexagram') || t.includes('feng shui'))
      return 'chinese-divination-cosmology';
    // Medicine & natural philosophy
    if (hasCat(cats, 'medicine', 'botany') || t.includes('ben cao') || t.includes('bencao') || t.includes('materia medica')
      || t.includes('neijing') || t.includes('herbal'))
      return 'chinese-medicine-natural-philosophy';
    // Confucian — philosophy, politics, known authors
    if (a.includes('confuci') || a.includes('mencius') || a.includes('xunzi') || a.includes('hsüntze')
      || a.includes('zhu xi') || a.includes('wang yang') || t.includes('analects') || t.includes('confuci')
      || (hasCat(cats, 'philosophy') && hasCat(cats, 'politics')))
      return 'confucian-classics';
    // History & statecraft — military, history, politics, law
    if (hasCat(cats, 'military') || hasCat(cats, 'law')
      || (hasCat(cats, 'history') && hasCat(cats, 'politics'))
      || a.includes('sun tzu') || t.includes('art of war') || t.includes('book of lord shang'))
      return 'chinese-history-statecraft';
    return null;
  },
  'indic-traditions': (b) => {
    const cats = (b.categories || []).map(lc);
    const t = lc(b.title);
    const a = lc(b.author);
    const lang = lc(b.language);
    // Buddhist & Jain
    if (hasCat(cats, 'buddhism') || t.includes('sutra') || t.includes('buddhis') || t.includes('pali')
      || lang === 'ardhamagadhi prakrit' || t.includes('jain'))
      return 'indian-buddhist-jain';
    // Mathematics & Astronomy (before astrology — some overlap)
    if (hasCat(cats, 'mathematics') && !hasCat(cats, 'astrology'))
      return 'indian-mathematics-astronomy';
    if (a.includes('aryabhata') || a.includes('brahmagupta') || a.includes('bhaskara')
      || (hasCat(cats, 'astronomy') && !hasCat(cats, 'astrology', 'divination')))
      return 'indian-mathematics-astronomy';
    // Jyotisha & astrology
    if (hasCat(cats, 'astrology', 'divination') || t.includes('jyotish') || t.includes('hora ')
      || a.includes('varahamihira') || a.includes('parashara'))
      return 'jyotisha-vedic-astrology';
    // Yoga, Tantra & Mysticism
    if (hasCat(cats, 'theosophy') || t.includes('yoga') || t.includes('tantr') || t.includes('kundalini')
      || a.includes('ramacharaka') || a.includes('besant') || a.includes('vivekananda')
      || (hasCat(cats, 'mysticism') && !hasCat(cats, 'vedanta')))
      return 'yoga-tantra-mysticism';
    // Vedanta & Darshana
    if (hasCat(cats, 'vedanta') || a.includes('shankar') || a.includes('ramanuja')
      || t.includes('vedant') || t.includes('upanishad') || t.includes('brahma sutra')
      || (hasCat(cats, 'philosophy') && !hasCat(cats, 'history', 'politics')))
      return 'vedanta-darshana';
    // Puranas & Epics
    if (t.includes('purana') || t.includes('mahabharata') || t.includes('ramayana') || t.includes('harivam')
      || t.includes('bhagavad') || (hasCat(cats, 'theology') && hasCat(cats, 'literature')))
      return 'puranas-epics';
    if (hasCat(cats, 'theology') && !hasCat(cats, 'philosophy'))
      return 'puranas-epics';
    return null;
  },
  'islamic-philosophy': (b) => {
    const cats = (b.categories || []).map(lc);
    const t = lc(b.title);
    const a = lc(b.author);
    const lang = lc(b.language);
    // Sufism & Islamic Mysticism
    if (hasCat(cats, 'sufism') || t.includes('sufi') || a.includes('ibn arabi') || a.includes('al-qushayri')
      || a.includes('rumi') || t.includes('futuhat') || t.includes('awrad'))
      return 'sufism-islamic-mysticism';
    // Islamic Occult Sciences
    if (hasCat(cats, 'ritual-magic', 'divination') || a.includes('al-buni')
      || (hasCat(cats, 'alchemy') && !hasCat(cats, 'philosophy'))
      || (hasCat(cats, 'astrology') && !hasCat(cats, 'astronomy')))
      return 'islamic-occult-sciences';
    // Judeo-Islamic Philosophy — Hebrew/Judeo-Arabic language texts
    if (lang.includes('judeo-arabic') || lang.includes('hebrew')
      || a.includes('maimonid') || a.includes('gersonid') || a.includes('saadia'))
      return 'judeo-islamic-philosophy';
    // Islamic Medicine & Science
    if (hasCat(cats, 'medicine') || a.includes('avicenna') || a.includes('ibn sina')
      || t.includes('canon medicin') || hasCat(cats, 'natural-philosophy')
      || (hasCat(cats, 'astronomy') && hasCat(cats, 'mathematics')))
      return 'islamic-medicine-science';
    // Quran & Theology
    if (hasCat(cats, 'theology', 'biblical-studies') || t.includes('quran') || t.includes('qur\'an')
      || t.includes('koran') || t.includes('al-coranus') || t.includes('bible') || t.includes('tafsir'))
      return 'quran-islamic-theology';
    // Falsafa — general philosophy, neoplatonism
    if (hasCat(cats, 'philosophy', 'neoplatonism') || a.includes('averro') || a.includes('al-farabi')
      || a.includes('al-kindi') || a.includes('al-ghazali') || t.includes('aristotel'))
      return 'falsafa';
    return null;
  },
  'sumerian-mesopotamian': (b) => {
    const cats = (b.categories || []).map(lc);
    const t = lc(b.title);
    // Myths & Epics
    if (hasCat(cats, 'myths and epics', 'gilgameš') || t.includes('gilgamesh') || t.includes('gilgameš')
      || t.includes('enmerkar') || t.includes('lugalbanda') || t.includes('flood'))
      return 'myths-epics';
    // Wisdom & Debate
    if (hasCat(cats, 'wisdom and debate', 'proverb collections', 'diatribes')
      || t.includes('proverb') || t.includes('diatribe') || t.includes('debate') || t.includes('dispute'))
      return 'wisdom-debate-literature';
    // Royal & Court Poetry
    if (hasCat(cats, 'royal and court poetry', 'literary letters'))
      return 'royal-court-poetry';
    // Divine Hymns
    if (hasCat(cats, 'hymns and songs') || cats.some(c => c.includes('hymns'))
      || t.includes('hymn') || t.includes('lament') || t.includes('prayer'))
      return 'divine-hymns';
    return null;
  },
  'slavic-tradition': (b) => {
    const cats = (b.categories || []).map(lc);
    const t = lc(b.title);
    const a = lc(b.author);
    // Theosophy & Occultism — Blavatsky, Ouspensky
    if (hasCat(cats, 'theosophy') || a.includes('blavatsky') || a.includes('ouspensky')
      || a.includes('gurdjieff') || t.includes('theosophy') || t.includes('secret doctrine')
      || t.includes('isis unveiled') || t.includes('tertium organum'))
      return 'russian-theosophy-occultism';
    // Esoteric translations — identifiable by Cyrillic markers or known translators
    if (t.includes('cyrillisch') || t.includes('cyrillic') || hasCat(cats, 'freemasonry')
      || a.includes('eckartshausen') || a.includes('lopukhin') || a.includes('starck')
      || a.includes('saint-martin') || a.includes('köppen'))
      return 'slavic-esoteric-translations';
    // Religious Philosophy — Solovyov, Berdyaev, Bulgakov, Frank, Florensky, Khomyakov, Rozanov, Leontiev, Kireevsky, etc.
    if (a.includes('solovyov') || a.includes('soloviev') || a.includes('соловьёв') || a.includes('соловьев')
      || a.includes('berdyaev') || a.includes('бердяев')
      || a.includes('bulgakov') || a.includes('frank') || a.includes('зеньковский')
      || a.includes('florensky') || a.includes('florenskii')
      || a.includes('khomyakov') || a.includes('khomiakov') || a.includes('хомяков')
      || a.includes('trubetskoi') || a.includes('трубецкой')
      || a.includes('losev') || a.includes('lossky') || a.includes('лосский')
      || a.includes('shestov') || a.includes('шестов')
      || a.includes('rozanov') || a.includes('розанов')
      || a.includes('leontiev') || a.includes('леонтьев') || a.includes('леонтьевъ')
      || a.includes('kireevsky') || a.includes('киреевский') || a.includes('киреевскаго')
      || a.includes('aksakov') || a.includes('аксаков')
      || a.includes('karsavin') || a.includes('карсавин')
      || a.includes('struve') || a.includes('ern ')
      || a.includes('фёдоров') || a.includes('федоров')
      || a.includes('gershenzon') || a.includes('гершензон')
      || hasCat(cats, 'christian-mysticism') || (hasCat(cats, 'theology') && hasCat(cats, 'philosophy')))
      return 'russian-religious-philosophy';
    // Literary & Social Thought — novelists, poets, critics, political thinkers
    if (a.includes('herzen') || a.includes('герцен') || a.includes('chaadaev') || a.includes('чаадаев')
      || a.includes('chernyshevsky') || a.includes('чернышевский') || a.includes('чернышевскій')
      || a.includes('lavrov') || a.includes('лавров')
      || a.includes('merezhkovsky') || a.includes('мережковский') || a.includes('мережковскій')
      || a.includes('belinsky') || a.includes('белинский') || a.includes('белинскій')
      || a.includes('pushkin') || a.includes('пушкин')
      || a.includes('dostoevsk') || a.includes('достоевск')
      || a.includes('tolsto') || a.includes('толсто')
      || a.includes('turgenev') || a.includes('тургенев')
      || a.includes('chekhov') || a.includes('чехов')
      || a.includes('gogol') || a.includes('гоголь')
      || a.includes('lermontov') || a.includes('лермонтов')
      || a.includes('leskov') || a.includes('лесков') || a.includes('лѣсков')
      || a.includes('салтыков') || a.includes('щедрин')
      || a.includes('kropotkin') || a.includes('кропоткин')
      || a.includes('bakunin') || a.includes('бакунин')
      || a.includes('ostrovsky') || a.includes('островск')
      || a.includes('некрасов') || a.includes('nekrasov')
      || a.includes('добролюбов') || a.includes('dobrolyubov') || a.includes('добролюбовъ')
      || a.includes('писарев') || a.includes('pisarev')
      || a.includes('lomonosov') || a.includes('ломоносов')
      || a.includes('грибоедов') || a.includes('griboedov')
      || a.includes('державин') || a.includes('derzhavin')
      || a.includes('крылов') || a.includes('krylov')
      || a.includes('карамзин') || a.includes('karamzin')
      || a.includes('жуковский') || a.includes('жуковскаго') || a.includes('zhukovsk')
      || a.includes('гончаров') || a.includes('goncharov')
      || a.includes('фонвизин') || a.includes('fonvizin')
      || a.includes('радищев') || a.includes('radishchev')
      || a.includes('ленин') || a.includes('lenin')
      || a.includes('skovoroda') || a.includes('сковорода'))
      return 'russian-literary-social-thought';
    return null;
  },
};

// ─── Gemini classification ───

async function classifyWithGemini(ai, books, parentSlug, subcollections) {
  const subDescriptions = subcollections.map(s =>
    `- "${s.slug}": ${s.name} — ${s.subtitle}`
  ).join('\n');

  const results = [];
  const BATCH = 30;

  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const bookList = batch.map((b, idx) =>
      `${idx + 1}. "${b.display_title || b.title}" by ${b.author || 'Unknown'} (${b.year || '?'}, ${b.language || '?'}) [categories: ${(b.categories || []).join(', ') || 'none'}]`
    ).join('\n');

    const prompt = `You are classifying books in the "${parentSlug}" collection into sub-collections.

Sub-collections:
${subDescriptions}

For each book below, respond with ONLY the sub-collection slug, or "none" if it doesn't fit any well. One line per book, format: "NUMBER: SLUG"

Books:
${bookList}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });
      const text = response.text || '';
      const lines = text.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/^(\d+):\s*(\S+)/);
        if (match) {
          const idx = parseInt(match[1]) - 1;
          const slug = match[2].toLowerCase().replace(/"/g, '');
          if (idx >= 0 && idx < batch.length && slug !== 'none') {
            const validSlugs = subcollections.map(s => s.slug);
            if (validSlugs.includes(slug)) {
              results.push({ bookId: batch[idx].id, subSlug: slug });
            }
          }
        }
      }
    } catch (err) {
      console.error(`  Gemini batch error (offset ${i}):`, err.message);
    }

    // Rate limit
    if (i + BATCH < books.length) await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

// ─── Main ───

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');
  const ai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

  const parentsToProcess = parentFilter ? [parentFilter] : Object.keys(SUBCOLLECTIONS);
  let totalCreated = 0;
  let totalAssigned = 0;
  let totalGemini = 0;

  for (const parentSlug of parentsToProcess) {
    const subs = SUBCOLLECTIONS[parentSlug];
    if (!subs) { console.error(`No subcollections defined for: ${parentSlug}`); continue; }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${parentSlug.toUpperCase()}`);
    console.log(`${'═'.repeat(60)}`);

    // Ensure parent collection exists
    const parent = await db.collection('collections').findOne({ slug: parentSlug });
    if (!parent) { console.error(`  Parent collection not found: ${parentSlug}`); continue; }

    // Create sub-collection documents
    for (const sub of subs) {
      const exists = await db.collection('collections').findOne({ slug: sub.slug });
      if (exists) {
        console.log(`  [exists] ${sub.slug}`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  [dry-run] Would create: ${sub.slug}`);
      } else {
        await db.collection('collections').insertOne({
          slug: sub.slug,
          name: sub.name,
          subtitle: sub.subtitle,
          parent: parentSlug,
          book_count: 0,
          hidden: false,
          type: 'category',
          order: 0,
          languages: [],
          featured_images: [],
          created_at: new Date(),
        });
        console.log(`  [created] ${sub.slug}`);
        totalCreated++;
      }
    }

    // Fetch all books in parent collection
    const books = await db.collection('books').find(
      { collections: parentSlug, status: { $ne: 'deleted' }, hidden: { $ne: true } },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, categories: 1, collections: 1 } },
    ).toArray();
    console.log(`  ${books.length} books in ${parentSlug}`);

    const validSlugs = new Set(subs.map(s => s.slug));
    const assigned = new Map();    // bookId -> subSlug
    const alreadyAssigned = [];    // books already in a sub-collection

    // Check which books are already assigned to a sub-collection
    for (const book of books) {
      const existing = (book.collections || []).find(c => validSlugs.has(c));
      if (existing) {
        alreadyAssigned.push(book.id);
        assigned.set(book.id, existing);
      }
    }
    if (alreadyAssigned.length > 0) {
      console.log(`  ${alreadyAssigned.length} already in a sub-collection`);
    }

    // Pass 1: Rule-based
    const unassigned = books.filter(b => !assigned.has(b.id));
    if (!GEMINI_ONLY) {
      const ruleFn = RULES[parentSlug];
      if (ruleFn) {
        for (const book of unassigned) {
          const sub = ruleFn(book);
          if (sub && validSlugs.has(sub)) {
            assigned.set(book.id, sub);
          }
        }
      }
      const ruleAssigned = assigned.size - alreadyAssigned.length;
      console.log(`  Rule-based: ${ruleAssigned} assigned`);
    }

    // Pass 2: Gemini for remaining
    const stillUnassigned = books.filter(b => !assigned.has(b.id));
    if (stillUnassigned.length > 0 && ai && !SKIP_GEMINI) {
      console.log(`  Gemini pass: ${stillUnassigned.length} remaining...`);
      const geminiResults = await classifyWithGemini(ai, stillUnassigned, parentSlug, subs);
      for (const { bookId, subSlug } of geminiResults) {
        if (validSlugs.has(subSlug)) {
          assigned.set(bookId, subSlug);
          totalGemini++;
        }
      }
      console.log(`  Gemini assigned: ${geminiResults.length}`);
    } else if (stillUnassigned.length > 0 && !SKIP_GEMINI) {
      console.log(`  ${stillUnassigned.length} unassigned (no Gemini key)`);
    }

    // Apply assignments to MongoDB
    const newAssignments = [...assigned.entries()].filter(([id]) => !alreadyAssigned.includes(id));
    if (newAssignments.length > 0 && !DRY_RUN) {
      const bulkOps = newAssignments.map(([bookId, subSlug]) => ({
        updateOne: {
          filter: { id: bookId },
          update: { $addToSet: { collections: subSlug } },
        },
      }));
      const result = await db.collection('books').bulkWrite(bulkOps);
      console.log(`  Applied: ${result.modifiedCount} books updated`);
      totalAssigned += result.modifiedCount;
    } else if (DRY_RUN) {
      // Show distribution
      const dist = {};
      for (const [, sub] of assigned) {
        dist[sub] = (dist[sub] || 0) + 1;
      }
      console.log(`  Distribution:`);
      for (const [slug, count] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${slug}: ${count}`);
      }
      console.log(`  Unassigned: ${books.length - assigned.size}`);
    }

    // Update book_count on sub-collection docs
    if (!DRY_RUN) {
      for (const sub of subs) {
        const count = await db.collection('books').countDocuments({
          collections: sub.slug, status: { $ne: 'deleted' }, hidden: { $ne: true },
          pages_translated: { $gt: 0 },
        });
        await db.collection('collections').updateOne(
          { slug: sub.slug },
          { $set: { book_count: count } },
        );
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Done. Created: ${totalCreated}, Assigned: ${totalAssigned}, Gemini: ${totalGemini}`);
  if (DRY_RUN) console.log('(dry run — no changes made)');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
