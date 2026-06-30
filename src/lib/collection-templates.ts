import type { CollectionTemplateConfig } from '@/components/collections/CollectionTemplate';

/*
 * APPROVAL GATE for the reusable collection template.
 *
 * Only collections listed here render with CollectionTemplate. Adding a
 * collection is a deliberate edit to this file — do NOT auto-apply the template
 * to other collections. Approved so far: mycology, herbalism. (The artwork-first
 * collections, e.g. visions-ecstasies, are NOT a good fit yet and stay bespoke.)
 *
 * Each config carries the AUTHORED copy (hero, three-part intro, verified quotes)
 * and any per-collection overrides; everything else is derived from the
 * collection's own data by the template.
 */
export const COLLECTION_TEMPLATES: Record<string, CollectionTemplateConfig> = {
  mycology: {
    slug: 'mycology',
    meta: {
      title: 'Fungi & Mycology — Source Library',
      description: 'Fungi built the soil that built our world. These are the books that first studied them — original source texts and first English translations on Source Library.',
      ogImage: '/collections/mycology/og.jpg',
    },
    hero: {
      title: 'Fungi & Mycology',
      tagline: 'Fungi built the soil that built our world. These are the books that first studied them.',
    },
    intro: [
      'Fungi feed forests and ferment bread, heal and poison, and break the dead back down into the soil that feeds the living. People gathered and used them for centuries before anyone could say what they even were: not quite plant, not quite animal, but a kingdom of their own.',
      'The books that worked this out run from pocket field guides to vast scientific surveys. Sterbeeck wrote the first work devoted entirely to mushrooms; Bulliard had each species painted from life, in plates still prized for their accuracy; Persoon and Fries built the orderings the whole field still rests on. Much of this writing survives only in Latin, French, and German, reachable until now mainly through citation while the pages themselves sat unread.',
      'Read directly, these works show a science built from close looking. A plate Bulliard coloured by hand can be set beside the mushroom in your hand, a poisoning described in an old treatise matched to the species that caused it, the long work of separating the edible from the deadly followed across two centuries of patient observation.',
    ],
    introImage: {
      src: '/collections/mycology/intro-plate.webp',
      alt: 'A microscope amid fungi, plants, and books — frontispiece engraving',
      caption: 'Selecta Fungorum Carpologia — L.-R. & C. Tulasne, 1863',
      href: '/gallery/image/69d8ca9ea09828f83ddcbbbe-0',
      framed: false,
    },
    featured: {
      title: 'Histoire des Champignons de la France',
      byline: 'by Pierre Bulliard · 1780–1791',
      blurb: [
        'An illustrated flora of the fungi of France, issued in parts from 1780 and gathered into volumes in 1791, with more than six hundred plates engraved and coloured by hand from living specimens.',
        'Among the first works to render fungi in full, accurate colour, it remained a standard reference for identification well into the following century.',
      ],
      browseLabel: 'Browse all 612 plates',
      browseHref: '/gallery?collection=mycology',
    },
    quoteBg: '/collections/mycology/quote-bg.webp',
    quoteFramingKey: 'mycology-quote-bg',
    quoteCredit: { text: 'Image: Battarra, Fungorum Agri Ariminensis Historia, 1755.', href: '/gallery/image/69d8ca06a09828f83ddc973f-0' },
    quotes: [
      { translated: 'There is diverse sort: their water is the rain, their mother the oak-tree, the nurse. … Here comes this clear star, that parts the evil from the good: the life from the death, the poison from the medicine, the darkness from the light.', original: "Daer is diverse soort: hun waeder is den reghen; hun moeder, Eycken-boom, de voester. … Hier comt dees clare STER, die scheydt het quaet uyt goet: het leven uyt de doodt, 't vergif uyt medecyn, het duyster uyt het licht.", language: 'Dutch', attribution: 'Sterbeeck, Theatrum Fungorum, 1675', href: '/book/theatrum-fungorum-oft-het-toonsel-der-campernoelien-9371' },
      { translated: 'Who does not see how thin the seed of fungi must be, that it can readily fly through the air, as the seeds of capillary plants are wont to do?', original: 'Quis enim non videt quam tenue esse debeat Fungorum semen, ut facili negotio concipi possit per aerem volitare, ut Capillarium plantarum semina solent?', language: 'Latin', attribution: 'Battarra, Fungorum Agri Ariminensis Historia, 1755', href: '/book/fungorum-agri-ariminensis-historia-973a' },
      { translated: 'If those who claim that all mushrooms are engendered only by corruption, that they have no seeds, no constant characters by which one can distinguish them, had taken the trouble to study their organization, to follow them in their growth, and to compare them, they would undoubtedly blush at their error.', original: "Si ceux qui prétendent que tous les champignons ne sont engendrés que par la corruption, qu'ils n'ont point de semences, point de caractères constans auxquels on puisse les distinguer, eussent pris la peine d'en étudier l'organisation, de les suivre dans leur accroissement, de les comparer, ils rougiroient sans doute de leur erreur.", language: 'French', attribution: 'Bulliard, Histoire des Champignons de la France, 1791', href: '/book/histoire-des-champignons-de-la-france-vol-1-9a51' },
      { translated: 'This mushroom produces almost the same effect among these peoples as opium among the Turks: at the dose of one, a delirium sometimes cheerful; at two, a sort of drunkenness or furious delirium; and finally at three or four, death, or a state that approaches it.', original: "Ce champignon produit à peu-près le même effet chez ces peuples, que l'opium chez les Turcs, c'est-à-dire, qu'à la dose d'un seul, il produit un délire quelquefois gai; à la dose de deux, une sorte d'ivresse ou de délire furieux; et enfin à la dose de trois ou quatre, la mort ou un état qui en approche.", language: 'French', attribution: 'Paulet, Treatise on Mushrooms, 1793', href: '/book/trait-des-champignons-9e05' },
      { translated: 'When will one begin to have a just idea of the utility of mushrooms? It will only be when a certain number of people spread across the various regions of the earth have cultivated this part of natural history, which is still in its cradle.', original: "Quand est-ce que l'on commencera à se faire une idée juste sur l'utilité des champignons? Ce ne sera que lorsqu'un certain nombre de personnes répandues dans les diverses contrées de la terre auront cultivé cette partie de l'histoire naturelle encore au berceau.", language: 'French', attribution: 'Bulliard, Histoire des Champignons de la France, 1791', href: '/book/histoire-des-champignons-de-la-france-vol-1-9a51' },
      { translated: 'If one still sees only very few people giving themselves to the study of mushrooms, it is because, to make the study of plants easy, already so attractive in itself, much has been done, while nothing has yet been done to smooth out the difficulties with which the study of mushrooms is bristling.', original: "Si l'on ne voit encore que très-peu de personnes se livrer à l'étude des champignons, c'est que pour rendre facile l'étude des plantes, déjà si attrayante par elle-même, on a fait beaucoup, tandis qu'on n'a rien fait encore pour applanir les difficultés dont l'étude des champignons est hérissée.", language: 'French', attribution: 'Bulliard, Histoire des Champignons de la France, 1791', href: '/book/histoire-des-champignons-de-la-france-vol-1-9a51' },
      { translated: 'I in no way approve of cooks using fungi to season the pies they call Pasticci, into which butter, Parmesan, and spices enter; for it often happens, even at Rimini, that guests are badly sickened by food of this kind.', original: 'Denique nulla ratione probamus Coquos uti Fungis ad Offas, quas Pasticci vocant, condiendas, in quibus Butyrum, Caseum parmense, & Aromata ingrediuntur; saepe enim accidit etiam Arimini, ut hujusmodi cibis male convivae vexati sint.', language: 'Latin', attribution: 'Battarra, Fungorum Agri Ariminensis Historia, 1755', href: '/book/fungorum-agri-ariminensis-historia-973a' },
    ],
    librarian: { videoSrc: '/collections/mycology/librarian.mp4', placeholder: 'Ask a question about mycology…' },
    signup: {
      bgImageUrl: '/api/gallery-crop/6955d43628a09ca65928002a-0',
      bgAttribution: { text: 'Image: Flamsteed, Historia Coelestis Britannica, Vol. 3, 1725.', href: '/gallery/image/6955d43628a09ca65928002a-0' },
    },
  },

  herbalism: {
    slug: 'herbalism',
    meta: {
      title: 'Herbalism & Botany — Source Library',
      description: 'The tradition of plant knowledge from antiquity to the Enlightenment — original herbals and first English translations on Source Library.',
    },
    hero: {
      title: 'Herbalism & Botany',
      tagline: 'The tradition of plant knowledge, from antiquity to the Enlightenment.',
    },
    intro: [
      'A book about plants was a practical instrument, and a dangerous one: name the wrong root or trust a careless drawing, and the remedy became the poison. The knowledge in it had to be exact, and it was won by checking every claim against the living plant.',
      'Its makers worked at this for two thousand years. Theophrastus grouped plants by their parts; Dioscorides compiled a pharmacy so trusted that physicians leaned on it for fifteen centuries; Fuchs, Gerard, and Parkinson had each species cut into woodblocks from a specimen on the table, and Mattioli wove his own fieldwork into the ancient text he was annotating. Their volumes survive in Latin and heavy printed folios, named in footnotes far more often than they are opened, though the most important, among them Mattioli’s commentary on Dioscorides, can now be read in English for the first time.',
      'What emerges is how much depended on a single plant being known for certain. Track one herb through these volumes and you can watch its name settle, its portrait sharpen from rough woodcut to fine engraving, its claimed powers tested and cut back to the few that hold, until the plant a sixteenth-century physician reached for is plainly the same one growing in a hedgerow today.',
    ],
    // Featured derived from data. Intro plate pinned to Leonardo's botanical studies.
    introImage: {
      src: 'https://images.sourcelibrary.org/gallery/6991eaf72f801130a473ee22/6991eaf82f801130a473ee57-0.jpg',
      alt: 'Botanical studies of plants with mirror-writing text by Leonardo da Vinci',
      caption: 'Botanical studies of plants with mirror-writing text by Leonardo da Vinci',
      href: '/gallery/image/6991eaf82f801130a473ee57-0',
      framed: true,
    },
    quoteBg: '/api/gallery-crop/69b4cc7fd5b6c3815e1a0d83-0',
    quoteCredit: { text: 'Image: Maria Sibylla Merian, Metamorphosis insectorum Surinamensium, 1719.', href: '/gallery/image/69b4cc7fd5b6c3815e1a0d83-0' },
    quoteTint: 'soft',
    // Join-the-project background: the same standard plate the fungi page uses.
    signup: {
      bgImageUrl: '/api/gallery-crop/6955d43628a09ca65928002a-0',
      bgAttribution: { text: 'Image: Flamsteed, Historia Coelestis Britannica, Vol. 3, 1725.', href: '/gallery/image/6955d43628a09ca65928002a-0' },
    },
    quotes: [
      { translated: 'The myrtle is under the protection of Venus because it is useful for remedies of love, as are the rose and the linden tree.', original: 'Myrtus sub Veneris tutela, quod venereis remediis conducat, sic rosa, & philyra.', language: 'Latin', attribution: 'Della Porta, Villae, 1592', href: '/book/villae-porta/page/69b1c642edda7fb64e1a08c0' },
      { translated: 'The Ancients hold that there are three different movements among all plants; namely, budding, flowering, and ripening…', original: 'Les Anciens tiennent estre entre toutes plantes, trois divers mouvemens; assavoir, bouter, fleurir, meurir…', language: 'French', attribution: 'de Serres, Théâtre d’Agriculture, 1603', href: '/book/le-theatre-d-agriculture-et-mesnage-des-champs-serres/page/69a5d7f94d84314297c08078' },
      { translated: 'It flowers from May until Autumn in the same year it is sown, and it perishes upon the arrival of winter.', original: 'Floret à Maio usque in Autumnum eodem quo sata est anno, & superveniente hyeme corrumpitur.', language: 'Latin', attribution: 'Ray, Historia Plantarum, 1688', href: '/book/historia-plantarum-vol-ii-ray/page/6958e0d19659a6529d5772dd' },
    ],
    // Custom librarian visual (no video): the Ortus sanitatis scholars-in-a-garden woodcut.
    librarian: {
      imageSrc: 'https://images.sourcelibrary.org/gallery/6958e84f538549809db81f94/6958e850538549809db81f9a-0.jpg',
      credit: { text: 'Ortus sanitatis (Garden of Health)', href: '/gallery/image/6958e850538549809db81f9a-0' },
      placeholder: 'Ask a question about herbs and plants…',
    },
  },
};
