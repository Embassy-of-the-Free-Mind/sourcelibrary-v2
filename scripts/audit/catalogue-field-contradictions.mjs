#!/usr/bin/env node
/**
 * Catalogue-field contradictions (#6056 metadata round): classes found by eye in the 2026-10-19 metadata
 * spot check, sized corpus-wide by comparing two fields of the SAME record. Model-free, Mongo read-only,
 * writes a report file only.
 *
 * PRIOR ART: scripts/audit/language-vs-ocr.mjs and language-script-confusion.mjs adjudicate `language`
 * against page TEXT (sampling pages per book; #4654/#4766). This one reads no pages: it tests whether a
 * record contradicts itself (language vs the stored script family, the provenance stamp vs the value it
 * describes, `published` vs the dated title page), so it covers the whole live corpus in one pass and
 * every hit is checkable from the record alone. scripts/audit/field-provenance.mjs checks stamps against
 * placeholder VALUES, not stamp-vs-value disagreement.
 *
 *   node --env-file=.env.production.local scripts/audit/catalogue-field-contradictions.mjs [--out DIR] [--all]
 *
 * --all includes hidden books (default: live = visible && pages_count > 0).
 * Output: DIR/summary.json (counts per class) and DIR/<class>.jsonl (one row per hit). Exit 0.
 *
 * Classes
 *   language-vs-script        `language` is a Latin-script language and book_class.script_family is not
 *                             latin (or the reverse), from the OCR's own script tags.
 *   language-stamp-mismatch   field_provenance.language.value differs from `language`: the stamp
 *                             describes a value the record does not hold.
 *   original-language-on-original  text_role 'original' but original_language is set and differs from
 *                             language — usually the leftover of an earlier wrong language label.
 *   translation-marker-on-original text_role 'original' and the title says the text is a translation
 *                             ("interprete", "in Latinum translata", "übersetzt", "vertaalt", "traduit" …).
 *   published-unknown-title-page-dated  `published` is Unknown/empty while source_work_dates_meta.edition
 *                             was read off the title page or colophon with a quoted imprint.
 *   year-outside-edition-window  numeric `year` falls outside source_work_dates_meta.edition [from, to].
 *   display-title-junk        display_title holds a newline, padding, or a trailing "..." cut.
 *   title-bracket-prefix      title starts with a bracketed tag like "[Arabic]".
 *   author-id-is-library      author_id points at an authors doc named like a library / archive.
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', `${process.env.JOB_SCRATCH || '/tmp'}/catalogue-field-contradictions`);
const ALL = args.includes('--all');

// Languages written (in the editions we hold) in Latin script. Deliberately short and unambiguous:
// a language missing here is simply not tested.
export const LATIN_SCRIPT = new Set(['Latin', 'English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Portuguese',
  'Polish', 'Czech', 'Swedish', 'Danish', 'Norwegian', 'Icelandic', 'Hungarian', 'Catalan', 'Occitan', 'Welsh', 'Irish',
  'Romanian', 'Croatian', 'Slovenian', 'Finnish', 'Estonian', 'Latvian', 'Lithuanian', 'Middle English', 'Old English',
  'Middle High German', 'Old French', 'Middle French', 'Early New High German', 'Low German', 'Frisian', 'Basque',
  'Nahuatl', 'Indonesian', 'Malay', 'Esperanto']);
// Script families whose books cannot be in a Latin-script language unless the edition is a translation.
const NON_LATIN_FAMILIES = new Set(['cjk', 'tibetan', 'indic', 'arabic', 'hebrew', 'syriac', 'armenian', 'ethiopic', 'georgian', 'mongolian', 'cuneiform', 'egyptian', 'coptic']);
// Languages that are only ever written in one non-Latin family in our holdings.
export const LANG_FAMILY = { Chinese: 'cjk', 'Classical Chinese': 'cjk', Japanese: 'cjk', Korean: 'cjk', Tibetan: 'tibetan',
  Sanskrit: 'indic', Hindi: 'indic', Bengali: 'indic', Arabic: 'arabic', Persian: 'arabic', 'Ottoman Turkish': 'arabic',
  Urdu: 'arabic', Hebrew: 'hebrew', Yiddish: 'hebrew', Syriac: 'syriac', Armenian: 'armenian', 'Geʽez': 'ethiopic',
  Georgian: 'georgian', Russian: 'cyrillic', 'Church Slavonic': 'cyrillic', Greek: 'greek', 'Ancient Greek': 'greek' };

export const TRANSLATION_MARKER = new RegExp([
  '\\binterprete\\b', '\\binterpretibus\\b', '\\bin latinum (?:sermonem )?(?:translat|convers|versa)', 'latin[eè] (?:redditu|reddita|versu|versa|facta|conversa)',
  '\\be graeco\\b', '\\bex graeco\\b', '\\be gr[aæ]co in latinum', '\\bex arabico\\b', '\\bex hebr[aæ]o\\b', '\\btranslat[ae]\\b', '\\btranslati\\b', '\\btranslatus\\b',
  '[üu]bersetzt', 'verdeutscht', 'verteutscht', 'verteutschet', 'in (?:die |unsere )?teutsche sprach', 'ins teutsche',
  'vertaalt', 'vertaald', 'overgezet', 'overgeset', 'traduit', 'traduict', 'tradotto', 'tradotta', 'tradott[ei]', 'traducido', 'traduzido',
  '\\btranslated\\b', '\\bdone into english\\b', '\\benglished\\b', 'in selbige sprach versetzt'].join('|'), 'i');

const UNKNOWN_PUBLISHED = new Set(['', 'unknown', 'n.d', 'n.d.', '[n.d.]', 's.d.', 's.d', '[s.d.]', 'undated']);
const LIBRARY_NAME = /\b(bibliot|staatsbib|library|librar|museum|archiv|collection|sammlung)/i;

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const FRAME = ALL ? { pages_count: { $gt: 0 } } : { visible: true, pages_count: { $gt: 0 } };

const libraryAuthorIds = new Set((await db.collection('authors').find({}, { projection: { _id: 1, canonical_name: 1 } }).toArray())
  .filter((a) => LIBRARY_NAME.test(a.canonical_name || '')).map((a) => a._id));

const hits = Object.fromEntries(['language-vs-script', 'language-stamp-mismatch', 'original-language-on-original', 'translation-marker-on-original',
  'published-unknown-title-page-dated', 'year-outside-edition-window', 'display-title-junk', 'title-bracket-prefix', 'author-id-is-library'].map((k) => [k, []]));
let scanned = 0;
const cur = books.find(FRAME, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, author_id: 1, language: 1, original_language: 1,
  text_role: 1, published: 1, year: 1, 'book_class.script_family': 1, 'field_provenance.language': 1, 'source_work_dates_meta.edition': 1,
  'image_source.provider': 1 } }).batchSize(1000);
for await (const b of cur) {
  scanned++;
  const row = (extra) => ({ id: b.id, provider: b.image_source?.provider ?? null, title: String(b.title || '').slice(0, 90), ...extra });
  const fam = b.book_class?.script_family;
  const lang = typeof b.language === 'string' ? b.language.trim() : null;
  if (lang && fam) {
    if (LATIN_SCRIPT.has(lang) && NON_LATIN_FAMILIES.has(fam) && b.text_role === 'original') hits['language-vs-script'].push(row({ language: lang, script_family: fam, direction: 'latin-lang-on-nonlatin-script' }));
    else if (LANG_FAMILY[lang] && fam === 'latin' && LANG_FAMILY[lang] !== 'latin') hits['language-vs-script'].push(row({ language: lang, script_family: fam, direction: 'nonlatin-lang-on-latin-script' }));
  }
  const stamp = b.field_provenance?.language;
  if (stamp && typeof stamp.value === 'string' && lang && stamp.value.trim() !== lang) hits['language-stamp-mismatch'].push(row({ language: lang, stamp_value: stamp.value, stamp_source: stamp.source ?? null, stamp_date: stamp.date ?? null }));
  if (b.text_role === 'original' && typeof b.original_language === 'string' && b.original_language.trim() && lang && b.original_language.trim() !== lang && !/[-,&]| and /.test(lang)) hits['original-language-on-original'].push(row({ language: lang, original_language: b.original_language }));
  if (b.text_role === 'original' && TRANSLATION_MARKER.test(String(b.title || ''))) hits['translation-marker-on-original'].push(row({ language: lang, original_language: b.original_language ?? null, marker: String(b.title).match(TRANSLATION_MARKER)[0] }));
  const ed = b.source_work_dates_meta?.edition;
  const pub = b.published == null ? '' : String(b.published).trim().toLowerCase();
  if (UNKNOWN_PUBLISHED.has(pub) && ed && ['title_page', 'colophon'].includes(ed.basis) && typeof ed.year === 'number' && ed.evidence) hits['published-unknown-title-page-dated'].push(row({ published: b.published ?? null, year: b.year ?? null, edition_year: ed.year, edition_display: ed.display, basis: ed.basis, evidence: String(ed.evidence).slice(0, 120) }));
  if (typeof b.year === 'number' && ed && typeof ed.from === 'number' && typeof ed.to === 'number' && (b.year < ed.from - 1 || b.year > ed.to + 1)) hits['year-outside-edition-window'].push(row({ year: b.year, published: b.published ?? null, edition_from: ed.from, edition_to: ed.to, basis: ed.basis }));
  if (typeof b.display_title === 'string' && (/\n/.test(b.display_title) || b.display_title !== b.display_title.trim() || /(\.\.\.|…)\s*$/.test(b.display_title))) hits['display-title-junk'].push(row({ display_title: b.display_title.slice(0, 120), newline: /\n/.test(b.display_title), truncated: /(\.\.\.|…)\s*$/.test(b.display_title) }));
  if (/^\s*\[[A-Z][a-z]+\]\s/.test(String(b.title || ''))) hits['title-bracket-prefix'].push(row({ prefix: String(b.title).match(/^\s*\[[^\]]+\]/)[0], language: lang }));
  if (b.author_id && libraryAuthorIds.has(b.author_id)) hits['author-id-is-library'].push(row({ author: b.author ?? null, author_id: b.author_id }));
}

mkdirSync(OUT, { recursive: true });
const tally = (arr, key) => Object.fromEntries(Object.entries(arr.reduce((m, r) => ((m[r[key] ?? 'null'] = (m[r[key] ?? 'null'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 12));
const summary = { frame: ALL ? 'pages_count > 0 (incl. hidden)' : 'live (visible && pages_count > 0)', scanned, run_at: new Date().toISOString(), classes: {} };
for (const [k, arr] of Object.entries(hits)) {
  writeFileSync(join(OUT, `${k}.jsonl`), arr.map((r) => JSON.stringify(r)).join('\n') + (arr.length ? '\n' : ''));
  summary.classes[k] = { n: arr.length, by_provider: tally(arr, 'provider') };
}
summary.classes['language-vs-script'].by_direction = tally(hits['language-vs-script'], 'direction');
summary.classes['language-stamp-mismatch'].by_stamp_source = tally(hits['language-stamp-mismatch'], 'stamp_source');
summary.classes['year-outside-edition-window'].by_year = tally(hits['year-outside-edition-window'], 'year');
summary.classes['author-id-is-library'].by_author_id = tally(hits['author-id-is-library'], 'author_id');
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`scanned ${scanned} · report ${OUT}`);
for (const [k, v] of Object.entries(summary.classes)) console.log(String(v.n).padStart(6), k);
await client.close();
