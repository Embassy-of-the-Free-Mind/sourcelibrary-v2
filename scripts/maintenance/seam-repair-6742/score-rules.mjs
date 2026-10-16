#!/usr/bin/env node
// PRIOR ART: seam-repair.mjs `report` (#6756) scores the Opus arms from the pilot's own files; this scores the
// model-free rules.mjs against those Opus labels and repairs. The pilot's committed candidates carry no excerpts, so
// `rebuild` re-reads them (Mongo reads only): the current text where its hash still matches the pilot's read, else
// the page_revisions pre-image with that hash.
/**
 * score-rules — Test A of the lean seam runner (#6742): rule repairs vs Opus on the pilot's 500 tranche joins. $0.
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/maintenance/seam-repair-6742/score-rules.mjs
 *   $N $S rebuild --out=DIR          DIR/pilot500.jsonl: the 500 joins with excerpts and the two stored pages
 *   node $S score --out=DIR          DIR/rules-vs-opus.json (+ rules-vs-opus.jsonl, one row per join × signal)
 *
 * Equivalent = the same join after whitespace / punctuation normalisation of N's tail + N+1's head (case folded);
 * "same side" additionally requires each page's text to match on its own. Trusted: equivalent ≥ 95% of the rule's
 * edits where Opus repaired, and edits on Opus-"ok" joins ≤ 2% of the rule's edits.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { MongoClient } from 'mongodb';
import { sha, edgeRefusal } from './seam-repair.mjs';
import { RULES } from './rules.mjs';
import { applyRepair } from '../../eval/seams-6742/judge-repairs.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { wilson } from '../../eval/lib/agreement-stats.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const PILOT = path.join(path.dirname(new URL(import.meta.url).pathname), '../../eval/results/seam-repair-6742');
const EDGE = 1500;
const tail = (t) => t.length > EDGE ? '…' + t.slice(-EDGE) : t;
const head = (t) => t.length > EDGE ? t.slice(0, EDGE) + '…' : t;

async function rebuild(out) {
  const cands = gz(path.join(PILOT, 'candidates.jsonl.gz')).filter(r => r.join);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const rows = [], how = {};
  for (const it of cands) {
    const pages = await db.collection('pages').find({ id: { $in: [it.idA, it.idB] } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const textAt = async (pid, h) => {
      const r = pages.find(x => x.id === pid);
      if (r && sha(r.translation?.data) === h) return { tr: r.translation.data, ocr: r.ocr?.data || '', how: 'current' };
      const m = (await db.collection('page_revisions').find({ page_id: pid, field: 'translation' }, { projection: { data: 1, reason: 1 } }).toArray()).find(v => sha(v.data) === h);
      return m ? { tr: m.data, ocr: r?.ocr?.data || '', how: `rev:${m.reason}` } : null;
    };
    const a = await textAt(it.idA, it.hashA), b = await textAt(it.idB, it.hashB);
    const k = `${a?.how || 'missing'}|${b?.how || 'missing'}`; how[k] = (how[k] || 0) + 1;
    if (!a || !b) continue;
    rows.push({ ...it, srcTailA: tail(sourceProse(a.ocr)), srcHeadB: head(sourceProse(b.ocr)), enTailA: tail(translationProse(a.tr)), enHeadB: head(translationProse(b.tr)), rawA: a.tr, rawB: b.tr, ocrA: a.ocr, ocrB: b.ocr });
  }
  await c.close();
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'pilot500.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({ joins: rows.length, how }));
}

export const joinKey = (v) => (v.enTailA + ' ' + v.enHeadB).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const sideKey = (t) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function score(out) {
  const items = fs.readFileSync(path.join(out, 'pilot500.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const opus = new Map(gz(path.join(PILOT, 'repair-opus.jsonl.gz')).map(r => [r.id, r]));
  const written = new Set(gz(path.join(PILOT, 'manifest.jsonl.gz')).filter(m => m.written).map(m => m.join));
  const rowsOut = [], rep = {};
  for (const [signal, rule] of Object.entries(RULES)) {
    const s = rep[signal] = { joins: 0, ruleEdits: 0, declined: {}, placementRefused: {}, onOpusOk: 0, onOpusDefectNoRepair: 0, vsOpusRepair: { n: 0, exact: 0, equivalent: 0, sameSide: 0 },
      vsWritten: { n: 0, equivalent: 0, ruleDeclined: 0 }, opusRepairedButRuleDeclined: 0 };
    for (const it of items) {
      if (!it.fired.includes(signal)) continue;
      s.joins++;
      const o = opus.get(it.id);
      const oFix = o?.label && o.label !== 'ok' ? applyRepair(it, o.repair) : null;
      const r = rule(it);
      const row = { id: it.id, signal, opusLabel: o?.label ?? null, written: written.has(it.id), decline: r.decline || null };
      if (!r.decline) { const why = edgeRefusal(it, r.repair); if (why) { r.decline = `placement:${why}`; row.decline = r.decline; s.placementRefused[why] = (s.placementRefused[why] || 0) + 1; } }
      if (r.decline) {
        if (!r.decline.startsWith('placement:')) s.declined[r.decline] = (s.declined[r.decline] || 0) + 1;
        if (oFix) s.opusRepairedButRuleDeclined++;
        if (written.has(it.id)) { s.vsWritten.n++; s.vsWritten.ruleDeclined++; }
        rowsOut.push(row); continue;
      }
      s.ruleEdits++;
      const fixed = applyRepair(it, r.repair);
      Object.assign(row, { repair: r.repair, cause: r.cause || r.side, ruleTail: fixed.enTailA.slice(-200), ruleHead: fixed.enHeadB.slice(0, 200) });
      if (o?.label === 'ok') { s.onOpusOk++; row.verdict = 'edit-on-opus-ok'; }
      else if (!oFix) { s.onOpusDefectNoRepair++; row.verdict = 'opus-defect-no-repair'; }
      else {
        const eq = joinKey(fixed) === joinKey(oFix), exact = fixed.enTailA.trimEnd() === oFix.enTailA.trimEnd() && fixed.enHeadB.trimStart() === oFix.enHeadB.trimStart();
        const same = sideKey(fixed.enTailA) === sideKey(oFix.enTailA) && sideKey(fixed.enHeadB) === sideKey(oFix.enHeadB);
        s.vsOpusRepair.n++; s.vsOpusRepair.equivalent += eq; s.vsOpusRepair.exact += exact; s.vsOpusRepair.sameSide += same;
        if (written.has(it.id)) { s.vsWritten.n++; s.vsWritten.equivalent += eq; }
        // Where they differ: does Opus change words beyond the doubled ones (a reorder, a retranslation)?
        const bag = (v) => (v.enTailA + ' ' + v.enHeadB).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        const diff = (a, b) => { const m = new Map(); for (const w of b) m.set(w, (m.get(w) || 0) + 1); let n = 0; for (const w of a) { if (m.get(w)) m.set(w, m.get(w) - 1); else n++; } return n; };
        const opusBeyondRule = eq ? 0 : diff(bag(oFix), bag(fixed));
        if (!eq) { s.differs ||= { opusAddsOrRewordsWords: 0, sameWordsDifferentCut: 0 }; s.differs[opusBeyondRule ? 'opusAddsOrRewordsWords' : 'sameWordsDifferentCut']++; }
        Object.assign(row, { verdict: eq ? 'equivalent' : 'differs', exact, sameSide: same, opusBeyondRule, opusRepair: o.repair, opusTail: oFix.enTailA.slice(-200), opusHead: oFix.enHeadB.slice(0, 200) });
      }
      rowsOut.push(row);
    }
    const v = s.vsOpusRepair;
    s.precisionVsOpus = v.n ? +(v.equivalent / v.n).toFixed(3) : null;
    s.precisionCI95 = v.n ? wilson(v.equivalent, v.n).map(x => +x.toFixed(3)) : null;
    s.okEditRate = s.ruleEdits ? +(s.onOpusOk / s.ruleEdits).toFixed(3) : null;
    s.trusted = s.precisionVsOpus != null && s.precisionVsOpus >= 0.95 && s.okEditRate <= 0.02;
  }
  fs.writeFileSync(path.join(out, 'rules-vs-opus.json'), JSON.stringify(rep, null, 1) + '\n');
  fs.writeFileSync(path.join(out, 'rules-vs-opus.jsonl'), rowsOut.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify(rep, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  if (cmd === 'rebuild') rebuild(out).catch(e => { console.error(e); process.exit(1); });
  else if (cmd === 'score') score(out);
  else { console.error('usage: rebuild|score --out=DIR'); process.exit(2); }
}
