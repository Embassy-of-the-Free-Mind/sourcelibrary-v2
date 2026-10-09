#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/fix-note-facts-5624.mjs — the same shape (a hand list of exact
 * before/after spans, guarded helper); that one corrects notes, this one stray Chinese and Japanese
 * tokens. scripts/maintenance/fix-stray-hangul-5734.mjs — the mechanical Hangul half of #5734.
 *
 * #5734 part 2: every Han and kana hit in the English of the Tibetan run (envelope
 * tibetan-retranslation-4523, since 2026-10-01) was read against the page's OCR. These are the
 * STRAY ones — a Chinese or Japanese token in place of an English word, absent from the Tibetan
 * source — each replaced in place with the English word. Where the model glossed its own stray
 * token with a note ("The卓越 <note>surpassing</note>"), the note's word becomes the text and the
 * note goes: it glossed the token, not the source. The hits kept as legitimate (a note quoting
 * Han characters that ARE in the OCR, <unclear>/<warning> echoes of OCR filler) are listed in the
 * #5734 report, not here.
 *
 * Guards (scripts/lib/translation-text-repair.mjs): skip a human-edited page; skip a page whose
 * stored text no longer holds the span the expected number of times; revision row first.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fix-stray-han-5734.mjs [--out=FILE]   # dry run
 *   … --apply
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { repairTranslationText, resyncMirrors } from '../lib/translation-text-repair.mjs';

const APPLY = process.argv.includes('--apply');
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || '/tmp/stray-han-5734-diff.json';
const SOURCE = 'fix-stray-han-5734';
const ISSUE = '#5734';

// [book_id, page_number, the span exactly as stored, its replacement, times it occurs (default 1), why]
const FIXES = [
  ['69e76137cc48e59ad74ee43d', 243, '第九, the intention', 'Ninth, the intention', 1, '第九 "ninth" in an ordinal list'],
  ['69e77aba0fc6fc955e361a51', 227, 'Complete Enjoyment Body <note><term>精</term></note>', 'Complete Enjoyment Body', 1, 'a lone 精 ("essence") offered as the term for the Sambhogakaya; not in the source, and not its Chinese'],
  ['69e786df6846fc56c490f9ba', 52, 'the greatness of being卓越,', 'the greatness of being preeminent,', 1, '卓越 "preeminent" in a list of greatnesses'],
  ['69e786e66846fc56c49100bb', 163, '第八, holding', 'Eighth, holding', 1, '第八 "eighth" after "Seventh,"'],
  ['69e786e96846fc56c4910313', 46, 'The卓越 <note>surpassing</note> <term>Bindus</term>', 'The surpassing <term>Bindus</term>', 1, '卓越 glossed by its own note'],
  ['69e786e96846fc56c4910313', 53, 'the卓越 <note>surpassing</note> <term>Bodhicitta</term>', 'the surpassing <term>Bodhicitta</term>', 1, '卓越 glossed by its own note'],
  ['69e786ed6846fc56c4910745', 122, 'Your卓越 <note>extraordinary</note> prowess', 'Your extraordinary prowess', 1, '卓越 glossed by its own note'],
  ['69e786fe4a6785cfd60c98b4', 14, "*A-果*", "*A-'bras*", 2, "果 \"fruit\" for 'bras in the OCR's ཨ་འབྲས (a-'bras); transliterated like its neighbours"],
  ['69e788164a6785cfd60cf086', 118, 'the most卓越 <note>extraordinary</note> offering', 'the most extraordinary offering', 1, '卓越 glossed by its own note'],
  ['69e788a14a6785cfd60d13f3', 82, '<note>anいった expression', '<note>an expression', 1, 'stray kana いった inside "an"'],
  ['69e78a704a6785cfd60d347e', 86, '第九, the sealing', 'Ninth, the sealing', 1, '第九 "ninth" in an ordinal list'],
  ['69e7ab345f1a22ab19a94976', 463, 'supreme and卓越 miraculous', 'supreme and excellent miraculous', 1, '卓越 "excellent"'],
  ['69e7ab3f5f1a22ab19a95440', 358, 'And the卓越 special', 'And the excellent special', 1, '卓越 "excellent"'],
  ['69e7ab5f5f1a22ab19a978df', 341, 'will become卓越 <note>meaning: eminent/elevated</note> through', 'will become eminent through', 1, '卓越 glossed by its own note; the next sentence reads "Having become eminent"'],
  ['69e7ab805f1a22ab19a9970f', 71, 'inexhaustible and卓越.', 'inexhaustible and excellent.', 1, '卓越 "excellent"'],
  ['69e7abc45f1a22ab19a9db77', 47, 'will become卓越 <note>distinguished/superior</note>,', 'will become distinguished,', 1, '卓越 glossed by its own note'],
  ['69e7abce5f1a22ab19a9e719', 317, 'By such卓越 characteristics', 'By such excellent characteristics', 1, '卓越 "excellent"'],
  ['69e7abf05f1a22ab19aa0a8f', 196, 'supreme and卓越.', 'supreme and excellent.', 1, '卓越 "excellent"'],
  ['69e7ac255f1a22ab19aa45d5', 87, 'knows卓越 faculties', 'knows superior faculties', 1, "卓越 for the OCR's དབང་པོ་ཁྱད་པར་དུ་འཕགས་པ \"superior faculties\""],
  ['69e7ac445f1a22ab19aa6143', 24, 'and此外, externally', 'and in addition, externally', 1, '此外 "in addition"'],
  ['69e7ac645f1a22ab19aa6f81', 34, '<term>Ratrimabhョ</term>', '<term>Ratrima Bhyo</term>', 1, "katakana ョ for \"yo\"; the OCR reads ར་ཏྲི་མ་བྷྱོ, written like its neighbours (\"Rakshasi Bhyo\")"],
  ['6a14e1322f45ee330c274378', 28, 'generative and卓越 <note>meaning supreme or extraordinary</note> meditative', 'generative and supreme meditative', 1, '卓越 glossed by its own note'],
  ['6a14e1342f45ee330c27450a', 269, 'be made卓越 <note>outstanding</note>.', 'be made outstanding.', 1, '卓越 glossed by its own note'],
  ['6a14e1352f45ee330c2746a6', 371, 'bliss is卓越 <note>extraordinary</note>,', 'bliss is extraordinary,', 1, '卓越 glossed by its own note'],
  ['6a14e1372f45ee330c27485e', 149, 'the un胜realized', 'the unrealized', 1, "stray 胜 inside \"unrealized\" (the OCR's མ་རྟོགས)"],
  ['6a14e140311a9edd4621dd57', 54, 'The卓越 <note>extraordinary</note> <term>bindu</term>', 'The extraordinary <term>bindu</term>', 1, '卓越 glossed by its own note'],
  ['6a14e1b7311a9edd4622379e', 232, 'They said a呢 empowerment', 'They said an empowerment', 1, "stray particle 呢; the OCR's དབང་ཞིག is \"an empowerment\""],
];

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const rows = [];
const written = [];
for (const [bookId, pageNumber, from, to, times = 1, why] of FIXES) {
  const pages = await db.collection('pages').find({ book_id: bookId, page_number: pageNumber }).toArray();
  const row = { book_id: bookId, page: pageNumber, url: `https://sourcelibrary.org/book/${bookId}?page=${pageNumber}`, before: from, after: to, rationale: why };
  if (pages.length !== 1) { rows.push({ ...row, status: 'skipped', why_skipped: `pages_found=${pages.length}` }); continue; }
  const page = pages[0];
  row.page_id = page.id;
  const text = page.translation?.data || '';
  if (text.split(from).length !== times + 1) { rows.push({ ...row, status: 'skipped', why_skipped: `span_found=${text.split(from).length - 1}, expected ${times}` }); continue; }
  const res = await repairTranslationText(db, page, text.split(from).join(to), {
    expectBefore: text, source: SOURCE, issue: ISSUE, jobId: SOURCE, apply: APPLY,
    reason: `stray Chinese/Japanese token replaced with the English word (#5734 part 2, read against the OCR): ${why}`,
  });
  rows.push({ ...row, ...res });
  if (res.status === 'written') written.push(page.id);
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.book_id} p${r.page} ${r.status}${r.status === 'skipped' ? ` (${r.why_skipped || r.why})` : ''}`);
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`\n${APPLY ? 'written' : 'would write'}: ${count(APPLY ? 'written' : 'dry_run')} · skipped: ${count('skipped')} · diff → ${OUT}`);
if (written.length) console.log('mirrors:', JSON.stringify(await resyncMirrors(db, written)));
await mongo.close();
