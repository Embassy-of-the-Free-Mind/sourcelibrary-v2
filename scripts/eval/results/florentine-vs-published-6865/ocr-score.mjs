// PRIOR ART: scripts/eval/lib/metrics.mjs (levenshtein, cer — used here, on characters and on word arrays).
// Score transcriptions of the Florentine Codex against the Getty Digital Florentine Codex paleographic transcription
// (private answer key: read from REFDIR, never written anywhere but the local score file), per column.
//   node ocr-score.mjs SAMPLE.json REFDIR LITE_DIR ARGON_DIR OUT.json
// Arms: the flash-lite OCR that was served until #6865 (LITE_DIR/<page_id>.txt, taken from pages.ocr or its page_revisions
// snapshot) and the Argon-high re-read (ARGON_DIR/<page_id>.txt). Columns: split at <column-break/>,
// Spanish left, Nahuatl right. Normalisation A: case, whitespace and line breaks only (a line-end hyphen is joined).
// Normalisation B: A plus u/v, i/j and macrons folded.
import fs from 'node:fs';
import { levenshtein } from '../../lib/metrics.mjs';

const [SAMPLE, REFDIR, LITE, ARGON, OUT] = process.argv.slice(2);
const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
// Our tags: drop the metadata blocks whole, keep the words inside the rest (<unclear>, <term>, ...).
const META = /<(scan-quality|language|script|page-type|columns|page-num|sig|warning|image-desc|meta|note|vocab|header|summary|keywords)\b[^>]*>(?:(?!<column-break\/>)[\s\S])*?<\/\1>/g; // never across the column break
const ours = (t) => t.replace(META, ' ').replace(/<image-desc[^>]*\/>/g, ' ').replace(/<(?!column-break)[^<>]+>/g, ' ');
// Getty markdown: drop footnote definitions and markers, headings' #, emphasis.
const md = (t) => t.replace(/^\[\^[^\]]+\]:.*$/gm, ' ').replace(/\[\^[^\]]+\]/g, '').replace(/^#+\s*/gm, '').replace(/[*_]/g, '').replace(/&#8221;|&#8220;/g, '"').replace(/&#8230;/g, '…').replace(/<[^>]+>/g, ' ');
const normA = (t) => t.replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const normB = (t) => normA(t).normalize('NFD').replace(/̄/g, '').normalize('NFC').replace(/v/g, 'u').replace(/j/g, 'i');
const score = (hyp, ref, norm) => { const h = norm(hyp), r = norm(ref); const hw = h.split(' ').filter(Boolean), rw = r.split(' ').filter(Boolean); return { cer: levenshtein(h, r) / Math.max(1, r.length), wer: levenshtein(hw, rw) / Math.max(1, rw.length), ref_chars: r.length, hyp_chars: h.length }; };
// Spanish is the first segment, Nahuatl the last; a middle segment (a picture column) is neither.
const cols = (t) => { const p = ours(t).split('<column-break/>'); return p.length >= 2 ? { spa: p[0], nah: p[p.length - 1] } : null; };

const rows = [];
for (const x of sample) {
  const ref = JSON.parse(fs.readFileSync(`${REFDIR}/${x.page_id}.json`, 'utf8'));
  const row = { page_id: x.page_id, vol: x.vol, page_number: x.page_number, codex_book: x.codex_book, folio: x.folio };
  const arms = { stored: fs.readFileSync(`${LITE}/${x.page_id}.txt`, 'utf8') };
  try { const a = fs.readFileSync(`${ARGON}/${x.page_id}.txt`, 'utf8'); if (a.trim()) arms.argon = a; } catch { /* not read */ }
  for (const [arm, text] of Object.entries(arms)) {
    const cc = cols(text);
    if (!cc) { row[arm] = { split: false }; continue; }
    row[arm] = { split: true };
    for (const col of ['nah', 'spa']) { const r = md(ref[col] || ''); if (!r.trim()) continue; row[arm][col] = { A: score(cc[col], r, normA), B: score(cc[col], r, normB) }; }
  }
  rows.push(row);
  console.log(`${x.vol}:${x.page_number} ${Object.keys(arms).map((a) => `${a} ${row[a].split ? `nah ${row[a].nah?.A.cer.toFixed(3)} spa ${row[a].spa?.A.cer.toFixed(3)}` : 'unsplit'}`).join(' | ')}`);
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
// Summary: micro-averaged (errors / reference length) over the pages BOTH arms split, per column and normalisation.
const both = rows.filter((r) => r.stored?.split && r.argon?.split);
// CER: total edits / total reference chars; WER: mean over pages.
const sum = (arm, col, n, k) => { let e = 0, len = 0; for (const r of both) { const s = r[arm][col]?.[n]; if (!s) continue; const w = k === 'cer' ? s.ref_chars : 1; e += s[k] * w; len += w; } return e / Math.max(1, len); };
console.log(`\npages: ${rows.length}; both arms split: ${both.length}; stored unsplit ${rows.filter((r) => !r.stored?.split).length}; argon unsplit ${rows.filter((r) => r.argon && !r.argon.split).length}; argon missing ${rows.filter((r) => !r.argon).length}`);
console.log('| column | norm | stored CER | Argon CER | stored WER (page mean) | Argon WER (page mean) |\n|---|---|---|---|---|---|');
for (const col of ['nah', 'spa']) for (const n of ['A', 'B']) console.log(`| ${col} | ${n} | ${sum('stored', col, n, 'cer').toFixed(3)} | ${sum('argon', col, n, 'cer').toFixed(3)} | ${sum('stored', col, n, 'wer').toFixed(3)} | ${sum('argon', col, n, 'wer').toFixed(3)} |`);
const wins = (col) => both.filter((r) => r.argon[col] && r.stored[col]).reduce((a, r) => { const d = r.argon[col].A.cer - r.stored[col].A.cer; a[d < -0.005 ? 0 : d > 0.005 ? 2 : 1]++; return a; }, [0, 0, 0]);
const med = (arm, col) => { const v = both.map((r) => r[arm][col]?.A.cer).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]?.toFixed(3); };
console.log(`median page CER (A): Nahuatl stored ${med('stored', 'nah')} Argon ${med('argon', 'nah')}; Spanish stored ${med('stored', 'spa')} Argon ${med('argon', 'spa')}`);
console.log(`Argon better/same/worse by CER (A): Nahuatl ${wins('nah').join('/')}, Spanish ${wins('spa').join('/')}`);
