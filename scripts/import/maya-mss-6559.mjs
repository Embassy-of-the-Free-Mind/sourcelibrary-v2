#!/usr/bin/env node
/**
 * Maya manuscripts from Princeton's Garrett-Gates / Mesoamerican Manuscripts (#6559).
 *
 * PRIOR ART: scripts/import/iiif-direct-import.mjs — one manifest, one book, generic
 * metadata; it cannot join the 26 Caste War letters (26 manifests) into the one
 * multi-title collection Princeton catalogues them as, and it records neither the
 * DPUL record nor the per-letter provenance. scripts/import/chilam-balam-gates-byu.mjs
 * is the shape copied here (declarative list, hidden, provenance in image_source).
 * The survey this list comes from: scripts/import/maya-sources-survey-6559.md.
 *
 * WHAT IT IMPORTS: only items whose own manifest `license` is rightsstatements
 * NKC ("No Known Copyright"). The script re-reads the licence from every manifest
 * and refuses anything else, so a CNE item cannot slip in by being added here.
 *
 * GROUPING: Princeton catalogues the Caste War letters and the Ebtún papers as
 * one "multi-title collection" each (the DPUL `relation` field), with a record
 * and a manifest per document. A one-leaf letter is not a book anybody can read,
 * so a group becomes ONE book, documents in date order; each page carries its
 * document's title (`part_title`) and ark (`source_ref`), and the book's notes
 * list the page range of every document.
 *
 * WAVE 2 (2026-10-24): the entries after the "wave 2" marker are generated, not
 * typed — princeton-maya-enumerate-6559.mjs reads all 268 DPUL records, and
 * princeton-maya-books-6559.mjs turns the Mayan + NKC + not-held ones into
 * entries. Besides Princeton's multi-title collections, two runs of one- to
 * eight-leaf Garrett-Gates land deeds with consecutive numbers are grouped.
 *
 * LANDS: hidden (publication `hidden`/`unprocessed`, so finalize cannot unhide it),
 * tagged `acquisition_campaign: maya-mss-6559`, and HELD out of every pipeline
 * lane with reason `maya-mss-6559` (scripts/lib/pipeline-hold.mjs) for the Opus
 * lane. Page images reference Princeton's IIIF service at native size; masters go
 * to R2 under `pages/<book_id>/NNNN.jpg` via
 *   npx tsx scripts/catalog-coverage/archive-acquired.ts --campaign maya-mss-6559
 *
 *   node --env-file=.env.production.local scripts/import/maya-mss-6559.mjs [--dry-run] [--only=<key>]
 *
 * Idempotent: insertBookIfNew() declines a manifest already held.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { initialPublication } from '../lib/publication.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const CAMPAIGN = 'maya-mss-6559';
const ISSUE = 6559;
const NKC = 'http://rightsstatements.org/vocab/NKC/1.0/';
const DPUL = 'https://dpul.princeton.edu/mesoamerican/catalog';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const HOLD = {
  reason: CAMPAIGN,
  issue: ISSUE,
  release: 'Opus OCR of the book is done (claude-ocr.mjs, maya-ref-opus-6559 recipe, #6559) and Derek has chosen its translation lane; release with --to ocr_complete only then',
  release_when: { kind: 'issue', ref: ISSUE },
};
const COLLECTIONS = ['maya', 'mesoamerican', 'americas'];
const GATES_PROVENANCE = 'Previously owned by William Gates; sold to Robert Garrett in 1930; donated to Princeton University Library in 1949.';

/**
 * `arks` are DPUL record ids. A `volume` picks one member of a multi-volume
 * IIIF collection. `group` books sort their documents by date before paging.
 */
const BOOKS = [
  {
    key: 'bacabs',
    arks: ['bn999802r'],
    title: 'Ritual of the Bacabs',
    display_title: 'Ritual of the Bacabs (Yucatec Maya healing incantations, 1775–1800)',
    author: 'Anonymous Yucatec Maya healers',
    language: 'Yucatec Maya',
    published: '1775-1800',
    notes: [
      'The Ritual of the Bacabs ("Cana che la ba Can yaban" in Gates\'s alternative title) is a book of Yucatec Maya incantations and remedies: spells against seizures, snake bite, asthma, toothache, fevers, burns and sores, for cooling, making fire, shaping flint and calling deer.',
      'Princeton\'s catalogue notes that the last two pages are written on the back of a printed Latin indulgence dated February 1779, and that the language suggests a copy of a 16th- or 17th-century original. It was found in Maya hands in Yucatán by Frederic J. Smith in the winter of 1914–15, working for William Gates.',
      'The scan includes covers, blank leaves and colour bars: 164 leaves, 348 images.',
    ],
  },
  {
    key: 'caste-war-letters',
    group: true,
    arks: [
      '4x51hn85c', '1544bs922', 'rn301521t', 'wd376112j', '8p58ph782', 'zp38wh448', 'df65vc685',
      'j67317593', '2514nq33r', '3f462926d', 'nv935668r', 'sn00b259h', 'xd07gx51z', 'n009w611g',
      'r494vp997', '05741w52s', '3x816r44m', '76537516h', '7p88cm38s', 'bv73c4255', 'cf95jg30g',
      'fn1072776', 'h702qb20r', 'kd17cx672', 'qr46r464k', 'vd66w373g',
    ],
    title: 'Caste War letters, 1848–1850',
    display_title: 'Caste War letters of the Maya leaders, 1848–1850 (Jacinto Pat, Florentino Chan, Bonifacio Novelo, Venancio Pec and others)',
    author: 'Jacinto Pat; Florentino Chan; Bonifacio Novelo; Venancio Pec; and other Maya leaders',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1848-1850',
    notes: [
      'Twenty-six letters written during the Caste War of Yucatán by the Maya rebel leadership and their captains — Jacinto Pat, Florentino Chan, Bonifacio Novelo, Venancio Pec, José Albino May and others — to priests, commanders and officials, several sent from Cruz Chen. Most are in Yucatec Maya; two mix in Spanish and one is in Spanish.',
      'Princeton catalogues them as one multi-title collection with a record per letter. Here they are one book, in date order; the undated letters Princeton places "ca. 1848" or "ca. 1850" sit at the start of their year. Each page carries its letter\'s title and DPUL ark.',
    ],
  },
  {
    key: 'chilam-balam-texts-v1',
    arks: ['dc5712mj05h'],
    volume: 0,
    title: 'Chilam Balam Texts, vol. 1: Chumayel, Calkiní, Libro de los Médicos',
    display_title: 'Chilam Balam Texts, vol. 1 (19th-century copies: Chumayel, Calkiní, Libro de los Médicos)',
    author: 'Anonymous Yucatec Maya scribes',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1850-1860',
    notes: [
      'Volume 1 of a two-volume 19th-century manuscript copy of several Books of Chilam Balam, possibly by a copyist working for Bishop Crescencio Carrillo y Ancona in Mérida. This volume: the Chilam Balam of Chumayel (the conquest of Yucatán), the Chilam Balam of Calkiní (the Ah Canul province in the later 16th century) and El Libro de los Médicos Yervateros de Yucatán (medicinal plants).',
      'A copy, not the original manuscripts. Volume 2 holds Tizimín, Ixil and Kaua.',
    ],
  },
  {
    key: 'chilam-balam-texts-v2',
    arks: ['dc5712mj05h'],
    volume: 1,
    title: 'Chilam Balam Texts, vol. 2: Tizimín, Ixil, Kaua',
    display_title: 'Chilam Balam Texts, vol. 2 (19th-century copies: Tizimín, Ixil, Kaua)',
    author: 'Anonymous Yucatec Maya scribes',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1850-1860',
    notes: [
      'Volume 2 of a two-volume 19th-century manuscript copy of several Books of Chilam Balam, possibly by a copyist working for Bishop Crescencio Carrillo y Ancona in Mérida. This volume: the Chilam Balam of Tizimín (chronicle, katun prophecies, calendar correlations and almanac, and what may be a Maya paraphrase of the Old Testament), of Ixil (medicine) and of Kaua (calendar correlations and medicine).',
      'A copy, not the original manuscripts. Volume 1 holds Chumayel, Calkiní and the Libro de los Médicos.',
    ],
  },
  {
    key: 'chumayel',
    arks: ['0z708w51x'],
    title: 'Book of the Chilam Balam of Chumayel',
    display_title: 'Book of the Chilam Balam of Chumayel (manuscript, 1775–1800)',
    author: 'Anonymous Yucatec Maya scribes',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1775-1800',
    notes: [
      'The Chilam Balam of Chumayel, written and illustrated in Chumayel, Yucatán; Princeton\'s catalogue calls it a late 18th-century copy. It holds the ritual of the four world-quarters, the rise of Hunac Ceel, katun prophecies, the creation of the world and of the uinal, a song of the Itzá, the interrogation of the chiefs, and a history of the Spanish conquest, with 27 leaves of drawings.',
      'Princeton records its history: found in Chumayel in the 19th century, given to Bishop Carrillo y Ancona, expropriated in 1915 into the Cepeda Library in Mérida, then lost from it. Gordon\'s 1913 photographic facsimile of the Chumayel book is held separately; whether that facsimile was made from this manuscript has not been checked against the leaves.',
    ],
  },
  {
    key: 'brujo-calendar',
    arks: ['qf85nf62m'],
    title: 'Brujo calendar',
    display_title: "Brujo calendar (Q'eqchi' divinatory calendar, 1867)",
    author: "Anonymous Q'eqchi' daykeeper",
    language: "Q'eqchi'",
    languages: ["Q'eqchi'", 'Spanish', 'Latin'],
    published: '1867',
    notes: [
      "A calendar of lucky and unlucky days in Q'eqchi', with the months and some feast days in Spanish. The date 1867 is written on fol. 6v at 16 October. Fol. 8v has four lines of church music with Q'eqchi' words, and fol. 9v a Latin prayer (perhaps the Salve Regina).",
      'Probably written at Lanquín, Alta Verapaz (Guatemala), where William Gates acquired it; the title is his. Two typed transcriptions are laid in with the manuscript.',
    ],
  },
  {
    key: 'ebtun-land-papers',
    group: true,
    arks: ['z603r225f', '2z10wv045', '6q182p96s'],
    title: 'Ebtún land papers, 1561–1869',
    display_title: 'Ebtún land papers, 1561–1869 (title of Juan Canul, 1721 land document, 1869 deed of sale)',
    author: 'Maya community of Ebtún',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1561-1869',
    notes: [
      'Three land documents from the Maya town of Ebtún, near Valladolid, Yucatán: the 1561 title proving Juan Canul\'s ownership and boundaries, an 18th-century land document (dated 1721) with a fragment of another, and an 1869 deed of sale by Juana Dzul and others to Gregorio Pat.',
      'Princeton catalogues them as one multi-title collection; here they are one book in date order, each page carrying its document\'s title and ark. Princeton\'s record for the 1561 title gives its catalogue date as 1835, which is the auction note on its cover, not the document\'s date.',
    ],
  },
  {
    key: 'maya-legal-documents',
    arks: ['tx31qn51k'],
    title: 'Maya legal documents, 1686–1849',
    display_title: 'Maya legal documents, 1686–1849 (bound volume of land and legal papers)',
    author: 'Various Maya and Spanish notaries',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1686-1849',
    notes: [
      'A bound volume of miscellaneous legal documents from Mexico, 1686–1849, sixteen folders in all. Princeton notes that seven of the folders come from Yucatán and are presumably in Yucatec Maya (1804/5–1849); the others are in Spanish.',
    ],
  },
  {
    key: 'titulos-quiche',
    arks: ['r781wh31g'],
    title: 'Títulos de los señores del Reino del Quiché',
    display_title: "Títulos de los señores del Reino del Quiché (K'iche' títulos, 1501–1781?)",
    author: "K'iche' lords of Xelajuh",
    language: "K'iche' Maya",
    languages: ["K'iche' Maya", 'Spanish'],
    published: '1501-1781',
    notes: [
      "K'iche' títulos in their archive wrapper (\"Titulo de reyes de Guatemala en Quiche\"). It holds the Título Real de don Francisco Izquin, last Ahpop Alel of the K'iche', dated 22 November 1588 and signed by him and eight other lords (11 leaves); a narrative (fols. 15–22) of the first conquest of the highlands by the K'iche' ancestors, dated 7 May 1524 and signed with the names of K'iche' lords, of Pedro de Alvarado and two other conquerors, and of the four friars with them; and official documents from Xelajuh, 1587 to about 1781.",
      'Presented by the keeper of the archive to Brasseur de Bourbourg in 1856; later owned by Alphonse Pinart and William Gates. Princeton notes a published transcription: Mallory Matsumoto, Land, Politics, and Memory in Five Nija\'ib\' K\'iche\' Títulos (University Press of Colorado, 2017).',
    ],
  },
  // ---- wave 2 (#6559, 2026-10-24): generated by princeton-maya-books-6559.mjs from the DPUL enumeration ----
  {"key":"kiche-wills-1760-1787","title":"K'iche' wills and property documents, 1760–1787","display_title":"K'iche' wills and property documents, 1760–1787 (52 testaments, sales and boundary papers from highland Guatemala)","author":"K'iche' testators and town notaries of highland Guatemala","language":"K'iche' Maya","published":"1760-1787","notes":["Fifty-one wills, bills of sale and documents on property, town lots and district boundaries, written in K'iche' in highland Guatemala between 1760 and 1787, with one undated will of the 18th century. Princeton catalogues them as one multi-title collection (\"Will of Joseph Chen, and 51 other(s)\") with a record per document.","A fifty-second document, a probable will for Sebastian Lopez dated 23 April 1776 (attested again 27 December 1778), is catalogued by Princeton outside the collection but with the same genre (\"Wills Guatemala 18th century\") and from the same Gates series; it is included here in date order.","Here they are one book in date order; each page carries its document's title and DPUL ark."],"group":true,"arks":["dcbc386w54v","dcpn89dj95s","dcrf55zm036","dcjw827q002","dctd96kd85w","dc1257b458t","dcvd66wb234","dcnv935f17x","dc3t9463100","dcz603r8755","dc6m312163h","dcx633fc37v","dc7m01bz01c","dck3569g65c","dcj3860k272","dcth83m9644","dc8g84mz595","dc4t64h0495","dcf4752v06n","dcfb494m758","dc9c67x0153","dcx920g8182","dcsf268h449","dcc821gx11r","dc05742402t","dcmw22vh79h","dcd504rx65s","dchx11xs564","dc8k71nv42z","dcsj139d28z","dckw52jm429","dch415pn89n","dc9k41zr846","dc5q47s1066","dcqn59qg34h","dcrn301c69z","dcgx41mw18t","dcmp48sr09j","dcz890s5566","dc1z40m516z","dccc08hs95m","dc0z709778q","dc2227n197m","dcnp193n495","dcw6634f97n","dcg445cr48w","dcpr76ff73j","dc2z10x2548","dcdb78tq37m","dc4q77g368z","dcw9505b80f","dc5t34sw905"]},
  {"key":"totonicapan-land-documents","title":"K'iche' land documents of Totonicapán and Momostenango, 1689–1812","display_title":"K'iche' land documents of Totonicapán and Momostenango, 1689–1812 (deeds, land grants, wills)","author":"K'iche' notaries of Totonicapán and Momostenango","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1689-1812","notes":["Eighteen documents in K'iche' and Spanish, most from Totonicapán, Guatemala: deeds of sale, land grants (among them to Ysabel Xchak'chal, Pedro Baquiax and Juan Basquez Sik'), the wills of Ysabel Xq'aqui and Francisca Ramos, a mayordomo's account audit of 1690, and an 1812 deed from Juan Vicente Santiago of Momostenango.","Princeton catalogues them as one multi-title collection with a record per document; here they are one book in date order, each page carrying its document's title and DPUL ark."],"group":true,"arks":["tm70n340p","j3860g18v","fb494h662","k3569c57n","3x816v854","nv935b096","cc08hp85x","xd07h191c","w3763g00s","2227mx89h","sn00b600k","9k41zn750","8k71nr328","0v838779b","h415pj79z","pv63g7480","7m01bt927","db78tm27x"]},
  {"key":"yucatec-land-deeds-1712-1870","title":"Yucatec land deeds and wills, 1712–1870","display_title":"Yucatec land deeds and wills, 1712–1870 (Ticul, Kanxoc, Maní, Valladolid, Calotmul, Maxcanú)","author":"Maya town notaries of Yucatán","language":"Yucatec Maya","languages":["Yucatec Maya","Spanish"],"published":"1712-1870","notes":["Deeds of sale for land and two wills from Yucatán, 1712–1870, from Ticul, Kanxoc, Maní, Valladolid, Calotmul and Maxcanú; the earlier ones in Yucatec Maya with some Spanish, the later mostly Spanish with some Yucatec. Among them the will of Juan Uicab (1804) and the land deeds of Bibiano Tuz (1824–25).","Princeton catalogues them as one multi-title collection with a record per document. One member, a contract between members of the Tus family, is \"Copyright Not Evaluated\" and is not included. Here they are one book in date order, each page carrying its document's title and DPUL ark."],"group":true,"arks":["b8515s229","dr26z220h","z316q5428","9c67wr64k","k0698c34f","1v53k1815","tb09j948m","q524js58n","5m60qw74b","f1881q73t","5999n7203","x346d8001","js956k645"]},
  {"key":"yucatec-land-deeds-gg-29-34","title":"Yucatec land deeds, 1798–1835 (Garrett-Gates nos. 29–34)","display_title":"Yucatec land deeds, 1798–1835 (Ticul, Dzitnup, Valladolid, Chemax; Garrett-Gates nos. 29–34)","author":"Notaries of Yucatán","language":"Spanish","languages":["Spanish","Yucatec Maya"],"published":"1798-1835","notes":["Six land documents from Yucatán, Garrett-Gates Mesoamerican Manuscripts nos. 29–34: deeds of sale from Ticul (1798), Dzitnup (1798), Yucatán (1828) and Chemax (1835), a recognition of a sale (1802–1814) and a declaration of land at Valladolid (1824). Spanish, with some Yucatec Maya.","Princeton catalogues each as its own record. They are joined here, in date order, because each is one to eight leaves; each page carries its document's title and DPUL ark."],"group":true,"arks":["pk02cf55x","th83m316c","2v23vz22g","pr76f725s","9019s629j","6m311t12x"]},
  {"key":"ebtun-valladolid-land-documents-gg-74-76","title":"Ebtún and Valladolid land documents, 1665–1820 (Garrett-Gates nos. 74–76)","display_title":"Ebtún and Valladolid land documents, 1665–1820 (deed to Gaspar Aac, Valladolid title, Tontzimin survey; Garrett-Gates nos. 74–76)","author":"Maya community of Ebtún","language":"Yucatec Maya","languages":["Yucatec Maya","Spanish"],"published":"1665-1820","notes":["Four land documents in Yucatec Maya with some Spanish, Garrett-Gates Mesoamerican Manuscripts nos. 74a, 74b, 75 and 76: a deed of sale for land to Gaspar Aac of Cuncunul at Ebtún (1665), a title to land at Valladolid (1789), a survey of the Tontzimin tract at Ebtún (1820?) and an undated 19th-century Ebtún land document.","Princeton catalogues each as its own record. They are joined here, in date order, because each is one to six leaves; each page carries its document's title and DPUL ark. The Ebtún land papers (the 1561 title of Juan Canul, 1721 and 1869) are a separate book."],"group":true,"arks":["m039k874q","bg257j89b","cc08hk74r","g732dd82h"]},
  {"key":"book-of-the-chilam-balam-of-gg2","arks":["dczk51vt27j"],"title":"Book of the Chilam Balam of Nah","display_title":"Book of the Chilam Balam of Nah (Yucatec Maya manuscript, 1857-1896)","author":"Anonymous Yucatec scribe","language":"Yucatec Maya","languages":["Yucatec Maya","Spanish"],"published":"1857-1896","notes":["Manuscript transcribed by Jose Maria Na and Jose Secundino Na of Teabo, Yucatán. The first p. 30 is signed by Jose Secundino Na and dated December 18, 1857. The final pages are signed by Jose Maria Nah and dated August 5, 1863. The manuscript is divided into 2 parts: pages 1-30 constitute a liturgical calendar for an unspecified year, includes calendar count, with ancient daynames, a section on astronomy; p. 30-53 are concerned with diseases and their cures. Page 1 is the seating of January; p. 2 is a correlation of the Gregorian calendar with the Maya months of an unspecified year; p. 3-14 correlates each day of the Gregorian year with the days of the Mayan tzolkin (there are no numbers with the Mayan days); the saint is given for each day, and up to p. 6, it is indicated whether the day has a good omen or bad. Pages 15-30 concern the signs of the zodiac, indicating the significance of the births under particular signs, and the advantages of burning, fields, etc. This portion of the book was composed in 1857. Pages 30-53 are \"Libro u tial acob\" (book for curing), composed in 1863. The remaining pages, from p. 54 to the end, are later entries concerning sporadic births and deaths in the Na family in Teabo in a mixture of Maya and Spanish; the final pages are upside down. Manuscript divisions/headings are written in Spanish. The latest date is 1896.","Another reproduction is held: the BYU photostat Chilam Balam de Nah (6a8da255aa8f57838adf7fe4).","Princeton catalogue: Book of the Chilam Balam of Nah : manuscript, [1857-1896]. 1 volumes (32 leaves) : paper, illustrations ; 23 x 17 cm. Text in Yucatec with some Spanish."]},
  {"key":"book-of-the-chilam-balam-of-gg4","arks":["dc9019sc988"],"title":"Book of the Chilam Balam of Calkini","display_title":"Book of the Chilam Balam of Calkini (Yucatec Maya manuscript, ca. 1821)","author":"Anonymous Yucatec scribe","language":"Yucatec Maya","published":"1821","notes":["Contains a historical chronicle concerning the geographical description of the province of Ah Canul; listing of native leaders in the province and succession to office; historical account of relations among native leaders and changes in command in the last half of the 16th-century. The last folio includes the Spanish date November 20, 1821.","Another reproduction is held: the BYU photostat Chilam Balam of Calkiní (6a8ee3de880abaf2b45934c3).","Princeton catalogue: Book of the Chilam Balam of Calkini : manuscript, [ca. 1821]. 1 v. (15 leaves) : paper ; 21 x 15 cm.. Text in Yucatec."]},
  {"key":"book-of-the-chilam-balam-of-gg6","arks":["zs25x9219"],"title":"Book of the Chilam Balam of Kaua","display_title":"Book of the Chilam Balam of Kaua (Yucatec Maya manuscript, ca. 1824)","author":"Anonymous Yucatec scribe","language":"Yucatec Maya","languages":["Yucatec Maya","Spanish"],"published":"1824","notes":["Manuscript fragment. Contains an almanac, calendrical correlations, and medical-botanical texts. Calendar years covered in manuscript are 1797-1826, but with entries only to 1824. Includes a Spanish Prayer \"Oracion; Que sea en e Santo Sepulcro ...\" on old pagination (CXIV and CXV). There are 3 separate numbering systems.","Other reproductions held: Teobert Maler's 1887 photographs (BYU, 6a878ac1d71f2514794f9e40) and a greyscale Internet Archive upload that appears to derive from this Princeton scan (6a87102131598d129803de7b).","Princeton catalogue: Book of the Chilam Balam of Kaua : manuscript, [ca. 1824]. 1 v. (19 leaves in various foliations) : paper, ill. ; 20 x 15 cm.. Text in Yucatec with some Spanish."]},
  {"key":"maya-fragments-medicinal-plants-gg8","arks":["c821gn555"],"title":"Maya Fragments - Medicinal Plants","display_title":"Maya Fragments - Medicinal Plants (Yucatec Maya manuscript, between 1800 and 1850)","author":"Anonymous Yucatec scribe","language":"Yucatec Maya","languages":["Yucatec Maya","Spanish"],"published":"1800-1850","notes":["Manuscript fragments concerning the medicinal uses of plants for curing specific diseases.","Princeton catalogue: Maya Fragments - Medicinal Plants : manuscript, [between 1800 and 1850]. 1 item (7 leaves with old foliation, 33, 41-46) : paper ; 21 x 15.6 cm.. Text in Yucatec with some Spanish."]},
  {"key":"sotuta-b-gg10","arks":["3r074x711"],"title":"Sotuta B","display_title":"Sotuta B (Yucatec Maya manuscript, between 1900 and 1925)","author":"Anonymous Yucatec scribe","language":"Spanish","languages":["Spanish","Yucatec Maya"],"published":"1900-1925","notes":["Medical-Botanical manuscript. Contains prescriptions/recipes for the use of plants in medical remedies and treatments. For example under the heading \"Contra todo mal de orina\" (p. 36) are found 73 separate entries detailing cures for urinary ailments; and under the heading \"Contro todo mal de oydos\" (p. 38) are 38 separate entries for the treatment of ear ailments. The manuscript is written in Spanish, containing only the Mayan plant names where necessary for identification.","Princeton catalogue: Sotuta B : manuscript, [between 1900 and 1925]. 16 leaves with old pagination (p. [a-b], 17-20, 23-26, 33-50, 53-54, [c-d]) : paper ; 30 x 18 cm.. Text in Spanish with some Yucatec."]},
  {"key":"sotuta-a-gg11","arks":["7h149s633"],"title":"Sotuta A","display_title":"Sotuta A (Yucatec Maya manuscript, between 1875 and 1900)","author":"Anonymous Yucatec scribe","language":"Spanish","languages":["Spanish","Yucatec Maya"],"published":"1875-1900","notes":["Medical-botanical manuscript. Contains prescriptions/recipes for the use of plants in medical remedies and treatments. The manuscript is written in Spanish, containing only the Mayan plant names where necessary for identification.","Princeton catalogue: Sotuta A : manuscript, [between 1875 and 1900]. 13 leaves with old pagination (p. 1-25, [26]) : paper ; 31 x 21 cm.. Texts in Spanish, with some Yucatec."]},
  {"key":"appellidos-en-lengua-maya-sacados-de-gg14","arks":["dc9s161j463"],"title":"Appellidos en Lengua Maya, Sacados de Documentos Publìcos del Departamento de Mérida, certificados por los Párrocos","display_title":"Appellidos en Lengua Maya, Sacados de Documentos Publìcos del Departamento de Mérida, certificados por los Párrocos (Yucatec Maya manuscript, between 1800 and 1850)","author":"Anonymous Yucatec scribe","language":"Spanish","languages":["Spanish","Yucatec Maya"],"published":"1800-1850","notes":["Manuscript list of 157 Yucatecan surnames from the parish records of Merida, Yucatan, from \"Aban\" to \"Zulú.\" Gates indicates that this manuscript is written in the hand of Juan Pio Perez. Probably dates to the early 19th century.","Princeton catalogue: Appellidos en Lengua Maya, Sacados de Documentos Publìcos del Departamento de Mérida, certificados por los Párrocos, [between 1800 and 1850]. 1 leaf : paper ; 32 x 20 cm.. Text in Spanish and Yucatec."]},
  {"key":"catecismoob-ti-le-metodistaoob-compilado-yetel-gg68","arks":["dc0c483w43p"],"title":"Catecismoob Ti Le Metodistaoob compilado yetel publicado Tioklal Le Utuxtah...","display_title":"Catecismoob Ti Le Metodistaoob compilado yetel publicado Tioklal Le Utuxtah... (Yucatec Maya manuscript, between 1875 and 1900)","author":"Anonymous Yucatec scribe","language":"Spanish","languages":["Spanish","Yucatec Maya"],"published":"1875-1900","notes":["Manuscript written in an unidentified hand, probably dating to the late 19th-century, apparently a catechism in Maya for Methodists. The Maya title says it is to be used in the family and schools. Includes a catechism with questions first in Spanish then in Mayan-Yucatec (p. 3-14); p. 15-20 are blank; extracts from a medical botanical ms. with the heading \"Conosimiento y virtudes de las yerbas Yucatecas estractadas del manuscripto que dejo D. Richardo Osada -- alias el Judio\" (p. 21-51); p. 52 is blank. Leaves are unnumbered.","Princeton catalogue: Catecismoob Ti Le Metodistaoob compilado yetel publicado Tioklal Le Utuxtah..., [between 1875 and 1900]. 1 v. (26 leaves) : paper ; 17 x 11 cm.. Text in Spanish and Yucatec."]},
  {"key":"yucatec-prayers-gg71","arks":["dcpr76ff671"],"title":"Yucatec prayers","display_title":"Yucatec prayers (Yucatec Maya manuscript, 1855)","author":"Anonymous Yucatec scribe","language":"Yucatec Maya","languages":["Yucatec Maya","Latin"],"published":"1855","notes":["Pages 1-29 contain prayers in Yucatec-Maya. Page 30 is a register of deaths, etc. in Teabo, Yucatàn, and has the date October 4, 1855. Pages 31-38 contain Latin hymns, beginning with a setting of Psalm 113 (\"Sit nomen Domini/Laudate pueri Dominum/laudate nomen Domini/Sit nomen Domini benedictum ex hoc nunc...). The manuscript was likely composed in Teabo as there are death records in the manuscript from the town.","Princeton catalogue: Yucatec prayers : manuscript, [1855]. 1 v. (20 leaves) : paper ; 16 x 11 cm.. Text in Yucatec and Latin."]},
  {"key":"doctrine-and-confession-gg73b","arks":["h702q9604"],"title":"Doctrine and confession","display_title":"Doctrine and confession (Yucatec Maya manuscript, 17--)","author":"Anonymous Yucatec scribe","language":"Yucatec Maya","languages":["Yucatec Maya","Latin","Spanish"],"published":"1700-1799","notes":["Fragment copy of fray Pedro Beltrán de Santa Rosa's DOCTRINA CHRISTIANA, either the 1740 or 1757 edition. Includes the commandments, \"Las obras de misericordia,\" and the credo. Includes occasional words in Latin and Spanish. Manuscript is water damaged with loss of text.","Princeton catalogue: Doctrine and confession : manuscript, [17--]. 1 v. (17 leaves) : paper ; 15 x 10 cm.. Text in Yucatec with some Latin and Spanish."]},
  {"key":"title-of-the-tamub-gg102","arks":["wp988p081"],"title":"Title of the Tamub","display_title":"Title of the Tamub (K'iche' Maya manuscript, 1812 Sept. 2)","author":"Juan de Torres","language":"K'iche' Maya","published":"1812","notes":["Ms. copy, written in an unidentified hand, probably at Totonicapán, Guatemala. The original manuscript was written by Juan de Torres, head of sub-lineage of the Tam, dated Oct. 12, 1580. Concerns the history of the Tam lineage of the Quiche from the first ancestors to the 15th century, and lists the genealogy relevant to land claims and the boundaries of those claims. This is one of the four fullest lineage histories surviving from the 16th century Quiche, and although a late copy, it is the earliest known text.","Princeton catalogue: Title of the Tamub : manuscript, [1812 Sept. 2]. 1 v. (9 leaves) : paper ; 31 x 22 cm.. Text in K'iche'."]},
  {"key":"probanca-executorio-gg103","arks":["37720f02c"],"title":"Probanca executorio","display_title":"Probanca executorio (K'iche' Maya manuscript, between 1600 and 1650)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","published":"1600-1650","notes":["A fragmentary account of the Spanish Conquest, probably drawn from the point of view of the Kavek lineage (perhaps of the Qoyoy sub-lineage). In language it is closer to the Popol Vuh. The manuscript includes drawings of the post-conquest second and third palaces of the Quiché kings. There are lists of the several Quiché towns and of the caciques of these towns in the late 16th century. Also mentioned are the Mam-speaking groups of the Quetzaltenango area conquered by the Quiché and an account of the conquest by Pedro de Alvarado, with reference to Capitan decum ahau.","Princeton catalogue: Probanca executorio : manuscript, [between 1600 and 1650]. 1 v. (25 leaves) : paper ; 22 x 14.5 cm.. Text in K'ich'e."]},
  {"key":"ordinanzas-de-la-confradia-de-ssmo-gg105","arks":["70795b90j"],"title":"Ordínanzas de la Confradía de Ssmo Sacramento","display_title":"Ordínanzas de la Confradía de Ssmo Sacramento (K'iche' Maya manuscript, 17--)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","published":"1700-1799","notes":["Ms. copy of the by-laws for the Cofradía de Santissimo Sacramento and the Cofradía del Rosario, probably from Tacubaya, Mexico City, Mexico. Includes a Roman Catholic Litany for the Virgin Mary (pp. 18-19), beginning \"Ihesus Maria. Letania de Nuestra Señora. Rosario. Kirie eleyson. christe eleyson...\"","Princeton catalogue: Ordínanzas de la Confradía de Ssmo Sacramento : manuscript, [17--]. 1 v. (11 leaves) : paper ; 32 x 22 cm.. Text in K'iche'."]},
  {"key":"fragment-of-a-spanish-k-ich-gg162","arks":["sj139498s"],"title":"Fragment of a Spanish-K'ich'e dictionary","display_title":"Fragment of a Spanish-K'ich'e dictionary (K'iche' Maya manuscript, 17--)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1700-1799","notes":["Ms. fragment from a Spanish-K'iche' dictionary. The fragment covers the letters F-P, including Fabriccan-Faxon; Madura-Maldean; Nabegante-Nosea assi; Pazesa-Patio qualquiera. Also includes some K'iche' phrases in translation.","Princeton catalogue: Fragment of a Spanish-K'ich'e dictionary : manuscript, [17--]. 4 leaves, fols. 103, 135, 147, and 154) : paper ; 21 x 14 cm.. Text in K'iche' and Spanish."]},
  {"key":"bocabulario-gg163a","arks":["gh93h277w"],"title":"Bocabulario","display_title":"Bocabulario (K'iche' Maya manuscript, 1726-1727)","author":"Thomas Calbo","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1726-1727","notes":["Miscellaneous phrases in Spanish translated into K'iche' by Thomas Calbo of Chichicastenango. Written in San Sebastian Lemoa and dated Feb. 1, 1726 - Oct. 10, 1727.","Princeton catalogue: Bocabulario : manuscript, [1726-1727]. 14 leaves : paper ; 21 x 15 cm.. K'iche' and Spanish."]},
  {"key":"spanish-tzutuhil-dictionary-and-other-texts-gg163b","arks":["hh63t018k"],"title":"Spanish-Tzutuhil dictionary and other texts","display_title":"Spanish-Tzutuhil dictionary and other texts (Tz'utujil manuscript, 17--)","author":"Anonymous Tz'utujil scribe","language":"Spanish","languages":["Spanish","Tz'utujil"],"published":"1700-1799","notes":["Contains a Spanish-Tzutuhil dictionary and phrase book, 18th c. Text in several hands, two columns, and not in strict alphabetical order (pp. 1-114). Together with Spanish religious choral music for alto, tenor, basso. Includes \"Villaçico de San Pedro\" (Christmas carol for St. Peter), a second carol (untitled), and another work with text beginning \"Sube triunphante Señora...\" (pp. 115-122, 126-128). Also includes pen-and-ink drawings of Christian subjects, 19th c.? (pp. 124-125).","Princeton catalogue: Spanish-Tzutuhil dictionary and other texts: manuscript, [17--]. 62 leaves : paper ; 21 x 15 cm.. Texts in Tzutuhil and Spanish."]},
  {"key":"dominican-miscellany-in-k-iche-and-gg165","arks":["dc4t64h0508"],"title":"Dominican miscellany in K'iche' and Spanish","display_title":"Dominican miscellany in K'iche' and Spanish (K'iche' Maya manuscript, between 1700 and 1750)","author":"Damián Delgado","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1700-1750","notes":["Sermons, blessings, and other brief texts in K'iche' written by Damián Delgado and other Dominican friars of the Order of \"N.P. Santo Domingo.\"","Princeton catalogue: Dominican miscellany in K'iche' and Spanish : manuscript, [between 1700 and 1750]. 46 leaves : paper ; 21 x 15 cm.. Text in K'iche' and Spanish."]},
  {"key":"libro-de-confradia-de-san-nicolas-gg168","arks":["5712m9818"],"title":"Libro de confradía de San Nicolás","display_title":"Libro de confradía de San Nicolás (K'iche' Maya manuscript, 1663-1852)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1663-1852","notes":["Consists of financial accounts of the confradía de San Nicolás in Sacapulas, dating from Apr. 17, 1663 - Aug. 29, 1852. A typical entry (May 11, 1802) certifies that the outgoing mayordomos are turning over exactly 502 [tostones?] to the new administration. Other entries list expenditures for particular fiestas and other cult duties. Also includes some transcriptions of legal documents in K'iche'. Some later accounts in Spanish.","Princeton catalogue: Libro de confradía de San Nicolás : manuscript, 1663-1852. 1 v. (264 leaves) : paper ; 21 x 15 cm.. Text in K'iche' with some Spanish."]},
  {"key":"zakicoxol-gg169","arks":["n870zv09s"],"title":"Zakicoxol (Garrett-Gates no. 169)","display_title":"Zakicoxol (Garrett-Gates no. 169) (K'iche' Maya manuscript, 1800-1824?)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1800-1824","notes":["Ms. dance-drama of the Guatemala version of the Dance of the Conquest of Mexico. The text is unusual in that the Indians speak K'iche' and the Spaniards speak Mayanized Spanish, both in Mayan semantic couplets. The plot deals with the coming of the Spaniards to Mexico and the defeat and conversion of the Indians. The title role of Zaqi Q'oxol or \"White Demon\" is played by an Indian who undertakes to represent paganism in the debate (the role is comic and licentious). Text incomplete.","Princeton catalogue: Zakicoxol : manuscript, [1800-1824?]. 1 v. (48 leaves) : paper ; 21 x 16 cm.. Text in K'iche' and Spanish."]},
  {"key":"zakicoxol-gg171","arks":["6q182p66f"],"title":"Zakicoxol (Garrett-Gates no. 171)","display_title":"Zakicoxol (Garrett-Gates no. 171) (K'iche' Maya manuscript, 18--)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1800-1899","notes":["Ms. dance-drama, of the Guatemala version of the Dance of the Conquest of Mexico. The text is unusual in that the Indians speak K'iche' and the Spaniards speak Mayanized Spanish, both in Mayan semantic couplets. The plot deals with the coming of the Spaniards to Mexico and the defeat and conversion of the Indians. The title role of Zaqi Q'oxol or \"White Demon\" is played by an Indian who undertakes to represent paganism in the debate (the role is comic and licentious). Text incomplete.","Princeton catalogue: Zakicoxol : manuscript, [18--]. 1 v. (28 leaves) : paper ; 22 x 17 cm.. Text in K'iche' and Spanish."]},
  {"key":"zakicoxol-gg173","arks":["3197xq559"],"title":"Zakicoxol (Garrett-Gates no. 173)","display_title":"Zakicoxol (Garrett-Gates no. 173) (K'iche' Maya manuscript, 1800 or 1802 Sept. 20)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1800-1802","notes":["Ms. dance-drama, of the Guatemala version of the Dance of the Conquest of Mexico. The text is unusual in that the Indians speak K'ich'e and the Spaniards speak Mayanized Spanish, both in Mayan semantic couplets. The plot deals with the coming of the Spaniards to Mexico and the defeat and conversion of the Indians. The title role of Zaqi Q'oxol or \"White Demon\" is played by an Indian who undertakes to represent paganism in the debate (the role is comic and licentious). Signed \"escribano Cablido Diego de Leon,\" on p. [223]. Text incomplete.","Princeton catalogue: Zakicoxol : manuscript, [1800 or 1802 Sept. 20]. 1 v. (48 leaves) : paper ; 22 x 16 cm.. Text in K'iche' and Spanish."]},
  {"key":"zakicoxol-gg174","arks":["1g05ff883"],"title":"Zakicoxol (Garrett-Gates no. 174)","display_title":"Zakicoxol (Garrett-Gates no. 174) (K'iche' Maya manuscript, 18--)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1800-1899","notes":["Ms. dance-drama, of the Guatemala version of the Dance of the Conquest of Mexico. The text is unusual in that the Indians speak K'iche' and the Spaniards speak Mayanized Spanish, both in Mayan semantic couplets. The plot deals with the coming of the Spaniards to Mexico and the defeat and conversion of the Indians. The title role of Zaqi Q'oxol or \"White Demon\" is played by an Indian who undertakes to represent paganism in the debate (the role is comic and licentious).","Princeton catalogue: Zakicoxol : manuscript, [18--]. 1 v. (16 leaves) : paper ; 23 x 18 cm.. Text in K'iche' and Spanish."]},
  {"key":"theologia-indorum-en-lengua-giche-sic-gg175","arks":["000007425"],"title":"Theologia Indorum en lengua Giche [sic]","display_title":"Theologia Indorum en lengua Giche [sic] (K'iche' Maya manuscript, 15--)","author":"Domingo de Vico","language":"K'iche' Maya","languages":["K'iche' Maya","Latin"],"published":"1500-1599","notes":["Brief Christian lessons drawn from the lives of the saints and the New Testament, with explanations of Christian concepts (virtue, prudence, etc.), n.d.","Princeton catalogue: Theologia Indorum en lengua Giche [sic] : manuscript, [15--]. 1 v. (252 leaves) : paper ; 21 x 15 cm.. Text in K'iche' and Latin."]},
  {"key":"theologia-indorum-gg176","arks":["37720g98q"],"title":"Theologia Indorum (Garrett-Gates no. 176)","display_title":"Theologia Indorum (Garrett-Gates no. 176) (K'iche' Maya manuscript, 16--)","author":"Domingo de Vico","language":"K'iche' Maya","languages":["K'iche' Maya","Latin"],"published":"1600-1699","notes":["Brief Christian lessons drawn from the lives of the saints and the New Testament, with explanations of Christian concepts (virtue, prudence, etc.). Incomplete, with several pages missing (3-13, 18-21, 106-117, 184-187, 214-217, 234-235, 268-269, 355-362).","Princeton catalogue: Theologia Indorum : manuscript, [16--]. 1 v. (308 leaves) : paper ; 21 x 15 cm.. Text in K'iche' and Latin."]},
  {"key":"theologia-indorum-gg177","arks":["h128nh47c"],"title":"Theologia Indorum (Garrett-Gates no. 177)","display_title":"Theologia Indorum (Garrett-Gates no. 177) (K'iche' Maya manuscript, 1759)","author":"Domingo de Vico","language":"K'iche' Maya","languages":["K'iche' Maya","Latin"],"published":"1759","notes":["Brief Christian lessons drawn from the lives of the saints and the New Testament, with explanations of Christian concepts (virtue, prudence, etc.). Foliated with same folio numbers on recto and verso.","Princeton catalogue: Theologia Indorum : manuscript, [1759]. 1 v. (140 leaves) : paper ; 22 x 16 cm.. Text in K'iche' and Latin."]},
  {"key":"theologia-indorum-gg178","arks":["707958935"],"title":"Theologia Indorum (Garrett-Gates no. 178)","display_title":"Theologia Indorum (Garrett-Gates no. 178) (K'iche' Maya manuscript, 15--)","author":"Domingo de Vico","language":"K'iche' Maya","languages":["K'iche' Maya","Latin"],"published":"1500-1599","notes":["Incomplete ms. beginning on p. 3, possibly in the hand of Domingo de Vico, containing Christian lessons drawn from the lives of the saints and the New Testament, with explanations of Christian concepts (virtue, prudence, etc.). Paper damaged with loss of text, with 19th-century pagination.","Princeton catalogue: Theologia Indorum : manuscript, [15--]. 1 v. (144 leaves) : paper ; 22 x 16 cm.. Text in K'iche' and Latin."]},
  {"key":"theologia-indorum-gg179","arks":["p8418w60m"],"title":"Theologia Indorum (Garrett-Gates no. 179)","display_title":"Theologia Indorum (Garrett-Gates no. 179) (K'iche' Maya manuscript, 15--)","author":"Domingo de Vico","language":"K'iche' Maya","languages":["K'iche' Maya","Latin"],"published":"1500-1599","notes":["Incomplete ms. containing Christian lessons drawn from the lives of the saints and the New Testament, with explanations of Christian concepts (virtue, prudence, etc.). Paper damaged with loss of text.","Princeton catalogue: Theologia Indorum : manuscript, [15--]. 1 v. (45 leaves) : paper ; 21 x 15 cm.. Text in K'iche' and Latin."]},
  {"key":"theologia-indorum-gg180","arks":["rx913t179"],"title":"Theologia Indorum (Garrett-Gates no. 180)","display_title":"Theologia Indorum (Garrett-Gates no. 180) (K'iche' Maya manuscript, 15--)","author":"Domingo de Vico","language":"K'iche' Maya","languages":["K'iche' Maya","Latin"],"published":"1500-1599","notes":["Incomplete ms. containing Christian lessons drawn from the lives of the saints or the New Testament, and explanations of Christian concepts (virtue, prudence, etc.).","Princeton catalogue: Theologia Indorum : manuscript, [15--]. 1 v. (32 leaves) : paper ; 21 x 15 cm.. Text in K'iche' and Latin."]},
  {"key":"de-pasione-gg183","arks":["th83m2844"],"title":"De Pasione","display_title":"De Pasione (K'iche' Maya manuscript, ca. 1800)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1800","notes":["Unidentified Christian devotional texts relating to the \"Pacion.\" Incomplete, first eight pages wanting. Pages badly damaged with loss of text.","Princeton catalogue: De Pasione : manuscript, [ca. 1800]. 1 v. (42 leaves) : paper ; 21 x 15 cm.. Text in K'iche' and Spanish."]},
  {"key":"doctrina-en-quiche-gg186","arks":["dcwd376765q"],"title":"Doctrina en Quiché","display_title":"Doctrina en Quiché (K'iche' Maya manuscript, 1800)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","published":"1800","notes":["Contains a series of doctrinal works, chiefly prayers in K'iche'.","Princeton catalogue: Doctrina en Quiché : manuscript, [1800]. 1 v. (14 leaves) : paper ; 21 x 16 cm.. Text in K'iche'."]},
  {"key":"arte-quiche-gg192","arks":["m900nx688"],"title":"Arte Quichè","display_title":"Arte Quichè (K'iche' Maya manuscript, 1753)","author":"Estevan Torresano","language":"K'iche' Maya","languages":["K'iche' Maya","Spanish"],"published":"1753","notes":["Manuscript copy of the K'iche' Grammar by Torresano. Written in Guatemala in an unidentified hand.","Princeton catalogue: Arte Quichè : manuscript, 1753. 1 v. (113 leaves) : paper ; 16 x 11 cm.. Text in K'iche' and Spanish."]},
  {"key":"theologia-indorum-gg227","arks":["cv43p520w"],"title":"Theologia Indorum (Garrett-Gates no. 227)","display_title":"Theologia Indorum (Garrett-Gates no. 227) (K'iche' Maya, Kaqchikel, Tz'utujil manuscript, 15--)","author":"Anonymous K'iche' scribe","language":"K'iche' Maya","languages":["K'iche' Maya","Kaqchikel","Tz'utujil"],"published":"1500-1599","notes":["Contains texts written in several unidentified hands, all of the 16th century, one of these (of 30 pages) being in K'iche'. A notation on the inside of the cover says \"Tzutuhil,\" The greater part of the volume is clearly Kaqchikel, but the first section (fols. 71-100), different in writing entirely, with red initial letters running all through the text, uses the specifice Tzutuhil words \"ca-tte, ca-tte,\" which belong to Atitlan, the capital of the old Tzutuhil kingdom. Tzutuhil is much closer to Kaqchikel than is K'iche', in spite of its being almost surrounded by K'iche'-speaking towns. There are only two other known Tzutuhil mss. (both in the Bibliothèque nationale de France). It is to be noted that the texts in this volume do not use the special characters found in all Kaqchikel and K'iche' texts after about the middle or late 16th century, until the languages, and learning, became so run down that their use ceased.","Princeton catalogue: Theologia Indorum : manuscript, [15--]. 1 v. (232 leaves) : paper ; 21 x 16 cm.. Text in K'iche', Kaqchikel and Tzutuhil."]},
  {"key":"sermones-gg232","arks":["br86b683v"],"title":"Sermones (Garrett-Gates no. 232)","display_title":"Sermones (Garrett-Gates no. 232) (Poqomchi' manuscript, between 1600 and 1625)","author":"Francisco de Viana","language":"Poqomchi'","published":"1600-1625","notes":["A collection of sermons in Pokonchi by Viana, written around 1600. This volume later came to fray Dionisio de Zuniga who restored it by adding the \"sermones\" for the missing Sundays, as composed by a \"much inferior scholar, fary Gonzalo Ximeno.\" These Ximeno Sermones, in the writing of Zuniga, comprise fols. 1-116, 197-212. Folios 117-198 are the Viana original.","Princeton catalogue: Sermones : manuscript, [between 1600 and 1625]. 1 v. (209 leaves) : paper ; 21 x 14 cm.. Text in Pokonchi."]},
  {"key":"sermones-gg238","arks":["z890rx76t"],"title":"Sermones (Garrett-Gates no. 238)","display_title":"Sermones (Garrett-Gates no. 238) (Poqomchi' manuscript, 1700)","author":"Anonymous Poqomchi' scribe","language":"Poqomchi'","published":"1700","notes":["Collection of sermons. Probably formed part of a larger religious miscellany, with contemporary pagination (p. 48-76).","Princeton catalogue: Sermones : manuscript, [1700]. 1 v. (28 leaves) : paper ; 21 x 16 cm.. Text in Pokonchi."]},
  {"key":"chirixc-y-sancta-cathalina-etc-gg239","arks":["dcst74d287k"],"title":"Chirixc y Sancta Cathalina, etc.","display_title":"Chirixc y Sancta Cathalina, etc. (Poqomchi' manuscript, ca. 1700)","author":"Anonymous Poqomchi' scribe","language":"Poqomchi'","published":"1700","notes":["Pokonchi text concerning Santa Catalina, written in an unidentified hand. Probably formed part of a larger religious miscellany, with contemporaray pagination (p. 76-104).","Princeton catalogue: Chirixc y Sancta Cathalina, etc. : manuscript, [ca. 1700]. 1 v. (28 leaves) : paper ; 21 x 16 cm.. Text in Pokonchi."]},
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      if (i === 2) throw e;
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}

const first = (doc, k) => (doc[`readonly_${k}_tesim`] || [])[0] || null;
const all = (doc, k) => doc[`readonly_${k}_tesim`] || [];
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** Sort key from a DPUL date: "[1850, Feb. 24]" -> 18500224; "[ca. 1850]" -> 18500000;
 *  "1763 Apr 5." -> 17630405; "[23 January 1789]" -> 17890123; "[17--]" -> 17000000. */
function dateKey(date) {
  const s = String(date || '');
  const y = s.match(/\b(\d{4})\b/);
  if (!y) {
    const century = s.match(/\b(\d{2})--/);
    return century ? Number(century[1]) * 1000000 : 99999999;
  }
  const rest = s.slice(y.index + 4);
  const before = s.slice(0, y.index);
  const month = (rest.match(/[A-Za-z]+/) || before.match(/([A-Za-z]+)\s*$/) || [])[0] || '';
  const day = (rest.match(/[A-Za-z]+\.?\s*(\d{1,2})\b/) || before.match(/\b(\d{1,2})\s+[A-Za-z]+\s*$/) || [])[1];
  return Number(y[1]) * 10000 + (MONTHS[month.toLowerCase().slice(0, 3)] || 0) * 100 + Number(day || 0);
}

/** One DPUL record -> its catalogue facts and its manifest's canvases. */
async function loadRecord(ark, volume) {
  const doc = (await getJson(`${DPUL}/${ark}.json`)).response.document;
  let manifestUrl = doc.content_metadata_iiif_manifest_field_ssi;
  let manifest = await getJson(manifestUrl);
  if (manifest['@type'] === 'sc:Collection') {
    if (volume == null) throw new Error(`${ark}: manifest is a collection; set volume`);
    // The collection's own licence binds too: Princeton marks some collections CNE over NKC volumes.
    if (manifest.license !== NKC) throw new Error(`${ark}: collection licence is ${manifest.license}, not NKC — refusing`);
    manifestUrl = manifest.manifests[volume]['@id'];
    manifest = await getJson(manifestUrl);
  }
  if (manifest.license !== NKC) throw new Error(`${ark}: licence is ${manifest.license}, not NKC — refusing`);
  const canvases = (manifest.sequences?.[0]?.canvases || []).map((c) => {
    const svc = c.images?.[0]?.resource?.service?.['@id'];
    if (!svc) throw new Error(`${ark}: canvas ${c['@id']} has no image service`);
    return { canvas: c['@id'], label: typeof c.label === 'string' ? c.label : null, svc };
  });
  if (!canvases.length) throw new Error(`${ark}: manifest has no canvases`);
  return {
    ark,
    // A few records carry an image URL in `identifier`, not the ark.
    arkFull: all(doc, 'identifier').find((i) => String(i).startsWith('ark:/')) || `ark:/88435/${ark}`,
    dpul: `${DPUL}/${ark}`,
    catalog: stripHtml(first(doc, 'view-in-catalog')),
    title: first(doc, 'title'),
    date: first(doc, 'date'),
    call: first(doc, 'call-number'),
    extent: first(doc, 'extent'),
    textLanguage: first(doc, 'text-language'),
    abstract: first(doc, 'abstract'),
    creators: all(doc, 'creator'),
    subjects: all(doc, 'subject'),
    rights: first(doc, 'edm-rights'),
    manifestUrl,
    canvases,
  };
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
const report = [];

for (const spec of BOOKS.filter((b) => !ONLY || b.key === ONLY)) {
  console.log(`\n=== ${spec.key}`);
  let records;
  try {
    records = [];
    for (const ark of spec.arks) { records.push(await loadRecord(ark, spec.volume)); await sleep(400); }
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    report.push({ key: spec.key, outcome: 'failed', why: e.message });
    continue;
  }
  if (spec.group) records.sort((a, b) => dateKey(a.date || a.title) - dateKey(b.date || b.title));

  const pages = [];
  const parts = [];
  for (const r of records) {
    const from = pages.length + 1;
    for (const c of r.canvases) pages.push({ ...c, record: r });
    parts.push(`pp. ${from}–${pages.length}: ${r.title} (${r.arkFull})`);
  }
  const lead = records[0];
  console.log(`  ${records.length} record(s), ${pages.length} pages; licence NKC on all`);
  if (DRY_RUN) {
    for (const p of parts.slice(0, 30)) console.log(`    ${p}`);
    report.push({ key: spec.key, outcome: 'dry_run', pages: pages.length });
    continue;
  }

  const now = new Date();
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  let slug = spec.key;
  for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { _id: 1 } }); i++) slug = `${spec.key}-${i}`;
  const shelfmark = spec.group
    ? 'Princeton University Library, Robert Garrett Collection (Garrett-Gates Mesoamerican Manuscripts), multi-title collection'
    : `Princeton University Library, ${lead.call}`;
  const notes = [
    ...spec.notes,
    ...(spec.group ? [`Documents in this book: ${parts.join('; ')}.`] : []),
    GATES_PROVENANCE,
    'Princeton University Library rights statement: No Known Copyright (rightsstatements.org NKC 1.0); Princeton states that no permission or fee is needed to publish from its Special Collections.',
  ].join(' ');

  // hidden_reason is not on makeBookDoc's whitelist (#3969); it is written right after the
  // insert from the same initialPublication() result, as bdrc-scans-import.mjs does.
  const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'unprocessed', note: `maya-mss-6559: held for the Opus lane (#${ISSUE})`, by: 'script:maya-mss-6559', issue: ISSUE, now });
  const acquired = await insertBookIfNew(db, {
    _id: bookId,
    id: bookIdStr,
    slug,
    title: spec.title,
    display_title: spec.display_title,
    author: spec.author,
    language: spec.language,
    original_language: spec.language,
    ...(spec.languages ? { languages: spec.languages, language_multi: true } : {}),
    field_provenance: { language: 'caller' },
    text_role: 'original',
    published: spec.published,
    categories: [],
    collections: COLLECTIONS,
    thumbnail: `${pages[0].svc}/full/400,/0/default.jpg`,
    pages_count: pages.length,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: 0,
    needs_splitting: false,
    page_count_source: 'iiif_manifest',
    dublin_core: {
      dc_identifier: records.flatMap((r) => [r.arkFull, r.manifestUrl]),
      dc_source: lead.dpul,
      dc_date: records.map((r) => r.date).filter(Boolean),
      ...(!spec.group && lead.abstract ? { dc_description: lead.abstract } : {}),
      dc_subject: [...new Set(records.flatMap((r) => r.subjects))],
    },
    catalog_metadata: {
      source: 'dpul.princeton.edu/mesoamerican',
      records: records.map((r) => ({
        ark: r.arkFull, title: r.title, date: r.date, call_number: r.call, extent: r.extent,
        text_language: r.textLanguage, creators: r.creators, abstract: r.abstract,
        rights: r.rights, catalog: r.catalog, dpul: r.dpul, manifest: r.manifestUrl, canvases: r.canvases.length,
      })),
      scraped_at: now.toISOString(),
    },
    image_source: {
      provider: 'princeton',
      provider_name: 'Princeton University Library',
      source_url: lead.dpul,
      // Two books cut from one record (a volume of a multi-volume manifest) need a
      // discriminator, or the fingerprint gate reads vol. 2 as a duplicate of vol. 1.
      identifier: spec.volume == null ? lead.arkFull : `${lead.arkFull}#vol-${spec.volume + 1}`,
      iiif_manifest: lead.manifestUrl,
      license: NKC,
      license_url: NKC,
      rights: 'No Known Copyright',
      digitized_by: 'Princeton University Library',
      attribution: 'Princeton University Library, Special Collections',
      shelfmark,
      contributing_library: 'Princeton University Library, Special Collections — Garrett-Gates and Princeton Mesoamerican Manuscripts',
      access_date: now,
    },
    shelfmark,
    notes,
    acquisition_campaign: CAMPAIGN,
    status: 'draft',
    ...publication,
    created_at: now,
    updated_at: now,
  }, { importer: 'maya-mss-6559', sourceIdentifier: lead.arkFull, sourceUrl: lead.manifestUrl });

  if (!acquired.inserted) {
    console.log(`  SKIP — ${acquired.reason}: ${acquired.message || ''}`);
    report.push({ key: spec.key, outcome: 'skipped', why: acquired.message });
    continue;
  }

  await db.collection('books').updateOne({ id: bookIdStr }, { $set: { hidden_reason: hiddenReason } });

  // Hold before any page exists, so no lane can see a book with pages and no hold.
  const held = await holdBook(db, bookIdStr, { ...HOLD, source: 'maya-mss-6559' });
  console.log(`  hold: ${held.outcome}`);

  const docs = pages.map((p, i) => {
    const pid = new ObjectId();
    const photo = `${p.svc}/full/full/0/default.jpg`;
    return makePageDoc({
      _id: pid,
      id: pid.toHexString(),
      book_id: bookIdStr,
      page_number: i + 1,
      ...(spec.group ? { part_title: p.record.title, source_ref: p.record.arkFull } : {}),
      ...(p.label ? { page_label: p.label } : {}),
      photo,
      photo_original: photo,
      thumbnail: `${p.svc}/full/200,/0/default.jpg`,
      catalog_metadata: { canvas: p.canvas, label: p.label, manifest: p.record.manifestUrl, ark: p.record.arkFull },
      created_at: now,
      updated_at: now,
    });
  });
  for (let s = 0; s < docs.length; s += 500) await db.collection('pages').insertMany(docs.slice(s, s + 500), { ordered: false });
  const rows = await db.collection('pages').countDocuments({ book_id: bookIdStr });
  console.log(`  inserted ${bookIdStr} (${slug}) + ${rows} pages${rows === pages.length ? '' : ` — MISMATCH, expected ${pages.length}`}`);
  report.push({ key: spec.key, outcome: 'inserted', id: bookIdStr, slug, pages: pages.length, rows, records: records.length });
}

await client.close();
console.log('\n' + JSON.stringify(report, null, 1));
