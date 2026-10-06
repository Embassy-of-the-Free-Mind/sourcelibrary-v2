#!/usr/bin/env node
/**
 * Create the DRAFT "Cornelis Drebbel" collection (#5811).
 *
 * PRIOR ART: scripts/create-yoga-collection.mjs — same shape (tag books,
 * upsert the collections doc, curation_drafts exhibition layout); copied
 * rather than generalised because the editorial content is collection-specific.
 * Tagging mirrors src/lib/collection-tagging.ts (the $currentDate updated_at
 * bump is load-bearing: the Supabase books grid syncs on updated_at, #4399).
 *
 * The collection is written with visible:false. It is public copy, so Derek
 * reviews the prose before anyone flips it live. No book's visibility is
 * touched: hidden books are tagged so they appear on their own once the
 * pipeline finishes them (Monconys I, Becher's De nova temporis, the 1608
 * German Tractat — job drebbel-oven-5811).
 *
 * Every quotation below was read from the page with get_quote on 2026-10-04
 * and is copied verbatim from the translation (English originals from the
 * transcription); page numbers are SCAN indices, which is what ?page= takes.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/create-drebbel-collection.mjs --dry-run
 *   node --env-file=.env.production.local scripts/create-drebbel-collection.mjs
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Run with --env-file=.env.production.local.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const SLUG = 'drebbel';

// ─── Book ids ──────────────────────────────────────────────────────────

const B = {
  tractatusDuo: '9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4',
  tractatusDuo1628: '6836f8ee811c8ab472a49e36',
  thoroughExplanation1715: '697d9c9b72d515cb07bb3840',
  diversTraitez1672: '69bd9f2cf6d63c919747fa3e',
  basilius1624: '69b51dbdefd8df28f2daa158',
  theatrumChemicum1728: '6955916e7bd6d2cd1d619320',
  hartmann1684: '69c7bb1525ec2ba5ccd7f9e4',
  burggrav: '69b51e1f768235dc6598c9e7',
  maier: '699ef9ffee5e6e68fd8dea54',
  grick: '6970e37e9b09d309d780a2c6',
  libaviusExamen: '697b0799f58a82da7c04cfcb',
  schottMechanica: '69a5f6cd1cf742c3604142ea',
  digbyTheatrum: '69c8597a6c6f3cc53c8545c9',
  mersenne: '69af0dab9f13b61d0a6c6105',
  hernandez: '69af0ddf9f13b61d0a6c642b',
  becherTripus: '69b51ddacf111105c4291de3',
  wilkins: '6953ea4a1479a63c1108696b',
  jonson: '6a08fd0925e3a402b23b370f',
  witsen: '69b185d0c4be2cdd0edc425f',
  pepys3: '6a08f5db50bd891addfb9c74',
  pasch: '69b51ea6cf111105c42a2b3f',
  borch: '69b51dd2cf111105c429116f',
  morhof: '69b51e5147b06ecd5818de97',
  adelung: '697c8e0fbaa544415f85b6c8',
  ramazzini: '69af0fbc6f6d83348c7fa013',
  gmelin: '69c81e1d6c6f3cc53c84a166',
  leeuwenhoek: '6953e5f41479a63c11084498',
  pepys2: '6a08f5d250bd891addfb9aa9',
  gassendi: '69ac8420274fb531f2b6bd9b',
  borelTelescope: '69b1858ac4be2cdd0edc36fa',
  schottMagia: '69aebe64a103e42dc9414056',
  buonanni: '69b6bbcb8566c83814638232',
  juncker: '69b51de3261c58d63664c791',
  baker: '6a0b2581620b66ad8f233bd6',
  borelBibliotheca: '69773f72094afd77cbd39c0c',
  rothScholtzCatalogue: '69773e18094afd77cbd39c0a',
  humboldt: '698fb7826b95eeda7d2d2353',
  // Drebbel's own engraving (a one-leaf record with its page)
  kaartAlkmaar: '69b525de2f891867c1ae5d21',
  // Artwork records (images checked by eye 2026-10-04; #3815 scramble ruled out for these)
  portrait: '4a990eb491a6676c75551ea9',
  arithmetica: '51d18786188df760a188361e',
  juno: '7413642441d4e6c95b1753b2',
  ester: 'a08a2fc967ba3b4979e7967a',
  plattegrond: '643c72aec8d2a63b1dcb3469',
  // Hidden, being processed by job drebbel-oven-5811 — tagged so they surface when ready
  monconys1: '6a44359d0235c9147000dd12',
  becherNovaTemporis: '6a906d3f32545072610bae03',
  tractat1608: '6a9058b07f6818cc17cd5a93',
};

const BOOKS_TO_TAG = Object.values(B);

// Slugs, read back from the books collection on 2026-10-04.
const S = {
  tractatusDuo: 'drebbel-tractatus-duo-1628-latin-laurembergius',
  thoroughExplanation1715: 'a-thorough-explanation-of-the-nature-and-properties-of-the-drebbel',
  diversTraitez1672: 'divers-traitez-de-la-philosophie-naturelle-bernardus',
  basilius1624: 'fr-basilii-valentini-benedicter-ordens-offenbahrung-der-basilius',
  theatrumChemicum1728: 'deutsches-theatrum-chemicum-vol-i-various',
  hartmann1684: 'opera-omnia-medico-chymica-hartmann-3',
  burggrav: 'ioan-ernesti-burggravii-neost-palatini-biolychnium-seu-burggrav',
  maier: 'silence-after-the-clamor-maier',
  grick: 'antikrisis-a-short-rejoinder-and-defense-grick',
  libaviusExamen: 'examination-of-the-new-philosophy-libavius',
  mersenne: 'cogitata-physico-mathematica-mersenne',
  hernandez: 'rerum-medicarum-novae-hispaniae-thesaurus-hernandez',
  becherTripus: 'joh-joachimi-becheri-spirensis-medicinae-doctoris-tripus-becher',
  wilkins: 'mathematical-and-philosophical-works-wilkins',
  jonson: 'the-workes-of-benjamin-jonson-1640-second-folio-vol-2-ben-jo',
  witsen: 'aeloude-en-hedendaegsche-scheeps-bouw-en-bestier-witsen',
  pasch: 'georgii-paschii-schediasma-de-curiosis-huius-seculi-pasch',
  borch: 'de-ortu-et-progressu-chemiae-dissertatio-borch',
  morhof: 'danielis-georgi-i-morhofi-i-polyhistor-in-tres-tomos-morhof',
  adelung: 'history-of-human-folly-adelung',
  ramazzini: 'opera-omnia-medica-et-physiologica-ramazzini',
  gmelin: 'geschichte-der-chemie-gmelin',
  leeuwenhoek: 'arcana-naturae-detecta-1695-leeuwenhoek',
  pepys2: 'the-diary-of-samuel-pepys-vol-ii-wheatley-ed-1893-pepys',
  pepys3: 'the-diary-of-samuel-pepys-vol-iii-wheatley-ed-1893-pepys',
  gassendi: 'viri-illustris-nicolai-claudii-fabricii-de-peiresc-vita-gassendi',
  borelTelescope: 'de-vero-telescopii-inventore-borel',
  schottMagia: 'magia-universalis-naturae-et-artis-vol-i-schott',
  borelBibliotheca: 'chemical-library-borel',
  rothScholtzCatalogue: 'chemical-library-or-catalogue-of-chemical-books-roth-scholtz',
  humboldt: 'kosmos-entwurf-einer-physischen-weltbeschreibung-bd-2-humboldt',
  kaartAlkmaar: 'kaart-van-alkmaar-cornelius-drebbel-sculptor-drebbel',
};
const link = (label, key, page) => `[${label}](/book/${S[key]}${page ? `?page=${page}` : ''})`;

// ─── Editorial copy ────────────────────────────────────────────────────

const NAME = 'Cornelis Drebbel';
const SUBTITLE = 'The inventor from Alkmaar, as his own books and his astonished contemporaries describe him.';
const DESCRIPTION =
  'Cornelis Drebbel (1572–1633) built a boat that travelled under the Thames, a globe that seemed to move by itself, a furnace that held its own heat, and a scarlet dye that made his family rich. His own treatise on the elements survives in many editions; most of what we know of the machines comes from the people who saw them.';

const INTRO = [
  '**An engraver from a small market town ended his life as a king\'s engineer, remembered for a boat that travelled under a river, a glass sphere that seemed to turn by its own power, and a furnace that kept its own heat. He wrote almost nothing about the machines; the people who saw them did.**',
  `His own book is about something else: the ${link('Two Treatises on the Nature of the Elements', 'tractatusDuo')} explain wind, rain, lightning and the quintessence, and were reprinted in Dutch, German, Latin and French for a century. The machines live in other people's pages. ${link('Mersenne', 'mersenne', 309)} worked out how a ship could sink and rise again; a physician in Rome who had it from Drebbel's son-in-law counted the crew, in ${link('Hernández\'s Treasury', 'hernandez', 622)}; ${link('Becher', 'becherTripus', 99)} said the air they breathed came out of a glass. These reports are scattered through Latin chemistry, natural history and medicine, where a reader looking for Drebbel would rarely think to search.`,
  `Set side by side, the witnesses disagree in useful ways. One counts twenty-four men and a compass under the water, another calls the whole thing vanity, and a London playwright turns it into a joke about an invisible eel sinking ships at Dunkirk, all of it about one boat that none of them describes the same way.`,
];

const EXPANDED_DESCRIPTION = INTRO.join('\n\n');

// Verified quotations (get_quote, 2026-10-04). page_number = scan index.
const QUOTES = [
  {
    text: 'This ship holds twenty-four men, of whom eight work the oars, and the rest remain in their chambers, who for the space of twenty-four hours need no other air, and live content with only that enclosed within the ship.',
    original_text: 'Recipit autem hæc nauis viginti quatuor homines, quorum octo remos agunt, reliqui suis in cubiculis persistunt, qui viginti quatuor horarum spatio aere alio nullo indigent, soloque illo in naui concluso contenti viuunt.',
    original_language: 'Latin',
    author: 'Johannes Faber, in Hernández',
    book_id: B.hernandez,
    book_title: 'Treasury of Medical Matters of New Spain',
    page_number: 622,
    year: 1651,
    verified: true,
  },
  {
    text: 'It is well known that a small ship was constructed by Cornelius Drebbel in England, which swam while submerged under the waters.',
    original_text: 'Notum est nauiculam à Cornelio Drebellio in Anglia constructam, quæ sub aquis depressa natabat.',
    original_language: 'Latin',
    author: 'Marin Mersenne',
    book_id: B.mersenne,
    book_title: 'Physico-Mathematical Thoughts',
    page_number: 309,
    year: 1644,
    verified: true,
  },
  {
    text: 'The perpetual motion machine of Cornelis Drebbel the Dutchman, which is seen in England, represents the eternal motions of the stars, the changes of the seasons, and the ebbs and flows of the ocean to the very moment and point of time.',
    original_text: 'Perpetuum mobile Cornelis Drebbel Batavi, quòd in Anglia visitur, sempiternos siderum motus, temporumque vicissitudines, & Oceani reciprocationes ad momenta & puncta … repræsentans.',
    original_language: 'Latin',
    author: 'Johann Hartmann',
    book_id: B.hartmann1684,
    book_title: 'Opera omnia medico-chymica',
    page_number: 495,
    year: 1684,
    verified: true,
  },
  {
    text: 'Nor did the use of the calendar glass, or thermoscope, or the invention of that excellent fiery color (called Scarlatto in Italian) which makes Flemish cloths proud, come from anyone but the chemist Cornelius Drebbel.',
    original_text: 'Nec nisi à Cornelio Drebbelio Chemico profectus est vel vitri calendarii, seu thermoscopii usus, vel egregii coloris ignei (Scarlatto Italis dicti) qvo superbiunt panni Belgici, inventum.',
    original_language: 'Latin',
    author: 'Ole Borch',
    book_id: B.borch,
    book_title: 'Dissertation on the Origin and Progress of Chemistry',
    page_number: 26,
    year: 1668,
    verified: true,
  },
  {
    text: 'That such a Contrivance is feasible, and may be effected, is beyond all Question, because it hath been already experimented here in England by Cornelius Dreble.',
    author: 'John Wilkins',
    book_id: B.wilkins,
    book_title: 'Mathematical and Philosophical Works',
    page_number: 511,
    year: 1708,
    verified: true,
  },
];

const SECTIONS = [
  {
    title: 'His own writings',
    description: `Drebbel's one sustained book is a short natural philosophy: how the elements turn into one another, and how that cycle makes wind, rain, lightning and thunder. It travelled widely. A German alchemical editor appended it to ${link('Basilius Valentinus', 'basilius1624', 3)}, saying it had first been printed at Leiden in 1608; a Paris printer issued it in French inside ${link('Divers traitez', 'diversTraitez1672', 202)}; and it was still being reprinted in the ${link('German Chemical Theater', 'theatrumChemicum1728', 721)} more than a century after it was written.`,
    books: [
      { id: B.tractatusDuo, note: 'The two treatises, on the elements and on the quintessence, in Laurembergius\'s Latin translation, read in full in English.' },
      { id: B.thoroughExplanation1715, note: 'A German edition with a memorial of Drebbel attached for readers who wanted to know who he was.' },
      { id: B.diversTraitez1672, note: 'The French translation, printed with the Turba philosophorum and Bernard Trevisan; the Drebbel treatise starts at page 202 of the scan.' },
      { id: B.basilius1624, note: 'The editor of this Basilius Valentinus volume explains why he added Drebbel\'s treatise to it.' },
      { id: B.theatrumChemicum1728, note: 'Drebbel\'s tract on the elements, reprinted in Roth-Scholtz\'s anthology of German alchemy.' },
    ],
  },
  {
    title: 'The perpetual motion',
    description: `The machine that made Drebbel famous at the court of James I was a glass sphere that showed the motions of the heavens and the tides without being wound. Visitors and readers argued over what moved it. ${link('Johann Hartmann', 'hartmann1684', 495)} set it as a thesis for his medical students, guessing at a world-soul drawn in by chemistry; ${link('Michael Maier', 'maier', 75)} and ${link('Burggrav', 'burggrav', 43)} cite it as proof of what art could do; ${link('Libavius', 'libaviusExamen', 145)} mocked a rival for his theory of Drebbel's self-playing musical instrument.`,
    books: [
      { id: B.hartmann1684, note: 'Thesis 13: the perpetual motion "which is seen in England" and Drebbel\'s organ that plays in clear weather and falls silent in cloud.' },
      { id: B.maier, note: 'Maier offers the "certain German" Drebbel\'s machines as an example of engines moved by enclosed spirits.' },
      { id: B.burggrav, note: 'A letter reporting the sphere seen in England, representing the paths of the stars.' },
      { id: B.grick, note: 'A Rosicrucian pamphlet whose author says he has seen Drebbel\'s work himself.' },
      { id: B.libaviusExamen, note: 'Libavius on "the musical instrument of Drebbel", in a polemic against the new philosophy.' },
      { id: B.digbyTheatrum, note: 'A Dutch compilation notes Drebbel\'s claim, in a letter to the King of England, to have invented a perpetual motion.' },
    ],
  },
  {
    title: 'Under the water',
    description: `Around 1620 Drebbel rowed a closed boat under the Thames. Nobody who rode in it left a full account, so the boat survives as a set of reports at second hand. ${link('Mersenne', 'mersenne', 309)} took it as settled and worked out the physics; a physician who had it from Drebbel's son-in-law gave the crew and the depth in ${link('Hernández', 'hernandez', 622)}; ${link('Becher', 'becherTripus', 99)}, who had met Drebbel's daughter in London, said the air was renewed from a glass; ${link('Wilkins', 'wilkins', 511)} treated it as proven. ${link('Witsen', 'witsen', 200)} thought the whole idea vanity, and ${link('Ben Jonson', 'jonson', 152)} put it on the stage as an invisible eel.`,
    books: [
      { id: B.mersenne, note: 'Corollary II, "on ships swimming under water": how a ship made as heavy as water could stay at any depth.' },
      { id: B.hernandez, note: 'Twenty-four men, eight at the oars, a compass, and a boat still to be seen in London, as Drebbel\'s son-in-law told it.' },
      { id: B.becherTripus, note: 'Becher\'s account of the "essence of air" Drebbel is said to have kept in glass for his crew.' },
      { id: B.wilkins, note: 'Wilkins\'s chapter on an "Ark for submarine Navigations" opens with Drebbel\'s trial in England.' },
      { id: B.jonson, note: 'The Staple of News: one "Cornelius-Son" has made the Hollanders an invisible eel to sink the shipping at Dunkirk.' },
      { id: B.witsen, note: 'The Amsterdam shipbuilder doubts that ships could sail under water by leather tubes, as Mersenne and Drebbel claimed.' },
      { id: B.pepys3, note: 'Pepys talks over "Drebbel, the German doctor" and his instrument to sink ships at a coffee-house.' },
    ],
  },
  {
    title: 'Heat: the thermometer and the self-regulating furnace',
    description: `Several authors credit Drebbel with the thermometer, or with the "calendar glass" that showed changes of heat. ${link('Borch', 'borch', 26)} says it came from no one else; ${link('Pasch', 'pasch', 218)} records that some give the honour to Drebbel and others to Robert Fludd. Drebbel also built furnaces that held a steady heat: a glass of air or mercury moved a damper over the air hole as the fire rose and fell. That loop is why the furnace is often called the first feedback device, though the historian Vera Keller has cautioned that this fame may be overstated. The best description of it, a manuscript in Hamburg, is not yet in the library; Source Library is asking for images of it and of the Kuffler family's drawings in Cambridge.`,
    books: [
      { id: B.pasch, note: '"Who was the first inventor of the thermometer?" Pasch weighs Drebbel against Fludd.' },
      { id: B.borch, note: 'Borch credits Drebbel with both the thermoscope and the scarlet dye.' },
      { id: B.morhof, note: 'Morhof\'s index: "Drebbel is by some considered the inventor of thermometers."' },
      { id: B.adelung, note: 'Adelung on Drebbel\'s use of the thermoscope to drive mechanical movements, later improved by Becher.' },
    ],
  },
  {
    title: 'Scarlet and the Kuffler family',
    description: `Drebbel's most profitable discovery was a brilliant scarlet made from cochineal with a tin solution. His sons-in-law, the Kufflers, ran it as a family business, and "Kuffler's colour" became a dyer's term. ${link('Ramazzini', 'ramazzini', 36)} retells the story of the invention; ${link('Gmelin', 'gmelin', 372)} puts it in his history of chemistry; ${link('Leeuwenhoek', 'leeuwenhoek', 400)} uses the Dutch name in passing; and ${link('Pepys', 'pepys2', 225)} records a visit from "the German Dr. Kuffler".`,
    books: [
      { id: B.ramazzini, note: 'Ramazzini on how Drebbel, a Dutchman from Alkmaar, came upon the scarlet dye.' },
      { id: B.gmelin, note: 'The discovery of tin-mordanted cochineal, credited to Drebbel, in a history of chemistry.' },
      { id: B.leeuwenhoek, note: 'Leeuwenhoek names "Kuffelaars couleur" while describing dyed cloth under the microscope.' },
      { id: B.pepys2, note: 'Dr. Kuffler calls on Pepys; the editor\'s note explains the family and Drebbel\'s secret.' },
      { id: B.becherTripus, note: 'Becher saw Drebbel\'s daughter, "married long ago to Kuffler, the inventor of the scarlet color", in London.' },
    ],
  },
  {
    title: 'Lenses and images',
    description: `Drebbel ground lenses and sold optical instruments, and his name attached itself to both the microscope and the telescope. ${link('Gassendi', 'gassendi', 190)} says Peiresc sent a friend microscopes "recently invented by Cornelius Drebbel"; ${link('Borel', 'borelTelescope', 40)} argues at length that Drebbel did not invent the telescope; ${link('Schott', 'schottMagia', 220)} repeats the story that Drebbel, sitting in a room, could appear to change into any form "like Proteus".`,
    books: [
      { id: B.gassendi, note: 'Peiresc\'s gift of telescopes and microscopes "recently invented by Cornelius Drebbel", who was from Alkmaar and served the King of Great Britain.' },
      { id: B.borelTelescope, note: 'Chapter X: "That Metius the Dutchman did not invent the Telescope, nor did Cornelius Drebbel."' },
      { id: B.schottMagia, note: 'Schott retells the wonders told of Drebbel, who could seem to take on any shape, in his book of natural magic.' },
      { id: B.buonanni, note: 'Drebbel listed among the first makers of microscopes.' },
      { id: B.juncker, note: 'A schoolbook of inventions gives microscopy to Settala or Drebbel.' },
      { id: B.baker, note: 'Baker cannot decide whether the microscope belongs to Drebbel or to Fontana.' },
    ],
  },
  {
    title: 'In the catalogues',
    description: `For two centuries Drebbel stayed on the reading lists of chemistry. ${link('Borel', 'borelBibliotheca', 297)} and ${link('Roth-Scholtz', 'rothScholtzCatalogue', 82)} list his treatise among the chemical books worth owning, and ${link('Humboldt', 'humboldt', 264)} still names him beside Galileo when he writes the history of the thermometer.`,
    books: [
      { id: B.borelBibliotheca, note: 'Borel\'s bibliography of chemistry lists the Frankfurt 1628 Drebbel.' },
      { id: B.rothScholtzCatalogue, note: 'Roth-Scholtz\'s catalogue of chemical books, with Drebbel\'s treatise on nature.' },
      { id: B.humboldt, note: 'Humboldt names Galileo, Drebbel and the Accademia del Cimento in the history of measuring heat.' },
    ],
  },
];

const IMAGES = [
  { id: B.portrait, book_id: B.portrait, book_title: 'Portrait of Cornelis Drebbel', image_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-cornelis-drebbel-wis-en-natuurkundige-pk-t-8998-pk-t-853.jpg', thumbnail_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-cornelis-drebbel-wis-en-natuurkundige-pk-t-8998-pk-t-853.jpg', museum_description: 'Engraved portrait inscribed CORNELIUS DREBBEL ALCMARIENSIS.' },
  { id: B.plattegrond, book_id: B.plattegrond, book_title: 'Plattegrond van Alkmaar, 1597', image_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-plattegrond-van-alkmaar-1597-rp-p-1939-1428.jpg', thumbnail_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-plattegrond-van-alkmaar-1597-rp-p-1939-1428.jpg', museum_description: 'Drebbel\'s engraved bird\'s-eye plan of his home town, Alkmaar.' },
  { id: B.ester, book_id: B.ester, book_title: 'Ester voor Ahasveros', image_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-ester-voor-ahasveros-rp-p-1882-a-5824.jpg', thumbnail_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-ester-voor-ahasveros-rp-p-1882-a-5824.jpg', museum_description: 'Esther before Ahasuerus, engraved by Drebbel.' },
  { id: B.arithmetica, book_id: B.arithmetica, book_title: 'Arithmetica', image_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-arithmetic.jpg', thumbnail_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-arithmetic.jpg', museum_description: 'Arithmetic, from a series of the liberal arts engraved by Drebbel.' },
  { id: B.juno, book_id: B.juno, book_title: 'Juno', image_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-juno.jpg', thumbnail_url: 'https://images.sourcelibrary.org/artwork/art-drebbel-juno.jpg', museum_description: 'Juno, engraved by Drebbel.' },
];

// Closing section: the reader is told what is still missing (rendered as a section with no books).
SECTIONS.push({
  title: 'What is still missing',
  description: "Drebbel's own description of his self-regulating furnace survives in a late seventeenth-century German copy in Hamburg, with a second copy at Gotha, and his grandson Augustus Kuffler drew the furnaces and an egg incubator in a receipt book now in Cambridge. The earliest account of the furnaces is in Peiresc's notes of his 1624 conversation with the Kufflers. Source Library is asking the holding libraries for images of all of these. Monconys's travel journal, the Royal Society's minutes as printed by Birch, and the 1634 patent for the furnaces are being added now; they will appear here as they are read.",
  books: [],
});

// The exhibition renderer does not parse **bold**, so the opening is passed without it
// (expanded_description keeps it for the generic layout, which does).
const LAYOUT = [
  { component: 'description', paragraphs: INTRO.map((p) => p.replace(/\*\*/g, '')) },
  { component: 'quotes', title: 'What his contemporaries wrote', quotes: QUOTES },
  { component: 'gallery_grid', title: 'Drebbel the engraver', images: IMAGES },
  { component: 'sections', sections: SECTIONS },
];

// Tier-ranked highlights for the generic layout (used if the exhibition is ever removed).
const HIGHLIGHTED_BOOKS = [
  { book_id: B.tractatusDuo, tier: 1, rank: 1, note: SECTIONS[0].books[0].note },
  { book_id: B.mersenne, tier: 1, rank: 2, note: SECTIONS[2].books[0].note },
  { book_id: B.hernandez, tier: 1, rank: 3, note: SECTIONS[2].books[1].note },
  { book_id: B.becherTripus, tier: 1, rank: 4, note: SECTIONS[2].books[2].note },
  { book_id: B.hartmann1684, tier: 1, rank: 5, note: SECTIONS[1].books[0].note },
  { book_id: B.pasch, tier: 1, rank: 6, note: SECTIONS[3].books[0].note },
  { book_id: B.borch, tier: 2, rank: 7, note: SECTIONS[3].books[1].note },
  { book_id: B.gassendi, tier: 2, rank: 8, note: SECTIONS[5].books[0].note },
  { book_id: B.wilkins, tier: 2, rank: 9, note: SECTIONS[2].books[3].note },
  { book_id: B.jonson, tier: 2, rank: 10, note: SECTIONS[2].books[4].note },
  { book_id: B.ramazzini, tier: 2, rank: 11, note: SECTIONS[4].books[0].note },
  { book_id: B.thoroughExplanation1715, tier: 2, rank: 12, note: SECTIONS[0].books[1].note },
  { book_id: B.maier, tier: 3, rank: 13, note: SECTIONS[1].books[1].note },
  { book_id: B.borelTelescope, tier: 3, rank: 14, note: SECTIONS[5].books[1].note },
  { book_id: B.pepys2, tier: 3, rank: 15, note: SECTIONS[4].books[3].note },
];

const MENTIONED_BOOKS = [
  { text: 'Two Treatises on the Nature of the Elements', book_id: B.tractatusDuo },
  { text: "Hernández's Treasury", book_id: B.hernandez },
  { text: 'Mersenne', book_id: B.mersenne },
  { text: 'Becher', book_id: B.becherTripus },
];

const FEATURED_IMAGES = [
  {
    id: `${B.portrait}-artwork`,
    book_id: B.portrait,
    image_url: IMAGES[0].image_url,
    thumbnail_url: IMAGES[0].thumbnail_url,
    extracted_url: IMAGES[0].image_url,
    description: IMAGES[0].museum_description,
    type: 'portrait',
    book_title: 'Cornelis Drebbel, wis- en natuurkundige',
    book_author: 'Cornelis Drebbel',
  },
];

// ─── Run ───────────────────────────────────────────────────────────────

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

try {
  const books = db.collection('books');
  const found = await books
    .find({ id: { $in: BOOKS_TO_TAG } }, { projection: { _id: 0, id: 1, slug: 1, visible: 1, language: 1, pages_count: 1 } })
    .toArray();
  const foundIds = new Set(found.map((b) => b.id));
  const missing = BOOKS_TO_TAG.filter((id) => !foundIds.has(id));
  if (missing.length) {
    console.error('Missing book ids:', missing);
    process.exit(1);
  }

  // Every slug the copy links to must belong to a visible book (a hidden one 404s for readers).
  const linkedSlugs = Object.values(S);
  const linked = await books.find({ slug: { $in: linkedSlugs } }, { projection: { _id: 0, slug: 1, visible: 1 } }).toArray();
  const badLinks = linkedSlugs.filter((s) => !linked.some((b) => b.slug === s && b.visible === true));
  if (badLinks.length) {
    console.error('Links to missing or hidden books:', badLinks);
    process.exit(1);
  }

  const langCounts = {};
  for (const b of found) {
    if (!b.pages_count) continue;
    const lang = b.language || 'Unknown';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }
  const languages = Object.entries(langCounts).map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count);

  console.log(`books to tag: ${found.length} (visible ${found.filter((b) => b.visible).length}); links checked: ${linkedSlugs.length}; sections: ${SECTIONS.length}; quotes: ${QUOTES.length}`);

  if (DRY_RUN) {
    console.log('dry run, nothing written');
    process.exit(0);
  }

  // Mirrors src/lib/collection-tagging.ts: $addToSet + updated_at bump together (#4399).
  const tag = await books.updateMany(
    { id: { $in: BOOKS_TO_TAG } },
    { $addToSet: { collections: SLUG }, $currentDate: { updated_at: true } },
  );

  const bookCount = await books.countDocuments({ collections: SLUG, visible: true, pages_count: { $gt: 0 } });
  const now = new Date();
  await db.collection('collections').updateOne(
    { slug: SLUG },
    {
      $set: {
        name: NAME,
        subtitle: SUBTITLE,
        description: DESCRIPTION,
        expanded_description: EXPANDED_DESCRIPTION,
        parent: 'dutch-golden-age-of-science',
        kind: 'exhibit',
        type: 'curated',
        color: 'sage',
        visible: false,
        book_count: bookCount,
        languages,
        highlighted_books: HIGHLIGHTED_BOOKS,
        mentioned_books: MENTIONED_BOOKS,
        featured_images: FEATURED_IMAGES,
        hero_image: IMAGES[0].image_url,
        hero_image_attribution: 'Portrait of Cornelis Drebbel',
        curation_todo: [
          'Derek reviews the prose, then set visible:true',
          'Add Monconys, Birch, Evelyn vol ii, Woodcroft once job drebbel-oven-5811 makes them readable (#5811)',
          'Add the Hamburg Cod. alchim. 652 and CUL MS Ll.5.8 images when the libraries reply',
        ],
        updated_at: now,
      },
      $setOnInsert: { slug: SLUG, order: 99, created_at: now },
    },
    { upsert: true },
  );

  await db.collection('curation_drafts').updateOne(
    { collection_slug: SLUG, status: 'draft' },
    { $set: { curation: { layout: LAYOUT }, updated_at: now }, $setOnInsert: { collection_slug: SLUG, status: 'draft', created_at: now } },
    { upsert: true },
  );

  console.log(`tagged: matched ${tag.matchedCount}, modified ${tag.modifiedCount}; visible tagged books with pages: ${bookCount}`);
} finally {
  await client.close();
}
