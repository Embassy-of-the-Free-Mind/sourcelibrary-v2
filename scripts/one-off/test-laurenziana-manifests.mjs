#!/usr/bin/env node
/**
 * Test Laurenziana ContentDM IIIF manifest URLs (corrected IDs)
 */

const manifests = [
  // Hermetica & Ficino
  { shelfmark: 'Plut.83.14', id: '1190117', label: 'Pimander (Ficino translation of Corpus Hermeticum)' },
  { shelfmark: 'Plut.89 sup.69', id: '926791', label: 'Trismegistus De potestate (Ficino)' },
  { shelfmark: 'Plut.89 sup.71', id: '1096587', label: 'Trismegistus per Apuleium/Ficinum' },
  { shelfmark: 'Plut.52.12', id: '822457', label: 'Hierocles + Hermes Trismegistus (Apuleius interp.)' },
  // Neoplatonism
  { shelfmark: 'Plut.82.10', id: '1035555', label: 'Plotinus (Ficino translation)' },
  { shelfmark: 'Plut.82.11', id: '1456157', label: 'Plotinus Books XXVII+ (Ficino)' },
  { shelfmark: 'Plut.82.7', id: '1025941', label: 'Plato Opera (Ficino)' },
  { shelfmark: 'Plut.82.6', id: '1189000', label: 'Plato Dialogi (Ficino)' },
  { shelfmark: 'Plut.82.15', id: '1001905', label: 'Synesius De somniis + Iamblichus/Proclus (Ficino)' },
  { shelfmark: 'Plut.71.32', id: '1209945', label: 'Porphyry Isagoge + Proclus + Ammonius' },
  { shelfmark: 'Plut.10.32', id: '64544', label: 'Iamblichus De Mysteriis Aegyptiorum' },
  // Orphica
  { shelfmark: 'Plut.70.35', id: '1198899', label: 'Orphei Hymni + Procli Hymni' },
  { shelfmark: 'Plut.32.45', id: '511600', label: 'Apollonius Argonautica + Orphei Argonautica' },
  { shelfmark: 'Plut.36.35', id: '597336', label: 'Orphei Carmina' },
  // Apuleius
  { shelfmark: 'Plut.68.2', id: '1335097', label: 'Tacitus + Apuleius (Codex F archetype)' },
  { shelfmark: 'Plut.54.14', id: '839971', label: 'Apuleius Metamorphoseon' },
];

async function test() {
  let working = 0;
  for (const m of manifests) {
    const url = `https://cdm21059.contentdm.oclc.org/iiif/plutei:${m.id}/manifest.json`;
    process.stdout.write(`${m.shelfmark} (${m.label})... `);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SourceLibrary/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { console.log(`HTTP ${res.status}`); continue; }
      const data = await res.json();
      const canvases = data.items?.length || data.sequences?.[0]?.canvases?.length || 0;
      if (canvases > 1) {
        console.log(`OK — ${canvases} pages`);
        working++;
      } else {
        console.log(`SKIP — only ${canvases} page(s)`);
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
  console.log(`\n${working}/${manifests.length} manifests have full page scans`);
}

test();
