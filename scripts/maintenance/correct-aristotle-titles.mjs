#!/usr/bin/env node
/**
 * Apply the five title corrections established in #3652 A.
 *
 *   node scripts/maintenance/correct-aristotle-titles.mjs           # dry run
 *   node scripts/maintenance/correct-aristotle-titles.mjs --apply
 *
 * ## Every correction has TWO independent witnesses
 *
 * The volume's own running heads say what is INSIDE it. The Internet Archive
 * record — the source each of these was imported from — says what the volume
 * was CALLED. A correction resting on only my derivation would be one more
 * confident claim of unknown provenance, which is the disease. These rest on
 * both, and the decisive evidence is quoted in each entry.
 *
 * ## What is NOT changed
 *
 *   - `slug`. It is in every existing link and shortlink. A wrong title is a
 *     nuisance; a dead link is data loss.
 *   - the set title on 6956953e. IA carries the identical string, so it is not
 *     an error — it is a multi-volume set title sitting on one volume, and the
 *     fix is a qualifier, not a rewrite.
 *
 * Every write records `field_provenance.<field>` with the previous value and
 * both sources, so any of this is reversible from the record alone.
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const NOW = new Date();

const CORRECTIONS = [
  {
    id: '69ae633c5d11d232640c382c',
    ia: 'aristotelisoper01arisgoog',
    evidence: 'Every running head begins ΕΙΣ ("commentary on…") — Porphyry, David, Simplicius. The IA record for the same Bekker set lists "v. 4. Scholia in Aristotelem", and the genuine vol. 2 is a separate record we hold (69937973…).',
    set: {
      title: 'Aristotelis Opera, Vol. 4 (Bekker Edition, 1831): Scholia in Aristotelem',
      display_title: 'Works of Aristotle, Vol. 4 — Bekker Edition (1831): Scholia in Aristotelem (ancient commentaries)',
      english_title: 'Works of Aristotle, Vol. 4 — Bekker Edition (1831): Scholia in Aristotelem (ancient commentaries)',
    },
  },
  {
    id: '69b21bbc429e087c6f8632bc',
    ia: 'opera04aris',
    evidence: 'Heads are ΘΕΟΦΡΆΣΤΟΥ (196pp), ΠΕΡῚ ΦΥΤΩ͂Ν and ΠΕΡῚ ΦΥΤΩ͂Ν ΑἸΤΙΩ͂Ν. The Aldine Aristotle carries Theophrastus\'s botanical works in its later volumes, and english_title already read "Enquiry into Plants". The collection tagger had independently marked it `herbalism`.',
    set: {
      title: 'Theophrastus, De Historia Plantarum & De Causis Plantarum (Aldine, Vol. 4, 1497)',
      display_title: 'Theophrastus — Enquiry into Plants & On the Causes of Plants (Aldine Edition, Vol. 4)',
      english_title: 'Enquiry into Plants & On the Causes of Plants',
      author: 'Theophrastus',
    },
  },
  {
    id: '69b21bc3429e087c6f863493',
    ia: 'opera05aris',
    evidence: 'The IA record for this Aldine set states it is "the first printed Greek language edition of Aristotle\'s collected works, WITH THE EXCLUSION OF THE POETICA AND RHETORICA" — so the current title naming both is impossible. Heads show ΠΡΟΒΛΗΜΆΤΩΝ, ΜΗΧΑΝΙΚΆ and ΤΩ͂Ν ΜΕΤᾺ ΤᾺ ΦΥΣΙΚΆ.',
    set: {
      title: 'Aristotelis Opera, Vol. 5 (Aldine, 1497): Problemata, Mechanica, Metaphysica',
      display_title: 'Works of Aristotle, Vol. 5 — Aldine Edition: Problems, Mechanics, Metaphysics',
      english_title: 'Works of Aristotle, Vol. 5 — Aldine Edition: Problems, Mechanics, Metaphysics',
    },
  },
  {
    id: '69b220b356715b0e324732e1',
    ia: 'opera06aris',
    evidence: 'Same Aldine set, which excludes the Poetica and Rhetorica per its IA record. Heads show ἨΘΙΚΩ͂Ν ΝΙΚΟΜΑΧΕΊΩΝ, ΠΟΛΙΤΙΚΩ͂Ν, ΟἸΚΟΝΟΜΙΚΩ͂Ν, ἨΘΙΚΩ͂Ν ΜΕΓΆΛΩΝ and ἨΘΙΚΩ͂Ν ΕΥ̓ΔΗΜΊΩΝ — not the Metaphysics the title claims.',
    set: {
      title: 'Aristotelis Opera, Vol. 6 (Aldine, 1495): Ethica, Politica, Oeconomica',
      display_title: 'Works of Aristotle, Vol. 6 — Aldine Edition: Nicomachean Ethics, Politics, Economics, Magna Moralia, Eudemian Ethics',
      english_title: 'Works of Aristotle, Vol. 6 — Aldine Edition: Nicomachean Ethics, Politics, Economics, Magna Moralia, Eudemian Ethics',
    },
  },
  {
    id: '6956953e8c9559f6c2db0b6d',
    ia: 'rhetoricpoetica00arisgoog',
    evidence: 'NOT a bad title: IA carries the identical string, and its own record says volume 2. It is the multi-volume SET title sitting on one volume, which holds only the Ethics (a single derived head across pp.13-399). Qualified rather than rewritten.',
    set: {
      display_title: 'The Rhetoric, Poetic, and Nicomachean Ethics of Aristotle — Vol. 2 (Nicomachean Ethics only)',
      english_title: 'The Rhetoric, Poetic, and Nicomachean Ethics of Aristotle — Vol. 2 (Nicomachean Ethics only)',
    },
  },
];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const c = new MongoClient(uri); await c.connect();
const db = c.db('bookstore');

let applied = 0;
for (const corr of CORRECTIONS) {
  const book = await db.collection('books').findOne({ id: corr.id }, { projection: { title: 1, display_title: 1, english_title: 1, author: 1, slug: 1 } });
  if (!book) { console.log(`\n${corr.id}  NOT FOUND`); continue; }

  console.log(`\n─── ${corr.id}`);
  console.log(`    evidence: ${corr.evidence}`);
  const set = {};
  for (const [field, value] of Object.entries(corr.set)) {
    if (book[field] === value) { console.log(`    ${field}: already correct`); continue; }
    console.log(`    ${field}:`);
    console.log(`      was ${JSON.stringify(book[field])}`);
    console.log(`      now ${JSON.stringify(value)}`);
    set[field] = value;
    set[`field_provenance.${field}`] = {
      source: 'running-head derivation + Internet Archive record',
      ia_identifier: corr.ia,
      evidence: corr.evidence,
      confidence: 0.9,
      previous_value: book[field] ?? null,
      date: NOW,
      issue: '#3652',
    };
  }
  console.log(`    slug unchanged: ${book.slug}`);
  if (APPLY && Object.keys(set).length) {
    const r = await db.collection('books').updateOne({ id: corr.id }, { $set: { ...set, updated_at: NOW } });
    applied += r.modifiedCount;
  }
}

console.log(APPLY ? `\napplied — ${applied} records modified` : '\nDRY RUN — nothing written. Pass --apply.');
console.log('Reversible from field_provenance.<field>.previous_value.');
await c.close();
