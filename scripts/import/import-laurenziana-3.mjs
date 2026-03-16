#!/usr/bin/env node
/**
 * Batch import Laurenziana manuscripts — Batch 3
 * Occult, Ficino, Medicine, Boethius, Dante, Vitruvius, Music, Archimedes, Boccaccio
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-laurenziana-3.mjs
 */

const API_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';
const API_KEY = process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!API_KEY) {
  console.error('Missing CRON_SECRET. Source .env.production.local first.');
  process.exit(1);
}

const CONTRIBUTING_LIBRARY = 'Biblioteca Medicea Laurenziana';
const PROVIDER = 'Biblioteca Medicea Laurenziana';
const CDM_BASE = 'https://cdm21059.contentdm.oclc.org/iiif/plutei:';

const MANUSCRIPTS = [
  // ===== MAGIC / OCCULT / DIVINATION =====
  { cdm_id: '956392', shelfmark: 'Plut.88.25', title: 'Ethica Aristotelis / Albumasar Alpharabi de Intellectu / De Anima', display_title: 'Albumasar on Intellect (with Aristotle Ethics)', author: 'Albumasar; Aristotle; Al-Farabi', language: 'Latin', published: '14th century', categories: ['Astrology', 'Philosophy'] },
  { cdm_id: '735968', shelfmark: 'Plut.28.33', title: 'De mundanis apotelesmatibus excerptum ex libro Albumasaris', display_title: 'Albumasar, On Celestial Influences and Fate', author: 'Abu Ma\'shar (Albumasar)', language: 'Latin', published: '16th century', categories: ['Astrology'] },
  { cdm_id: '607275', shelfmark: 'Plut.30.29', title: 'Hugonis Satiliensis geomantia et alia aliorum opera', display_title: 'Hugh of Santalla, Geomancy (Arabic divination)', author: 'Hugh of Santalla', language: 'Latin', published: '13th century', categories: ['Magic', 'Astrology'] },
  { cdm_id: '535003', shelfmark: 'Plut.29.2', title: 'L. Apuleius de magia / metamorphoseon libri XI / floridorum libri IV', display_title: 'Apuleius, On Magic & The Golden Ass (12th-century copy)', author: 'Apuleius', language: 'Latin', published: '12th century', categories: ['Magic', 'Philosophy'] },
  { cdm_id: '254214', shelfmark: 'Plut.15 sin.9', title: 'Aristotelis De secretis secretorum / Boethii Liber de unitate / Algazelis Liber de scientia divina', display_title: 'Secretum Secretorum (pseudo-Aristotle) & Al-Ghazali on Divine Science', author: 'Pseudo-Aristotle; Al-Ghazali; Boethius', language: 'Latin', published: '13th century', categories: ['Magic', 'Philosophy'] },
  { cdm_id: '1099654', shelfmark: 'Plut.88.43', title: 'Pars Avicennae / Tractatus Astrologicus', display_title: 'Avicenna & Astrological Treatise', author: 'Avicenna', language: 'Latin', published: '14th century', categories: ['Astrology', 'Philosophy'] },

  // ===== FICINO / NEOPLATONISM =====
  { cdm_id: '1005363', shelfmark: 'Plut.83.13', title: 'Ficini Expositio Mercurii Trismegisti', display_title: 'Ficino, Exposition on Hermes Trismegistus', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Hermetica', 'Neoplatonism'] },
  { cdm_id: '1232803', shelfmark: 'Plut.73.39', title: 'Ficini De triplici vita', display_title: 'Ficino, Three Books on Life (talismanic magic & celestial medicine)', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Magic'] },
  { cdm_id: '925385', shelfmark: 'Plut.83.11', title: 'Marsilii Ficini Theologia platonica', display_title: 'Ficino, Platonic Theology (on the immortality of the soul)', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '950250', shelfmark: 'Plut.83.10', title: 'Marsilii Ficini De immortalitate animorum', display_title: 'Ficino, On the Immortality of Souls', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '1049783', shelfmark: 'Plut.76.73', title: 'Marsilii Ficini Liber de amore', display_title: 'Ficino, Commentary on Plato\'s Symposium (De Amore)', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '909855', shelfmark: 'Plut.83.12', title: 'Marsilii Ficini In theologiam platonicam', display_title: 'Ficino, On Platonic Theology (second copy)', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '969639', shelfmark: 'Plut.90 sup.43', title: 'Marsilii Ficini Epistolae', display_title: 'Ficino, Letters (dated October 1480)', author: 'Marsilio Ficino', language: 'Latin', published: '1480', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '1032500', shelfmark: 'Plut.90 sup.40', title: 'Marsili Ficini Epistolarum liber I', display_title: 'Ficino, Letters, Book I', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '817183', shelfmark: 'Plut.51.11', title: 'Marsilii Ficini Epistolae', display_title: 'Ficino, Letters (third manuscript)', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '240515', shelfmark: 'Plut.21.9', title: 'Marsilius Ficinus de christiana religione', display_title: 'Ficino, On the Christian Religion', author: 'Marsilio Ficino', language: 'Latin', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '935503', shelfmark: 'Plut.85.6', title: 'Plato / Platonis Dialogi', display_title: 'Plato, Dialogues (12th-century Greek manuscript)', author: 'Plato', language: 'Greek', published: '12th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '1149745', shelfmark: 'Plut.83.18', title: 'Quaestiones VII propositae a Laurentio Medice in carmine quodam', display_title: 'Lorenzo de\' Medici, Seven Philosophical Questions in Verse', author: 'Lorenzo de\' Medici', language: 'Latin', published: '16th century (1501–1510)', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '1097667', shelfmark: 'Plut.86.8', title: 'Aelianus De proprietate animalium', display_title: 'Aelian, On the Nature of Animals', author: 'Aelian', language: 'Greek', published: '15th century', categories: ['Philosophy'] },

  // ===== ARCHIMEDES =====
  { cdm_id: '475612', shelfmark: 'Plut.28.4', title: 'Archimedis De sphaera et cylindro / Eutocius / Heron', display_title: 'Archimedes, On Sphere and Cylinder (with Eutocius & Heron)', author: 'Archimedes; Eutocius; Heron of Alexandria', language: 'Greek', published: '13th century', categories: ['Philosophy'] },

  // ===== MEDICINE =====
  { cdm_id: '1241524', shelfmark: 'Plut.74.7', title: 'Hippocratis Chirurgica', display_title: 'Hippocrates, Surgical Works (10th/11th-century copy)', author: 'Hippocrates', language: 'Greek', published: '10th–11th century', categories: ['Philosophy'] },
  { cdm_id: '1238059', shelfmark: 'Plut.74.2', title: 'Paulli Aeginetae medici optimi libri septem', display_title: 'Paul of Aegina, Seven Books of Medicine (10th/11th-century copy)', author: 'Paul of Aegina', language: 'Greek', published: '10th–11th century', categories: ['Philosophy'] },
  { cdm_id: '1233574', shelfmark: 'Plut.73.41', title: 'Ant. Musae Herbarium / Apuleii Platonici / Dioscordis De herbis', display_title: 'Herbarium of Apuleius & Dioscorides On Herbs (c. 1000 AD)', author: 'Pseudo-Apuleius; Dioscorides; Antonius Musa', language: 'Latin', published: 'c. 1000', categories: ['Philosophy'] },
  { cdm_id: '1225640', shelfmark: 'Plut.73.14', title: 'Avicennae Canon', display_title: 'Avicenna, Canon of Medicine', author: 'Avicenna (Ibn Sina)', language: 'Latin', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1232160', shelfmark: 'Plut.73.37', title: 'Trotuli Regulae medicinales in utilitatem mulierum scriptae', display_title: 'Trotula, Rules of Medicine for Women (13th-century copy)', author: 'Trota of Salerno', language: 'Latin', published: '13th century (1291–1300)', categories: ['Philosophy'] },
  { cdm_id: '992913', shelfmark: 'Plut.74.17', title: 'Oribasii Libri medicinales IX', display_title: 'Oribasius, Medical Books (physician to Julian the Apostate)', author: 'Oribasius', language: 'Greek', published: '12th century', categories: ['Philosophy'] },
  { cdm_id: '1008298', shelfmark: 'Plut.74.11', title: 'Hippocratis Aphorismi cum expositione / opera medica', display_title: 'Hippocrates, Aphorisms with Commentary', author: 'Hippocrates', language: 'Greek', published: '13th century', categories: ['Philosophy'] },
  { cdm_id: '1003690', shelfmark: 'Plut.74.30', title: 'Galenus De locis adfectis', display_title: 'Galen, On Affected Places', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '990986', shelfmark: 'Plut.74.9', title: 'Galenus De usu partium corporis humani', display_title: 'Galen, On the Use of Parts of the Human Body', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1240638', shelfmark: 'Plut.74.6', title: 'Galeni Methodus medendi', display_title: 'Galen, Method of Healing', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1228376', shelfmark: 'Plut.73.21', title: 'Ioannitii Introductio ad artem parvam Galeni', display_title: 'Johannitius (Hunain ibn Ishaq), Introduction to Galen\'s Ars Medica', author: 'Hunain ibn Ishaq; Galen', language: 'Latin', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1226475', shelfmark: 'Plut.73.15', title: 'Avicenna', display_title: 'Avicenna, Medical Works', author: 'Avicenna (Ibn Sina)', language: 'Latin', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1166166', shelfmark: 'Plut.88.27', title: 'Avicenna / Eiusdem aliquot Libri', display_title: 'Avicenna, Selected Books', author: 'Avicenna (Ibn Sina)', language: 'Latin', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '98000', shelfmark: 'Plut.18 sin.8', title: 'Avicennae Practica', display_title: 'Avicenna, Medical Practice', author: 'Avicenna (Ibn Sina)', language: 'Latin', published: '13th century', categories: ['Philosophy'] },
  { cdm_id: '1151812', shelfmark: 'Plut.84.17', title: 'Alexandri Expositio in librum meteorologicorum / Avicennae De anima', display_title: 'Avicenna, On the Soul (Latin) & Alexander on Meteorology', author: 'Avicenna; Alexander of Aphrodisias', language: 'Latin', published: '13th century', categories: ['Philosophy'] },
  { cdm_id: '973793', shelfmark: 'Plut.74.18', title: 'Galeni De usu partium corporis humani', display_title: 'Galen, On the Use of Parts (second copy)', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '986163', shelfmark: 'Plut.74.10', title: 'Galeni Anatomicae aggressiones', display_title: 'Galen, Anatomical Procedures', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '974007', shelfmark: 'Plut.75.14', title: 'Alexandri medici De febribus / Galeni Opera quaedam', display_title: 'Alexander of Tralles, On Fevers (with Galen)', author: 'Alexander of Tralles; Galen', language: 'Greek', published: '1491', categories: ['Philosophy'] },
  { cdm_id: '1062688', shelfmark: 'Plut.75.9', title: 'Actuarius De urinis', display_title: 'Actuarius, On Urines (Byzantine diagnostic medicine)', author: 'John Actuarius', language: 'Greek', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '1239705', shelfmark: 'Plut.74.4', title: 'Galeni De usu partium corporis humani', display_title: 'Galen, On the Use of Parts (third copy)', author: 'Galen', language: 'Greek', published: 'Unknown', categories: ['Philosophy'] },
  { cdm_id: '1099354', shelfmark: 'Plut.74.8', title: 'Galeni in Aphorismos Hippocratis commentarius', display_title: 'Galen, Commentary on Hippocrates\' Aphorisms', author: 'Galen; Hippocrates', language: 'Greek', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '1239188', shelfmark: 'Plut.74.3', title: 'Galeni Varia', display_title: 'Galen, Miscellaneous Works (12th-century copy)', author: 'Galen', language: 'Greek', published: '12th century', categories: ['Philosophy'] },
  { cdm_id: '1240116', shelfmark: 'Plut.74.5', title: 'Galeni De elementis', display_title: 'Galen, On the Elements', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1034644', shelfmark: 'Plut.74.28', title: 'Galeni De differentiis pulsuum', display_title: 'Galen, On the Differences of Pulses', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1224084', shelfmark: 'Plut.73.10', title: 'Galeni Ars medica', display_title: 'Galen, The Art of Medicine', author: 'Galen', language: 'Greek', published: '15th century (1401–1410)', categories: ['Philosophy'] },
  { cdm_id: '993494', shelfmark: 'Plut.74.22', title: 'Galeni De purgantibus medicamentis', display_title: 'Galen, On Purgative Medicines', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1026615', shelfmark: 'Plut.74.16', title: 'Galeni De morborum differentiis', display_title: 'Galen, On the Differences of Diseases', author: 'Galen', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1237265', shelfmark: 'Plut.74.1', title: 'Hipocrates / Ippokrates', display_title: 'Hippocrates, Medical Works', author: 'Hippocrates', language: 'Greek', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '1126291', shelfmark: 'Plut.88.29', title: 'Liber medicinae / De medicina, Mosis filii Abor', display_title: 'Moses ibn Tibbon, On Medicine (Arabic-Hebrew-Latin)', author: 'Moses ibn Tibbon', language: 'Latin', published: '15th century', categories: ['Philosophy'] },

  // ===== MUSIC =====
  { cdm_id: '749776', shelfmark: 'Plut.29.48', title: 'Guidonis Arretini Musica et alii auctores musici', display_title: 'Guido of Arezzo, On Music (inventor of solfège)', author: 'Guido of Arezzo', language: 'Latin', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '629552', shelfmark: 'Plut.28.11', title: 'Manuel Bryenni Musica', display_title: 'Manuel Bryennius, Byzantine Music Theory', author: 'Manuel Bryennius', language: 'Greek', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '556982', shelfmark: 'Plut.29.16', title: 'D. Augustini De musica libri VI', display_title: 'Augustine, On Music (six books on rhythm and meter)', author: 'Augustine of Hippo', language: 'Latin', published: '15th century', categories: ['Philosophy'] },

  // ===== ARCHITECTURE =====
  { cdm_id: '575927', shelfmark: 'Plut.30.13', title: 'Vitruvii de architectura libri X', display_title: 'Vitruvius, On Architecture (13th-century copy)', author: 'Vitruvius', language: 'Latin', published: '13th century', categories: ['Philosophy'] },
  { cdm_id: '520214', shelfmark: 'Plut.30.10', title: 'Vitruvius De architectura / Cato De re rustica', display_title: 'Vitruvius, On Architecture & Cato, On Agriculture', author: 'Vitruvius; Cato', language: 'Latin', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '527431', shelfmark: 'Plut.30.12', title: 'Vitruvii de architectura libri X', display_title: 'Vitruvius, On Architecture (15th-century copy)', author: 'Vitruvius', language: 'Latin', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '458713', shelfmark: 'Plut.30.11', title: 'Vitruvii de architectura libri X', display_title: 'Vitruvius, On Architecture (third copy)', author: 'Vitruvius', language: 'Latin', published: '15th century', categories: ['Philosophy'] },

  // ===== BOETHIUS (selected — oldest/most important) =====
  { cdm_id: '692007', shelfmark: 'Plut.29.20', title: 'Boethii de arithmetica', display_title: 'Boethius, On Arithmetic (9th-century copy — one of oldest in collection)', author: 'Boethius', language: 'Latin', published: '9th century', categories: ['Philosophy'] },
  { cdm_id: '706100', shelfmark: 'Plut.23 dex.12', title: 'Severini Boethii Liber De trinitate', display_title: 'Boethius, On the Trinity (10th-century copy)', author: 'Boethius', language: 'Latin', published: '10th century', categories: ['Philosophy'] },
  { cdm_id: '947923', shelfmark: 'Plut.78.19', title: 'Boethius De consolatione characteribus longobardis script', display_title: 'Boethius, Consolation of Philosophy (12th c., Lombard script)', author: 'Boethius', language: 'Latin', published: '12th century', categories: ['Philosophy'] },
  { cdm_id: '910299', shelfmark: 'Plut.89 sup.82', title: 'Boethius De consolatione philosophiae', display_title: 'Boethius, Consolation of Philosophy (12th-century copy)', author: 'Boethius', language: 'Latin', published: '12th century', categories: ['Philosophy'] },
  { cdm_id: '1073173', shelfmark: 'Plut.78.21', title: 'Boethius De consolatione philosophiae', display_title: 'Boethius, Consolation of Philosophy (13th-century copy)', author: 'Boethius', language: 'Latin', published: '13th century', categories: ['Philosophy'] },
  { cdm_id: '967107', shelfmark: 'Plut.78.17', title: 'Boethius De consolatione philosophiae', display_title: 'Boethius, Consolation of Philosophy (14th-century copy)', author: 'Boethius', language: 'Latin', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1206467', shelfmark: 'Plut.71.21', title: 'Boethii Expositio in librum Perihermeneias Aristotelis', display_title: 'Boethius, Commentary on Aristotle\'s On Interpretation (12th c.)', author: 'Boethius', language: 'Latin', published: '12th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '517251', shelfmark: 'Plut.29.23', title: 'Boethii arithmetica', display_title: 'Boethius, On Arithmetic (13th-century copy)', author: 'Boethius', language: 'Latin', published: '13th century', categories: ['Philosophy'] },
  { cdm_id: '669094', shelfmark: 'Plut.29.19', title: 'Boethii geometria / L. Iunii Moderati geometria', display_title: 'Boethius, On Geometry (with other geometrical works)', author: 'Boethius', language: 'Latin', published: '14th century (1301–1310)', categories: ['Philosophy'] },
  { cdm_id: '998982', shelfmark: 'Plut.90 sup.125', title: 'Dantis Comoedia et Boethii Philosophica consolatio', display_title: 'Dante\'s Comedy & Boethius, Consolation of Philosophy', author: 'Dante Alighieri; Boethius', language: 'Latin; Italian', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1169979', shelfmark: 'Plut.89 sup.81', title: 'Severini Boethii Arithmetica', display_title: 'Boethius, On Arithmetic (12th-century copy)', author: 'Boethius', language: 'Latin', published: '12th century', categories: ['Philosophy'] },

  // ===== ARISTOTLE (selected commentaries) =====
  { cdm_id: '1217925', shelfmark: 'Plut.72.17', title: 'Aristotelis Praedicamenta / Ioannis Philoponi In analytica priora', display_title: 'Aristotle with John Philoponus Commentary on Prior Analytics', author: 'Aristotle; John Philoponus', language: 'Greek', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1078279', shelfmark: 'Plut.81.14', title: 'Aspasii Expositio VIIII librorum Aristotelis ad Nicomachum', display_title: 'Aspasius, Commentary on Aristotle\'s Nicomachean Ethics', author: 'Aspasius; Aristotle', language: 'Greek', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '944564', shelfmark: 'Plut.86.1', title: 'Scholia Olympiodori in Meteorologica Aristotelis', display_title: 'Olympiodorus, Scholia on Aristotle\'s Meteorology (Neoplatonic)', author: 'Olympiodorus; Aristotle', language: 'Greek', published: '15th century', categories: ['Neoplatonism', 'Philosophy'] },
  { cdm_id: '621615', shelfmark: 'Plut.28.45', title: 'Aristotelis Mechanica / Theophrasti Metaphysica', display_title: 'Pseudo-Aristotle, Mechanics & Theophrastus, Metaphysics', author: 'Pseudo-Aristotle; Theophrastus', language: 'Greek', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '1135873', shelfmark: 'Plut.76.77', title: 'Aristotelis De regimine principum liber', display_title: 'Pseudo-Aristotle, Secretum Secretorum (mirror for princes)', author: 'Pseudo-Aristotle', language: 'Latin', published: '14th century', categories: ['Magic', 'Philosophy'] },

  // ===== DANTE =====
  { cdm_id: '726237', shelfmark: 'Plut.26 sin.1', title: 'Dantis Comoedia', display_title: 'Dante, Divine Comedy (dated 1343)', author: 'Dante Alighieri', language: 'Italian', published: '1343', categories: ['Philosophy'] },
  { cdm_id: '1136954', shelfmark: 'Plut.90 sup.139', title: 'Iacobi Dantis filii Tabula metrica in Comoediam patris sui', display_title: 'Jacopo Dante, Metrical Index to his Father\'s Comedy', author: 'Jacopo Alighieri', language: 'Italian', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '714866', shelfmark: 'Plut.40.41', title: 'Dantis Convivium et alia', display_title: 'Dante, Convivio (philosophical treatise)', author: 'Dante Alighieri', language: 'Italian', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '468234', shelfmark: 'Plut.40.42', title: 'Vita Nova Dantis', display_title: 'Dante, Vita Nuova', author: 'Dante Alighieri', language: 'Italian', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '618933', shelfmark: 'Plut.40.10', title: 'Aliud exemplar Dantis Comoedia', display_title: 'Dante, Divine Comedy (14th-century copy)', author: 'Dante Alighieri', language: 'Italian', published: '14th century', categories: ['Philosophy'] },
  { cdm_id: '1437043', shelfmark: 'Plut.40.26', title: 'Aliud exemplar Dantis Comoedia', display_title: 'Dante, Divine Comedy (15th-century copy)', author: 'Dante Alighieri', language: 'Italian', published: '15th century', categories: ['Philosophy'] },

  // ===== BOCCACCIO =====
  { cdm_id: '1069423', shelfmark: 'Plut.90 sup.93', title: 'Io. Boccaccii Visio erotica', display_title: 'Boccaccio, Erotic Vision (Caccia di Diana)', author: 'Giovanni Boccaccio', language: 'Italian', published: '15th century', categories: ['Philosophy'] },
  { cdm_id: '986483', shelfmark: 'Plut.90 sup.104', title: 'Io. Boccaccii Corbaccius et Nymphale', display_title: 'Boccaccio, Corbaccio & Ninfale Fiesolano (dated 1414)', author: 'Giovanni Boccaccio', language: 'Italian', published: '1414', categories: ['Philosophy'] },
];

async function testManifest(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)', Accept: 'application/json, application/ld+json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const canvases = data.items?.length || data.sequences?.[0]?.canvases?.length || 0;
    return canvases > 1 ? { data, canvases } : null;
  } catch { return null; }
}

async function importBook(ms, manifestUrl, manifestData) {
  const res = await fetch(`${API_BASE}/api/import/iiif`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      manifest_url: manifestUrl, manifest_data: manifestData,
      title: ms.title, display_title: ms.display_title, author: ms.author,
      language: ms.language, published: ms.published, categories: ms.categories,
      provider: PROVIDER, contributing_library: CONTRIBUTING_LIBRARY, shelfmark: ms.shelfmark,
    }),
  });
  return res.json();
}

async function main() {
  console.log(`\nLaurenziana IIIF Import — Batch 3${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`API: ${API_BASE}`);
  console.log(`Manuscripts: ${MANUSCRIPTS.length}\n`);

  let imported = 0, failed = 0, skipped = 0;

  for (const ms of MANUSCRIPTS) {
    const manifestUrl = `${CDM_BASE}${ms.cdm_id}/manifest.json`;
    process.stdout.write(`[${ms.shelfmark}] ${ms.display_title}... `);

    const manifest = await testManifest(manifestUrl);
    if (!manifest) { console.log('SKIP (no working manifest)'); failed++; continue; }

    console.log(`${manifest.canvases} pages`);

    if (DRY_RUN) { console.log(`  -> Would import`); skipped++; continue; }

    try {
      const result = await importBook(ms, manifestUrl, manifest.data);
      if (result.success) {
        console.log(`  -> Imported: ${result.pagesCreated} pages`);
        imported++;
      } else if (result.error?.includes('already exists')) {
        console.log(`  -> Already exists (${result.existingId})`);
        skipped++;
      } else {
        console.log(`  -> Error: ${result.error}`);
        failed++;
      }
    } catch (err) { console.log(`  -> Error: ${err.message}`); failed++; }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
