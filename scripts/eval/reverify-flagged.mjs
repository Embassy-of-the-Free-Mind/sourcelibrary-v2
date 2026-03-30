#!/usr/bin/env npx tsx
/**
 * Re-verify the 77 flagged cases from the catalog cross-check
 * using the new 7-tool pipeline. Compare old vs new dispositions.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/reverify-flagged.mjs
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
let verifyFirstTranslation;
try {
  const mod = await import('../../src/lib/verify-first-translation.ts');
  verifyFirstTranslation = mod.verifyFirstTranslation;
} catch (err) {
  console.error('Cannot import. Run with: npx tsx scripts/eval/reverify-flagged.mjs');
  console.error(err.message);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'ft-crosscheck-report.json');
const RESULTS_PATH = path.join(__dirname, 'ft-reverify-results.json');

// Env loading
for (const file of ['.env.production.local', '.env.local']) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
      }
    }
    break;
  } catch { /* next */ }
}

async function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error('No crosscheck report found. Run ft-catalog-crosscheck.mjs first.');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const flagged = report.potential_false_positives;

  console.log(`\nRe-verifying ${flagged.length} flagged cases with the new 7-tool pipeline\n`);

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  const results = [];
  let changed = 0;
  let totalCost = 0;
  const startTime = Date.now();

  for (let i = 0; i < flagged.length; i++) {
    const fp = flagged[i];
    process.stdout.write(`[${i + 1}/${flagged.length}] ${fp.author?.slice(0, 22).padEnd(24)} ${fp.title?.slice(0, 42).padEnd(44)}`);

    try {
      const result = await verifyFirstTranslation(db, fp.book_id, { dryRun: false, force: true });

      if (!result.success) {
        console.log(` ERROR: ${result.error}`);
        results.push({ ...fp, new_disposition: null, error: result.error });
        continue;
      }

      const v = result.verification;
      totalCost += v.cost_usd || 0;
      const oldDisp = fp.disposition;
      const newDisp = v.disposition;
      const dispositionChanged = oldDisp !== newDisp;
      const isFirstChanged = fp.confidence !== undefined &&
        result.is_first_translation !== ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(oldDisp);

      if (dispositionChanged) changed++;

      const arrow = dispositionChanged ? ' >>>' : '  ==';
      const icon = dispositionChanged ? ' CHANGED' : '    same';
      console.log(`${icon} ${oldDisp.padEnd(28)} ${arrow} ${newDisp} (${v.tools_called.length} tools, $${(v.cost_usd || 0).toFixed(4)})`);

      results.push({
        book_id: fp.book_id,
        author: fp.author,
        title: fp.title,
        language: fp.language,
        catalog_match: fp.best_catalog_match,
        title_similarity: fp.title_similarity,
        old_disposition: oldDisp,
        old_confidence: fp.confidence,
        old_tools: fp.tools_called,
        new_disposition: newDisp,
        new_confidence: v.confidence,
        new_is_first: result.is_first_translation,
        new_tools: v.tools_called,
        new_tools_count: v.tools_called.length,
        new_reasoning: v.reasoning,
        new_translations_found: v.translations_found,
        new_cost: v.cost_usd || 0,
        disposition_changed: dispositionChanged,
      });
    } catch (err) {
      console.log(` CRASH: ${err.message}`);
      results.push({ ...fp, new_disposition: null, error: err.message });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('RE-VERIFICATION RESULTS');
  console.log('='.repeat(70));
  console.log(`Cases:    ${results.length}`);
  console.log(`Changed:  ${changed} (${(changed / results.length * 100).toFixed(1)}%)`);
  console.log(`Cost:     $${totalCost.toFixed(4)}`);
  console.log(`Time:     ${elapsed}s`);
  console.log('');

  // New tool usage
  const toolCounts = {};
  for (const r of results.filter(r => r.new_tools)) {
    for (const t of r.new_tools) {
      toolCounts[t] = (toolCounts[t] || 0) + 1;
    }
  }
  console.log('Tool usage:');
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool}: ${count} (${(count / results.length * 100).toFixed(0)}%)`);
  }
  console.log('');

  // Disposition changes
  const changedResults = results.filter(r => r.disposition_changed);
  if (changedResults.length > 0) {
    console.log('DISPOSITION CHANGES:');
    console.log('-'.repeat(70));
    for (const r of changedResults) {
      console.log(`\n  ${r.author} — ${r.title?.slice(0, 55)}`);
      console.log(`    ${r.old_disposition} → ${r.new_disposition} (${r.new_confidence})`);
      console.log(`    Old tools: ${r.old_tools} | New tools: ${r.new_tools_count} (${r.new_tools.join(', ')})`);
      console.log(`    Reasoning: ${r.new_reasoning?.slice(0, 200)}`);
      if (r.new_translations_found?.length > 0) {
        for (const t of r.new_translations_found.slice(0, 2)) {
          console.log(`    Found: "${t.english_title}" (${t.evidence_source})`);
        }
      }
      const cm = r.catalog_match;
      if (cm) {
        console.log(`    Catalog had: "${cm.english_title}" by ${cm.translator || '?'} (${cm.year}) [${cm.source}]`);
      }
    }
  }

  // Breakdown
  const noChange = results.filter(r => !r.disposition_changed && r.new_disposition);
  const becameNotFirst = changedResults.filter(r =>
    !['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(r.new_disposition)
  );
  const stayedFirst = results.filter(r => r.new_disposition &&
    ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(r.new_disposition)
  );

  console.log(`\n\nSummary:`);
  console.log(`  Still "first" (any flavor):    ${stayedFirst.length}`);
  console.log(`  Changed to "not first":        ${becameNotFirst.length} ← these are real corrections`);
  console.log(`  Disposition changed but still first: ${changedResults.length - becameNotFirst.length}`);
  console.log(`  No change:                     ${noChange.length}`);

  // Save
  fs.writeFileSync(RESULTS_PATH, JSON.stringify({
    metadata: {
      date: new Date().toISOString(),
      total: results.length,
      changed,
      cost_usd: totalCost,
      elapsed_seconds: parseFloat(elapsed),
    },
    summary: {
      still_first: stayedFirst.length,
      became_not_first: becameNotFirst.length,
      changed_within_first: changedResults.length - becameNotFirst.length,
      no_change: noChange.length,
    },
    tool_usage: toolCounts,
    changes: changedResults,
    all_results: results,
  }, null, 2) + '\n');

  console.log(`\nFull results saved to: ${RESULTS_PATH}`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
