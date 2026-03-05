/**
 * SHWEP (Secret History of Western Esotericism Podcast) episode data.
 * Each episode is tagged with primary source authors/texts discussed,
 * which are matched against our book collection to provide reading links.
 *
 * Episode data sourced from shwep.net — tags curated for collection matching.
 * Generated from crawled data at data/shwep-episodes.json (260 episodes, 0-320).
 * Includes oddcasts, storytimes, and supplementary episodes beyond the main series.
 */

export interface ShwepEpisode {
  number: number;
  title: string;
  url: string;
  /** Historical period for grouping */
  period: string;
  /** Author and text names to match against book collection */
  tags: string[];
  /** Brief description of what the episode covers */
  description?: string;
}

export interface ShwepPeriod {
  id: string;
  name: string;
  description: string;
  dateRange: string;
  episodes: ShwepEpisode[];
}

// ---------------------------------------------------------------------------
// Episodes organized by period bucket (based on episode number ranges)
// ---------------------------------------------------------------------------

const introEpisodes: ShwepEpisode[] = [
  { number: 0, title: "So What is Western Esotericism, Anyway?", url: "https://shwep.net/podcast/so-what-is-western-esotericism-anyway/", period: "intro", tags: ['Ecclesiastical History'] },
  { number: 1, title: "A Secret History of Secret History, Part I", url: "https://shwep.net/podcast/a-secret-history-of-secret-history-part-i/", period: "intro", tags: [] },
  { number: 2, title: "A Secret History of Secret History, Part II", url: "https://shwep.net/podcast/a-secret-history-of-secret-history-part-ii/", period: "intro", tags: [] },
  { number: 3, title: "Wouter Hanegraaff on Western Esotericism", url: "https://shwep.net/podcast/wouter-hanegraaff-on-western-esotericism-interview/", period: "intro", tags: ['Arcana Coelestia', 'Corpus Hermeticum', 'Crater Hermetis'] },
  { number: 4, title: "Richard Seaford on the Origins of the Soul", url: "https://shwep.net/podcast/richard-seaford-on-origins-soul-interview/", period: "intro", tags: [] },
  { number: 5, title: "Methodologies for the Study of Magic", url: "https://shwep.net/podcast/methodologies-for-the-study-of-magic/", period: "intro", tags: [] },
  { number: 6, title: "Magicians, Ghosts, Amulets, and Spells: Daniel Ogden on Graeco-Roman Magic", url: "https://shwep.net/podcast/magicians-ghosts-amulets-and-spells-daniel-ogden-on-graeco-roman-magic/", period: "intro", tags: ['Greek Magical Papyri', 'Metamorphoses'] },
  { number: 7, title: "We're Together In Dreams: Dreaming and Western Esotericism", url: "https://shwep.net/podcast/were-together-in-dreams-dreaming-and-western-esotericism/", period: "intro", tags: ['Artemidorus', 'Hippocrates', 'Herodotus', 'Synesius of Cyrene'] },
  { number: 8, title: "Esoteric Orientalism Part I: Ancient Barbarian Sages", url: "https://shwep.net/podcast/esoteric-orientalism-part-i-ancient-barbarian-sages/", period: "intro", tags: ['Zoroaster'] },
  { number: 9, title: "Esoteric Orientalism Part II: The Greeks are Always Children?", url: "https://shwep.net/podcast/esoteric-orientalism-part-ii-the-greeks-are-always-children/", period: "intro", tags: ['Zoroaster'] },
];

const nearEastEpisodes: ShwepEpisode[] = [
  { number: 10, title: "Prayer to the Gods of Night: The Near-Eastern Roots of Astrology", url: "https://shwep.net/podcast/prayer-to-the-gods-of-night-the-near-eastern-roots-of-astrology/", period: "near-east", tags: [] },
  { number: 11, title: "The Long Secret History of Judaism, Part I", url: "https://shwep.net/podcast/the-long-secret-history-of-judaism-part-i/", period: "near-east", tags: [] },
  { number: 12, title: "Richard Seaford on the Mysteries", url: "https://shwep.net/podcast/richard-seaford-on-the-mysteries/", period: "near-east", tags: ['Orphica', 'Orphica'] },
  { number: 13, title: "From Mystery to 'Mysticism'", url: "https://shwep.net/podcast/from-mystery-to-mysticism/", period: "near-east", tags: [] },
  { number: 14, title: "Methodologies for the Study of Mysticism", url: "https://shwep.net/podcast/methodologies-for-the-study-of-mysticism/", period: "near-east", tags: [] },
];

const preSocraticEpisodes: ShwepEpisode[] = [
  { number: 15, title: "For the Love of Wisdom: The Birth of Philosophy", url: "https://shwep.net/podcast/for-the-love-of-wisdom-the-birth-of-philosophy/", period: "pre-socratic", tags: [] },
  { number: 16, title: "The Enigma of Pythagoras", url: "https://shwep.net/podcast/the-enigma-of-pythagoras/", period: "pre-socratic", tags: ['Herodotus', 'Diogenes Laertius'] },
  { number: 17, title: "The Enigma of Pythagoreanism", url: "https://shwep.net/podcast/the-enigma-of-pythagoreanism/", period: "pre-socratic", tags: ['Iamblichus', 'Porphyry'] },
  { number: 18, title: "Don't Spill the Beans: Pythagorean Silence", url: "https://shwep.net/podcast/dont-spill-the-beans-pythagorean-silence/", period: "pre-socratic", tags: ['Aristoxenus', 'Apollonius of Tyana'] },
  { number: 19, title: "Riddle Me This: Heraclitus of Ephesus", url: "https://shwep.net/podcast/riddle-me-this-heraclitus-of-ephesus/", period: "pre-socratic", tags: [] },
  { number: 20, title: "All for One, and One for All: Parmenides of Elea", url: "https://shwep.net/podcast/all-for-one-and-one-for-all-parmenides-of-elea/", period: "pre-socratic", tags: ['Parmenides'] },
  { number: 21, title: "Elementary: Empedocles and the Secret History of the Elements", url: "https://shwep.net/podcast/elementary-empedocles-and-the-secret-history-of-the-elements/", period: "pre-socratic", tags: ['Empedoclis'] },
  { number: 22, title: "Severed Heads and Cosmic Eggs: Orpheus and Esotericism", url: "https://shwep.net/podcast/severed-heads-and-cosmic-eggs-orpheus-and-esotericism/", period: "pre-socratic", tags: ['Orphica', 'Orphica', 'Aristophanes', 'Herodotus'] },
  { number: 23, title: "Miguel Herrero de Jauregui on Ancient 'Orphism'", url: "https://shwep.net/podcast/miguel-herrero-de-jauregui-on-ancient-orphism/", period: "pre-socratic", tags: ['Orphica', 'Orphica'] },
];

const platoEpisodes: ShwepEpisode[] = [
  { number: 24, title: "Introducing the Father of Western Esotericism: Plato", url: "https://shwep.net/podcast/introducing-the-father-of-western-esotericism-plato/", period: "plato", tags: [] },
  { number: 25, title: "The Esoteric Plato", url: "https://shwep.net/podcast/the-esoteric-plato/", period: "plato", tags: ['Diogenes Laertius', 'Sallustius', 'Alexander of Aphrodisias'] },
  { number: 26, title: "The Birth of the Symbol: Peter Struck on Ancient Greek Esoteric Hermeneutics", url: "https://shwep.net/podcast/the-birth-of-the-symbol-peter-struck-on-ancient-greek-esoteric-hermeneutics/", period: "plato", tags: ['Lucian', 'Aristophanes'] },
  { number: 27, title: "Plato's Timaeus", url: "https://shwep.net/podcast/platos-timaeus/", period: "plato", tags: ['Timaeus'] },
  { number: 28, title: "Christopher Gill on Plato's Atlantis", url: "https://shwep.net/podcast/christopher-gill-on-platos-atlantis/", period: "plato", tags: ['Timaeus'] },
  { number: 29, title: "Otherworlds, Inner Worlds, and Utopias", url: "https://shwep.net/podcast/otherworlds-inner-worlds-and-utopias/", period: "plato", tags: ['Thomas More', 'Tommaso Campanella'] },
  { number: 30, title: "Introducing Plato's Republic", url: "https://shwep.net/podcast/introducing-platos-republic/", period: "plato", tags: [] },
  { number: 31, title: "Sun, Line, Cave: Plato's Inner Republic", url: "https://shwep.net/podcast/sun-line-cave-platos-inner-republic/", period: "plato", tags: [] },
  { number: 32, title: "Maya Alapin on Mathematical Structures in Plato's Republic", url: "https://shwep.net/podcast/maya-alapin-on-mathematical-structures-in-platos-republic/", period: "plato", tags: ['Archytas'] },
  { number: 33, title: "Nowhere to Go But Up: Philosophic Ascent in Plato", url: "https://shwep.net/podcast/nowhere-to-go-but-up-philosophic-ascent-in-plato/", period: "plato", tags: ['Symposium'] },
  { number: 34, title: "Mystery and Initiation in Plato", url: "https://shwep.net/podcast/mystery-and-initiation-in-plato/", period: "plato", tags: ['Marinus'] },
  { number: 35, title: "Mystery and Immortality: Plato's Phaedo", url: "https://shwep.net/podcast/mystery-and-immortality-platos-phaedo/", period: "plato", tags: ['Phaedo'] },
  { number: 36, title: "Plato's Parmenides and Metaphysics", url: "https://shwep.net/podcast/platos-parmenides-and-metaphysics/", period: "plato", tags: [] },
  { number: 37, title: "Peter Adamson on Plato", url: "https://shwep.net/podcast/peter-adamson-on-plato/", period: "plato", tags: [] },
];

const hellenisticEpisodes: ShwepEpisode[] = [
  { number: 38, title: "The Esoteric Aristotle, Part I", url: "https://shwep.net/podcast/the-esoteric-aristotle/", period: "hellenistic", tags: ['Galen'] },
  { number: 39, title: "The Esoteric Aristotle, Part 2", url: "https://shwep.net/podcast/the-esoteric-aristotle-part-2/", period: "hellenistic", tags: ['Secretum secretorum'] },
  { number: 40, title: "Wheels Within Wheels: Toward Western Esoteric Cosmology", url: "https://shwep.net/podcast/wheels-within-wheels-toward-western-esoteric-cosmology/", period: "hellenistic", tags: ['Philolaos'] },
  { number: 41, title: "Fate and Foreknowledge: Toward Hellenistic Astrology", url: "https://shwep.net/podcast/fate-and-foreknowledge-toward-hellenistic-astrology/", period: "hellenistic", tags: ['Vitruvius', 'Strabo', 'Aratus'] },
  { number: 42, title: "Chris Brennan on Hellenistic Astrology", url: "https://shwep.net/podcast/chris-brennan-on-hellenistic-astrology/", period: "hellenistic", tags: ['Ptolemy', 'Vettius Valens'] },
  { number: 43, title: "Christopher Gill on Stoicism", url: "https://shwep.net/podcast/christopher-gill-on-stoicism/", period: "hellenistic", tags: ['Marcus Aurelius', 'Epictetus'] },
  { number: 44, title: "Esoteric Hermeneutics in Stoicism", url: "https://shwep.net/podcast/esoteric-hermeneutics-in-stoicism/", period: "hellenistic", tags: ['Cornutus'] },
  { number: 45, title: "Stoic Physics and Esoteric Metaphysics", url: "https://shwep.net/podcast/stoic-physics-and-esoteric-metaphysics/", period: "hellenistic", tags: [] },
  { number: 46, title: "After Pythagoras", url: "https://shwep.net/podcast/after-pythagoras/", period: "hellenistic", tags: [] },
  { number: 47, title: "The Numbers Don't Lie: Joel Kalvesmaki on 'Pythagorean' Number", url: "https://shwep.net/podcast/the-numbers-dont-lie-joel-kalvesmaki-on-pythagorean-number/", period: "hellenistic", tags: ['Nicomachus'] },
  { number: 48, title: "Pythagoras Revived: An Anatomy of Neopythagoreanism", url: "https://shwep.net/podcast/pythagoras-revived-an-anatomy-of-neopythagoreanism/", period: "hellenistic", tags: ['Nicomachus'] },
  { number: 49, title: "The Long Secret History of the Jews Part II: Second-Temple Judaism", url: "https://shwep.net/podcast/the-long-secret-history-of-the-jews-part-ii-second-temple-judaism/", period: "hellenistic", tags: [] },
  { number: 50, title: "John J. Collins on Apocalyptic", url: "https://shwep.net/podcast/john-j-collins-on-apocalyptic/", period: "hellenistic", tags: ['1 Enoch', 'Book of Enoch'] },
  { number: 51, title: "Enoch and the Book of Watchers", url: "https://shwep.net/podcast/enoch-and-the-book-of-watchers/", period: "hellenistic", tags: ['1 Enoch', 'Book of Enoch'] },
  { number: 52, title: "Enoch, Apocalyptic, and Abrahamic Faith", url: "https://shwep.net/podcast/enoch-apocalyptic-and-esoteric-abrahamic-faith/", period: "hellenistic", tags: ['1 Enoch', 'Book of Enoch'] },
  { number: 53, title: "Palaces of Heavenly Wisdom: The Hekhalot and Merkavah Traditions", url: "https://shwep.net/podcast/palaces-of-heavenly-wisdom-the-hekhalot-and-merkavah-traditions/", period: "hellenistic", tags: ['Sefer Yetzirah'] },
  { number: 54, title: "Frances Flannery on Jewish Dreams in Antiquity", url: "https://shwep.net/podcast/frances-flannery-on-jewish-dreams-in-antiquity/", period: "hellenistic", tags: [] },
  { number: 55, title: "Naomi Janowitz on Jewish Magic and 'The Jewish Magi' in Antiquity", url: "https://shwep.net/podcast/naomi-janowitz-on-ancient-jewish-magic/", period: "hellenistic", tags: [] },
  { number: 56, title: "The First Western Esotericist: Philo of Alexandria", url: "https://shwep.net/podcast/the-first-western-esotericist-philo-of-alexandria/", period: "hellenistic", tags: ['Philo of Alexandria'] },
  { number: 57, title: "The Esoteric Philo", url: "https://shwep.net/podcast/the-esoteric-philo/", period: "hellenistic", tags: ['Philo of Alexandria'] },
  { number: 58, title: "Justin Rogers on Philo in Early Christianity", url: "https://shwep.net/podcast/justin-rogers-on-philo-in-early-christianity/", period: "hellenistic", tags: ['Philo of Alexandria'] },
];

const romanEpisodes: ShwepEpisode[] = [
  { number: 59, title: "Introducing Rome", url: "https://shwep.net/podcast/roman-history-for-esotericists/", period: "roman", tags: [] },
  { number: 60, title: "The Esoteric and the State in Ancient Rome, Part 1: Late Republican Esotericism", url: "https://shwep.net/podcast/politics-and-the-esoteric-in-rome/", period: "roman", tags: [] },
  { number: 61, title: "The Esoteric and the State in Ancient Rome, Part 2: The State and the Stars", url: "https://shwep.net/podcast/the-esoteric-and-the-state-in-ancient-rome-part-2-the-state-and-the-stars/", period: "roman", tags: [] },
  { number: 62, title: "John Dillon on Middle Platonism", url: "https://shwep.net/podcast/john-dillon-on-middle-platonism/", period: "roman", tags: [] },
  { number: 63, title: "Dylan Burns on the 'Underworld of Platonism'", url: "https://shwep.net/podcast/dylan-burns-on-the-underworld-of-platonism/", period: "roman", tags: [] },
  { number: 64, title: "The Enigma of Early Christianity", url: "https://shwep.net/podcast/the-enigma-of-early-christianity/", period: "roman", tags: [] },
  { number: 65, title: "Graeme Miles on Apollonius of Tyana", url: "https://shwep.net/podcast/graeme-miles-on-apollonius-of-tyana/", period: "roman", tags: ['Apollonius', 'Philostratus'] },
  { number: 66, title: "Astrology, Politics, and Platonism in the Early Empire: The Case of Thrasyllus", url: "https://shwep.net/podcast/astrology-politics-and-platonism-in-the-early-empire-the-case-of-thrasyllus/", period: "roman", tags: [] },
  { number: 67, title: "An Erudite Esotericist: Introducing Plutarch of Chaeronea", url: "https://shwep.net/podcast/an-erudite-esotericist-introducing-plutarch-of-chaeronea/", period: "roman", tags: ['Plutarch'] },
  { number: 68, title: "Plutarch's On Isis and Osiris", url: "https://shwep.net/podcast/plutarchs-on-isis-and-osiris/", period: "roman", tags: ['Plutarch'] },
  { number: 69, title: "Plutarch's Myths of Cosmic Ascent", url: "https://shwep.net/podcast/plutarchs-myths-of-cosmic-ascent/", period: "roman", tags: ['Plutarch'] },
  { number: 70, title: "Gil Renberg on Incubation", url: "https://shwep.net/podcast/gil-renberg-on-dream-incubation/", period: "roman", tags: [] },
  { number: 71, title: "Daniel Harris-McCoy on the Oneirocritica of Artemidorus", url: "https://shwep.net/podcast/daniel-harris-mccoy-on-the-oneirocritica-of-artemidorus/", period: "roman", tags: ['Artemidorus', 'Oneirocritica'] },
  { number: 72, title: "Hypochondria and Epiphany: The Strange Case of Aelius Aristides", url: "https://shwep.net/podcast/hypochondria-and-epiphany-the-strange-case-of-aelius-aristides/", period: "roman", tags: ['Aelius Aristides'] },
  { number: 73, title: "Ineffable Initiations and Golden Asses: Apuleius of Madauros and the Metamorphoses", url: "https://shwep.net/podcast/ineffable-initiations-and-golden-asses-apuleius-of-madauros-and-the-metamorphoses/", period: "roman", tags: ['Apuleius', 'Metamorphoses', 'Golden Ass'] },
  { number: 74, title: "I'm Not Sorry: The Apology of Apuleius", url: "https://shwep.net/podcast/im-not-sorry-the-apology-of-apuleius/", period: "roman", tags: ['Apuleius'] },
  { number: 75, title: "The Chaldaean Oracles", url: "https://shwep.net/podcast/the-chaldaean-oracles/", period: "roman", tags: ['Chaldean Oracles'] },
  { number: 76, title: "The Chaldaean Oracles and Theurgy", url: "https://shwep.net/podcast/the-chaldaean-oracles-and-theurgy/", period: "roman", tags: ['Chaldean Oracles'] },
  { number: 77, title: "Korshi Dosoo on the Papyri Graecae Magicae and Western Esotericism", url: "https://shwep.net/podcast/korshi-dosoo-on-the-papyri-graeci-magici-and-western-esotericism/", period: "roman", tags: ['Greek Magical Papyri'] },
  { number: 78, title: "Inter philosophos occultorum curiosior: Numenius of Apamea", url: "https://shwep.net/podcast/numenius-of-apamea/", period: "roman", tags: ['Numenius'] },
  { number: 79, title: "Alone with the Alone: Numenius' Metaphysics", url: "https://shwep.net/podcast/alone-with-the-alone-numenius-metaphysics/", period: "roman", tags: ['Numenius'] },
  { number: 80, title: "Michael Williams on the Trouble with 'Gnosticism'", url: "https://shwep.net/podcast/michael-williams-on-the-trouble-with-gnosticism/", period: "roman", tags: [] },
  { number: 81, title: "Warfaring Strangers: Prolegomena to Second-Century Christianity", url: "https://shwep.net/podcast/warfaring-strangers-prolegomena-to-second-century-christianity/", period: "roman", tags: [] },
  { number: 82, title: "I Got Soul, And I'm Super Bad: Basilides of Alexandria", url: "https://shwep.net/podcast/i-got-soul-and-im-super-bad-basilides-of-alexandria/", period: "roman", tags: [] },
  { number: 83, title: "Geoffrey Smith on Valentinus and Valentinianism", url: "https://shwep.net/podcast/geoffrey-smith-on-valentinus-and-valentinianism/", period: "roman", tags: [] },
  { number: 84, title: "Other Gospels and Alien Gods: Marcion of Sinope", url: "https://shwep.net/podcast/other-gospels-and-alien-gods-marcion-of-sinope/", period: "roman", tags: [] },
  { number: 85, title: "Introducing Alchemy with Lawrence Principe", url: "https://shwep.net/podcast/introducing-alchemy-with-lawrence-principe/", period: "roman", tags: ['Zosimus', 'Turba Philosophorum', 'Emerald Tablet'] },
  { number: 86, title: "Matteo Martelli on the Pseudo-Democritus", url: "https://shwep.net/podcast/matteo-martelli-on-the-pseudo-democritus/", period: "roman", tags: ['Zosimus'] },
  { number: 87, title: "Numerical Mysteries: Nichomachus of Gerasa, Arithmology, and Second-Century Neopythagoreanism", url: "https://shwep.net/podcast/numerical-mysteries-nichomachus-of-gerasa-arithmology-and-second-century-neopythagoreanism/", period: "roman", tags: ['Nicomachus'] },
  { number: 88, title: "Claudius Ptolemy and the Tetrabiblos", url: "https://shwep.net/podcast/claudius-ptolemy-and-the-tetrabiblos/", period: "roman", tags: ['Ptolemy', 'Tetrabiblos'] },
  { number: 89, title: "The Astrology of Vettius Valens", url: "https://shwep.net/podcast/the-astrology-of-vettius-valens/", period: "roman", tags: ['Vettius Valens'] },
];

const hermeticaEpisodes: ShwepEpisode[] = [
  { number: 90, title: "The Orthodox Gnostic: Introducing Clement of Alexandria", url: "https://shwep.net/podcast/the-orthodox-gnostic-introducing-clement-of-alexandria/", period: "hermetica", tags: ['Clement of Alexandria'] },
  { number: 91, title: "Mystagogic Patchwork: Esoteric Writing in Clement's Stromateis", url: "https://shwep.net/podcast/mystagogic-patchwork-esoteric-writing-in-clements-stromateis/", period: "hermetica", tags: ['Clement of Alexandria', 'Stromateis'] },
  { number: 92, title: "Lifting the Veil: Esoteric Reading in Clement's Stromateis", url: "https://shwep.net/podcast/lifting-the-veil-esoteric-reading-in-clements-stromateis/", period: "hermetica", tags: ['Clement of Alexandria', 'Stromateis'] },
  { number: 93, title: "Henny Fiska Hagg on Clement's Apophatic Writing", url: "https://shwep.net/podcast/henny-fiska-hagg-on-clements-apophatic-writing/", period: "hermetica", tags: ['Clement of Alexandria', 'Stromateis'] },
  { number: 94, title: "Becoming Gods: Divinisation and Angelomorphic Transformation in Clement", url: "https://shwep.net/podcast/becoming-gods-divinisation-and-angelomorphic-transformation-in-clement/", period: "hermetica", tags: ['Clement of Alexandria'] },
  { number: 95, title: "The Third Century and (the Long) Late Antiquity", url: "https://shwep.net/podcast/the-third-century-and-the-long-late-antiquity/", period: "hermetica", tags: [] },
  { number: 96, title: "From Word to Silence: The Rise of the Apophatic in Late Antiquity", url: "https://shwep.net/podcast/from-word-to-silence-the-rise-of-the-apophatic-in-late-antiquity/", period: "hermetica", tags: [] },
  { number: 97, title: "Aron Reppmann Introduces Origen of Alexandria", url: "https://shwep.net/podcast/aron-reppmann-introduces-origen-of-alexandria/", period: "hermetica", tags: ['Origen'] },
  { number: 98, title: "The True Account: Celsus, Origen, and Ideological Esotericism in Late Antiquity", url: "https://shwep.net/podcast/the-true-account-celsus-origen-and-ideological-esotericism-in-late-antiquity/", period: "hermetica", tags: ['Corpus Hermeticum', 'Origen'] },
  { number: 99, title: "Total War: Polemical Esotericism in the Contra Celsum", url: "https://shwep.net/podcast/total-war-polemical-esotericism-in-the-contra-celsum/", period: "hermetica", tags: ['Contra Celsum', 'Origen'] },
  { number: 100, title: "Thrice-Greatest Hermes", url: "https://shwep.net/podcast/thrice-greatest-hermes/", period: "hermetica", tags: ['Corpus Hermeticum', 'Hermes Trismegistus', 'Pistis Sophia'] },
  { number: 101, title: "Brian Copenhaver on the Hermetica", url: "https://shwep.net/podcast/brian-copenhaver-on-the-hermetica/", period: "hermetica", tags: ['Hermes Trismegistus', 'Corpus Hermeticum'] },
  { number: 102, title: "Professor Christian Wildberg on Emending the Corpus Hermeticum", url: "https://shwep.net/podcast/professor-christian-wildberg-on-emending-the-corpus-hermeticum/", period: "hermetica", tags: ['Corpus Hermeticum', 'Lives of the Eminent Philosophers'] },
  { number: 103, title: "Corpus Hermeticum I, the Poimandres", url: "https://shwep.net/podcast/corpus-hermeticum-i-the-poimandres/", period: "hermetica", tags: ['Corpus Hermeticum', 'Poimandres', 'Hermes Trismegistus'] },
  { number: 104, title: "Wouter Hanegraaff on the Poimandres", url: "https://shwep.net/podcast/wouter-hanegraaff-on-the-poimandres/", period: "hermetica", tags: ['Corpus Hermeticum', 'Poimandres', 'Hermes Trismegistus'] },
  { number: 105, title: "Other Hermetic Worlds: The Asclepius and Kore Kosmou", url: "https://shwep.net/podcast/other-hermetic-worlds-the-asclepius-and-kore-kosmou/", period: "hermetica", tags: ['Asclepius', 'Corpus Hermeticum', 'Hermes Trismegistus'] },
  { number: 106, title: "Silent Encounters: The Esoteric in the Ancient Hermetica", url: "https://shwep.net/podcast/silent-encounters-the-esoteric-in-the-ancient-hermetica/", period: "hermetica", tags: ['Corpus Hermeticum', 'Hermes Trismegistus'] },
  { number: 107, title: "M. David Litwa on Deification in the Hermetica", url: "https://shwep.net/podcast/m-david-litwa-on-deification-in-the-hermetica/", period: "hermetica", tags: ['Corpus Hermeticum', 'Hermes Trismegistus'] },
  { number: 108, title: "Anna van den Kerchove on the Hermetic Way in Antiquity", url: "https://shwep.net/podcast/anna-van-den-kerchove-on-the-hermetic-way-in-antiquity/", period: "hermetica", tags: ['Hermes Trismegistus', 'Corpus Hermeticum'] },
  { number: 109, title: "Christian Bull on the Way of Hermes in Antiquity", url: "https://shwep.net/podcast/christian-bull-on-the-way-of-hermes-in-antiquity/", period: "hermetica", tags: ['Hermes Trismegistus', 'Corpus Hermeticum'] },
];

const neoplatonismEpisodes: ShwepEpisode[] = [
  { number: 110, title: "Matthew Neujahr on the Sibylline Oracles", url: "https://shwep.net/podcast/matthew-neujahr-on-the-sibylline-oracles/", period: "neoplatonism", tags: ['Almagest', 'Sibylline Oracles', 'Syntaxis mathematica', 'Tetrabiblos'] },
  { number: 111, title: "'The Philosopher of our Time': Introducing Plotinus", url: "https://shwep.net/podcast/the-philosopher-of-our-time-introducing-plotinus/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 112, title: "We are the One: Plotinus' Participatory Metaphysics", url: "https://shwep.net/podcast/we-are-the-one-plotinus-participatory-metaphysics/", period: "neoplatonism", tags: ['Clement of Alexandria', 'Plotinus'] },
  { number: 113, title: "Mateusz Strozynski on Spiritual Practices in Plotinus", url: "https://shwep.net/podcast/mateusz-strozynski-on-spiritual-practices-in-plotinus/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 114, title: "Plotinus the Magician? Ritual Practice and Power in Platonism", url: "https://shwep.net/podcast/plotinus-the-magician-ritual-practice-and-power-in-platonism/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 115, title: "The Esoteric Plotinus, Part I: Philosophic Silence and Esoteric Reading", url: "https://shwep.net/podcast/the-esoteric-plotinus-part-i-philosophic-silence-and-esoteric-reading/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 116, title: "Plotinus on Astrology with Marilynn Lawrence", url: "https://shwep.net/podcast/plotinus-on-astrology-with-marilynn-lawrence/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 117, title: "The Esoteric Plotinus, Part II: Unsaying the Real", url: "https://shwep.net/podcast/the-esoteric-plotinus-part-ii-unsaying-the-real/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 118, title: "Dylan Burns on Sethian Gnosticism", url: "https://shwep.net/podcast/dylan-burns-on-sethian-gnosticism/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 119, title: "Jean-Marc Narbonne on Plotinus in Dialogue with the Gnostics", url: "https://shwep.net/podcast/jean-marc-narbonne-on-plotinus-in-dialogue-with-the-gnostics/", period: "neoplatonism", tags: ['Plotinus'] },
  { number: 120, title: "Mysteries of the Rock-Born God: The Roman Cult of Mithras", url: "https://shwep.net/podcast/mysteries-of-the-rock-born-god-the-roman-cult-of-mithras/", period: "neoplatonism", tags: [] },
  { number: 121, title: "Mithras and the Stars: Astral Elements in the Cult of Mithras", url: "https://shwep.net/podcast/mithras-and-the-stars-astral-elements-in-the-cult-of-mithras/", period: "neoplatonism", tags: [] },
  { number: 122, title: "Radcliffe G. Edmonds III on the 'Mithrasliturgie'", url: "https://shwep.net/podcast/radcliffe-g-edmonds-iii-on-the-mithrasliturgie/", period: "neoplatonism", tags: ['Contra Celsum', 'Greek Magical Papyri'] },
  { number: 123, title: "Jason BeDuhn on Mani and Manichaeism", url: "https://shwep.net/podcast/jason-beduhn-on-mani-and-manichaeism/", period: "neoplatonism", tags: [] },
  { number: 124, title: "Charles M. Stang on the Divine Double in Late Antiquity", url: "https://shwep.net/podcast/charles-m-stang-on-the-divine-double-in-late-antiquity/", period: "neoplatonism", tags: ['Contra Celsum', 'Philokalia'] },
  { number: 125, title: "'Poet, Philosopher, Hierophant': Introducing Porphyry of Tyre", url: "https://shwep.net/podcast/poet-philosopher-hierophant-introducing-porphyry-of-tyre/", period: "neoplatonism", tags: ['Plotinus', 'Porphyry', 'Somnium'] },
  { number: 126, title: "Porphyry's Gods: The Metaphysics and Physics of Divinity", url: "https://shwep.net/podcast/porphyrys-gods-the-metaphysics-and-physics-of-divinity/", period: "neoplatonism", tags: ['Contra Celsum', 'Philocalia', 'Porphyry'] },
  { number: 127, title: "Dorian Greenbaum on Porphyry and Astrology", url: "https://shwep.net/podcast/dorian-greenbaum-on-porphyry-and-astrology/", period: "neoplatonism", tags: ['Porphyry'] },
  { number: 128, title: "Porphyry and the Barbarians: Ethnicity, Religious Practice, and Esoteric Interpretation", url: "https://shwep.net/podcast/porphyry-and-the-barbarians-ethnicity-religious-practice-and-esoteric-interpretation/", period: "neoplatonism", tags: ['Corpus Hermeticum', 'Poimandres', 'Porphyry'] },
  { number: 129, title: "Nilufer Akcay on Porphyry's On the Cave of the Nymphs", url: "https://shwep.net/podcast/nilufer-akcay-on-porphyrys-on-the-cave-of-the-nymphs/", period: "neoplatonism", tags: ['Corpus Hermeticum', 'Poimandres', 'Porphyry'] },
  { number: 130, title: "Methodologies for Studying the Subtle Body", url: "https://shwep.net/podcast/methodologies-for-studying-the-subtle-body/", period: "neoplatonism", tags: ['Asclepius', 'Corpus Hermeticum', 'Poimandres'] },
  { number: 131, title: "Soul-Flight, Noetic Bodies, and Pneumatic Vehicles: Toward a History of the Platonist Subtle Body", url: "https://shwep.net/podcast/soul-flight-noetic-bodies-and-pneumatic-vehicles-toward-a-history-of-the-platonist-subtle-body/", period: "neoplatonism", tags: ['Asclepius', 'Corpus Hermeticum', 'Iliad'] },
  { number: 132, title: "Astral Accretions, Fate, and the Resurrection-Body: Other Subtle Bodies of Antiquity", url: "https://shwep.net/podcast/astral-accretions-fate-and-the-resurrection-body-other-subtle-bodies-of-antiquity/", period: "neoplatonism", tags: ['Corpus Hermeticum', 'Poimandres'] },
];

const iamblichusEpisodes: ShwepEpisode[] = [
  { number: 133, title: "A Word to Conjure With: On 'Theurgy' in Late Antiquity and Beyond", url: "https://shwep.net/podcast/a-word-to-conjure-with-on-theurgy-in-late-antiquity-and-beyond/", period: "iamblichus", tags: ['Chaldean Oracles', 'Collection des anciens alchimistes grecs', 'Corpus Hermeticum', 'Iamblichus', 'Poimandres'] },
  { number: 134, title: "Introducing Iamblichus of Chalcis", url: "https://shwep.net/podcast/introducing-iamblichus-of-chalcis/", period: "iamblichus", tags: ['Eunapius', 'Iamblichus', 'Poimandres'] },
  { number: 135, title: "Esoteric Hermeneutics, Divine Hierarchy, and the Ineffable: The Philosophy of Iamblichus, Part I", url: "https://shwep.net/podcast/esoteric-hermeneutics-divine-hierarchy-and-the-ineffable-the-philosophy-of-iamblichus/", period: "iamblichus", tags: ['Asclepius', 'Corpus Hermeticum', 'Iamblichus', 'Poimandres'] },
  { number: 136, title: "The 'Greater Kinds', Souls, and Kosmos: Iamblichus' Philosophy, Part II", url: "https://shwep.net/podcast/the-greater-kinds-souls-and-kosmos-introducing-iamblichus-philosophy-part-ii/", period: "iamblichus", tags: ['Asclepius', 'Corpus Hermeticum', 'Iamblichus', 'Poimandres'] },
  { number: 137, title: "The Esoteric Iamblichus", url: "https://shwep.net/podcast/the-esoteric-iamblichus/", period: "iamblichus", tags: ['Corpus Hermeticum', 'Iamblichus', 'Poimandres'] },
  { number: 138, title: "The Great Theurgy Debate: Porphyry's Letter to Anebo, Iamblichus' Response, and the Question(s) of Ritual", url: "https://shwep.net/podcast/the-great-theurgy-debate-porphyrys-letter-to-anebo-iamblichus-response-and-the-questions-of-ritual/", period: "iamblichus", tags: ['Corpus Hermeticum', 'De Mysteriis', 'Iamblichus', 'Porphyry'] },
  { number: 139, title: "John Finamore on Iamblichean Theurgy in Theory and Practice", url: "https://shwep.net/podcast/john-finamore-on-iamblichean-theurgy-in-theory-and-practice/", period: "iamblichus", tags: ['De Mysteriis', 'Corpus Hermeticum', 'Iamblichus'] },
  { number: 140, title: "Gregory Shaw on the Phenomenology of Iamblichean Theurgy", url: "https://shwep.net/podcast/gregory-shaw-on-the-phenomenology-of-iamblichean-theurgy/", period: "iamblichus", tags: ['Corpus Hermeticum', 'De Mysteriis', 'Iamblichus'] },
  { number: 141, title: "Brian Alt on Sacred Materials, Divine Names, and Subtle Physiology in Iamblichean Theurgy", url: "https://shwep.net/podcast/brian-alt-on-sacred-materials-divine-names-and-subtle-physiology-in-iamblichean-theurgy/", period: "iamblichus", tags: ['Corpus Hermeticum', 'De Mysteriis', 'Iamblichus'] },
  { number: 142, title: "Run the Numbers: The Theology of Arithmetic", url: "https://shwep.net/podcast/run-the-numbers-the-theology-of-arithmetic/", period: "iamblichus", tags: ['Corpus Hermeticum', 'Iamblichus', 'Nicomachus'] },
  { number: 143, title: "Politics and Religion in Late Antiquity, Part I: Geopolitics, Empire, and Rabbinic Judaism", url: "https://shwep.net/podcast/politics-and-religion-in-late-antiquity-part-i-geopolitics-empire-and-rabbinic-judaism/", period: "iamblichus", tags: ['De mysteriis', 'Corpus Hermeticum', 'Poimandres'] },
  { number: 144, title: "Politics and Religion in Late Antiquity, Part II: The Rise of Christianity and the Invention and Eclipse of 'Paganism'", url: "https://shwep.net/podcast/politics-and-religion-in-late-antiquity-part-ii-the-rise-of-christianity-and-the-invention-and-eclipse-of-paganism/", period: "iamblichus", tags: ['Asclepius'] },
  { number: 145, title: "Thinking through Monotheism, Henotheism, Polytheism, and Dualism in Late Antiquity", url: "https://shwep.net/podcast/thinking-through-monotheism-henotheism-polytheism-and-dualism-in-late-antiquity/", period: "iamblichus", tags: ['Plotinus', 'Plotini opera'] },
];

const lateMagicEpisodes: ShwepEpisode[] = [
  { number: 146, title: "Gideon Bohak on Late-Antique Jewish Magic", url: "https://shwep.net/podcast/gideon-bohak-on-late-antique-jewish-magic/", period: "late-magic", tags: ['Moralia', 'Oracula Sibyllina', 'Satyricon', 'Sibylline Oracles'] },
  { number: 147, title: "Daniel James Waller on the Jewish Incantation-Bowls", url: "https://shwep.net/podcast/daniel-james-waller-on-the-jewish-incantation-bowls/", period: "late-magic", tags: [] },
  { number: 148, title: "Curses! Sarah Veale on Roman 'Curse-Tablets'", url: "https://shwep.net/podcast/curses-sarah-veale-on-roman-curse-tablets/", period: "late-magic", tags: ['Plotinus', 'Greek Magical Papyri'] },
  { number: 149, title: "Exploring the Sefer ha-Razim", url: "https://shwep.net/podcast/exploring-the-sefer-ha-razim/", period: "late-magic", tags: ['Plotinus'] },
  { number: 150, title: "The Testament of Solomon and the Solomonic Tradition, Part I", url: "https://shwep.net/podcast/the-testament-of-solomon-and-the-solomonic-tradition/", period: "late-magic", tags: ['De Civitate Dei', 'Plotinus', 'Testament of Solomon'] },
  { number: 151, title: "The Testament of Solomon and the Solomonic Tradition, Part II", url: "https://shwep.net/podcast/the-testament-of-solomon-and-the-solomonic-tradition-part-ii/", period: "late-magic", tags: ['Plotinus', 'Testament of Solomon'] },
  { number: 152, title: "Prolegomena to Christian Magic", url: "https://shwep.net/podcast/prolegomena-to-christian-magic/", period: "late-magic", tags: ['Eusebius', 'Justin Martyr', 'Lactantius'] },
  { number: 153, title: "Korshi Dosoo on Early Christian Magic", url: "https://shwep.net/podcast/korshi-dosoo-on-early-christian-magic/", period: "late-magic", tags: ['Asclepius'] },
  { number: 154, title: "Paul Pasquesi on Christian Asceticism in the Late-Antique Syriac World", url: "https://shwep.net/podcast/paul-pasquesi-on-christian-asceticism-in-the-late-antique-syriac-world/", period: "late-magic", tags: ['Bardaisan', 'Book of the Bee', 'Cave of Treasures', 'Plotinus', 'Ephrem', 'Isaac of Nineveh', 'Odes of Solomon'] },
  { number: 155, title: "Charles Haberl on the Mandaeans", url: "https://shwep.net/podcast/charles-haberl-on-the-mandaeans/", period: "late-magic", tags: ['Plotinus'] },
  { number: 156, title: "Recognising the Real in the Forgery: The Pseudo-Clementine Literature", url: "https://shwep.net/podcast/recognising-the-real-in-the-forgery-the-pseudo-clementine-literature/", period: "late-magic", tags: ['Plotinus'] },
  { number: 157, title: "Matteo Martelli Introduces Zosimus of Panopolis", url: "https://shwep.net/podcast/matteo-martelli-introduces-zosimus-of-panopolis/", period: "late-magic", tags: ['Book of Enoch', 'Religious Experience', 'Zosimus'] },
  { number: 158, title: "Bink Hallum on the Extended Zosimus", url: "https://shwep.net/podcast/bink-hallum-on-the-extended-zosimus/", period: "late-magic", tags: ['Zosimus'] },
  { number: 159, title: "Metals, Temples, and Living Statues: Shannon Grimes on Zosimus' Egyptian Context", url: "https://shwep.net/podcast/metals-temples-and-living-statues-shannon-grimes-on-zosimus-egyptian-context/", period: "late-magic", tags: ['Corpus Hermeticum', 'Plotinus', 'Zosimus'] },
  { number: 160, title: "Kocku von Stuckrad on Monotheist Astrologies in (Late) Antiquity", url: "https://shwep.net/podcast/kocku-von-stuckrad-on-monotheist-astrologies-in-late-antiquity/", period: "late-magic", tags: ['Contra Celsum', 'Firmicus Maternus'] },
  { number: 161, title: "Claire Hall on Firmicus Maternus", url: "https://shwep.net/podcast/claire-hall-on-firmicus-maternus/", period: "late-magic", tags: ['Firmicus Maternus'] },
  // Oddcasts, storytimes, and supplementary episodes (215+)
  { number: 216, title: "Jesus the Magician? Interrogating Ancient and Modern Discourses of Ritual Power in the Gospels", url: "https://shwep.net/podcast/jesus-the-magician-interrogating-ancient-and-modern-discourses-of-ritual-power-in-the-gospels/", period: "late-magic", tags: ['New Testament'] },
  { number: 217, title: "The Esoteric New Testament, Part I: The Gospel of Mark", url: "https://shwep.net/podcast/the-esoteric-new-testament-part-i-the-gospel-of-mark/", period: "late-magic", tags: ['Jewish Antiquities', 'Novum Testamentum'] },
  { number: 218, title: "The Esoteric New Testament, Part II: Paul and the 'Mysteries'", url: "https://shwep.net/podcast/the-esoteric-new-testament-part-ii-paul-and-the-mysteries/", period: "late-magic", tags: ['Acts of the Apostles'] },
  { number: 220, title: "The Esoteric New Testament, Part III: John and Apocalypse", url: "https://shwep.net/podcast/the-esoteric-new-testament-part-iii-john-and-apocalypse/", period: "late-magic", tags: ['Apocalypse of John', 'Gospel of John', 'Novum Testamentum'] },
  { number: 221, title: "Into Coptic Magic with Korshi Dosoo", url: "https://shwep.net/podcast/into-coptic-magic-with-korshi-dosoo-2/", period: "late-magic", tags: [] },
  { number: 223, title: "Into Syriac Spirituality in Theory and Practice with Paul Pasquesi", url: "https://shwep.net/podcast/into-syriac-spirituality-in-theory-and-practice-with-paul-pasquesi/", period: "late-magic", tags: ['Odes of Solomon'] },
  { number: 225, title: "Into the Light-Worlds with Charles H\u00e4berl", url: "https://shwep.net/podcast/into-the-light-worlds-with-charles-haberl/", period: "late-magic", tags: [] },
  { number: 226, title: "Approaches to the Question of Early Christian Esotericism", url: "https://shwep.net/podcast/approaches-to-the-question-of-early-christian-esotericism/", period: "late-magic", tags: [] },
  { number: 229, title: "Matteo Martelli Perfects the Tincture", url: "https://shwep.net/podcast/matteo-martelli-perfects-the-tincture/", period: "late-magic", tags: [] },
  { number: 233, title: "Bink Hallum on Zosimus Arabicus: The Final Quittance", url: "https://shwep.net/podcast/bink-hallum-on-zosimus-arabicus-the-final-quittance/", period: "late-magic", tags: [] },
  { number: 237, title: "Storytime: Reading Zosimus of Panopolis\u2019 The Final Accounting", url: "https://shwep.net/podcast/storytime-reading-zosimus-of-panopolis-the-final-accounting/", period: "late-magic", tags: ['Corpus Hermeticum'] },
  { number: 238, title: "Storytime: Reading Zosimus of Panopolis On the Letter Omega", url: "https://shwep.net/podcast/storytime-reading-zosimus-of-panopolis-on-the-letter-omega/", period: "late-magic", tags: ['Sibylline Oracles'] },
  { number: 239, title: "Storytime: Reading \u2018The Visions of Zosimus\u2019", url: "https://shwep.net/podcast/storytime-reading-the-visions-of-zosimus/", period: "late-magic", tags: [] },
  { number: 290, title: "Joseph Sanzo on Magic and Confessional Boundaries in Late Antiquity", url: "https://shwep.net/podcast/joseph-sanzo-on-magic-and-confessional-boundaries-in-late-antiquity/", period: "late-magic", tags: [] },
];

const christianFathersEpisodes: ShwepEpisode[] = [
  { number: 162, title: "Father Sergey Trostyanskiy on the Cappadocian Fathers, Part I", url: "https://shwep.net/podcast/father-sergey-trostyanskiy-on-the-cappadocian-fathers-part-i/", period: "christian-fathers", tags: ['Gregory of Nazianzus', 'Gregory of Nyssa'] },
  { number: 163, title: "Father Sergey Trostyanskiy on the Cappadocian Fathers, Part II", url: "https://shwep.net/podcast/sergey-trostyanskiy-on-the-cappadocian-fathers-part-ii/", period: "christian-fathers", tags: ['Contra Celsum', 'Gregory of Nazianzus', 'Gregory of Nyssa'] },
  { number: 164, title: "Theology, Politics, and Radiant Darkness: Michael Motia on Gregory of Nyssa", url: "https://shwep.net/podcast/theology-politics-and-radiant-darkness-michael-motia-on-gregory-of-nyssa/", period: "christian-fathers", tags: ['Chaldaean Oracles', 'Diogenes Laertius', 'Eine Mithrasliturgie', 'Gregory of Nyssa', 'Corpus Hermeticum', 'Orphica'] },
  { number: 165, title: "Joel Kalvesmaki on Evagrius of Pontus, the 'Gnostic Trilogy', and the Origenist Controversy", url: "https://shwep.net/podcast/joel-kalvesmaki-on-evagrius-of-pontus-the-gnostic-trilogy-and-the-origenist-controversy/", period: "christian-fathers", tags: ['Evagrius Ponticus', 'Origen', 'Orphica'] },
  { number: 166, title: "Joel Kalvesmaki on Evagrius' Kephalaia Gnostika: Philosophy, Scripture, and Apophatic Mysticism", url: "https://shwep.net/podcast/joel-kalvesmaki-on-evagrius-kephalaia-gnostika-philosophy-scripture-and-apophatic-mysticism/", period: "christian-fathers", tags: ['Chaldean Oracles', 'Evagrius Ponticus', 'Odyssey'] },
  { number: 167, title: "Jeremy Swist on the Emperor Julian, Part I: the Political Background and Political Project of the Emperor", url: "https://shwep.net/podcast/jeremy-swist-on-the-emperor-julian-part-i-the-political-background-and-political-project-of-the-emperor/", period: "christian-fathers", tags: ['Julianus Apostata', 'Emperor Julian', 'Eusebius', 'Lactantius'] },
  { number: 168, title: "Jeremy Swist on Julian, Part II: The Emperor's Religio-Philosophic Project", url: "https://shwep.net/podcast/jeremy-swist-on-julian-part-ii-the-emperors-religio-philosophic-project/", period: "christian-fathers", tags: ['Julianus Apostata', 'Emperor Julian'] },
  { number: 169, title: "Strategies of the Esoteric in the Hellenism of the Emperor Julian: Exclusion and Pluralism in a Late-Antique Polytheism", url: "https://shwep.net/podcast/strategies-of-the-esoteric-in-the-hellenism-of-the-emperor-julian-exclusion-and-pluralism-in-a-late-antique-polytheism/", period: "christian-fathers", tags: ['Emperor Julian', 'Corpus Hermeticum', 'Julianus Apostata'] },
  { number: 170, title: "Frederico Fidler on Sallustius' On the Gods and the World", url: "https://shwep.net/podcast/frederico-fidler-on-sallustius-on-the-gods-and-the-world/", period: "christian-fathers", tags: ['Emperor Julian', 'Julianus Apostata', 'Sallustius'] },
  { number: 171, title: "'Visibly a Goddess': Heidi Marx on Sosipatra of Pergamum", url: "https://shwep.net/podcast/visibly-a-goddess-heidi-marx-on-sosipatra-of-pergamum/", period: "christian-fathers", tags: ['Plotinus', 'Eunapius', 'Iamblichus', 'Plotini opera'] },
  { number: 172, title: "'And When Rome Falls, Falls the World': The Fall of Rome and Western Esotericism", url: "https://shwep.net/podcast/and-when-rome-falls-falls-the-world-the-fall-of-rome-and-western-esotericism/", period: "christian-fathers", tags: [] },
  { number: 173, title: "Hypatia of Alexandria: The Life and Death of a Philosopher and her City", url: "https://shwep.net/podcast/hypatia-of-alexandria-the-life-and-death-of-a-philosopher-and-her-city/", period: "christian-fathers", tags: ['Eunapius', 'Synesius of Cyrene'] },
  { number: 174, title: "Noble Lies and Philosophic Silence: Hypatia, Synesius, and the New Esotericism in the Fourth Century", url: "https://shwep.net/podcast/noble-lies-and-philosophic-silence-hypatia-synesius-and-the-new-esotericism-in-the-fourth-century/", period: "christian-fathers", tags: ['Synesius of Cyrene'] },
  { number: 175, title: "Jay Bregman on Synesius of Cyrene", url: "https://shwep.net/podcast/jay-bregman-on-synesius-of-cyrene/", period: "christian-fathers", tags: ['Synesius of Cyrene', 'Tetrabiblos'] },
  { number: 176, title: "Plato Latinus", url: "https://shwep.net/podcast/plato-latinus/", period: "christian-fathers", tags: ['Calcidius', 'Plotinus', 'Orphica', 'Timaeus'] },
  { number: 177, title: "Gretchen Reydams-Schils on Calcidius and the Timaeus", url: "https://shwep.net/podcast/gretchen-reydams-schils-on-calcidius-and-the-timaeus/", period: "christian-fathers", tags: ['Alcinous', 'Calcidius', 'Timaeus'] },
  { number: 178, title: "Stephen A. Cooper on Marius Victorinus and Latinate Christian Platonism", url: "https://shwep.net/podcast/stephen-a-cooper-on-marius-victorinus-and-latinate-christian-platonism/", period: "christian-fathers", tags: ['Marius Victorinus', 'Sophist'] },
  { number: 179, title: "The Manichaean Catholic: Augustine of Hippo", url: "https://shwep.net/podcast/the-manichaean-catholic-augustine-of-hippo/", period: "christian-fathers", tags: ['St. Augustine'] },
  { number: 180, title: "Augustine of Hippo: Saint of the Exoteric", url: "https://shwep.net/podcast/augustine-of-hippo-saint-of-the-exoteric/", period: "christian-fathers", tags: ['St. Augustine', 'Novum Testamentum'] },
  // Oddcasts, storytimes, and supplementary episodes (215+)
  { number: 242, title: "Into the Darkness with Michæl Motia", url: "https://shwep.net/podcast/into-the-darkness-with-michael-motia/", period: "christian-fathers", tags: [] },
  { number: 248, title: "Storytime: Reading Eunapius Part II, The Emperor and the Thaumaturge", url: "https://shwep.net/podcast/storytime-reading-eunapius-part-ii-the-emperor-and-the-thaumaturge/", period: "christian-fathers", tags: ['Ammianus Marcellinus'] },
  { number: 250, title: "Storytime: Reading Eunapius, Part III: The Diviners' Purge and the End of the Theurgic Revolution", url: "https://shwep.net/podcast/storytime-reading-eunapius-part-iii-the-diviners-purge-and-the-end-of-the-theurgic-revolution/", period: "christian-fathers", tags: [] },
  { number: 255, title: "Storytime: Reading Synesius On Dreams", url: "https://shwep.net/podcast/storytime-reading-synesius-on-dreams/", period: "christian-fathers", tags: ['Golden Verses'] },
  { number: 259, title: "David Hernández de la Fuente on Nonnus of Panopolis", url: "https://shwep.net/podcast/david-hernandez-de-la-fuente-on-nonnus-of-panopolis/", period: "christian-fathers", tags: ['Gospel of John'] },
  { number: 260, title: "Stephen Cooper on Marius Victorinus, Philosophy, Panpsychism, and a Modern Religious Platonism", url: "https://shwep.net/podcast/stephen-cooper-on-marius-victorinus-philosophy-panpsychism-and-a-modern-religious-platonism/", period: "christian-fathers", tags: [] },
  { number: 264, title: "Mateusz Stróżyński on Augustine and Platonism", url: "https://shwep.net/podcast/mateusz-strozynski-on-augustine-and-platonism/", period: "christian-fathers", tags: [] },
  { number: 265, title: "Mateusz Stróżyński on Spiritual Practices in Augustine", url: "https://shwep.net/podcast/mateusz-strozynski-on-spiritual-practices-in-augustine/", period: "christian-fathers", tags: [] },
  { number: 266, title: "Poseidonius of Rhodes, Weird Stoicism, and 'Cosmic Religion'", url: "https://shwep.net/podcast/poseidonius-of-rhodes-weird-stoicism-and-cosmic-religion/", period: "christian-fathers", tags: ['De trinitate'] },
  { number: 270, title: "Storytime: Reading Macrobius' Commentary on the Dream of Scipio, Part I", url: "https://shwep.net/podcast/storytime-reading-macrobius-commentary-on-the-dream-of-scipio-part-i/", period: "christian-fathers", tags: ['Commentary on the Dream of Scipio'] },
  { number: 271, title: "Storytime: Reading Macrobius' Commentary on the Dream of Scipio, Part II", url: "https://shwep.net/podcast/storytime-reading-macrobius-commentary-on-the-dream-of-scipio-part-ii/", period: "christian-fathers", tags: ['Commentary on the Dream of Scipio'] },
];

const athenianAcademyEpisodes: ShwepEpisode[] = [
  { number: 181, title: "Macrobius and the Commentary on Scipio's Dream", url: "https://shwep.net/podcast/macrobius-and-the-commentary-on-scipios-dream/", period: "athenian-academy", tags: ['De insomniis', 'Dream of Scipio', 'Macrobius', 'Phaedo', 'Phaedrus', 'Timaeus'] },
  { number: 182, title: "Martiana on Martianus Capella and the Marriage of Philology and Mercury", url: "https://shwep.net/podcast/%e2%86%84-martiana-on-martianus-capella-and-the-marriage-of-philologia-and-mercury/", period: "athenian-academy", tags: ['De anima', 'De mysteriis', 'Iamblichus', 'Martianus Capella'] },
  { number: 183, title: "The Great God Pan Lives: Introducing the Athenian Academy", url: "https://shwep.net/podcast/the-great-god-pan-lives-introducing-the-athenian-academy/", period: "athenian-academy", tags: ['De anima', 'Frogs', 'Proclus'] },
  { number: 184, title: "Hierocles of Alexandria and the Pythagorean Golden Verses", url: "https://shwep.net/podcast/hierocles-of-alexandria-and-the-pythagorean-golden-verses/", period: "athenian-academy", tags: ['Plotinus', 'Hierocles'] },
  { number: 185, title: "Dylan Burns on Proclus the Successor", url: "https://shwep.net/podcast/dylan-burns-on-proclus-the-successor/", period: "athenian-academy", tags: ['Corpus Hermeticum', 'Elements of Theology', 'Pistis Sophia', 'Poimandres', 'Proclus'] },
  { number: 186, title: "The Esoteric Proclus, Part I: The Life and Thought of an Esoteric Sage", url: "https://shwep.net/podcast/the-esoteric-proclus-part-i-the-life-and-thought-of-an-esoteric-sage/", period: "athenian-academy", tags: ['Chronographia', 'De anima', 'De mysteriis', 'Elements of Theology', 'Proclus'] },
  { number: 187, title: "The Esoteric Proclus, Part II: Esoteric Exegesis and the Occult Ontology of Language", url: "https://shwep.net/podcast/the-esoteric-proclus-part-ii-esoteric-exegesis-and-the-occult-ontology-of-language/", period: "athenian-academy", tags: ['Proclus'] },
  { number: 188, title: "Graeme Miles on Proclus the Commentator", url: "https://shwep.net/podcast/graeme-miles-on-proclus-the-commentator/", period: "athenian-academy", tags: ['De anima', 'Iamblichus on The Mysteries', 'Proclus', 'Timaeus'] },
  { number: 189, title: "Danielle Layne on Proclus' Religious Life and Thought", url: "https://shwep.net/podcast/danielle-layne-on-proclus-religious-life-and-thought/", period: "athenian-academy", tags: ['Proclus'] },
  { number: 190, title: "Edward Watts on the Age of Justinian and the Closing of the Athenian Academy", url: "https://shwep.net/podcast/edward-watts-on-the-age-of-justinian-and-the-closing-of-the-athenian-academy/", period: "athenian-academy", tags: ['Damascius', 'Marinus', 'Proclus', 'Protrepticus'] },
  { number: 191, title: "Kevin van Bladel on the Sabians of Harran and the Fate of the Athenian Academy", url: "https://shwep.net/podcast/kevin-van-bladel-on-the-%e1%b9%a3abians-of-%e1%b8%a5arran-and-the-fate-of-the-athenian-academy/", period: "athenian-academy", tags: ['Asclepius', 'De anima', 'De mysteriis', 'Iamblichus on The Mysteries', 'Protrepticus'] },
  { number: 192, title: "Hagia Sophia and the Problem of 'Esoteric Architecture'", url: "https://shwep.net/podcast/hagia-sophia-and-the-problem-of-esoteric-architecture/", period: "athenian-academy", tags: ['De anima', 'Procopius'] },
  { number: 193, title: "All from Nothing: Sara Rappe on Damascius", url: "https://shwep.net/podcast/all-from-nothing-sara-rappe-on-damascius/", period: "athenian-academy", tags: ['Damascius', 'De anima', 'De mysteriis', 'Corpus Hermeticum', 'Corpus Hermeticum', 'Iamblichus on The Mysteries', 'Poimandres'] },
  { number: 194, title: "The Last Platonists? Philosophic Teaching, Christianity, and Polytheism in Late-Antique Alexandria", url: "https://shwep.net/podcast/the-last-platonists-philosophic-teaching-christianity-and-polytheism-in-late-antique-alexandria/", period: "athenian-academy", tags: ['De anima', 'De mysteriis', 'Horapollo', 'Olympiodorus'] },
  { number: 195, title: "Contested Esotericisms at the End of Antiquity: Simplicius, Philoponus, and Olympiodorus", url: "https://shwep.net/podcast/contested-esotericisms-at-the-end-of-antiquity-simplicius-philoponus-and-olympiodorus/", period: "athenian-academy", tags: ['De anima', 'John Philoponus', 'Olympiodorus', 'Simplicius'] },
  // Oddcasts, storytimes, and supplementary episodes (215+)
  { number: 267, title: "Storytime: Reading Cicero's Dream of Scipio", url: "https://shwep.net/podcast/storytime-reading-ciceros-dream-of-scipio/", period: "athenian-academy", tags: ['Dream of Scipio'] },
  { number: 269, title: "Ↄ. Martiana Rises to the Occasion", url: "https://shwep.net/podcast/%e2%86%84-martiana-rises-to-the-occasion/", period: "athenian-academy", tags: ['Metamorphoses'] },
  { number: 274, title: "Storytime: Reading Hierocles on the Golden Verses, Part I", url: "https://shwep.net/podcast/storytime-reading-hierocles-on-the-golden-verses-part-i/", period: "athenian-academy", tags: ['Golden Verses', 'Life of Proclus'] },
  { number: 275, title: "Storytime: Reading Hierocles on the Golden Verses, Part II", url: "https://shwep.net/podcast/storytime-reading-hierocles-on-the-golden-verses-part-ii/", period: "athenian-academy", tags: ['Golden Verses'] },
  { number: 280, title: "Dylan Burns with the Noetic Fire: On Proclus and Christianity", url: "https://shwep.net/podcast/dylan-burns-with-the-noetic-fire-on-proclus-and-christianity/", period: "athenian-academy", tags: ['Life of Proclus'] },
  { number: 282, title: "Edward Butler on Proclus, Part I: 'Henadology'", url: "https://shwep.net/podcast/edward-butler-on-proclus-part-i-henadology/", period: "athenian-academy", tags: ['Platonic Theology'] },
  { number: 283, title: "Edward Butler on Proclus, Part II: On (the Metaphysics of) Polytheism and Monotheism", url: "https://shwep.net/podcast/edward-butler-on-proclus-part-ii-on-the-metaphysics-of-polytheism-and-monotheism/", period: "athenian-academy", tags: ['Elements of Theology'] },
  { number: 284, title: "Stephen Rego on the Nous in Proclus, Part I: Exegesis", url: "https://shwep.net/podcast/stephen-rego-on-the-nous-in-proclus-part-i-exegesis/", period: "athenian-academy", tags: ['Platonic Theology'] },
  { number: 285, title: "Stephen Rego on the Nous in Proclus, Part II: Metaphysics and Myth", url: "https://shwep.net/podcast/stephen-rego-on-the-nous-in-proclus-part-ii-metaphysics-and-myth/", period: "athenian-academy", tags: ['Platonic Theology'] },
  { number: 289, title: "Robbert van den Berg on Proclus' Hymns", url: "https://shwep.net/podcast/robbert-van-den-berg-on-proclus-hymns/", period: "athenian-academy", tags: ['Homeric Hymns'] },
  { number: 296, title: "Storytime: Reading Damascius' Philosophic History, Part I: Text, Context, and Themes", url: "https://shwep.net/podcast/storytime-reading-damascius-philosophic-history-part-i-text-context-and-themes/", period: "athenian-academy", tags: [] },
  { number: 297, title: "Michæl Griffin on the Higher Virtues in Late Platonism", url: "https://shwep.net/podcast/michael-griffin-on-the-higher-virtues-in-late-platonism/", period: "athenian-academy", tags: [] },
  { number: 298, title: "Storytime: Reading Damascius' Philosophic History, Part II: Theurgy and Philosophy at Late-Antique Athens and Alexandria", url: "https://shwep.net/podcast/storytime-reading-damascius-philosophic-history-part-ii-theurgy-and-philosophy-at-late-antique-athens-and-alexandria/", period: "athenian-academy", tags: [] },
  { number: 299, title: "Storytime: Reading Damascius' Philosophic History, Part III: The Breaking of the Golden Chain", url: "https://shwep.net/podcast/storytime-reading-damascius-philosophic-history-part-iii-the-breaking-of-the-golden-chain/", period: "athenian-academy", tags: [] },
  { number: 300, title: "An Apollonian Man: Plato at the End of Antiquity in the Anonymous Prolegomena", url: "https://shwep.net/podcast/an-apollonian-man-plato-at-the-end-of-antiquity-in-the-anonymous-prolegomena/", period: "athenian-academy", tags: [] },
];

const postAntiquityEpisodes: ShwepEpisode[] = [
  { number: 196, title: "One Empire, Many Names: Reading 'Byzantium' with Anthony Kaldellis", url: "https://shwep.net/podcast/one-empire-many-names-reading-byzantium-with-anthony-kaldellis/", period: "post-antiquity", tags: ['Michael Psellos'] },
  { number: 197, title: "Naming Divine Nothingness: Introducing the Pseudo-Dionysios", url: "https://shwep.net/podcast/naming-divine-nothingness-introducing-the-pseudo-dionysios/", period: "post-antiquity", tags: ['Pseudo-Dionysius', 'Dionysius the Areopagite', 'Rabanus Maurus'] },
  { number: 198, title: "The Pseudo-Dionysios, the Esoteric, and (Christian) Mysticism", url: "https://shwep.net/podcast/the-pseudo-dionysios-the-esoteric-and-christian-mysticism/", period: "post-antiquity", tags: ['Apologia', 'Dionysius the Areopagite', 'Pseudo-Dionysius'] },
  { number: 199, title: "Paul Pasquesi on the Book of the Holy Hierotheos", url: "https://shwep.net/podcast/paul-pasquesi-on-the-book-of-the-holy-hierotheos/", period: "post-antiquity", tags: ['De Mysteriis', 'De insomniis', 'De mysteriis', 'Corpus Hermeticum', 'Pseudo-Dionysius'] },
  { number: 200, title: "Introducing Islam", url: "https://shwep.net/podcast/introducing-islam/", period: "post-antiquity", tags: ['De mysteriis'] },
  { number: 201, title: "Matthew Melvin-Koushki on Islam, 'the West', and Western Esotericism", url: "https://shwep.net/podcast/matthew-melvin-koushki-on-islam-the-west-and-western-esotericism/", period: "post-antiquity", tags: [] },
  { number: 202, title: "Fred Donner on the History of Early Islam", url: "https://shwep.net/podcast/fred-donner-on-the-history-of-early-islam/", period: "post-antiquity", tags: [] },
  { number: 203, title: "Introducing the Qur'an, Part I: Revelation, Text, and History", url: "https://shwep.net/podcast/introducing-the-quran-part-i-revelation-text-and-history/", period: "post-antiquity", tags: ['Gospel of John'] },
  { number: 204, title: "Introducing the Qur'an, Part II: Ambiguity and Esoteric Themes", url: "https://shwep.net/podcast/introducing-the-quran-part-ii-ambiguity-and-esoteric-themes/", period: "post-antiquity", tags: ['Cratylus'] },
  { number: 205, title: "Introducing the Qur'an Part III: Qur'anic Texts vs. the Qur'an", url: "https://shwep.net/podcast/introducing-the-quran-part-iii-quranic-texts-vs-the-quran/", period: "post-antiquity", tags: ['Ars notoria', 'Asclepius'] },
  { number: 206, title: "Seventh-Century History for Students of Western Esotericism", url: "https://shwep.net/podcast/seventh-century-history-for-students-of-western-esotericism/", period: "post-antiquity", tags: ['Ascension of Isaiah'] },
  { number: 207, title: "Ahab Bdaiwi on 'Ali ibn Abi Talib, his Family, and the Origins of Shi'i Islam", url: "https://shwep.net/podcast/ahab-bdaiwi-on-ali-ibn-abi-%e1%b9%adalib-his-family-and-the-origins-of-shii-islam/", period: "post-antiquity", tags: ['Jabir ibn Hayyan'] },
  { number: 208, title: "Ahab Bdaiwi on the Rise of Shi'i Esotericism", url: "https://shwep.net/podcast/ahab-bdaiwi-on-the-rise-of-shii-esotericism/", period: "post-antiquity", tags: ['1 Enoch', 'Aramaic Incantation Texts from Nippur'] },
  { number: 209, title: "Touraj Daryaee on Zoroastrianism in the Seventh Century and Beyond", url: "https://shwep.net/podcast/touraj-daryaee-on-zoroastrianism-in-the-seventh-century-and-beyond/", period: "post-antiquity", tags: [] },
  { number: 210, title: "Jewish Apocalypse in the Seventh Century: Martha Himmelfarb on the Sefer Zerubbabel", url: "https://shwep.net/podcast/jewish-apocalypse-in-the-seventh-century-martha-himmelfarb-on-the-sefer-zerubbabel/", period: "post-antiquity", tags: [] },
  { number: 211, title: "Introducing the Apocalypse of the Pseudo-Methodios, with Christopher Bonura", url: "https://shwep.net/podcast/introducing-the-apocalypse-of-the-pseudo-methodios-with-christopher-bonura/", period: "post-antiquity", tags: ['Cave of Treasures', 'Iliad'] },
  { number: 212, title: "Esoteric Orthodoxy in East Rome: Jonathan Greig on Maximus the Confessor", url: "https://shwep.net/podcast/esoteric-orthodoxy-in-east-rome-jonathan-greig-on-maximus-the-confessor/", period: "post-antiquity", tags: ['Maximus the Confessor'] },
  { number: 213, title: "Philosophy and Occult Sciences at Constantinople: Maria Papathanassiou on Stephanos of Alexandria, Part I", url: "https://shwep.net/podcast/philosophy-and-occult-sciences-at-constantinople-maria-papathanassiou-on-stephanos-of-alexandria-part-i/", period: "post-antiquity", tags: ['Jewish Antiquities', 'Song of Songs', 'Stephanos of Alexandria', 'Testament of Solomon'] },
  { number: 214, title: "The Horoscope of Islam and The Alchemical Stone: Maria Papathanassiou on Stephanos of Alexandria, Part II", url: "https://shwep.net/podcast/the-horoscope-of-islam-and-the-alchemical-stone-maria-papathanassiou-on-stephanos-of-alexandria-part-ii/", period: "post-antiquity", tags: ['Corpus Hermeticum', 'Stephanos of Alexandria', 'Testament of Solomon', 'Theon of Alexandria'] },
  // Oddcasts, storytimes, and supplementary episodes (215+)
  { number: 302, title: "Unsaying the Divine Darkness: Exploring Dionysian Apophasis and Mysticism", url: "https://shwep.net/podcast/unsaying-the-divine-darkness-exploring-dionysian-apophasis-and-mysticism/", period: "post-antiquity", tags: ['Theologia Platonica'] },
  { number: 303, title: "Fake Apostles and Real Christianity: Exploring the 'Pseudo-' in the Pseudo-Dionysios", url: "https://shwep.net/podcast/fake-apostles-and-real-christianity-exploring-the-pseudo-in-the-pseudo-dionysios/", period: "post-antiquity", tags: ['Corpus Dionysiacum'] },
  { number: 307, title: "Westward Ho! with Matthew Melvin-Koushki", url: "https://shwep.net/podcast/westward-ho-with-matthew-melvin-koushki/", period: "post-antiquity", tags: [] },
  { number: 309, title: "Fred Donner on the History of the History of Early Islām", url: "https://shwep.net/podcast/fred-donner-on-the-history-of-the-history-of-early-islam/", period: "post-antiquity", tags: [] },
  { number: 320, title: "Jonathan Greig on the Question of Universal Salvation in Maximus", url: "https://shwep.net/podcast/jonathan-greig-on-the-question-of-universal-salvation-in-maximus/", period: "post-antiquity", tags: [] },
];

// ---------------------------------------------------------------------------
// Period definitions
// ---------------------------------------------------------------------------

export const SHWEP_PERIODS: ShwepPeriod[] = [
  {
    id: 'intro',
    name: 'Introductions & Methodology',
    description: 'Foundational concepts',
    dateRange: 'Various',
    episodes: introEpisodes,
  },
  {
    id: 'near-east',
    name: 'Ancient Near East & Early Traditions',
    description: 'Near-Eastern foundations',
    dateRange: '3000-600 BCE',
    episodes: nearEastEpisodes,
  },
  {
    id: 'pre-socratic',
    name: 'Pre-Socratic Philosophy',
    description: 'Early Greek thought',
    dateRange: '600-400 BCE',
    episodes: preSocraticEpisodes,
  },
  {
    id: 'plato',
    name: 'Plato & the Academy',
    description: 'Platonic philosophy',
    dateRange: '428-348 BCE',
    episodes: platoEpisodes,
  },
  {
    id: 'hellenistic',
    name: 'Hellenistic Period',
    description: 'From Aristotle to Philo',
    dateRange: '350 BCE - 50 CE',
    episodes: hellenisticEpisodes,
  },
  {
    id: 'roman',
    name: 'Roman Imperial Period',
    description: 'Rome, Middle Platonism, Hermetica',
    dateRange: '100 BCE - 250 CE',
    episodes: romanEpisodes,
  },
  {
    id: 'hermetica',
    name: 'Clement, Origen & the Hermetica',
    description: 'Early Christianity meets Greek wisdom',
    dateRange: '150-300 CE',
    episodes: hermeticaEpisodes,
  },
  {
    id: 'neoplatonism',
    name: 'Neoplatonism',
    description: 'Plotinus and successors',
    dateRange: '250-350 CE',
    episodes: neoplatonismEpisodes,
  },
  {
    id: 'iamblichus',
    name: 'Iamblichus & Theurgy',
    description: 'Theurgic Neoplatonism',
    dateRange: '250-400 CE',
    episodes: iamblichusEpisodes,
  },
  {
    id: 'late-magic',
    name: 'Magic, Alchemy & Late Antiquity',
    description: 'Jewish magic, Zosimus, late-antique religion',
    dateRange: '200-500 CE',
    episodes: lateMagicEpisodes,
  },
  {
    id: 'christian-fathers',
    name: 'Church Fathers & Late Empire',
    description: 'Cappadocians, Julian, Augustine',
    dateRange: '350-450 CE',
    episodes: christianFathersEpisodes,
  },
  {
    id: 'athenian-academy',
    name: 'Athenian Academy & Late Platonism',
    description: 'Proclus, Damascius, end of antiquity',
    dateRange: '400-529 CE',
    episodes: athenianAcademyEpisodes,
  },
  {
    id: 'post-antiquity',
    name: 'Byzantium, Pseudo-Dionysius & Islam',
    description: 'Post-antiquity transmission',
    dateRange: '500-700 CE',
    episodes: postAntiquityEpisodes,
  },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Flatten all episodes for easy iteration.
 */
export function getAllEpisodes(): ShwepEpisode[] {
  return SHWEP_PERIODS.flatMap(p => p.episodes);
}

/**
 * Get all unique author/text tags for search matching.
 */
export function getAllTags(): string[] {
  const tags = new Set<string>();
  for (const period of SHWEP_PERIODS) {
    for (const ep of period.episodes) {
      for (const tag of ep.tags) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags).sort();
}
