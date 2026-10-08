// PRIOR ART: /root/tattva-6184/crop.mjs + decide.mjs (#6184 tie-break, not in the repo) — single-pair majority, no per-slot print scoring; copied and extended here.
// Token scoring for #6184 reader diversity: locate each ground-truth slot in a read by character alignment
// against the stored Flash read, then ask whether the aligned window holds the PRINT reading.
import { diffChars } from 'diff';
export const norm = (t) => (t || '').normalize('NFC')
  .replace(/<[^>]*>/g, '').replace(/->|<-|\*\*/g, '')
  .replace(/-\s*\n/g, '')
  .replace(/[^ऀ-ॣ॰-ॿ]/g, '');   // keep Devanagari letters/marks/avagraha; drop dandas, digits, latin, spaces
// map positions of a into b via a char diff
export function mapper(a, b) {
  const parts = diffChars(a, b); const map = new Int32Array(a.length + 1); let i = 0, j = 0;
  for (const p of parts) {
    if (p.added) { j += p.value.length; continue; }
    if (p.removed) { for (let k = 0; k < p.value.length; k++) map[i++] = j; continue; }
    for (let k = 0; k < p.value.length; k++) map[i++] = j++;
  }
  map[a.length] = j; return map;
}
export function locate(refNorm, slot) {
  const tok = norm(slot.flash); const occ = [];
  let k = -1; while ((k = refNorm.indexOf(tok, k + 1)) >= 0) occ.push(k);
  if (!occ.length) return null;
  return { start: occ[slot.occ ?? 0], end: occ[slot.occ ?? 0] + tok.length, n: occ.length };
}
// returns {right, span}
export function scoreRead(refNorm, readText, slot, cache) {
  const r = norm(readText);
  const m = cache?.get(readText) || mapper(refNorm, r); cache?.set(readText, m);
  const loc = locate(refNorm, slot); if (!loc) throw new Error('slot not in ref ' + slot.id);
  const s = m[loc.start], e = m[loc.end];
  const core = norm(slot.core || slot.print);
  const pad = 8;
  const win = r.slice(Math.max(0, s - pad), e + pad);
  let right = win.includes(core), fallback = false;
  const wrongs = [slot.flash, slot.lite].map(norm).filter((w) => !w.includes(core));
  if (!right && !wrongs.some((w) => win.includes(w))) {
    // alignment lost the slot (tables, reordered columns): decide on the whole page
    fallback = true;
    right = r.includes(core) && !wrongs.some((w) => r.includes(w));
  }
  return { right, fallback, span: r.slice(s, e), win };
}
