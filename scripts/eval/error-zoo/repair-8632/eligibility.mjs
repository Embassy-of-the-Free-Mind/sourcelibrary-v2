#!/usr/bin/env node
/**
 * PRIOR ART: scripts/batch/cli-ocr-lane.mjs `correct` (its book frame and correctablePages, whose rules this reuses
 * through the lane's own exports, unchanged). The lane only says "queue empty"; this names the BOOK-level rules and the
 * page-window and script rules that keep a confirmed page of the #8632 queue out of the route's frame. It does not
 * repeat the lane's other page rules (model, stamp, edits, withholding, page type, length): a page it calls eligible
 * can still be dropped by those, and the lane's own dry run is the final word. Read-only.
 *
 *   node --env-file=… scripts/eval/error-zoo/repair-8632/eligibility.mjs --manifest=manifest.jsonl --out=eligibility.json
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { IDLE_STATUSES, CORRECT_LANGUAGES, isInterior, lastPageNumber, latinRereadSkip, loadLatinByEye, untaggedPagesAllowed, rereadTier } from '../../../batch/cli-ocr-lane.mjs';
import { HOLD_STATUS } from '../../../lib/pipeline-hold.mjs';
import { CLI_TRANSLATE_HOLD } from '../../../lib/translation-routing.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const man = fs.readFileSync(arg('manifest'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const BY_EYE = loadLatinByEye();
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const out = [];
for (const m of man) {
  const b = await db.collection('books').findOne({ id: m.book_id });
  const p = await db.collection('pages').findOne({ id: m.page_id }, { projection: { page_number: 1, page_type: 1, script_type: 1, 'ocr.data': 1, 'ocr.pipeline': 1 } });
  if (!b || !p) { out.push({ ...m, eligible: false, why: [!b ? 'book not found by id' : 'page not found'] }); continue; }
  const last = await lastPageNumber(db, m.book_id);
  const latin = m.cell.startsWith('latin');
  const why = [];
  if (!b.visible) why.push('book not visible');
  if (b.pipeline_auto?.held) why.push('book held (pipeline_auto.held)');
  const st = b.pipeline_auto?.status, hold = b.pipeline_auto?.hold?.reason;
  const idle = (IDLE_STATUSES.includes(st) && !b.pipeline_auto?.hold) || (st === HOLD_STATUS && hold === CLI_TRANSLATE_HOLD.reason);
  if (!idle) why.push(`pipeline ${st}${hold ? ` (hold: ${hold})` : ''}, not idle`);
  if (latin) { if (!/^Latin/.test(String(b.language))) why.push(`language ${b.language}`); const s = latinRereadSkip(b, BY_EYE); if (s) why.push(s); }
  else if (!CORRECT_LANGUAGES.test(String(b.language))) why.push(`language ${b.language}`);
  if (!isInterior(p.page_number, last)) why.push(`page ${p.page_number} of ${last}: outside the 15-95% window`);
  // The lane's script(): the tag, then the field; a non-printed field is 'other' and never read.
  const printed = /<script>\s*print/i.test(p.ocr?.data || ''), sc = printed || p.script_type === 'printed' ? 'print' : p.script_type ? 'other' : 'unknown';
  if (latin && sc === 'other') why.push(`script_type ${p.script_type}`);
  if (latin && sc === 'unknown' && !untaggedPagesAllowed(b, BY_EYE)) why.push('untagged page in an early book');
  out.push({ ...m, tier: latin ? rereadTier(b) : null, status: st ?? null, hold: hold ?? null, eligible: why.length === 0, why });
}
await c.close();
fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
const tally = {};
for (const r of out) for (const w of r.why.length ? r.why : ['ELIGIBLE']) { const k = `${r.cell}: ${w.replace(/page \d+ of \d+/, 'page')}`; tally[k] = (tally[k] || 0) + 1; }
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(3), k);
