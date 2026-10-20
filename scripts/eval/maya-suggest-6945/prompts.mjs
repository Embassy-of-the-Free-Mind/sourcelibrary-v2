// #6903 stage 2 prompt builder: round 2's arms on Palenque blocks (Stuart 2006).
//   OK   = round 2's best Opus arm: catalogue + retrieved readings (here: layout neighbours + sister-tablet positions).
//   TEAM = Opus checks Gemini 4 Argon's OK-prompt output against the same context (round 2's team arm).
//   BARE = recall control: crop only. No monument, no coordinate, no neighbours, no catalogue; blocks shuffled across
//          monuments; it is also asked to name the source monument, which measures whether it recognises the famous text.
//   NOIMG = second recall control (added in this run): the OK prompt with the crops WITHHELD — monument, coordinates,
//          catalogue and parallels only. What it reads comes from memory of the published text plus the context.
// The task wording, output shape and "say unread rather than guess" line are round 2's. Round 2's caption gloss is dropped:
// a Palenque test block is not part of a caption the model can see.
// PRIOR ART: round 2's prompts2.mjs (on l7a, not committed: it embeds a private key); this is its Palenque port.
import fs from 'node:fs';
export const MS = process.env.MS || '/data/scratch/sl/jobs/maya-suggest-6945/';
const R1 = process.env.R1 || '/data/scratch/sl/jobs/maya-glyph-6903/';
export const items = JSON.parse(fs.readFileSync(MS + 'set/items.json', 'utf8'));
export const bare = JSON.parse(fs.readFileSync(MS + 'set/bare.json', 'utf8'));
const cat = fs.readFileSync(R1 + 'refs/catalogue/catalogue.tsv', 'utf8');
const rd = (f) => (fs.existsSync(MS + f) ? JSON.parse(fs.readFileSync(MS + f, 'utf8')) : null);

const FIELDS = `For each block give:
- "signs": the signs in the block as Thompson catalogue numbers (e.g. "T1.T533.T24"), main sign and affixes, in reading order;
- "translit": a transliteration (syllables in lowercase, logograms in UPPERCASE, hyphens between signs, e.g. "u-CHAK-ki");
- "gloss": a short English gloss of the block;
- "confidence": your confidence 0.0-1.0 that the transliteration is right;
- "unread": true if the block is too damaged, or you cannot identify its signs. In that case leave signs/translit/gloss empty. Say "unread" rather than guess: a wrong reading stated confidently is worse than an honest "unread".`;
const shape = (it, extra = '') => `<<<BEGIN>>>
{"blocks":[${it.blocks.map((b, i) => `{"pos":"${it.bare ? 'X' + (i + 1) : b.coord}","signs":"","translit":"","gloss":"","confidence":0.0,"unread":false${extra}}`).join(',')}]}
<<<END>>>`;
const TASK = (it) => `${FIELDS}\n\nOutput ONLY this JSON between the markers, nothing else:\n${shape(it)}`;

function describe(it) {
  const imgs = it.blocks.map((b) => `block ${b.coord}: {IMG:${b.img}}`).join('\n');
  return `The images below are crops from a line drawing of the ${it.monument_name}, Palenque (Late Classic Maya, dedicated 692 CE), as published in David Stuart's sourcebook *The Palenque Mythology* (2006). Each image is ONE glyph block, cut along the drawing's printed column letters and row numbers; the label is its coordinate. A crop may include slivers of neighbouring blocks at its edges; those are not part of the block. Bar-and-dot numbers inside a block are part of it.\n\n${imgs}`;
}

function retrievedBlock(it) {
  const R = it.retrieval || [];
  let s = `\n\nRETRIEVED PARALLELS: David Stuart's published readings of ${R.length} OTHER blocks, chosen by position only: blocks near yours in reading order on the same inscription (blocks in this test are left out, so there are gaps), then the block at the same coordinate on the two sister tablets of the Cross Group, whose texts run in parallel. Text only; none of them is one of your blocks. Use them as an epigrapher uses context and parallel passages, but check each block against its image before you borrow a reading.\n`;
  for (const r of R) s += `  ${r.monument_name} ${r.coord} (${r.why}): ${r.translit} | ${r.transcription} | "${r.translation}"\n`;
  s += `\n(Stuart's conventions: logograms in UPPERCASE, syllables lowercase, numbers as digits, "?" uncertain or unread, [ ] reconstructed, ( ) underspelled.)\n`;
  return s;
}

function teamBlock(it) {
  const G = rd('set/team_proposals.json')?.[it.id];
  let s = `\n\nPROPOSED READING to check (from another model, which on an earlier test read about a third of blocks right and stated wrong readings with the same high confidence as right ones):\n`;
  if (!G) return s + '  (no proposal: the other model failed on this group)\n';
  it.blocks.forEach((b, i) => {
    const p = (G.blocks || []).find((x) => x.pos === b.coord) || (G.blocks || [])[i] || {};
    s += `  ${b.coord}: ${p.unread || !p.translit ? 'unread' : `signs ${p.signs || '-'} | translit ${p.translit} | gloss ${p.gloss || '-'} | its confidence ${p.confidence}`}\n`;
  });
  return s;
}
const TEAM_TASK = (it) => `Your job is to CHECK the proposal block by block against the image, the sign catalogue and the retrieved parallels. For each block answer:
- "verdict": "accept" (the proposed transliteration is right as it stands), "correct" (it is wrong or partly wrong and you can see the right reading: give it), or "decline" (you cannot confirm it and cannot supply a reading you would stand behind). Accept only what you can verify in the image; a wrong "accept" is the worst outcome, an honest "decline" costs nothing.
- "signs", "translit", "gloss": the reading you stand behind (the proposal's if you accept, yours if you correct; empty if you decline);
- "confidence": 0.0-1.0 that your final transliteration is right;
- "reason": one short line (which sign you checked, which parallel decided it).

Output ONLY this JSON between the markers, nothing else:
<<<BEGIN>>>
{"blocks":[${it.blocks.map((b) => `{"pos":"${b.coord}","verdict":"accept|correct|decline","signs":"","translit":"","gloss":"","confidence":0.0,"reason":""}`).join(',')}]}
<<<END>>>`;

const BARE_TASK = (it) => `${FIELDS}
- "source_guess": if you recognise the specific monument this block comes from, name it (site, monument, and the block's position if you know it); otherwise "unknown";
- "source_confidence": 0.0-1.0 that your source_guess is right (0 for "unknown").

Output ONLY this JSON between the markers, nothing else:
${shape(it, ',"source_guess":"","source_confidence":0.0')}`;

export function buildPrompt(arm, it) {
  if (arm === 'NOIMG') {
    const p = buildPrompt('OK', it).replace(/\{IMG:[^}]+\}/g, '[image withheld]');
    return p + `\n\nNOTE: in this test the images are WITHHELD. Give the reading you would expect at each coordinate from the context above and your own knowledge of this inscription, with an honest confidence; say "unread" where you cannot.`;
  }
  if (arm === 'BARE') {
    const imgs = it.blocks.map((b, i) => `X${i + 1}: {IMG:${b.img}}`).join('\n');
    return `You are an epigrapher reading Maya hieroglyphs. The images below are crops of single glyph blocks from line drawings of Classic-period Maya stone inscriptions, given in random order (they are not a continuous text). A crop may include slivers of neighbouring blocks at its edges; those are not part of the block. Bar-and-dot numbers inside a block are part of it.\n\n${imgs}\n\n${BARE_TASK({ ...it, bare: true })}`;
  }
  let p = `You are an epigrapher reading Maya hieroglyphs. ${describe(it)}\n\n`;
  p += arm === 'TEAM' ? TEAM_TASK(it) : TASK(it);
  p += `\n\nSIGN CATALOGUE (tab-separated: Thompson numbers, other catalogue codes, value, type, note; from the Bonn TWKM sign catalogue and Montgomery's dictionary). Use it to identify signs and their values:\n${cat}`;
  p += retrievedBlock(it);
  if (arm === 'TEAM') p += teamBlock(it);
  p += `\n\nNow ${arm === 'TEAM' ? 'check the proposal for' : 'read'} the block${it.blocks.length > 1 ? 's' : ''} ${it.blocks.map((b) => `${b.coord} {IMG:${b.img}}`).join(', ')}. Output ONLY the JSON between <<<BEGIN>>> and <<<END>>>.`;
  return p;
}
export const groups = (arm) => (arm === 'BARE' ? bare : items);
export const imagesOf = (p) => [...new Set([...p.matchAll(/\{IMG:([^}]+)\}/g)].map((m) => m[1]))];
