#!/usr/bin/env node
/**
 * Dedupe MongoDB BPH books that share a numeric UBN.
 *
 * The problem
 * ────────────────────────────────────────────────────────────────────
 * 52 numeric BPH UBNs are referenced by 2 distinct MongoDB books each
 * (104 books, 52 "extras"). The sync cron PATCHes bph_works.sl_book_id
 * by UBN, so it can only link one of each pair — the other becomes a
 * permanent orphan in the catalogue list view. Most pairs are exact
 * duplicate imports (same title, year, page count, OCR coverage); a
 * few are different editions catalogued under one UBN at the BPH end.
 *
 * The fix
 * ────────────────────────────────────────────────────────────────────
 * For each UBN with multiple MongoDB books:
 *   1. Pick a canonical: prefer (more pages OCR'd) → (more translated)
 *      → (more pages overall) → (currently linked from bph_works).
 *   2. If the canonical isn't already linked, swap bph_works.sl_book_id
 *      to point to it (and update sl_book_slug).
 *   3. Mark the loser(s) with `visible: false` and a `dedupe` audit
 *      trail so the grid view stops showing the duplicate but the data
 *      stays recoverable.
 *
 * Skip rules
 * ────────────────────────────────────────────────────────────────────
 * Bail out on a set when:
 *   - The MongoDB books have very different titles (sign of a bad
 *     dc_identifier rather than a true duplicate — e.g. UBN "1" caught
 *     two unrelated books). Flagged for partner review.
 *   - Setting visible:false would remove the only OCR'd copy of a
 *     translation that the loser uniquely holds (loser has translated
 *     pages > canonical's translated pages by > 10%).
 *
 * Outputs
 *   .claude/docs/bph-dedupe-YYYY-MM-DD.json
 *   .claude/docs/bph-dedupe-YYYY-MM-DD.md
 *
 * Usage
 *   node scripts/dedupe-bph-shared-ubn.mjs --dry-run
 *   node scripts/dedupe-bph-shared-ubn.mjs --apply
 *
 * Idempotent: books already marked visible:false + dedupe.canonical_id
 * are skipped on re-run.
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const today = new Date().toISOString().slice(0, 10);
const REPORT_JSON = `.claude/docs/bph-dedupe-${today}.json`;
const REPORT_MD = `.claude/docs/bph-dedupe-${today}.md`;

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY || process.argv.includes('--dry-run');

function loadEnv() {
  const env = {};
  for (const filename of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(filename, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          if (!(m[1].trim() in env)) env[m[1].trim()] = v;
        }
      }
    } catch { /* file absent */ }
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('MONGODB_URI / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function extractUbn(dc) {
  if (typeof dc === 'string' && /^\d+$/.test(dc)) return dc;
  if (Array.isArray(dc)) for (const v of dc) if (typeof v === 'string' && /^\d+$/.test(v)) return v;
  return null;
}

function normaliseTitle(t) {
  return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function titleSimilar(a, b) {
  const na = normaliseTitle(a), nb = normaliseTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Cheap check: do the first 20 chars match? Catches truncated variants.
  const lead = Math.min(20, Math.min(na.length, nb.length));
  return na.slice(0, lead) === nb.slice(0, lead);
}

function pickCanonical(books, currentlyLinkedId) {
  // Score = OCR'd-pages > translated-pages > total-pages > already-linked.
  const score = (b) => {
    const ocr = b.pages_ocr || 0;
    const tr = b.pages_translated || 0;
    const total = b.pages_count || 0;
    const linkedBonus = b.id === currentlyLinkedId ? 1 : 0;
    return [ocr, tr, total, linkedBonus];
  };
  const sorted = [...books].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  });
  return sorted[0];
}

async function main() {
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}`);
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');
  const tenant = await db.collection('tenants').findOne({ slug: 'bph' });

  const all = await db.collection('books').find({
    tenantId: tenant.id, visible: true, pages_count: { $gt: 0 }, 'image_source.provider': 'bph',
  }, { projection: {
    id: 1, slug: 1, title: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    'dublin_core.dc_identifier': 1, 'dedupe': 1,
  }}).toArray();

  const byUbn = new Map();
  for (const b of all) {
    const ubn = extractUbn(b?.dublin_core?.dc_identifier);
    if (!ubn) continue;
    if (!byUbn.has(ubn)) byUbn.set(ubn, []);
    byUbn.get(ubn).push(b);
  }
  const dupeSets = [...byUbn.entries()].filter(([_, arr]) => arr.length > 1);
  console.log(`Dupe sets found: ${dupeSets.length}`);

  const results = [];
  for (const [ubn, dupes] of dupeSets) {
    const { data: row } = await supabase.from('bph_works').select('ubn, title, year, sl_book_id').eq('ubn', ubn).maybeSingle();
    const result = { ubn, books: dupes.map(d => ({ id: d.id, title: d.title, year: d.year, pages: d.pages_count, ocr: d.pages_ocr, tr: d.pages_translated })), bph_works: row };

    // Safeguard: if titles differ wildly, skip — likely bad dc_identifier.
    const titles = dupes.map(d => d.title || '');
    const allSimilar = titles.every(t => titleSimilar(t, titles[0]));
    if (!allSimilar) {
      result.action = 'flag_review';
      result.reason = 'titles differ — likely bad dc_identifier shared across unrelated books';
      results.push(result);
      continue;
    }

    const canonical = pickCanonical(dupes, row?.sl_book_id);
    const losers = dupes.filter(d => d.id !== canonical.id);
    result.canonical_id = canonical.id;
    result.loser_ids = losers.map(d => d.id);

    // Skip if all losers already marked deduped.
    if (losers.every(l => l.dedupe?.canonical_id)) {
      result.action = 'already_deduped';
      results.push(result);
      continue;
    }

    // Need to swap the bph_works link? Only if canonical isn't already linked.
    const needSwap = row?.sl_book_id !== canonical.id;
    result.action = needSwap ? 'swap_and_hide' : 'hide_loser';
    result.swap = needSwap ? { from: row?.sl_book_id, to: canonical.id } : null;

    if (!DRY) {
      // 1. Swap the bph_works link if needed.
      if (needSwap) {
        const { error: e1 } = await supabase
          .from('bph_works')
          .update({ sl_book_id: canonical.id, sl_book_slug: canonical.slug || canonical.id })
          .eq('ubn', ubn);
        if (e1) { result.error = `supabase swap failed: ${e1.message}`; results.push(result); continue; }
      }
      // 2. Mark losers visible:false with audit trail.
      const losersBulk = losers.map(l => ({
        updateOne: {
          filter: { id: l.id },
          update: { $set: {
            visible: false,
            dedupe: {
              canonical_id: canonical.id,
              canonical_slug: canonical.slug || canonical.id,
              ubn,
              reason: 'shared_numeric_ubn',
              hidden_at: new Date(),
            },
          } },
        },
      }));
      if (losersBulk.length > 0) {
        const r = await db.collection('books').bulkWrite(losersBulk);
        result.mongo_modified = r.modifiedCount;
      }
    }

    results.push(result);
  }

  // ── Reports ─────────────────────────────────────────────────────────
  fs.mkdirSync('.claude/docs', { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify({ run_at: new Date().toISOString(), mode: DRY ? 'dry-run' : 'apply', count: results.length, results }, null, 2));

  const tally = { hide_loser: 0, swap_and_hide: 0, flag_review: 0, already_deduped: 0, errors: 0 };
  for (const r of results) {
    if (r.error) tally.errors++;
    else tally[r.action] = (tally[r.action] || 0) + 1;
  }

  let md = `# BPH duplicate-UBN dedupe — ${today}\n\nMode: **${DRY ? 'dry-run' : 'apply'}**  •  Dupe sets: ${results.length}\n\n`;
  md += `| Bucket | Count |\n|---|---|\n`;
  md += `| 🟢 hide loser (canonical already linked) | ${tally.hide_loser} |\n`;
  md += `| 🔄 swap + hide (orphan had better OCR/translation) | ${tally.swap_and_hide} |\n`;
  md += `| ⚪ already deduped (re-run) | ${tally.already_deduped} |\n`;
  md += `| 🚩 flag for partner (bad dc_identifier) | ${tally.flag_review} |\n`;
  md += `| ❌ errors | ${tally.errors} |\n\n`;

  md += `## 🔄 Link swaps\n\n`;
  for (const r of results.filter(x => x.action === 'swap_and_hide')) {
    md += `- **UBN ${r.ubn}** "${(r.bph_works?.title || '').slice(0, 60)}"\n`;
    md += `  - was linked to: \`${r.swap.from}\`\n  - now linked to: \`${r.swap.to}\` (more OCR/translation)\n`;
  }
  md += `\n## 🚩 Flagged for partner review\n\n`;
  for (const r of results.filter(x => x.action === 'flag_review')) {
    md += `- **UBN ${r.ubn}** "${(r.bph_works?.title || '').slice(0, 60)}" — ${r.reason}\n`;
    for (const b of r.books) md += `  - \`${b.id}\` "${(b.title || '').slice(0, 70)}" (${b.year || '?'}, ${b.pages}p)\n`;
  }
  md += `\n## 🟢 Hidden losers (canonical already correct)\n\n`;
  for (const r of results.filter(x => x.action === 'hide_loser')) {
    md += `- UBN ${r.ubn} "${(r.bph_works?.title || '').slice(0, 60)}" → hid ${r.loser_ids.length} duplicate(s)\n`;
  }

  fs.writeFileSync(REPORT_MD, md);
  console.log(`\nReports:\n  ${REPORT_JSON}\n  ${REPORT_MD}`);
  console.log(`\nTally: ${JSON.stringify(tally)}`);

  await mongo.close();
}

main().catch(err => { console.error(err); process.exit(1); });
