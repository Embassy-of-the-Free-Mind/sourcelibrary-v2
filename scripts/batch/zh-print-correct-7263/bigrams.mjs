// PRIOR ART: scripts/lib/leaf-shift.mjs (a vote on printed page numbers, which these pages mostly do not print) and
// scripts/lib/block-page-guard.mjs (anchors copied from a page's source for a TRANSLATION block). This compares OCR with OCR.
/** Han bigrams of a text, tags out. */
export const bigrams = (t) => { const h = String(t || '').replace(/<[^>]+>/g, '').match(/[㐀-鿿豈-﫿]/g) || []; const s = new Set(); for (let i = 0; i + 1 < h.length; i++) s.add(h[i] + h[i + 1]); return s; };
export const dice = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return 2 * n / (a.size + b.size); };
