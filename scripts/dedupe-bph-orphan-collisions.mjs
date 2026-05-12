#!/usr/bin/env node
/**
 * Dedupe Gemini-identified collision pairs from bph-orphan-match-*.json.
 *
 * Context
 * ────────────────────────────────────────────────────────────────────
 * The Gemini fuzzy matcher (scripts/match-bph-orphans-gemini.mjs) takes
 * MongoDB BPH books with no `dc_identifier` and predicts the UBN they
 * should match in `bph_works`. About half the time the predicted UBN is
 * already linked to a *different* MongoDB book — meaning we've imported
 * the same BPH work twice. The dedupe-bph-shared-ubn.mjs script can't
 * catch these because it groups by shared UBN, and the orphan has none.
 *
 * What this does
 * ────────────────────────────────────────────────────────────────────
 * For each conf≥THRESHOLD collision in the latest match report:
 *   1. Pull both MongoDB books (orphan + currently-linked canonical).
 *   2. Score each by (pages_translated → pages_ocr → pages_count). Higher
 *      wins; ties keep the currently-linked one as canonical.
 *   3. If orphan wins: swap bph_works.sl_book_id to the orphan, then
 *      mark the previous canonical `visible:false`.
 *      If current wins: just mark the orphan `visible:false`.
 *   4. Both losers carry a `dedupe` audit trail (canonical_id, reason,
 *      gemini_confidence, run_date) so the action is reversible and
 *      explorable.
 *
 * Safety
 * ────────────────────────────────────────────────────────────────────
 * - Default threshold: confidence ≥ 1.00 (only Gemini's perfect
 *   matches). Composite-volume cases like De Voluptate UBN 26106 land at
 *   0.95 and are excluded.
 * - Bail on the pair if the loser uniquely holds translated pages the
 *   winner doesn't have (>10% gap on translation count).
 * - Idempotent: books already marked `visible:false` with a `dedupe`
 *   stamp are skipped on re-run.
 *
 * Usage
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedupe-bph-orphan-collisions.mjs                  # dry-run
 *   node scripts/dedupe-bph-orphan-collisions.mjs --apply          # do it
 *   node scripts/dedupe-bph-orphan-collisions.mjs --apply --min 1  # same; --min sets confidence floor
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

const APPLY = process.argv.includes('--apply');
const MIN_IDX = process.argv.indexOf('--min');
const MIN_CONF = MIN_IDX >= 0 ? parseFloat(process.argv[MIN_IDX + 1]) : 1.0;

const today = new Date().toISOString().slice(0, 10);
const REPORT_IN = `.claude/docs/bph-orphan-match-${today}.json`;
const REPORT_OUT_JSON = `.claude/docs/bph-orphan-dedupe-${today}.json`;
const REPORT_OUT_MD = `.claude/docs/bph-orphan-dedupe-${today}.md`;

if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }
if (!fs.existsSync(REPORT_IN)) { console.error(`Match report not found: ${REPORT_IN}`); process.exit(1); }

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

function scoreBook(b) {
  // Higher score = better canonical. Translation > OCR > raw page count.
  return [b.pages_translated || 0, b.pages_ocr || 0, b.pages_count || 0];
}
function compareScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

async function patchBphWorks(ubn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(ubn)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function main() {
  const { results } = JSON.parse(fs.readFileSync(REPORT_IN, 'utf8'));

  const collisions = results.filter(r =>
    r.predicted_ubn &&
    r.confidence >= MIN_CONF &&
    r.matched_row?.already_linked &&
    r.matched_row.existing_sl_book_id &&
    r.matched_row.existing_sl_book_id !== r.orphan.id
  );

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Threshold: confidence ≥ ${MIN_CONF}`);
  console.log(`Eligible collisions: ${collisions.length}\n`);

  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const books = mongo.db('bookstore').collection('books');

  const actions = [];
  let bail = 0;

  for (const r of collisions) {
    const orphanId = r.orphan.id;
    const canonId = r.matched_row.existing_sl_book_id;
    const [orphan, canon] = await Promise.all([
      books.findOne({ id: orphanId }, { projection: { id: 1, slug: 1, title: 1, author: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1, dedupe: 1 } }),
      books.findOne({ id: canonId },  { projection: { id: 1, slug: 1, title: 1, author: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1, dedupe: 1 } }),
    ]);
    if (!orphan || !canon) {
      actions.push({ ubn: r.predicted_ubn, kind: 'error', reason: `book missing — orphan=${!!orphan} canon=${!!canon}` });
      continue;
    }
    if (orphan.visible === false && orphan.dedupe) {
      actions.push({ ubn: r.predicted_ubn, kind: 'already_deduped', orphan: orphanId, canon: canonId });
      continue;
    }

    const sO = scoreBook(orphan), sC = scoreBook(canon);
    const orphanWins = compareScore(sO, sC) > 0;

    // Safety: don't hide a copy that uniquely holds translated pages.
    const loser = orphanWins ? canon : orphan;
    const winner = orphanWins ? orphan : canon;
    const loserT = loser.pages_translated || 0;
    const winnerT = winner.pages_translated || 0;
    if (loserT > 0 && (loserT - winnerT) / Math.max(loserT, 1) > 0.10) {
      actions.push({
        ubn: r.predicted_ubn, kind: 'bail_translation_loss',
        orphan: { id: orphan.id, title: orphan.title, ocr: orphan.pages_ocr, trans: orphan.pages_translated, pages: orphan.pages_count },
        canon:  { id: canon.id,  title: canon.title,  ocr: canon.pages_ocr,  trans: canon.pages_translated,  pages: canon.pages_count },
        winner_id: winner.id, loser_id: loser.id,
      });
      bail++;
      continue;
    }

    actions.push({
      ubn: r.predicted_ubn,
      kind: orphanWins ? 'swap_and_hide' : 'hide_orphan',
      gemini_confidence: r.confidence,
      orphan: { id: orphan.id, slug: orphan.slug, title: orphan.title, ocr: orphan.pages_ocr || 0, trans: orphan.pages_translated || 0, pages: orphan.pages_count || 0 },
      canon:  { id: canon.id,  slug: canon.slug,  title: canon.title,  ocr: canon.pages_ocr || 0,  trans: canon.pages_translated || 0,  pages: canon.pages_count || 0 },
      winner_id: winner.id, loser_id: loser.id,
    });
  }

  const tally = actions.reduce((acc, a) => (acc[a.kind] = (acc[a.kind] || 0) + 1, acc), {});
  console.log('Plan tally:', tally);
  console.log('');

  if (APPLY) {
    for (const a of actions) {
      if (a.kind === 'swap_and_hide') {
        try {
          await patchBphWorks(a.ubn, { sl_book_id: a.orphan.id, sl_book_slug: a.orphan.slug || a.orphan.id });
          await books.updateOne(
            { id: a.loser_id },
            { $set: { visible: false, dedupe: { canonical_id: a.winner_id, reason: 'gemini_orphan_collision_swap', confidence: a.gemini_confidence, ubn: a.ubn, hidden_at: new Date().toISOString() } } },
          );
          console.log(`  swap+hide ubn=${a.ubn}  ${a.orphan.title?.slice(0, 50)}  (winner=${a.winner_id})`);
        } catch (e) {
          console.log(`  FAIL ubn=${a.ubn}: ${e.message}`);
        }
      } else if (a.kind === 'hide_orphan') {
        try {
          await books.updateOne(
            { id: a.loser_id },
            { $set: { visible: false, dedupe: { canonical_id: a.winner_id, reason: 'gemini_orphan_collision_hide', confidence: a.gemini_confidence, ubn: a.ubn, hidden_at: new Date().toISOString() } } },
          );
          console.log(`  hide ubn=${a.ubn}  ${a.orphan.title?.slice(0, 50)}  (canon kept=${a.winner_id})`);
        } catch (e) {
          console.log(`  FAIL ubn=${a.ubn}: ${e.message}`);
        }
      }
    }
  }

  // Reports
  fs.writeFileSync(REPORT_OUT_JSON, JSON.stringify({ generated_at: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', min_confidence: MIN_CONF, tally, actions }, null, 2));

  const md = [
    `# BPH Gemini-collision dedupe — ${today}`, '',
    `Mode: **${APPLY ? 'APPLY' : 'dry-run'}**  •  Confidence ≥ ${MIN_CONF}  •  Bailed: ${bail}`, '',
    '| Action | UBN | Orphan (id/title) | Canonical (id/title) | Loser | Reason |',
    '|---|---|---|---|---|---|',
    ...actions.map(a => {
      if (a.kind === 'error' || a.kind === 'already_deduped') {
        return `| ${a.kind} | ${a.ubn} | ${a.orphan || '-'} | ${a.canon || '-'} |  | ${a.reason || '-'} |`;
      }
      return `| ${a.kind} | ${a.ubn} | \`${a.orphan.id}\` ${(a.orphan.title || '').slice(0, 40)} (OCR ${a.orphan.ocr}, T ${a.orphan.trans}, P ${a.orphan.pages}) | \`${a.canon.id}\` ${(a.canon.title || '').slice(0, 40)} (OCR ${a.canon.ocr}, T ${a.canon.trans}, P ${a.canon.pages}) | \`${a.loser_id}\` | conf ${a.gemini_confidence} |`;
    }),
  ].join('\n');
  fs.writeFileSync(REPORT_OUT_MD, md);

  console.log(`\nReports:\n  ${REPORT_OUT_JSON}\n  ${REPORT_OUT_MD}`);
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
