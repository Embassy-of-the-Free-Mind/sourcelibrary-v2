// PRIOR ART: scripts/eval/paddle-table-pilot-6388/score.mjs — the pilot gate (first parseable reply per uid, Wilson 95%,
// controls first). Changed: a control is caught when the verdict is `invented` AND an invented span is the DUPLICATED
// row (its text, punctuation/spaces/markup removed, shares a window of min(6, row length) characters with the row).
// Usage (cwd = $JOB_SCRATCH): node score-gate.mjs   (gate-sample.json, gate-controls.json, gate-review.jsonl → gate-score.json)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const wilson = (k, n, z = 1.96) => { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+((c - s) / d).toFixed(3), +((c + s) / d).toFixed(3)]; };
export const VERDICTS = ['clean', 'minor', 'material', 'invented'];
// A reply's verdict: the last {...} object in the text that parses and names a known verdict.
export function parseReview(text) {
  const t = String(text || '');
  for (let i = t.lastIndexOf('{'); i >= 0; i = t.lastIndexOf('{', i - 1)) {
    for (let j = t.lastIndexOf('}'); j > i; j = t.lastIndexOf('}', j - 1)) {
      try { const o = JSON.parse(t.slice(i, j + 1)); if (o && VERDICTS.includes(o.verdict)) return o; } catch { /* keep looking */ }
    }
    if (i === 0) break;
  }
  return null;
}
const norm = (s) => String(s || '').replace(/[\s|#*`<>\/\-:：，。、；,.;()（）「」『』]/gu, '').replace(/[a-z_]+/gi, '');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const S = JSON.parse(fs.readFileSync('gate-sample.json', 'utf8'));
  const C = JSON.parse(fs.readFileSync('gate-controls.json', 'utf8'));
  const rev = new Map();
  const files = fs.readdirSync('.').filter((f) => /^gate-review(-r\d)?\.jsonl$/.test(f)).sort(); // the run, then the retries of unparsed replies
  for (const f of files) for (const r of readJsonl(f)) { if (rev.has(r.uid)) continue; const v = parseReview(r.text); if (v) rev.set(r.uid, { ...v, secs: r.secs, file: f }); }
  const ctl = C.map((c) => {
    const v = rev.get(c.uid); const row = norm(c.duplicated_row); const w = Math.min(6, [...row].length);
    const named = !!v && (v.invented || []).some((x) => { const what = norm(x.what); const R = [...row]; for (let i = 0; i + w <= R.length; i++) if (what.includes(R.slice(i, i + w).join(''))) return true; return false; });
    return { ...c, verdict: v?.verdict ?? null, invented: v?.invented ?? null, caught: v?.verdict === 'invented' && named };
  });
  const pages = S.map((s) => ({ ...s, review: rev.get(s.uid) ?? null }));
  const R = pages.filter((p) => p.review);
  const inv = R.filter((p) => p.review.verdict === 'invented');
  const split = Object.fromEntries(VERDICTS.map((v) => [v, R.filter((p) => p.review.verdict === v).length]));
  const caught = ctl.filter((c) => c.caught).length;
  // The gate is k called invented over the 100 drawn ("<= 10 of the 100"); pages never reviewed are listed, not dropped.
  const out = {
    model: [...new Set(files.flatMap((f) => readJsonl(f).map((r) => r.model)))],
    calls: files.reduce((a, f) => a + readJsonl(f).length, 0),
    controls: { planted: ctl.length, caught, rows: ctl.map(({ uid, book_id, page_number, row_line, duplicated_row, verdict, invented, caught }) => ({ uid, book_id, page_number, row_line, duplicated_row, verdict, invented, caught })) },
    drawn: S.length, reviewed: R.length, not_reviewed: pages.filter((p) => !p.review).map((p) => p.uid),
    verdicts: split,
    invented: { k: inv.length, n: S.length, rate: +(inv.length / S.length).toFixed(3), wilson95: wilson(inv.length, S.length), k_of_reviewed: `${inv.length}/${R.length}`, wilson95_reviewed: wilson(inv.length, R.length) },
    by_layout: pages.reduce((o, p) => { const k = p.layout || '?'; (o[k] ||= { n: 0, invented: 0 }).n++; if (p.review?.verdict === 'invented') o[k].invented++; return o; }, {}),
    invented_pages: inv.map((p) => ({ uid: p.uid, link: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`, layout: p.layout, invented: p.review.invented, note: p.review.note })),
  };
  out.gate = caught < 4 ? 'STOP (reviewer caught fewer than 4 of 5 controls)' : inv.length <= 10 ? 'GO (called invented on <= 10 of 100)' : 'NO-GO (called invented on > 10 of 100)';
  fs.writeFileSync('gate-score.json', JSON.stringify({ summary: out, pages }, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
