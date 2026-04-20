#!/usr/bin/env node
/**
 * Harvest Standard Babylonian Gilgamesh tablets from CDLI + eBL.
 *
 * Strategy:
 * 1. Look up known principal tablets for each of the 12 tablets
 * 2. Get CDLI photo URLs and metadata
 * 3. Check eBL API for ATF transliteration
 * 4. Output structured JSON for the tablet reader
 *
 * Sources:
 * - CDLI composite Q002873 (Gilgamesh epic tablets 1-12)
 * - eBL API: https://www.ebl.lmu.de/api/fragments/{museumNo}
 * - CDLI photos: https://cdli.earth/dl/photo/{pNumber}.jpg
 * - Thompson 1930 (will supplement ATF once OCR'd)
 *
 * Usage:
 *   node scripts/etcsl/harvest-gilgamesh-tablets.mjs
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Principal tablets for the Standard Babylonian Gilgamesh ──
// These are the best-preserved witnesses for each tablet number.
// Museum numbers are British Museum K-numbers (Kuyunjik/Nineveh) unless noted.
const GILGAMESH_TABLETS = [
  {
    tablet: 1,
    title: 'Tablet I: "He who saw the Deep"',
    summary: 'Introduction to Gilgamesh, king of Uruk. Creation of Enkidu. The wild man and the trapper.',
    witnesses: [
      { museumNo: 'K.3375+', pNumber: 'P273210', note: 'Also contains Tablet XI (Flood). Principal MS for both.' },
      { museumNo: 'K.8587', pNumber: 'P396024', note: 'Fragment, opening lines' },
    ],
  },
  {
    tablet: 2,
    title: 'Tablet II: Enkidu comes to Uruk',
    summary: 'Enkidu is civilized. He challenges Gilgamesh. They become friends.',
    witnesses: [
      { museumNo: 'K.8590', pNumber: 'P396027', note: 'Neo-Assyrian, main witness' },
      { museumNo: 'Ni.2456', pNumber: 'P273176', note: 'Old Babylonian (Nippur)' },
    ],
  },
  {
    tablet: 3,
    title: 'Tablet III: The elders\' counsel',
    summary: 'The elders advise Gilgamesh. Ninsun prays to Shamash. Preparation for the Cedar Forest.',
    witnesses: [
      { museumNo: 'K.8591', pNumber: 'P396028', note: 'Main Nineveh witness' },
    ],
  },
  {
    tablet: 4,
    title: 'Tablet IV: Journey to the Cedar Forest',
    summary: 'Five dream sequences on the journey. Gilgamesh and Enkidu approach Humbaba.',
    witnesses: [
      { museumNo: 'K.8588', pNumber: 'P396025', note: 'Fragments of dream sequences' },
    ],
  },
  {
    tablet: 5,
    title: 'Tablet V: Battle with Humbaba',
    summary: 'They enter the Cedar Forest. Defeat of Humbaba with Shamash\'s help.',
    witnesses: [
      { museumNo: 'K.8589', pNumber: 'P396026', note: 'Forest description' },
      { museumNo: 'MS 3263', pNumber: 'P461375', note: 'Recently published, fills major gaps' },
    ],
  },
  {
    tablet: 6,
    title: 'Tablet VI: Ishtar\'s proposal',
    summary: 'Ishtar proposes to Gilgamesh. He refuses. The Bull of Heaven.',
    witnesses: [
      { museumNo: 'K.3382', pNumber: 'P394425', note: 'Well-preserved Nineveh tablet' },
    ],
  },
  {
    tablet: 7,
    title: 'Tablet VII: Death of Enkidu',
    summary: 'The gods decree Enkidu must die. His deathbed vision of the underworld.',
    witnesses: [
      { museumNo: 'K.3382', pNumber: 'P394425', note: 'Continuation from Tablet VI on same physical tablet' },
    ],
  },
  {
    tablet: 8,
    title: 'Tablet VIII: Gilgamesh mourns Enkidu',
    summary: 'Lament for Enkidu. Gilgamesh commissions a statue. The funeral.',
    witnesses: [
      { museumNo: 'K.2635', pNumber: 'P394093', note: 'Funeral preparations' },
    ],
  },
  {
    tablet: 9,
    title: 'Tablet IX: The quest for immortality',
    summary: 'Gilgamesh seeks Utnapishtim. Journey through the mountains. The scorpion-people.',
    witnesses: [
      { museumNo: 'K.3514', pNumber: 'P394444', note: 'Scorpion-people passage' },
    ],
  },
  {
    tablet: 10,
    title: 'Tablet X: At the edge of the world',
    summary: 'The tavern-keeper Siduri. The ferryman Urshanabi. Crossing the Waters of Death.',
    witnesses: [
      { museumNo: 'K.2774', pNumber: 'P394161', note: 'Siduri\'s advice' },
      { museumNo: 'K.3012', pNumber: 'P394332', note: 'Waters of Death crossing' },
    ],
  },
  {
    tablet: 11,
    title: 'Tablet XI: The Flood',
    summary: 'Utnapishtim tells the Flood story. The plant of youth. Return to Uruk.',
    witnesses: [
      { museumNo: 'K.3375', pNumber: 'P273210', note: 'The famous "Flood Tablet" — most complete single tablet of the epic' },
    ],
  },
  {
    tablet: 12,
    title: 'Tablet XII: Enkidu and the Netherworld',
    summary: 'Appendix. Enkidu\'s spirit describes the underworld. (Later addition, translated from Sumerian.)',
    witnesses: [
      { museumNo: 'K.2764', pNumber: 'P394152', note: 'Main witness for Tablet XII' },
    ],
  },
];

// ── Fetch helpers ──
async function fetchJson(url, timeout = 15000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function checkCdliPhoto(pNumber) {
  const url = `https://cdli.earth/dl/photo/${pNumber}.jpg`;
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return res.ok ? url : null;
  } catch { return null; }
}

async function getEblFragment(museumNo) {
  // Clean museum number for eBL API format
  const clean = museumNo.replace(/\+$/, '').trim();
  const data = await fetchJson(`https://www.ebl.lmu.de/api/fragments/${encodeURIComponent(clean)}`);
  if (!data) return null;
  return {
    atf: data.atf || '',
    description: data.description || '',
    hasPhoto: data.hasPhoto || false,
    cdliImages: data.cdliImages || [],
    script: data.script || {},
  };
}

// ── Main ──
async function main() {
  console.log('Harvesting Gilgamesh tablets from CDLI + eBL...\n');

  const corpus = [];

  for (const tablet of GILGAMESH_TABLETS) {
    console.log(`Tablet ${tablet.tablet}: ${tablet.title}`);
    const tabletData = {
      tablet: tablet.tablet,
      title: tablet.title,
      summary: tablet.summary,
      witnesses: [],
    };

    for (const witness of tablet.witnesses) {
      process.stdout.write(`  ${witness.museumNo} (${witness.pNumber})... `);

      // Check CDLI photo
      const photoUrl = await checkCdliPhoto(witness.pNumber);

      // Check eBL for ATF
      const ebl = await getEblFragment(witness.museumNo);

      const witnessData = {
        museumNo: witness.museumNo,
        pNumber: witness.pNumber,
        note: witness.note,
        cdliUrl: `https://cdli.earth/artifacts/${witness.pNumber.replace('P', '')}`,
        photoUrl,
        lineartUrl: `https://cdli.earth/dl/lineart/${witness.pNumber}_l.jpg`,
        detailPhotoUrl: `https://cdli.earth/dl/photo/${witness.pNumber}_d.jpg`,
        eblUrl: `https://www.ebl.lmu.de/fragmentarium/${witness.museumNo.replace(/\+$/, '')}`,
        atf: ebl?.atf || '',
        description: ebl?.description || witness.note,
        hasAtf: !!(ebl?.atf),
      };

      const status = [];
      if (photoUrl) status.push('photo');
      if (ebl?.atf) status.push('ATF');
      if (ebl?.description) status.push('desc');
      console.log(status.length ? status.join(', ') : 'metadata only');

      tabletData.witnesses.push(witnessData);

      // Polite delay
      await new Promise(r => setTimeout(r, 500));
    }

    corpus.push(tabletData);
  }

  // ── Summary ──
  const totalWitnesses = corpus.reduce((sum, t) => sum + t.witnesses.length, 0);
  const withPhotos = corpus.reduce((sum, t) => sum + t.witnesses.filter(w => w.photoUrl).length, 0);
  const withAtf = corpus.reduce((sum, t) => sum + t.witnesses.filter(w => w.hasAtf).length, 0);

  console.log(`\n── Summary ──`);
  console.log(`Tablets: ${corpus.length}`);
  console.log(`Witnesses: ${totalWitnesses}`);
  console.log(`With photos: ${withPhotos}`);
  console.log(`With ATF: ${withAtf}`);

  // ── Write output ──
  const outPath = join(__dirname, '..', 'output', 'gilgamesh-tablets.json');
  writeFileSync(outPath, JSON.stringify(corpus, null, 2));
  console.log(`\nWritten to: ${outPath}`);
}

main().catch(console.error);
