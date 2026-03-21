// Static artwork data for the Visual Art Wing prototype
// This will eventually move to MongoDB — for now, self-contained

const R2 = 'https://images.sourcelibrary.org/artwork-prototype';

export interface Artist {
  slug: string;
  name: string;
  dates: string;
  nationality: string;
  bio: string;
  wikidata: string;
  portrait?: string;
}

export interface RelatedText {
  title: string;
  author: string;
  year: string;
  relationship: string;
  slug: string | null;
  hasTranslation: boolean;
}

export interface IconographicElement {
  element: string;
  significance: string;
  relatedBookSlug?: string;
}

export interface Artwork {
  slug: string;
  title: string;
  originalTitle?: string;
  artistSlug: string;
  date: string;
  medium: string;
  dimensions: string;
  location: string;
  resourceType: 'painting' | 'print' | 'drawing' | 'fresco';
  imageUrl: string;
  aspectRatio: number; // width / height for layout
  fullResUrl: string;
  license: string;
  wikidata: string;
  description: string;
  iconography: IconographicElement[];
  relatedTexts: RelatedText[];
  provenance: string;
}

// ─── Artists ─────────────────────────────────────────────────────────────────

export const ARTISTS: Record<string, Artist> = {
  'botticelli': {
    slug: 'botticelli',
    name: 'Sandro Botticelli',
    dates: '1445–1510',
    nationality: 'Florentine',
    bio: 'Alessandro di Mariano di Vanni Filipepi, known as Sandro Botticelli, was the painter closest to the Neoplatonic circle around Lorenzo de\' Medici and Marsilio Ficino. His mythological paintings — the Birth of Venus, Primavera, and Pallas and the Centaur — are visual translations of Ficino\'s philosophy: beauty as the soul\'s path back to the divine. In his later years, under the influence of Savonarola, he turned to intensely religious subjects, but the Neoplatonic sensibility never fully left his work.',
    wikidata: 'Q5669',
  },
  'raphael': {
    slug: 'raphael',
    name: 'Raphael',
    dates: '1483–1520',
    nationality: 'Italian',
    bio: 'Raffaello Sanzio da Urbino achieved what the Renaissance considered the perfection of painting. His Vatican frescoes — particularly the School of Athens — synthesize the entire classical and Neoplatonic philosophical tradition into a single visual program. Commissioned by Pope Julius II, the Stanza della Segnatura arranges human knowledge into Philosophy (School of Athens), Theology (Disputation of the Holy Sacrament), Poetry (Parnassus), and Law — the four faculties of the university, unified by Neoplatonic cosmology.',
    wikidata: 'Q5597',
  },
  'durer': {
    slug: 'durer',
    name: 'Albrecht Dürer',
    dates: '1471–1528',
    nationality: 'German',
    bio: 'The supreme printmaker of the Northern Renaissance. Dürer\'s engravings synthesize Italian humanist philosophy with Germanic craft tradition and esoteric symbolism. His three "master engravings" — Knight, Death, and the Devil; Melencolia I; and Saint Jerome in His Study — represent the three temperaments or paths of the active, contemplative, and scholarly life. His theoretical writings on proportion and measurement reflect the Neoplatonic belief that mathematical harmony underlies all beauty.',
    wikidata: 'Q5580',
  },
  'fra-angelico': {
    slug: 'fra-angelico',
    name: 'Fra Angelico',
    dates: 'c. 1395–1455',
    nationality: 'Florentine',
    bio: 'Guido di Pietro, known as Fra Angelico (the "Angelic Friar"), was a Dominican monk and painter whose works in the convent of San Marco, Florence, created the visual environment in which Ficino\'s Platonic Academy would later meet. His Annunciation — painted at the top of the dormitory stairs — combines Gothic luminosity with early Renaissance perspective, achieving what Ficino would later describe as the visible radiance of divine beauty. Cosimo de\' Medici, Ficino\'s patron, funded the rebuilding of San Marco.',
    wikidata: 'Q5664',
  },
};

// ─── Artworks ────────────────────────────────────────────────────────────────

export const ARTWORKS: Record<string, Artwork> = {
  'birth-of-venus': {
    slug: 'birth-of-venus',
    title: 'The Birth of Venus',
    originalTitle: 'La nascita di Venere',
    artistSlug: 'botticelli',
    date: 'c. 1484–1486',
    medium: 'Tempera on canvas',
    dimensions: '172.5 x 278.9 cm',
    location: 'Galleria degli Uffizi, Florence',
    resourceType: 'painting',
    imageUrl: `${R2}/birth-of-venus.jpg`,
    aspectRatio: 2560 / 1608,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg',
    license: 'Public Domain',
    wikidata: 'Q81689',
    description: `Commissioned by Lorenzo di Pierfrancesco de' Medici — a member of Ficino's inner circle — this painting depicts Venus arriving at the shore on a scallop shell, blown by Zephyr and the nymph Chloris, while a Hora offers her a flowered cloak.

The iconography draws directly from Marsilio Ficino's commentary on Plato's Symposium (De Amore), representing the birth of divine beauty into the material world. In Ficino's Neoplatonic cosmology, Venus embodies the soul's first moment of awareness of divine beauty — pulchritudo descending from the intelligible to the sensible realm.

The Venus Pudica pose follows classical Roman copies of Praxiteles' Aphrodite of Knidos, reinterpreted through Christian Neoplatonic theology — a synthesis Ficino explicitly advocated.`,
    iconography: [
      { element: 'Venus on shell', significance: 'The soul\'s descent into matter — beauty born from the sea of generation', relatedBookSlug: 'commentary-on-symposium-ficino' },
      { element: 'Zephyr & Chloris', significance: 'Divine breath (spiritus) animating earthly form. Zephyr represents the intellectual love that draws the soul toward beauty.' },
      { element: 'Hora offering cloak', significance: 'Modesty veiling divine beauty for the material world. The Horae guard cosmic order in Neoplatonic theology.' },
      { element: 'Roses', significance: 'Love\'s emanation from the divine. In Ficino\'s system, beauty begets love, love begets roses — the sensible sign of the intelligible.' },
      { element: 'Gold highlights', significance: 'Divine light (lumen) that Ficino describes as the medium of beauty\'s transmission from the One through Intellect to Soul.' },
    ],
    relatedTexts: [
      { title: 'Commentary on Plato\'s Symposium (De Amore)', author: 'Marsilio Ficino', year: '1484', relationship: 'Direct philosophical source. Ficino\'s theory of beauty emanating from the divine One is the conceptual program behind this painting.', slug: 'commentary-on-symposium-ficino', hasTranslation: true },
      { title: 'Platonic Theology', author: 'Marsilio Ficino', year: '1482', relationship: 'The systematic framework — soul as mediator between intelligible and sensible — that underlies Botticelli\'s entire mythological program.', slug: 'platonic-theology-ficino', hasTranslation: true },
      { title: 'Stanze per la giostra', author: 'Angelo Poliziano', year: '1478', relationship: 'Poliziano\'s poem describing Venus born from sea foam directly inspired the composition. Poliziano was Ficino\'s colleague in the Medici circle.', slug: null, hasTranslation: false },
    ],
    provenance: 'Commissioned by Lorenzo di Pierfrancesco de\' Medici for the Villa di Castello. Remained in the Medici collection until 1815 when it entered the Uffizi.',
  },
  'primavera': {
    slug: 'primavera',
    title: 'Primavera',
    originalTitle: 'La Primavera',
    artistSlug: 'botticelli',
    date: 'c. 1477–1482',
    medium: 'Tempera on panel',
    dimensions: '202 x 314 cm',
    location: 'Galleria degli Uffizi, Florence',
    resourceType: 'painting',
    imageUrl: `${R2}/primavera.jpg`,
    aspectRatio: 1.56,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Botticelli-primavera.jpg',
    license: 'Public Domain',
    wikidata: 'Q184458',
    description: `The most debated painting in Western art history. Over 500 scholarly interpretations exist. What is certain: it was painted for Lorenzo di Pierfrancesco de' Medici, Ficino's young student, and depicts an allegory of Spring set in the garden of Venus.

Reading right to left: Zephyr (the west wind) seizes the nymph Chloris, who transforms into Flora, scattering flowers. Central Venus presides, with Cupid above. The Three Graces dance, and Mercury at the far left disperses clouds with his caduceus.

Ficino's letter to Lorenzo di Pierfrancesco (1477) describes Venus as "Humanitas" — not the pagan goddess but a personification of the harmonious union of all virtues. This letter is widely considered the philosophical program for this painting.`,
    iconography: [
      { element: 'Venus (center)', significance: 'Humanitas — the harmonious union of all virtues, as Ficino described in his letter to the patron.' },
      { element: 'Three Graces', significance: 'The Neoplatonic triad of emanation, rapture, and return (processio, raptio, remeatio). Beauty flows out from the divine, is seized by love, and returns.' },
      { element: 'Mercury', significance: 'The guide of souls and interpreter between gods and humans. His caduceus disperses the clouds of ignorance.' },
      { element: 'Zephyr → Chloris → Flora', significance: 'Transformation: raw desire (Zephyr) seizes nature (Chloris) and is sublimated into beauty and culture (Flora).' },
      { element: 'Orange grove', significance: 'The Garden of the Hesperides — immortality. The Medici emblem included oranges (mala medica).' },
    ],
    relatedTexts: [
      { title: 'Letters to Lorenzo di Pierfrancesco', author: 'Marsilio Ficino', year: '1477', relationship: 'Ficino\'s letter describing Venus as Humanitas is considered the philosophical program for this painting.', slug: null, hasTranslation: false },
      { title: 'Commentary on Plato\'s Symposium (De Amore)', author: 'Marsilio Ficino', year: '1484', relationship: 'The theory of beauty and love that structures the entire allegorical program.', slug: 'commentary-on-symposium-ficino', hasTranslation: true },
      { title: 'De Rerum Natura', author: 'Lucretius', year: '1st century BCE', relationship: 'The invocation to Venus opening Book I — "goddess of beauty, mother of the race" — may be a direct source for the painting.', slug: null, hasTranslation: false },
    ],
    provenance: 'Commissioned by Lorenzo di Pierfrancesco de\' Medici. Displayed at the Villa di Castello. Entered the Uffizi collection in 1919.',
  },
  'pallas-and-centaur': {
    slug: 'pallas-and-centaur',
    title: 'Pallas and the Centaur',
    originalTitle: 'Pallade e il centauro',
    artistSlug: 'botticelli',
    date: 'c. 1482',
    medium: 'Tempera on canvas',
    dimensions: '207 x 148 cm',
    location: 'Galleria degli Uffizi, Florence',
    resourceType: 'painting',
    imageUrl: `${R2}/pallas-and-centaur.jpg`,
    aspectRatio: 0.71,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_Pallade_e_il_centauro_-_Google_Art_ProjectFXD.jpg',
    license: 'Public Domain',
    wikidata: 'Q546748',
    description: `Pallas Athena — goddess of wisdom — grasps the hair of a centaur, who submits without resistance. The allegory is transparently Neoplatonic: reason (Pallas) taming the passions (the centaur, half-human, half-beast).

Pallas wears a dress decorated with the Medici diamond ring emblem, connecting wisdom to the Medici political program. Her halberd is decorated with olive branches (peace through wisdom). The centaur carries a bow but does not use it — his bestial nature is subdued, not destroyed.

This painting hung alongside the Primavera in the Villa di Castello, suggesting they were conceived as a pair: beauty (Venus) and wisdom (Pallas) as the two faces of Ficinian Humanitas.`,
    iconography: [
      { element: 'Pallas Athena', significance: 'Wisdom, reason, the rational soul. Her calm dominance represents the Neoplatonic ideal of intellect governing the passions.' },
      { element: 'Centaur', significance: 'The lower soul — sensual, animal, passionate. Half-human: the passions are not alien to us but part of our nature.' },
      { element: 'Medici diamond rings', significance: 'On Pallas\'s dress — linking wisdom to Medici political authority and patronage.' },
      { element: 'Halberd with olive branches', significance: 'Peace achieved through wisdom, not violence.' },
    ],
    relatedTexts: [
      { title: 'Platonic Theology', author: 'Marsilio Ficino', year: '1482', relationship: 'The soul\'s rational faculty governing the irrational — the central thesis of Ficino\'s philosophical system.', slug: 'platonic-theology-ficino', hasTranslation: true },
      { title: 'Commentary on Plato\'s Symposium (De Amore)', author: 'Marsilio Ficino', year: '1484', relationship: 'The relationship between wisdom and beauty — Pallas and Venus as complementary aspects of the soul.', slug: 'commentary-on-symposium-ficino', hasTranslation: true },
    ],
    provenance: 'Hung alongside the Primavera at the Villa di Castello. Entered the Uffizi in 1922.',
  },
  'school-of-athens': {
    slug: 'school-of-athens',
    title: 'The School of Athens',
    originalTitle: 'Scuola di Atene',
    artistSlug: 'raphael',
    date: '1509–1511',
    medium: 'Fresco',
    dimensions: '500 x 770 cm',
    location: 'Apostolic Palace, Vatican City',
    resourceType: 'fresco',
    imageUrl: `${R2}/school-of-athens.jpg`,
    aspectRatio: 1.36,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Raphael_School_of_Athens.jpg',
    license: 'Public Domain',
    wikidata: 'Q213277',
    description: `The supreme visual statement of Renaissance humanism. Under an immense barrel vault (modeled on Bramante's designs for the new St. Peter's), the greatest philosophers of antiquity gather in an idealized space that unites Athens with Rome, paganism with Christianity, reason with faith.

At the center: Plato points upward (to the Forms, the intelligible) and Aristotle gestures outward (to nature, the sensible). They hold their respective masterworks — the Timaeus and the Ethics. This is Ficino's Neoplatonic hierarchy made visible: the transcendent and the immanent, reconciled.

Raphael gave Plato the face of Leonardo da Vinci, and Heraclitus (seated on the steps, writing) the face of Michelangelo. He painted himself at the far right, looking out at the viewer — the artist as witness to the philosophical tradition.`,
    iconography: [
      { element: 'Plato (pointing up)', significance: 'The transcendent realm of Forms. He holds the Timaeus — Ficino\'s most commented dialogue, source of Neoplatonic cosmology.' },
      { element: 'Aristotle (gesturing outward)', significance: 'The immanent, empirical world. He holds the Nicomachean Ethics — practical wisdom grounded in nature.' },
      { element: 'Pythagoras (lower left, writing)', significance: 'Mathematics as the path to the divine. Surrounded by students studying his harmonic ratios.' },
      { element: 'Heraclitus (seated on steps)', significance: 'The melancholic thinker — given Michelangelo\'s face. Added after Raphael saw the Sistine ceiling in progress.' },
      { element: 'Euclid (lower right, with compass)', significance: 'Geometry as divine knowledge. Given the face of Bramante, the architect.' },
      { element: 'Zoroaster & Ptolemy (far right)', significance: 'The astronomical tradition — Zoroaster holds a celestial globe, Ptolemy a terrestrial one.' },
    ],
    relatedTexts: [
      { title: 'Timaeus', author: 'Plato', year: 'c. 360 BCE', relationship: 'The book Plato holds in the painting. Ficino\'s translation and commentary made the Timaeus the foundational text of Renaissance cosmology.', slug: null, hasTranslation: false },
      { title: 'Platonic Theology', author: 'Marsilio Ficino', year: '1482', relationship: 'The systematic synthesis of Platonic philosophy that made this painting\'s philosophical program conceivable.', slug: 'platonic-theology-ficino', hasTranslation: true },
      { title: 'Enneads', author: 'Plotinus', year: '3rd century CE', relationship: 'The Neoplatonic source for the hierarchical cosmology depicted — the One emanating through Intellect to Soul to Nature.', slug: null, hasTranslation: false },
    ],
    provenance: 'Commissioned by Pope Julius II for the Stanza della Segnatura in the Apostolic Palace. Has remained in situ since completion.',
  },
  'parnassus': {
    slug: 'parnassus',
    title: 'The Parnassus',
    originalTitle: 'Il Parnaso',
    artistSlug: 'raphael',
    date: '1509–1511',
    medium: 'Fresco',
    dimensions: '670 cm (base width)',
    location: 'Apostolic Palace, Vatican City',
    resourceType: 'fresco',
    imageUrl: `${R2}/parnassus.jpg`,
    aspectRatio: 1.45,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Raphael_-_The_Parnassus.jpg',
    license: 'Public Domain',
    wikidata: 'Q1368498',
    description: `Apollo plays a lira da braccio on Mount Parnassus, surrounded by the nine Muses and the great poets of antiquity and the modern age. Homer, Virgil, Dante, Sappho, and Petrarch are all present — the prisca theologia of poetry, spanning from pre-Homeric inspiration to Raphael's own time.

This fresco faces the School of Athens across the Stanza della Segnatura, creating a dialogue: Philosophy (Athens) and Poetry (Parnassus) as complementary paths to truth. In Ficino's system, poetic furor (divine madness) is one of the four forms of inspired knowledge, alongside love, prophecy, and mystery.`,
    iconography: [
      { element: 'Apollo with lira da braccio', significance: 'The divine harmony that orders the cosmos. Ficino himself played a lyre, believing music to be a form of philosophical practice.' },
      { element: 'Nine Muses', significance: 'The nine spheres of inspiration — each governing a domain of creative knowledge.' },
      { element: 'Homer (blind, center left)', significance: 'The fountain of all poetry. His blindness represents inner vision — seeing truth beyond appearances.' },
      { element: 'Sappho (lower left, with scroll)', significance: 'The only woman identified by name — holding a scroll inscribed "SAPPHO." The lyric tradition of personal revelation.' },
    ],
    relatedTexts: [
      { title: 'Ion', author: 'Plato', year: 'c. 380 BCE', relationship: 'Plato\'s dialogue on poetic inspiration as divine madness — the theoretical foundation for the furor poeticus depicted here.', slug: null, hasTranslation: false },
      { title: 'Commentary on Plato\'s Symposium (De Amore)', author: 'Marsilio Ficino', year: '1484', relationship: 'Ficino\'s theory of the four divine furies (poetic, amorous, prophetic, mystical) explains why Poetry and Philosophy face each other in this room.', slug: 'commentary-on-symposium-ficino', hasTranslation: true },
    ],
    provenance: 'Painted as part of the decorative program of the Stanza della Segnatura. In situ since completion.',
  },
  'transfiguration': {
    slug: 'transfiguration',
    title: 'The Transfiguration',
    originalTitle: 'Trasfigurazione',
    artistSlug: 'raphael',
    date: '1516–1520',
    medium: 'Oil on panel',
    dimensions: '405 x 278 cm',
    location: 'Pinacoteca Vaticana, Vatican City',
    resourceType: 'painting',
    imageUrl: `${R2}/transfiguration.jpg`,
    aspectRatio: 0.69,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Transfiguration_Raphael.jpg',
    license: 'Public Domain',
    wikidata: 'Q208743',
    description: `Raphael's final masterwork, left unfinished at his death in 1520. It was placed at the head of his bier during his funeral. The painting fuses two Gospel episodes: above, Christ transfigured on Mount Tabor, radiant with divine light between Moses and Elijah; below, the apostles fail to heal a possessed boy.

The vertical composition embodies the Neoplatonic hierarchy: divine illumination above, the fallen material world below, and the gap between them that only grace can bridge. Christ's luminous body is Ficino's lumen — the visible radiance of divine beauty that the soul recognizes as its origin.`,
    iconography: [
      { element: 'Transfigured Christ', significance: 'Divine light made visible — the moment when the intelligible breaks through into the sensible world. Ficino\'s lumen divinum.' },
      { element: 'Moses and Elijah', significance: 'The Law and the Prophets — the Old Testament witnesses to divine revelation, flanking Christ as the fulfillment.' },
      { element: 'Possessed boy (below)', significance: 'The material world in bondage — unable to heal itself without divine intervention from above.' },
      { element: 'Vertical division', significance: 'The Neoplatonic hierarchy: the intelligible realm (above) and the sensible realm (below), connected only by divine descent.' },
    ],
    relatedTexts: [
      { title: 'Platonic Theology', author: 'Marsilio Ficino', year: '1482', relationship: 'The soul caught between two worlds — drawn upward by divine beauty, pulled downward by matter. The painting\'s vertical structure is this theology made visible.', slug: 'platonic-theology-ficino', hasTranslation: true },
    ],
    provenance: 'Commissioned by Cardinal Giulio de\' Medici (later Pope Clement VII). After Raphael\'s death it was displayed at the head of his bier. Placed in San Pietro in Montorio, Rome, then moved to the Pinacoteca Vaticana.',
  },
  'melencolia-i': {
    slug: 'melencolia-i',
    title: 'Melencolia I',
    originalTitle: 'Melencolia \u00a7 I',
    artistSlug: 'durer',
    date: '1514',
    medium: 'Engraving',
    dimensions: '24.0 x 18.8 cm',
    location: 'Multiple impressions worldwide',
    resourceType: 'print',
    imageUrl: `${R2}/melencolia-i.jpg`,
    aspectRatio: 0.79,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer_-_Melencolia_I_-_Google_Art_Project_(427760).jpg',
    license: 'Public Domain',
    wikidata: 'Q132565',
    description: `The most enigmatic print in Western art. A winged figure sits surrounded by tools of geometry, carpentry, and alchemy, yet appears paralyzed by thought — the creative intellect overwhelmed by the gap between what it can conceive and what it can realize.

The "I" in the title suggests the first stage of melancholy: imaginatio, the melancholy of artists and craftsmen. Agrippa's De Occulta Philosophia described three grades of melancholic furor corresponding to imagination, reason, and intellect. This print depicts the first — mastery of craft but not yet ascent to pure contemplation.

The magic square, the polyhedron, the comet, the starving dog — every element has been interpreted through alchemical, astrological, and Neoplatonic lenses for five centuries.`,
    iconography: [
      { element: 'Magic square (4x4)', significance: 'Jupiter\'s magic square from Agrippa\'s De Occulta Philosophia — used to counteract Saturn\'s malefic influence. Bottom row: 15-14, the date.' },
      { element: 'Truncated rhombohedron', significance: 'A geometrically complex solid — the limit of what imaginatio can conceive but not fully comprehend.' },
      { element: 'Winged figure', significance: 'The soul aspiring to ascend but weighed down. Wings for flight; seated pose for frustration.' },
      { element: 'Compass and tools', significance: 'Instruments of geometry — the domain of the first grade of melancholy. Mastered but insufficient.' },
      { element: 'Hourglass and bell', significance: 'Saturn (Chronos) governs both melancholy and time.' },
      { element: 'Keys at waist', significance: 'The power to unlock knowledge — possessed but not yet used. Alchemical keys to the Great Work.' },
    ],
    relatedTexts: [
      { title: 'De Occulta Philosophia', author: 'Heinrich Cornelius Agrippa', year: '1533', relationship: 'Agrippa\'s three grades of melancholic furor map to Dürer\'s "I" numbering. The magic square is directly from this text.', slug: 'de-occulta-philosophia-agrippa', hasTranslation: true },
      { title: 'De Vita Triplici', author: 'Marsilio Ficino', year: '1489', relationship: 'The original Renaissance text linking Saturn, melancholy, and intellectual genius.', slug: 'de-vita-triplici-ficino', hasTranslation: true },
    ],
    provenance: 'One of Dürer\'s three "master engravings" alongside Knight, Death, and the Devil and Saint Jerome in His Study.',
  },
  'knight-death-devil': {
    slug: 'knight-death-devil',
    title: 'Knight, Death, and the Devil',
    originalTitle: 'Ritter, Tod und Teufel',
    artistSlug: 'durer',
    date: '1513',
    medium: 'Engraving',
    dimensions: '24.6 x 19.0 cm',
    location: 'Multiple impressions worldwide',
    resourceType: 'print',
    imageUrl: `${R2}/knight-death-devil.jpg`,
    aspectRatio: 0.77,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer,_Knight,_Death_and_Devil,_1513,_NGA_6637.jpg',
    license: 'Public Domain',
    wikidata: 'Q577581',
    description: `A Christian knight rides steadfastly through a dark valley, accompanied by Death (who holds an hourglass) and the Devil (a grotesque horned creature). The knight does not turn or falter — his gaze is fixed forward, his bearing upright.

Erasmus's Enchiridion militis Christiani (Handbook of the Christian Knight, 1501) is considered the literary source: the Christian must ride through the valley of worldly temptation without looking at the monsters beside him. But the Neoplatonic reading is equally compelling: the soul's passage through the material world, maintaining its orientation toward the divine despite the distractions of mortality (Death) and desire (the Devil).

The fortress on the hilltop — the destination — represents either the Heavenly Jerusalem or the philosopher's achievement of contemplative wisdom.`,
    iconography: [
      { element: 'The Knight', significance: 'The Christian soldier (miles Christianus) or the Stoic-Neoplatonic soul maintaining its course through adversity.' },
      { element: 'Death with hourglass', significance: 'Mortality — the finite time allotted to the soul in the material world. The snakes in Death\'s crown recall the serpent of Genesis.' },
      { element: 'The Devil', significance: 'Temptation, the lower passions, the irrational soul that the knight-philosopher must subordinate.' },
      { element: 'Dog', significance: 'Fidelity and devotion — the virtues that sustain the knight. Also the loyal companion on the philosophical journey.' },
      { element: 'Hilltop fortress', significance: 'The goal: salvation, contemplative wisdom, the heavenly city. The Neoplatonic return to the One.' },
    ],
    relatedTexts: [
      { title: 'Enchiridion militis Christiani', author: 'Erasmus of Rotterdam', year: '1501', relationship: 'The "Handbook of the Christian Knight" — the likely literary source for this print\'s moral allegory.', slug: null, hasTranslation: false },
      { title: 'De Occulta Philosophia', author: 'Heinrich Cornelius Agrippa', year: '1533', relationship: 'Contemporary esoteric philosophy. Agrippa dedicated his work to Trithemius, whose circle included Dürer.', slug: 'de-occulta-philosophia-agrippa', hasTranslation: true },
    ],
    provenance: 'First of the three "master engravings." Impressions in the National Gallery of Art (Washington), British Museum, Metropolitan Museum, and major print rooms worldwide.',
  },
  'fra-angelico-annunciation': {
    slug: 'fra-angelico-annunciation',
    title: 'The Annunciation',
    originalTitle: 'L\'Annunciazione',
    artistSlug: 'fra-angelico',
    date: 'c. 1438–1445',
    medium: 'Fresco',
    dimensions: '230 x 321 cm',
    location: 'Convent of San Marco, Florence',
    resourceType: 'fresco',
    imageUrl: `${R2}/fra-angelico-annunciation.jpg`,
    aspectRatio: 1.43,
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Fra_Angelico_-_The_Annunciation_-_WGA00555.jpg',
    license: 'Public Domain',
    wikidata: 'Q3614924',
    description: `Painted at the top of the dormitory stairs in the Convent of San Marco, this fresco greeted the Dominican monks every time they ascended to their cells. The encounter between the angel Gabriel and the Virgin takes place under a vaulted loggia, combining Gothic spiritual luminosity with the new Florentine perspective.

This is the building where Marsilio Ficino's Platonic Academy would later gather under the patronage of Cosimo de' Medici, who funded the convent's reconstruction. The visual theology of this fresco — divine light entering the material world through the willing receptivity of the human soul — prefigures exactly what Ficino would articulate philosophically a generation later.

The inscription below reads: "VIRGINIS INTACTAE CVM VENERIS ANTE FIGVRAM PRAETEREUNDO CAVE NE SILEATVR AVE" — "When you come before the image of the ever-Virgin, take care that you do not neglect to say an Ave."`,
    iconography: [
      { element: 'Gabriel\'s wings', significance: 'Iridescent, rainbow-like — divine messenger embodying the spectrum of celestial light.' },
      { element: 'Mary\'s posture', significance: 'Arms crossed, head bowed — receptivity to the divine. The human soul opening itself to illumination.' },
      { element: 'Vaulted loggia', significance: 'Brunelleschian perspective — the rational, ordered space that divine grace enters. Architecture as theology.' },
      { element: 'Garden (left)', significance: 'The Hortus Conclusus — the enclosed garden of the Song of Songs, symbol of Mary\'s virginity and the paradisial state.' },
      { element: 'Light', significance: 'No visible light source — the light IS the divine presence. Ficino would call this lumen, the visible radiance of God.' },
    ],
    relatedTexts: [
      { title: 'Platonic Theology', author: 'Marsilio Ficino', year: '1482', relationship: 'Ficino developed his philosophy in this very building. His concept of the soul as the "copula mundi" (bond of the world) — mediating between divine and material — is prefigured in this fresco\'s theology of incarnation.', slug: 'platonic-theology-ficino', hasTranslation: true },
      { title: 'De Christiana Religione', author: 'Marsilio Ficino', year: '1474', relationship: 'Ficino\'s synthesis of Christianity and Platonism — the intellectual tradition this fresco visually anticipates.', slug: null, hasTranslation: false },
    ],
    provenance: 'Painted in situ at the Convent of San Marco, Florence. Funded by Cosimo de\' Medici as part of the convent\'s rebuilding by Michelozzo. The convent is now a museum.',
  },
};

// Helper: get all artworks by artist
export function getArtworksByArtist(artistSlug: string): Artwork[] {
  return Object.values(ARTWORKS).filter(a => a.artistSlug === artistSlug);
}

// Helper: get artist for artwork
export function getArtistForArtwork(artwork: Artwork): Artist {
  return ARTISTS[artwork.artistSlug];
}

// All artworks sorted by date
export function getAllArtworksSorted(): Artwork[] {
  return Object.values(ARTWORKS).sort((a, b) => {
    const yearA = parseInt(a.date.replace(/[^0-9]/g, '').slice(0, 4));
    const yearB = parseInt(b.date.replace(/[^0-9]/g, '').slice(0, 4));
    return yearA - yearB;
  });
}
