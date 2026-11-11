// Boundary probe (#7119): which pages hold a work's opening invocation or closing colophon. One sealed Opus call per
// scan, the two whole leaves as p01 (upper) and p02 (lower). Run: node probe.mjs <first> <last>
import path from 'node:path';
import { sealedCall, pool, SCRATCH, boxes } from './lib.mjs';

const PROMPT = `The files p01.jpg and p02.jpg are the upper and lower leaf of one scan of a Kerala palm-leaf manuscript (Sanskrit in Malayalam script, 1822). It holds several Sanskrit works copied one after another: the Sāṅkhyakārikā, Śaṅkara's Jayamaṅgalā commentary on it, Vācaspati Miśra's Tattvakaumudī, an unidentified fragment, Annambhaṭṭa's Tarkasaṃgrahadīpikā, and his Tarkasaṃgraha.

Look at each leaf (open both files with the Read tool). I only need to know whether a work ENDS or BEGINS on it:
- an opening formula, e.g. ഹരിഃ ശ്രീഗണപതയേ നമഃ (hariḥ śrīgaṇapataye namaḥ) or അവിഘ്നമസ്തു (avighnam astu);
- a closing colophon, e.g. ഇതി … സമാപ്താ / സമാപ്തഃ (iti … samāptā), often followed by a short blessing and a run of double dandas or a blank stretch;
- a leaf that is blank, a cover board, or has text in a different hand or language (e.g. an English label or Malayalam prose).

Do not transcribe the leaf. Report only what you can actually see; if you are not sure, say unsure.
Answer in exactly this form, one line per leaf:
p01 | none | opening | colophon | blank | other  | where on the leaf (row, left/middle/right) | any words of the formula or colophon you can read, in IAST | sure/unsure
p02 | ...`;

const [a, b] = process.argv.slice(2).map(Number);
const B = boxes();
const pages = Object.keys(B).map(Number).filter((n) => n >= a && n <= b && Object.keys(B[n].leaves).length === 2);
await pool(pages, 3, async (n) => {
  const r = await sealedCall({ stage: 'probe', id: String(n), model: 'opus', prompt: PROMPT, images: ['t', 'b'].map((l) => path.join(SCRATCH, 'leaves', `${n}-${l}.jpg`)) });
  console.log(`== ${n}${r.cached ? ' (cached)' : ''} ${r.meta.secs}s\n${r.text.split('\n').filter((l) => /^p0[12]/.test(l)).join('\n')}`);
});
