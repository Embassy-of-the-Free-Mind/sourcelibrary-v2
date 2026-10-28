#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/tib-derge.py (places a folio in OpenPecha P000001 and scores a text against
// its window; used unchanged here) and cli-ocr.mjs apply (the guards). The wave-2 apply (#6740, 2026-10-27) applied
// Derek's 23:15Z Derge rule with glue that was never committed; this is that glue, so wave 3 (#7263) is reproducible.
/**
 * The Derge-identity guard of the Flash-low Tibetan correction (Derek 2026-10-26 23:15Z, #6740): a page is written only
 * if the correction does not lower its Derge identity by more than 0.01, where the draft has a parallel (identity >= 0.85).
 *
 *   rows  --dir=READ_DIR --verdicts=V.jsonl --drafts=D.jsonl --out=R.jsonl   (needs --env-file)
 *         D: {key, text} the stored draft of every corrected page (kept: after the apply the stored OCR is the correction).
 *         R: {key, route: draft|corr, text}: the correction as apply would write it (ya-btags reverts applied).
 *   then: tib-derge.py locate --p1 P1 D.jsonl L.jsonl ; this `score-in` ; tib-derge.py score --p1 P1 IN.jsonl S.json
 *   score-in --rows=R.jsonl --located=L.jsonl --out=IN.jsonl
 *   only  --dir=READ_DIR --scores=S.json --out=ONLY.json --refused=REFUSED.json
 *         ONLY: every corrected page id but those the rule keeps on the draft. REFUSED rows say why.
 */
import fs from 'node:fs';
import path from 'node:path';
import { yatagsHits, revertHits } from '../../../lib/tibetan-yatags-guard.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const PARALLEL = 0.85, DROP = 0.01;
const metasOf = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  .filter((m) => m.mode === 'correct' && m.exit === 0 && !m.wrapper);

if (CMD === 'rows') {
  const DIR = arg('dir');
  const metas = metasOf(DIR);
  const verdicts = new Map(readJsonl(arg('verdicts')).map((v) => [v.page_id, v]));
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: metas.map((m) => m.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p.ocr?.data ?? '']));
  await c.close();
  const drafts = [], rows = []; const t = { metas: metas.length, stale_draft: 0, rows: 0 };
  for (const m of metas) {
    const draft = pages.get(m.page_id);
    if (draft == null || contentHash(draft) !== m.draft?.text_hash) { t.stale_draft++; continue; }
    let text = fs.readFileSync(path.join(DIR, `${m.page_id}.txt`), 'utf8').trim();
    const hits = yatagsHits(draft, text);
    if (hits.length) { const v = verdicts.get(m.page_id); if (v) text = revertHits(text, hits, new Set(v.keep || [])); }
    drafts.push({ key: m.page_id, text: draft });
    rows.push({ key: m.page_id, route: 'draft', text: draft }, { key: m.page_id, route: 'corr', text });
    t.rows++;
  }
  writeJsonl(arg('drafts'), drafts); writeJsonl(arg('out'), rows);
  console.log(JSON.stringify(t));
} else if (CMD === 'score-in') {
  const loc = new Map(readJsonl(arg('located')).map((l) => [l.key, l]));
  const out = readJsonl(arg('rows')).map((r) => ({ ...r, vol: loc.get(r.key)?.vol ?? null, imgnum: loc.get(r.key)?.imgnum ?? null }));
  writeJsonl(arg('out'), out);
  console.log(`score-in: ${out.length} rows, ${out.filter((r) => r.vol).length} placed`);
} else if (CMD === 'only') {
  const S = JSON.parse(fs.readFileSync(arg('scores'), 'utf8')).pages;
  const ids = metasOf(arg('dir')).map((m) => m.page_id);
  const refused = [], keep = []; const t = { pages: ids.length, no_parallel: 0, parallel: 0, refused: 0, not_scored: 0 };
  for (const id of ids) {
    // a read made after `rows` ran (or a draft rewritten since) was never scored: refuse it, never pass it as "no parallel"
    if (!S[id]) { t.not_scored++; refused.push({ page_id: id, why: 'not scored (read after rows ran, or stale draft)' }); continue; }
    const d = S[id]?.draft?.identity, x = S[id]?.corr?.identity;
    if (d == null || x == null || d < PARALLEL) { t.no_parallel++; keep.push(id); continue; }
    t.parallel++;
    if (x < d - DROP) { t.refused++; refused.push({ page_id: id, draft: d, corr: x, why: `Derge identity falls ${d} -> ${x}` }); continue; }
    keep.push(id);
  }
  fs.writeFileSync(arg('out'), JSON.stringify(keep)); fs.writeFileSync(arg('refused'), JSON.stringify(refused, null, 1));
  console.log(JSON.stringify(t));
} else {
  console.error('usage: derge-guard.mjs rows|score-in|only (see the header)'); process.exit(2);
}
