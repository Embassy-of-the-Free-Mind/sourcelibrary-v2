import data from './sibu-catalogue.json';

/**
 * The 四部 catalogue: Chinese books by the classes of the Siku Quanshu catalogue, one row per
 * work. Lets a scholar find a work the way the tradition files it, where the subject shelves
 * under /collections are a browsing aid.
 *
 * PRIOR ART: src/lib/canon-works.ts — editions of one canonical work, with no notion of a
 * class; es-collections.ts — hand-curated shelves, while this covers every Chinese book.
 *
 * The rows are a committed snapshot from scripts/maintenance/build-sibu-catalogue.mjs. Importing
 * it from a client component would ship ~250 KB to every reader, so server components only.
 */
export interface SibuRow {
  cls: string | null;
  kr: string | null;
  /** How the class was assigned; see the build script. */
  source: 'kanripo' | 'title' | 'confirmed' | 'none';
  title: string;
  gloss: string | null;
  dynasty: string | null;
  author: string | null;
  vols: number;
  pages: number;
  /** Slug or id of the first volume: where the row links. Its page lists the others. */
  first: string;
}

export interface SibuClass { code: string; zh: string; en: string }
export interface SibuPart { code: string; zh: string; en: string; classes: SibuClass[]; canon?: boolean }

export const OUTSIDE_CODE = 'other';

export const SIBU_PARTS: SibuPart[] = [
  {
    code: 'KR1', zh: '经部', en: 'Classics',
    classes: [
      { code: 'KR1a', zh: '易类', en: 'Changes' },
      { code: 'KR1b', zh: '书类', en: 'Documents' },
      { code: 'KR1c', zh: '诗类', en: 'Odes' },
      { code: 'KR1d', zh: '礼类', en: 'Rites' },
      { code: 'KR1e', zh: '春秋类', en: 'Spring and Autumn Annals' },
      { code: 'KR1f', zh: '孝经类', en: 'Classic of Filial Piety' },
      { code: 'KR1g', zh: '五经总义类', en: 'General works on the Five Classics' },
      { code: 'KR1h', zh: '四书类', en: 'Four Books' },
      { code: 'KR1i', zh: '乐类', en: 'Music' },
      { code: 'KR1j', zh: '小学类', en: 'Philology' },
    ],
  },
  {
    code: 'KR2', zh: '史部', en: 'Histories',
    classes: [
      { code: 'KR2a', zh: '正史类', en: 'Standard histories' },
      { code: 'KR2b', zh: '编年类', en: 'Annals' },
      { code: 'KR2c', zh: '纪事本末类', en: 'Topical histories' },
      { code: 'KR2d', zh: '别史类', en: 'Separate histories' },
      { code: 'KR2e', zh: '杂史类', en: 'Miscellaneous histories' },
      { code: 'KR2f', zh: '诏令奏议类', en: 'Edicts and memorials' },
      { code: 'KR2g', zh: '传记类', en: 'Biographies' },
      { code: 'KR2h', zh: '史钞类', en: 'Historical excerpts' },
      { code: 'KR2i', zh: '载记类', en: 'Records of regional states' },
      { code: 'KR2j', zh: '时令类', en: 'Seasonal observances' },
      { code: 'KR2k', zh: '地理类', en: 'Geography' },
      { code: 'KR2l', zh: '职官类', en: 'Offices' },
      { code: 'KR2m', zh: '政书类', en: 'Institutions' },
      { code: 'KR2n', zh: '目录类', en: 'Bibliographies and epigraphy' },
      { code: 'KR2o', zh: '史评类', en: 'Historical criticism' },
    ],
  },
  {
    code: 'KR3', zh: '子部', en: 'Masters',
    classes: [
      { code: 'KR3a', zh: '儒家类', en: 'Confucians' },
      { code: 'KR3b', zh: '兵家类', en: 'Military' },
      { code: 'KR3c', zh: '法家类', en: 'Legalists' },
      { code: 'KR3d', zh: '农家类', en: 'Agriculture' },
      { code: 'KR3e', zh: '医家类', en: 'Medicine' },
      { code: 'KR3f', zh: '天文算法类', en: 'Astronomy and mathematics' },
      { code: 'KR3g', zh: '术数类', en: 'Divination and numerology' },
      { code: 'KR3h', zh: '艺术类', en: 'Arts' },
      { code: 'KR3i', zh: '谱录类', en: 'Manuals and catalogues of things' },
      { code: 'KR3j', zh: '杂家类', en: 'Miscellaneous thinkers' },
      { code: 'KR3k', zh: '类书类', en: 'Encyclopedias' },
      { code: 'KR3l', zh: '小说家类', en: 'Anecdotes and tales' },
    ],
  },
  {
    code: 'KR4', zh: '集部', en: 'Literary collections',
    classes: [
      { code: 'KR4a', zh: '楚辞类', en: 'Songs of Chu' },
      { code: 'KR4b', zh: '别集类·汉六朝', en: 'Individual collections: Han to Six Dynasties' },
      { code: 'KR4c', zh: '别集类·唐', en: 'Individual collections: Tang' },
      { code: 'KR4d', zh: '别集类·宋', en: 'Individual collections: Song' },
      { code: 'KR4e', zh: '别集类·明', en: 'Individual collections: Ming' },
      { code: 'KR4f', zh: '别集类·清', en: 'Individual collections: Qing' },
      { code: 'KR4g', zh: '别集类·近代', en: 'Individual collections: modern' },
      { code: 'KR4h', zh: '总集类', en: 'Anthologies' },
      { code: 'KR4i', zh: '诗文评类', en: 'Literary criticism' },
      { code: 'KR4j', zh: '词曲类', en: 'Lyrics and drama' },
    ],
  },
  {
    code: 'KR5', zh: '道藏', en: 'Daoist canon', canon: true,
    classes: [
      { code: 'KR5a', zh: '洞真部', en: 'Dongzhen' },
      { code: 'KR5b', zh: '洞玄部', en: 'Dongxuan' },
      { code: 'KR5c', zh: '洞神部', en: 'Dongshen' },
      { code: 'KR5d', zh: '太玄部', en: 'Taixuan' },
      { code: 'KR5e', zh: '太平部', en: 'Taiping' },
      { code: 'KR5f', zh: '太清部', en: 'Taiqing' },
      { code: 'KR5g', zh: '正一部', en: 'Zhengyi' },
      { code: 'KR5h', zh: '续道藏', en: 'Supplement to the canon' },
      { code: 'KR5i', zh: '清代道教文献', en: 'Qing Daoist texts' },
      { code: 'KR5j', zh: '敦煌道教文献', en: 'Dunhuang Daoist texts' },
    ],
  },
  {
    code: 'KR6', zh: '佛藏', en: 'Buddhist canon', canon: true,
    classes: [
      { code: 'KR6a', zh: '阿含部类', en: 'Agamas' },
      { code: 'KR6b', zh: '本缘部类', en: 'Birth stories' },
      { code: 'KR6c', zh: '般若部类', en: 'Perfection of Wisdom' },
      { code: 'KR6d', zh: '法华部类', en: 'Lotus' },
      { code: 'KR6e', zh: '华严部类', en: 'Avatamsaka' },
      { code: 'KR6f', zh: '宝积部类', en: 'Ratnakuta' },
      { code: 'KR6g', zh: '涅槃部类', en: 'Nirvana' },
      { code: 'KR6h', zh: '大集部类', en: 'Mahasamnipata' },
      { code: 'KR6i', zh: '经集部类', en: 'Sutra collections' },
      { code: 'KR6j', zh: '密教部类', en: 'Esoteric' },
      { code: 'KR6k', zh: '律部类', en: 'Vinaya' },
      { code: 'KR6l', zh: '毘昙部类', en: 'Abhidharma' },
      { code: 'KR6m', zh: '中观部类', en: 'Madhyamaka' },
      { code: 'KR6n', zh: '瑜伽部类', en: 'Yogacara' },
      { code: 'KR6o', zh: '论集部类', en: 'Treatises' },
      { code: 'KR6p', zh: '净土宗部类', en: 'Pure Land' },
      { code: 'KR6q', zh: '禅宗部类', en: 'Chan' },
      { code: 'KR6r', zh: '史传部类', en: 'Histories and biographies' },
      { code: 'KR6s', zh: '事汇部类', en: 'Compendia' },
      { code: 'KR6t', zh: '续诸宗', en: 'Other schools' },
      { code: 'KR6u', zh: '敦煌写本部类', en: 'Dunhuang manuscripts' },
      { code: 'KR6v', zh: '新编部类', en: 'New compilations' },
    ],
  },
];

const ROWS = data.rows as SibuRow[];

export const SIBU_GENERATED: string = data.generated;
export const SIBU_TOTALS = { works: data.works as number, volumes: data.volumes as number };

export interface SibuCount { works: number; vols: number }

function tally(rows: SibuRow[]): SibuCount {
  return { works: rows.length, vols: rows.reduce((n, r) => n + r.vols, 0) };
}

export function sibuRows(code: string): SibuRow[] {
  return code === OUTSIDE_CODE ? ROWS.filter((r) => !r.cls) : ROWS.filter((r) => r.cls === code);
}

export function sibuClass(code: string): (SibuClass & { part: SibuPart }) | null {
  for (const part of SIBU_PARTS) {
    const c = part.classes.find((x) => x.code === code);
    if (c) return { ...c, part };
  }
  return null;
}

export function sibuCount(code: string): SibuCount {
  return tally(sibuRows(code));
}

export function sibuPartCount(part: SibuPart): SibuCount {
  return tally(ROWS.filter((r) => r.cls?.startsWith(part.code)));
}

/** Every code with a page: a class we hold, an empty Siku class, and the outside list. */
export function sibuCodes(): string[] {
  return [...SIBU_PARTS.flatMap((p) => p.classes.map((c) => c.code)), OUTSIDE_CODE];
}
