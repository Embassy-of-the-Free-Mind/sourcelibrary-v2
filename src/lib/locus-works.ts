/**
 * Names for the works our locus anchors sit inside — a translation table, and
 * nothing more.
 *
 * ## Why a table exists at all, and why it cannot misaddress
 *
 * A Bekker number is unique across the whole Aristotelian corpus, so resolving
 * `1094a8` needs no names: the number finds the leaf. A Stephanus number is not
 * unique — it restarts in each of the three 1578 volumes, so `328b` is a page of
 * the *Republic*, of the *Cratylus* and of the *Eryxias*, and citation practice
 * disambiguates by naming the dialogue. That name has to be resolvable.
 *
 * The rows below therefore map **head strings printed on the leaves** to a slug
 * and an English label. They assert only that `ΠΟΛΙΤΕΙΑ` and `DE REPVBL` are the
 * same dialogue — a claim a reader can check against the running head itself.
 * They never carry a page range, so a wrong row cannot move a citation to a
 * different leaf; it can only mislabel one. Ranges stay derived
 * (`locus_books.segments`), and `scripts/locus/verify-locus-works.mjs` checks
 * every row against them: if two editions we equate here cover ranges that do not
 * agree, that is reported.
 *
 * ## Where the head strings came from
 *
 * Observed, not invented: every `heads` entry below appears in the extractor's own
 * output for one of the registered editions. The English `label` is the only new
 * information in this file.
 *
 * Heads are matched after `locusWorkKey` normalisation (upper case, accents kept,
 * letter-spacing collapsed, trailing book numerals stripped) and by prefix, so
 * `ΠΟΛΙΤΕΙΑΣ` matches the entry `ΠΟΛΙΤΕΙΑ`.
 */

import type { LocusSystem } from './locus';

export interface LocusWork {
  slug: string;
  label: string;
  system: LocusSystem;
  /** Running heads observed for this work, normalised. Matched by prefix. */
  heads: string[];
  /** What a caller might type. Matched case- and accent-insensitively. */
  aliases: string[];
}

/**
 * Aristotle — the Bekker frame. Names here are a convenience for callers who
 * would rather write "Nicomachean Ethics 1103b" than "1103b"; the number alone
 * always works.
 */
const ARISTOTLE: LocusWork[] = [
  { slug: 'categories', label: 'Categories', system: 'bekker', heads: ['ΚΑΤΗΓΟΡΙΑΙ'], aliases: ['categories', 'categoriae', 'cat'] },
  { slug: 'de-interpretatione', label: 'De Interpretatione', system: 'bekker', heads: ['ΠΕΡΙ ΕΡΜΗΝΕΙΑΣ'], aliases: ['de interpretatione', 'on interpretation', 'int'] },
  { slug: 'prior-analytics', label: 'Prior Analytics', system: 'bekker', heads: ['ΑΝΑΛΥΤΙΚΩΝ ΠΡΟΤΕΡΩΝ'], aliases: ['prior analytics', 'analytica priora', 'apr'] },
  { slug: 'posterior-analytics', label: 'Posterior Analytics', system: 'bekker', heads: ['ΑΝΑΛΥΤΙΚΩΝ ΥΣΤΕΡΩΝ'], aliases: ['posterior analytics', 'analytica posteriora', 'apo'] },
  { slug: 'topics', label: 'Topics', system: 'bekker', heads: ['ΤΟΠΙΚΩΝ'], aliases: ['topics', 'topica', 'top'] },
  { slug: 'sophistical-refutations', label: 'Sophistical Refutations', system: 'bekker', heads: ['ΠΕΡΙ ΣΟΦΙΣΤΙΚΩΝ ΕΛΕΓΧΩΝ'], aliases: ['sophistical refutations', 'de sophisticis elenchis', 'soph el'] },
  { slug: 'physics', label: 'Physics', system: 'bekker', heads: ['ΦΥΣΙΚΗΣ ΑΚΡΟΑΣΕΩΣ', 'PHYSICA'], aliases: ['physics', 'physica', 'phys'] },
  { slug: 'de-caelo', label: 'De Caelo (On the Heavens)', system: 'bekker', heads: ['ΠΕΡΙ ΟΥΡΑΝΟΥ', 'DE CAELO'], aliases: ['de caelo', 'on the heavens', 'cael'] },
  { slug: 'de-generatione-et-corruptione', label: 'De Generatione et Corruptione', system: 'bekker', heads: ['ΠΕΡΙ ΓΕΝΕΣΕΩΣ ΚΑΙ ΦΘΟΡΑΣ', 'DE GENERATIONE ET CORRUPTIONE'], aliases: ['de generatione et corruptione', 'on generation and corruption', 'gc'] },
  { slug: 'meteorology', label: 'Meteorologica', system: 'bekker', heads: ['ΜΕΤΕΩΡΟΛΟΓΙΚΩΝ', 'METEOROLOGICA'], aliases: ['meteorology', 'meteorologica', 'mete'] },
  { slug: 'de-mundo', label: 'De Mundo', system: 'bekker', heads: ['ΠΕΡΙ ΚΟΣΜΟΥ', 'DE MUNDO'], aliases: ['de mundo', 'on the cosmos'] },
  { slug: 'de-anima', label: 'De Anima (On the Soul)', system: 'bekker', heads: ['ΠΕΡΙ ΨΥΧΗΣ', 'DE ANIMA'], aliases: ['de anima', 'on the soul', 'an'] },
  { slug: 'de-sensu', label: 'De Sensu et Sensibilibus', system: 'bekker', heads: ['ΠΕΡΙ ΑΙΣΘΗΣΕΩΣ ΚΑΙ ΑΙΣΘΗΤΩΝ', 'DE SENSU'], aliases: ['de sensu', 'on sense and sensible objects'] },
  { slug: 'de-memoria', label: 'De Memoria et Reminiscentia', system: 'bekker', heads: ['ΠΕΡΙ ΜΝΗΜΗΣ ΚΑΙ ΑΝΑΜΝΗΣΕΩΣ', 'DE MEMORIA ET REMINISCENTIA'], aliases: ['de memoria', 'on memory'] },
  { slug: 'de-somno', label: 'De Somno et Vigilia', system: 'bekker', heads: ['ΠΕΡΙ ΥΠΝΟΥ ΚΑΙ ΕΓΡΗΓΟΡΣΕΩΣ', 'DE SOMNO ET VIGILIA'], aliases: ['de somno', 'on sleep'] },
  { slug: 'de-insomniis', label: 'De Insomniis', system: 'bekker', heads: ['ΠΕΡΙ ΕΝΥΠΝΙΩΝ', 'DE SOMNIIS'], aliases: ['de insomniis', 'de somniis', 'on dreams'] },
  { slug: 'de-divinatione-per-somnum', label: 'De Divinatione per Somnum', system: 'bekker', heads: ['DE DIVINATIONE PER SOMNUM'], aliases: ['de divinatione per somnum', 'on divination in sleep'] },
  { slug: 'de-longitudine-vitae', label: 'De Longitudine et Brevitate Vitae', system: 'bekker', heads: ['ΠΕΡΙ ΜΑΚΡΟΒΙΟΤΗΤΟΣ ΚΑΙ ΒΡΑΧΥΒΙΟΤΗΤΟΣ', 'DE LONGITUDINE ET BREVITATE VITAE'], aliases: ['de longitudine', 'on length and shortness of life'] },
  { slug: 'de-iuventute', label: 'De Iuventute et Senectute', system: 'bekker', heads: ['DE IUVENTUTE ET SENECTUTE'], aliases: ['de iuventute', 'on youth and old age'] },
  { slug: 'de-respiratione', label: 'De Respiratione', system: 'bekker', heads: ['ΠΕΡΙ ΑΝΑΠΝΟΗΣ', 'DE RESPIRATIONE'], aliases: ['de respiratione', 'on respiration'] },
  { slug: 'de-spiritu', label: 'De Spiritu', system: 'bekker', heads: ['ΠΕΡΙ ΠΝΕΥΜΑΤΟΣ', 'DE SPIRITU'], aliases: ['de spiritu', 'on breath'] },
  { slug: 'historia-animalium', label: 'Historia Animalium', system: 'bekker', heads: ['ΠΕΡΙ ΤΑ ΖΩΑ ΙΣΤΟΡΙΩΝ', 'HISTORIA ANIMALIUM'], aliases: ['historia animalium', 'history of animals', 'ha'] },
  { slug: 'de-partibus-animalium', label: 'De Partibus Animalium', system: 'bekker', heads: ['ΠΕΡΙ ΖΩΩΝ ΜΟΡΙΩΝ'], aliases: ['de partibus animalium', 'parts of animals', 'pa'] },
  { slug: 'de-motu-animalium', label: 'De Motu Animalium', system: 'bekker', heads: ['ΠΕΡΙ ΖΩΩΝ ΚΙΝΗΣΕΩΣ'], aliases: ['de motu animalium', 'movement of animals'] },
  { slug: 'de-incessu-animalium', label: 'De Incessu Animalium', system: 'bekker', heads: ['ΠΕΡΙ ΠΟΡΕΙΑΣ ΖΩΩΝ'], aliases: ['de incessu animalium', 'progression of animals'] },
  { slug: 'de-generatione-animalium', label: 'De Generatione Animalium', system: 'bekker', heads: ['ΠΕΡΙ ΖΩΩΝ ΓΕΝΕΣΕΩΣ'], aliases: ['de generatione animalium', 'generation of animals', 'ga'] },
  { slug: 'de-coloribus', label: 'De Coloribus', system: 'bekker', heads: ['ΠΕΡΙ ΧΡΩΜΑΤΩΝ'], aliases: ['de coloribus', 'on colours'] },
  { slug: 'de-audibilibus', label: 'De Audibilibus', system: 'bekker', heads: ['ΕΚ ΤΟΥ ΠΕΡΙ ΑΚΟΥΣΤΩΝ'], aliases: ['de audibilibus', 'on things heard'] },
  { slug: 'physiognomonica', label: 'Physiognomonica', system: 'bekker', heads: ['ΦΥΣΙΟΓΝΩΜΟΝΙΚΑ'], aliases: ['physiognomonica', 'physiognomics'] },
  { slug: 'de-plantis', label: 'De Plantis', system: 'bekker', heads: ['ΠΕΡΙ ΦΥΤΩΝ'], aliases: ['de plantis', 'on plants'] },
  { slug: 'mirabilia', label: 'De Mirabilibus Auscultationibus', system: 'bekker', heads: ['ΠΕΡΙ ΘΑΥΜΑΣΙΩΝ ΑΚΟΥΣΜΑΤΩΝ'], aliases: ['mirabilia', 'de mirabilibus auscultationibus', 'marvellous things heard'] },
  { slug: 'mechanica', label: 'Mechanica', system: 'bekker', heads: ['ΜΗΧΑΝΙΚΑ'], aliases: ['mechanica', 'mechanics'] },
  { slug: 'problemata', label: 'Problemata', system: 'bekker', heads: ['ΠΡΟΒΛΗΜΑΤΩΝ'], aliases: ['problemata', 'problems'] },
  { slug: 'de-lineis-insecabilibus', label: 'De Lineis Insecabilibus', system: 'bekker', heads: ['ΠΕΡΙ ΑΤΟΜΩΝ ΓΡΑΜΜΩΝ'], aliases: ['de lineis insecabilibus', 'on indivisible lines'] },
  { slug: 'de-xenophane', label: 'De Melisso, Xenophane, Gorgia', system: 'bekker', heads: ['ΠΕΡΙ ΞΕΝΟΦΑΝΟΥΣ'], aliases: ['de xenophane', 'de melisso xenophane gorgia'] },
  { slug: 'metaphysics', label: 'Metaphysics', system: 'bekker', heads: ['ΤΩΝ ΜΕΤΑ ΤΑ ΦΥΣΙΚΑ'], aliases: ['metaphysics', 'metaphysica', 'metaph'] },
  { slug: 'nicomachean-ethics', label: 'Nicomachean Ethics', system: 'bekker', heads: ['ΗΘΙΚΩΝ ΝΙΚΟΜΑΧΕΙΩΝ'], aliases: ['nicomachean ethics', 'ethica nicomachea', 'ne', 'en'] },
  { slug: 'magna-moralia', label: 'Magna Moralia', system: 'bekker', heads: ['ΗΘΙΚΩΝ ΜΕΓΑΛΩΝ'], aliases: ['magna moralia', 'mm'] },
  { slug: 'eudemian-ethics', label: 'Eudemian Ethics', system: 'bekker', heads: ['ΗΘΙΚΩΝ ΕΥΔΗΜΙΩΝ'], aliases: ['eudemian ethics', 'ethica eudemia', 'ee'] },
  { slug: 'de-virtutibus', label: 'De Virtutibus et Vitiis', system: 'bekker', heads: ['ΠΕΡΙ ΑΡΕΤΩΝ ΚΑΙ ΚΑΚΙΩΝ'], aliases: ['de virtutibus et vitiis', 'on virtues and vices'] },
  { slug: 'politics', label: 'Politics', system: 'bekker', heads: ['ΠΟΛΙΤΙΚΩΝ'], aliases: ['politics', 'politica', 'pol'] },
  { slug: 'oeconomica', label: 'Oeconomica', system: 'bekker', heads: ['ΟΙΚΟΝΟΜΙΚΩΝ'], aliases: ['oeconomica', 'economics'] },
  { slug: 'rhetoric', label: 'Rhetoric', system: 'bekker', heads: ['ΡΗΤΟΡΙΚΗ'], aliases: ['rhetoric', 'rhetorica', 'rhet'] },
  { slug: 'rhetorica-ad-alexandrum', label: 'Rhetorica ad Alexandrum', system: 'bekker', heads: ['ΠΡΟΣ ΑΛΕΞΑΝΔΡΟΝ'], aliases: ['rhetorica ad alexandrum', 'rhet alex'] },
  { slug: 'poetics', label: 'Poetics', system: 'bekker', heads: ['ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ'], aliases: ['poetics', 'poetica', 'poet'] },
];

/**
 * Plato — the Stephanus frame. Here the names are load-bearing, because the
 * number alone is ambiguous between the three 1578 volumes.
 *
 * Latin heads come from Stephanus itself, Greek heads from Burnet's OCT. A row
 * carrying both is the bridge that lets `Republic 328b` find the 1578 leaf and
 * the 1902 leaf in one call.
 */
const PLATO: LocusWork[] = [
  { slug: 'euthyphro', label: 'Euthyphro', system: 'stephanus', heads: ['EVTHYPHRO'], aliases: ['euthyphro', 'euthphr'] },
  { slug: 'apology', label: 'Apology', system: 'stephanus', heads: ['APOLOGIA'], aliases: ['apology', 'apologia', 'apol'] },
  { slug: 'crito', label: 'Crito', system: 'stephanus', heads: ['CRITO'], aliases: ['crito', 'crit'] },
  { slug: 'phaedo', label: 'Phaedo', system: 'stephanus', heads: ['PHAEDO', 'PHÆDO', 'ΦΑΙΔΩΝ'], aliases: ['phaedo', 'phd'] },
  { slug: 'theages', label: 'Theages', system: 'stephanus', heads: ['THEAGES'], aliases: ['theages'] },
  { slug: 'lovers', label: 'Amatores (Lovers)', system: 'stephanus', heads: ['AMATORES'], aliases: ['amatores', 'lovers', 'rival lovers'] },
  { slug: 'theaetetus', label: 'Theaetetus', system: 'stephanus', heads: ['THEAETETVS', 'ΘΕΑΙΤΗΤΟΣ'], aliases: ['theaetetus', 'tht'] },
  { slug: 'sophist', label: 'Sophist', system: 'stephanus', heads: ['SOPHISTA', 'ΣΟΦΙΣΤΗΣ'], aliases: ['sophist', 'sophista', 'soph'] },
  { slug: 'euthydemus', label: 'Euthydemus', system: 'stephanus', heads: ['EVTHYDEMVS'], aliases: ['euthydemus', 'euthd'] },
  { slug: 'protagoras', label: 'Protagoras', system: 'stephanus', heads: ['PROTAGORAS', 'ΠΡΩΤΑΓΟΡΑΣ'], aliases: ['protagoras', 'prt'] },
  { slug: 'hippias', label: 'Hippias Minor', system: 'stephanus', heads: ['HIPPIAS'], aliases: ['hippias minor', 'hippias'] },
  { slug: 'cratylus', label: 'Cratylus', system: 'stephanus', heads: ['CRATYLVS', 'ΚΡΑΤΥΛΟΣ'], aliases: ['cratylus', 'crat'] },
  { slug: 'gorgias', label: 'Gorgias', system: 'stephanus', heads: ['GORGIAS', 'ΓΟΡΓΙΑΣ'], aliases: ['gorgias', 'grg'] },
  { slug: 'philebus', label: 'Philebus', system: 'stephanus', heads: ['PHILEBVS', 'ΦΙΛΗΒΟΣ'], aliases: ['philebus', 'phlb'] },
  { slug: 'meno', label: 'Meno', system: 'stephanus', heads: ['MENO', 'ΜΕΝΩΝ'], aliases: ['meno', 'men'] },
  { slug: 'alcibiades', label: 'Alcibiades', system: 'stephanus', heads: ['ALCIBIADES', 'ΑΛΚΙΒΙΑΔΗΣ'], aliases: ['alcibiades', 'alc'] },
  { slug: 'charmides', label: 'Charmides', system: 'stephanus', heads: ['CHARMIDES', 'ΧΑΡΜΙΔΗΣ'], aliases: ['charmides', 'chrm'] },
  { slug: 'laches', label: 'Laches', system: 'stephanus', heads: ['LACHES', 'ΛΑΧΗΣ'], aliases: ['laches', 'lach'] },
  { slug: 'lysis', label: 'Lysis', system: 'stephanus', heads: ['LYSIS', 'ΛΥΣΙΣ'], aliases: ['lysis', 'lys'] },
  { slug: 'hipparchus', label: 'Hipparchus', system: 'stephanus', heads: ['HIPPARCHVS'], aliases: ['hipparchus', 'hipparch'] },
  { slug: 'menexenus', label: 'Menexenus', system: 'stephanus', heads: ['MENEXENVS', 'ΜΕΝΕΞΕΝΟΣ'], aliases: ['menexenus', 'menex'] },
  { slug: 'statesman', label: 'Statesman (Politicus)', system: 'stephanus', heads: ['POLITICVS', 'ΠΟΛΙΤΙΚΟΣ'], aliases: ['statesman', 'politicus', 'plt'] },
  { slug: 'minos', label: 'Minos', system: 'stephanus', heads: ['MINOS', 'ΜΙΝΩΣ'], aliases: ['minos'] },
  { slug: 'republic', label: 'Republic', system: 'stephanus', heads: ['DE REPVB', 'DE REPVBL', 'ΠΟΛΙΤΕΙΑ'], aliases: ['republic', 'respublica', 'de republica', 'politeia', 'rep'] },
  { slug: 'laws', label: 'Laws', system: 'stephanus', heads: ['DE LEGIBVS', 'ΝΟΜΩΝ', 'ΝΟΜΟΙ'], aliases: ['laws', 'de legibus', 'leg', 'nomoi'] },
  { slug: 'epinomis', label: 'Epinomis', system: 'stephanus', heads: ['EPINOMIS', 'ΕΠΙΝΟΜΙΣ'], aliases: ['epinomis', 'epin'] },
  { slug: 'timaeus', label: 'Timaeus', system: 'stephanus', heads: ['TIMAEVS', 'ΤΙΜΑΙΟΣ'], aliases: ['timaeus', 'ti', 'tim'] },
  { slug: 'critias', label: 'Critias', system: 'stephanus', heads: ['CRITIAS', 'ΚΡΙΤΙΑΣ'], aliases: ['critias', 'criti'] },
  { slug: 'parmenides', label: 'Parmenides', system: 'stephanus', heads: ['PARMENIDES', 'ΠΑΡΜΕΝΙΔΗΣ'], aliases: ['parmenides', 'prm'] },
  { slug: 'symposium', label: 'Symposium', system: 'stephanus', heads: ['CONVIVIVM', 'ΣΥΜΠΟΣΙΟΝ'], aliases: ['symposium', 'convivium', 'smp'] },
  { slug: 'phaedrus', label: 'Phaedrus', system: 'stephanus', heads: ['PHAEDRVS', 'PHAEDRUS', 'ΦΑΙΔΡΟΣ'], aliases: ['phaedrus', 'phdr'] },
  { slug: 'hippias-major', label: 'Hippias Major', system: 'stephanus', heads: ['HIPPIAS MAIOR', 'HIPPIASMAIOR'], aliases: ['hippias major', 'hippias maior'] },
  { slug: 'letters', label: 'Letters (Epistulae)', system: 'stephanus', heads: ['EPISTOLA', 'EPISTOLAE', 'ΕΠΙΣΤΟΛΗ', 'ΕΠΙΣΤΟΛΑΙ'], aliases: ['letters', 'epistles', 'epistulae', 'epistolae', 'ep'] },
  { slug: 'axiochus', label: 'Axiochus', system: 'stephanus', heads: ['AXIOCHVS', 'ΑΞΙΟΧΟΣ'], aliases: ['axiochus'] },
  { slug: 'de-iusto', label: 'De Iusto (On Justice)', system: 'stephanus', heads: ['DE IVSTO', 'ΠΕΡΙ ΔΙΚΑΙΟΥ'], aliases: ['de iusto', 'on justice'] },
  { slug: 'de-virtute', label: 'De Virtute (On Virtue)', system: 'stephanus', heads: ['DE VIRTVTE', 'ΠΕΡΙ ΑΡΕΤΗΣ'], aliases: ['de virtute', 'on virtue'] },
  { slug: 'demodocus', label: 'Demodocus', system: 'stephanus', heads: ['DEMODOCVS', 'ΔΗΜΟΔΟΚΟΣ'], aliases: ['demodocus'] },
  { slug: 'sisyphus', label: 'Sisyphus', system: 'stephanus', heads: ['SISYPHVS', 'ΣΙΣΥΦΟΣ'], aliases: ['sisyphus'] },
  { slug: 'eryxias', label: 'Eryxias', system: 'stephanus', heads: ['ERYXIAS', 'ΕΡΥΞΙΑΣ'], aliases: ['eryxias'] },
  { slug: 'clitopho', label: 'Clitopho', system: 'stephanus', heads: ['CLITOPHO', 'ΚΛΕΙΤΟΦΩΝ'], aliases: ['clitopho', 'cleitophon', 'clitophon'] },
  { slug: 'definitions', label: 'Definitions (Horoi)', system: 'stephanus', heads: ['DEFINITIONES', 'ΟΡΟΙ'], aliases: ['definitions', 'definitiones', 'horoi'] },
  { slug: 'timaeus-locrus', label: 'Timaeus Locrus, De Anima Mundi', system: 'stephanus', heads: ['TIMAEI LOCRI', 'DE ANIMA MVNDI'], aliases: ['timaeus locrus', 'de anima mundi'] },
];

export const LOCUS_WORKS: LocusWork[] = [...ARISTOTLE, ...PLATO];

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The work a caller's name refers to, or null. Accent- and case-insensitive. */
export function findWorkByName(name: string, system?: LocusSystem | null): LocusWork | null {
  const q = fold(name);
  if (!q) return null;
  const pool = system ? LOCUS_WORKS.filter((w) => w.system === system) : LOCUS_WORKS;
  return (
    pool.find((w) => w.aliases.some((a) => fold(a) === q) || fold(w.label) === q || w.slug === q.toLowerCase().replace(/ /g, '-')) ||
    pool.find((w) => w.heads.some((h) => fold(h) === q)) ||
    // Last resort: a caller typing part of a name. Longest match wins so
    // "hippias major" cannot be answered by the "hippias" row.
    pool
      .filter((w) => [...w.aliases, w.label].some((a) => fold(a).startsWith(q)))
      .sort((a, b) => b.label.length - a.label.length)[0] ||
    null
  );
}

/**
 * The work whose observed running head this anchor sits under.
 *
 * Prefix matching, longest first: the head `ΠΟΛΙΤΕΙΑΣ` should resolve to
 * `ΠΟΛΙΤΕΙΑ` (Republic) and the head `ΠΟΛΙΤΙΚΟΣ` must NOT — which is why the
 * longest matching head wins rather than the first.
 */
export function findWorkByHead(head: string | null | undefined, system: LocusSystem): LocusWork | null {
  if (!head) return null;
  const h = fold(head);
  let best: LocusWork | null = null;
  let bestLen = 0;
  for (const w of LOCUS_WORKS) {
    if (w.system !== system) continue;
    for (const cand of w.heads) {
      const c = fold(cand);
      if ((h === c || h.startsWith(c) || c.startsWith(h)) && c.length > bestLen) { best = w; bestLen = c.length; }
    }
  }
  return best;
}
