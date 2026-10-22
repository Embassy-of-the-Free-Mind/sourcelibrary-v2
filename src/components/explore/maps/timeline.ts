// Timeline map runtime: renders the tradition × time SVG, the detail panel and the catalogue
// into a container. Ported from the Map of Wisdom artifact (scratchpad/wisdom/page-template.html).
// Plain DOM so that the artifact's behaviour is preserved exactly; React owns only the shell.
// Copied from sourcelibrary-atlas src/lib/timeline.ts (#4922) with three changes for this site:
// book links are same-host; an edition that is not public is named but not linked (a hidden
// book 404s for readers); and the concept pages, which live only on the atlas, are not linked.

export type Edition = {
  id: string; t: string; a: string; y: string; l: string; v: boolean;
  pc: number; o: number; tt: number; r: string; nt: string; rd: boolean;
};
export type Work = {
  n: string; tr: string; rg: string; d: number; dl: string; g: string; gl: string;
  st: 'readable' | 'visible' | 'hidden' | 'anthology' | 'absent'; adj: boolean; gap: string; nt: string; eds: Edition[];
};
export type ThemeData = { works: Work[]; anth?: unknown[] };
/** One row of public/data/graph/lens-<theme>.json: [pages, via v|e|b, evidence url, term, gloss]. */
export type LensRow = [number, 'v' | 'e' | 'b', string, string, string | null];
export type LensConcept = { c: string; s: string; tr: string; gen: boolean; ab: number; works: Record<string, LensRow> };
export type LensData = { generated: string; theme: string; concepts: LensConcept[] };
/** Level 2 (public/data/<theme>-l2.json, atlas scripts/map-l2): per work, what it holds about the theme (a, written by a
 *  model), its key terms from the page-terms index (k: term, gloss, book, page), and passages quoted word for word (q;
 *  v = checked against the page by a reader, c = a counter-text). src 'kb': a reader studied the work, and kb carries those
 *  notes condensed (t title, th thesis, h what they held, tr does the word translate, an who answered, nh not held). */
export type L2Work = {
  a: string; src?: 'kb' | 'ai'; k: { t: string; g: string; b: string; p: number }[]; q: { b: string; p: number; t: string; v?: 1; c?: 1 }[];
  kb?: { t: string; th: string; h: string[]; tr: string[]; an: string[]; nh: string[] };
};
export type L2Data = { generated: string; note: string; eds: Record<string, string>; works: Record<string, L2Work> };

export type TimelineConfig = {
  figLabels: [string, string, string, string];
  adjacentLabel?: string;
  l2Topic?: string;
};

export const REGIONS: [string, string[]][] = [
  ['The Ancient Near East', ['Egyptian', 'Mesopotamian', 'Hebrew & Jewish']],
  ['The Classical World', ['Greek', 'Roman', 'Hellenistic & Late Antique', 'Hermetic & Gnostic']],
  ['Christian East and West', ['Early Christian & Monastic', 'Byzantine & Orthodox', 'Syriac & Armenian', 'Medieval Latin']],
  ['The Islamic World and Iran', ['Zoroastrian', 'Arabic', 'Persian', 'Turkic', 'Kabbalistic & Hasidic']],
  ['Europe after 1350', ['Renaissance & Early Modern Europe', 'Modern European', 'Norse & Celtic', 'Slavic & Finnic', 'Theosophical & Modern Esoteric']],
  ['South and Southeast Asia', ['Indian', 'Buddhist', 'Tibetan', 'Southeast Asian']],
  ['East Asia', ['Chinese', 'Japanese', 'Korean & Vietnamese']],
  ['Africa, the Americas, Oceania', ['African', 'Native American & Mesoamerican', 'Oceanian']],
];

const stat = (w: Work) => (w.st === 'readable' ? 'readable' : w.st === 'absent' ? 'absent' : 'held');
const fmtY = (y: number) => (y < 0 ? -y + ' BCE' : y + ' CE');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
/** The artifacts carry absolute sourcelibrary.org URLs; on this site they stay on the reader's host. */
const sameHost = (url: string) => url.replace(/^https:\/\/sourcelibrary\.org(?=\/)/, '');
const bookIdOf = (url: string) => url.match(/\/book\/([0-9a-f]{24})/)?.[1] ?? null;
/** The reader's notes carry a little markdown: [label](url), **bold**, *italic*. Escaped first; only same-host and https
 *  links survive, and library links stay on the reader's host. */
const mdInline = (s: string) => esc(s)
  .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g, (_, label: string, u: string) => `<a href="${sameHost(u)}"${u.startsWith('/') ? '' : ' rel="noopener"'} target="_blank">${label}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<em>$1</em>');

export function mountTimeline(root: HTMLElement, D: ThemeData, cfg: TimelineConfig, lensData?: LensData | null, l2?: L2Data | null): () => void {
  const W = D.works;
  // editions known to be hidden: their pages 404 for readers, so nothing links to them
  const hiddenIds = new Set(W.flatMap((w) => w.eds.filter((e) => !e.v).map((e) => e.id)));
  const linkable = (url: string) => { const id = bookIdOf(url); return !id || !hiddenIds.has(id); };
  // ---- concept lens: which works attest which judged concept (scripts/graph/concept-attestation.mjs) ----
  const wkey = (w: Work) => `${w.n}|||${w.tr}`;
  const lensByName = new Map<string, LensConcept>(); const ideasByWork = new Map<string, { con: LensConcept; row: LensRow }[]>();
  for (const c of lensData?.concepts ?? []) { lensByName.set(c.c.toLowerCase(), c); for (const [k, row] of Object.entries(c.works)) { if (!ideasByWork.has(k)) ideasByWork.set(k, []); ideasByWork.get(k)!.push({ con: c, row }); } }
  for (const list of ideasByWork.values()) list.sort((a, b) => (+a.con.gen - +b.con.gen) || b.row[0] - a.row[0]);
  const viaLabel = (v: LensRow[1]) => (v === 'v' ? 'same word' : v === 'e' ? 'a translator’s rendering' : 'same word and a rendering');
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const figs = $('#figs'), svg = root.querySelector('svg#map') as SVGSVGElement, box = $('#mapbox'),
    detail = $('#detail'), cat = $('#catalogue'), count = $('#count');
  const hasAdj = W.some((w) => w.adj);

  // ---- masthead figures ----
  (function () {
    const core = W.filter((w) => !w.adj);
    const c = (a: Work[]) => ({ r: a.filter((w) => w.st === 'readable').length, h: a.filter((w) => stat(w) === 'held').length, a: a.filter((w) => w.st === 'absent').length });
    const cc = c(core), eds = new Set(W.flatMap((w) => w.eds.map((e) => e.id))).size, reds = new Set(W.flatMap((w) => w.eds.filter((e) => e.rd).map((e) => e.id))).size;
    figs.innerHTML =
      `<div class="fig r"><b>${cc.r}</b><span>${esc(cfg.figLabels[0])}</span></div>
       <div class="fig t"><b>${cc.h}</b><span>${esc(cfg.figLabels[1])}</span></div>
       <div class="fig g"><b>${cc.a}</b><span>${esc(cfg.figLabels[2])}</span></div>
       <div class="fig"><b>${eds.toLocaleString()}</b><span>${esc(cfg.figLabels[3].replace('{readable}', reds.toLocaleString()))}</span></div>`;
  })();

  // ---- state ----
  const state = { st: { readable: true, held: true, absent: true } as Record<string, boolean>, adj: !hasAdj, q: '', sel: null as number | null, lens: null as LensConcept | null };
  const attests = (w: Work) => !!state.lens && wkey(w) in state.lens.works;
  const visible = (w: Work) => state.st[stat(w)] && (state.adj || !w.adj) && (!state.q || (w.n + ' ' + w.tr + ' ' + w.gl + ' ' + w.eds.map((e) => e.t + ' ' + e.a).join(' ')).toLowerCase().includes(state.q));

  // ---- time scale (piecewise linear: antiquity compressed, modernity expanded) ----
  const LEFT = 200, RIGHT = 24, TOP = 44, ROWH = 24, REGGAP = 30;
  const minD = Math.min(-2300, ...W.map((w) => w.d)), maxD = 1960;
  const BP: [number, number][] = [[Math.min(-2300, minD), 0], [-500, 0.21], [600, 0.47], [1400, 0.65], [maxD, 1]];
  function xs(y: number, width: number) { const w = width - LEFT - RIGHT; y = Math.max(BP[0][0], Math.min(maxD, y)); for (let i = 1; i < BP.length; i++) { if (y <= BP[i][0]) { const [y0, f0] = BP[i - 1], [y1, f1] = BP[i]; return LEFT + w * (f0 + (f1 - f0) * (y - y0) / (y1 - y0)); } } return LEFT + w; }
  const ERAS: [number, number, string][] = [[BP[0][0], -1200, 'Bronze Age'], [-1200, -300, 'Axial Age'], [-300, 600, 'Late Antiquity'], [600, 1450, 'Medieval'], [1450, 1800, 'Early Modern'], [1800, 1960, 'Modern']];
  const TICKS = [-2000, -1000, -500, 0, 500, 1000, 1500, 1800, 1900];

  // density: traditions with many works get taller rows
  const perTrad: Record<string, number> = {}; W.forEach((w) => { perTrad[w.tr] = (perTrad[w.tr] || 0) + 1; });
  const rowHeight = (t: string) => { const n = perTrad[t] || 0; return n > 60 ? 38 : n > 40 ? 34 : n > 28 ? 30 : n > 18 ? 28 : ROWH; };

  let tip: HTMLDivElement | null = null;
  let pts: [number, number, number][] = [];
  // dense rows overplot: a click or hover within 10px of a mark counts as that mark (nearest wins)
  function markAt(e: MouseEvent): number | null {
    const c = (e.target as Element).closest('.mk') as SVGElement | null; if (c) return +c.dataset.i!;
    const m = svg.getScreenCTM(); if (!m) return null; const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    let best: number | null = null, bd = 100; for (const [x, y, i] of pts) { const d = (x - pt.x) ** 2 + (y - pt.y) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function renderMap() {
    const width = Math.max(1000, box.clientWidth - 2);
    const rows: { region?: string; t?: string; y: number; h?: number }[] = []; let y = TOP + 14;
    REGIONS.forEach(([r, ts]) => { const present = ts.filter((t) => perTrad[t]); if (!present.length) return; rows.push({ region: r, y }); y += REGGAP - 6; present.forEach((t) => { const h = rowHeight(t); rows.push({ t, y: y + (h - ROWH) / 2, h }); y += h; }); y += 8; });
    const H = y + 10; svg.setAttribute('viewBox', `0 0 ${width} ${H}`); svg.setAttribute('width', String(width)); svg.setAttribute('height', String(H));
    let s = '';
    ERAS.forEach((e, i) => { const x0 = xs(e[0], width), x1 = xs(e[1], width); s += `<rect class="${i % 2 ? 'era2' : 'era'}" x="${x0}" y="${TOP - 8}" width="${x1 - x0}" height="${H - TOP}"/>`; s += `<text class="eralab" x="${x0 + 6}" y="${TOP - 14}">${e[2]}</text>`; });
    let lastEnd = -Infinity; // a label that would run into the previous one keeps its line and loses its text
    TICKS.forEach((t) => { const x = xs(t, width); const lab = t < 0 ? -t + ' BCE' : String(t); const fits = x + 3 > lastEnd + 8; if (fits) lastEnd = x + 3 + lab.length * 6.6; s += `<line class="tick" x1="${x}" x2="${x}" y1="${TOP - 8}" y2="${H - 8}"/>${fits ? `<text class="ticklab" x="${x + 3}" y="${H - 1}">${lab}</text>` : ''}`; });
    const rowY: Record<string, number> = {}, rowH: Record<string, number> = {};
    rows.forEach((r) => { if (r.region) { s += `<text class="rowlab region" x="12" y="${r.y + 4}">${esc(r.region)}</text>`; } else { rowY[r.t!] = r.y; rowH[r.t!] = r.h!; s += `<line class="rowline" x1="${LEFT}" x2="${width - RIGHT}" y1="${r.y}" y2="${r.y}"/><text class="rowlab" x="24" y="${r.y + 4}">${esc(r.t)}</text>`; } });
    const lanes: Record<string, number[]> = {}; pts = [];
    W.forEach((w, i) => { if (!visible(w) || rowY[w.tr] === undefined) return; const x = xs(w.d, width); const L = lanes[w.tr] || (lanes[w.tr] = []); let lane = 0; const k = (rowH[w.tr] || ROWH) / 24; const offs = [0, -7 * k, 7 * k, -13 * k, 13 * k, -4 * k, 4 * k].map((v) => Math.round(v)); for (lane = 0; lane < offs.length; lane++) { if (L[lane] === undefined || x - L[lane] >= 9) break; } if (lane >= offs.length) lane = i % offs.length; L[lane] = x; const cy = rowY[w.tr] + offs[lane]; pts.push([x, cy, i]); const st = stat(w); const r = st === 'absent' ? 3.6 : 4.4; s += `<circle class="mk ${st}${w.adj ? ' adj' : ''}${state.sel === i ? ' sel' : ''}${state.lens ? (attests(w) ? ' lens' : ' dim') : ''}" data-i="${i}" cx="${x.toFixed(1)}" cy="${cy}" r="${r}"><title>${esc(w.n)}</title></circle>`; });
    svg.innerHTML = s;
  }
  const onSvgClick = (e: Event) => { const i = markAt(e as MouseEvent); if (i == null) return; select(i, true); };
  const onSvgMove = (e: MouseEvent) => { const hit = markAt(e); svg.style.cursor = hit == null ? '' : 'pointer'; if (hit == null) { if (tip) { tip.remove(); tip = null; } return; } const w = W[hit]; if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; box.appendChild(tip); } tip.innerHTML = `<b>${esc(w.n)}</b>${esc(w.tr)} · ${esc(w.dl || fmtY(w.d))}<br>${stat(w) === 'readable' ? 'Readable now' : stat(w) === 'held' ? 'Held, not yet readable' : 'Not held'} · ${w.eds.length} edition${w.eds.length === 1 ? '' : 's'}${state.lens && attests(w) ? `<br><i>${esc(state.lens.c)}</i> on ${state.lens.works[wkey(w)][0]} page${state.lens.works[wkey(w)][0] === 1 ? '' : 's'}: ${esc(state.lens.works[wkey(w)][3])}${state.lens.works[wkey(w)][4] ? ' (' + esc(state.lens.works[wkey(w)][4]) + ')' : ''}` : ''}`; const bx = box.getBoundingClientRect(); let x = e.clientX - bx.left + box.scrollLeft + 14; const y = e.clientY - bx.top + box.scrollTop - 10; if (x + 310 > box.scrollWidth) x -= 330; tip.style.left = x + 'px'; tip.style.top = y + 'px'; };
  const onSvgLeave = () => { if (tip) { tip.remove(); tip = null; } };
  svg.addEventListener('click', onSvgClick); svg.addEventListener('mousemove', onSvgMove); svg.addEventListener('mouseleave', onSvgLeave);

  // ---- detail ----
  // plain words for the reader: page counts, the edition's role, and only the surveyors' notes that are about the book
  const ROLE: Record<string, string> = { orig: 'original language', trans: 'translation', comm: 'commentary', reception: 'later work on it', study: 'study' };
  const pagesText = (e: Edition) => (!e.pc ? 'no pages yet' : e.tt > 0 ? `${e.pc} pages, ${e.tt} translated` : e.o > 0 ? `${e.pc} pages, ${e.o} transcribed` : `${e.pc} pages, not yet transcribed`);
  const INTERNAL = /stub|ingest|queue|#\d|duplicate|\bOCR\b|catalog(ue)? record|data bug|cheap win|\bbulk\b|\brecords?\b|\bBSB\b ids|0\/0/i;
  const noteText = (nt: string) => { if (!nt || INTERNAL.test(nt)) { const m = nt && nt.match(/^acquired (\d{4})-(\d\d)/); return m ? `acquired ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}` : ''; } return nt.replace(/\s*[,—–(-]*\s*\(?hidden( copy| but [^,)]*)?\)?/gi, '').trim(); };
  function edRow(e: Edition) { const st = e.rd ? 'readable' : e.v ? 'held' : 'hidden'; const nt = noteText(e.nt); const label = e.rd ? 'readable' : e.v ? 'held, not yet readable' : 'held, not yet public'; return `<li><span class="dot ${st}" title="${label}"></span><span>${e.v ? `<a href="/book/${e.id}" target="_blank" rel="noopener">${esc(e.t || '(untitled)')}</a>` : `<span class="unlinked">${esc(e.t || '(untitled)')}</span>`} <span class="em">${esc([e.a, e.y, e.l].filter(Boolean).join(' · '))} · ${pagesText(e)} · ${ROLE[e.r] || esc(e.r)}${nt ? ' · ' + esc(nt) : ''}</span></span></li>`; }
  function ideasBlock(w: Work) {
    const ideas = ideasByWork.get(wkey(w)); if (!ideas?.length) return '';
    const li = ideas.map(({ con, row }) => `<li class="${con.gen ? 'gen' : ''}"><button class="lensbtn" data-lens="${esc(con.c)}" title="Light up every work on this map that attests it">${esc(con.c)}</button>${con.tr !== w.tr ? `<span class="from">${esc(con.tr)}</span>` : ''}<span class="how">${viaLabel(row[1])}${row[4] ? `: “${esc(row[4])}”` : ''}</span>${linkable(row[2]) ? `<a href="${esc(sameHost(row[2]))}" target="_blank" rel="noopener">p. ${esc(row[2].split('page=')[1] || '')}</a>` : ''}${con.ab ? `<span class="more-tr">also in ${con.ab} other tradition${con.ab === 1 ? '' : 's'}</span>` : ''}</li>`).join('');
    return `<div class="ideas"><b>Ideas on its pages</b><span class="sub">${ideas.length} concept${ideas.length === 1 ? '' : 's'} a translator flagged on a held edition; common words in grey</span><ul>${li}</ul></div>`;
  }
  const pageUrl = (b: string, p: number) => `/book/${b}?page=${p}`;
  function kbBlock(x: L2Work) {
    const k = x.kb; if (!k) return '';
    const list = (head: string, items: string[], tag = 'ul') => items.length ? `<div class="kbsec"><b>${head}</b><${tag}>${items.map((i) => `<li>${mdInline(i)}</li>`).join('')}</${tag}></div>` : '';
    return `<div class="kb"><p class="kbby">A reader’s notes on ${esc(k.t)}</p>${k.th ? `<p class="about">${mdInline(k.th)}</p>` : ''}${list('What they held', k.h, 'ol')}${list('Does the word translate?', k.tr)}${list('Who answered them', k.an)}${list('Not in the library', k.nh)}</div>`;
  }
  function l2Block(w: Work) {
    const x = l2?.works[wkey(w)]; if (!x || (!x.a && !x.q.length && !x.k.length && !x.kb)) return '';
    const terms = x.k.length ? `<div class="l2terms"><b>Key terms</b><ul>${x.k.map((k) => `<li><a href="${pageUrl(k.b, k.p)}" target="_blank" rel="noopener" class="term">${esc(k.t)}</a> <span>${esc(k.g)}</span></li>`).join('')}</ul></div>` : '';
    const qs = x.q.length ? `<div class="l2q"><b>Where to start reading</b>${x.q.map((q) => `<blockquote class="${q.c ? 'counter' : ''}"><p>${esc(q.t)}</p><a href="${pageUrl(q.b, q.p)}" target="_blank" rel="noopener">${esc(l2!.eds[q.b] || 'Read the page')}, p. ${q.p}</a>${q.v ? '<span class="qtag">checked by a reader</span>' : ''}${q.c ? '<span class="qtag ct">counter-text</span>' : ''}</blockquote>`).join('')}</div>` : '';
    return `<div class="l2">${x.a ? `<p class="about">${esc(x.a)}</p>${x.src === 'ai' ? '<p class="l2note">Summary written by a language model from the pages below.</p>' : ''}` : ''}${kbBlock(x)}${terms}${qs}<p class="l2note">${esc(l2!.note)}</p></div>`;
  }
  function edsBlock(w: Work) {
    if (!w.eds.length) return ''; const eds = [...w.eds].sort((a, b) => (+b.rd - +a.rd) || (+b.v - +a.v)); const N = 6;
    const head = `<b class="edsh">${w.eds.length === 1 ? 'The edition in the library' : `${w.eds.length} editions in the library`}</b>`;
    return `${head}<ul class="eds">${eds.slice(0, N).map(edRow).join('')}</ul>${eds.length > N ? `<details class="moreeds"><summary>Show the other ${eds.length - N}</summary><ul class="eds">${eds.slice(N).map(edRow).join('')}</ul></details>` : ''}`;
  }
  function select(i: number, scroll: boolean) {
    state.sel = i; const w = W[i]; detail.className = 'detail'; const st = stat(w);
    detail.innerHTML = `<h3>${esc(w.n)}</h3><div class="meta"><span>${esc(w.tr)}${w.rg ? ' · ' + esc(w.rg) : ''}</span><span>${esc(w.dl || fmtY(w.d))}</span><span>${esc(w.g)}</span><span class="pill ${st}">${st === 'readable' ? 'Readable' : st === 'held' ? 'Held, not yet readable' : 'Not held'}</span>${w.adj ? '<span class="pill absent">adjacent</span>' : ''}</div>
      ${w.gl ? `<p>${esc(w.gl)}</p>` : ''}
      ${l2Block(w)}
      ${ideasBlock(w)}
      ${edsBlock(w)}
      ${(st === 'absent' || st === 'held') && w.gap ? `<div class="gap" style="margin-top:10px"><b>Where to get it:</b> ${esc(w.gap)}</div>` : ''}
      ${w.nt && !INTERNAL.test(w.nt) ? `<p style="margin-top:10px;font-family:var(--ui);font-size:12.5px;color:var(--muted)">${esc(w.nt)}</p>` : ''}`;
    root.querySelectorAll('.mk.sel').forEach((c) => c.classList.remove('sel')); const c = svg.querySelector(`.mk[data-i="${i}"]`); if (c) c.classList.add('sel');
    if (scroll) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const onDetailClick = (e: Event) => { const b = (e.target as Element).closest('.lensbtn') as HTMLElement | null; if (!b) return; setLens(b.dataset.lens || ''); const inp = root.querySelector<HTMLInputElement>('#lens'); if (inp) inp.value = b.dataset.lens || ''; box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  detail.addEventListener('click', onDetailClick);

  // ---- catalogue ----
  function renderCat() {
    let h = ''; let shown = 0;
    REGIONS.forEach(([r, ts]) => {
      let block = '';
      ts.forEach((t) => {
        const ws = W.map((w, i) => [w, i] as [Work, number]).filter(([w]) => w.tr === t && visible(w)); if (!ws.length) return; const all = W.filter((w) => w.tr === t); const cr = all.filter((w) => w.st === 'readable' && !w.adj).length, ca = all.filter((w) => w.st === 'absent' && !w.adj).length, ch = all.filter((w) => stat(w) === 'held' && !w.adj).length;
        block += `<div class="trad"><h3>${esc(t)} <small>${cr} readable · ${ch} held · ${ca} not held</small></h3>`;
        ws.forEach(([w, i]) => {
          shown++; const st = stat(w); const eds = w.eds; const showN = 6; const rest = eds.length - showN;
          block += `<div class="work${w.adj ? ' adj' : ''}" id="w${i}"><div class="date">${esc(w.dl && w.dl.length < 28 ? w.dl : fmtY(w.d))}</div><div><div class="name"><a href="#w${i}" data-i="${i}" class="wl">${esc(w.n)}</a><span class="pill ${st}">${st === 'readable' ? 'Readable' : st === 'held' ? 'Held' : 'Not held'}</span>${w.adj ? '<span class="adjtag">adjacent</span>' : ''}</div>${w.gl ? `<p class="gloss">${esc(w.gl)}</p>` : ''}${l2?.works[wkey(w)]?.q.length ? `<button class="more l2more" data-i="${i}">What it says about ${esc(cfg.l2Topic || 'the mind')}, with ${l2.works[wkey(w)].q.length} passage${l2.works[wkey(w)].q.length === 1 ? '' : 's'}</button>` : ''}
            ${eds.length ? `<ul class="eds">${eds.slice(0, showN).map(edRow).join('')}${rest > 0 ? `<li><span></span><button class="more" data-i="${i}">and ${rest} more edition${rest === 1 ? '' : 's'}</button></li>` : ''}</ul>` : ''}
            ${st !== 'readable' && w.gap ? `<div class="gap"><b>${st === 'absent' ? 'Source:' : 'Also:'}</b> ${esc(w.gap)}</div>` : ''}</div></div>`;
        });
        block += '</div>';
      });
      if (block) h += `<div class="region-h">${esc(r)}</div>${block}`;
    });
    cat.innerHTML = h || '<p class="sub">Nothing matches these filters.</p>';
    let lensNote = '';
    if (state.lens) { const hit = W.filter((w) => visible(w) && attests(w)); const trs = new Set(hit.map((w) => w.tr)); lensNote = ` · ${hit.length} attest ${state.lens.c} across ${trs.size} tradition${trs.size === 1 ? '' : 's'}`; }
    count.textContent = `${shown} of ${W.length} works shown${lensNote}`;
  }
  const onCatClick = (e: Event) => { const m = (e.target as Element).closest('.more') as HTMLElement | null; if (m) { select(+m.dataset.i!, true); e.preventDefault(); return; } const a = (e.target as Element).closest('a.wl') as HTMLElement | null; if (a) { e.preventDefault(); select(+a.dataset.i!, true); history.replaceState(null, '', `#w${a.dataset.i}`); } };
  cat.addEventListener('click', onCatClick);

  // ---- controls ----
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('.chip'));
  const onChip = (b: HTMLButtonElement) => () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); state.st[b.dataset.st!] = on; refresh(); };
  const chipHandlers = chips.map((b) => { const h = onChip(b); b.addEventListener('click', h); return [b, h] as const; });
  const adj = root.querySelector<HTMLInputElement>('#adj'); const adjWrap = root.querySelector<HTMLElement>('#adjwrap');
  if (adjWrap) adjWrap.hidden = !hasAdj;
  const onAdj = (e: Event) => { state.adj = (e.target as HTMLInputElement).checked; refresh(); };
  adj?.addEventListener('change', onAdj);
  const q = root.querySelector<HTMLInputElement>('#q'); let qt: ReturnType<typeof setTimeout>;
  const onQ = (e: Event) => { clearTimeout(qt); qt = setTimeout(() => { state.q = (e.target as HTMLInputElement).value.trim().toLowerCase(); refresh(); }, 150); };
  q?.addEventListener('input', onQ);
  function setLens(name: string) { state.lens = lensByName.get(name.trim().toLowerCase()) || null; refresh(); }
  const lensInput = root.querySelector<HTMLInputElement>('#lens'); const lensWrap = root.querySelector<HTMLElement>('#lenswrap'); const lensList = root.querySelector<HTMLDataListElement>('#lens-list');
  if (lensWrap) lensWrap.hidden = !lensByName.size;
  if (lensList) lensList.innerHTML = [...lensByName.values()].sort((a, b) => (+a.gen - +b.gen) || a.c.localeCompare(b.c)).map((c) => `<option value="${esc(c.c)}">${esc(c.tr)}${c.gen ? ' · common word' : ''}</option>`).join('');
  let lt: ReturnType<typeof setTimeout>;
  const onLens = (e: Event) => { clearTimeout(lt); lt = setTimeout(() => setLens((e.target as HTMLInputElement).value), 120); };
  lensInput?.addEventListener('input', onLens); lensInput?.addEventListener('change', onLens);
  function refresh() { renderMap(); renderCat(); }
  let rt: ReturnType<typeof setTimeout>; const onResize = () => { clearTimeout(rt); rt = setTimeout(renderMap, 120); };
  window.addEventListener('resize', onResize);
  refresh();

  // deep link: ?w=<index> or #w<index>
  const m = location.hash.match(/^#w(\d+)$/); if (m && W[+m[1]]) select(+m[1], true);
  const idea = new URLSearchParams(location.search).get('idea'); if (idea && lensByName.has(idea.toLowerCase())) { if (lensInput) lensInput.value = lensByName.get(idea.toLowerCase())!.c; setLens(idea); }

  return () => {
    svg.removeEventListener('click', onSvgClick); svg.removeEventListener('mousemove', onSvgMove); svg.removeEventListener('mouseleave', onSvgLeave);
    cat.removeEventListener('click', onCatClick); chipHandlers.forEach(([b, h]) => b.removeEventListener('click', h));
    adj?.removeEventListener('change', onAdj); q?.removeEventListener('input', onQ); window.removeEventListener('resize', onResize);
    lensInput?.removeEventListener('input', onLens); lensInput?.removeEventListener('change', onLens); detail.removeEventListener('click', onDetailClick);
  };
}
