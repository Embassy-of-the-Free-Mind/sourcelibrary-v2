// MANUSCRIPT MAP (#7119): which pages are which hand, script and work, from
//   - the IA record of raswhish145-147 (ONE manuscript under two shelfmarks: RAS South Indian Sanskrit MS 145 =
//     Whish MS 147; six texts; script Mlym) — not three manuscripts, as the 06:08Z spot check guessed from the name;
//   - classify-script.json (one Opus call per page: script, rows, hand), identify-work.json (12 sampled leaves of the
//     dense hand), the probe (reads/probe: colophons/openings) and the locate maps (locate-{A,B,C}.json: works).
// Writes manuscript-map.json; with --apply also the book's `languages` (Sanskrit + Malayalam: the Malayalam-language
// note near the end of the dense-hand stretch and the Dīpikā colophon's date; `language` stays Sanskrit) with a
// field_provenance stamp, and the book note (`summary`, the one book-note.mjs wrote) with the map.
//   node --env-file=/root/sourcelibrary/.env.production.local manuscript-map.mjs [--apply]
// PRIOR ART: book-note.mjs wrote the previous note (kept below as its count sentence); publish.mjs the first one.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { HERE, BOOK } from './lib.mjs';
import { provenanceUpdate } from '../../../lib/field-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const cls = JSON.parse(fs.readFileSync(path.join(HERE, 'classify-script.json'), 'utf8'));
const scriptOf = (v) => v.script || (v.unparsed?.match(/"script":\s*"([^"]+)"/) || [])[1] || null;
const rowsOf = (v) => v.rows ?? Number((v.unparsed?.match(/"rows":\s*(\d+)/) || [])[1]);

// Page ranges (reader page numbers; leaf page = scan n upper -> 2n-2, lower -> 2n-1). Works from the locate maps and
// the probe; hands from the classifier's rows-per-leaf and letter size, which change at p. 131 and p. 222.
export const MAP = [
  { pages: [1, 1], what: 'wooden cover board', hand: null, script: null, language: null },
  { pages: [2, 3], what: 'blank board / leaf', hand: null, script: null, language: null },
  { pages: [4, 4], what: 'label in English (titles of the contents)', hand: 'later, in ink', script: 'Latin', language: 'English' },
  { pages: [5, 6], what: 'contents leaf, then a leaf of large loose letters before the text', hand: 'A', script: 'Malayalam', language: 'Sanskrit/Malayalam' },
  { pages: [7, 20], what: 'Īśvarakṛṣṇa, Sāṅkhyakārikā (IA ff. 1–7)', hand: 'A', script: 'Malayalam', language: 'Sanskrit', work: 'sk' },
  { pages: [20, 129], what: 'Śaṅkara, Jayamaṅgalā (IA ff. 7–62; colophon p. 129)', hand: 'A', script: 'Malayalam', language: 'Sanskrit', work: 'jm' },
  { pages: [130, 130], what: 'blank leaf', hand: null, script: null, language: null },
  { pages: [131, 221], what: 'Vācaspati Miśra, Tattvakaumudī (IA ff. 1–40), the unidentified fragment (IA f. 41) and a short note in Malayalam; the Tattvakaumudī colophon is on p. 131 and the scribe’s closing verse on p. 132, and no opening was found, so the order of the leaves in this stretch is not established', hand: 'B', script: 'Malayalam', language: 'Sanskrit, with a Malayalam note', work: 'tk+fragment' },
  { pages: [222, 222], what: 'blank leaf', hand: null, script: null, language: null },
  { pages: [223, 285], what: 'Annambhaṭṭa, Tarkasaṃgrahadīpikā (IA 32 ff.; opening p. 223, colophon with the Kollam date, partly in Malayalam, p. 285)', hand: 'A', script: 'Malayalam', language: 'Sanskrit', work: 'dipika' },
  { pages: [286, 286], what: 'a short, faint leaf', hand: 'A', script: 'Malayalam', language: 'Sanskrit' },
  { pages: [287, 310], what: 'Annambhaṭṭa, Tarkasaṃgraha (IA 12 ff.)', hand: 'A', script: 'Malayalam', language: 'Sanskrit', work: 'ts' },
  { pages: [311, 315], what: 'blank or nearly blank leaves (faint, uninked writing on pp. 312 and 314)', hand: null, script: null, language: null },
  { pages: [316, 316], what: 'wooden cover board', hand: null, script: null, language: null },
];
export const HANDS = {
  A: 'larger, open hand, 7–11 rows a leaf',
  B: 'small, dense hand, 11–13 rows a leaf (the stretch the edition-anchored method could not place)',
};

function stats([a, b]) {
  const vs = Object.entries(cls).filter(([k]) => +k >= a && +k <= b).map(([, v]) => v);
  const scripts = {};
  for (const v of vs) { const s = scriptOf(v) || 'unparsed'; scripts[s] = (scripts[s] || 0) + 1; }
  const rows = vs.map(rowsOf).filter((r) => r > 0).sort((x, y) => x - y);
  return { pages: vs.length, scripts, rows_median: rows.length ? rows[Math.floor(rows.length / 2)] : null };
}

export const NOTE = `A palm-leaf manuscript in Malayalam script, copied at Calicut in 1822: one manuscript under two shelfmarks (Royal Asiatic Society, South Indian Sanskrit MS 145 = Whish MS 147), shown one leaf per page. `
  + 'Every leaf of the manuscript text is in Malayalam script (checked leaf by leaf by machine, Oct 2026), in two hands. '
  + 'In a larger, open hand: the Sāṅkhyakārikā of Īśvarakṛṣṇa (pp. 7–20), Śaṅkara’s Jayamaṅgalā on it (pp. 20–129), Annambhaṭṭa’s Tarkasaṃgrahadīpikā (pp. 223–285, dated Kollam 997 = 1822 at the end, partly in Malayalam) and his Tarkasaṃgraha (pp. 287–310). '
  + 'In a small, dense hand (pp. 131–221): Vācaspati Miśra’s Tattvakaumudī, an unidentified Sāṅkhya fragment and a short note in Malayalam; the Tattvakaumudī’s closing words are on pp. 131–132 and its opening was not found, so the order of these leaves is not yet known. '
  + 'Pages 1 and 316 are the wooden boards, p. 4 an English label, pp. 5–6 a contents leaf, and pp. 2–3, 130, 222 and 311–315 are blank or nearly so. '
  + 'The text on these pages was made by machine in October 2026, in one of two ways, and each page says which. '
  + 'Where an AI model (Claude Opus 5.5) could place a leaf in a published text (206 leaves), the page gives that text collated against the leaf, in Malayalam script generated from the romanised text with this scribe’s spellings, and in IAST: in a test on 9 leaves of the verses, AI reviewers found 25 of 36 planted differences between leaf and edition (69%), so about a third of real differences may be unmarked. A note under it gives a fresh direct reading of the leaf. '
  + 'On the other leaves (108, most of them the dense hand of pp. 131–221, which no model could place) the page gives a direct reading by Claude Opus 5.5 with no edition shown. On 9 verse leaves such reads differed from the published text in 37% of characters, unevenly and partly from memory of the verses; across the 209 placed leaves, in 53%. '
  + 'The English translations (Claude Opus 5.5) translate these uncertain texts. Nothing here has been checked by a scholar.';

async function main() {
  const map = MAP.map((m) => ({ ...m, hand_desc: m.hand ? HANDS[m.hand] || m.hand : null, classifier: stats(m.pages) }));
  fs.writeFileSync(path.join(HERE, 'manuscript-map.json'), JSON.stringify({ source: 'IA raswhish145-147 metadata; classify-script.json; identify-work.json; reads/probe; locate maps', manuscripts: 1, shelfmarks: ['RAS South Indian Sanskrit MS 145', 'RAS Whish MS 147'], hands: HANDS, map }, null, 1));
  for (const m of map) console.log(`pp. ${m.pages[0]}–${m.pages[1]}  ${m.hand || '-'}  ${m.script || '-'}  ${m.what}  ${JSON.stringify(m.classifier.scripts)} rows~${m.classifier.rows_median}`);
  console.log(`\n${NOTE}\n(${NOTE.length} chars)`);
  if (!process.argv.includes('--apply')) return;
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const books = db.collection('books');
  const b = await books.findOne({ id: BOOK }, { projection: { summary: 1, languages: 1, language: 1 } });
  if (b.summary?.source !== 'job:whish147-best-attempt') throw new Error('summary is not this job\'s; not overwritten');
  const languages = ['Sanskrit', 'Malayalam'];
  const prov = provenanceUpdate('languages', { source: 'manuscript-map', script: 'scripts/eval/results/whish147-best-attempt-2026-10-22/manuscript-map.mjs', previous_value: b.languages ?? null, issue: 7119, evidence: 'IA raswhish145-147 description (date etc. in Malayalam at the end of the Dīpikā); probe of scans 109b and 111b (a note in Malayalam prose)' });
  const r = await books.updateOne({ id: BOOK, languages: b.languages }, { $set: { languages, summary: { ...b.summary, data: NOTE, generated_at: new Date() }, updated_at: new Date(), ...prov.$set }, $push: prov.$push });
  if (r.modifiedCount !== 1) throw new Error('book changed under us; nothing written');
  await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: BOOK, action: 'manuscript-map', detail: { issue: 7119, languages, previous_languages: b.languages ?? null, note_chars: NOTE.length } });
  console.log('written: languages + book note');
  await c.close();
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
