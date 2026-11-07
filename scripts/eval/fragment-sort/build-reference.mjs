// PRIOR ART: none — looked in scripts/eval/INDEX.md, scripts/eval/lib/, scripts/lib/ (no DK/fragment reference builder; canonical-loci.md covers Bekker/Stephanus, not Diels-Kranz).
// Build the DK 44 (Philolaus) and DK 47 (Archytas) reference list for #7065 from the library's own
// copy of Diels, Fragmente der Vorsokratiker, 3rd ed. 1912 (book 6a3f0220661123baf6fe9d4e), where
// Philolaus is ch. 32 and Archytas ch. 35 (fragment numbers within the chapter are the DK 44 / 47 ones).
// The 1906 (69e8b21f...) and 1954 vol. 3 (69ae66d0...) copies are the Wortindex volumes, not the text.
// Adds Mullach FPG 1881 pp. 226-238 ("Alia Archytae fragmenta", mixed Greek/Latin) as a pool, and a
// hand-keyed layer of the Latin and Greek wordings the early printed tradition actually quotes.
// Read-only. Usage: node --env-file=.env.production.local build-reference.mjs <out.json>
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const OUT = process.argv[2];
const DIELS = '6a3f0220661123baf6fe9d4e';
const MULLACH = '6a3f02bb97e91e1768f68204';

// Status of the B fragments after Huffman (Philolaus 1993; Archytas 2005), entered from the
// literature, NOT read from a copy we hold. A = testimonium throughout.
const STATUS = {
  44: { genuine: ['1', '2', '3', '4', '5', '6', '6a', '7', '13', '17'], doubtful: ['16'] }, // all other B = spurious
  47: { genuine: ['1', '2', '3', '4'], doubtful: ['5', '6', '7', '8'] }, // B9 = pseudepigrapha titles
};

const strip = (s) =>
  s
    .split(/\n---\n/)[0]
    .replace(/<(scan-quality|language|script|page-type|vocab|meta|page-num|header|sig|image-desc)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<note>[\s\S]*?<\/note>/g, ' ')
    .replace(/<margin>[\s\S]*?<\/margin>/g, ' ')
    .replace(/<\/?[a-z][a-z-]*[^>]*>/gi, ' ');

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const pages = c.db('bookstore').collection('pages');
const get = async (id, a, b) =>
  (await pages.find({ book_id: id, page_number: { $gte: a, $lte: b } }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray()).map(
    (p) => ({ page: p.page_number, text: strip(p.ocr?.data || '') }),
  );

// Where a page with the entry number has no OCR (Diels 1912 pp. 338, 340) or the number is not printed
// at the start of the text (Archytas B1 runs on from p. 351), start the entry at the next page we have.
const FORCED = { 44: { 339: { section: 'B', n: '20' } }, 47: { 352: { section: 'B', n: '1' } } };

function parse(dk, pageList, startRe, endRe) {
  const entries = [];
  let on = false, section = 'A', falsum = false, cur = null;
  for (const { page, text } of pageList) {
    const f = on && FORCED[dk][page];
    if (f) { section = f.section; cur = null; }
    let forced = f;
    for (const line of text.split('\n')) {
      if (forced && line.trim()) { cur = newEntry(dk, section, forced.n, page, falsum, '(continued from previous page)'); entries.push(cur); forced = null; }
      if (!on) { if (startRe.test(line)) on = true; else continue; }
      if (endRe.test(line)) { on = false; break; }
      if (/B\. FRAGMENTE/.test(line)) { section = 'B'; continue; }
      if (/GEFÄLSCHTES|ZWEIFELHAFTE SCHRIFTEN|UNECHTE SCHRIFTEN/.test(line)) falsum = true;
      const m = line.match(/^(?:### )?(?:\*\*)?(\d{1,2})(?:ᵃ|a)?(?:ᵇ|b)?\.(?:\*\*)? /);
      const raw = m && line.match(/^(?:### )?(?:\*\*)?(\d{1,2}(?:ᵃ|a|ᵇ|b)?)\./)[1].replace('ᵃ', 'a').replace('ᵇ', 'b');
      if (m && (!cur || cur.section !== section || parseInt(raw) >= parseInt(cur.n))) {
        cur = newEntry(dk, section, raw, page, falsum, line.replace(/^[^ ]+ /, '').slice(0, 60));
        entries.push(cur);
      }
      if (cur) cur.text += line + '\n';
    }
  }
  for (const e of entries) e.incipit = e.text.replace(/^[^\n]*?(?=[Ͱ-Ͽἀ-῿*])/, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return entries;
}

function newEntry(dk, section, n, page, falsum, source) {
  const e = { dk, section, n, id: `DK ${dk} ${section}${n}`, page, text: '', source };
  if (section === 'B') {
    const st = STATUS[dk];
    e.status = st.genuine.includes(n) ? 'genuine' : st.doubtful.includes(n) ? 'doubtful' : 'spurious';
    if (falsum && e.status === 'genuine') e.status = 'spurious';
  } else e.status = 'testimonium';
  return e;
}

const phil = parse(44, await get(DIELS, 322, 341), /32\. PHILOLAOS|^2\. Diog\. ix 38/, /33\. EYRYTOS|ΕΥΡΥΤΟΣ/);
const arch = parse(47, await get(DIELS, 343, 359), /^/, /35a\. OKKELOS|ΟΚΚΕΛΟΣ/);
const mull = (await get(MULLACH, 226, 238)).map((p) => ({
  dk: 47, section: 'M', n: `p${p.page}`, id: `Mullach FPG 1881 p.${p.page} (Archytas, mixed)`, page: p.page, status: 'mullach-pool', source: 'Mullach, Alia Archytae fragmenta', text: p.text,
}));

// Hand-keyed wordings of the early printed / medieval tradition. Each is matched like any other entry.
// "ref" = the DK entry it belongs to (or a later DK number where the 1912 ed. lacks it).
const HAND = [
  // Archytas
  { id: 'Cic. Tusc. IV 78 (bailiff)', ref: 'DK 47 A7', status: 'testimonium', text: 'quo te modo inquit accepissem nisi iratus essem' },
  { id: 'Cic. rep. I 59 (bailiff)', ref: 'DK 47 A7', status: 'testimonium', text: 'Archytas iracundiam videlicet dissidentem a ratione seditionem quandam animi esse iudicabat atque eam consilio sedari volebat' },
  { id: 'Val. Max. IV 1 ext. 1 (bailiff)', ref: 'DK 47 A7', status: 'testimonium', text: 'sumpsissem a te supplicium nisi tibi iratus essem' },
  { id: 'Lactant. de ira 18 (bailiff)', ref: 'DK 47 A7', status: 'testimonium', text: 'Archytas Tarentinus cum corrupta esse omnia in agro suo comperisset villici sui culpam' },
  { id: 'Cic. Lael. 88 (heaven and a friend)', ref: 'DK 47 A7a', status: 'testimonium', text: 'si quis in caelum ascendisset naturamque mundi et pulchritudinem siderum perspexisset insuavem illam admirationem ei fore quae iucundissima fuisset si aliquem cui narraret habuisset' },
  { id: 'Cic. fin. V 87 (Plato to Archytas)', ref: 'DK 47 A5', status: 'testimonium', text: 'cur post Tarentum ad Archytam cur ad reliquos Pythagoreos Echecratem Timaeum Arionem Locros' },
  { id: 'Cic. Cato 39 (pleasure)', ref: 'DK 47 A9', status: 'testimonium', text: 'nullam capitaliorem pestem quam voluptatem corporis hominibus dicebat a natura datam' },
  { id: 'Arist. Pol. VIII 6 Lat. (rattle)', ref: 'DK 47 A10', status: 'testimonium', text: 'Archytae crepitaculum quod dant pueris' },
  { id: 'Gell. X 12 (dove)', ref: 'DK 47 A10a', status: 'testimonium', text: 'simulacrum columbae e ligno ab Archyta ratione quadam disciplinaque mechanica factum volasse' },
  { id: 'Diog. VIII 79 Lat. (Archytas)', ref: 'DK 47 A1', status: 'testimonium', text: 'Archytas Mnesagorae filius Tarentinus' },
  { id: 'Diog. VIII 79 Gr. (Archytas)', ref: 'DK 47 A1', status: 'testimonium', text: 'Ἀρχύτας Μνησαγόρου Ταραντῖνος' },
  { id: 'Diog. VIII 83 (first mechanics)', ref: 'DK 47 A1', status: 'testimonium', text: 'πρῶτος τὰ μηχανικὰ ταῖς μαθηματικαῖς προσχρησάμενος ἀρχαῖς μεθώδευσε' },
  { id: 'Diog. VIII 83 Lat. (first mechanics)', ref: 'DK 47 A1', status: 'testimonium', text: 'primus mechanicam mathematicis principiis' },
  { id: 'Archytas B1 incipit (Porph. in Ptol.)', ref: 'DK 47 B1', status: 'genuine', text: 'καλῶς μοι δοκοῦντι τοὶ περὶ τὰ μαθήματα διαγνώμεναι' },
  { id: 'Ps.-Archytas On Wisdom (Iambl. Protr. 4)', ref: 'Thesleff ps.-Archytas Περὶ σοφίας', status: 'spurious', text: 'σοφία ἐν πάντεσσι τοῖς ἀνθρωπικοῖς πράγμασι προέχει ὥσπερ ὄψις μὲν τᾶν τῶ σώματος αἰσθασίων νόος δὲ τᾶς ψυχᾶς ἅλιος δὲ τῶν ἄστρων' },
  { id: 'Ps.-Archytas On Law and Justice (Stob. IV 1)', ref: 'Thesleff ps.-Archytas Περὶ νόμου', status: 'spurious', text: 'νόμος ποτὶ ψυχὰν καὶ βίον ἀνθρώπω ὅπερ ἁρμονία ποτὶ ἀκοάν τε καὶ φωνάν' },
  { id: 'Ps.-Archytas On Principles (Stob. I 41)', ref: 'Thesleff ps.-Archytas Περὶ ἀρχᾶν', status: 'spurious', text: 'ἀνάγκα δύο ἦμεν ἀρχὰς τῶν ὄντων' },
  { id: 'Ps.-Archytas Categories (Ten universal terms)', ref: 'Thesleff ps.-Archytas Καθολικοὶ λόγοι', status: 'spurious', text: 'καθολικοὶ λόγοι δέκα' },
  { id: 'Hor. c. I 28 (Archytas buried)', ref: 'DK 47 A3', status: 'testimonium', text: 'te maris et terrae numeroque carentis arenae mensorem cohibent Archyta pulveris exigui' },
  // Philolaus
  { id: 'Diog. VIII 84-85 Lat. (Philolaus books)', ref: 'DK 44 A1', status: 'testimonium', text: 'Philolaus Crotoniates Pythagoricus ab hoc Plato libros Pythagoricos emi per Dionem scribit' },
  { id: 'Diog. VIII 84-85 Gr. (Philolaus)', ref: 'DK 44 A1', status: 'testimonium', text: 'Φιλόλαος Κροτωνιάτης Πυθαγορικός παρὰ τούτου Πλάτων ὠνήσασθαι τὰ βιβλία τὰ Πυθαγορικά' },
  { id: 'Diog. VIII 85 (earth moves)', ref: 'DK 44 A1', status: 'testimonium', text: 'τὴν γῆν κινεῖσθαι κατὰ κύκλον πρῶτον εἰπεῖν' },
  { id: 'Diog. VIII 85 Lat. (earth moves)', ref: 'DK 44 A1', status: 'testimonium', text: 'terram moveri in circulum primus dixit' },
  { id: 'Ps.-Plut. Plac. III 13 Lat. (earth round the fire)', ref: 'DK 44 A21', status: 'testimonium', text: 'Philolaus Pythagoreus circulo moveri terram circa ignem' },
  { id: 'Copernicus De rev. pref. (Philolaus)', ref: 'DK 44 A21 (via Copernicus)', status: 'testimonium', text: 'Philolaus Pythagoricus terram circa ignem volvi per circulum obliquum' },
  { id: 'Boeth. arith. II 54 (harmonic mean, Philolaus)', ref: 'DK 44 A24', status: 'testimonium', text: 'Philolaus harmonicam medietatem geometricam harmoniam cubum' },
  { id: 'Boeth. mus. III 8 (diesis definitions)', ref: 'DK 44 B6a', status: 'genuine', text: 'diesis inquit est spatium quo maior est sesquitertia proportio duobus tonis' },
  { id: 'Plato Phaedo 61d Lat. (Philolaus, suicide)', ref: 'DK 44 B15 (Plato context)', status: 'testimonium', text: 'Philolao quum versaremini nihil audistis' },
];

const reference = [...phil, ...arch, ...mull, ...HAND.map((h) => ({ section: 'H', ...h }))];
fs.writeFileSync(OUT, JSON.stringify(reference, null, 1));
const tally = (xs) => xs.reduce((m, e) => ((m[`${e.section}:${e.status}`] = (m[`${e.section}:${e.status}`] || 0) + 1), m), {});
console.log('DK44', phil.length, tally(phil), 'DK47', arch.length, tally(arch), 'mullach', mull.length, 'hand', HAND.length);
console.log(phil.map((e) => e.id).join(', '));
console.log(arch.map((e) => e.id).join(', '));
await c.close();
