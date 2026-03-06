// Go through all 31 zero-match episodes and identify importable primary sources
// Separate primary sources (pre-1800) from modern scholarship

const missingByEpisode = {
  55: {
    title: 'Irenaeus and Hippolytus',
    works: ['Against Heresies', 'Further Greek Epigrams', 'Numerical Notation: A Comparative History', 'Refutation of All Heresies', 'Table Talk']
  },
  61: {
    title: '1 Enoch I',
    works: ['1 Enoch 1: A Commentary on the Book of 1 Enoch, Chapters 1–36; 81–108', '1 Enoch: A New Translation', '1 Enoch 2: A Commentary on the Book of 1 Enoch, Chapters 37–82', 'Apocalypsis Henochi Graece', 'Essays on the Book of Enoch and Other Early Jewish Texts and Traditions']
  },
  62: {
    title: '1 Enoch II',
    works: ['1 Enoch, Enochic Motifs, and Enoch in Early Christian Literature', 'Animal Apocalypse', 'Apocalypse of Weeks', 'Astronomical Book', 'Astronomie und Schöpfungsglaube', 'Book of Watchers', 'Enoch and Qumran Origins', 'Enoch and the Messiah Son of Man', 'Enochic Judaism', 'Epistle of Jude', 'Religious Development Between the Old and the New Testaments', 'Semeia', 'of George Synkellos']
  },
  63: {
    title: 'Hekhalot Literature',
    works: ['Ascent to Heaven in Jewish and Christian Apocalypses', 'Currents in Biblical Research', 'Descenders to the Chariot', 'Geniza-Fragmente zur Hekhalot-Literatur', 'Hekhalot Literature in Translation', 'Hekhalot Rabbati', 'Icons of Power', 'Jewish Gnosticism, Merkabah Mysticism, and Talmudic Tradition', 'Kairos', 'Konkordanz zur Hekhalot-Literatur', 'Major Trends in Jewish Mysticism', 'Synopse zur Hekhalot-Literatur', 'Übersetzung der Hekhalot-Literatur I–IV']
  },
  64: {
    title: 'Ancient Magic',
    works: ['Envisioning Magic', 'Gender Trouble', 'How to Do Things With Words', 'Icons of Power', 'Magic and Ritual in the Ancient World', 'Magic and Magicians in the Greco-Roman World', 'Playing the Other', 'Ritual Magic', 'Rome and Jerusalem', 'Scholastic Magic']
  },
  80: {
    title: 'Historical Jesus',
    works: ['Ante Pacem', 'Gospel Message and Hellenistic Culture', 'Jesus Remembered', 'Map Is Not Territory', 'Von Reimarus zu Wrede']
  },
  121: {
    title: 'Proclus',
    works: ['Derrida and Negative Theology', 'Downside Review', 'El labyrintho de la oscuridád', 'Labyrinths of the Neoplatonists', 'Letter to Socrates', 'Platonisms Ancient Modern and Postmodern', 'Procli diodochi philosophica minora']
  },
  123: {
    title: 'Origen',
    works: ['Origen: On First Principles']
  },
  147: { title: 'Unknown', works: [] },
  172: {
    title: 'Porphyry',
    works: ['Ammonius Origen and Plotinus', 'Book of Zoroaster', 'Chaldaean Oracles and Theurgy', 'Chaldæan Oracles', 'De abstinentia', 'De antro nympharum', 'Epistula ad Anebonem', 'International Journal of the Platonic Tradition', 'Letter to Anebo', 'Lettera ad Anebo', 'On the Styx', 'Porphyre', 'Porphyry against the Christians', 'Pythagoras Revived', 'Religion und Kritik in der Antike']
  },
  201: {
    title: 'Nicomachus / Pythagorean Arithmetic',
    works: ['Alphanumeric Cosmology from Greek into Arabic', 'Greece and Rome', 'Iamblichi theologumena arithmeticae', 'Iamblichus: On the Pythagorean Way of Life', 'Introduction to Arithmetic', 'Nicomachus of Gerasa: Introduction to Arithmetic', 'On Nicomachus Introduction to Arithmetic', 'On the Decad', 'On the Pythagorean Life', 'Theology of Arithmetic', 'Zahlen- und Buchstabensysteme']
  },
  202: { title: 'Unknown', works: [] },
  209: {
    title: 'Aramaic Magic',
    works: ['Archiv Orientální', 'Bavli Berakhot', 'Magic Spells and Formulae: Aramaic Incantations of Late Antiquity', 'Orality and Textuality in the Iranian World']
  },
  210: {
    title: 'Curse Tablets',
    works: ['Cambridge History of Magic and Witchcraft', 'Curse Tablets and Binding Spells', 'Defixionum Tabellae', 'In Blood and Ashes', 'Magic and Magicians in the Greco-Roman World', 'Magic in the Ancient World', 'Magic Ritual and Witchcraft', 'Magika Hiera', 'Oracles Curses and Risk', 'Roman Inscribed Tablets', 'Witchcraft and Magic in Europe']
  },
  225: {
    title: 'Mandaeans',
    works: ['From Sasanian Mandaeans to Sābians', 'Mandaeans of Iraq and Iran', 'Reisen im Orient', 'Études sur la religion des Soubbas']
  },
  226: {
    title: 'Gnostic',
    works: ['Eranos Jahrbuch', 'Hidden Wisdom']
  },
  229: {
    title: 'Spiritual Alchemy',
    works: ['Spiritual Alchemy: from Jacob Boehme to Mary Anne Atwood']
  },
  233: {
    title: 'Arabic Alchemy I',
    works: ['Book of Image', 'Collection des Anciens Alchimistes Grecs', 'Kitāb al-ṣuwar', 'Kitāb mafātīḥ al-ṣanʿah', 'Muṣḥaf al-ṣanʿah', 'Muṣḥaf al-ṣuwar', 'Private Epistles', 'Risalah fi-Bayān', 'Tome of Images', 'Tome of the Work', 'Treatise on the Divisions of Religions', 'Twelve Books', 'al-Rasāʾil al-khāṣṣah']
  },
  239: {
    title: 'Zosimos of Panopolis',
    works: ['Authentic Memoirs', 'Collection des Anciens Alchimistes Grecs', 'Der Alchemistentraum des Zosimus', 'Eranos Jahrbuch', 'Planetary Gods and Planetary Orders', 'Zosime de Panopolis: mémoires authentiques']
  },
  242: {
    title: 'Gregory of Nyssa',
    works: ['Gregory of Nyssa: On Death', 'Gregory of Nyssa: On the Human Image', 'Imitations of Infinity', 'In Illud: Tunc et Ipse Filius', 'Leontius of Byzantium']
  },
  250: {
    title: 'Late Antique Theurgy',
    works: ['Dictionnaire des philosophes antiques', 'Philostratus and Eunapius: Lives of the Sophists', 'Theurgy in Late Antiquity']
  },
  260: {
    title: 'Modern',
    works: ['Determined: A Science of Life without Free Will', 'Modern Social Imaginaries']
  },
  264: {
    title: 'Augustine and Plotinus',
    works: ['Gregory of Nyssa and the Grasp of Faith', 'Augustine Early Theory of Man', 'Le problème de la matière chez Plotin', 'Recherches sur les Confessions', 'Saint Augustine Confessions: Odyssey of Soul', 'libri Platonicorum']
  },
  290: {
    title: 'Early Christian Material Culture',
    works: ['Byzantine Pilgrimage Art', 'Early Christian Books in Egypt', 'Guide to the Study of Ancient Magic', 'Ritual Boundaries']
  },
  296: {
    title: 'Damascius I',
    works: ['Byzantinische Zeitschrift', 'Damascii vitæ Isidori reliquiæ', 'Damascius: The Philosophic History', 'Das Leben des Philosophen Isidoros', 'Life of Isidore', 'Lives of the Sophists', 'Philosophic History', 'Philostratus and Eunapius: Lives of the Sophists', 'Suidæ lexicon']
  },
  297: {
    title: 'Damascius II',
    works: ['Philosophical History', 'Philosophical History/Life of Isidore']
  },
  298: {
    title: 'Damascius III',
    works: ['Dionysiaka', 'Heliodori in Paulum Alexandrinum', 'Life of Severus', 'Philosophic History', 'Suidæ lexicon', 'Zacharie le Scholastique Vie de Sévèr']
  },
  300: {
    title: 'Anonymous Prolegomena',
    works: ['Anonymous Prolegomena', 'Anonymous Prolegomena to Platonic Philosophy', 'Diogenes Laertius: Lives of the Eminent Philosophers', 'Olympiodorus: Life of Plato']
  },
  307: {
    title: 'Esotericism in Islam',
    works: ['Hellebore', 'History of Science', 'Studia Islamica', 'Translating Esotericism']
  },
  309: {
    title: 'Early Islam',
    works: ['Hagarism', 'Muhammedanische Studien', 'Quranic Studies']
  },
  320: {
    title: 'Maximus the Confessor',
    works: ['Ambigua', 'Ambiguum', 'Leontius of Byzantium: Complete Works', 'On the Difficulties of the Church Fathers: The Ambigua']
  },
};

// Now classify each work
console.log('=== PRIMARY SOURCES (importable, pre-1800 or ancient/medieval texts) ===\n');

const primarySources = [];

// Manually classify — these are the ones worth importing
const candidates = [
  // Ep 55
  { ep: 55, title: 'Adversus Haereses (Against Heresies)', author: 'Irenaeus of Lyon', century: '2nd c.', language: 'Greek/Latin', searchTerms: ['Irenaeus adversus haereses', 'Irenaeus against heresies'] },
  { ep: 55, title: 'Refutatio Omnium Haeresium (Refutation of All Heresies)', author: 'Hippolytus of Rome', century: '3rd c.', language: 'Greek/Latin', searchTerms: ['Hippolytus refutation heresies', 'Philosophumena Hippolytus'] },
  { ep: 55, title: 'Quaestiones Convivales (Table Talk)', author: 'Plutarch', century: '2nd c.', language: 'Greek/Latin', searchTerms: ['Plutarch table talk', 'Plutarch quaestiones convivales', 'Plutarch symposiacs'] },

  // Ep 61-62 (Enoch)
  { ep: [61,62], title: 'Book of Enoch (1 Enoch)', author: 'attributed to Enoch', century: '3rd c. BCE–1st c. CE', language: 'Ethiopic/Greek', searchTerms: ['Book of Enoch', 'Liber Henoch', '1 Enoch'] },
  { ep: [61,62], title: 'Apocalypsis Henochi Graece', author: 'ed. various', century: 'ancient', language: 'Greek', searchTerms: ['Apocalypsis Henochi'] },

  // Ep 63 (Hekhalot)
  { ep: 63, title: 'Hekhalot Rabbati', author: 'anonymous', century: '5th–7th c.', language: 'Hebrew', searchTerms: ['Hekhalot Rabbati', 'Hekhalot'] },

  // Ep 121 (Proclus)
  { ep: 121, title: 'Procli Philosophica Minora / Epistolae', author: 'Proclus', century: '5th c.', language: 'Greek/Latin', searchTerms: ['Proclus philosophica minora', 'Proclus epistolae', 'Procli diodochi'] },

  // Ep 123 (Origen)
  { ep: 123, title: 'De Principiis (On First Principles)', author: 'Origen', century: '3rd c.', language: 'Greek/Latin', searchTerms: ['Origen de principiis', 'Origen first principles', 'Origenis de principiis'] },

  // Ep 172 (Porphyry)
  { ep: 172, title: 'De Abstinentia (On Abstinence)', author: 'Porphyry', century: '3rd c.', language: 'Greek/Latin', searchTerms: ['Porphyry de abstinentia', 'Porphyrii de abstinentia'] },
  { ep: 172, title: 'De Antro Nympharum (On the Cave of the Nymphs)', author: 'Porphyry', century: '3rd c.', language: 'Greek/Latin', searchTerms: ['Porphyry de antro nympharum', 'cave of the nymphs Porphyry'] },
  { ep: 172, title: 'Epistula ad Anebonem (Letter to Anebo)', author: 'Porphyry', century: '3rd c.', language: 'Greek/Latin', searchTerms: ['Porphyry letter Anebo', 'epistula ad Anebonem'] },
  { ep: 172, title: 'Adversus Christianos (Against the Christians)', author: 'Porphyry', century: '3rd c.', language: 'Greek/Latin', searchTerms: ['Porphyry against Christians', 'Porphyrii adversus Christianos'] },
  { ep: 172, title: 'Oracula Chaldaica (Chaldaean Oracles)', author: 'attributed to Julian the Chaldean', century: '2nd c.', language: 'Greek/Latin', searchTerms: ['Chaldaean Oracles', 'Oracula Chaldaica'] },

  // Ep 201 (Nicomachus)
  { ep: 201, title: 'Introductio Arithmetica (Introduction to Arithmetic)', author: 'Nicomachus of Gerasa', century: '1st–2nd c.', language: 'Greek/Latin', searchTerms: ['Nicomachus introduction arithmetic', 'Nicomachi arithmetica'] },
  { ep: 201, title: 'Theologoumena Arithmeticae (Theology of Arithmetic)', author: 'Iamblichus (attributed)', century: '4th c.', language: 'Greek/Latin', searchTerms: ['Theologoumena arithmeticae', 'Iamblichus theology arithmetic', 'Iamblichi theologumena'] },
  { ep: 201, title: 'De Vita Pythagorica (On the Pythagorean Life)', author: 'Iamblichus', century: '4th c.', language: 'Greek/Latin', searchTerms: ['Iamblichus vita Pythagorica', 'Iamblichus Pythagorean life'] },

  // Ep 225 (Mandaeans)
  { ep: 225, title: 'Reisen im Orient', author: 'Carsten Niebuhr', century: '1774-1778', language: 'German', searchTerms: ['Niebuhr Reisen Orient'] },
  { ep: 225, title: 'Études sur la religion des Soubbas ou Sabéens', author: 'Abraham Hyacinthe Anquetil-Duperron', century: '1760s', language: 'French', searchTerms: ['Études religion Soubbas Sabéens'] },

  // Ep 233/239 (Greek Alchemy)
  { ep: [233,239], title: 'Collection des Anciens Alchimistes Grecs', author: 'Marcellin Berthelot', century: '1887-1888', language: 'French/Greek', searchTerms: ['Berthelot alchimistes grecs', 'Collection anciens alchimistes'] },

  // Ep 242 (Gregory of Nyssa)
  { ep: 242, title: 'Works of Gregory of Nyssa', author: 'Gregory of Nyssa', century: '4th c.', language: 'Greek/Latin', searchTerms: ['Gregory Nyssa opera', 'Gregorii Nysseni'] },

  // Ep 250/296 (Eunapius/Philostratus)
  { ep: [250,296], title: 'Vitae Sophistarum (Lives of the Sophists)', author: 'Eunapius / Philostratus', century: '3rd–5th c.', language: 'Greek/Latin', searchTerms: ['Eunapius lives sophists', 'Philostratus lives sophists', 'vitae sophistarum'] },

  // Ep 296-298 (Damascius)
  { ep: [296,297,298], title: 'Vita Isidori / Philosophic History', author: 'Damascius', century: '6th c.', language: 'Greek/Latin', searchTerms: ['Damascius vita Isidori', 'Damascius philosophic history', 'Damascii vitae Isidori'] },
  { ep: 296, title: 'Suidæ Lexicon (Suda)', author: 'anonymous', century: '10th c.', language: 'Greek/Latin', searchTerms: ['Suidae lexicon', 'Suda lexicon'] },

  // Ep 298
  { ep: 298, title: 'Vie de Sévère (Life of Severus)', author: 'Zacharias Scholasticus', century: '6th c.', language: 'Syriac/Greek', searchTerms: ['Zacharias Scholasticus Severus', 'Vie de Sévère'] },

  // Ep 300
  { ep: 300, title: 'Lives of the Eminent Philosophers', author: 'Diogenes Laertius', century: '3rd c.', language: 'Greek/Latin', searchTerms: ['Diogenes Laertius lives philosophers', 'Diogenis Laertii'] },
  { ep: 300, title: 'Prolegomena to Platonic Philosophy', author: 'Anonymous (6th c.)', century: '6th c.', language: 'Greek/Latin', searchTerms: ['Prolegomena Platonic philosophy', 'Anonymous prolegomena'] },

  // Ep 309
  { ep: 309, title: 'Muhammedanische Studien', author: 'Ignaz Goldziher', century: '1889-1890', language: 'German', searchTerms: ['Goldziher Muhammedanische Studien'] },

  // Ep 320 (Maximus)
  { ep: 320, title: 'Ambigua (On Difficulties)', author: 'Maximus the Confessor', century: '7th c.', language: 'Greek/Latin', searchTerms: ['Maximus Confessor Ambigua', 'Maximi Confessoris Ambigua'] },
];

for (const c of candidates) {
  const eps = Array.isArray(c.ep) ? c.ep : [c.ep];
  console.log(`[Ep ${eps.join(',')}] ${c.title}`);
  console.log(`  Author: ${c.author} | Date: ${c.century} | Language: ${c.language}`);
  console.log(`  Search: ${c.searchTerms.join(' | ')}`);
  console.log();
}

console.log(`\nTotal primary source candidates: ${candidates.length}`);

console.log('\n\n=== EPISODES WITH ONLY MODERN SCHOLARSHIP (no primary sources to import) ===\n');
const modernOnly = [64, 80, 202, 209, 210, 226, 229, 260, 264, 290, 307, 147];
for (const ep of modernOnly.sort((a,b) => a-b)) {
  const info = missingByEpisode[ep];
  console.log(`Ep ${ep}: ${info.title} — ${info.works.length ? 'all modern secondary lit' : 'no data'}`);
}
