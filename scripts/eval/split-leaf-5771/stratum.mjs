// PRIOR ART: compare.mjs and packet.mjs each defined the stratum inline, differently (packet.mjs left out the two
// by-eye leafsplit-fallback frames, a018 and a065), so audit-key.json and score.json counted RECUT 10 where compare.json
// and the record count 12. Both import this one definition now. Neither can be imported for it: both run on load.
/**
 * The pre-registered strata of job split-leaves-5771 (#5771): SEAM = the stored read is a whole-page read; RECUT = a
 * leaf read whose crop this job changed (a wrong ledger cut, or a frame the detector could not cut, recut by eye);
 * SAME = the rest.
 */
export const stratum = (f) => (f.stored.read_mode === 'page' ? 'SEAM' : f.ledger_cut || /^by-eye \(leafsplit/.test(f.cut_source) ? 'RECUT' : 'SAME');
