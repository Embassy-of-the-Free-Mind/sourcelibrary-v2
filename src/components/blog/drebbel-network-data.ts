// Data for the Drebbel network on /blog/drebbel. Every tie is sourced in the research
// dossier for #5898 (associates.md, primary-sources.md): Tierie's 1932 Leiden thesis
// (http://www.drebbel.net/Tierie.pdf) is the backbone; the States General patents and the
// 1624 resolution were read in REPUBLIC; Beeckman, Tymme, Boyle 1660 and Wilkins 1648 were
// read directly. A tie with no document behind it is marked ev: 'weak' and shown dotted,
// never dropped silently. Book links go only to books visible on sourcelibrary.org.

export type Evidence = 'doc' | 'report' | 'weak';
export type Group = 'self' | 'kin' | 'patron' | 'circle' | 'print' | 'witness' | 'heirs' | 'unsupported';

export interface Person {
  id: string;
  name: string;
  life: string;
  group: Group;
  /** Year the tie is first attested. */
  year: number;
  tie: string;
  ev: Evidence;
  evidence: string;
  links: [string, string][];
}

const SL = '/book/';

export const GROUPS: Record<Group, { label: string; color: string }> = {
  self: { label: 'Drebbel', color: '#1a1612' },
  kin: { label: 'Family', color: '#9e4a3a' },
  patron: { label: 'Patrons and rulers', color: '#9e7c3c' },
  circle: { label: 'Friends and collaborators', color: '#5e6d52' },
  print: { label: 'Editors and writers', color: '#7c5db5' },
  witness: { label: 'Witnesses and reporters', color: '#3d6c8f' },
  heirs: { label: 'Heirs of the work', color: '#2f7d6d' },
  unsupported: { label: 'Claimed, not supported', color: '#a39e96' },
};

export const GROUP_ORDER: Group[] = ['kin', 'patron', 'circle', 'print', 'witness', 'heirs', 'unsupported'];

// year = when the tie is first attested. ev: doc | report | weak
export const PEOPLE: Person[] = [
  { id: "drebbel", name: "Cornelis Drebbel", life: "1572–1633", group: "self", year: 1590,
    tie: "Engraver, alchemist, inventor of the perpetual-motion clock, the submarine and the thermostat oven.",
    ev: "doc", evidence: "Born in Alkmaar, trained as an engraver in Haarlem, patented in the Dutch Republic in 1598, and lived most of his life in England as an inventor in royal service.",
    links: [["Two Treatises (Latin, 1621), his own words", SL + "9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4?page=11"], ["The 1597 map of Alkmaar he engraved", SL + "69b525de2f891867c1ae5d21"]] },

  // Family
  { id: "goltzius", name: "Hendrick Goltzius", life: "1558–1617", group: "kin", year: 1592,
    tie: "His master in engraving, then his brother-in-law.", ev: "doc",
    evidence: "Drebbel trained in Goltzius's Haarlem workshop and in 1595 married his younger sister Sophia (Tierie, from the Alkmaar registers).",
    links: [["Tierie 1932", "http://www.drebbel.net/Tierie.pdf"]] },
  { id: "sophia", name: "Sophia Jansdr. Goltzius", life: "fl. 1595", group: "kin", year: 1595,
    tie: "His wife, married 1595.", ev: "doc",
    evidence: "Their first child was buried at Alkmaar in 1596. Goltzius drew her in 1597 (Kupferstich-Kabinett, Berlin).", links: [] },
  { id: "anna", name: "Anna Drebbel", life: "", group: "kin", year: 1623,
    tie: "His daughter, married Abraham Kuffler in 1623.", ev: "doc",
    evidence: "Boyle later met a daughter of Drebbel in London with Mr Kuffler and took information from her on the submarine.", links: [] },
  { id: "catherina", name: "Catherina Drebbel", life: "", group: "kin", year: 1627,
    tie: "His daughter, married Johannes Sibertus Kuffler (1627, per Tierie).", ev: "doc", evidence: "", links: [] },
  { id: "abraham", name: "Abraham Kuffler", life: "c.1600 – after 1650", group: "kin", year: 1620,
    tie: "Son-in-law and workshop partner.", ev: "doc",
    evidence: "Came to England about 1620 hoping to win James I with a book, failed, and joined Drebbel instead. Married Anna in 1623; worked on the fireships and went on the 1628 La Rochelle expedition.",
    links: [["Tierie 1932", "http://www.drebbel.net/Tierie.pdf"]] },
  { id: "jsk", name: "Johannes Sibertus Kuffler", life: "1595–1677", group: "kin", year: 1620,
    tie: "Son-in-law, physician, keeper of the oven and the scarlet dye.", ev: "doc",
    evidence: "A Padua doctor (1618). Ran the Leiden dye works with Abraham (the 'Colour Kufflerianus' tin scarlet) and carried the self-regulating oven into Hartlib's circle from 1635. Told Beeckman in 1634 that Drebbel on his deathbed claimed he could make perfect telescopes.",
    links: [["Hartlib Papers, Kuffler", "https://www.dhi.ac.uk/hartlib/rdfa/4272.html"]] },
  { id: "jacob", name: "Jacob Kuffler", life: "d. Rome 1622", group: "kin", year: 1622,
    tie: "Brother of the sons-in-law; sold Drebbel's microscopes abroad.", ev: "doc",
    evidence: "Sent out in spring 1622. Demonstrated a microscope in Paris on 22 May 1622 before Marie de' Medici with Peiresc present, went on to Italy, and died of plague at Rome that November. Often miscalled a son-in-law.", links: [] },
  { id: "augustus", name: "Augustus Kuffeler", life: "later 17th c.", group: "kin", year: 1660,
    tie: "Grandson; his recipe book preserves the oven design.", ev: "doc",
    evidence: "His 'Collection of Approved Receipts of Chymical Operations' is the main source for how the thermostat oven worked (Keller, Nuncius 2013).",
    links: [["Keller 2013", "https://bpb-us-e1.wpmucdn.com/blogs.uoregon.edu/dist/3/3809/files/2013/08/Keller-on-Drebbels-Self-regulating-oven-in-nuncius-v4k192.pdf"]] },

  // Patrons
  { id: "states", name: "States General", life: "Dutch Republic", group: "patron", year: 1598,
    tie: "Granted his patents; in 1624 considered inviting him home.", ev: "doc",
    evidence: "21 May / 20 Aug 1598: a patent for a water-raising engine and 'a clock or time-pointer that one may use for fifty, sixty, yes a hundred or more years in a row, without winding'. 15 Feb 1602: a patent for chimneys that draw. 5 Jan 1624: two members to ask Prince Maurice whether to invite 'Mr Cornelis Drebbel' over from England.", links: [] },
  { id: "james", name: "James I", life: "1566–1625", group: "patron", year: 1605,
    tie: "Royal patron; received the perpetual motion.", ev: "doc",
    evidence: "Drebbel arrived about 1604–06 and was lodged and pensioned at Eltham. Tymme (1612) says the perpetual motion was 'presented to the Kings most royall hands'. Drebbel walked in the king's funeral in 1625. The tale that James rode in the submarine is not attested.",
    links: [["Drebbel's letter to the king (Latin, 1621 ed.)", SL + "9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4?page=62"]] },
  { id: "henry", name: "Henry, Prince of Wales", life: "1594–1612", group: "patron", year: 1607,
    tie: "Patron at Eltham.", ev: "doc",
    evidence: "Drebbel entered the prince's service about 1606–08. In his letter to James he recalls promising Henry to be back from Prague within six months.", links: [] },
  { id: "rudolf", name: "Rudolf II", life: "1552–1612", group: "patron", year: 1610,
    tie: "Emperor; Drebbel worked for him in Prague 1610–12.", ev: "doc",
    evidence: "Drebbel travelled to Prague with his family in October 1610 on a pass from Rudolf and showed the perpetual motion there. The records give a 600-thaler grant.", links: [] },
  { id: "matthias", name: "Matthias", life: "1557–1619", group: "patron", year: 1611,
    tie: "Jailed him in 1611–12, then freed him.", ev: "doc",
    evidence: "When Matthias took power he imprisoned Rudolf's council, 'amongst others, Drebbel', and his ovens and instruments were destroyed (the Kufflers to Peiresc). Matthias later released him and paid three hundred crowns for the journey home.", links: [] },
  { id: "maurice", name: "Prince Maurice", life: "1567–1625", group: "patron", year: 1622,
    tie: "Owned a Drebbel microscope.", ev: "report",
    evidence: "Peiresc heard from the Kufflers in 1622 that Maurice had one. The States General put the 1624 question of inviting Drebbel to him.", links: [] },
  { id: "albert", name: "Archduke Albert", life: "1559–1621", group: "patron", year: 1621,
    tie: "Received a Drebbel microscope as a gift.", ev: "report",
    evidence: "Peiresc's 1623 letter to Rubens mentions Drebbel's instrument at Brussels.", links: [] },
  { id: "charles", name: "Charles I", life: "1600–1649", group: "patron", year: 1626,
    tie: "Employed him for the Navy and Ordnance.", ev: "doc",
    evidence: "Warrant of 4 July 1626: lodgings and workshops in the Minories for 'Cornelis Drebbel and Arnold Rotispen, who are to apply their skill for his Majesty's service' (Calendar of State Papers Domestic).", links: [] },
  { id: "buckingham", name: "Duke of Buckingham", life: "1592–1628", group: "patron", year: 1626,
    tie: "Commanded the La Rochelle expeditions he served.", ev: "doc",
    evidence: "Orders of 1626; fireships and 'water-petards' for the Île de Ré and La Rochelle (1627–28), all failures. A 1628 entry gives Drebbel £150 a month. Buckingham was assassinated in August 1628.", links: [] },

  // Circle
  { id: "vanmander", name: "Karel van Mander", life: "1548–1606", group: "circle", year: 1592,
    tie: "Haarlem academy circle; possibly a teacher.", ev: "weak",
    evidence: "Stated in modern biographies; no primary document seen.", links: [] },
  { id: "schagen", name: "Gerrit Pietersz Schagen", life: "", group: "circle", year: 1595,
    tie: "Boyhood friend in Alkmaar.", ev: "doc",
    evidence: "An 'intimate and brotherly' friend from youth, whom Drebbel wanted with him in England (Tierie).", links: [] },
  { id: "rietwyck", name: "Ysbrandt van Rietwyck", life: "", group: "circle", year: 1608,
    tie: "Alkmaar friend; kept the Quinta Essentia manuscript.", ev: "doc",
    evidence: "Drebbel's c.1608 letter to him survives in the Huygens manuscripts. He passed the Quintessence text to Morsius.", links: [] },
  { id: "gerbier", name: "Balthasar Gerbier", life: "1592–1667", group: "circle", year: 1618,
    tie: "London acquaintance, Buckingham's agent.", ev: "doc",
    evidence: "His elegy on Goltzius's death (1618/20) alludes to Drebbel, perhaps already to the submarine.", links: [] },
  { id: "huygens", name: "Constantijn Huygens", life: "1596–1687", group: "circle", year: 1621,
    tie: "Pupil, buyer and admirer: 'We possessed Drebbel for a whole year, and he possessed me too.'", ev: "doc",
    evidence: "Met him briefly in early 1621 ('in appearance a Dutch farmer, but his learned talk is reminiscent of the sages of Samos and Sicily'), then saw him constantly through 1622. Bought a telescope and a camera obscura, and wrote home that Drebbel was no sorcerer.",
    links: [["Huygens, 'Mijn jeugd' (Dutch tr.)", "https://www.dbnl.org/tekst/huyg001mijn01_01/huyg001mijn01_01_0048.php"]] },
  { id: "rotispen", name: "Arnold Rotispen", life: "", group: "circle", year: 1626,
    tie: "Co-worker named in the 1626 Minories warrant.", ev: "doc", evidence: "", links: [] },
  { id: "degheyn", name: "Jacques de Gheyn", life: "1565–1629", group: "circle", year: 1622,
    tie: "Painter shown Drebbel's camera obscura by Huygens.", ev: "doc", evidence: "Huygens demonstrated the camera at The Hague.", links: [] },
  { id: "torrentius", name: "Torrentius", life: "1589–1644", group: "circle", year: 1622,
    tie: "Painter shown Drebbel's camera obscura by Huygens.", ev: "doc", evidence: "Huygens demonstrated the camera at The Hague.", links: [] },

  // Print
  { id: "tymme", name: "Thomas Tymme", life: "d. 1620", group: "print", year: 1612,
    tie: "Published the first picture of the perpetual motion.", ev: "doc",
    evidence: "A Dialogue Philosophicall (1612): 'a most strange and wittie invention of another Archimedes ... as it was presented to the Kings most royall hands, by Cornelius Drebble of Alchmar in Holland'. He used it to argue for a motionless earth.",
    links: [["Tymme, A Dialogue Philosophicall (1612)", SL + "6ac3ade2864e04424c043050"]] },
  { id: "jonson", name: "Ben Jonson", life: "1572–1637", group: "print", year: 1609,
    tie: "Mocked the perpetual motion on stage.", ev: "report",
    evidence: "The DNB cites allusions in the Epigrams and Epicoene (V.3). The exact lines were not checked.",
    links: [["Jonson, Workes (1640)", SL + "6a08fd0925e3a402b23b370f"]] },
  { id: "morsius", name: "Joachim Morsius", life: "1593–1642", group: "print", year: 1619,
    tie: "Edited the Quintessence; Drebbel signed his album in London, Nov 1619.", ev: "doc",
    evidence: "The album signature fixes Drebbel in London in 1619. Morsius is the only documented bridge to the Rosicrucian enthusiasts.", links: [] },
  { id: "lauremberg", name: "Petrus Lauremberg", life: "1585–1639", group: "print", year: 1621,
    tie: "Put the Elements treatise into Latin (Hamburg, 1621).", ev: "doc",
    evidence: "'E Belgico idiomate in Latinum vertit D. Petrus Laurembergius.' His dedication is dated 21 May 1621.",
    links: [["Two Treatises, dedication p.5", SL + "9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4?page=5"]] },

  // Witnesses
  { id: "kepler", name: "Johannes Kepler", life: "1571–1630", group: "witness", year: 1607,
    tie: "Wrote of him in 1607; both at Rudolf's court 1610–12.", ev: "report",
    evidence: "'If he can create a new spirit ... he will be Apollo' (letter, printed by Hanschius 1718). No direct meeting is reported.", links: [] },
  { id: "boreel", name: "Willem Boreel", life: "1591–1668", group: "witness", year: 1619,
    tie: "Saw a Drebbel microscope in London in 1619.", ev: "doc",
    evidence: "His letter to Pierre Borel gives the earliest dated sighting of the compound microscope there.", links: [] },
  { id: "beeckman", name: "Isaac Beeckman", life: "1588–1637", group: "witness", year: 1620,
    tie: "Recorded the submarine, the perpetual motion and the deathbed telescope.", ev: "doc",
    evidence: "15 March 1620: his father wrote 'dat DREBBEL in Engelandt een schuyte gepractiseert heeft, daermede hy onder ende boven water varen kan als hy wilt', the earliest dated report of the submarine. He also read Drebbel's 1604 tract and copied his letter to James I.",
    links: [["Beeckman's journal (DBNL)", "https://www.dbnl.org/tekst/beec002jour02_01/"]] },
  { id: "peiresc", name: "Peiresc", life: "1580–1637", group: "witness", year: 1622,
    tie: "Bought a microscope in 1622 and gathered everything about Drebbel.", ev: "doc",
    evidence: "Saw Jacob Kuffler's demonstration in Paris (22 May 1622) and bought one on 2 June. Wrote to Camden and Selden asking about the underwater boat, and to Rubens in 1623; drafted a treatise on Drebbel from the Kufflers' information (1624).", links: [] },
  { id: "marie", name: "Marie de' Medici", life: "1575–1642", group: "witness", year: 1622,
    tie: "Saw the microscope demonstrated in Paris, 1622.", ev: "doc", evidence: "", links: [] },
  { id: "rubens", name: "Peter Paul Rubens", life: "1577–1640", group: "witness", year: 1623,
    tie: "Peiresc's correspondent on Drebbel's instrument.", ev: "doc",
    evidence: "Peiresc wrote to him on 29 June 1623 about Drebbel's instrument at Brussels; the perpetuum mobile comes up in their letters.", links: [] },
  { id: "camden", name: "William Camden", life: "1551–1623", group: "witness", year: 1622,
    tie: "Asked by Peiresc about the underwater boat.", ev: "doc", evidence: "December 1622. The answers are lost.", links: [] },
  { id: "selden", name: "John Selden", life: "1584–1654", group: "witness", year: 1622,
    tie: "Asked by Peiresc about the underwater boat.", ev: "doc", evidence: "December 1622. The answers are lost.", links: [] },
  { id: "mersenne", name: "Marin Mersenne", life: "1588–1648", group: "witness", year: 1623,
    tie: "Repeated the submarine story in print.", ev: "report",
    evidence: "Quaestiones in Genesin (1623), Questions théologiques (1634) and Cogitata (1644): 'a small ship was constructed by Cornelius Drebbel in England, which swam while submerged'.",
    links: [["Mersenne, Cogitata (1644), p.309", SL + "69af0dab9f13b61d0a6c6105?page=309"]] },
  { id: "kircher", name: "Athanasius Kircher", life: "1602–1680", group: "witness", year: 1641,
    tie: "Explained (and doubted) the sphere of elements.", ev: "report",
    evidence: "Magnes (1641): 'If, therefore, Drebbel's ingenious sphere of elements is claimed to be fashioned by this method...'",
    links: [["Kircher, Magnes (1641), p.727", SL + "69527376ab34727b1f04948a?page=727"]] },
  { id: "wilkins", name: "John Wilkins", life: "1614–1672", group: "witness", year: 1648,
    tie: "Treated the submarine as proven.", ev: "report",
    evidence: "Mathematicall Magick (1648): 'already experimented here in England by Cornelius Dreble'. Also describes his sun-driven musical instrument, and mocks Tymme's use of the perpetual motion.",
    links: [["Wilkins, Mathematicall Magick, p.177", SL + "69aebe60c0472fef6455a8f3?page=177"]] },
  { id: "borel", name: "Pierre Borel", life: "c.1620–1671", group: "witness", year: 1655,
    tie: "Denied him the telescope; printed Boreel's letter.", ev: "report",
    evidence: "De vero telescopii inventore (1655), chapter heading: 'That Metius the Dutchman did not invent the Telescope, nor did Cornelius Drebbel.'",
    links: [["Borel (1655), p.40", SL + "69b1858ac4be2cdd0edc36fa?page=40"]] },
  { id: "schott", name: "Gaspar Schott", life: "1608–1666", group: "witness", year: 1657,
    tie: "Described the perpetual motion as two fighting liquids.", ev: "report",
    evidence: "'Cornelius Drebbel is said to have enclosed two opposing and highly antipathetic liquids in a glass ring, which fought against each other in a perpetual struggle.'",
    links: [["Schott (1657), p.475", SL + "69a5f6cd1cf742c3604142ea?page=475"]] },
  { id: "monconys", name: "Balthasar de Monconys", life: "1611–1665", group: "witness", year: 1663,
    tie: "Heard in London how Drebbel freshened air and sea water.", ev: "report",
    evidence: "'He knew how to extract a subtle spirit from the air ... and the son-in-law of said Drebel ... knew the way to distill sea water and render it sweet.' Also saw Wren's furnace 'like Mr Kuffler's'.",
    links: [["Monconys, Journal (1666 Eng.), p.43", SL + "6a44359d0235c9147000dd12?page=43"]] },

  // Heirs
  { id: "galileo", name: "Galileo Galilei", life: "1564–1642", group: "heirs", year: 1624,
    tie: "Made the Drebbel microscopes work in Rome and copied them.", ev: "doc",
    evidence: "Peiresc's instruments failed in Rome until Galileo, there in May 1624, got them working. He sent copies to friends that autumn and described them to Cesi on 23 Sept 1624.", links: [] },
  { id: "cesi", name: "Federico Cesi", life: "1585–1630", group: "heirs", year: 1624,
    tie: "Received Galileo's account of the microscope.", ev: "doc", evidence: "Letter of 23 September 1624.", links: [] },
  { id: "faber", name: "Giovanni Faber", life: "1574–1629", group: "heirs", year: 1625,
    tie: "Described the submarine from Abraham Kuffler's account.", ev: "report", evidence: "1625, Rome.", links: [] },
  { id: "hartlib", name: "Samuel Hartlib", life: "c.1600–1662", group: "heirs", year: 1635,
    tie: "Collected the Kufflers' ovens, dyes and optics from 1635.", ev: "doc",
    evidence: "His Ephemerides record Kuffler's ovens, optics, medicines and weather-glass, and Drebbel's 'Ars Volandi' as his last invention.",
    links: [["Hartlib Papers", "https://www.dhi.ac.uk/hartlib/rdfa/4272.html"]] },
  { id: "moriaen", name: "Johann Moriaen", life: "c.1591–1668", group: "heirs", year: 1652,
    tie: "Promoted Kuffler's army ovens; wrote to Hartlib on Drebbel's oven, 1652.", ev: "doc",
    evidence: "Advertised portable ovens baking 2,000 lb of bread a day for armies.", links: [] },
  { id: "boyle", name: "Robert Boyle", life: "1627–1691", group: "heirs", year: 1660,
    tie: "Recorded the submarine's 'Quintessence' of air from the family.", ev: "doc",
    evidence: "New Experiments (1660): tried 'in the Thames, with admired successe, the Vessel carrying twelve Rowers', kept alive by 'a certain Quintessence (as Chymists speake)' of the air restored from 'a Chymicall liquor'. His informant was 'an Ingenious Physitian that marry'd his daughter'.",
    links: [["Boyle, General History of the Air (1692)", SL + "6ac3af023b2f03f7e59cba4e"]] },
  { id: "goddard", name: "Jonathan Goddard", life: "1617–1675", group: "heirs", year: 1662,
    tie: "Brought the thermostat to the Royal Society.", ev: "doc",
    evidence: "Birch, History of the Royal Society, 1662: 'Dr. Goddard suggested Drebbel's method of governing a furnace by a thermometer of quicksilver.'", links: [] },
  { id: "wren", name: "Christopher Wren", life: "1632–1723", group: "heirs", year: 1663,
    tie: "Built a furnace 'like Mr Kuffler's'.", ev: "report", evidence: "Seen by Monconys in 1663.", links: [] },
  { id: "sorbiere", name: "Samuel Sorbière", life: "1615–1670", group: "heirs", year: 1664,
    tie: "Described Kuffler's furnace on his English journey.", ev: "report", evidence: "Relation d'un voyage en Angleterre, p.68.",
    links: [["Sorbière, Relation (1666), p.68", SL + "6ac2798f02c7f994f8506b1e?page=68"]] },
  { id: "hooke", name: "Robert Hooke", life: "1635–1703", group: "heirs", year: 1675,
    tie: "Knew Mrs Kuffler; wrote of her to Boyle, 1675.", ev: "doc", evidence: "", links: [] },
  { id: "chuygens", name: "Christiaan Huygens", life: "1629–1695", group: "heirs", year: 1703,
    tie: "Named Drebbel as the first maker of the microscope.", ev: "report",
    evidence: "Opuscula postuma (1703): 'in the year 1621 ... such microscopes were seen in London, at the home of our countryman Drebelius, and he was then considered the first inventor of them.' He was four when Drebbel died.",
    links: [["Huygens, Opuscula postuma, p.245", SL + "69b6c2618566c838146599f0?page=245"]] },
  { id: "glauber", name: "Johann Rudolf Glauber", life: "1604–1670", group: "heirs", year: 1650,
    tie: "Said to have worked with J. S. Kuffler.", ev: "weak", evidence: "Stated by Wikipedia only.", links: [] },

  // Unsupported
  { id: "ferdinand", name: "Ferdinand II", life: "1578–1637", group: "unsupported", year: 1619,
    tie: "Said to have hired him as a tutor in 1619 and jailed him in 1620.", ev: "weak",
    evidence: "Repeated by the DNB and Wikipedia, but Tierie never mentions it, and Drebbel signed Morsius's album in London in November 1619. Treat it as a legend until a document turns up.", links: [] },
  { id: "bacon", name: "Francis Bacon", life: "1561–1626", group: "unsupported", year: 1620,
    tie: "Often linked to Drebbel; no document found.", ev: "weak",
    evidence: "Tierie places Bacon in the same London world. No passage in Bacon naming Drebbel was found, and 'Bacon's weather-glass is Drebbel's' is an inference.", links: [] }
];

// [source, target, ev, label, year]  (all non-Drebbel edges; every node also links to Drebbel unless listed in NO_CENTER)
export const EXTRA_TIES: [string, string, Evidence, string, number?][] = [
  ["goltzius", "sophia", "doc", "siblings"], ["goltzius", "vanmander", "doc", "Haarlem academy"],
  ["abraham", "anna", "doc", "married 1623", 1623], ["jsk", "catherina", "doc", "married 1627", 1627],
  ["abraham", "jsk", "doc", "brothers", 1620], ["abraham", "jacob", "doc", "brothers", 1620],
  ["rudolf", "matthias", "doc", "brothers", 1611], ["james", "henry", "doc", "father and son", 1607],
  ["james", "charles", "doc", "father and son", 1626], ["charles", "buckingham", "doc", "favourite", 1626],
  ["buckingham", "gerbier", "doc", "agent", 1626], ["buckingham", "abraham", "doc", "La Rochelle 1628", 1628],
  ["states", "maurice", "doc", "1624 question", 1624],
  ["huygens", "degheyn", "doc", "camera obscura", 1622], ["huygens", "torrentius", "doc", "camera obscura", 1622],
  ["huygens", "chuygens", "doc", "father and son", 1629],
  ["rietwyck", "morsius", "doc", "manuscript", 1619], ["morsius", "lauremberg", "doc", "same 1621 book", 1621],
  ["tymme", "james", "doc", "presentation", 1612], ["wilkins", "tymme", "doc", "mocks him", 1648],
  ["kepler", "rudolf", "doc", "court", 1610],
  ["jacob", "peiresc", "doc", "Paris 1622", 1622], ["jacob", "marie", "doc", "Paris 1622", 1622],
  ["peiresc", "camden", "doc", "letter", 1622], ["peiresc", "selden", "doc", "letter", 1622],
  ["peiresc", "rubens", "doc", "letter 1623", 1623], ["peiresc", "galileo", "doc", "instruments to Rome", 1624],
  ["peiresc", "maurice", "report", "heard of his microscope", 1622], ["albert", "rubens", "report", "Brussels", 1623],
  ["galileo", "cesi", "doc", "letter 1624", 1624], ["abraham", "faber", "report", "submarine account", 1625],
  ["boreel", "borel", "doc", "letter", 1655],
  ["jsk", "beeckman", "doc", "deathbed telescope, 1634", 1634],
  ["jsk", "hartlib", "doc", "ovens, dyes", 1635], ["moriaen", "hartlib", "doc", "letters", 1652],
  ["moriaen", "jsk", "doc", "promoted ovens", 1652], ["hartlib", "boyle", "doc", "circle", 1655],
  ["jsk", "boyle", "doc", "informant", 1660], ["anna", "boyle", "doc", "informant", 1660],
  ["boyle", "hooke", "doc", "assistant", 1675], ["monconys", "wren", "doc", "saw furnace", 1663],
  ["sorbiere", "jsk", "report", "Kuffler's furnace", 1664], ["kircher", "schott", "doc", "pupil", 1657],
  ["glauber", "jsk", "weak", "said to have worked together", 1650],
  ["jsk", "augustus", "report", "family", 1660]
];
export const NO_CENTER = new Set<string>(["degheyn", "torrentius", "camden", "selden", "marie", "cesi", "faber", "hartlib", "moriaen", "wren", "hooke", "sorbiere", "glauber", "rubens"]);
export const CENTER_EV: Record<string, Evidence> = { goddard: "report", boyle: "report", hartlib: "report" };

