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
    // What the item itself says about rights. Most 1880–1930 items say nothing (null).
    rights: m.rights ? String(m.rights).slice(0, 500) : null,
    licenseurl: m.licenseurl || null,
    copyright_status: m['possible-copyright-status'] || null,
    access_restricted: String(m['access-restricted-item'] || '').toLowerCase() === 'true',
    has_djvu_xml: !!xmlFile,
    djvu_xml_files: xmlFiles.map((f) => f.name),
  };
}

/**
 * The rights record for the Archive's OCR text of one item (`ocr.ia.licence`). A machine
 * transcription adds no authorship of its own, so the text carries the WORK's status: US public
 * domain when the edition was published more than 95 years before this year (1930 and earlier in
 * 2026). Any other case is recorded as not_recorded with the reason, never guessed. The item's own
 * rights fields are kept beside the verdict so a later reader can see what the Archive said.
 */
const PD_MARK = 'https://creativecommons.org/publicdomain/mark/1.0/';
export function iaTextLicence(meta, year, now = new Date()) {
  const lastPdYear = now.getUTCFullYear() - 96;
  const fromItem = { ia_rights: meta.rights || null, ia_licenseurl: meta.licenseurl || null, ia_copyright_status: meta.copyright_status || null, ia_access_restricted: !!meta.access_restricted };
  const base = { rule: 'ia-text-licence/1', jurisdiction: 'US', publication_year: year ?? null, ...fromItem };
  if (year && year <= lastPdYear) {
    return { ...base, status: 'publicdomain', licence_url: PD_MARK, basis: `published ${year}, before ${lastPdYear + 1}: US public domain (95-year term); a machine transcription adds no copyright` };
  }
  return { ...base, status: 'not_recorded', licence_url: null, basis: year ? `published ${year}: not yet US public domain by date alone; rights not assessed by this writer` : 'publication year unknown; rights not assessed by this writer' };
}

/** The `ocr.ia` block written on every ia_djvu page (see src/lib/types/page.ts OcrData.ia). */
export function iaProvenance(iaId, meta, { year } = {}) {
  return {
    item: iaId, engine: meta.engine || null, module_version: meta.version || null, converter: meta.converter || null,
    ocr_date: meta.ocr_date || null, scandate: meta.scandate || null, contributor: meta.contributor || null,
    detected_lang: meta.detected_lang || null, item_url: `https://archive.org/details/${iaId}`,
    licence: iaTextLicence(meta, year),
  };
}

/**
 * The `ocr.engine` block for a page that carries the Archive's own text (#6740), in the specialist-lane shape the
 * Syriac lane set (scripts/lib/syriac-kraken-lane.mjs ocrSetFields; src/lib/types/page.ts SpecialistEngine): which
 * engine read the leaf, which run copied it, and from which file. The Archive's OCR takes no prompt, so `prompt` says
 * so explicitly (a prompt slot that is absent reads as "the writer forgot"; this one is `n/a`). Pages written before
 * this block existed carry only `ocr.ia`; nothing here backfills them.
 * @param {object} meta     iaOcrMeta(...) for the item
 * @param {object} a
 * @param {string} a.run    the ingest run id (`ia-ocr-ingest/<ISO>/<host>@<sha>`)
 * @param {string} a.sourceUrl  the `_djvu.xml` URL with its `#leaf=` anchor
 * @param {number} a.leaf   the leaf index the text came from
 */
export function iaEngine(meta, { run, sourceUrl, leaf } = {}) {
  if (!run) throw new Error('iaEngine: run is required (the ingest run that copied the text)');
  if (!sourceUrl) throw new Error('iaEngine: sourceUrl is required (the file the text came from)');
  return {
    name: meta.engine || 'not_recorded',
    version: meta.version || 'not_recorded',
    model: 'ia-ocr',
    model_label: `Internet Archive OCR${meta.engine ? ` (${meta.engine}${meta.version ? ` ${meta.version}` : ''})` : ''}`,
    licence: 'see ocr.ia.licence (the text\'s rights, per item)',
    converter: meta.converter || 'not_recorded',
    route: 'print',
    read_mode: 'page',
    prompt: { status: 'n/a', reason: 'the Archive\'s OCR engine takes no prompt' },
    input: { source_url: sourceUrl, leaf: Number.isInteger(leaf) ? leaf : 'not_recorded', read_by: 'archive.org' },
    run,
    issue: 6740,
  };
}
