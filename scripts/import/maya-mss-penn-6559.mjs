#!/usr/bin/env node
/**
 * Maya manuscripts from Penn's Berendt-Brinton collection (Ms. Coll. 700), from a
 * LOCAL OPenn download (#6559).
 *
 * PRIOR ART: scripts/import/maya-mss-6559.mjs — the Princeton half of the same
 * campaign; it builds pages that point at a IIIF service, and Penn has none to point
 * at from here (OPenn refuses our Hetzner boxes, so maya-mss-6559 could not fetch
 * these seven). This script keeps its guards and its metadata shape, and reads a
 * folder instead: the OPenn "web" derivatives (about 1326x1800) and the item's own
 * TEI, downloaded on a laptop and copied to this box. The R2 write is the shape of
 * scripts/import/chilam-balam-calkini-byu.mjs (validateR2Key + assertBookScopedKey).
 *
 * WHAT IT IMPORTS: only items whose TEI <licence> is the Creative Commons Public
 * Domain Mark. The licence is re-read from every TEI and anything else is refused,
 * so an item cannot slip in by being added to the list.
 *
 * PAGES: one page per OPenn surface, in OPenn file order (the NNNN in
 * `<id>_NNNN_web.jpg`), checked against the TEI <facsimile> order; `page_label` is
 * the surface name ("Front cover", "iii", "12v"). Each image is written to R2 as
 * `pages/<book_id>/NNNN.jpg`, with a 200px thumbnail at `pages/<book_id>/NNNN-thumb.jpg`.
 * These are OPenn's web derivatives, NOT the masters: the TIFF masters (about 54 MB
 * each) stay at Penn, and every page records its master's URL in
 * `archive_metadata.master_url`, so a full-resolution upgrade is possible later.
 * `archived_photo` is set to the R2 copy so the campaign archiver does not try
 * (and fail) to fetch from OPenn.
 *
 * LANDS: hidden (publication `hidden`/`unprocessed`), tagged
 * `acquisition_campaign: maya-mss-6559`, and HELD with reason `maya-mss-6559`
 * BEFORE any page row exists.
 *
 *   node --env-file=.env.production.local scripts/import/maya-mss-penn-6559.mjs \
 *     --dir=/mnt/HC_Volume_105839809/imports/penn-maya-6559 [--dry-run] [--only=<item>]
 *
 * Idempotent: insertBookIfNew() declines an item already held (identifier = the
 * Penn call number).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook, isHeld } from '../lib/pipeline-hold.mjs';
import { initialPublication } from '../lib/publication.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { validateR2Key, assertBookScopedKey } from '../lib/r2-key.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const DIR = arg('dir');
const ONLY = arg('only');
// A book whose insert and hold landed but whose pages did not (a run that died
// mid-upload). Reused, after checking it is this item's and has no pages.
const RESUME_BOOK = arg('resume-book');
// Re-upload pages that were imported from a truncated download, once a complete
// file is back in --dir. Writes NNNN.jpg and repoints the page.
const REPAIR = process.argv.includes('--repair');
if (!DIR) { console.error('--dir=<local OPenn download> is required'); process.exit(1); }
if (RESUME_BOOK && !ONLY) { console.error('--resume-book needs --only=<item>'); process.exit(1); }

const CAMPAIGN = 'maya-mss-6559';
const ISSUE = 6559;
const PDM = 'http://creativecommons.org/publicdomain/mark/1.0/';
const OPENN = 'https://openn.library.upenn.edu/Data/0002';
const HOLD = {
  reason: CAMPAIGN,
  issue: ISSUE,
  release: 'Opus OCR of the book is done (claude-ocr.mjs, maya-ref-opus-6559 recipe, #6559) and Derek has chosen its translation lane; release with --to ocr_complete only then',
  release_when: { kind: 'issue', ref: ISSUE },
};
const COLLECTIONS = ['maya', 'mesoamerican', 'americas'];
const BERENDT_PROVENANCE = 'Part of the Berendt-Brinton Linguistic Collection: the papers of C. Hermann Berendt (1817–1878), later acquired by Daniel Garrison Brinton (1837–1899), and from him the University of Pennsylvania.';
const THUMB_WIDTH = 200;

/** Titles, authors and languages follow the item's TEI; see each note. */
const BOOKS = [
  {
    item: 42,
    title: 'Lengua maya, vol. 1',
    display_title: "Lengua maya, vol. 1: C. Hermann Berendt's notebook of Mayan vocabularies and texts, 1864–1868",
    author: 'C. Hermann Berendt',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya', "Ch'ol", 'Itzá', 'Kaqchikel', 'Nahuatl', 'Otomi', 'French', 'German', 'Latin'],
    published: '1864-1868',
    notes: [
      'The first of three notebooks in which C. Hermann Berendt copied documents on the Mayan languages (vols. 2 and 3 are Ms. Coll. 700 Items 43 and 44). Eighteen numbered entries with Berendt\'s table of contents: vocabularies (Waldeck\'s Maya vocabulary corrected from Beltrán, Petén Itzá, Chol "Putum", Kaqchikel, Nahuatl and Otomi) and texts, especially on the Catholic sacraments, each with his notes on sources.',
      'Entry 17 is a pasted clipping of a printed broadside: an imperial proclamation of November 1864 to the chiefs and people of Chan Santa Cruz ("Jefes y habitantes de Chan Santa Cruz…"), in Spanish and Maya on facing pages. Entry 18 is a clipping headed "Indios mayas" from the Diario del Imperio.',
      'Written in Providence, R.I., in 1864 and continued at Sacluc, Guatemala (1867) and Mérida (1868). Penn records the main language as Spanish.',
    ],
  },
  {
    item: 43,
    title: 'Lengua maya, vol. 2',
    display_title: "Lengua maya, vol. 2: Berendt's copies from the Pío Pérez papers and the Books of Chilam Balam, with the Chicxulub chronicle, 1868",
    author: 'C. Hermann Berendt; Juan Pío Pérez',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1868',
    notes: [
      'The second of Berendt\'s three "Lengua maya" notebooks (Ms. Coll. 700 Items 42–44), written in Mérida in 1868. Ten entries copied from documents in the collection of Juan Pío Pérez and from the Books of Chilam Balam: histories, prophecies and the reckoning of time. Entry 1 begins with the Maya and a Spanish translation on facing pages.',
      'Entry 4 is the land title and chronicle of Chicxulub, entirely in Maya; Berendt notes that the original was in the village archive of Chicxulub, and that a copy with a Spanish translation by Manuel Encarnación Avila belonged to Pedro Regil y Peón. It ends with lists of the conquistadors\' names. Entry 9 is a Maya version of the Historia de la doncella Teodor.',
      'Berendt marks corrections and comparisons in red ink and other notes in blue. On p. 221 he corrects a shift of 300 years that he says Pío Pérez introduced, so that Pérez\'s "2003" should read 1703.',
    ],
  },
  {
    item: 44,
    title: 'Lengua maya, vol. 3',
    display_title: "Lengua maya, vol. 3: Berendt's copies of Maya history, calendar and texts, with the Maní chronicle and the 1850 Caste War peace proposals, 1870",
    author: 'C. Hermann Berendt; Juan Pío Pérez',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish', 'French'],
    published: '1870',
    notes: [
      'The third of Berendt\'s three "Lengua maya" notebooks (Ms. Coll. 700 Items 42–44), written in Mérida in 1870: copies of Maya texts on history, astrology and the calendar.',
      'Entries include a zodiacal almanac; fragments of biblical stories; a history of Yucatán from the Códice Pérez, copied from the Chilam Balam of Maní, with the corresponding Tizimín text on facing pages (dates 1522–1611); a table of Maya years against the Christian era; the poem "Yacunah Cay" (Canto de amor); the land title of Acineh Cheltun (1677–1769); a governor\'s order of 1803 on the mail; an invocation to the sun; two prayers; and, as entry 11, the peace proposals made by the rebel Maya leaders (Florentino Chan, Venancio Pec, Bonifacio Novelo) in an 1850 letter to the priest José Antonio García of Chemax, copied from Crescencio Carrillo\'s collection of Caste War papers.',
    ],
  },
  {
    item: 49,
    title: 'Chilam Balam (Berendt facsimiles of Chumayel and Tizimín)',
    display_title: "Chilam Balam: Berendt's manuscript facsimiles of the Books of Chumayel and Tizimín, with Kaua and Ixil excerpts, 1868–1870",
    author: 'C. Hermann Berendt (copyist)',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1868-1870',
    notes: [
      'Berendt\'s manuscript facsimiles of sections of the Books of Chilam Balam of Chumayel and of Tizimín, with excerpts from those of Kaua and Ixil, focusing on calendrical and historical matter; dates in the texts run from 1513 to 1824. Brief introductions are in Spanish.',
      'Copied in Mérida in 1868 and 1870. Five items are laid in: a diagram between pp. 38 and 39, and notes inside the back cover.',
    ],
  },
  {
    item: 50,
    title: 'Chilam Balam (Códice Pérez)',
    display_title: "Chilam Balam (Códice Pérez): Berendt's facsimile of Juan Pío Pérez's collection of Chilam Balam extracts, 1870",
    author: 'Juan Pío Pérez (collector); C. Hermann Berendt (copyist)',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1870',
    notes: [
      'Berendt\'s manuscript facsimile of the collection Juan Pío Pérez made at Ticul from the Books of Chilam Balam, mainly calendrical and historical; dates in the texts run from 1511 to "2003" (Pérez\'s 300-year shift; see Lengua maya vol. 2). An appendix holds Maya legal documents, some with Spanish translations.',
      'Copied in Mérida in 1870. The half-title and spine call it "Códice Perez". Eight leaves once laid in (one a printed calendar table) are in a separate folder at Penn.',
    ],
  },
  {
    item: 221,
    title: 'Manuscrito cakchiquel ó sea memorial de Tecpan-Atitlan (Solola)',
    display_title: 'Memorial de Tecpán-Atitlán (Memorial de Sololá, the "Annals of the Cakchiquels"), Kaqchikel manuscript, ca. 1619–1650',
    author: 'Francisco Hernández Arana Xajilá; Francisco Díaz Gebuta Quej; and the Xajil family',
    language: 'Kaqchikel',
    languages: ['Kaqchikel', 'Spanish'],
    published: '1619-1650',
    notes: [
      'An early 17th-century transcription in Kaqchikel of the documents of the Xajil family of the Kaqchikel people, whose capital had been Iximché (Tecpán) and who later lived at Sololá. Pp. 1–17 record village and family events, 1586–1619: births, baptisms, marriages, disputes and contributions. Pp. 18–96 are the chronicle of the Kaqchikel from their legendary beginnings at Tulan into the early 17th century, with their relations to the Tz\'utujil and K\'iche\'; the internal revolt at Iximché in the late 15th century (p. 48) becomes the epoch from which later events are dated, and the arrival of the Spanish in 1524 is reported on p. 56. The last pages (92–96) are by Don Pedro Elías Martín, governor from 1584, and run to 1596. The manuscript is a fragment and ends abruptly.',
      'The Spanish title page is Brasseur de Bourbourg\'s, added after he took the manuscript into his possession around 1855 (his bookplate is on it). Later owned by Daniel Garrison Brinton (ex libris stamps). Penn dates the transcription between 1619 (p. 15) and 1650 (Brinton), probably at Sololá.',
    ],
  },
  {
    item: 241,
    title: 'Literatura de la lengua maya (Berendt papers, with the Título de tierras de Chacxulubchen)',
    display_title: "Literatura de la lengua maya: Berendt's papers on Maya, with his copy of the Título de tierras del pueblo de Chacxulubchen (Chicxulub), ca. 1868–1871",
    author: 'C. Hermann Berendt',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya', 'German', 'English'],
    published: '1868-1871',
    notes: [
      'A folder of Berendt\'s drafts and loose notes on the Maya language, kept in a cardboard folder he labelled "Literatura de la lengua maya" (the cover is scanned). Penn records it as predominantly Spanish, with Maya vocabulary, some German and a little English.',
      'It holds a 12-leaf booklet, "Titulo de tierras del pueblo de Chacxulubchen (hoy Chicxulub), traduccion verbal por D. Man. Encarnación Avila", copied by Berendt in Mérida in 1868 (another copy is in Lengua maya vol. 2, Ms. Coll. 700 Item 43); about six leaves of drafts of his preface to his copy of the Diccionario maya-español del Convento de San Francisco de Mérida, with the first two pages of entries and notes on the copy of the cura Meneses; German notes on the Indians of eastern Mexico to the Isthmus of Tehuantepec; nine leaves on Juan Pío Pérez\'s Diccionario español-maya de Ticul; and an outline of a bibliography of the Mayan languages.',
      'No Brinton ex libris; transferred with the Brinton Library from the Penn Museum Library.',
    ],
  },

  // ── Wave 2 (2026-10-24): the remaining Maya-language Ms. Coll. 700 items with
  // images, from scripts/import/maya-sources-survey-6559.md. `language` is Penn's
  // TEI mainLang, as for 42 and 241; the Mayan language it names goes in
  // `languages[]`. Not listed: Item 1 (the three-volume Motul copy) — its download
  // never started (TEI and all 2,602 images missing), so its volume split is
  // unknown; Item 243 has no images on OPenn.
  {
    item: 187,
    title: 'Chilam Balam de Chumayel ; Chilam Balam de Tizimin (copy of Berendt\'s facsimiles)',
    display_title: "Chilam Balam de Chumayel and de Tizimín: a later copy of Berendt's facsimiles, with Ixil, Kaua and the Cuaderno de Teabo, 1870–1942",
    author: 'Unidentified copyist, after C. Hermann Berendt',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1870-1942',
    notes: [
      'A copy in an unidentified hand of Berendt\'s manuscript facsimiles of the Books of Chilam Balam (Ms. Coll. 700 Item 49, Mérida 1868–1870): mainly Chumayel and Tizimín, with sections from Ixil and Kaua and what Berendt called the Cuaderno de Teabo. Chumayel is given here as one continuous text, where Berendt\'s copy has it in two sections; otherwise it follows his order, leaving out most of his drawings, diagrams, title pages and notes. His Tizimín title page (Mérida, 1870) is kept (f. 90r).',
      'This is a copy of a copy, not a colonial witness. Penn dates it between 1870 and its accession in 1942; it carries no Brinton ex libris and is not in Brinton\'s 1900 list of the Berendt collection.',
    ],
  },
  {
    item: 231,
    title: 'Extracts from the Chilam Balam of Mani and the Chilam Balam of Oxkutzcab',
    display_title: "Extracts from the Chilam Balam of Maní and of Oxkutzcab: a later copy of Berendt's Códice Pérez extracts, 1868–1938",
    author: 'Unidentified copyist, after C. Hermann Berendt and Juan Pío Pérez',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish', 'English'],
    published: '1868-1938',
    notes: [
      'A late 19th- or early 20th-century copy, in an unidentified hand, of extracts from the Chilam Balam of Maní and of Oxkutzcab, following Berendt\'s 1868 copy from the Códice Pérez (Ms. Coll. 700 Item 43, pp. 156–240). A fragment labelled "Book No. II", it begins at "No. 7 continued" (p. 143), with No. 8 (p. 178) and No. 9 (p. 226), and ends with notes on the Chilam Balam of Maní of 1689 in the Pío Pérez collection (pp. 242–243).',
      'Most of Berendt\'s drawn symbols are reduced to a single sketch and ditto marks; pencilled margin references follow Berendt\'s pagination. Penn dates the copy between 1868 and 1938. No Brinton ex libris.',
    ],
  },
  {
    item: 248,
    title: 'Notes and drafts on Chilam Balam books',
    display_title: "Notes and drafts on the Books of Chilam Balam: Berendt's working papers, ca. 1868–1871",
    author: 'C. Hermann Berendt',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya'],
    published: '1868-1871',
    notes: [
      'Berendt\'s loose notes and drafts on the Books of Chilam Balam, including a 24-page draft preface and table of contents titled "Chilam Balam: articulos y fragmentos de MSS antiguos en lengua maya, colectados por C. H. Berendt, M.D., Merida, 1868", which corresponds to his facsimile volumes (Ms. Coll. 700 Items 49 and 50).',
      'The notes describe individual books of Chilam Balam (Maní, 1697, with reference to Father Zúñiga; Kaua, 1789, Balthasar Ferrais; Chumayel, 1782, Juan Josef Hoil), a Pío Pérez manuscript on the Maya calendar, and include a two-page comparative chart. Penn records it as predominantly Spanish.',
    ],
  },
  {
    item: 2,
    title: 'Diccionario español-maya de Ticul, 1690',
    display_title: "Diccionario español-maya de Ticul (1690), with Pío Pérez's Maya-Spanish dictionary: Berendt's copy, Mérida 1870",
    author: 'Juan Pío Pérez; C. Hermann Berendt (copyist)',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya'],
    published: '1870',
    notes: [
      'A third-generation copy of a lost 17th-century Spanish–Maya dictionary found in the parish archive of Ticul in 1836, copied by Juan Pío Pérez in 1836 and 1847 and from Pérez\'s 1847 copy by Berendt in Mérida in 1870. It includes lists of Maya kinship terms (p. 259) and of Maya words alike in sound but different in meaning (p. 262), and is followed in the same volume by the corresponding Maya–Spanish dictionary compiled by Pérez in 1847.',
    ],
  },
  {
    item: 228,
    title: 'Apuntes para un diccionario de la lengua maya',
    display_title: "Apuntes para un diccionario de la lengua maya: Berendt's partial copy of Juan Pío Pérez's dictionary notes, Mérida 1870",
    author: 'Juan Pío Pérez; C. Hermann Berendt (copyist)',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya'],
    published: '1870',
    notes: [
      'Berendt\'s partial copy, made in Mérida in 1870, of Juan Pío Pérez\'s notes for a dictionary of the Maya language, lent to him by Pérez\'s niece Nicolasa Peón y Escalante (Pérez\'s original is Ms. Coll. 700 Item 5). After Pérez\'s prologue (pp. V–X) come two parts, each alphabetised by the Maya word; in Part 2 Berendt marks many entries with an asterisk or a cross, and he adds pencilled notes throughout.',
    ],
  },
  {
    item: 8,
    title: 'Arte de lengua maya',
    display_title: "Arte de lengua maya: Berendt's copy of Gabriel de San Buenaventura's 1684 grammar, Mérida 1868",
    author: 'Gabriel de San Buenaventura; C. Hermann Berendt (copyist)',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya'],
    published: '1868',
    notes: [
      'Berendt\'s fair copy, made in Mérida in 1868, of Gabriel de San Buenaventura\'s Arte de la lengua maya (Mexico, 1684), the first printed grammar of Maya, with a facsimile title page and the Spanish front matter. Berendt adds his own index to the grammar (pp. 159–163).',
    ],
  },
  {
    item: 179,
    title: 'Miscellanea maya',
    display_title: "Miscellanea maya: Brinton's scrapbook of C. Hermann Berendt's notes, manuscripts and clippings on Maya language and ethnography, 1864–1873",
    author: 'C. Hermann Berendt; Daniel Garrison Brinton (compiler)',
    language: 'Spanish',
    languages: ['Spanish', 'English', 'German', 'Yucatec Maya', 'Kaqchikel', "K'iche' Maya", 'Huastec', 'Tzeltal', 'Nahuatl', 'Otomi'],
    published: '1864-1873',
    notes: [
      'A 365-leaf scrapbook assembled by Daniel Garrison Brinton from Berendt\'s loose papers, the first of three (Items 179–181). Berendt\'s Spanish table of contents (f. 3) has 29 headings in three sections: grammar (ff. 4–53), including comparative alphabets of Mayan and other Mexican languages; vocabulary (ff. 54–74), with comparative vocabularies of Maya, Nahuatl, Otomi, Kaqchikel, K\'iche\', Chontal, Huastec, Mam, Poqomchi\' and Tzeltal, and a fold-out chart of counting words; and ethnology (ff. 75–98): the character, customs and superstitions of the Maya of Yucatán, calendars, hieroglyphs, antiquities and an ethnological map.',
      'Penn records it as predominantly Spanish, with English and German. Its contributors include Brasseur de Bourbourg, George Gibbs, Florentino Jimeno, José T. Cervera and Juan Pío Pérez.',
    ],
  },
  {
    item: 21,
    title: 'Novena de Christo crucificado',
    display_title: "Novena de Christo crucificado and the Maya texts of the Declaración de la doctrina christiana: Berendt's copy of Beltrán de Santa Rosa, Mérida 1868",
    author: 'Pedro Beltrán de Santa Rosa; C. Hermann Berendt (copyist)',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya'],
    published: '1868',
    notes: [
      'Berendt\'s copy, made in Mérida in 1868 from a printed copy owned by Pedro Regil y Peón, of Pedro Beltrán de Santa Rosa\'s 1740 Novena: prayers in Maya and a dialogue or catechism in Maya with a facing Spanish translation, after long Spanish front matter. It is followed by the Maya texts of the second edition (1757) of Beltrán\'s Declaración de la doctrina christiana en el idioma yucateco: the Lord\'s Prayer, Ave Maria, Creed, commandments, sacraments, articles of faith and catechetical dialogues. Berendt notes (p. [86]) that he left out the Spanish discussion of pp. 2–22 of the print.',
    ],
  },
  {
    item: 203,
    title: 'Lengua mayá de Yucatan',
    display_title: "Lengua mayá de Yucatán: Berendt's notes on Itzá, Lacandon and Yucatec Maya, with Maya song texts, ca. 1866–1868",
    author: 'C. Hermann Berendt',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Itzá', 'Lacandon', 'Spanish', 'German'],
    published: '1866-1868',
    notes: [
      'Berendt\'s notes on Maya as spoken in Yucatán, with particular reference to the Itzá (Petén) and Lacandon dialects of Guatemala, followed by a collection of song texts in Maya written down in Mérida in 1868. Probably written in the Petén and Mérida between 1866 and 1868. Seven loose leaves, among them a sheet of music once pasted inside the back cover, are shelved separately at Penn.',
    ],
  },
  {
    item: 234,
    title: 'La literatura de la lengua maya',
    display_title: "La literatura de la lengua maya: Berendt's draft bibliography of the Maya language, with correspondence, 1864–1872",
    author: 'C. Hermann Berendt',
    language: 'Spanish',
    languages: ['Spanish', 'English', 'German'],
    published: '1864-1872',
    notes: [
      'Berendt\'s draft bibliography of the Maya language, written mainly in Providence, R.I., in 1864–1865, covering works from 1565 to 1865, with notes on contents, editions, manuscript locations and authors, among them Gabriel de San Buenaventura, Diego de Rivas, Alonso Solana, Bernardino de Valladolid, Luis de Villalpando and Juan Pío Pérez. He includes a short autobiographical entry (f. 4r) and a pencilled timeline of his residences, 1848–1870.',
      'With it are 44 loose items: notes of about 1864–1871 and correspondence of 1868–1872 with G. J. Adler, J. C. E. Buschmann, George Gibbs, Simón Sarlat and the American Bible Society. This is secondary literature about Maya, not a Maya text.',
    ],
  },
  {
    item: 235,
    title: 'Literatura de la lengua maya',
    display_title: "Literatura de la lengua maya: Berendt's unfinished fair copy of his Maya bibliography, 1871–1876",
    author: 'C. Hermann Berendt',
    language: 'Spanish',
    languages: ['Spanish', 'English'],
    published: '1871-1876',
    notes: [
      'An unfinished, cleanly written revision of the draft bibliography in Ms. Coll. 700 Item 234. Entries run roughly chronologically from 16th-century authors, with anonymous works at the back (pp. 73–76) and an index of 53 names (pp. 101–102), but only ten entries were filled in: Luis de Villalpando, Diego de Landa, Alonso de la Solana, Francisco Torralva, Frédéric de Waldeck, B. M. Norman, Henri Ternaux, Mr. Tromback of Belize, Francisco Pimentel and Berendt himself (p. 71). Written in or after 1871, with notes possibly as late as 1876. This is secondary literature about Maya, not a Maya text.',
    ],
  },
  {
    item: 197,
    title: 'Theologia indorum',
    display_title: "Theologia indorum: an excerpt from Domingo de Vico's 1553 treatise in Tz'utujil, with two sermons in Achi, 18th century?",
    author: 'Domingo de Vico',
    language: "Tz'utujil",
    languages: ["Tz'utujil", 'Achi', 'Spanish', 'Latin'],
    published: '17--',
    notes: [
      'A copy of an excerpt from Domingo de Vico\'s Theologia Indorum (1553), followed by a sermon on Matthew 11:28 and a probably incomplete sermon on Luke 10:3 (its title names Mark). Penn gives the language as Tz\'utujil, and the spine says the sermons are in Achi; titles are in Spanish and Latin, with Latin Bible references. The last two leaves seem out of order and the end is probably lost. Penn dates it "17--?", probably Guatemala.',
      'Earlier owners: Brasseur de Bourbourg, Alphonse Pinart (Série E.3, No. 101) and Eugène Boban (bookplates and label), then Brinton. Not a Berendt copy.',
    ],
  },
  {
    item: 56,
    title: 'Zaccicoxol, ó baile de Cortés en kiché y castellano',
    display_title: "Zaccicoxol, ó baile de Cortés: a K'iche' and Spanish dance-drama of the conquest of Mexico, Cobán 1875",
    author: 'Anonymous',
    language: "K'iche' Maya",
    languages: ["K'iche' Maya", 'Spanish'],
    published: '1875',
    notes: [
      'A dance-drama in K\'iche\' and Spanish on the conquest of Mexico, with Moctezuma and Cortés among the characters; the title is the name of another character. Copied in Cobán, Guatemala, in 1875. The third letter of the title is a Parra letter, later written as a double c.',
      'Brinton called it "a modern drama written by a native, in Kiche and Spanish, the plot based on the conquest of Mexico… one of the few correct specimens of the native drama which have been preserved".',
    ],
  },
  {
    item: '236_237_238',
    title: 'Calendario de los indios de Guatemala',
    display_title: "Calendario de los indios de Guatemala: copies of the Kaqchikel calendar of 1685, Hernández Spina's K'iche' calendar of Ixtlavacan (1854) and the K'iche' calendar of 1722, ca. 1884",
    author: 'Daniel Garrison Brinton (compiler); Vicente Hernández Spina',
    language: 'English',
    languages: ['English', "K'iche' Maya", 'Kaqchikel', 'Spanish'],
    published: '1884',
    notes: [
      'Three works on the calendars of the Maya of Guatemala (Ms. Coll. 700 Items 236, 237 and 238), copied by or for Daniel Garrison Brinton, probably from other copies, and bound together: ff. 1–20, the calendar of the Kaqchikel, 1685; ff. 21–34, a partial copy of the calendar kept by the "priests of the sun" of Santa Catarina Ixtlavacan, a K\'iche\' town, found by the priest Vicente Hernández Spina in 1854, with an English translation of its introduction on the history and religion of the town; ff. 35–52, the calendar of the K\'iche\', 1722.',
      'These are 19th-century copies, not the colonial calendars. The title pages of Items 236 and 238 are typed on the back of an 1884 form letter of Brinton\'s as professor at the Academy of Natural Sciences, Philadelphia. Penn gives English as the main language.',
    ],
  },
  {
    item: 226,
    title: 'Miscelanea en lengua yndia-kiché',
    display_title: "Miscelanea en lengua yndia-kiché: Ramón María Posada's K'iche' doctrine, prayers and lessons, with notes on the calendar of Santa Catarina Ixtlavacan, ca. 1861",
    author: 'Ramón María Posada',
    language: 'Spanish',
    languages: ['Spanish', "K'iche' Maya", 'Latin'],
    published: '1861',
    notes: [
      'Catholic doctrine, prayers and lessons in K\'iche\' composed by the Jesuit missionary Ramón María Posada for his mission work (foreword, p. ii). Pp. 1–17 have Spanish titles (Creed, Lord\'s Prayer, Ave Maria, general confession, acts of contrition, articles of faith, works of mercy, Beatitudes, lists of sacraments, sins and virtues); pp. 19–67 are entirely in K\'iche\', apparently dialogues between priest and congregant.',
      'At the back are Spanish descriptions of the town of Santa Catarina Ixtlavacan (Ixtahuacán?, p. 250) and the beliefs of its K\'iche\' people, mainly on the calendar, with a sample calendar for 1854 (p. 253), and short K\'iche\' texts for marriage, proclamations and remembrances of the mission, one citing 1861 (p. 263). Penn records Spanish as the main language.',
    ],
  },
  {
    item: 54,
    title: 'Arte de lengua cakchiquel',
    display_title: "Arte de lengua cakchiquel: a 19th-century copy of Estevan Torresano's 1754 Kaqchikel grammar, with a K'iche'–Kaqchikel–Tz'utujil comparison",
    author: 'Estevan Torresano',
    language: 'Spanish',
    languages: ['Spanish', 'Kaqchikel', "K'iche' Maya", "Tz'utujil"],
    published: '1850-1875',
    notes: [
      'A 19th-century copy of Estevan Torresano\'s 1754 grammar of Kaqchikel, based on Flores\'s Arte de la lengua metropolitana del reyno cakchiquel (1753), taken from a copy made by or for E. G. Squier of the original in the Bibliothèque Nationale. It includes counting in Kaqchikel (pp. 109–126); a "Parallelo de las lenguas Kiche, Cakchiquel y Tzutuhil" with a four-column comparative vocabulary (pp. 127–148); an orthography with the Parra letters for the six sounds peculiar to these languages (pp. 149–155); and petitions and prayers in Spanish with Kaqchikel translations (pp. 159–179). Penn dates the copy between 1850 and 1875, perhaps made in the United States.',
    ],
  },
  {
    item: 55,
    title: 'Arte de lengua kiché',
    display_title: "Arte de lengua kiché: a 19th-century copy of Bartolomé de Anleo's 17th-century K'iche' grammar",
    author: 'Bartolomé de Anleo',
    language: 'Spanish',
    languages: ['Spanish', "K'iche' Maya"],
    published: '1850-1875',
    notes: [
      'A 19th-century copy of Bartolomé de Anleo\'s 17th-century grammar of K\'iche\', with sections on orthography and numerals, taken from a copy made by or for E. G. Squier of a Bibliothèque Nationale copy made by Fr. Antonio Ramírez de Utrilla in 1744. The first letter of "kiché" in the title is a Parra letter. Two notes on K\'iche\' are laid inside the front cover. Penn dates the copy between 1850 and 1875, probably made in the United States.',
    ],
  },
  {
    item: 68,
    title: 'Libro en pocomchi y kekchi',
    display_title: "Libro en pocomchi y kekchi: original 18th-century sermons, doctrines and a Q'eqchi' grammar from the parish archive of Cobán, Verapaz",
    author: 'Hippolito de Aguilera and others',
    language: "Q'eqchi'",
    languages: ["Q'eqchi'", "Poqomchi'", 'Latin', 'Spanish'],
    published: '17--',
    notes: [
      'Original documents from the parish archive of Cobán, Verapaz, given to Berendt in 1875 by Manuel González, priest and vicar of Cobán: sermons, catechisms and other religious texts in Q\'eqchi\' and Poqomchi\', a Q\'eqchi\' grammar (ff. 97r–131v) and phrase lists in the two languages, with a little Latin chant notation (f. 59v). The dated documents are of the late 1730s and early 1740s. Berendt added a table of contents and a title page, "Varios escritos en pocomchi y kekchi del Archivo Parroquial de Coban, Vera Paz" (f. ii).',
      'Among them is the original of Hippolito de Aguilera\'s Doctrina christiana (copied as Ms. Coll. 700 Item 62), with sermons by Aguilera; the grammar is the original of Berendt\'s fair copy, Item 69. These are colonial manuscripts, not Berendt copies.',
    ],
  },
  {
    item: 61,
    title: 'Diccionario pocomchi-castellano y castellano-pocomchi de S. Cristobal Cahcoh',
    display_title: "Diccionario pocomchi-castellano y castellano-pocomchi de San Cristóbal Cahcoh: fragments of a 16th-century Poqomchi' dictionary",
    author: 'Anonymous (attributed to Francisco de Viana or Dionisio de Zúñiga)',
    language: 'Spanish',
    languages: ['Spanish', "Poqomchi'"],
    published: '15--',
    notes: [
      'Fragments of a 16th-century Poqomchi\'–Spanish and Spanish–Poqomchi\' dictionary, rebound in the 19th century. Berendt received it in 1875 from Luis Rojas of San Cristóbal, Chiapas, a former Dominican and parish priest of San Cristóbal Cahcoh (f. 5r), and gave it its title page. He suggested the author might be Fray Francisco de Viana, in Verapaz 1575–1608; a photostat at Tulane with the same title is attributed to Dionisio de Zúñiga. Penn dates it "15--" after Brinton.',
      'Many pages are repaired and the first and last remain fragile. Four leaves laid in at the end hold Berendt\'s draft table of contents and notes on the manuscript.',
    ],
  },
  {
    item: 184,
    title: 'Vocabulario en lengua tzeldal iuxta ussum oppidii de Copanabastla',
    display_title: "Vocabulario en lengua tzeldal según el uso de Copanabastla: Alonso de Guzmán's 1620 revision of Domingo de Ara's Tzeltal dictionary",
    author: 'Alonso de Guzmán; after Domingo de Ara',
    language: 'Spanish',
    languages: ['Spanish', 'Tzeltal'],
    published: '1620',
    notes: [
      'An early 17th-century revision of Domingo de Ara\'s 16th-century Spanish–Tzeltal dictionary for the usage of Copanabastla (Copanaguastla), Chiapas. A note on f. 1r says Fray Alonso de Guzmán copied the vocabulary in 1620 in the Tzeltal province, in the town of Taquinvitz. An Ara manuscript, its model, is Ms. Coll. 700 Item 185.',
      'A note in Item 185 suggests both passed through the collections of Brasseur de Bourbourg, Alphonse Pinart and Eugène Boban before Brinton. A colonial manuscript, not a Berendt copy.',
    ],
  },
  {
    item: 185,
    title: 'Vocabulario de la lengua española y tzeldal',
    display_title: "Vocabulario de la lengua española y tzeldal: a 17th-century copy of Domingo de Ara's Spanish–Tzeltal dictionary",
    author: 'Domingo de Ara',
    language: 'Spanish',
    languages: ['Spanish', 'Tzeltal'],
    published: '16--',
    notes: [
      'A copy, probably of the 17th century, of Domingo de Ara\'s alphabetical list of Spanish names, words and phrases with their Tzeltal equivalents. Brasseur de Bourbourg\'s bookplate is inside the front cover; a 1922 letter from Adela Breton to G. B. Gordon suggests it was not part of the Berendt collection. Extensive worm damage on ff. 83–106 and minor damage throughout. A colonial manuscript, not a Berendt copy.',
    ],
  },
  {
    item: 83,
    title: 'Diccionario español-huasteco',
    display_title: "Diccionario español-huasteco: Berendt's draft Spanish–Huastec dictionary, after Tapia Zenteno, with Marcelo Alejandre's word list and a map of the Huasteca, 1867–1873",
    author: 'C. Hermann Berendt; Carlos de Tapia Zenteno; Marcelo Alejandre; Daniel Garrison Brinton',
    language: 'Spanish',
    languages: ['Spanish', 'Huastec'],
    published: '1867-1873',
    notes: [
      'Berendt\'s rough draft of a Spanish–Huastec dictionary of about 2,750 words on mixed papers, with many corrections in black and red ink, probably meant as a partner to Carlos de Tapia Zenteno\'s 18th-century Huastec–Spanish dictionary, which Berendt copied in New York in 1867. The entries (pp. 1–84) are followed by notes and pasted-in documents, including a list of Spanish words translated into Huastec signed by Marcelo Alejandre, 1872 (pp. 87–90); names of Huastec towns (pp. 93–96); a letter from Alejandre to Berendt, 1872 (pp. 109–114); memoranda by D. G. Brinton (pp. 117–121); and Berendt\'s "Mapa de la huaxteca", 1867 (p. 125).',
    ],
  },
  {
    item: 93,
    title: 'Modo de administrar los sacramentos en castellano y tzendal, 1707',
    display_title: "Modo de administrar los sacramentos en castellano y tzendal (1707): Berendt's copy, Tuxtla Gutiérrez 1870",
    author: 'Anonymous; C. Hermann Berendt (copyist)',
    language: 'Spanish',
    languages: ['Spanish', 'Tzeltal', 'Latin'],
    published: '1870',
    notes: [
      'Berendt\'s copy, made in Tuxtla Gutiérrez, Chiapas, in 1870, of a 1707 manual for administering baptism, viaticum, extreme unction and marriage in Spanish and Tzeltal, from the original then owned by José Hilario Aguilar, a priest in Chiapas (note, f. 4r; Berendt\'s signature, p. 44).',
    ],
  },
];

// ── TEI ────────────────────────────────────────────────────────────────
const unent = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const text = (s) => unent(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const one = (xml, re) => { const m = xml.match(re); return m ? text(m[1]) : null; };
const many = (xml, re) => [...xml.matchAll(re)].map((m) => text(m[1]));

function readTei(item) {
  const file = path.join(DIR, `item${item}`, `mscoll700_item${item}_TEI.xml`);
  const xml = readFileSync(file, 'utf8');
  const licences = [...xml.matchAll(/<licence target="([^"]+)">([\s\S]*?)<\/licence>/g)].map((m) => ({ target: m[1], text: text(m[2]) }));
  const imageLicence = licences.find((l) => /These images/.test(l.text)) || licences[0];
  if (!imageLicence || imageLicence.target !== PDM) {
    throw new Error(`item ${item}: image licence is ${imageLicence?.target || 'missing'}, not the Public Domain Mark — refusing`);
  }
  const msItem = (xml.match(/<msItem>([\s\S]*?)<\/msItem>/) || [])[1] || '';
  const textLang = xml.match(/<textLang mainLang="([^"]*)"(?: otherLangs="([^"]*)")?>([\s\S]*?)<\/textLang>/);
  const surfaces = [...xml.matchAll(/<surface n="([^"]*)"[^>]*>([\s\S]*?)<\/surface>/g)].map((m) => ({
    label: unent(m[1]),
    web: (m[2].match(/url="(web\/[^"]+)"/) || [])[1],
    master: (m[2].match(/url="(master\/[^"]+)"/) || [])[1],
    masterSize: (() => { const g = m[2].match(/<graphic height="(\d+)px" url="master\/[^"]+" width="(\d+)px"/); return g ? { width: +g[2], height: +g[1] } : null; })(),
  }));
  return {
    file,
    teiTitle: one(xml, /<titleStmt>\s*<title>([\s\S]*?)<\/title>/),
    titles: many(msItem, /<title>([\s\S]*?)<\/title>/g),
    authors: many(msItem, /<author>\s*<persName[^>]*>([\s\S]*?)<\/persName>/g),
    call: one(xml, /<idno type="call-number">([\s\S]*?)<\/idno>/),
    bibid: one(xml, /<altIdentifier type="bibid">\s*<idno>([\s\S]*?)<\/idno>/),
    oclc: one(xml, /<altIdentifier type="oclc">\s*<idno>([\s\S]*?)<\/idno>/),
    handle: one(xml, /<altIdentifier type="resource">\s*<idno>([\s\S]*?)<\/idno>/),
    summary: one(xml, /<summary>([\s\S]*?)<\/summary>/),
    mainLang: textLang?.[1] || null,
    otherLangs: textLang?.[2] || null,
    langNote: textLang ? text(textLang[3]) : null,
    origDate: one(xml, /<origDate>([\s\S]*?)<\/origDate>/),
    origPlace: many(xml, /<origPlace>([\s\S]*?)<\/origPlace>/g),
    origin: one(xml, /<origin>\s*<p>([\s\S]*?)<\/p>/),
    provenance: many(xml, /<provenance>([\s\S]*?)<\/provenance>/g),
    extent: one(xml, /<extent>([\s\S]*?)<\/extent>/),
    foliation: one(xml, /<foliation>([\s\S]*?)<\/foliation>/),
    subjects: many(xml, /<term>([\s\S]*?)<\/term>/g),
    imageLicence,
    metadataLicence: licences.find((l) => l !== imageLicence) || null,
    surfaces,
  };
}

/** Local files in OPenn order, checked one-to-one against the TEI surfaces. */
function pagePlan(item, tei) {
  const dir = path.join(DIR, `item${item}`, 'web');
  const files = readdirSync(dir).filter((f) => /_\d{4}_web\.jpg$/.test(f))
    .sort((a, b) => Number(a.match(/_(\d{4})_web/)[1]) - Number(b.match(/_(\d{4})_web/)[1]));
  if (files.length !== tei.surfaces.length) throw new Error(`item ${item}: ${files.length} files but ${tei.surfaces.length} TEI surfaces`);
  return files.map((f, i) => {
    const s = tei.surfaces[i];
    if (s.web !== `web/${f}`) throw new Error(`item ${item}: file ${i + 1} is ${f} but TEI surface ${i + 1} is ${s.web}`);
    const file = path.join(dir, f);
    return { file, name: f, label: s.label, master: s.master, masterSize: s.masterSize, truncated: isTruncated(file) };
  });
}

/**
 * A JPEG with no end-of-image marker is a cut-off download. Its header is valid,
 * so a "verified JPEG" check by magic bytes passes it; it decodes as the top of
 * the page and grey below. 14 of the 1,358 files copied here were like that.
 */
function isTruncated(file) {
  const b = readFileSync(file);
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return !(end >= 2 && b[end - 2] === 0xff && b[end - 1] === 0xd9);
}

// ── R2 ─────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function put(key, body, bookId) {
  // Both guards: an undefined segment, and a well-formed key that is not this
  // book's — the shape that fed 300 books each other's pages (#3362).
  validateR2Key(key, 'maya-mss-penn-6559');
  assertBookScopedKey(key, bookId, 'maya-mss-penn-6559');
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return `${PUBLIC}/${key}`;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * i)); }
  }
  throw last;
}

const thumb = (body) => sharp(body, { failOn: 'none' }).resize({ width: THUMB_WIDTH }).jpeg({ quality: 80 }).toBuffer();

/** The campaign hold, plus a repair step for a book imported with truncated images. */
function holdFor(plan) {
  const bad = plan.flatMap((p, i) => (p.truncated ? [i + 1] : []));
  if (!bad.length) return HOLD;
  return {
    ...HOLD,
    release: `First replace the ${bad.length} page image(s) imported from a truncated download (pages ${bad.join(', ')}; archive_metadata.truncated_download): re-download them from OPenn and run scripts/import/maya-mss-penn-6559.mjs --repair. Then: ${HOLD.release}`,
    detail: { truncated_pages: bad },
  };
}

/** Upload the complete file for every page still marked truncated_download. */
async function repair(tei, plan, itemUrl) {
  const book = await db.collection('books').findOne({ 'image_source.identifier': tei.call, acquisition_campaign: CAMPAIGN }, { projection: { id: 1, pipeline_auto: 1 } });
  if (!book) return { outcome: 'repair_no_book' };
  const pages = await db.collection('pages').find({ book_id: book.id, 'archive_metadata.truncated_download': { $exists: true } }, { projection: { id: 1, page_number: 1 } }).toArray();
  let fixed = 0;
  for (const pg of pages) {
    const p = plan[pg.page_number - 1];
    if (!p || p.truncated) { console.log(`  p.${pg.page_number}: local file still truncated`); continue; }
    const body = readFileSync(p.file);
    const meta = await sharp(body).metadata();
    const num = String(pg.page_number).padStart(4, '0');
    const [url, thumbUrl] = await Promise.all([
      put(`pages/${book.id}/${num}.jpg`, body, book.id),
      put(`pages/${book.id}/${num}-thumb.jpg`, await thumb(body), book.id),
    ]);
    await db.collection('pages').updateOne({ id: pg.id }, {
      $set: { photo: url, archived_photo: url, display_photo: url, thumbnail: thumbUrl, image_thumb: thumbUrl, image_width: meta.width, image_height: meta.height, 'archive_metadata.repaired_at': new Date(), updated_at: new Date() },
      $unset: { 'archive_metadata.truncated_download': '' },
    });
    fixed++;
  }
  const left = await db.collection('pages').countDocuments({ book_id: book.id, 'archive_metadata.truncated_download': { $exists: true } });
  if (!left && book.pipeline_auto?.hold?.detail?.truncated_pages) {
    await db.collection('books').updateOne({ id: book.id }, { $set: { 'pipeline_auto.hold.release': HOLD.release, 'pipeline_auto.hold.release_when': HOLD.release_when, 'pipeline_auto.hold.detail': null, updated_at: new Date() } });
  }
  console.log(`  repaired ${fixed}, ${left} still truncated`);
  return { outcome: 'repaired', id: book.id, fixed, left };
}

// ── Run ────────────────────────────────────────────────────────────────
const client = DRY_RUN && !REPAIR ? null : new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
if (client) await client.connect();
const db = client?.db('bookstore');
const report = [];

for (const spec of BOOKS.filter((b) => !ONLY || String(b.item) === ONLY)) {
  console.log(`\n=== item ${spec.item}`);
  let tei, plan;
  try {
    tei = readTei(spec.item);
    plan = pagePlan(spec.item, tei);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    report.push({ item: spec.item, outcome: 'failed', why: e.message });
    continue;
  }
  const itemUrl = `${OPENN}/mscoll700_item${spec.item}/`;
  console.log(`  ${tei.call}: "${tei.titles.join(' / ')}", ${tei.origDate}, mainLang ${tei.mainLang}; ${plan.length} pages; licence PDM`);
  const truncated = plan.filter((p) => p.truncated);
  if (truncated.length) console.log(`  ${truncated.length} truncated download(s): ${truncated.map((p) => p.name).join(', ')}`);
  if (REPAIR) {
    report.push({ item: spec.item, ...(await repair(tei, plan, itemUrl)) });
    continue;
  }
  if (DRY_RUN) {
    console.log(`    pages: ${plan[0].label} … ${plan[plan.length - 1].label}`);
    report.push({ item: spec.item, outcome: 'dry_run', pages: plan.length });
    continue;
  }

  const now = new Date();
  const hold = holdFor(plan);
  let bookIdStr;
  let slug = RESUME_BOOK || null;
  if (RESUME_BOOK) {
    const b = await db.collection('books').findOne({ id: RESUME_BOOK }, { projection: { id: 1, acquisition_campaign: 1, image_source: 1, pipeline_auto: 1 } });
    if (!b || b.image_source?.identifier !== tei.call || b.acquisition_campaign !== CAMPAIGN || !isHeld(b)) {
      throw new Error(`--resume-book ${RESUME_BOOK} is not a held ${CAMPAIGN} book for ${tei.call}`);
    }
    const existing = await db.collection('pages').countDocuments({ book_id: RESUME_BOOK });
    if (existing) throw new Error(`--resume-book ${RESUME_BOOK} already has ${existing} pages`);
    bookIdStr = RESUME_BOOK;
    await db.collection('books').updateOne({ id: bookIdStr }, { $set: { 'pipeline_auto.hold.release': hold.release, 'pipeline_auto.hold.release_when': hold.release_when, 'pipeline_auto.hold.detail': hold.detail ?? null, updated_at: now } });
    console.log(`  resuming ${bookIdStr} (held, no pages)`);
  } else {
    const bookId = new ObjectId();
    bookIdStr = bookId.toHexString();
    // Item 236_237_238 is three items bound as one; OPenn keeps the underscores.
    const base = `penn-mscoll700-item${String(spec.item).replace(/_/g, '-')}`;
    slug = base;
    for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { _id: 1 } }); i++) slug = `${base}-${i}`;
    const shelfmark = `University of Pennsylvania, Kislak Center (Rare Book & Manuscript Library), ${tei.call}`;
    const notes = [
      ...spec.notes,
      `Penn's catalogue title: "${tei.titles.map((t) => t.replace(/\s*:$/, '')).join(' : ')}".`,
      BERENDT_PROVENANCE,
      'Images: OPenn web derivatives (about 1326 × 1800 px). The full-resolution TIFF masters are on OPenn (each page records its master\'s URL); a full-resolution upgrade is available.',
      'Rights: Penn states that these images and their content are free of known copyright restrictions and in the public domain (Creative Commons Public Domain Mark 1.0). Penn\'s catalogue description is CC BY 4.0, © University of Pennsylvania Libraries.',
    ].join(' ');

    const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'unprocessed', note: `maya-mss-6559: held for the Opus lane (#${ISSUE})`, by: 'script:maya-mss-penn-6559', issue: ISSUE, now });
    const acquired = await insertBookIfNew(db, {
      _id: bookId,
      id: bookIdStr,
      slug,
      title: spec.title,
      display_title: spec.display_title,
      author: spec.author,
      language: spec.language,
      original_language: spec.language,
      languages: spec.languages,
      language_multi: true,
      field_provenance: { language: 'caller' },
      text_role: 'original',
      published: spec.published,
      categories: [],
      collections: COLLECTIONS,
      pages_count: plan.length,
      pages_ocr: 0,
      pages_translated: 0,
      pages_archived: 0,
      needs_splitting: false,
      page_count_source: 'openn_tei',
      dublin_core: {
        dc_identifier: [tei.call, tei.handle, tei.oclc, itemUrl].filter(Boolean),
        dc_source: itemUrl,
        dc_date: [tei.origDate].filter(Boolean),
        ...(tei.summary ? { dc_description: tei.summary } : {}),
        dc_subject: [...new Set(tei.subjects)],
      },
      catalog_metadata: {
        source: 'openn.library.upenn.edu (TEI)',
        tei: {
          title: tei.teiTitle, titles: tei.titles, authors: tei.authors, call_number: tei.call,
          bibid: tei.bibid, oclc: tei.oclc, handle: tei.handle, summary: tei.summary,
          main_lang: tei.mainLang, other_langs: tei.otherLangs, language_note: tei.langNote,
          orig_date: tei.origDate, orig_place: tei.origPlace, origin: tei.origin,
          provenance: tei.provenance, extent: tei.extent, foliation: tei.foliation,
          image_licence: tei.imageLicence, metadata_licence: tei.metadataLicence, surfaces: tei.surfaces.length,
        },
        tei_url: `${itemUrl}data/mscoll700_item${spec.item}_TEI.xml`,
        scraped_at: now.toISOString(),
      },
      image_source: {
        provider: 'penn',
        provider_name: 'University of Pennsylvania Libraries (OPenn)',
        source_url: itemUrl,
        identifier: tei.call,
        license: PDM,
        license_url: PDM,
        rights: 'Public Domain Mark 1.0 (free of known copyright restrictions)',
        digitized_by: 'University of Pennsylvania Libraries',
        attribution: 'Kislak Center for Special Collections, Rare Books and Manuscripts, University of Pennsylvania',
        shelfmark,
        contributing_library: 'University of Pennsylvania Libraries — Berendt-Brinton Linguistic Collection (Ms. Coll. 700)',
        image_variant: 'openn_web',
        full_resolution_available: `${itemUrl}data/master/`,
        access_date: now,
      },
      shelfmark,
      notes,
      acquisition_campaign: CAMPAIGN,
      status: 'draft',
      ...publication,
      created_at: now,
      updated_at: now,
    }, { importer: 'maya-mss-penn-6559', sourceIdentifier: tei.call, sourceUrl: itemUrl });

    if (!acquired.inserted) {
      console.log(`  SKIP — ${acquired.reason}: ${acquired.message || ''}`);
      report.push({ item: spec.item, outcome: 'skipped', why: acquired.message });
      continue;
    }
    await db.collection('books').updateOne({ id: bookIdStr }, { $set: { hidden_reason: hiddenReason } });

    // Hold before any page exists, so no lane can see a book with pages and no hold.
    const held = await holdBook(db, bookIdStr, { ...hold, source: 'maya-mss-penn-6559' });
    console.log(`  hold: ${held.outcome}`);
    if (held.outcome !== 'held') throw new Error(`${bookIdStr}: hold ${held.outcome}; refusing to write pages`);
  }

  const docs = [];
  for (const [i, p] of plan.entries()) {
    const num = String(i + 1).padStart(4, '0');
    const body = readFileSync(p.file);
    const meta = await sharp(body).metadata();
    if (meta.format !== 'jpeg') throw new Error(`${p.file}: not a JPEG (${meta.format})`);
    // A truncated download is stored under its own `-partial` keys, so the
    // complete file can later go to NNNN.jpg without fighting the immutable
    // cache on a key that once held the partial image.
    const suffix = p.truncated ? '-partial' : '';
    const [url, thumbUrl] = await Promise.all([
      put(`pages/${bookIdStr}/${num}${suffix}.jpg`, body, bookIdStr),
      put(`pages/${bookIdStr}/${num}${suffix}-thumb.jpg`, await thumb(body), bookIdStr),
    ]);
    const pid = new ObjectId();
    docs.push(makePageDoc({
      _id: pid,
      id: pid.toHexString(),
      book_id: bookIdStr,
      page_number: i + 1,
      page_label: p.label,
      photo: url,
      archived_photo: url,
      display_photo: url,
      photo_original: `${itemUrl}data/web/${p.name}`,
      thumbnail: thumbUrl,
      image_thumb: thumbUrl,
      image_width: meta.width,
      image_height: meta.height,
      archive_metadata: {
        source: 'openn_web_local',
        variant: 'web derivative, not the master',
        master_url: p.master ? `${itemUrl}data/${p.master}` : null,
        master_width: p.masterSize?.width ?? null,
        master_height: p.masterSize?.height ?? null,
        archived_at: now,
        ...(p.truncated ? { truncated_download: { bytes: body.length, note: 'local copy was cut off; the image shows only the top of the page. Re-download photo_original and run maya-mss-penn-6559.mjs --repair' } } : {}),
      },
      created_at: now,
      updated_at: now,
    }));
    process.stdout.write(`\r  uploaded ${i + 1}/${plan.length}   `);
  }
  process.stdout.write('\n');
  await db.collection('pages').insertMany(docs, { ordered: false });
  await db.collection('books').updateOne({ id: bookIdStr }, { $set: { thumbnail: docs[0].thumbnail } });
  await recountBook(db, bookIdStr, { reason: 'maya-mss-penn-6559 import' });
  const rows = await db.collection('pages').countDocuments({ book_id: bookIdStr });
  console.log(`  inserted ${bookIdStr} (${slug}) + ${rows} pages${rows === plan.length ? '' : ` — MISMATCH, expected ${plan.length}`}`);
  report.push({ item: spec.item, outcome: 'inserted', id: bookIdStr, slug, pages: plan.length, rows });
}

if (client) await client.close();
console.log('\n' + JSON.stringify(report, null, 1));
