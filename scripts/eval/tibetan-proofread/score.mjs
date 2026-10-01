#!/usr/bin/env node
// PRIOR ART: kanjur_align.py (Hetzner /root/tibetan-eval/, the Derge instrument behind #4523's 0.947) — its
// syllables() tokeniser and nw_identity() are PORTED here verbatim so a proofread identity and a Derge identity
// are the same measurement against a different reference. It aligns against a retrieved e-text window; this
// aligns against the reader's correction of the same leaf, so it cannot be called as-is (no retrieval, no index).
//
// Two jobs:
//   ingest  — turn the proofreading page's export (or its db `corrections` docs) into one file per page with a
//             provenance block. Human readings go to ground-truth/; model dry runs go to dry-run/ and are never
//             ground truth.
//     node score.mjs ingest --export corrections.json --role human --reader "Name" [--date 2026-10-05]
//     node score.mjs ingest --export dry.json --role model-dry-run --reader "Claude Opus 5.5"
//   score   — syllable identity of the SERVED text against the corrected text, per page and pooled, beside the
//             page's Derge identity; plus the dropped lines the reader added and the lines marked unreadable.
//     node score.mjs score [--dir ground-truth] [--out results.json]
//
// Definitions (per page; lines marked unreadable are removed from BOTH sides before alignment, tag lines such as
// <leaf-break/> are removed from both — kanjur_align counted a tag as one non-matching syllable, ≤ 1 in ~500):
//   identity = NW matches / served syllables  (kanjur_align's orientation: comparable to derge_identity)
//   recall   = NW matches / corrected syllables (sees dropped lines, which identity cannot)
//   pooled   = sum of matches / sum of syllables over pages.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const MANIFEST = path.join(REPO, 'scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl');
const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };

// ---- ported from kanjur_align.py ----
const TSHEG = '་';
// [༁-༊།-༗༚-༟༺-༽྾-࿏\s]+
const PUNCT_RE = /[༁-༊།-༗༚-༟༺-༽྾-࿏\s]+/gu;
const NW_MATCH = 2, NW_MISMATCH = -1, NW_GAP = -1;
export function syllables(text) {
  return text.normalize('NFC').replace(PUNCT_RE, TSHEG).split(TSHEG).filter(Boolean);
}
export function nwMatches(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  let prev = new Int32Array(m + 1); for (let j = 0; j <= m; j++) prev[j] = j * NW_GAP;
  const back = new Uint8Array((n + 1) * (m + 1)); // 0 diag, 1 up, 2 left
  for (let j = 1; j <= m; j++) back[j] = 2;
  for (let i = 1; i <= n; i++) {
    const cur = new Int32Array(m + 1); cur[0] = i * NW_GAP; back[i * (m + 1)] = 1;
    for (let j = 1; j <= m; j++) {
      const d = prev[j - 1] + (a[i - 1] === b[j - 1] ? NW_MATCH : NW_MISMATCH);
      const u = prev[j] + NW_GAP, l = cur[j - 1] + NW_GAP;
      const best = Math.max(d, u, l); cur[j] = best;
      back[i * (m + 1) + j] = best === d ? 0 : best === u ? 1 : 2;
    }
    prev = cur;
  }
  let matches = 0, i = n, j = m;
  while (i > 0 && j > 0) {
    const t = back[i * (m + 1) + j];
    if (t === 0) { if (a[i - 1] === b[j - 1]) matches++; i--; j--; } else if (t === 1) i--; else j--;
  }
  return matches;
}
// ---- end port ----

const TAG = /^\s*<[^>]+>\s*$/;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const manifest = new Map(readJsonl(MANIFEST).map((r) => [r.id, r]));
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

export function scorePage(m, rec) {
  const servedLines = m.served_text.split('\n');
  const rows = rec.lines || rec.corrected_text.split('\n').map((t, i) => ({ served_index: i, text: t, inserted: false, unreadable: (rec.unreadable_lines || []).includes(i), tag: TAG.test(t) }));
  const dropServed = new Set(rows.filter((r) => r.unreadable && r.served_index != null).map((r) => r.served_index));
  const served = servedLines.filter((t, i) => !TAG.test(t) && !dropServed.has(i)).join('\n');
  const corrected = rows.filter((r) => !r.unreadable && !TAG.test(r.text)).map((r) => r.text).join('\n');
  const a = syllables(served), b = syllables(corrected);
  const matches = nwMatches(a, b);
  return {
    id: m.id, seq: m.seq, leaf_seam: m.leaf_seam, derge_identity: m.derge_identity,
    served_syllables: a.length, corrected_syllables: b.length, matches,
    identity: a.length ? +(matches / a.length).toFixed(4) : null,
    recall: b.length ? +(matches / b.length).toFixed(4) : null,
    unreadable_lines: rows.filter((r) => r.unreadable).length,
    dropped_lines: rows.filter((r) => r.inserted && r.text.trim()).length,
    edited_lines: rows.filter((r) => !r.inserted && r.served_index != null && r.text !== servedLines[r.served_index]).length,
  };
}

const median = (xs) => { const s = [...xs].sort((x, y) => x - y); const k = s.length; return k ? +(k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2).toFixed(4) : null; };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(path.resolve(process.argv[1]));
if (!isMain) {
  // imported (e.g. by a parity test): expose syllables / nwMatches only
} else if (cmd === 'ingest') {
  const role = arg('--role'); const reader = arg('--reader');
  if (!['human', 'model-dry-run'].includes(role) || !reader) throw new Error('--role human|model-dry-run and --reader "<name>" required');
  const raw = JSON.parse(fs.readFileSync(arg('--export'), 'utf8'));
  const recs = Array.isArray(raw) ? raw : raw.pages || [raw];
  const outDir = path.join(HERE, role === 'human' ? 'ground-truth' : 'dry-run');
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const rec of recs) {
    const m = manifest.get(rec.id);
    if (!m) throw new Error(`${rec.id}: not in the manifest`);
    if (rec.served_text_sha256 && rec.served_text_sha256 !== m.served_text_sha256) throw new Error(`${rec.id}: export was made against different served text`);
    if (rec.status !== 'done') continue; // only leaves the reader finished
    const file = {
      id: m.id, page_id: m.page_id, book_id: m.book_id, page_number: m.page_number, reader_url: m.reader_url,
      served_engine: m.served_engine, served_text_sha256: m.served_text_sha256,
      corrected_text: rec.corrected_text, corrected_text_sha256: sha(rec.corrected_text),
      unreadable_lines: rec.unreadable_lines || [], dropped_lines: rec.dropped_lines ?? 0, lines: rec.lines, note: rec.note || '',
      provenance: {
        edited_by: reader, role, is_ground_truth: role === 'human',
        date: arg('--date', (rec.saved_at || new Date().toISOString()).slice(0, 10)),
        reader_id: rec.reader_id || null, saved_at: rec.saved_at || null,
        tool: 'Kangyur Proofreading Desk (scripts/eval/tibetan-proofread/page.template.html), https://claude.ai/artifact/TsZeQEWPNVfpjksEWLqTrN',
        instructions: 'Correct each line to the leaf syllable by syllable; do not normalise to another edition; add missing lines; mark unreadable lines.',
        issue: 4523, set: 'tibetan-proofread-2026-10',
        ...(role === 'model-dry-run' ? { warning: 'MODEL-CORRECTED. A pipeline dry run, not a reading. Never use as ground truth or quote as accuracy.' } : {}),
      },
    };
    fs.writeFileSync(path.join(outDir, `${m.id}.json`), JSON.stringify(file, null, 1) + '\n');
    n++;
  }
  console.error(`ingested ${n} finished page(s) -> ${path.relative(REPO, outDir)} (role ${role})`);
} else if (cmd === 'score') {
  const dir = path.resolve(arg('--dir', path.join(HERE, 'ground-truth')));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  if (!files.length) throw new Error(`no corrected pages in ${dir}`);
  const pages = []; const roles = new Set();
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const m = manifest.get(rec.id); if (!m) throw new Error(`${rec.id}: not in manifest`);
    if (rec.served_text_sha256 !== m.served_text_sha256) throw new Error(`${rec.id}: served text hash mismatch`);
    roles.add(rec.provenance?.role);
    pages.push({ ...scorePage(m, rec), edited_by: rec.provenance?.edited_by, role: rec.provenance?.role });
  }
  pages.sort((x, y) => x.seq - y.seq);
  const sum = (k) => pages.reduce((s, p) => s + p[k], 0);
  const summary = {
    dir: path.relative(REPO, fs.realpathSync(dir)), roles: [...roles], is_ground_truth: [...roles].every((r) => r === 'human'),
    n_pages: pages.length, n_books: new Set(pages.map((p) => p.id.split('_')[0])).size,
    pooled_identity: +(sum('matches') / sum('served_syllables')).toFixed(4),
    pooled_recall: +(sum('matches') / sum('corrected_syllables')).toFixed(4),
    median_identity: median(pages.map((p) => p.identity)),
    median_derge_identity_same_pages: median(pages.map((p) => p.derge_identity)),
    pages_with_dropped_lines: pages.filter((p) => p.dropped_lines > 0).length, dropped_lines: sum('dropped_lines'),
    unreadable_lines: sum('unreadable_lines'), edited_lines: sum('edited_lines'),
    by_seam: Object.fromEntries(['marked', 'unmarked'].map((s) => { const g = pages.filter((p) => p.leaf_seam === s); return [s, { n: g.length, median_identity: median(g.map((p) => p.identity)), median_derge: median(g.map((p) => p.derge_identity)) }]; })),
  };
  const out = { summary, pages };
  if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 1) + '\n');
  if (!summary.is_ground_truth) console.log('NOT GROUND TRUTH — includes model-corrected pages; numbers test the pipeline only.');
  console.log(JSON.stringify(summary, null, 1));
  for (const p of pages) console.log(`${String(p.seq).padStart(2)} ${p.id}  identity ${p.identity}  recall ${p.recall}  derge ${p.derge_identity}  edited ${p.edited_lines}  dropped ${p.dropped_lines}  unreadable ${p.unreadable_lines}  [${p.role}]`);
} else {
  console.error('usage: score.mjs ingest|score … (see header)'); process.exit(1);
}
