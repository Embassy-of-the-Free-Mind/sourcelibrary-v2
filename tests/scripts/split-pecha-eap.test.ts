// Pins the decision, reading-order and text carry-over rules of scripts/maintenance/split-pecha-eap.mjs (#304).
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs script
import { decideFrame, readingOrder, leafTexts, expandUnits, ORDER_GATE, blInfoUrl, tallVsBook, agyDecide, bookModeAccept, overhang, uncoveredGapLeaf, cropMoves, widenX } from '../../scripts/maintenance/split-pecha-eap.mjs';
// @ts-expect-error plain .mjs script
import { tallRun, paperDip, paperColumns, shortOuter } from '../../scripts/lib/pecha-leaves.mjs';

const leaves = (n: number) => Array.from({ length: n }, (_, i) => ({ left: 0, top: i * 100, width: 1000, height: 100 }));
const frame = (status: string, n: number, side: string, evidence: number) => ({ status, leaves: leaves(n), side, evidence });

describe('decideFrame', () => {
  const base = { n: 4, flags: [], readLeaves: 4, trLeaves: null, sizeOk: true };
  it('accepts when the gaps equal the read, and carries the text', () => {
    expect(decideFrame(base)).toMatchObject({ status: 'accept', carry: true });
  });
  it('sends a read/gap disagreement to agy, never cuts it blind', () => {
    expect(decideFrame({ ...base, readLeaves: 3 }).status).toBe('agy');
    expect(decideFrame({ ...base, flags: ['tall-run'] }).status).toBe('agy');
    expect(decideFrame({ ...base, readLeaves: null }).status).toBe('agy');
  });
  it('keeps the frame whole when the served translation disagrees, or our copy is smaller than the IIIF max', () => {
    expect(decideFrame({ ...base, trLeaves: 3 }).status).toBe('unsplit');
    expect(decideFrame({ ...base, sizeOk: false }).status).toBe('unsplit');
  });
  it('a single leaf with a single-leaf read is still asked of agy (dark paper hides the seam from both signals)', () => {
    expect(decideFrame({ ...base, n: 1, readLeaves: 1 }).status).toBe('agy');
  });
  it('one leaf found and no read is asked of agy, not taken on the gap finder alone', () => {
    expect(decideFrame({ ...base, n: 1, readLeaves: null }).status).toBe('agy');
  });
  it('a leaf box reaching far past its paper run is asked of agy: a small leaf can hide there that the read also skipped', () => {
    // 69e77aa6…, frame 126: two runs, read 2, a short third leaf below the second run inside its box (1024 px high)
    const leaves = [{ top: 0, height: 407, run: [143, 353] }, { top: 407, height: 617, run: [466, 635] }];
    const d = decideFrame({ ...base, n: 2, readLeaves: 2, leaves, H: 1024 });
    expect(d.status).toBe('agy');
    expect(d.flags).toContain('box-beyond-run');
    // an ordinary frame: boxes reach the cuts and the frame edge, a little past the run
    const ok = [{ top: 0, height: 500, run: [60, 470] }, { top: 500, height: 524, run: [540, 960] }];
    expect(decideFrame({ ...base, n: 2, readLeaves: 2, leaves: ok, H: 1024 })).toMatchObject({ status: 'accept', carry: true });
  });
});

describe('readingOrder', () => {
  const m = ORDER_GATE.pairMargin;
  it('interleaves a clean recto/verso pair leaf by leaf', () => {
    const fr = [frame('accept', 3, 'R', 2), frame('accept', 3, 'V', 2 - m - 0.1)];
    const { units, pairs } = readingOrder(fr, { usePairs: true });
    expect(pairs).toEqual([[0, 1]]);
    expect(units.map((u: any) => `${u.frame}.${u.leaf}`)).toEqual(['0.0', '1.0', '0.1', '1.1', '0.2', '1.2']);
  });
  it('keeps photo order when the margin is weak, counts differ, a side is wrong, or the gate refused', () => {
    const weak = [frame('accept', 3, 'R', 1), frame('accept', 3, 'V', 0)];
    const counts = [frame('accept', 3, 'R', 3), frame('accept', 4, 'V', -3)];
    const flipped = [frame('accept', 3, 'V', -3), frame('accept', 3, 'R', 3)];
    for (const fr of [weak, counts, flipped]) expect(readingOrder(fr, { usePairs: true }).pairs).toEqual([]);
    expect(readingOrder([frame('accept', 3, 'R', 3), frame('accept', 3, 'V', -3)], { usePairs: false }).pairs).toEqual([]);
  });
  it('an unsplit frame is one unit and breaks no neighbour pair', () => {
    const fr = [frame('unsplit', 3, 'R', 3), frame('accept', 2, 'R', 3), frame('accept', 2, 'V', -3)];
    const { units } = readingOrder(fr, { usePairs: true });
    expect(units.map((u: any) => `${u.frame}.${u.leaf}`)).toEqual(['0.null', '1.0', '2.0', '1.1', '2.1']);
  });
  it('a frame that failed at apply falls back to itself and unpairs its partner', () => {
    const fr = [frame('accept', 2, 'R', 3), frame('accept', 2, 'V', -3)];
    const { units, pairs } = readingOrder(fr, { usePairs: true, ok: (k: number) => k === 0 });
    expect(pairs).toEqual([]);
    expect(units.map((u: any) => `${u.frame}.${u.leaf}`)).toEqual(['0.0', '0.1', '1.null']);
  });
});

describe('expandUnits (reorder of an already split book)', () => {
  it('a whole-frame unit becomes all of its existing leaves, top to bottom', () => {
    const frames = [{ children: ['a', 'b'] }, { children: ['c', 'd', 'e'] }];
    const out = expandUnits([{ frame: 0, leaf: 1 }, { frame: 1, leaf: null }], frames);
    expect(out).toEqual([{ frame: 0, leaf: 1 }, { frame: 1, leaf: 0 }, { frame: 1, leaf: 1 }, { frame: 1, leaf: 2 }]);
  });
});

describe('leafTexts', () => {
  const page = {
    ocr: { data: 'one<leaf-break/>two<leaf-break/>three', model: 'm', engine: { name: 'yigdzin', leaf_seams: { count: 2, leaf_lines: [5, 6, 7] } } },
    translation: { data: 'I<leaf-break/>II<leaf-break/>III', model: 't' },
    translation_withheld: { reason: 'x' },
  };
  const ls = { from_page: 'p', leaf: 1, of: 3, run: 'r', issue: 304 };
  it('gives leaf i its own segment, a fresh hash and the provenance, and drops the frame-level seams', () => {
    const t = leafTexts(page, 1, 3, ls);
    expect(t.ocr.data.trim()).toBe('two');
    expect(t.ocr.content_hash).toBeTruthy();
    expect(t.ocr.engine.leaf_seams).toBeUndefined();
    expect(t.ocr.leaf_split).toMatchObject({ from_page: 'p', leaf: 1, leaf_lines: 6 });
    expect(t.translation.data.trim()).toBe('II');
    expect(t.translation_withheld).toEqual({ reason: 'x' });
  });
  it('refuses when the read does not cut into as many leaves as the frame', () => {
    expect(() => leafTexts(page, 0, 4, ls)).toThrow(/read cuts into 3/);
  });
});

describe('blInfoUrl', () => {
  it('finds the BL info.json behind a photo_original', () => {
    expect(blInfoUrl('https://images.eap.bl.uk/EAP039/EAP039_1_2_6/1.jp2/full/2000,/0/default.jpg')).toBe('https://images.eap.bl.uk/EAP039/EAP039_1_2_6/1.jp2/info.json');
  });
  it('gives null for a non-BL image, so the book is not size-checked against BL', () => {
    expect(blInfoUrl('https://images.sourcelibrary.org/archived/x/1.jpg')).toBeNull();
    expect(blInfoUrl(undefined)).toBeNull();
  });
});

describe('tallRun (two leaves touching in one frame)', () => {
  it('flags the tall run on a two-run frame, where the upper median is the tall run itself', () => {
    expect(tallRun([266, 537])).toBe(true);
  });
  it('passes leaves of similar height, and a lone run', () => {
    expect(tallRun([266, 270])).toBe(false);
    expect(tallRun([260, 266, 270, 300])).toBe(false);
    expect(tallRun([537])).toBe(false);
  });
});

describe('tallVsBook', () => {
  const fr = (hs: number[], status = 'accept') => ({ status, H: 1000, leaves: hs.map((h, i) => ({ top: i * 300, height: h, run: [i * 300, i * 300 + h] })) });
  it('leaves unsplit a frame whose leaf is twice the book\'s usual height (two touching leaves read as one)', () => {
    const frames = [fr([220, 230, 225]), fr([220, 220, 230]), fr([225, 228, 222]), fr([450, 448])];
    expect(tallVsBook(frames)).toBe(1);
    expect(frames[3]).toMatchObject({ status: 'unsplit', carry: false });
    expect(frames[0].status).toBe('accept');
  });
  it('does nothing on a book with too few split leaves to know its usual height', () => {
    expect(tallVsBook([fr([220, 230]), fr([450, 448])])).toBe(0);
  });
});

describe('overhang', () => {
  const f = { H: 1024, leaves: [{ top: 0, height: 366 }, { top: 366, height: 323 }, { top: 689, height: 158 }] };
  it('is true when agy\'s bottom box reaches well below the last gap leaf (an underlit bottom leaf cut short)', () => {
    expect(overhang(f, [[34, 161, 321, 874], [363, 170, 642, 873], [700, 168, 970, 876]])).toBe(true);
  });
  it('is false when agy\'s outer boxes end within 3% of the gap leaves', () => {
    expect(overhang({ ...f, leaves: [{ top: 0, height: 366 }, { top: 366, height: 323 }, { top: 689, height: 300 }] }, [[34, 161, 321, 874], [363, 170, 642, 873], [700, 168, 970, 876]])).toBe(false);
  });
});

describe('bookModeAccept', () => {
  const fr = (hs: number[], status = 'accept-agy') => ({ status, H: 1000, read_leaves: 4, leaves: hs.map((h, i) => ({ top: i * 250, height: h, run: [i * 250, i * 250 + h] })) });
  const held = (hs: number[]) => ({ status: 'unsplit', reason: 'agy 4, read 2 tall-run', H: 1000, read_leaves: 2, leaves: [{ top: 0, height: 1000, run: [0, 1000] }],
    cand: { leaves: hs.map((h, i) => ({ top: i * 250, height: h, run: [i * 250, i * 250 + h] })), ink: [], onset: [] } });
  const book = () => Array.from({ length: 10 }, () => fr([240, 245, 238, 242]));
  it('splits a held frame whose clean agy cut has the book\'s usual count and leaf height, without text', () => {
    const frames = [...book(), held([240, 236, 244, 241])];
    expect(bookModeAccept(frames)).toBe(1);
    expect(frames[10]).toMatchObject({ status: 'accept-agy', carry: false, reason: 'agy 4 = book, read 2' });
    expect(frames[10].leaves).toHaveLength(4);
    expect(frames[10]).not.toHaveProperty('cand');
  });
  it('keeps it whole when a cut leaf is a sliver or double height, or the count is not the book\'s', () => {
    const frames = [...book(), held([300, 140, 290, 240]), held([240, 180, 290, 240]), held([240, 240, 480])];
    expect(bookModeAccept(frames)).toBe(0);
    expect(frames[10].status).toBe('unsplit');
  });
  it('does nothing on a book with too few split frames, or no clear usual count', () => {
    expect(bookModeAccept([...book().slice(0, 9), held([240, 240, 240, 240])])).toBe(0);
    const mixed = [...Array.from({ length: 5 }, () => fr([240, 240, 240, 240])), ...Array.from({ length: 5 }, () => fr([320, 320, 320])), held([240, 240, 240, 240])];
    expect(bookModeAccept(mixed)).toBe(0);
  });
});

describe('agyDecide', () => {
  const f = (o: object) => ({ flags: [], leaves: leaves(3), read_leaves: 2, tr_leaves: null, ...o });
  const boxes = (n: number) => Array.from({ length: n }, (_, i) => [i * 300, 0, i * 300 + 250, 1000]);
  it('splits without text when the clean gaps and agy agree and the read counts fewer leaves', async () => {
    expect(await agyDecide(f({}), boxes(3), null, null)).toMatchObject({ status: 'accept-agy', carry: false });
  });
  it('keeps the frame whole when the read counts MORE leaves than gaps and agy (two merged leaves)', async () => {
    expect((await agyDecide(f({ read_leaves: 4 }), boxes(3), null, null)).status).toBe('unsplit');
  });
  it('keeps the frame whole when it serves a translation, or the gap finder flagged itself', async () => {
    expect((await agyDecide(f({ tr_leaves: 2 }), boxes(3), null, null)).status).toBe('unsplit');
    expect((await agyDecide(f({ flags: ['tall-run'], leaves: leaves(2) }), boxes(3), null, null)).status).not.toBe('accept-agy');
  });
  it('keeps a frame whole when there is no read and the gap finder saw one run where agy sees two (a folded sheet)', async () => {
    expect((await agyDecide(f({ read_leaves: null, flags: ['tall-run'], leaves: leaves(1) }), boxes(2), null, null)).status).toBe('unsplit');
    expect((await agyDecide(f({ read_leaves: null, leaves: leaves(2) }), boxes(2), null, null)).status).toBe('accept-agy');
  });
  it('a one-leaf frame agy confirms is single; one agy splits into two is kept whole for book mode or a person', async () => {
    expect((await agyDecide(f({ leaves: leaves(1), read_leaves: 1 }), boxes(1), null, null)).status).toBe('single');
    expect((await agyDecide(f({ leaves: leaves(1), read_leaves: 1 }), boxes(2), null, null)).status).toBe('unsplit');
  });
  it('keeps a frame whole when the clean gap finder saw a leaf that agy and the read both missed (69e77a38…, frame 77)', async () => {
    const g = { H: 1024, flags: [], read_leaves: 2, tr_leaves: null, leaves: [{ top: 0, height: 346 }, { top: 346, height: 338 }, { top: 684, height: 340 }] };
    const agy = [[18, 107, 312, 898], [342, 114, 638, 905]];
    expect(uncoveredGapLeaf(g, agy)).toBe(2);
    expect(await agyDecide(g, agy, null, null)).toMatchObject({ status: 'unsplit', reason: 'agy 2, gaps 3: gap leaf 3 has no box' });
    expect(uncoveredGapLeaf(g, [...agy, [690, 100, 980, 900]])).toBe(-1);
  });
  it('keeps a frame whole when agy answers with no boxes at all, instead of throwing (the run lost its calls)', async () => {
    expect(await agyDecide({ ...f({}), H: 1000 }, [], null, null)).toMatchObject({ status: 'unsplit', reason: 'agy 0 boxes' });
    expect(overhang({ H: 1000, leaves: leaves(2) }, [])).toBe(false);
  });
});

describe('paperDip', () => {
  it('finds the cloth between slanted leaves that never reads empty, and not a line of writing', () => {
    // 69e77aa8…, frame 68, seam 3: paper share per row; the cloth bottoms out at 0.54, text rows dip to ~0.9
    const rows = [0.98, 0.98, 0.97, 0.95, 0.97, 0.91, 0.86, 0.79, 0.72, 0.70, 0.70, 0.66, 0.64, 0.61, 0.58, 0.54, 0.66, 0.77, 0.88, 0.96];
    expect(paperDip((y: number) => rows[y], 0, rows.length)).toEqual([8, 17]);
    const text = [0.99, 0.97, 0.9, 0.88, 0.95, 0.99, 0.91, 0.89, 0.97];
    expect(paperDip((y: number) => text[y], 0, text.length)).toBeNull();
  });
  it('is not a dense line of writing on the edge of the zone', () => {
    // 69e782bc…, frame 54, seam 3: paper full across the zone, then the next leaf's first line on its last row
    const edge = [0.93, 0.7, 0.96, 0.98, 1, 1, 0.99, 1, 1, 1, 0.98, 0.94, 0.6];
    expect(paperDip((y: number) => edge[y], 0, edge.length)).toBeNull();
    expect(paperDip((y: number) => [...edge].reverse()[y], 0, edge.length)).toBeNull();
    // a thin cloth dip inside the zone is still cloth
    const thin = [0.98, 0.98, 0.97, 0.6, 0.97, 0.98, 0.98];
    expect(paperDip((y: number) => thin[y], 0, thin.length)).toEqual([3, 3]);
  });
});

describe('cropMoves (recrop of an applied book)', () => {
  const child = (top: number, height: number) => ({ field_provenance: { photo: { crop: { left: 10, top, width: 900, height } } } });
  it('marks only the leaves whose crop moved past the tolerance', () => {
    const kids = [child(0, 400), child(400, 400), child(800, 400)];
    const plan = [{ left: 10, top: 0, width: 900, height: 402 }, { left: 10, top: 402, width: 900, height: 470 }, { left: 10, top: 872, width: 900, height: 328 }];
    expect(cropMoves(kids, plan).map((m: { moved: boolean }) => m.moved)).toEqual([false, true, true]);
  });
  it('never moves a leaf with no stored crop', () => {
    expect(cropMoves([{}], [{ left: 0, top: 0, width: 1, height: 1 }])[0]).toMatchObject({ moved: false, why: 'no stored crop' });
  });
});

describe('paperColumns: the leaf box crosses the text block border into the margin (#304)', () => {
  const cols = (spec: [number, number][]) => { const c = new Array(300).fill(0); for (const [a, b] of spec) for (let x = a; x < b; x++) c[x] = 0.9; return c; };
  it('joins the margin across a thin border line (69e7883a…, frame 82)', () => {
    const r = paperColumns(cols([[4, 22], [25, 290]]));
    expect(r.best).toEqual([25, 290]);
    expect(r.span).toEqual([4, 290]);
  });
  it('does not cross a cloth gap wider than the bridge', () => {
    expect(paperColumns(cols([[4, 20], [40, 290]])).span).toEqual([40, 290]);
  });
});
describe('widenX', () => {
  const live = { left: 105, width: 1352 };
  it('only widens, never narrows', () => {
    expect(widenX(live, [0, 1536], 1536)).toEqual({ left: 0, width: 1536 });
    expect(widenX(live, [200, 1300], 1536)).toEqual(live);
  });
  it('stops at agy\'s box plus 3%', () => {
    const x = widenX({ left: 200, width: 1100 }, [0, 1536], 1536, [[0, 100, 300, 900]]);
    expect(x.left).toBe(Math.round(153.6 - 46.08));
    expect(x.left + x.width).toBe(Math.round(1382.4 + 46.08));
  });
});
describe('shortOuter: an outer leaf cut short at a run beyond it (#304)', () => {
  it('flags a bottom leaf much shorter than the rest when a run lies below it (69e7883f…, frame 6)', () => {
    expect(shortOuter([376, 302, 200], false, true)).toBe(true);
  });
  it('does not flag it when the leaf ends at the frame edge', () => {
    expect(shortOuter([376, 302, 200], false, false)).toBe(false);
  });
  it('flags a short top leaf under a run above it', () => {
    expect(shortOuter([150, 300, 310], true, false)).toBe(true);
  });
  it('leaves even leaves alone', () => {
    expect(shortOuter([376, 302, 290], true, true)).toBe(false);
  });
});
