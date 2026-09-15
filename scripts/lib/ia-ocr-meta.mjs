// PRIOR ART: scripts/import/ia-ocr-ingest.mjs held these inline until 2026-09-12; they moved here
// so the provenance backfill (scripts/maintenance/backfill-ia-ocr-provenance.mjs) can share them
// without importing a script that runs on import. scripts/lib/ia-*.mjs — none touch OCR metadata.
//
// ia-ocr-meta — what the Internet Archive tells us about its own reading of an item, and the
// `ocr.ia` provenance block the reader's "how this page was made" panel renders.
//
// `ocr` (engine name) is absent on most older items; `ocr_converted` ("abbyy-to-hocr 1.1.11")
// still names the engine family, and the `_djvu.xml` file's mtime is the date the text was
// (re)generated — often 2023–24 even for 2008 scans, because the Archive re-ran OCR fleet-wide.

const UA = 'SourceLibrary ia-ocr (team@sourcelibrary.org)';

// ---------- rate-limited fetch, abort on repeated refusal (a guard travels with the file) ----------
// A refusal is a 429/503 response OR a thrown network error ("fetch failed", "other side
// closed"): the Latin dry run died at book 3,510 of 7,684 on 2026-09-13 because only the
// former was handled. Both back off 15 s and count toward the abort.
let lastReq = 0, consecutiveRefusals = 0;
export async function iaFetch(url, { minIntervalMs = 500, maxRefusals = 4 } = {}) {
  const wait = minIntervalMs - (Date.now() - lastReq); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  } catch (e) {
    consecutiveRefusals++;
    console.error(`  archive.org network error (${consecutiveRefusals}/${maxRefusals}): ${e?.cause?.code || e?.message || e}`);
    if (consecutiveRefusals >= maxRefusals) { console.error(`ABORT: ${consecutiveRefusals} consecutive network errors from archive.org`); process.exit(3); }
    await new Promise((r) => setTimeout(r, 15000)); return iaFetch(url, { minIntervalMs, maxRefusals });
  }
  if (res.status === 429 || res.status === 503) {
    consecutiveRefusals++;
    if (consecutiveRefusals >= maxRefusals) { console.error(`ABORT: ${consecutiveRefusals} consecutive ${res.status} from archive.org`); process.exit(3); }
    await new Promise((r) => setTimeout(r, 15000)); return iaFetch(url, { minIntervalMs, maxRefusals });
  }
  consecutiveRefusals = 0;
  return res;
}

export async function iaOcrMeta(id) {
  const res = await iaFetch(`https://archive.org/metadata/${id}`);
  if (!res.ok) return {};
  const j = await res.json(); const m = j?.metadata || {};
  // Every `_djvu.xml` on the item, by name. The derivative is named after the UPLOADED file, not
  // the identifier: 129 of the first 184 "no _djvu.xml" English items (2026-09-13 survey) carried
  // one under another name (`0327725.nlm.nih.gov` → `0327725_djvu.xml`, `4725496worshipofpriapus`
  // → `4725496-Worship-of-Priapus_djvu.xml`). An item with several is several scans — ambiguous.
  const xmlFiles = (j?.files || []).filter((f) => /_djvu\.xml$/.test(f.name || ''));
  const xmlFile = xmlFiles.find((f) => f.name === `${id}_djvu.xml`) || xmlFiles[0];
  const converter = m.ocr_converted || null;
  const engine = m.ocr || (/abbyy/i.test(converter || '') ? 'ABBYY FineReader' : /tesseract/i.test(converter || '') ? 'Tesseract' : null);
  return {
    engine, version: m.ocr_module_version || null, converter,
    ocr_date: xmlFile?.mtime ? new Date(+xmlFile.mtime * 1000) : null,
    scandate: m.scandate ? String(m.scandate).slice(0, 8) : null,
    contributor: m.contributor || null,
    detected_lang: m.ocr_detected_lang || null,
    imagecount: m.imagecount ? +m.imagecount : null,
    has_djvu_xml: !!xmlFile,
    djvu_xml_files: xmlFiles.map((f) => f.name),
  };
}

/** The `ocr.ia` block written on every ia_djvu page (see src/lib/types/page.ts OcrData.ia). */
export function iaProvenance(iaId, meta) {
  return {
    item: iaId, engine: meta.engine || null, module_version: meta.version || null, converter: meta.converter || null,
    ocr_date: meta.ocr_date || null, scandate: meta.scandate || null, contributor: meta.contributor || null,
    detected_lang: meta.detected_lang || null, item_url: `https://archive.org/details/${iaId}`,
  };
}
