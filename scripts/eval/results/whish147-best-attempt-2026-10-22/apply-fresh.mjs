// APPLY THE FRESH READ (#7119, Derek's note of 2026-10-22 23:30). Per leaf page:
//   - free-read / blank leaf / single board: the fresh Opus read becomes the page OCR (Malayalam rows as Opus wrote
//     them, then a mechanical IAST transliteration: mlym2iast.py);
//   - edition-anchored leaf: the anchored text stays the OCR where the fresh read scores worse against the edition
//     excerpt (score-all.py → fresh-vs-anchored.json), and the fresh read goes under it in a labelled <note>; where it
//     scores better it becomes the OCR. The rule is applied to every leaf with an edition, commentary included (see
//     the #7119 gate comment).
//   - the contents leaf (scan 3) is left as it is: it is English and Malayalam lists, not Sanskrit text.
// Every write goes through writePageText (the previous text is kept as a revision). Pages whose OCR text changed are
// listed with their translation instruction for a fresh Opus translation (translate/fresh.ids.json / .instr.json).
//   node --env-file=/root/sourcelibrary/.env.production.local apply-fresh.mjs --dump     (inputs for score-all.py)
//   node --env-file=/root/sourcelibrary/.env.production.local apply-fresh.mjs [--apply]
// PRIOR ART: relayout.mjs / leaf-split.mjs (page text shape, writePageText); fresh.mjs makes the reads.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { HERE, BOOK, SCRATCH } from './lib.mjs';
import { corpus } from './locate.mjs';
import { writePageText } from '../../../lib/page-text-writer.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RUN = `whish147-fresh-opus/${new Date().toISOString().slice(0, 19)}`;
// Numbers: the 9-leaf gate (fresh-gate-scores.json, #7119 comment 2026-10-23).
export const GATE = 'On 9 verse leaves of this manuscript where a published text exists, such reads differed from it in 37% of characters overall (row-by-row CER 0.37, Oct 2026), but unevenly: 4–17% on five leaves, where the model recognised the verses and partly wrote from memory, and 48–63% on the other four; a second read of one leaf went from 9% to 40%.';
export const FRESH_WARNING = `Direct machine reading by Claude Opus 5.5 (Oct 2026), in Malayalam script as the model saw it, with a mechanical IAST transliteration under it; no published text was shown to the model. ${GATE} Read it as a rough guide to the words; a fluent passage may be remembered text rather than the leaf. The leaf has two string holes; each numbered row reads straight across both of them (‖ marks a hole). Not checked by a scholar; report errors with the feedback button.`;
export const NOTE_SENTENCE = `A note at the end gives a fresh direct reading of this leaf by Claude Opus 5.5 (Oct 2026, no edition shown). ${GATE}`;
export const FRESH_TR_WARNING = 'English translation (Claude Opus 5.5, Oct 2026) of an uncertain text: the Sanskrit is a direct machine reading of the leaf with no published text to check against, so expect wrong words; only what was read is translated. Not checked by a scholar.';

const py = (script, map) => {
  const r = spawnSync(path.join(SCRATCH, 'venv/bin/python'), [path.join(HERE, script)], { input: JSON.stringify(map), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${script}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const keyOf = (p) => (p.ocr?.leaf_split ? `${p.ocr.leaf_split.from_page_number}-${p.ocr.leaf_split.leaf}` : p.page_number === 1 ? '1-l1' : '159-l1');
const methodOf = (p) => Object.values(p.ocr?.engine?.input?.whish147?.leaves || {})[0]?.method || (p.ocr?.leaf_split ? null : 'free-read');
const iastOf = (ocr) => { const t = ocr.split('**IAST transliteration**'); return t[t.length - 1]; };
function freshRows(key) {
  const f = path.join(HERE, 'reads', 'fresh', `${key}.txt`), m = path.join(HERE, 'reads', 'fresh', `${key}.meta.json`);
  if (!fs.existsSync(m)) return null;
  const meta = JSON.parse(fs.readFileSync(m, 'utf8'));
  if (!meta.ok) return { meta, rows: null };
  const rows = fs.readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^ROW\s+(\d+)\s*\|\s*(.*)$/)).filter(Boolean).map((x) => `${x[1]}. ${x[2].trim()}`);
  return { meta, rows };
}

async function main() {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, ocr: 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
  if (args.includes('--dump')) {
    const anch = {};
    for (const p of pages) if (methodOf(p) === 'edition-anchored') anch[keyOf(p)] = iastOf(p.ocr.data);
    fs.writeFileSync(path.join(SCRATCH, 'anchored-all.json'), JSON.stringify(anch));
    fs.writeFileSync(path.join(SCRATCH, 'corpus.json'), JSON.stringify(corpus().text));
    console.log(`${Object.keys(anch).length} anchored leaves dumped`);
    await c.close(); return;
  }
  const cmp = JSON.parse(fs.readFileSync(path.join(HERE, 'fresh-vs-anchored.json'), 'utf8'));
  const relayout = JSON.parse(fs.readFileSync(path.join(HERE, 'relayout-result.json'), 'utf8'));
  const relayFilled = new Set((relayout.retranslate || []).map((r) => r.id));
  const reads = {};
  for (const p of pages) { const fr = freshRows(keyOf(p)); if (fr?.rows) reads[keyOf(p)] = fr.rows.join('\n'); }
  const iast = py('mlym2iast.py', reads);
  const plan = [], skipped = [];
  for (const p of pages) {
    const key = keyOf(p), method = methodOf(p), fr = freshRows(key);
    if (method === 'contents-leaf-read') { skipped.push({ n: p.page_number, why: 'contents leaf (English + Malayalam lists), not re-read' }); continue; }
    if (!fr?.rows) { skipped.push({ n: p.page_number, why: fr ? `fresh read failed: ${fr.meta.error_class}` : 'no fresh read' }); continue; }
    const side = p.ocr?.leaf_split ? (p.ocr.leaf_split.leaf === 't' ? 'Upper leaf' : 'Lower leaf') : 'Board';
    const freshInput = { method: 'fresh-opus-columns', read: `reads/fresh/${key}.txt`, model: fr.meta.model, prompt_hash: fr.meta.prompt_hash, images: fr.meta.images, run: RUN };
    const s = cmp[key];
    const keepAnchored = method === 'edition-anchored' && !(s?.fresh_cer != null && s.anchored_cer != null && s.fresh_cer < s.anchored_cer);
    let data, primary;
    if (keepAnchored) {
      const rowsI = iast[key].split('\n');
      const noteBody = fr.rows.map((r, i) => `${r}  (IAST: ${rowsI[i]?.replace(/^\d+\.\s+/, '') ?? ''})`).join('\n');
      data = p.ocr.data.replace(/<\/warning>/, ` ${NOTE_SENTENCE}</warning>`).trimEnd() + `\n\n<note>Fresh direct reading, Claude Opus 5.5, Oct 2026, no edition shown (fresh-opus-columns; CER against the edition ${s?.fresh_cer ?? 'n/a'}, the transcription above ${s?.anchored_cer ?? 'n/a'}):\n${noteBody}</note>\n`;
      primary = 'edition-anchored';
    } else {
      const body = fr.rows.length ? `**${side}**\n\n${fr.rows.join('\n')}\n\n---\n\n**IAST transliteration (mechanical)**\n\n**${side}**\n\n${iast[key]}` : `**${side}**\n\n[no writing read on this leaf]`;
      data = `<warning>${FRESH_WARNING}</warning>\n<language>Sanskrit</language>\n<script>handwritten</script>\n<page-type>text</page-type>\n\n${body}\n`;
      primary = 'fresh-opus-columns';
    }
    if (data === p.ocr.data) continue;
    const textChanged = primary === 'fresh-opus-columns' || relayFilled.has(p.id);
    plan.push({ p, key, data, primary, freshInput, cmp: s ?? null, retranslate: textChanged });
  }
  console.log(`${plan.length} pages to write (${plan.filter((x) => x.primary === 'fresh-opus-columns').length} fresh as OCR, ${plan.filter((x) => x.primary === 'edition-anchored').length} anchored + note); ${plan.filter((x) => x.retranslate).length} to retranslate; skipped ${skipped.length}`);
  fs.writeFileSync(path.join(SCRATCH, 'fresh-preview.json'), JSON.stringify(plan.slice(0, 12).map((x) => ({ n: x.p.page_number, primary: x.primary, data: x.data })), null, 1));
  if (APPLY) {
    let ok = 0;
    for (const x of plan) {
      const eng = x.p.ocr.engine ? { ...x.p.ocr.engine, input: { ...x.p.ocr.engine.input, whish147: { ...(x.p.ocr.engine.input?.whish147 || {}), fresh: x.freshInput, primary: x.primary, fresh_vs_anchored: x.cmp } } } : undefined;
      const next = { ...x.p.ocr, data: x.data, content_hash: contentHash(x.data), ...(eng ? { engine: eng } : {}), ...(x.primary === 'fresh-opus-columns' ? { model: x.freshInput.model } : {}), updated_at: new Date() };
      const r = await writePageText(db, x.p.id, 'ocr', next, { by: 'scripts/eval/results/whish147-best-attempt-2026-10-22/apply-fresh.mjs', reason: 'fresh Opus read (#7119)', run_id: RUN });
      if (r.status === 'written') ok++; else skipped.push({ n: x.p.page_number, why: `writer: ${r.status}` });
    }
    await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: BOOK, action: 'fresh-opus-read', detail: { run: RUN, issue: 7119, written: ok, fresh_primary: plan.filter((x) => x.primary === 'fresh-opus-columns').length, anchored_with_note: plan.filter((x) => x.primary === 'edition-anchored').length } });
    const tr = plan.filter((x) => x.retranslate);
    fs.writeFileSync(path.join(HERE, 'translate', 'fresh.ids.json'), JSON.stringify(tr.map((x) => x.p.id)));
    fs.writeFileSync(path.join(HERE, 'translate', 'fresh.instr.json'), JSON.stringify(Object.fromEntries(tr.map((x) => [x.p.id, x.primary === 'fresh-opus-columns'
      ? `For page ${x.p.page_number} (one palm leaf; the Sanskrit is given in Malayalam script and again in IAST): begin its translation with exactly this line: <warning>${FRESH_TR_WARNING}</warning> Then translate the leaf as continuous English from the IAST rows in order (each row reads straight across the ‖ marks; join a word split across a row end). Translate only connected words actually read; keep [illegible]; never supply a remembered published translation. If no connected words can be read, write only "[no connected text could be read on this leaf]".`
      : `For page ${x.p.page_number} (one palm leaf of Sanskrit, IAST rows): begin its translation with exactly this line: <warning>English translation (Claude Opus 5.5, Oct 2026) of an uncertain text: the Sanskrit it translates is a machine transcription anchored to a published edition, which can miss places where the leaf differs (see the note on the transcription). Not checked by a scholar.</warning> Translate the transcription (not the note at its end) as continuous English, row by row in order; each row reads straight across the ‖ marks; render "X [leaf: Y?]" as X with the alternative in brackets; keep [illegible]; never supply a remembered published translation.`])), null, 1));
    console.log(`written ${ok}; translate plan: ${tr.length} pages`);
  }
  fs.writeFileSync(path.join(HERE, 'fresh-apply-result.json'), JSON.stringify({ run: RUN, apply: APPLY, pages: plan.map((x) => ({ n: x.p.page_number, key: x.key, primary: x.primary, cmp: x.cmp, retranslate: x.retranslate })), skipped }, null, 1));
  await c.close();
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
