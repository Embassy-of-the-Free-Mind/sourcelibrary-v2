// ROLLOUT, writes (#7119): the J-text pick (bestof.mjs -> picks.json) onto each leaf page.
//   - page whose OCR is the fresh read: the pick becomes the OCR (Malayalam rows as the reader wrote them, then the
//     mechanical IAST from mlym2iast.py), under the warning with the gate's measured value;
//   - edition-anchored page: the anchored text stays the OCR (Derek's standing default on #7119); the <note> with the
//     fresh read is replaced by the pick, and the warning's sentence about the note gets the gate's value.
// Every write goes through writePageText (the previous text becomes a page revision); every page in plan.json ends in
// a write or a recorded skip. Pages whose OCR body changed are listed for an Opus retranslation (translate/*.json).
//   node --env-file=/root/sourcelibrary/.env.production.local apply.mjs [--apply] [--only=A|B]
// PRIOR ART: ../whish147-best-attempt-2026-10-22/apply-fresh.mjs — same page shapes, same writer; it applied ONE read
// per leaf with the 0.37 single-read figure. Its FRESH_WARNING / NOTE_SENTENCE / FRESH_TR_WARNING are the shapes kept.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { writePageText } from '../../../lib/page-text-writer.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';
import { CANDS } from './bestof.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH;
const PY = process.env.VENV_PY || '/root/jobs/whish147-bestof3/venv/bin/python';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const RUN = `whish147-bestof4/${new Date().toISOString().slice(0, 19)}`;
const BY = 'scripts/eval/results/whish147-bestof3-2026-10-23/apply.mjs';

const NAME = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-fable-5-1': 'Claude Fable 5.1' };
// Gate numbers: gate-scores.json, J-text, per candidate pool (#7119 comment 2026-10-23). Leaves read before 08:15
// have a Fable candidate (pool opus3fable1); the rest are Opus only (pool opus3, bestof.mjs --no-fable).
const POOL = {
  opus3fable1: { cer: 0.166, pct: '17%', worst: '44% and 51%', single: 0.339 },
  opus3: { cer: 0.204, pct: '20%', worst: '57% and 62%', single: 0.339 },
};
const word = (n) => ['no', 'one', 'two', 'three', 'four', 'five'][n] || String(n);
export function describe(cands, metaOf) {
  const models = cands.map((cn) => metaOf(cn).model);
  const nO = models.filter((m) => /opus/.test(m)).length, nF = models.filter((m) => /fable/.test(m)).length;
  const pool = nF ? 'opus3fable1' : 'opus3', g = POOL[pool];
  const who = [nO && `${word(nO)} by Claude Opus 5.5`, nF && `${word(nF)} by Claude Fable 5.1`].filter(Boolean).join(', ');
  const method = `${word(cands.length)[0].toUpperCase()}${word(cands.length).slice(1)} independent readings of the leaf were made (${who}) and a Claude Opus judge, shown neither the image nor any edition, kept the one that reads most like real text`;
  const gate = `On 9 verse leaves of this manuscript where a published text exists, the reading kept this way (from ${nF ? 'three Opus readings and one Fable reading' : 'three Opus readings'}) differed from it in ${g.pct} of characters (row-by-row CER ${g.cer.toFixed(2)}, Oct 2026), against 34% for a single reading; on 2 of the 9 leaves none of the readings was close (${g.worst}). Commentary leaves and the smaller second hand (pages 131–221) were not part of that test, and a judge that favours fluent text may keep a passage the model remembers over what the leaf shows.`;
  const short = `best of ${cands.length} (${[nO && `Claude Opus 5.5 ×${nO}`, nF && `Claude Fable 5.1 ×${nF}`].filter(Boolean).join(', ')})`;
  return { pool, g, method, gate, short };
}
export const FRESH_WARNING = (d, model) => `Direct machine reading (Oct 2026), in Malayalam script as the model saw it, with a mechanical IAST transliteration under it; no published text was shown to the model. ${d.method}; this is the reading by ${model}. ${d.gate} Read it as a rough guide to the words. The leaf has two string holes; each numbered row reads straight across both of them (‖ marks a hole). Not checked by a scholar; report errors with the feedback button.`;
export const NOTE_SENTENCE = (d) => `A note at the end gives a direct reading of this leaf with no edition shown. ${d.method}. ${d.gate}`;
export const FRESH_TR_WARNING = 'English translation (Claude Opus 5.5, Oct 2026) of an uncertain text: the Sanskrit is a direct machine reading of the leaf with no published text to check against, so expect wrong words; only what was read is translated. Not checked by a scholar.';
const OLD_NOTE_SENTENCE = /A note at the end gives a (?:fresh )?direct reading of this leaf[\s\S]*?(?=<\/warning>)/;
const OLD_NOTE = /\n*<note>(?:Fresh direct reading|Direct reading, best of)[\s\S]*?<\/note>\n*$/;

const readRows = (stage, key) => fs.readFileSync(path.join(HERE, 'reads', stage, `${key}.txt`), 'utf8').split('\n')
  .map((l) => l.match(/^ROW\s+(\d+)\s*\|\s*(.*)$/)).filter(Boolean).map((x) => `${x[1]}. ${x[2].trim()}`);
const readMeta = (stage, key) => JSON.parse(fs.readFileSync(path.join(HERE, 'reads', stage, `${key}.meta.json`), 'utf8'));
function iastOf(map) {
  const r = spawnSync(PY, [path.join(HERE, '../whish147-best-attempt-2026-10-22/mlym2iast.py')], { input: JSON.stringify(map), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`mlym2iast.py: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const cerOf = (s) => (s && s.n ? Math.round((s.d / s.n) * 1000) / 1000 : null);

async function main() {
  const P = JSON.parse(fs.readFileSync(path.join(HERE, 'plan.json'), 'utf8'));
  const picks = JSON.parse(fs.readFileSync(path.join(HERE, 'picks.json'), 'utf8'));
  const sc = fs.existsSync(path.join(HERE, 'pick-scores.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'pick-scores.json'), 'utf8')) : {};
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const todo = P.todo.filter((t) => !ONLY || t.hand === ONLY);
  const pages = new Map((await db.collection('pages').find({ id: { $in: todo.map((t) => t.id) } }, { projection: { id: 1, page_number: 1, ocr: 1 } }).toArray()).map((p) => [p.id, p]));
  const rowsByKey = {};
  for (const t of todo) { const k = picks[t.key]; if (k?.pick) rowsByKey[t.key] = readRows(k.pick, t.key).join('\n'); }
  const iast = iastOf(rowsByKey);
  const plan = [], skipped = [];
  for (const t of todo) {
    const p = pages.get(t.id), k = picks[t.key];
    if (!p) { skipped.push({ n: t.n, key: t.key, why: 'page not found' }); continue; }
    if (!k?.pick) { skipped.push({ n: t.n, key: t.key, why: k ? `no pick: ${k.error || 'judge gave no letter'}` : 'not read yet' }); continue; }
    const meta = readMeta(k.pick, t.key), model = NAME[meta.model] || meta.model;
    const rows = rowsByKey[t.key] ? rowsByKey[t.key].split('\n') : [];
    const rowsI = iast[t.key] ? iast[t.key].split('\n') : [];
    const w = p.ocr?.engine?.input?.whish147 || {};
    const s = sc[t.key];
    const d = describe(k.candidates || [k.pick], (cn) => readMeta(cn, t.key));
    const bestof = {
      method: 'bestof4-jtext', run: RUN, issue: 7119, pick: k.pick, pick_model: meta.model,
      candidates: Object.fromEntries((k.candidates || []).map((cn) => { const m = readMeta(cn, t.key); return [cn, { read: `whish147-bestof3-2026-10-23/reads/${cn}/${t.key}.txt`, model: m.model, prompt_hash: m.prompt_hash, images: m.images?.map((x) => x.sha256), cer_vs_edition: cerOf(s?.scores?.[cn]) }]; })),
      judge: k.keyMap ? { read: `whish147-bestof3-2026-10-23/reads/pick/${t.key}.txt`, kind: 'J-text', model: 'opus', key: k.keyMap } : { kind: 'only one candidate' },
      gate: { file: 'whish147-bestof3-2026-10-23/gate-scores.json', pool: d.pool, pooled_cer: d.g.cer, leaves: 9, single_read: d.g.single },
    };
    let data, primary, bodyChanged = false;
    if (t.primary === 'edition-anchored') {
      if (!OLD_NOTE.test(p.ocr.data) || !OLD_NOTE_SENTENCE.test(p.ocr.data)) { skipped.push({ n: t.n, key: t.key, why: 'anchored page without the expected note / warning sentence' }); continue; }
      const noteBody = rows.map((r, i) => `${r}  (IAST: ${rowsI[i]?.replace(/^\d+\.\s+/, '') ?? ''})`).join('\n');
      const pc = cerOf(s?.scores?.[k.pick]), ac = w.fresh_vs_anchored?.anchored_cer ?? null;
      data = p.ocr.data.replace(OLD_NOTE_SENTENCE, NOTE_SENTENCE(d)).replace(OLD_NOTE, '') +
        `\n\n<note>Direct reading, ${d.short}, Oct 2026, no edition shown, kept by a blind Claude Opus judge; this is the reading by ${model} (CER against the edition ${pc ?? 'n/a'}, the transcription above ${ac ?? 'n/a'}):\n${noteBody || '[no writing read on this leaf]'}</note>\n`;
      primary = 'edition-anchored';
    } else {
      const m = p.ocr.data.match(/^<warning>[\s\S]*?<\/warning>\n((?:<(?:language|script|page-type|scan-quality)>[^\n]*\n)*)\n?([\s\S]*)$/);
      if (!m) { skipped.push({ n: t.n, key: t.key, why: 'fresh-read page not in the expected shape' }); continue; }
      const body = rows.length ? `**Rows of this leaf**\n\n${rows.join('\n')}\n\n---\n\n**IAST transliteration (mechanical)**\n\n**Rows of this leaf**\n\n${rowsI.join('\n')}` : '**Rows of this leaf**\n\n[no writing read on this leaf]';
      data = `<warning>${FRESH_WARNING(d, model)}</warning>\n${m[1]}\n${body}\n`;
      bodyChanged = body.trim() !== m[2].trim();
      primary = 'fresh-bestof4';
    }
    if (data === p.ocr.data) { skipped.push({ n: t.n, key: t.key, why: 'text already as it would be written' }); continue; }
    plan.push({ t, p, data, primary, bestof, bodyChanged, model: meta.model });
  }
  const nFresh = plan.filter((x) => x.primary === 'fresh-bestof4').length;
  console.log(`${plan.length} pages to write (${nFresh} pick as OCR, ${plan.length - nFresh} anchored + note); body changed on ${plan.filter((x) => x.bodyChanged).length}; skipped ${skipped.length}`);
  fs.writeFileSync(path.join(SCRATCH, 'apply-preview.json'), JSON.stringify(plan.map((x) => ({ n: x.t.n, primary: x.primary, before: x.p.ocr.data, after: x.data })), null, 1));
  let ok = 0;
  if (APPLY) {
    for (const x of plan) {
      const eng = { ...x.p.ocr.engine, input: { ...x.p.ocr.engine?.input, whish147: { ...(x.p.ocr.engine?.input?.whish147 || {}), bestof: x.bestof, primary: x.primary } } };
      const next = { ...x.p.ocr, data: x.data, content_hash: contentHash(x.data), engine: eng, ...(x.primary === 'fresh-bestof4' ? { model: x.model } : {}), updated_at: new Date() };
      const r = await writePageText(db, x.p.id, 'ocr', next, { by: BY, reason: 'best-of-4 read picked by a blind judge (#7119)', run_id: RUN });
      if (r.status === 'written') ok++; else { skipped.push({ n: x.t.n, key: x.t.key, why: `writer: ${r.status}` }); x.failed = true; }
    }
    await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: '6ad845ec6037414ddef152af', action: 'bestof4-pick', detail: { run: RUN, issue: 7119, written: ok, pick_as_ocr: nFresh, anchored_with_note: plan.length - nFresh } });
    const tr = plan.filter((x) => x.bodyChanged && !x.failed);
    const tag = `bestof-${ONLY || 'all'}`;
    fs.mkdirSync(path.join(HERE, 'translate'), { recursive: true });
    fs.writeFileSync(path.join(HERE, 'translate', `${tag}.ids.json`), JSON.stringify(tr.map((x) => x.p.id)));
    fs.writeFileSync(path.join(HERE, 'translate', `${tag}.instr.json`), JSON.stringify(Object.fromEntries(tr.map((x) => [x.p.id,
      `For page ${x.t.n} (one palm leaf; the text is given in Malayalam script and again in IAST): begin its translation with exactly this line: <warning>${FRESH_TR_WARNING}</warning> Then translate the leaf as continuous English from the IAST rows in order (each row reads straight across the ‖ marks; join a word split across a row end). Passages may be Sanskrit or Malayalam. Translate only connected words actually read; keep [illegible]; never supply a remembered published translation. If no connected words can be read, write only "[no connected text could be read on this leaf]".`])), null, 1));
    console.log(`written ${ok}; translate plan: ${tr.length} pages (translate/${tag}.*)`);
  }
  const resF = path.join(HERE, 'apply-result.json');
  const prev = fs.existsSync(resF) ? JSON.parse(fs.readFileSync(resF, 'utf8')) : { runs: [] };
  prev.runs.push({ run: RUN, apply: APPLY, only: ONLY || null, written: ok, pages: plan.map((x) => ({ n: x.t.n, key: x.t.key, hand: x.t.hand, primary: x.primary, pick: x.bestof.pick, body_changed: x.bodyChanged })), skipped });
  if (APPLY) fs.writeFileSync(resF, JSON.stringify(prev, null, 1));
  await c.close();
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
