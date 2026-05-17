#!/usr/bin/env node
/**
 * USTC linkage coverage report for Source Library.
 *
 * Counts books with ustc_id, broken down by:
 *   - year decade
 *   - language
 *   - confidence band
 *   - match method (supabase_reconciliation | word_overlap | ai_tool_calling)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/ustc-link-report.mjs
 *   set -a; source .env.production.local; set +a; node scripts/ustc-link-report.mjs --md      # write markdown to .claude/docs/
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_MD = join(ROOT, '.claude/docs/ustc-link-coverage.md');

const WRITE_MD = process.argv.includes('--md');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const baseQuery = { visible: { $ne: false }, resource_type: { $ne: 'artwork' } };

  const total = await books.countDocuments(baseQuery);
  const withUstc = await books.countDocuments({ ...baseQuery, ustc_id: { $exists: true, $ne: null } });
  const pre1830 = await books.countDocuments({ ...baseQuery, year: { $gte: 1450, $lte: 1830 } });
  const pre1830WithUstc = await books.countDocuments({ ...baseQuery, year: { $gte: 1450, $lte: 1830 }, ustc_id: { $exists: true, $ne: null } });

  console.log(`USTC linkage coverage (excluding artwork records)`);
  console.log(`  Total books          : ${total}`);
  console.log(`  With ustc_id         : ${withUstc} (${(withUstc / total * 100).toFixed(1)}%)`);
  console.log(`  Pre-1830 books       : ${pre1830}`);
  console.log(`  Pre-1830 with ustc_id: ${pre1830WithUstc} (${(pre1830WithUstc / pre1830 * 100).toFixed(1)}%)`);
  console.log();

  // By decade — use $type to check for actual present numeric ustc_id (missing fields evaluate inconsistently with $ne+null)
  const decadeAgg = await books.aggregate([
    { $match: { ...baseQuery, year: { $gte: 1450, $lte: 1850 } } },
    { $project: { decade: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] }, hasUstc: { $cond: [{ $gt: [{ $ifNull: ['$ustc_id', 0] }, 0] }, 1, 0] } } },
    { $group: { _id: '$decade', total: { $sum: 1 }, with_ustc: { $sum: '$hasUstc' } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  console.log(`By decade:`);
  console.log(`  Decade  Total  USTC  %`);
  for (const d of decadeAgg) {
    const pct = (d.with_ustc / d.total * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(d.with_ustc / d.total * 20));
    console.log(`  ${d._id}s   ${d.total.toString().padStart(5)}  ${d.with_ustc.toString().padStart(4)}  ${pct.padStart(3)}%  ${bar}`);
  }
  console.log();

  // By match method
  const methodAgg = await books.aggregate([
    { $match: { ...baseQuery, 'ustc_match.match_method': { $exists: true } } },
    { $group: { _id: '$ustc_match.match_method', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();

  console.log(`By match method:`);
  for (const m of methodAgg) console.log(`  ${(m._id || '(none)').padEnd(28)} ${m.n}`);
  console.log();

  // By confidence
  const confAgg = await books.aggregate([
    { $match: { ...baseQuery, 'ustc_match.confidence': { $exists: true } } },
    { $group: { _id: '$ustc_match.confidence', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();

  console.log(`By confidence:`);
  for (const c of confAgg) console.log(`  ${(c._id || '(none)').padEnd(10)} ${c.n}`);
  console.log();

  // By language
  const langAgg = await books.aggregate([
    { $match: { ...baseQuery, ustc_id: { $exists: true, $ne: null } } },
    { $group: { _id: '$language', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 12 },
  ]).toArray();

  console.log(`Top languages (with ustc_id):`);
  for (const l of langAgg) console.log(`  ${(l._id || '(unknown)').padEnd(20)} ${l.n}`);
  console.log();

  // Banned books specifically
  const bannedTotal = await books.countDocuments({ collections: 'index-librorum-prohibitorum' });
  const bannedWithUstc = await books.countDocuments({ collections: 'index-librorum-prohibitorum', ustc_id: { $exists: true, $ne: null } });
  console.log(`Index Librorum Prohibitorum collection: ${bannedWithUstc}/${bannedTotal} have ustc_id (${(bannedWithUstc / bannedTotal * 100).toFixed(1)}%)`);

  if (WRITE_MD) {
    let md = `# USTC Linkage Coverage\n\n_Generated ${new Date().toISOString()}_\n\n`;
    md += `## Overall\n\n`;
    md += `| Metric | Value |\n|---|---|\n`;
    md += `| Total live books (ex artwork) | ${total} |\n`;
    md += `| With \`ustc_id\` | ${withUstc} (${(withUstc / total * 100).toFixed(1)}%) |\n`;
    md += `| Pre-1830 in scope | ${pre1830} |\n`;
    md += `| Pre-1830 with \`ustc_id\` | ${pre1830WithUstc} (${(pre1830WithUstc / pre1830 * 100).toFixed(1)}%) |\n`;
    md += `| Index Librorum Prohibitorum books linked | ${bannedWithUstc}/${bannedTotal} (${(bannedWithUstc / bannedTotal * 100).toFixed(1)}%) |\n\n`;

    md += `## By Decade\n\n`;
    md += `| Decade | Total | With USTC | % |\n|---|---:|---:|---:|\n`;
    for (const d of decadeAgg) {
      md += `| ${d._id}s | ${d.total} | ${d.with_ustc} | ${(d.with_ustc / d.total * 100).toFixed(0)}% |\n`;
    }

    md += `\n## By Match Method\n\n`;
    md += `| Method | Books |\n|---|---:|\n`;
    for (const m of methodAgg) md += `| ${m._id || '(none)'} | ${m.n} |\n`;

    md += `\n## By Confidence\n\n`;
    md += `| Confidence | Books |\n|---|---:|\n`;
    for (const c of confAgg) md += `| ${c._id} | ${c.n} |\n`;

    md += `\n## Top Languages\n\n`;
    md += `| Language | Books with USTC ID |\n|---|---:|\n`;
    for (const l of langAgg) md += `| ${l._id || '(unknown)'} | ${l.n} |\n`;

    writeFileSync(REPORT_MD, md);
    console.log(`\nWrote: ${REPORT_MD}`);
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
