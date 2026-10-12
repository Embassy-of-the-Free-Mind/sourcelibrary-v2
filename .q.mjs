import fs from 'node:fs';
const P = process.env.JOB_SCRATCH + '/4442/detail.json';
const det = JSON.parse(fs.readFileSync(P, 'utf8'));
const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(40000), headers: { accept: 'application/json', 'user-agent': 'SourceLibrary-audit/1.0 (sourcelibrary.org)' } }); if (!r.ok) return { err: r.status }; return await r.json(); } catch (e) { return { err: e.message }; } };
const canvases = (m) => m?.sequences?.[0]?.canvases?.length ?? (Array.isArray(m?.items) ? m.items.length : null);
for (const r of det) {
  if (r.source_pages) continue;
  const m2 = /^IA imagecount \(([^)]+)\)/.exec(r.source_how || '');
  if (m2) { const m = await get(`https://archive.org/metadata/${encodeURIComponent(m2[1])}`); const files = m?.files || []; const zips = files.filter(f => /_jp2\.zip$/.test(f.name)); const pdfs = files.filter(f => /\.pdf$/.test(f.name) && !/_text\.pdf$/.test(f.name));
    r.ia_files = { jp2_zips: zips.length, jp2_mb: Math.round(zips.reduce((a, f) => a + Number(f.size || 0), 0) / 1e6), pdfs: pdfs.length, pdf_mb: Math.round(pdfs.reduce((a, f) => a + Number(f.size || 0), 0) / 1e6) };
    const sds = files.filter(f => /_scandata\.xml$/.test(f.name)); let leaves = 0;
    for (const sd of sds.slice(0, 12)) { try { const t = await (await fetch(`https://archive.org/download/${encodeURIComponent(m2[1])}/${encodeURIComponent(sd.name)}`, { signal: AbortSignal.timeout(60000) })).text(); leaves += (t.match(/<page /g) || []).length; } catch { } }
    r.ia_files.scandata_files = sds.length; r.ia_files.scandata_leaves = leaves || null;
    console.log(`${r.id.slice(-6)} [${r.pages_count}p] ${JSON.stringify(r.ia_files)} | ${String(r.title).slice(0, 44)}`);
  }
}
fs.writeFileSync(P, JSON.stringify(det, null, 1));
// Harvard: one polite pass, 20 s apart, no retries.
for (const r of det) {
  if (r.source_pages || r.provider !== 'harvard') continue;
  const u = /^IIIF (\S+)/.exec(r.source_how || '')?.[1]; if (!u) continue;
  await new Promise(s => setTimeout(s, 20000));
  const m = await get(u); r.source_pages = canvases(m); r.source_how = `IIIF ${u}` + (m?.err ? ` ERR ${m.err}` : '');
  console.log(`${r.id.slice(-6)} [${r.pages_count}p] src=${r.source_pages} ${m?.err || ''} | ${String(r.title).slice(0, 44)}`);
  fs.writeFileSync(P, JSON.stringify(det, null, 1));
}
