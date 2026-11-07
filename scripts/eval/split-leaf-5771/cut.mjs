#!/usr/bin/env node
// PRIOR ART: the #5260 leaf-break backfill (it inserted `<leaf-break/>` into whole-page Yigdzin reads at the ledger's
// per-leaf line counts) and the #5771 Neyphug apply (split-in-reading-order.mjs: each leaf page takes its half of the
// stored text at `<leaf-break/>`, no re-OCR). This builds that "cut, don't re-read" arm for the 80 audited frames.
/**
 * cut.mjs — $0, no model, no database. Arm 2 (CUT) of job split-leaves-5771 (#5771, Derek's note 2026-10-25).
 *   node scripts/eval/split-leaf-5771/cut.mjs --frames=frames.jsonl --req=<6948>/audit/req.jsonl --out=DIR
 * The transcription is the one the #6948 auditor saw (taken from that job's request file, so arm 1 and arm 2 are the
 * same characters). It is cut at `<leaf-break/>`; a read with no marker (a whole-page read) is cut at the ledger's
 * per-leaf line counts (`ledger_leaf_lines`, the first n1 lines to leaf 1, ...; whatever is left goes to the last
 * leaf), which is what the #5260 backfill did; with no ledger it stays one piece. Writes DIR/<uid>-L<i>.txt and
 * DIR/cut.jsonl (how each frame was cut, and whether the line counts matched).
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const frames = fs.readFileSync(arg('frames'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const OUT = arg('out');
fs.mkdirSync(OUT, { recursive: true });
const seam = new Map(fs.readFileSync(arg('req'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.uid, r.prompt.split('TRANSCRIPTION:\n')[1].split('\n\nENGLISH:\n')[0]]));

/** The stored read cut into leaves: at <leaf-break/>, else at the ledger's line counts. */
export function cutRead(text, ledgerLines) {
  const parts = text.split(/\n?<leaf-break\s*\/>\n?/);
  if (parts.length > 1) return { leaves: parts.map((p) => p.trim()), how: 'leaf-break' };
  const lines = text.split('\n').filter((l) => l.trim());
  if (!ledgerLines?.length || ledgerLines.length < 2) return { leaves: [text.trim()], how: 'whole' };
  const leaves = []; let i = 0;
  ledgerLines.forEach((n, k) => { const take = k === ledgerLines.length - 1 ? lines.length - i : n; leaves.push(lines.slice(i, i + take).join('\n')); i += take; });
  return { leaves, how: lines.length === ledgerLines.reduce((a, b) => a + b, 0) ? 'ledger-lines' : 'ledger-lines-mismatch', stored_lines: lines.length };
}

const log = [];
for (const f of frames) {
  const text = seam.get(f.uid);
  if (!text) { console.log(`${f.uid}: not in the #6948 requests`); continue; }
  const c = cutRead(text, f.ledger_leaf_lines);   // the ledger as it is, as the backfill would use it, even where its cut was wrong
  c.leaves.forEach((t, i) => fs.writeFileSync(path.join(OUT, `${f.uid}-L${i + 1}.txt`), t + '\n'));
  log.push({ uid: f.uid, how: c.how, leaves: c.leaves.length, crops: f.spans?.length || 1, stored_lines: c.stored_lines ?? null, ledger_lines: f.ledger_leaf_lines });
}
fs.writeFileSync(path.join(OUT, 'cut.jsonl'), log.map((x) => JSON.stringify(x)).join('\n') + '\n');
const n = (k) => log.filter((x) => x.how === k).length;
console.log(JSON.stringify({ frames: log.length, leaf_break: n('leaf-break'), ledger_lines: n('ledger-lines'), ledger_lines_mismatch: n('ledger-lines-mismatch'), whole: n('whole'), leaves: log.reduce((a, x) => a + x.leaves, 0), leaves_ne_crops: log.filter((x) => x.leaves !== x.crops).length }));
