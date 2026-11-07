// PRIOR ART: none — searched scripts/{eval,analysis,maintenance,import} and src/lib for a New World
// term list or a reception screen (git grep -i 'novus orbis\|nueuo mundo\|vespuc'); only titles in
// curated collection JSON. Term list for the #8049 content screen (Derek, 2026-11-04).
//
// LOCATOR ONLY: these patterns find candidate PAGES for OCR in third-party OCR text (IA hOCR) or in
// an unserved GPU draft. A hit is never a read, never quoted, never counted as text we hold.
//
// Text is normalised first (normNW): NFD diacritics stripped, long s -> s, v -> u, j -> i, ligatures
// expanded, line-end hyphens joined, whitespace collapsed, lower case. So every pattern below is
// written in u/i spelling ("uespucci", "nouus", "nueuo"). No bare 'indi' or 'insul' — they fire on
// everything (Derek's rule); each family needs a qualifier.

export function normNW(s) {
  return String(s || '')
    .replace(/ſ/g, 's').replace(/æ/gi, 'ae').replace(/œ/gi, 'oe').replace(/ß/g, 'ss')
    .replace(/[­]/g, '')
    .replace(/[-¬⸗=]\s*\n\s*/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/v/g, 'u').replace(/j/g, 'i')
    .replace(/\s+/g, ' ');
}

// strong: a hit names the Americas or their discovery unambiguously.
// weak: true often, but also fires on other things (brazilwood, guaiac for syphilis, Spanish
// 'Indias' which can be the East) — a page with only weak hits does not make a book B by itself.
export const FAMILIES = [
  { key: 'novus_orbis', strong: true, re: /\bnou(?:us|i|o|um|ae|a)\s+orb(?:is|e|em|i)\b|\borb(?:is|e|em|i)\s+nou(?:us|i|o|um)\b|\bnouus\s+orbis\b/g },
  { key: 'mundus_novus', strong: true, re: /\bmund(?:us|i|o|um)\s+nou(?:us|i|o|um)\b|\bnou(?:us|i|o|um)\s+mund(?:us|i|o|um)\b|\bnue[uo]o\s+mundo\b|\bmundo\s+nue[uo]o\b|\bnuouo\s+mondo\b|\bmondo\s+nuouo\b|\bnouo\s+mondo\b|\bnou(?:u)?eau\s+monde\b|\bnou(?:u)?el(?:le)?\s+monde\b|\bmonde\s+nou(?:u)?eau\b|\bnew(?:e)?\s+world\b|\bne(?:w|u|ü)(?:e|en|wen)?\s+welt\b|\bnieu(?:w|u)?e?\s+we(?:e)?r(?:e)?ld\b|\bnouo\s+mundo\b|\bmundo\s+nouo\b/g },
  { key: 'west_indies', strong: true, re: /\b[iy]nd(?:ia|iae|ias|ie|ies|iis|es|ien)\s+occident\w*|\boccident\w{0,6}\s+[iy]nd\w*|\bwest\s*-?\s*[iy]nd\w*|\bwestind\w*|\bwest\s*-?\s*indisch\w*/g },
  { key: 'america', strong: true, re: /\bameric(?:a|ae|am|o|us|i|e|que)\b|\bamerig\w*/g },
  // Bare 'columbus' is also Realdo Colombo the anatomist, 'colombo' a dove and Ceylon: strong only
  // with the first name or the admiral's title; the bare forms are weak (measured on held controls).
  { key: 'columbus', strong: true, re: /\b(?:christ|crist|xpo|chrystof)\w*\s+(?:de\s+)?colo[mnu]\w*|\b(?:almirante|admiral\w*|ammiraglio|amiral|admirall)\s+(?:don\s+)?(?:christ\w*\s+|crist\w*\s+)?colo[mnu]\w*|\bcolon\s+(?:almirante|genoues\w*|genoues)\b/g },
  { key: 'vespucci', strong: true, re: /\buespu[ct]\w*|\buesput\w*|\balberic\w*\s+uesp\w*/g },
  { key: 'cortes', strong: true, re: /\b(?:fernand|hernand|ferdinand|fernan)\w*\s+(?:de\s+)?cort(?:es|esius|esio|esii|ese|esi)\b|\bcortesi(?:us|o|i|um)\b|\bmarques\w*\s+del\s+ualle\b|\bmarchese\s+della\s+ualle\b/g },
  { key: 'mexico', strong: true, re: /\bme[xs]ic\w*|\bmexique\w*|\btemi[sx]tit\w*|\btenu?[sx]tit\w*|\btenochtit\w*|\bmechic\w*|\bmessico\b|\bnou\w*\s+hisp\w*|\bnue[uo]a\s+espa[nñ]a\b|\bnuoua\s+(?:hi)?spagna\b|\bnou\w*\s+espagne\b|\bnew\w*\s+spain\w*|\bnew\w*\s+hispan\w*/g },
  { key: 'peru', strong: true, re: /\b(?:del|el|al|of|de|du|il|in|im|au|do|da)\s+(?:peru|piru)\b|\bperu(?:ana|ano|anos|anas|uian|uiano|uani|ani|anus|ian|uiens)\b|\bcuzc\w*|\bcusc(?:o|um)\b|\bpotosi\b|\batabali\w*|\batahual\w*|\bpizarr\w*/g },
  { key: 'hispaniola', strong: true, re: /\bhispaniol\w*|\bisla\s+espa[nñ]ola\b|\bspagnuola\b|\bhaiti\b|\bla\s+espa[nñ]ola\b/g },
  { key: 'magellan', strong: true, re: /\bmagal(?:l)?an\w*|\bmagell?an\w*|\bmagalhaes\b|\bmagaglian\w*/g },
  { key: 'places', strong: true, re: /\b[yi]ucatan\w*|\bnicaragu\w*|\bpanama\b|\b(?:la|of|de|the)\s+florida\b|\bnewfound\s*land\w*|\bnew\s+found\s+land\w*|\bterre\s*neu(?:f|ue)\b|\bterra\s+noua\b|\bguian(?:a|ae|am|e|es)\b|\bchile\b|\brio\s+de\s+la\s+plata\b|\bmaranon\b|\bcaribe\w*|\bantill(?:as|es|ae|arum|e|en)\b|\btierra\s+firme\b|\bterra\s+firma\b/g },
  { key: 'peoples', strong: true, re: /\bcanibal\w*|\bcanniball\w*|\bcanibal\w*|\bcaniba\w*|\bcaciqu\w*|\bcazic\w*|\bmote[cz]?[cz]um\w*|\bmotecuh\w*|\bmontezum\w*|\bmute[cz]?[cz]um\w*|\btlaxcal\w*|\btascal\w*|\bchichimec\w*|\btupinamb\w*|\btouou?pinamb\w*|\bmargaiat\w*/g },
  { key: 'discovery_phrase', strong: true, re: /\b(?:insul|terr|land|prouinc|region)\w*\s+(?:\w+\s+){0,2}(?:nouiter|nuper|de\s+nouo|recens|nuperrime)\s+(?:\w+\s+)?(?:inuent|repert|detect|cognit)\w*|\b(?:new|neu|newlich|neulich)\w*\s+(?:ge|er)funden\w*\s+(?:insel|inseln|land|lande|landen|welt)\b|\bne(?:w|u)\w*\s+insel\w*|\b(?:nuouamente|nouamente)\s+(?:ritrouat|retrouat|scopert|trouat)\w*|\b(?:nueuamente|nueuame)\s+descubie\w*|\bnouu?ellement\s+(?:descouu|trouu|decouu)\w*|\bnewly\s+(?:found|discouer)\w*\s+(?:\w+\s+)?(?:land|landes|ilands?|islands?|countr\w*|world|regions?)\b/g },
  { key: 'indias_es', strong: false, re: /\b[iy]ndias\b/g },
  { key: 'brasil', strong: false, re: /\bbr[ae][sz]il\w*|\bbresil\w*/g },
  { key: 'columbus_bare', strong: false, re: /\bcolumbus\b|\bcolombus\b|\bcolom\b/g },
  // Bare 'peru' is OCR noise in Latin hOCR (42 false pages on 18 held controls); 'Virginia' is Livy's too.
  { key: 'peru_bare', strong: false, re: /\bperu\b|\bpiru\b|\buirginia\b/g },
  { key: 'cuba', strong: false, re: /\bcuba\b/g },
  // 'indianisch' is East or West ("indianisch negelin" = Tagetes, but also pepper, cloves).
  { key: 'indianisch', strong: false, re: /\bindianisch\w*/g },
  // French 'mais' = but: only the z/y spellings of maize.
  { key: 'products', strong: false, re: /\bmaiz\b|\bmayz\b|\bmahiz\b|\btabac\w*|\btobac\w*|\bguai(?:a)?c\w*|\bguaiac\w*|\bsassafra\w*|\bcochinil\w*|\bcacao\b/g },
  { key: 'antipodes_disc', strong: false, re: /\bantipod\w*/g, needs: /inuent|repert|descubr|descouu|decouu|scopert|ritrouat|discouer|nouiter|nuper/ },
];

/** Hits on one page: { family: count }, or null when none. */
export function pageHits(text) {
  const t = normNW(text);
  if (!t) return null;
  let out = null;
  for (const f of FAMILIES) {
    f.re.lastIndex = 0;
    const m = t.match(f.re);
    if (!m) continue;
    if (f.needs && !f.needs.test(t)) continue;
    (out ??= {})[f.key] = m.length;
  }
  return out;
}

export const isStrong = hits => !!hits && Object.keys(hits).some(k => FAMILIES.find(f => f.key === k)?.strong);

/** Context snippets for by-eye checking of what a family matched (internal only, never published). */
export function snippets(text, key, width = 80) {
  const t = normNW(text);
  const f = FAMILIES.find(x => x.key === key);
  const out = [];
  for (const m of t.matchAll(new RegExp(f.re.source, 'g'))) {
    out.push(t.slice(Math.max(0, m.index - width), m.index + m[0].length + width));
    if (out.length >= 3) break;
  }
  return out;
}
