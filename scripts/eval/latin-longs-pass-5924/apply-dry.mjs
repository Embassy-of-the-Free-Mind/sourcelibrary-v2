// PRIOR ART: longs-pass.mjs `apply` (the raw pass over a jsonl, no gates); this runs the APPLY rule (scripts/lib/longs-orthography.mjs).
/**
 * apply-dry.mjs — the apply rule over the latin-repair-census pages, read-only (#5924). Counts gated / changed / held back
 * per engine and writes dry-changes.jsonl.gz (changed tokens per page), which apply-gate-draw.mjs draws from.
 *   LONGS_MODEL=<model.json.gz> JOB_SCRATCH=<dir with census-text.jsonl.gz> node apply-dry.mjs
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import readline from 'node:readline';
const L = await import('../../lib/longs-orthography.mjs');
const t0=Date.now();
const model = new L.Model(JSON.parse(zlib.gunzipSync(fs.readFileSync(process.env.LONGS_MODEL)).toString()));
console.log('model load', Date.now()-t0, 'ms');
const rl = readline.createInterface({ input: fs.createReadStream(process.env.JOB_SCRATCH+'/census-text.jsonl.gz').pipe(zlib.createGunzip()) });
const st = {}; const inc=(k,n=1)=>st[k]=(st[k]||0)+n; const ex=[];
const out = zlib.createGzip(); out.pipe(fs.createWriteStream(process.env.JOB_SCRATCH+'/dry-changes.jsonl.gz'));
let cpu=process.cpuUsage();
for await (const l of rl) {
  const r = JSON.parse(l); const eng = /flash-lite/.test(r.ocr_meta.model)?'lite':r.ocr_meta.model==='gemini-3-flash-preview'?'flash':'other';
  inc(eng+':pages');
  if (eng==='other') continue;
  const sv = L.pageScriptVerdict(r.text); if (!sv.ok) { inc(eng+':skip_script'); continue; }
  const lv = L.pageLatinVerdict(r.text); if (!lv.ok) { inc(eng+':skip_'+lv.reason); continue; }
  const o = L.applyLongS(r.text, model);
  inc(eng+':eligible'); inc(eng+':changes', o.kept); for (const [k,v] of Object.entries(o.reverted)) inc(eng+':rev_'+k, v);
  if (o.kept) { inc(eng+":pages_changed"); 
    const a=[...r.text], b=[...o.text]; const toks=new Set();
    // collect changed tokens
    const words=[...o.text.matchAll(/[\p{L}\p{M}]+/gu)];
    for (const w of words) if (w[0].includes('ſ')) { const orig=r.text.slice(w.index,w.index+w[0].length); if (orig!==w[0]) toks.add(orig+'→'+w[0]); }
    out.write(JSON.stringify({ id:r.id, book_id:r.book_id, page_number:r.page_number, eng, kept:o.kept, rev:o.reverted, habit:o.habit, toks:[...toks] })+'\n');
  }
}
out.end();
cpu=process.cpuUsage(cpu); console.log(JSON.stringify(st,null,1)); console.log('cpu s', (cpu.user+cpu.system)/1e6);
