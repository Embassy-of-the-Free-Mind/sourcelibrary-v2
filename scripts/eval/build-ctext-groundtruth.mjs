#!/usr/bin/env node
/**
 * Build ctext-sourced OCR ground-truth files for the Chinese corpus.
 *
 * For each canonical work we hold, this finds the book + page where the work's
 * opening passage appears, scores our OCR against ctext's canonical text with the
 * subsequence aligner (commentary skipped free), and — only if it aligns cleanly
 * (the book-identity / recension guard) — writes a pinned ground-truth file to
 * scripts/eval/ground-truth/.  `qa-eval compare --against=ocr --corpus=chinese`
 * then re-scores those pages into a repeatable corpus accuracy number.
 *
 * The reference snippets are short, public-domain classical passages; ctext is
 * credited as the source. We compare against them, never re-host them.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/build-ctext-groundtruth.mjs [--threshold=0.30] [--write]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { subsequenceCER } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const THRESHOLD = parseFloat(args.threshold || '0.30');
const WRITE = !!args.write;
const ZH = ['Chinese', 'Classical Chinese', 'Literary Chinese'];

// work, slug, title regex, opening anchor, ctext source url, canonical reference text
const WORKS = [
  ['Daodejing ch.1', 'daodejing-1', '道德經|Tao Te Ching|Laozi|道德真經', '道可道', 'https://ctext.org/dao-de-jing/zh',
    '道可道，非常道。名可名，非常名。無名天地之始；有名萬物之母。故常無欲，以觀其妙；常有欲，以觀其徼。此兩者，同出而異名，同謂之玄。玄之又玄，衆妙之門。'],
  ['Analects 1.1', 'analects-xue-er', '論語|Analects|Four Books|四書', '學而時習之', 'https://ctext.org/analects/xue-er/zh',
    '學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？人不知而不慍，不亦君子乎？'],
  ['Mengzi 1.1', 'mengzi-liang-hui-wang', '孟子|Mencius|Four Books|四書', '孟子見梁惠王', 'https://ctext.org/mengzi/liang-hui-wang-i/zh',
    '孟子見梁惠王。王曰：叟不遠千里而來，亦將有以利吾國乎？孟子對曰：王何必曰利？亦有仁義而已矣。'],
  ['Great Learning', 'da-xue', '大學|Great Learning|Four Books|四書', '大學之道', 'https://ctext.org/liji/da-xue/zh',
    '大學之道，在明明德，在親民，在止於至善。知止而后有定，定而后能靜，靜而后能安，安而后能慮，慮而后能得。物有本末，事有終始，知所先後，則近道矣。'],
  // Doctrine of the Mean REMOVED 2026-07-19: the only aligning page was Daxue
  // Huowen commentary that merely alludes to 天命 — the stored OCR half-read the
  // page then RECITED the Zhongyong opening from memory (verified against the
  // scan). Pages that discuss a canonical text prime recitation; re-add only
  // with a page that verifiably PRINTS the passage, checked against the image.
  ['Zhuangzi 1', 'zhuangzi-xiaoyaoyou', '莊子|Zhuangzi|南華', '北冥有魚', 'https://ctext.org/zhuangzi/enjoyment-in-untroubled-ease/zh',
    '北冥有魚，其名為鯤。鯤之大，不知其幾千里也。化而為鳥，其名為鵬。鵬之背，不知其幾千里也；怒而飛，其翼若垂天之雲。是鳥也，海運則將徙於南冥。'],
  ['Xunzi (Quan Xue)', 'xunzi-quan-xue', '荀子|Xunzi', '學不可以已', 'https://ctext.org/xunzi/quan-xue/zh',
    '君子曰：學不可以已。青、取之於藍，而青於藍；冰、水為之，而寒於水。木直中繩，輮以為輪，其曲中規，雖有槁暴，不復挺者，輮使之然也。'],
  ['Book of Odes (Guan Ju)', 'shijing-guan-ju', '詩經|Book of Poetry|Odes|毛詩|Collected Interpretations', '關關雎鳩', 'https://ctext.org/book-of-poetry/guan-ju/zh',
    '關關雎鳩、在河之洲。窈窕淑女、君子好逑。參差荇菜、左右流之。窈窕淑女、寤寐求之。求之不得、寤寐思服。悠哉悠哉、輾轉反側。參差荇菜、左右采之。窈窕淑女、琴瑟友之。參差荇菜、左右芼之。窈窕淑女、鍾鼓樂之。'],
  ['Shiji (Wu Di)', 'shiji-wu-di', '史記|Records of the Grand|Shiji', '黃帝者', 'https://ctext.org/shiji/wu-di-ben-ji/zh',
    '黃帝者，少典之子，姓公孫，名曰軒轅。生而神靈，弱而能言，幼而徇齊，長而敦敏，成而聰明。軒轅之時，神農氏世衰。'],
  ['Han Feizi (Nan Yan)', 'hanfeizi-nan-yan', '韓非子|Han Feizi', '臣非非難言也', 'https://ctext.org/hanfeizi/nan-yan/zh',
    '臣非非難言也，所以難言者：言順比滑澤，洋洋纚纚然，則見以為華而不實。敦祗恭厚，鯁固慎完，則見以為掘而不倫。多言繁稱，連類比物，則見以為虛而無用。'],
];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set (source .env.production.local)'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const B = db.collection('books'), P = db.collection('pages');
const gtDir = path.join(__dirname, 'ground-truth');
if (WRITE) fs.mkdirSync(gtDir, { recursive: true });

let written = 0, skipped = 0;
for (const [work, slug, rx, anchor, sourceUrl, ref] of WORKS) {
  const books = await B.find(
    { language: { $in: ZH }, $or: [{ title: { $regex: rx, $options: 'i' } }, { display_title: { $regex: rx, $options: 'i' } }] },
    { projection: { id: 1, _id: 1, title: 1, display_title: 1 }, sort: { pages_translated: -1 } },
  ).limit(10).toArray();

  let best = null;
  for (const bk of books) {
    const bookId = bk.id || bk._id.toString();
    const pg = await P.findOne({ book_id: bookId, 'ocr.data': { $regex: anchor } }, { projection: { page_number: 1, 'ocr.data': 1 } });
    if (!pg) continue;
    const { cer } = subsequenceCER(ref, pg.ocr.data);
    if (!best || cer < best.cer) best = { bookId, page: pg.page_number, cer, title: bk.display_title || bk.title };
  }

  if (!best) { console.log(`SKIP  ${work}: no book holds this passage`); skipped++; continue; }
  if (best.cer > THRESHOLD) {
    console.log(`SKIP  ${work}: best CER ${(best.cer * 100).toFixed(0)}% > ${(THRESHOLD * 100).toFixed(0)}% (wrong book or divergent recension) — [${best.title.slice(0, 30)}]`);
    skipped++; continue;
  }

  const gt = {
    work, book_id: best.bookId, page_number: best.page, script: 'cjk',
    language: 'Chinese', source: 'ctext', source_url: sourceUrl,
    anchor, ocr_ground_truth: ref,
  };
  console.log(`WRITE ${work}: ${best.bookId} p${best.page}  CER=${(best.cer * 100).toFixed(1)}%  [${best.title.slice(0, 30)}]`);
  if (WRITE) fs.writeFileSync(path.join(gtDir, `chinese-${slug}.json`), JSON.stringify(gt, null, 2) + '\n');
  written++;
}

console.log(`\n${WRITE ? 'Wrote' : 'Would write'} ${written} ground-truth files, skipped ${skipped}. ${WRITE ? '' : '(dry run — pass --write to save)'}`);
await client.close();
