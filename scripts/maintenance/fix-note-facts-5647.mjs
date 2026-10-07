#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/fix-note-facts-5624.mjs — the same repair for the 18 notes the
 * #5624 sweep found wrong; this is its pattern (named list, note text only, one door) applied to
 * the #5647 lane's findings. The door itself is scripts/lib/translation-text-repair.mjs.
 *
 * Corrects translator's notes that the #5647 fact-check lane found wrong (Derek approved stage 3
 * and its repairs 2026-10-03):
 *   - stage 2: the reference-table conflicts read as wrong against their 84000 / Mahāvyutpatti
 *     entries (scripts/eval/results/note-claims-5647/run-summary.json), N053 among them;
 *   - stage 3: `wrong` verdicts of the grounded verifier whose cited source was read by hand and
 *     agrees (scripts/eval/results/note-claims-5647/stage3/).
 * partly-wrong and unverifiable verdicts are NOT here; they are a review list in the results.
 *
 * Only the note's words change, minimally. Guards (translation-text-repair.mjs): skip a
 * human-edited page; skip a page whose stored text no longer holds the note verbatim exactly
 * once; the page_revisions row (source 'note-factcheck-5647') is written first.
 *
 * Usage:
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/fix-note-facts-5647.mjs   # dry run → diff
 *   … --apply
 */
import fs from 'node:fs';
import { getScriptClient } from '../lib/mongo.mjs';
import { repairTranslationText, resyncMirrors } from '../lib/translation-text-repair.mjs';

const APPLY = process.argv.includes('--apply');
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || '/tmp/note-facts-5647-diff.json';
const SOURCE = 'note-factcheck-5647';
const ISSUE = '#5647';

// [id, page_id, the note exactly as stored, its replacement, the source read]
const FIXES = [
  // stage 2 — reference-table conflicts
  ['S2-dzogchen', '69e788694a6785cfd60d0f06', 'Tibetan: "rdzogs pa chen po"; Sanskrit: Dzogchen', 'Tibetan: "rdzogs pa chen po"; Sanskrit: mahāsandhi', '84000 Toh 142 glossary: rdzogs pa chen po = mahāsandhi'],
  ['S2-shed-bdag-1', '69e7ac0f5f1a22ab19aa30ce', 'Tibetan: shed bdag; Sanskrit: atman or purusha', 'Tibetan: shed bdag; Sanskrit: mānava', '84000 Toh 8 and Toh 9 glossaries: shed bdag = mānava (“child of Manu”, humankind)'],
  ['S2-shed-bdag-2', '69e7ac115f1a22ab19aa31a6', 'term: soul (Tibetan: shed-bdag, equivalent to Sanskrit: puruṣa or ātman)', 'term: soul (Tibetan: shed-bdag, equivalent to Sanskrit: mānava)', '84000 Toh 8 and Toh 9 glossaries: shed bdag = mānava'],
  ['S2-N053', '69e7ac145f1a22ab19aa3464', 'Tibetan: rang bzhin stong pa nyid; Sanskrit: svabhāva-śūnyatā', 'Tibetan: rang bzhin stong pa nyid; Sanskrit: prakṛti-śūnyatā', '84000 Toh 8 glossary and Mahāvyutpatti 951: rang bzhin stong pa nyid = prakṛtiśūnyatā'],
  ['S2-N019', '69e7ac3a5f1a22ab19aa5bc2', 'Tibetan: Rab kyi rtsal gyis rnam par gnon pa; Sanskrit: Vikrāntagāmin', 'Tibetan: Rab kyi rtsal gyis rnam par gnon pa; Sanskrit: Suvikrāntavikrāmin', '84000 Toh 10 and Toh 113 glossaries, Mahāvyutpatti 1355: Suvikrāntavikrāmin'],
  // 84000 attests shin tu dga’ = Supriya only for a gandharva (Toh 346), another referent; Sudarśana is legs mthong.
  // The unsupported Sanskrit is dropped rather than replaced.
  ['S2-N233', '69e7ac955f1a22ab19aa972b', "Tibetan: Shin tu dga'; Sanskrit: Sudamsana", "Tibetan: Shin tu dga'", "84000: shin tu dga' is not Sudarśana (legs mthong); no attested Sanskrit for this referent"],
  // stage 3 — grounded `wrong` verdicts, each source read by hand. 8 of the 11 were NOT applied:
  // the verifier was wrong (5) or the error is in the running text, not the note, or the sources
  // disagree (3) — see the experiments file.
  ['S3-musulundha', '69e7ab0c5f1a22ab19a9203e', 'name of a Naga or local deity acting as a teacher', 'name of the king of the gods in the Heaven Free from Strife, acting as a teacher', '84000 Toh 287 glossary: Musulundha, king of the gods in the Heaven Free from Strife (same text)'],
  ['S3-upagupta-father', '69e7abc15f1a22ab19a9d9c5', 'likely Shanavasa, the father of Upagupta', 'the father of Upagupta, a perfume merchant of Mathurā, is called Gupta in other accounts; Shanakavasin, named above, was Upagupta’s teacher', '84000 Toh 340 and Toh 1-6 glossaries: Gupta, perfume merchant, father of Upagupta; Wikipedia Upagupta: Śāṇavāsa his teacher'],
  ['S3-asvajit', '69e7ac275f1a22ab19aa4846', "The Tibetan 'rta thul' translates the Sanskrit name Ajita, 'The Unconquered'", "The Tibetan 'rta thul' translates the Sanskrit name Aśvajit", '84000 (Toh 1-1, 85, 99, 113, 138 …) and Mahāvyutpatti 1042: rta thul = Aśvajit; Ajita is ma pham pa'],
];

function applyFix(text, from, to) {
  const tag = `<note>${from}</note>`;
  if (text.split(tag).length !== 2) return null; // absent, or ambiguous
  if (!to) return text.includes(` ${tag}`) ? text.replace(` ${tag}`, '') : text.replace(tag, '');
  return text.replace(tag, `<note>${to}</note>`);
}

const { client, db } = await getScriptClient({ noTimeout: true, socketTimeoutMs: 120_000 });
const rows = [];
const written = [];
for (const [fid, pageId, from, to, read] of FIXES) {
  const page = await db.collection('pages').findOne({ id: pageId });
  const row = { fid, page_id: pageId, before: from, after: to || '(note removed)', source_read: read };
  if (!page) { rows.push({ ...row, status: 'skipped', why: 'page_not_found' }); continue; }
  row.book_id = page.book_id; row.page = page.page_number;
  row.url = `https://sourcelibrary.org/book/${page.book_id}?page=${page.page_number}`;
  const next = applyFix(page.translation?.data || '', from, to);
  if (next == null) { rows.push({ ...row, status: 'skipped', why: 'note_not_verbatim_once' }); continue; }
  const res = await repairTranslationText(db, page, next, {
    expectBefore: page.translation.data, source: SOURCE, issue: ISSUE, jobId: SOURCE, apply: APPLY,
    reason: `translator's note ${fid} corrected per the #5647 fact-check lane (${read}); only the note text changed`,
  });
  rows.push({ ...row, ...res });
  if (res.status === 'written') written.push(page.id);
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.fid} ${r.status}${r.why ? ` (${r.why})` : ''}  ${r.before_hash ?? ''}→${r.after_hash ?? ''}`);
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`\n${APPLY ? 'written' : 'would write'}: ${count(APPLY ? 'written' : 'dry_run')} · skipped: ${count('skipped')} · diff → ${OUT}`);
if (written.length) console.log('mirrors:', JSON.stringify(await resyncMirrors(db, written)));
await client.close();
