#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/adjudicate-corrections.mjs (#6679) scores the SECOND READER on a
// planted decoy and stores per-edit accept/reject verdicts on each proposal; nothing scores the
// VOLUNTEER's setup on a known error. scripts/audit/ has no volunteer-review reader (looked: ls
// scripts/audit | grep -i -E "volunteer|review|shift").
//
// book-run-plant-catch — how well does each volunteer setup find a known error? (#6682, #6418)
//
// About one page in ten of a book run carries one planted error in its English (src/lib/review-plants.ts,
// recorded in Mongo `review_plants`). For each volunteer × reported model this prints:
//   - plants served, plants reviewed, and of those CAUGHT: a translation finding or a control fix
//     names the planted word (it occurs nowhere else on the page, so a quote of it is about the plant);
//   - verdicts on test pages that said both_sound (a miss by verdict as well as by finding);
//   - the second reader's decisions on that setup's REAL proposals (accept / reject / leave), the
//     false-alarm side, until a confirmed-clean page set exists.
// Rows are joined by hash as well as by `control_plant_id`, so a review the submit route failed to
// tag still counts.
//
// Read-only. Usage:
//   node --env-file=.env.production.local scripts/audit/book-run-plant-catch.mjs [--json]

import { createClient } from '@supabase/supabase-js';
import { withMongo } from '../lib/mongo.mjs';

const JSON_OUT = process.argv.includes('--json');
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function bookRunRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    // supabase-js caps every response at 1,000 rows: page through.
    const { data, error } = await sb.from('volunteer_ratings')
      .select('item_id, rating, volunteer_id, detail, created_at')
      .eq('queue', 'book-run').order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`volunteer_ratings: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// Whole word, so a planted "13" is not found inside "130".
const names = (text, word) => typeof text === 'string'
  && new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text);

await withMongo(async (db) => {
  const [plants, controls, real, rows] = await Promise.all([
    db.collection('review_plants').find({}).toArray(),
    db.collection('page_corrections').find({ status: 'control' }).toArray(),
    db.collection('page_corrections').find({ 'adjudication.decisions': { $exists: true } },
      { projection: { volunteer_id: 1, assistant_model: 1, 'adjudication.decisions': 1 } }).toArray(),
    bookRunRows(),
  ]);

  const modelOf = new Map(); // volunteer → model last reported in a book-run row
  for (const r of rows) modelOf.set(r.volunteer_id, r.detail?.assistant_model ?? 'unreported');
  const setups = new Map();
  const setup = (volunteer, model) => {
    const key = `${volunteer}\u0000${model}`;
    if (!setups.has(key)) setups.set(key, { volunteer, model, served: 0, reviewed: 0, caught: 0, sound_verdict: 0, fixes_on_plant: 0, real_edits: { accept: 0, reject: 0, leave: 0 }, misses: [] });
    return setups.get(key);
  };

  for (const p of plants) {
    const reviews = rows.filter((r) => r.volunteer_id === p.volunteer_id
      && (r.detail?.control_plant_id === p.id || (r.item_id.endsWith(`:${p.page_id}`) && r.detail?.text_version?.translation === p.planted_hash)));
    const fixes = controls.filter((c) => c.control_plant_id === p.id && c.volunteer_id === p.volunteer_id);
    const model = reviews.at(-1)?.detail?.assistant_model ?? modelOf.get(p.volunteer_id) ?? 'unreported';
    const s = setup(p.volunteer_id, model);
    s.served++;
    if (!reviews.length && !fixes.length) continue;
    s.reviewed++;
    const byFinding = reviews.some((r) => (r.detail?.assistant_findings ?? [])
      .some((f) => names(f.quote, p.planted) || names(f.problem, p.planted)) || names(r.note, p.planted));
    const byFix = fixes.some((c) => (c.edits ?? []).some((e) => names(e.find, p.planted)));
    if (fixes.length) s.fixes_on_plant++;
    if (reviews.some((r) => r.rating === 'both_sound')) s.sound_verdict++;
    if (byFinding || byFix) s.caught++;
    else s.misses.push({ page_id: p.page_id, kind: p.kind, original: p.original, planted: p.planted });
  }

  for (const c of real) {
    const s = setup(c.volunteer_id, c.assistant_model ?? 'unreported');
    for (const d of c.adjudication.decisions ?? []) if (d.decision in s.real_edits) s.real_edits[d.decision]++;
  }

  const out = [...setups.values()].sort((a, b) => b.served - a.served);
  if (JSON_OUT) { console.log(JSON.stringify({ plants: plants.length, setups: out }, null, 2)); return; }
  console.log(`book-run plants: ${plants.length} served across ${new Set(plants.map((p) => p.volunteer_id)).size} volunteer(s)`);
  for (const s of out) {
    const rate = s.reviewed ? `${s.caught}/${s.reviewed} caught` : 'none reviewed';
    const e = s.real_edits;
    console.log(`\n${s.volunteer.slice(0, 8)} · ${s.model}`);
    console.log(`  plants: ${s.served} served, ${rate}; ${s.sound_verdict} test page(s) called both_sound; ${s.fixes_on_plant} with a fix`);
    console.log(`  real proposals, second reader: ${e.accept} accepted, ${e.reject} rejected, ${e.leave} left`);
    for (const m of s.misses.slice(0, 5)) console.log(`  missed: ${m.kind} ${m.original} → ${m.planted} (page ${m.page_id})`);
  }
});
