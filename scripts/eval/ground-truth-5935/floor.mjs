#!/usr/bin/env node
// #5935 step 2, the variation floor: for the 30 highest-CER pages of each reference, rebuild the
// alignment with its edit script and write a review packet (page image + every difference with its
// context), then fold the by-eye verdicts (ours / theirs / variant) back into a floor per reference.
//
//   packet:  node --env-file=… scripts/eval/ground-truth-5935/floor.mjs packet [--n=30]
//            → /root/ground-truth-5935/floor/<ref>/<rank>-<page_id>.{jpg,md}
//   score:   node scripts/eval/ground-truth-5935/floor.mjs score
//            reads scripts/eval/ground-truth-5935/floor-verdicts.json (committed: one entry per page,
//            the count of differing characters judged ours / theirs / variant / unclear)
//            → /root/ground-truth-5935/floor.json
//
// PRIOR ART: scripts/eval/reference-error-rate.mjs (hand-read reference errors for the bench's pinned
// references; per-reference, no ours/theirs/variant split, different references); tengyur-characterize/
// build-packet.mjs (a by-eye packet for one corpus). Neither covers Kanripo, CBETA or VRI.

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { extractTei, foldHan as foldCbeta } from '../../lib/cbeta-fit.mjs';
import { bodyText, foldHan, bodyCer } from './lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const WORK = argOf('work', '/root/ground-truth-5935');
const N = Number(argOf('n', 30));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const cmd = process.argv[2];
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

if (cmd === 'packet') {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const top = (rows) => rows.filter((r) => r.status === 'scored').sort((a, b) => b.cer - a.cer).slice(0, N);
  const sets = {
    'kanripo-wyg': top(readJsonl(`${WORK}/kanripo.jsonl`)),
    cbeta: top(readJsonl(`${WORK}/cbeta.jsonl`).filter((r) => r.reading === 'served-ocr' || r.primary)),
    'vri-cscd': top(readJsonl(`${WORK}/pali.jsonl`)),
  };
  const cbetaF = {};
  for (const [ref, rows] of Object.entries(sets)) {
    const dir = path.join(WORK, 'floor', ref);
    fs.mkdirSync(dir, { recursive: true });
    for (const [i, r] of rows.entries()) {
      const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { _id: 0, 'ocr.data': 1, archived_photo: 1, photo: 1, cropped_photo: 1 } });
      let Q, W, expected = r.expected;
      if (ref === 'kanripo-wyg') {
        const kr = r.ref_repo.replace('kanripo/', '');
        const j = Number(r.ref_pb.match(/_(\d{3})-/)[1]);
        const w = await workInfo(kr);
        const pbs = await pbPages(kr, 'WYG', w.juan_files.filter((x) => Math.abs(x - j) <= 1));
        const k = pbs.findIndex((x) => x.pb === r.ref_pb);
        W = pbs.slice(Math.max(0, k - 1), k + 2).map((x) => x.text).join('');
        Q = foldHan(bodyText(p.ocr.data));
      } else if (ref === 'cbeta') {
        const key = /X80n1565/.test(r.ref_edition) ? 'X80n1565.xml' : /X68n1319/.test(r.ref_edition) ? 'X68n1319.xml' : 'T47n1998A.xml';
        if (!cbetaF[key]) cbetaF[key] = foldCbeta(extractTei(fs.readFileSync(`/root/cbeta-5566/xml/${key}`, 'utf8'), JSON.parse(fs.readFileSync('/root/cbeta-5566/gaiji.json', 'utf8')))).f;
        W = cbetaF[key].slice(Math.max(0, r.ref_span[0] - 40), r.ref_span[1] + 40).join('');
        const text = r.reading === 'served-ocr' ? p.ocr.data : JSON.parse(fs.readFileSync(`/root/cbeta-5566/${key === 'X80n1565.xml' ? 'X1565' : key === 'X68n1319.xml' ? 'X1319' : 'T1998L'}/page-reads.json`, 'utf8'))[r.page_id]?.text;
        Q = foldCbeta(bodyText(text)).f.join('');
      } else {
        // Pali: the stream cache the arm wrote; the normaliser is the arm's (import would re-run it).
        const sc = r.script === 'latin' ? 'romn' : r.script === 'devanagari' ? 'deva' : 'sinh';
        const C = JSON.parse(fs.readFileSync(`${WORK}/vri-${sc}.stream.json`, 'utf8'));
        const pad = r.leaf === 'own' ? 300 : 60;
        W = C.L.slice(Math.max(0, r.ref_span[0] - pad), r.ref_span[1] + pad);
        const { normPali } = await import('./pali-norm.mjs');
        Q = normPali(p.ocr.data, sc);
      }
      const s = bodyCer(Q, W, { expected, ops: true });
      const img = p.cropped_photo || p.archived_photo || p.photo;
      const stem = path.join(dir, `${String(i + 1).padStart(2, '0')}-${r.page_id}`);
      try { const res = await fetch(img); if (res.ok) fs.writeFileSync(`${stem}.jpg`, Buffer.from(await res.arrayBuffer())); } catch { /* image noted as missing */ }
      const md = [
        `# ${ref} #${i + 1}  ${r.title}  p.${r.page_number}  CER ${r.cer} (recomputed ${s.cer.toFixed(4)})  leaf ${r.leaf}  engine ${r.engine}`,
        `book ${r.book_id} page ${r.page_id}  image ${img}`,
        `chars ours ${s.q_chars}, ref span ${s.span}, expected ${expected ?? '—'}, edits ${s.d}, omitted ${s.omitted}`,
        '', '## differences (ours → reference), with reference context', '',
        ...s.runs.slice(0, 80).map((u, k) => `${k + 1}. …${u.before}[${u.ours || '∅'} → ${u.ref || '∅'}]${u.after}…`),
        s.runs.length > 80 ? `… ${s.runs.length - 80} more` : '',
        '', '## ours (folded)', Q, '', '## reference window (folded)', W,
      ].join('\n');
      fs.writeFileSync(`${stem}.md`, md);
    }
    console.log(`${ref}: ${rows.length} packets in ${dir}`);
  }
  await client.close();
} else if (cmd === 'score') {
  // Floor = share of the differing characters on the reviewed pages that are NOT ours (theirs + variant).
  const V = JSON.parse(fs.readFileSync(path.join(HERE, 'floor-verdicts.json'), 'utf8'));
  const out = {};
  for (const [ref, pages] of Object.entries(V.refs)) {
    const t = { ours: 0, theirs: 0, variant: 0, unclear: 0, misaligned: 0 };
    for (const p of pages) for (const k of Object.keys(t)) t[k] += p[k] || 0;
    const judged = t.ours + t.theirs + t.variant;
    out[ref] = { pages: pages.length, ...t, share_not_ours: judged ? +((t.theirs + t.variant) / judged).toFixed(3) : null, share_misaligned_pages: +(pages.filter((p) => p.leaf_wrong).length / pages.length).toFixed(3) };
  }
  fs.writeFileSync(path.join(WORK, 'floor.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
