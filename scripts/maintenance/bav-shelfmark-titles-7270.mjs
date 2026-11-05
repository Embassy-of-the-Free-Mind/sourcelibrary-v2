#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/clear-derived-vatican-retitle-2026-10-20.mjs — retitled ten Vatican
// records by hand (#7060) and cleared what was derived from the old identity; none of these six is on
// its list. scripts/maintenance/heidelberg-work-first-titles-7270.mjs — the rule-based sibling; these
// six need a reader, not a rule.
/**
 * Six live Vatican manuscripts whose `title` was the bare shelfmark ("Vat.ar.37"). Each work below was
 * established by eye on 2026-10-25 (#7270) from the evidence named on its line; the shelfmark stays
 * in parentheses. `display_title` is set too: on five of them it held a model-derived title that the
 * evidence contradicts (Ott.gr.86 "On Dreams", which BAV catalogues as Cyril's Catecheses).
 * Not retitled (work not established): Reg.gr.80, Vat.gr.573, Vat.gr.2306.
 *
 *   node --env-file=.env.production.local scripts/maintenance/bav-shelfmark-titles-7270.mjs --undo-file=<path> [--apply]
 *   … --restore=<undo file> --apply
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'bav-shelfmark-titles-7270';
const TITLES = [
  // Assemani's contents slip (1785, image 7): "Pars II Paradisi Christianitatis Abdallae Abulpharagii, continet Commentaria in Testamentum Vetus et Novum"
  { id: '6abe596eb3d48554f3370fda', shelfmark: 'Vat.ar.37', title: 'Ibn al-Ṭayyib: Firdaws al-Naṣrāniyya, part II: commentaries on the Old and New Testaments (Vat.ar.37)' },
  // Assemani's contents slip (1784, image 5): "Pentateuchus Mosis e Syriaco textu in Arabicam linguam conversus ab Haret filio Senan, cognomento Ben-Sabbath"
  { id: '6abe594cb3d48554f336fa0a', shelfmark: 'Vat.ar.1', title: 'Pentateuch in Arabic, translated from the Syriac by al-Ḥārith ibn Sinān (Vat.ar.1)' },
  // Greek πίναξ on the flyleaf (image 2): Galen on diagnosis from dreams; Hippocrates, Prognostic, Prorrhetic; Galen on prognosis, on abnormal swellings, on abscesses, commentary on the Aphorisms
  { id: '69a5e3e6006a409842216a25', shelfmark: 'Vat.gr.283', title: 'Galen: On Diagnosis from Dreams, On Abnormal Swellings, Commentary on the Aphorisms; Hippocrates: Prognostic, Prorrhetic (Vat.gr.283)' },
  // Greek πίναξ (image 2): Pythagoras' Golden Verses; sayings of Bias and others; Attic lexicon κατὰ στοιχεῖον; on rhetoric; Harmenopoulos; on dialects; grammar
  { id: '69a5e3e5006a40984221691d', shelfmark: 'Vat.gr.12', title: 'Golden Verses of Pythagoras; sayings of Bias and others; Attic lexicon; treatises on rhetoric, dialects and grammar (Vat.gr.12)' },
  // BAV IIIF manifest metadata: Author "Galenus … Opere spurie e dubbie", Title "De remediis parabilibus"; the stored text also has medical problemata and recipes
  { id: '69a5e3a7006a409842216188', shelfmark: 'Barb.gr.147', title: 'Pseudo-Galen: De remediis parabilibus, and other medical texts (Barb.gr.147)' },
  // BAV IIIF manifest metadata: Title "Cyrilli Hierosolymitani Catecheses"
  { id: '69a5e3d8006a4098422166a7', shelfmark: 'Ott.gr.86', title: 'Cyril of Jerusalem: Catecheses (Ott.gr.86)' },
];

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const APPLY = 'apply' in args;
const normTitle = (t) => (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
try {
  if (args.restore) {
    const rows = readFileSync(args.restore, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    let restored = 0;
    for (const r of rows) if (APPLY) restored += (await books.updateOne({ id: r.id, title: r.new_title }, { $set: { ...r.old, updated_at: new Date() } })).modifiedCount;
    console.log(JSON.stringify({ rows: rows.length, restored, dry_run: !APPLY }));
  } else {
    if (!args['undo-file']) { console.error('--undo-file=<path> is required'); process.exit(2); }
    const plan = [];
    for (const t of TITLES) {
      const b = await books.findOne({ id: t.id }, { projection: { title: 1, display_title: 1, normalized_title: 1 } });
      if (!b || b.title !== t.shelfmark) { console.log(`SKIP ${t.shelfmark}: title is now ${JSON.stringify(b?.title)}`); continue; }
      plan.push({ id: t.id, old: { title: b.title, display_title: b.display_title, normalized_title: b.normalized_title }, set: { title: t.title, display_title: t.title, normalized_title: normTitle(t.title) } });
      console.log(`  ${b.title} [display: ${b.display_title}]\n    → ${t.title}`);
    }
    if (APPLY) {
      if (existsSync(args['undo-file'])) { console.error('undo file exists'); process.exit(2); }
      writeFileSync(args['undo-file'], plan.map((p) => JSON.stringify({ id: p.id, old: p.old, new_title: p.set.title })).join('\n') + '\n');
      let written = 0;
      for (const p of plan) written += (await books.updateOne({ id: p.id, title: p.old.title }, { $set: { ...p.set, updated_at: new Date() } })).modifiedCount;
      await recordSweepActions(client.db(process.env.MONGODB_DB || 'bookstore'), plan.map((p) => ({ sweep: SWEEP, book_id: p.id, action: 'retitled-from-evidence', detail: { old: p.old, new: p.set } })));
      console.log(JSON.stringify({ planned: plan.length, written }));
    } else console.log('DRY RUN');
  }
} finally { await client.close(); }
