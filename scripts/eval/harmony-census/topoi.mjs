// PRIOR ART: scripts/eval/fragment-sort/classify.mjs (#7065) — sorts attributions into known / spurious / testimonium /
// unmatched against a fragment list; a topos has no list, so each telling is sorted against the EARLIER tellings in our
// own books, with the same shingle helpers (fragment-sort/shingle.mjs). none fits #7117 as it was.
//
// For each window from the topos lanes (harvest.mjs), decide which of the five topoi it tells (co-occurrence rules on
// the window, in its own language), then sort every telling, earliest first, into:
//   known-source  the telling names an authority for it (Pliny, Plutarch, Fracastoro, Kircher …)
//   derivative    its page shares a run of >= 40 folded characters of ORIGINAL text with an earlier telling's page
//   variant       a different version of the topos (wolf-gut strings instead of the wolfskin drum; "like answers like")
//   unmatched     none of these: the residue to read
// Usage: node topoi.mjs <harvest-dir> <out.jsonl>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fold, makeFolded, makeShingles } from '../fragment-sort/shingle.mjs';

const [H, OUT] = process.argv.slice(2);
const cat = JSON.parse(fs.readFileSync(path.join(H, 'catalog.json'), 'utf8'));
const read = (lane) => { const f = path.join(H, `${lane}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const year = (b) => { const y = parseInt(b?.y, 10); if (y > 0 && y < 2100) return y; const m = String(b?.pub || '').match(/\b(1[0-9]\d\d|[5-9]\d\d)\b/); return m ? +m[1] : null; };
const APP = /<(meta|note|gloss|vocab|summary|keywords|warning|header|page-num|page-type|language|sig|context|script|columns|image-desc|scan-quality|lang)\b[^>]*>[\s\S]*?<\/\1>/gi;
const strip = (s) => { let p; do { p = s; s = s.replace(APP, ' '); } while (s !== p); return s.replace(/<\/?[a-z][a-z-]*[^>]*>/gi, ' ').replace(/ſ/g, 's').replace(/[#*|_]+/g, ' ').replace(/\s+/g, ' ').trim(); };

// ── which topos does a window tell? [id, sub-type, test(text)] — first hit per topos wins ──────────────────────────
const STRING = /\b(?:strings?|chords?|chorda\w*|cord[ae]\b|corde\b|cordes|saiten?|lutes?|lyres?|cithar\w*|viols?|harps?|zithers?|qin|fides|fidibus|nerv[io]s?|nervorum|chordes|monochord\w*)\b|[琴瑟絃弦]/i;
const SAME = /unis{1,2}on\w*|same (?:tone|pitch|note|sound)|tuned (?:alike|to the same|in unison)|eodem tono|eiusdem toni|einklang|gleich gestimmt|même ton|stesso tuono|stessa voce|in tune with each other|宮動|角動|宫动/i;
const MOVE = /\b(?:mov\w*|trembl\w*|vibrat\w*|quiver\w*|resound\w*|stir\w*|shak\w*|leap\w*|jump\w*|respond\w*|answer\w*|tremit|tremere|tremunt|trepid\w*|movetur|moveri|commov\w*|resil\w*|subsil\w*|salt\w*|trema\w*|muov\w*|moss[ae]|tremble\w*|bebt|bebet|zitter\w*|beweg\w*|erzitter\w*|resonat\w*|resona\w*|sonat|sound(?:s|ed)? of (?:it|them)sel\w*)\b|[動动應应]/i;
const WOLF = /\bwol(?:f|ves|fs?kin)\b|\blup[aeiou]\w*|\bloups?\b|\bWölfe|\bWolf\w*|狼/i;
const DRUM = /\bdrums?\b|tabors?|timbrel|tambour\w*|tympan\w*|trommel\w*|pauke\w*|paucke\w*|tamburo|tamburi|鼓/i;
const SHEEP = /\bsheep|\bov[ie]\w*|\bagn[ie]\w*|\bmouton|\bbrebis|\bSchaf\w*|\bpecor\w*|\blamb/i;
const MAGNET = /lo[a]?d-?stone|magnet\w*|magnes\b|magnet[ie]s?\b|calamit\w*|\baimant|Magnet\w*|μαγν|μάγν|[慈磁]石/i;
const SYMPATHY = /s[iy]mpat[hií]\w*|antipat[hií]\w*|συμπ[αά]θ|[αἀ]ντιπ[αά]θ|\blov(?:e|es|ed|ing)\b|\bamor\w*|amicit\w*|\bfriend\w*|hatred|enmity|\bodi[ou]\w*|occult|hidden (?:virtue|property|quality|power)|secret (?:virtue|property|power)|propriet\w* occult\w*|qualitat\w* occult\w*|occult\w* (?:qualit|propriet|virtu)|similitud\w*|like (?:to|draws) like|consens\w*/i;
const IRON = /\biron\b|ferr[iou]\w*|\bfer\b|\bEisen|\bferro|[鐵铁]/i;
const SALVE = /weapon[- ]?salve|weapon[- ]ointment|armary unguent|unguent\w*\s+(?:armari\w*|armor\w*|sympathetic\w*|telor\w*)|armari\w*\s+unguent\w*|salve (?:of|for) (?:the )?weapons?|anoint\w* the (?:weapon|sword|blade)|powder of sympathy|sympathetic(?:al)? (?:powder|ointment|cure|unguent)|pulv\w* sympathetic\w*|sympathetic\w* pulv\w*|waffen-?salb\w*|sympathetisch\w* (?:pulver|cur|salb)|onguent\w*\s+(?:des\s+)?arm\w*|poudre (?:de )?sympath\w*|unguento\s+(?:dell['’]\s*)?arm\w*|polvere (?:di )?simpat\w*/i;
const CLOCK = /\bclocks?\b|pendul\w*|horolog\w*|horloge\w*|orologi\w*|\bUhren?\b|timepieces?/i;
const CLOCK_SYM = /s[iy]mpat[hií]\w*|consens\w*|keep(?:ing)? (?:the same )?time together|in step|same (?:time|beat)|agree\w*|accord\w*|ensemble|zusammen|synchron\w*/i;
const ZH_STR = /彈宫而宫應|彈宮而宮應|叩宮宮應|鼓宮而?宮動|鼓角而?角動|鼓宫而?宫动|宮動|角動|他宮應之|宮則他宮|五音比而自鳴|紙人|纸人|應絃|应弦|絃相應|弦相应|[琴瑟絃弦][^。]{0,12}自鳴/;
// The classical loci a Chinese telling of resonating strings carries (Derek's note, 2026-10-22), in rough order of
// composition. Mechanism words: 神 spirits, 氣 qi, 數 number, 類 kind.
const ZH_STR_LOCI = [
  [/魯遽|為之調瑟|为之调瑟|廢一於堂|鼓宮宮動[，,]?鼓角角動/, 'Zhuangzi, Xu Wugui (Lu Ju tunes two se: strike gong, gong moves)'],
  [/類同相召|类同相召|聲比則應|声比则应|鼓宮而宮應|鼓宫而宫应/, 'Lüshi chunqiu, Ying tong / Zhao lei (like kinds summon each other)'],
  [/同聲相應[，,]?同氣相求|同声相应[，,]?同气相求/, 'Yijing, Wenyan on Qian 5 (like sounds answer, like qi seek each other)'],
  [/叩宮宮應|叩宫宫应|同聲相和者|同声相和者/, 'Huainanzi, Lanming (tuner strikes gong, gong answers)'],
  [/他宮應之|他宫应之|五音比而自鳴|五音比而自鸣|同類相動|同类相动/, 'Dong Zhongshu, Chunqiu fanlu, Tong lei xiang dong ("not spirits; the numbers make it so")'],
  [/彈宫而宫應|彈宮而宮應|弹宫而宫应/, 'Kong Yingda, Zhouyi zhengyi subcommentary (glosses the Yijing line as string resonance)'],
  [/以類相感|以气相化|以氣相化/, 'Xinlun (attr. Liu Xie): kinds move each other, qi transforms'],
  [/紙人|纸人/, 'Shen Kuo, Bu bitan (paper riders on the answering string)'],
  [/絃相應|弦相应/, 'Lülü zhengyi (1713/1724): string correspondences by division'],
];
const ZH_LIKE = /同聲相應|同声相应|同聲相和|同声相和|同類相動|同类相动/;
const ZH_MAG = /[慈磁]石[^。]{0,6}(?:召|引|取|吸|致)[^。]{0,2}[鐵铁]/;

// a and b (regexes) within n characters of each other, either order
const near = (t, a, b, n) => new RegExp(`(?:${a.source})[\\s\\S]{0,${n}}(?:${b.source})|(?:${b.source})[\\s\\S]{0,${n}}(?:${a.source})`, 'i').test(t);
const GUT = /\b(?:guts?|intestin\w*|chords?|strings?|cord[ae]s?|chorda\w*|nerv[io]\w*|saiten?|corde\b|budell\w*)\b/i;
const TWO = /\b(?:two|both|pair|deux|duo|duae|duobus|zwei|due)\b/i;
const SYM = /s[iy]mpat[hií]\w*/i;

function topoi(t) {
  const out = [];
  // 角動 alone is a star's horn moving, 應絃 alone a bowstring: the Chinese strings form needs an instrument or a struck note
  if (ZH_STR.test(t) && (/[琴瑟絃弦]|鼓宮|叩宮|彈宮|彈宫|調瑟|调瑟|五音/.test(t) || ZH_STR_LOCI.some(([re]) => re.test(t.replace(/\s/g, ''))))) out.push(['T1-strings', 'zh: strike gong, gong answers']);
  else if (ZH_LIKE.test(t)) out.push(['T1-strings', 'zh: like sounds answer each other (principle)']);
  else if (near(t, STRING, SAME, 150) && near(t, STRING, MOVE, 200)) out.push(['T1-strings', 'string in unison moves/sounds']);
  else if (near(t, STRING, SYM, 60) && MOVE.test(t)) out.push(['T1-strings', 'sympathetic string']);
  if (near(t, WOLF, DRUM, 150)) out.push(['T2-wolfdrum', near(t, SHEEP, DRUM, 250) ? 'wolfskin drum vs sheepskin drum' : 'wolfskin drum']);
  else if (near(t, WOLF, GUT, 80) && near(t, SHEEP, GUT, 200)) out.push(['T2-wolfdrum', 'wolf-gut vs sheep-gut strings']);
  if (ZH_MAG.test(t)) out.push(['T3-lodestone', 'zh: lodestone summons iron']);
  else if (near(t, MAGNET, IRON, 200) && near(t, MAGNET, SYMPATHY, 200)) out.push(['T3-lodestone', /antipat|hatred|enmity|odi/i.test(t) ? 'magnet: sympathy and antipathy' : 'magnet: sympathy/love/occult quality']);
  if (SALVE.test(t)) out.push(['T4-weaponsalve', /powder|pulv|poudre|polvere|pulver/i.test(t) ? 'sympathetic powder'
    : /weapon|sword|blade|armari|armor|telor|waffen|arm[ei]s?\b|armi\b/i.test(t) ? 'weapon-salve' : 'sympathetic cure (generic)']);
  // Kircher's "sympathetic clocks" (magnetic, heliotropic, botanical: occult horology) name the clock itself sympathetic;
  // Huygens 1665 ("une espece de sympathie") is two PENDULUM clocks keeping time together; Leibniz's two clocks that
  // agree (pre-established harmony) need no sympathy at all.
  const HOROL = /(?<!o['’]\s?)\bclocks?\b|horolog\w*|horloges?\b|pendules?\b|orologi\w*/i;
  if (near(t, SYM, HOROL, 40) && !/pendul/i.test(t)) out.push(['T5-clocks', 'sympathetic clock (occult horology)']);
  else if (near(t, SYM, HOROL, 200) && /pendul/i.test(t)) out.push(['T5-clocks', 'pendulum clocks in sympathy']);
  else if (near(t, HOROL, CLOCK_SYM, 200) && near(t, TWO, HOROL, 40) && /pendul|horolog|horloge|clocks/i.test(t)) out.push(['T5-clocks', 'two clocks agree']);
  return out;
}

// Authorities a telling may name (the "known source" test)
const AUTH = /\b(Pliny|Plinius|Plinii|Plinio|Pline|Plutarch\w*|Aristot\w*|Kircher\w*|Porta|Portae?|Fracastor\w*|Mersenn\w*|Galil\w*|Wallis\w*|Gilbert\w*|Gilberto|Paracels\w*|Goclen\w*|Helmont\w*|Fludd\w*|Fluctibus|Foster|Digby|Digbaeus|Huygen\w*|Hugen\w*|Zhuangzi|Chuang|Huainan\w*|Aelian\w*|Cardan\w*|Scaliger\w*|Bacon|Verulam\w*|Agrippa\w*|Ficin\w*|Lemni\w*|Mizald\w*|Mizauld|Albert\w*|Aphrodis\w*|Galen\w*|Plotin\w*|Lucretius|Lucrez\w*|Augustin\w*|Ptolem\w*|Boeth\w*|Kepler\w*|Descartes|Cartesi\w*|Leibniz\w*|Bartholin\w*|Sennert\w*|Weckerus|Wecker|Alexis|Alessio|Cardano|Pomponazz\w*|Ficinus|Croll\w*|Burgrav\w*|Maxwell|Tentzel\w*|Hartmann\w*|Nieremberg\w*|Schott\w*|Lana|Boyle\w*|Royal Society|Sauveur|Noble|Pigot)\b|莊子|庄子|淮南|呂氏|吕氏|董仲舒|易/;

const lanes = ['sym-tr', 'sym-ocr', 'sym-ocr-ls', 'str-ocr', 'str-tr', 'str-zh', 'str-zh2', 'wolf-tr', 'wolf-ocr-en', 'wolf-la', 'wolf-vern', 'mag-tr', 'mag-ocr', 'mag-zh', 'salve-tr', 'salve-ocr', 'clock-tr', 'clock-ocr'];
const tellings = new Map(); // topos → Map(book:page → telling)
for (const lane of lanes) {
  for (const r of read(lane)) {
    const b = cat[r.id];
    for (const w of r.w) {
      const t = strip(w.win.slice(Math.max(0, w.off - 300), w.off + 400));
      if (!t) continue;
      for (const [topos, sub] of topoi(t)) {
        if (!tellings.has(topos)) tellings.set(topos, new Map());
        const m = tellings.get(topos), k = `${r.id}:${r.p}`;
        if (m.has(k)) continue;
        const isTr = lane.endsWith('-tr');
        const zhLocus = /^zh/.test(sub) ? (ZH_STR_LOCI.find(([re]) => re.test(t.replace(/\s/g, ''))) || [null, null])[1] : undefined;
        m.set(k, { topos, sub, zhLocus, lane, id: r.id, p: r.p, t: b?.t, a: b?.a, y: year(b), blang: b?.lang, w: b?.w,
          text: t.slice(0, 900), auth: [...new Set((t.match(new RegExp(AUTH, 'g')) || []))].slice(0, 6),
          // original text for the reuse test: the window itself on an OCR lane, the page's OCR on a translation lane
          orig: isTr ? strip(r.other || '') : t });
      }
    }
  }
}

// ── sort each topos's tellings, earliest first ──────────────────────────────────────────────────────────────────
const K = 12, MIN_RUN = 40;
const NAMES = /\S*(?:wolf|lup|magnet|magnes|sympath|antipath|unison|pendul|horolog)\S*/giu;
const folded = makeFolded(NAMES);
const shingles = makeShingles(folded, K, null);
// CJK has no letters for fold(); shingle the raw characters
const cjkShingles = (s) => { const f = s.replace(/[^㐀-鿿]/g, ''), o = new Set(); for (let i = 0; i + 6 <= f.length; i++) o.add(f.slice(i, i + 6)); return o; };
const out = [];
for (const [topos, m] of tellings) {
  const list = [...m.values()].sort((a, b) => (a.y ?? 9999) - (b.y ?? 9999));
  const index = new Map(); // shingle → first telling key
  const majority = Object.entries(list.reduce((a, x) => ((a[x.sub] = (a[x.sub] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const x of list) {
    const isCjk = /[㐀-鿿]{20}/.test(x.orig);
    const sh = isCjk ? cjkShingles(x.orig) : shingles(x.orig);
    // longest run shared with ONE earlier telling (from a different book)
    const hitsBy = new Map();
    for (const g of sh) { const src = index.get(g); if (src && src.id !== x.id) hitsBy.set(src.key, (hitsBy.get(src.key) || 0) + 1); }
    const best = [...hitsBy.entries()].sort((a, b) => b[1] - a[1])[0];
    const sharedChars = best ? best[1] + (isCjk ? 5 : K - 1) : 0;
    let cls, ref = null;
    if (best && sharedChars >= (isCjk ? 12 : MIN_RUN)) { cls = 'derivative'; ref = best[0]; }
    else if (x.auth.length) cls = 'known-source';
    else if (x.sub !== majority) cls = 'variant';
    else cls = 'unmatched';
    const key = `${x.id}:${x.p}`;
    for (const g of sh) if (!index.has(g)) index.set(g, { key, id: x.id });
    out.push({ ...x, key, cls, ref, shared: sharedChars, orig: undefined });
  }
}
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const tally = {};
for (const o of out) { tally[o.topos] ??= {}; tally[o.topos][o.cls] = (tally[o.topos][o.cls] || 0) + 1; }
console.log(out.length, 'tellings', JSON.stringify(tally, null, 1));
