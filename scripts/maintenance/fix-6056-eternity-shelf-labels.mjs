#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/fix-3942-edition-vs-work-language.mjs — the same job for two other records
 * (a named list, an `expect` guard, typed provenance, a sweep_log row); this copies its shape and cannot
 * reuse it, because its list is its content. scripts/maintenance/relabel-bilingual-edition.mjs proposes the
 * compound value for a two-language edition and is what the Benjamin of Tudela row follows (catalogued
 * language first); it writes no provenance and no sweep_log row, and it cannot REPLACE a wrong catalogued
 * language (Arda Viraf's "Persian"), so the four are written here together.
 *
 * fix-6056-eternity-shelf-labels — the four title / language labels the Eternity shelf review found wrong
 * (#6056 class (g); handoff step 5 on #5918). Rules: .claude/docs/invariants/language-fields.md.
 *
 * Evidence, per book: the per-page `<language>` tag inside `pages.ocr.data` (counted over every page at
 * page_number > 0, 2026-10-06), and the title page and interior pages read as text.
 *
 *   69e8b27a2ff2a8dc09e77e4c  catalogued 傳習錄 (Chuanxilu). The printed heading of every juan is
 *     陽明先生集要經濟編卷四 …, the contents list is 陽明先生集要經濟編目錄 (memorials on the Prince of Ning's
 *     rebellion), and the cover label reads 經濟集 / 平宸濠三十一篇. It is vol. 7 of the 1787 Jimei tang
 *     陽明先生集要: the statecraft part, not the Chuanxilu. TITLE only; the language is right.
 *   69e748aa85f786e884a4ca1f  catalogued Persian, Persian title. Title page: "Rubáiyát of Omar Khayyám.
 *     English, French and German translations comparatively arranged in accordance with the text of Edward
 *     FitzGerald's version … edited by Nathan Haskell Dole", Boston 1896, vol. 1. Page tags: English on 378
 *     of 400, French on 98, German on 99, Persian on 4. No Persian text is in the scan, so this is a
 *     translation edition: language by measured share, the source in `original_language`.
 *   69e9617a2beefe2f6f72ba14  catalogued Hebrew. Asher 1840, vol. 1, "Text, bibliography, and translation":
 *     English on 175 of 319 pages, Hebrew on 156. The Hebrew text is in the scan, so the catalogued language
 *     stays first and English is added. (The shelf note said "English"; the leaves say both.)
 *   69920ba8e0a548a13d8846fe  catalogued Persian. Haug and West 1872, "The Pahlavi text … with an English
 *     translation": Middle Persian / Pahlavi on 193 of 428 pages, English on 210, New Persian on 4 (an
 *     appendix). "Pahlavi" is "Middle Persian" in the pinned vocabulary (language-normalize `pal`).
 *
 * ACTUATION (CLAUDE.md): `books.language` is read by sync-books-catalog.mjs (the Supabase mirror behind
 * every card, incremental on `updated_at`, hence the bump), by the language filters, and by OCR and
 * translation routing. All four stay outside the Latin-script allowlist or are already fully read, so no
 * page is re-routed. `text_role` moves on the Rubáiyát only (original → modern-translation), which lowers
 * its rank among editions of the work. No first-translation field is touched. NOT written here, and stale
 * after the title changes: `normalized_title`, `edition_key`, `work_id` (identity-worker's job).
 *
 *   node --env-file=.env.production.local scripts/maintenance/fix-6056-eternity-shelf-labels.mjs          # dry run
 *   node --env-file=.env.production.local scripts/maintenance/fix-6056-eternity-shelf-labels.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const NOW = new Date().toISOString();
const SCRIPT = 'fix-6056-eternity-shelf-labels.mjs';

const FIXES = [
  {
    id: '69e8b27a2ff2a8dc09e77e4c',
    expect: { title: '傳習錄 (Chuánxílù / Wang Yangming Collected)' },
    set: { title: '陽明先生集要 經濟編 卷四 (Yangming xiansheng jiyao: Statecraft Writings, juan 4)' },
    note: 'Printed juan heading 陽明先生集要經濟編卷四; contents 陽明先生集要經濟編目錄; cover label 經濟集 / 平宸濠三十一篇; IA volume v.7 of 12, Jimei tang 1787. Not the Chuanxilu.',
  },
  {
    id: '69e748aa85f786e884a4ca1f',
    expect: { language: 'Persian' },
    set: {
      title: 'Rubáiyát of Omar Khayyám: English, French and German Translations Comparatively Arranged in Accordance with the Text of Edward FitzGerald\'s Version (ed. Nathan Haskell Dole), vol. 1',
      language: 'English-French-German', languages: ['English', 'French', 'German'], language_multi: true,
      original_language: 'Persian', is_translation: true, language_review: false,
      text_role: 'modern-translation', text_role_source: 'human-qa-6056',
    },
    note: 'Title page read; page tags English 378/400, French 98, German 99, Persian 4. Dole\'s 1896 variorum of translations around FitzGerald; no Persian text in the scan.',
  },
  {
    id: '69e9617a2beefe2f6f72ba14',
    expect: { language: 'Hebrew' },
    set: { language: 'Hebrew-English', languages: ['Hebrew', 'English'], language_multi: true, language_review: false },
    note: 'Asher 1840 vol. 1, "Text, bibliography, and translation": page tags English 175/319, Hebrew 156. Catalogued language kept first (relabel-bilingual-edition rule).',
  },
  {
    id: '69920ba8e0a548a13d8846fe',
    expect: { language: 'Persian' },
    set: { language: 'Middle Persian-English', languages: ['Middle Persian', 'English'], language_multi: true, language_review: false },
    note: 'Haug and West 1872, "The Pahlavi text … with an English translation": page tags Middle Persian/Pahlavi 193/428, English 210, New Persian 4.',
  },
];

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set.'); process.exit(1); }
const mc = await MongoClient.connect(process.env.MONGODB_URI);
const db = mc.db('bookstore');
const B = db.collection('books');
const log = [];

for (const fix of FIXES) {
  const proj = Object.fromEntries([...Object.keys(fix.set), ...Object.keys(fix.expect), 'field_provenance.language', 'field_provenance.title'].map((k) => [k, 1]));
  const before = await B.findOne({ id: fix.id }, { projection: proj });
  if (!before) { console.log(`SKIP ${fix.id}: not found`); continue; }
  // Only while the record still holds the exact wrong value: a rerun, or a hand correction, is left alone.
  const [ek, ev] = Object.entries(fix.expect)[0];
  if (before[ek] !== ev) { console.log(`SKIP ${fix.id}: ${ek} is ${JSON.stringify(before[ek])}, expected ${JSON.stringify(ev)}`); continue; }
  const row = { id: fix.id, before: Object.fromEntries(Object.keys(fix.set).map((k) => [k, before[k] ?? null])), after: fix.set };
  log.push(row);
  console.log(`\n${APPLY ? 'FIX' : 'WOULD FIX'} ${fix.id}`);
  for (const k of Object.keys(fix.set)) console.log(`   ${k}: ${JSON.stringify(row.before[k])} -> ${JSON.stringify(fix.set[k])}`);
  if (!APPLY) continue;

  const prov = (field) => ({
    source: 'manual', value: fix.set[field], previous_value: before[field] ?? null, chosen_from: field === 'language' ? 'ocr_page_language_declaration' : 'title_page',
    claims: [{ source: before.field_provenance?.[field]?.source ?? 'import', value: before[field] ?? null }, { source: 'manual', value: fix.set[field] }],
    issue: 6056, note: fix.note, script: SCRIPT, date: NOW,
  });
  const $set = { ...fix.set, updated_at: new Date() };
  if ('language' in fix.set) $set['field_provenance.language'] = prov('language');
  if ('title' in fix.set) $set['field_provenance.title'] = prov('title');
  const r = await B.updateOne({ id: fix.id, [ek]: ev }, { $set });
  await recordSweepAction(db, {
    sweep: 'fix-6056-eternity-shelf-labels', book_id: fix.id, action: 'label-corrected',
    detail: { issue: 6056, before: row.before, after: fix.set, note: fix.note },
  });
  console.log(`   matched ${r.matchedCount}, modified ${r.modifiedCount}`);
}
console.log(`\n${JSON.stringify(log, null, 1)}`);
console.log(APPLY ? `Applied ${log.length}. sync-books-catalog.mjs picks these up from updated_at.` : `Dry run: ${log.length} would change. Re-run with --apply.`);
await mc.close();
