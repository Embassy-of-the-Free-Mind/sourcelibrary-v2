#!/usr/bin/env node
/**
 * Count what a dating run (#6721) wrote, as it stands in `books` now: by work basis, edition basis (+ the rule that
 * fired), confidence, flags, second-family agreement, and the #3307 placeholder notes. Read-only; prints markdown.
 *
 * PRIOR ART: verify-written.mjs (same directory) asserts the shape of a sample; this counts the whole run.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/report-counts.mjs <run_id>
 */
import { MongoClient } from 'mongodb';

const RUN = process.argv[2];
if (!RUN) { console.error('usage: report-counts.mjs <run_id>'); process.exit(2); }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const books = c.db(process.env.MONGODB_DB || 'bookstore').collection('books');
const match = { 'source_work_dates_meta.run_id': RUN };
const group = async (key) => (await books.aggregate([{ $match: match }, { $group: { _id: key, n: { $sum: 1 } } }, { $sort: { n: -1 } }], { maxTimeMS: 600_000 }).toArray());
const table = (title, rows, head) => `\n**${title}**\n\n| ${head} | books |\n|---|---:|\n${rows.map((r) => `| ${typeof r._id === 'object' && r._id ? Object.values(r._id).map((v) => v ?? '—').join(' · ') : r._id ?? '—'} | ${r.n.toLocaleString('en-US')} |`).join('\n')}`;

const total = await books.countDocuments(match, { maxTimeMS: 600_000 });
const visible = await books.countDocuments({ ...match, visible: true }, { maxTimeMS: 600_000 });
const out = [`### Run \`${RUN}\`: ${total.toLocaleString('en-US')} books written (${visible.toLocaleString('en-US')} visible)`];
out.push(table('Work date: basis × confidence', await group({ basis: '$source_work_dates_meta.work.basis', confidence: '$source_work_dates_meta.confidence' }), 'basis · confidence'));
out.push(table('Work date: own call or inherited from the work\'s representative', await group({ $cond: [{ $ifNull: ['$source_work_dates_meta.work.from_book', false] }, 'inherited', 'own call'] }), 'source'));
out.push(table('Edition date: basis · rule', await group({ basis: '$source_work_dates_meta.edition.basis', rule: { $ifNull: ['$source_work_dates_meta.edition.rule', 'model'] } }), 'basis · rule'));
out.push(table('Confidence', await group('$source_work_dates_meta.confidence'), 'confidence'));
out.push(table('Model (family)', await group({ model: '$source_work_dates_meta.model', family: '$source_work_dates_meta.family' }), 'model · family'));
out.push(table('Second-family check', await group({ $ifNull: ['$source_work_dates_meta.agree_with.agrees', 'not checked'] }), 'agrees'));
// every flag a row carries (a row can carry several: wikidata_disagrees + outside_author_window)
const flags = await books.aggregate([{ $match: match }, { $project: { c: { $ifNull: ['$source_work_dates_meta.checks', ['none']] } } }, { $unwind: '$c' },
  { $group: { _id: '$c', n: { $sum: 1 } } }, { $sort: { n: -1 } }], { maxTimeMS: 600_000 }).toArray();
out.push(table('Flags (each flag a row carries)', flags, 'check'));
out.push(table('Rows an earlier run wrote, rewritten by this one (lean route)', await group({ $ifNull: ['$source_work_dates_meta.rewrote.reason', 'not a rewrite'] }), 'reason'));
const notes = await books.countDocuments({ ...match, 'source_work_dates_meta.catalogue_note': { $nin: ['', null] } }, { maxTimeMS: 600_000 });
const ph = await books.countDocuments({ ...match, 'source_work_dates_meta.catalogue_note': /#3307/ }, { maxTimeMS: 600_000 });
const phAll = await books.countDocuments({ year: 1700, language: /tibet/i, pages_count: { $gt: 0 } }, { maxTimeMS: 600_000 });
out.push(`\n**Catalogue notes:** ${notes.toLocaleString('en-US')} books carry one. **#3307:** ${ph.toLocaleString('en-US')} of the ${phAll.toLocaleString('en-US')} Tibetan books with \`year: 1700\` now say in \`catalogue_note\` that it is an import placeholder.`);
await c.close();
console.log(out.join('\n'));
