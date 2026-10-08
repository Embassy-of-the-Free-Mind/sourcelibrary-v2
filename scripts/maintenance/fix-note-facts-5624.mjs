#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/fix-unclosed-note-tags.mjs — repairs tag STRUCTURE corpus-wide;
 * this edits the WORDS of 18 named notes. scripts/maintenance/withdraw-fabricated-translation-4584.mjs
 * — replaces invented spans with <lacuna>, a different repair for a different defect. Looked in
 * scripts/maintenance/, scripts/audit/ and `git grep note-fact`.
 *
 * Corrects the 18 translator's notes in the Tibetan retranslation run (#4523) that the
 * #5624 fact-check found wrong or partly wrong (Derek approved applying them 2026-10-02).
 * Source of the findings: scripts/eval/results/note-facts-full-2026-10-02-5624/corrections.json.
 *
 * Only the note's text changes, minimally: the wrong identification is replaced with the
 * sourced correction, or the unsupported clause is deleted. The running text is untouched
 * (N221/N222 also misread me skyes in the running text — out of scope here, see #5624).
 *
 * Guards (scripts/lib/translation-text-repair.mjs): skip a human-edited page; skip a page whose
 * stored text no longer contains the note verbatim exactly once; revision row first.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fix-note-facts-5624.mjs           # dry run → diff file
 *   … --apply
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { repairTranslationText, resyncMirrors } from '../lib/translation-text-repair.mjs';

const APPLY = process.argv.includes('--apply');
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || '/tmp/note-facts-5624-diff.json';
const SOURCE = 'note-fact-fix-5624';
const ISSUE = '#5624';

// nid → [book_id, page_number, the note exactly as stored, its replacement ('' removes the note)].
const FIXES = [
  ['N018', '69e7abc95f1a22ab19a9e04a', 53, 'The king or deity Musulundha/Mucilinda acting as a teacher', 'Musulundha, king of the gods of the Heaven Free from Strife, acting as a teacher'],
  ['N030', '69e7aae65f1a22ab19a8f3de', 171, 'likely a phonetic rendering of a Sanskrit name', 'a Tibetan translation of the Sanskrit name Raivata'],
  ['N050', '69e7ac145f1a22ab19aa33d0', 149, 'Tibetan: ngo bo nyid stong pa nyid; Sanskrit: prakṛti-śūnyatā', 'Tibetan: ngo bo nyid stong pa nyid; Sanskrit: svabhāva-śūnyatā'],
  ['N057', '69e786b24a6785cfd60c8e7b', 123, "likely Garab Dorje's father or a master in the lineage", 'a master in the lineage'],
  ['N063', '69e7aabb80b52390feb19b6e', 106, "referring to Sanskrit as 'mleccha' in this specific context or a non-Tibetan dialect", "Sanskrit 'mleccha': a foreign, non-Sanskrit language"],
  ['N075', '69e7ac245f1a22ab19aa444c', 92, 'The personal name of the disciple Shariputra', "Another name of the disciple Shariputra, meaning 'son of Śāradvatī'"],
  ['N093', '69e7ac905f1a22ab19aa9269', 55, 'Pema Lingpa (1450–1521) was a major Treasure Revealer (terton) and an incarnation of Guru Rinpoche', 'Pema Lingpa (1450–1521) was a major Treasure Revealer (terton), traditionally regarded as an incarnation of Longchenpa and of Princess Pema Sel'],
  ['N186', '69e7aba15f1a22ab19a9b381', 23, 'Tibetan: Blo gros brtan pa; Sanskrit: Sthiramati', 'Tibetan: Blo gros brtan pa; Sanskrit: Dṛḍhamati'],
  ['N193', '69e7abb55f1a22ab19a9cb7e', 76, "Tibetan: 'Jig rten 'dzin; Sanskrit: Lokeshvara or Jagaddhara", "Tibetan: 'Jig rten 'dzin; Sanskrit: Lokadhara"],
  ['N216', '69e7abec5f1a22ab19aa0707', 3, 'referring to Vishnu or a specific lineage', "Maitreya, also called Ajita, 'the Invincible'"],
  ['N221', '69e7ab285f1a22ab19a93de3', 26, 'term: "Me-skyes" gloss: Fire-born, referring to Jivaka Kumarabhritya', 'term: "Me-skyes" gloss: Fire-born; Sanskrit: Jyotiṣka (not Jīvaka)'],
  ['N222', '69e7ab285f1a22ab19a93de3', 23, 'term: "Mi-skyes" gloss: "Ajata; literally \'unborn\' or \'not produced\'"', 'term: "Me-skyes" (the scan reads "Mi-skyes") gloss: Fire-born; Sanskrit: Jyotiṣka'],
  ['N232', '69e7ac955f1a22ab19aa9713', 24, "Tibetan: dGa' ba'i sde; Sanskrit: Harisena", "Tibetan: dGa' ba'i sde; Sanskrit: Nandasena"],
  ['N255', '69e7965680b52390feb195ab', 23, 'This is the "Sealed Command of Auspiciousness" composed by the Great Siddha Drubchen Nyungpo.', 'This is the "Sealed Command of Auspiciousness" composed by the Great Siddha Khyungpo (Khyungpo Naljor).'],
  ['N287', '69e761e6cc48e59ad74f220f', 84, 'literally: China, but often used for Sanskrit in these contexts', 'Tibetan: rgya gar, India; that is, Sanskrit'],
  ['N295', '69e7619acc48e59ad74f091b', 202, 'Taurus, Aquarius, Capricorn - though Vessel usually denotes Aquarius, here it refers to the container category', 'Taurus, Virgo, Capricorn'],
  ['N298', '69e76218cc48e59ad74f3470', 114, 'A major school of Tibetan Buddhism founded by Atisha', "A major school of Tibetan Buddhism, founded by Dromtön on the basis of Atisha's teachings"],
  ['N332', '69e761a2cc48e59ad74f0c93', 227, 'Minling Terchen Gyurme Dorje, 1646-1714.', ''],
];

function applyFix(text, from, to) {
  const tag = `<note>${from}</note>`;
  if (text.split(tag).length !== 2) return null; // absent, or ambiguous
  // Removing a whole note also removes the one space that separated it from the word it glossed.
  if (!to) return text.includes(` ${tag}`) ? text.replace(` ${tag}`, '') : text.replace(tag, '');
  return text.replace(tag, `<note>${to}</note>`);
}

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const rows = [];
const written = [];
for (const [nid, bookId, pageNumber, from, to] of FIXES) {
  const pages = await db.collection('pages').find({ book_id: bookId, page_number: pageNumber }).toArray();
  const row = { nid, book_id: bookId, page: pageNumber, before: from, after: to || '(note removed)' };
  if (pages.length !== 1) { rows.push({ ...row, status: 'skipped', why: `pages_found=${pages.length}` }); continue; }
  const page = pages[0];
  row.page_id = page.id;
  const next = applyFix(page.translation?.data || '', from, to);
  if (next == null) { rows.push({ ...row, status: 'skipped', why: 'note_not_verbatim_once' }); continue; }
  const res = await repairTranslationText(db, page, next, {
    expectBefore: page.translation.data, source: SOURCE, issue: ISSUE, jobId: SOURCE, apply: APPLY,
    reason: `translator's note ${nid} corrected per the #5624 fact-check (corrections.json); only the note text changed`,
  });
  rows.push({ ...row, ...res });
  if (res.status === 'written') written.push(page.id);
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.nid} ${r.status}${r.why ? ` (${r.why})` : ''}  ${r.before_hash ?? ''}→${r.after_hash ?? ''}`);
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`\n${APPLY ? 'written' : 'would write'}: ${count(APPLY ? 'written' : 'dry_run')} · skipped: ${count('skipped')} · diff → ${OUT}`);
if (written.length) console.log('mirrors:', JSON.stringify(await resyncMirrors(db, written)));
await mongo.close();
