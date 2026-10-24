// IAST matching helpers for placing a leaf in an edition (#7119).
// PRIOR ART: ../whish147-palm-leaf-opus-2026-10-21/score_vs_gretil.py — the same normalisation (spacing,
// punctuation, anusvāra, scribal gemination after r), there for a CER, here for finding a phrase's offset.

/** Fold one character run for matching; returns [folded string, map from folded index -> original index]. */
export function fold(s) {
  const out = [], map = [];
  const src = s.normalize('NFC').toLowerCase();
  for (let i = 0; i < src.length; i++) {
    let c = src[i];
    if (/[ṃṁ]/.test(c)) c = 'm';
    else if (/[ṅñṇ]/.test(c)) c = 'n';
    else if (c === 'ḥ') continue;
    else if (!/\p{L}|\p{M}/u.test(c)) continue;
    out.push(c); map.push(i);
  }
  // scribal gemination after r: rtt -> rt, rmm -> rm, ...
  let f = out.join('');
  const keep = [];
  for (let i = 0; i < f.length; i++) {
    if (i >= 2 && f[i - 2] === 'r' && f[i] === f[i - 1] && !/[aeiouāīūṛ]/.test(f[i])) continue;
    keep.push(i);
  }
  return [keep.map((i) => f[i]).join(''), keep.map((i) => map[i])];
}

/** Offsets (in `text`) of every exact folded occurrence of `phrase`, longest-first fallback down to 6 letters. */
export function findAll(text, phrase, folded = null) {
  const [ft, fmap] = folded || fold(text);
  let [fp] = fold(String(phrase || '').replace(/\(.*?\)|\[.*?\]|…|\.\.\./g, ' '));
  const hits = [];
  while (fp.length >= 6) {
    let i = ft.indexOf(fp);
    while (i >= 0) { hits.push({ start: fmap[i], end: fmap[i + fp.length - 1] + 1, len: fp.length }); i = ft.indexOf(fp, i + 1); }
    if (hits.length) return hits;
    fp = fp.slice(0, Math.max(6, Math.floor(fp.length * 0.7))) === fp ? '' : fp.slice(0, Math.max(6, Math.floor(fp.length * 0.7)));
  }
  return hits;
}
