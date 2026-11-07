#!/usr/bin/env node
/**
 * PRIOR ART: additive-mint-authors-3780.mjs (still does the minting: this emits its verdicts), repair-bare-name-variants-4318.mjs
 * (literal book moves; shape copied, list closed), repair-author-links-8035.mjs on PR #8081 (dead ids and wrong people; it left
 * the ids that still redirect, and took no anchor off), backfill-author-canonical-links.mjs (exact string to one doc, so it cannot
 * link a compound byline, and a compound must not become a variant).
 *
 * zh-author-identity-8035 — finish the Chinese author layer (#8035). A reader of /zh who clicks a name reaches that person's page.
 *
 *   --emit-verdicts=<path>  verdicts for additive-mint-authors-3780.mjs (the people below with no record)
 *   --phase=anchors         wrong QIDs off, right ones on, slugs and aliases of the wrong person pulled, a dead doc retired
 *   --phase=names           Han name forms: a variant where it is safe to match on, and `localized.zh.name` for the page heading
 *   --phase=links           books with no link, on their holding library or on another person's doc, to the person; three byline typos
 *   --phase=ids             corpus-wide: an author_id with no doc of its own moves to the doc that answers to it
 *   --phase=measure         Chinese coverage (read only)
 *
 * Dry run by default; add --apply. Every write logs to sweep_log first with the old values (sweep zh-author-identity-8035), and the
 * minted docs carry source zh-author-identity-8035, so the run can be reversed from the log.
 *
 * EVIDENCE, by batch.
 *   Wrong anchors: authority record. CBDB dates 白允箕 to Qing and 黎逸民 to Ming; the books say 明白雲霽撰 (OCR, 提要) and the
 *   doc's own 李逸民. Q65855991 is 周謹權; the book says 金陵周近泉繡梓 (OCR).
 *   Mints, Siku/Kanripo volumes: the byline as catalogued, checked by me against the title. The romanisation is from my knowledge.
 *   Anchors added: authority record agreeing with OCR. 張理: 提要 元張理撰理字仲純, Q45681150 alias 仲純. 錢時: 宋錢時撰, alias
 *   融堂. 王希明: 唐王希明撰, Tang. 王朴: 舊本題後周王朴撰, Later Zhou (the 提要 doubts the attribution, not the man). 姚球:
 *   Qing, alias 頤真 (his courtesy name from my knowledge). 張華: Q712345 names him, 232-300.
 *   楊爵: OCR 提要 明楊爵撰爵字伯修富平人, Q11101888 alias 伯修, 1493-1549. 孟子: Q188903 label, the book's own title.
 *   蕭吉 is not anchored: Q75995725 has the name and a birth year and no work, so the identity does not check.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { authorSlug } from '../lib/author-name-key.mjs';
import { setCatalogueFields } from '../lib/catalogue-fields.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'zh-author-identity-8035';
const SCRIPT = 'scripts/maintenance/zh-author-identity-8035.mjs';
const APPLY = process.argv.includes('--apply');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || null;
const PHASE = arg('phase');
const ZH = /^(chinese|classical chinese|literary chinese)/i;
const LIVE_ZH = { visible: true, pages_count: { $gt: 0 }, language: ZH };

/** People with no record: [Han, romanisation, options]. `author` is the stored byline, where it is not the bare Han name. */
const MINT = [
  // Named in the brief; anchored where the identity checks.
  ['蕭吉', 'Xiao Ji', { author: 'Xiao Ji', extra: ['蕭吉'] }],
  ['張華', 'Zhang Hua', { author: 'Zhang Hua (張華, 232-300 CE)', extra: ['張華'], wikidata_id: 'Q712345', viaf_id: '116881671', birth: 232, death: 300, description: 'Chinese official and poet (232-300)' }],
  ['姚球', 'Yao Qiu', { author: '姚球 (Yao Qiu)', extra: ['姚球'], wikidata_id: 'Q65917580' }],
  ['王朴', 'Wang Pu', { wikidata_id: 'Q11573113', birth: 915, death: 959, description: 'Later Zhou dynasty official' }],
  ['王希明', 'Wang Ximing', { wikidata_id: 'Q18905366' }],
  ['錢時', 'Qian Shi', { wikidata_id: 'Q45432675' }],
  // Found on an engraver's doc. OCR 提要: 周易辨錄四卷明楊爵撰爵字伯修富平人.
  // No doc in the corpus; his 孟子 reached by Legge's edition. Q188903 label 孟子.
  ['孟子', 'Mencius', { author: 'Mencius (ed. James Legge)', extra: ['孟子', 'Mencius'], wikidata_id: 'Q188903', description: 'Chinese Confucian philosopher' }],
  ['楊爵', 'Yang Jue', { wikidata_id: 'Q11101888', birth: 1493, death: 1549, description: 'Ming dynasty official' }],
  // Bylines of live volumes, each read against its title; no doc has these characters.
  ...`法藏 Fazang|智顗 Zhiyi|蔡元定 Cai Yuanding|薛據 Xue Ju|佛陀波利 Fotuoboli|賈誼 Jia Yi|胡宏 Hu Hong|劉荀 Liu Xun|陳淳 Chen Chun|張洪 Zhang Hong
程端禮 Cheng Duanli|謝應芳 Xie Yingfang|呂坤 Lü Kun|龐安時 Pang Anshi|趙南星 Zhao Nanxing|周宗建 Zhou Zongjian|章世純 Zhang Shichun|曾貫 Zeng Guan
史繩祖 Shi Shengzu|黃生 Huang Sheng|姜宸英 Jiang Chenying|應劭 Ying Shao|龐元英 Pang Yuanying|齊德之 Qi Dezhi|錢易 Qian Yi|王闢之 Wang Pizhi|沈彤 Shen Tong
陸粲 Lu Can|黃仲元 Huang Zhongyuan|何大任 He Daren|徐學謨 Xu Xuemo|楊于庭 Yang Yuting|王介之 Wang Jiezhi|齊履謙 Qi Lüqian|吳棫 Wu Yu|何光遠 He Guangyuan
陶穀 Tao Gu|吳彥夔 Wu Yankui|熊朋來 Xiong Penglai|舒天民 Shu Tianmin|張元素 Zhang Yuansu|王明清 Wang Mingqing|莊綽 Zhuang Chuo|王惲 Wang Yun|徐三重 Xu Sanzhong
李日華 Li Rihua|馮班 Feng Ban|和凝 He Ning|黃佐 Huang Zuo|王坦 Wang Tan|顏師古 Yan Shigu|史游 Shi You|汪憲 Wang Xian|陳桷 Chen Jue|張讀 Zhang Du|范祖禹 Fan Zuyu
張虙 Zhang Fu|李文仲 Li Wenzhong|徐問 Xu Wen|楊筠松 Yang Yunsong|王錫闡 Wang Xichan|趙善譽 Zhao Shanyu|胡方平 Hu Fangping|倪元璐 Ni Yuanlu|張端義 Zhang Duanyi
張志淳 Zhang Zhichun|文震亨 Wen Zhenheng|杜公瞻 Du Gongzhan|龍仁夫 Long Renfu|陳大猷 Chen Dayou|陳悅道 Chen Yuedao|沈作喆 Shen Zuozhe|朱謀㙔 Zhu Mouwei|車垓 Che Gai
郭若虛 Guo Ruoxu|盛熙明 Sheng Ximing|夏文彥 Xia Wenyan|趙宧光 Zhao Yiguang|梅鷟 Mei Zhuo|蘇易簡 Su Yijian|史鑄 Shi Zhu|楊時 Yang Shi|王嘉 Wang Jia|趙彥肅 Zhao Yansu
曹端 Cao Duan|義忠 Yizhong|王肅 Wang Su|不空 Amoghavajra|曇無讖 Dharmakṣema|慧祥 Huixiang|劉徽 Liu Hui|月溪法師 Yuexi|季本 Ji Ben|康僧鎧 Saṅghavarman|沈繼孫 Shen Jisun
義淨 Yijing|夏侯陽 Xiahou Yang|唐臨 Tang Lin|宗密 Zongmi|陳言 Chen Yan|嚴用和 Yan Yonghe|曾文辿 Zeng Wenchan|馮武 Feng Wu|張以寧 Zhang Yining|林至 Lin Zhi|蔡淵 Cai Yuan
張參 Zhang Can|唐玄度 Tang Xuandu|房玄齡 Fang Xuanling|曉山老人 Xiaoshan Laoren|陳元靚 Chen Yuanjing|胡宗憲 Hu Zongxian|程大約 Cheng Dayue|唐岱 Tang Dai|李淳風 Li Chunfeng
程瑶田 Cheng Yaotian|阮元 Ruan Yuan|王宗涑 Wang Zongsu|憨山德清 Hanshan Deqing|施護 Shihu|魏徵 Wei Zheng|虛堂智愚 Xutang Zhiyu|大慧宗杲 Dahui Zonggao|雲門文偃 Yunmen Wenyan
魏伯陽 Wei Boyang|密菴咸傑 Mi'an Xianjie|師明 Shiming|傅仁宇 Fu Renyu|臨濟義玄 Linji Yixuan|笑隱大訢 Xiaoyin Daxin|應菴曇華 Ying'an Tanhua|破菴祖先 Po'an Zuxian
松源崇嶽 Songyuan Chongyue|五祖法演 Wuzu Fayan|脫脫 Toqto'a`.split(/[|\n]/).map((s) => { const [h, ...r] = s.trim().split(' '); return [h, r.join(' '), {}]; }),
];
const mintId = (han, rom) => authorSlug(`${han} (${rom})`);
const MINT_ID = new Map(MINT.map(([h, r]) => [h, mintId(h, r)]));

/**
 * Stored byline → person, for bylines that are not a bare name. Each string's own grammar names the principal (author against
 * comp./ed./comm./tr.); the rest of the string never becomes a variant, so it cannot claim anyone else's books.
 * Refused, left unlinked: co-equal pairs (Hunter + 李鴻章, Schreck + 王徵, Schall + 徐光啟, Pedrini + Kangxi, 焦秉貞 + Kangxi),
 * anthologies (張伯端 et al., Various*), 葉□ (the name is lost in the source), institutions with no doc.
 */
const LINK_COMPOUND = {
  '(唐)魏徵等撰': '魏徵',
  '虛堂智愚 (Xutang Zhiyu); 妙源 (Miaoyuan), comp.': '虛堂智愚',
  '大慧宗杲 (Dahui Zonggao); 蘊聞 (Yunwen), comp.': '大慧宗杲',
  '雲門文偃 (Yunmen Wenyan); 守堅 (Shoujian), comp.': '雲門文偃',
  '魏伯陽 Wei Boyang (attrib.); comm. 蔣一彪 Jiang Yibiao': '魏伯陽',
  '魏伯陽 Wei Boyang; comm. 俞琰 Yu Yan': '魏伯陽',
  '魏伯陽 Wei Boyang; comm. 陳致虛 Chen Zhixu': '魏伯陽',
  "密菴咸傑 (Mi'an Xianjie); 崇岳 (Chongyue), 了悟 (Liaowu) et al., comp.": '密菴咸傑',
  '師明 (Shiming), comp.': '師明',
  '傅仁宇, active 1644.; Renyu Fu active 1644.; 林長生; 張秀; 周靖公; 張文凱; 傳維藩; Changsheng Lin; Xiu Zhang; Jinggong Zhou; Wenkai Zhang; Weifan Fu': '傅仁宇',
  '臨濟義玄 (Linji Yixuan); 慧然 (Huiran), comp.': '臨濟義玄',
  '笑隱大訢 (Xiaoyin Daxin); 延俊 (Yanjun) et al., comp.': '笑隱大訢',
  "應菴曇華 (Ying'an Tanhua); 守詮 (Shouquan) et al., comp.": '應菴曇華',
  "破菴祖先 (Po'an Zuxian); 圓照 (Yuanzhao) et al., comp.": '破菴祖先',
  '松源崇嶽 (Songyuan Chongyue); 善開 (Shankai) et al., comp.': '松源崇嶽',
  '五祖法演 (Wuzu Fayan); 才良 (Cailiang) et al., comp.': '五祖法演',
  "Toqto'a (脱脱) et al., comp.": '脫脫',
};

/** Stored byline → an EXISTING doc, checked by characters or QID and by the doc's dates against the work. */
const LINK_EXISTING = {
  '實叉難陀': 'siksananda-trans',
  '孫思邈': 'sun-simiao',
  '世宗胤禛': 'yongzheng-emperor',
  '宋徽宗': 'emperor-huizong-of-song',
  '王惟一': 'wang-weiyi',
  '司馬遷 (Sima Qian)': 'sima-qian',
  'Chen Yang (陳暘)': 'chen-yang',
  "Wu Cheng'en (吳承恩); Li Zhuowu (李卓吾), ed.": 'wu-cheng-en',
  '慧洪': 'huihong',
  '劉安': 'liu-an',
  '劉安 (Liu An) et al.': 'liu-an',
  '戴震': 'dai-zhen-ed',
  '吳謙 et al.': 'wu-qian',
  '司農司': 'sinong-si',
  'Liezi (attrib.); Zhang Zhan (comm.); Japanese ed. 1912': 'liezi',
  'Imperial Astronomical Bureau': 'qing-imperial-astronomical-bureau',
};

/** On the doc of the Bavarian State Library, which holds these volumes and did not write them. Byline → the person. */
const LINK_OFF_HOLDER = {
  'Xuanzang yi (玄奘譯)': 'xuanzang',
  'Xuanzang yi; Chen Shi yin zao (玄奘譯; 陳實印造)': 'xuanzang',
  '[Hsüan-tsang übers.] ([玄奬譯])': 'xuanzang',
  'Jiumoluoshi [Kumārajīva] yi (鳩摩羅什譯)': 'kumarajiva-tr',
  'Jiumoluoshi yi (鳩摩羅什譯)': 'kumarajiva-tr',
  'Sichanantuo yi (實叉難陀譯)': 'siksananda-trans',
  'Shi Hu yi; Lin Jie yin zao; Chen Tong kan (施護譯; 林傑印造; 陳通刊)': '施護',
  'Huineng (慧能); Fahai (法海), ed.': 'huineng',
};
const HOLDER = 'bayerische-staatsibliothek';

/** Books on another person's doc: `to` is who wrote them, null where the byline names nobody (未詳 is "author unknown"). */
const OFF_WRONG_DOC = [
  { author: '楊爵', from: 'm-yang-engraver', to: '楊爵' },
  { author: '未詳', from: 'ma-gong', to: null },
];

/** The stored byline is wrong, read against the title and OCR. Goes through setCatalogueFields. */
const BYLINE = [
  { author: '黃宗義', to: '黃宗羲', title: /^孟子師說/, doc: 'huang-zongxi', evidence: '孟子師說 is by 黃宗羲; 黃宗義 is a slip for 羲 (from knowledge)' },
  { author: '(侍者)福善日', to: '憨山德清', title: /^憨山老人夢遊集/, doc: '憨山德清', evidence: 'OCR 憨山老人夢遊集卷一 侍者福善目錄 門人通炯編輯: 福善 made the table of contents; the byline is a misread of it' },
  { author: 'Wang Xi', to: '王希明', title: /^太乙金鏡式經/, doc: '王希明', evidence: 'OCR 提要 太乙金鏡式經十卷唐王希明撰; ai_metadata.author also read Wang Ximing' },
];

/** Docs whose anchor or match surface carries another person. `set`/`unset` are thesaurus fields; all before-values are logged. */
const WRONG_QID_FIELDS = ['wikidata_id', 'anchored_by', 'wikidata_description', 'wikidata_birth_year', 'wikidata_death_year', 'aliases'];
const ANCHORS = [
  { id: 'ma-gong', set: { variants: ['Ma Gong'] }, why: '未詳 means "author unknown": it matched every such byline to Zhu Yuanzhang\'s father-in-law' },
  { id: 'm-yang-engraver', set: { variants: ['M. Yang (engraver)'] }, why: '楊爵 is the Ming official who wrote 周易辨錄, not this engraver' },
  { id: 'bai-yunji', unset: WRONG_QID_FIELDS, why: 'Q65820391 is 白允箕 (CBDB 416219, Qing); 道藏目錄詳註 is by 明 白雲霽' },
  { id: 'li-yimin', unset: WRONG_QID_FIELDS, why: 'Q65901802 is 黎逸民 (CBDB 437103, Ming); 忘憂清樂集 is by 李逸民, Song' },
  { id: 'zhou-jinquan-pub', unset: WRONG_QID_FIELDS, why: 'Q65855991 is 周謹權; the book reads 金陵周近泉繡梓' },
  { id: 'zhang-li', set: { wikidata_id: 'Q45681150', viaf_id: '6313157342849710100001', anchored_by: SWEEP }, pullSlugs: ['zhang-hua-232-300-ce'], why: '提要 元張理撰理字仲純; Q45681150 Yuan, alias 仲純. The slug was 張華\'s' },
  { id: 'wang-gai', pullAliases: ['芥子園', 'jie zi yuan'], pullSlugs: ['wang-xi'], why: 'Q3566056 is right. 芥子園 is 李漁\'s garden, not a name of his; wang-xi was 王希明\'s byline' },
  // Holds no books by id, variant or entity. Its name fits neither Q837912 (蕭紀, emperor of Liang) nor anyone we hold.
  { id: 'li-xiaojiang', retire: true, unset: [...WRONG_QID_FIELDS, 'viaf_id'], pullSlugs: ['xiao-ji'], why: 'no books; xiao-ji is 蕭吉\'s and now his own doc' },
];

/**
 * Han form for a doc that has none: [id, name, match]. `name` is what the author page shows (`localized.zh.name`). `match` is the
 * form added to variants[], the match surface, and is left out where it is not one person: 孫子 names two, 欽天監 is on two docs,
 * and a compound or attribution heading is no name. Evidence: seed-zh-author-names.mjs readings, and OCR where the comment says.
 */
const NAMES = [
  ['cheng-dawei', '程大位'], ['stephen-alexander-hunter', '洪士提反'], ['james-legge', '理雅各'], ['jia-sixie', '賈思勰'], ['shen-kuo', '沈括'],
  ['wang-gai', '王概', ['王概', '王槩']], ['matteo-ricci', '利瑪竇'], ['zang-maoxun', '臧懋循'], ['mozi', '墨子', ['墨子', '墨翟']], ['sabbathino-de-ursis', '熊三拔'],
  ['bai-yunji', '白雲霽'], ['confucius', '孔子'], ['laozi', '老子'], ['wu-qian', '吳謙'], ['xu-guangqi', '徐光啟'], ['benjamin-hobson', '合信'],
  ['xunzi', '荀子', ['荀子', '荀況']], ['emperor-taizong-of-tang', '唐太宗'], ['shi-daoshi', '釋道世', ['釋道世', '道世']], ['wang-weiyi', '王惟一'], ['yang-weide', '楊惟德'],
  ['zhang-li', '張理'], ['wang-yangming', '王陽明', ['王陽明', '王守仁']], ['li-huang', '李潢'], ['faxian', '法顯'], ['chen-yuanlong', '陳元龍'], ['seraphin-couvreur', '顧賽芬'],
  ['zhao-rugua', '趙汝适'], ['kaibara-ekiken', '貝原益軒'], ['zhang-nan', '張楠'], ['queen-sohye-commissioner', '昭惠王后'], ['zhuangzi', '莊子', ['莊子']],
  ['zhu-zhenheng', '朱震亨'], ['sun-simiao', '孫思邈'], ['sima-qian', '司馬遷'], ['huineng', '慧能', ['慧能', '惠能']], ['henry-dwight-porter', '博恒理'], ['chen-huan-chang', '陳煥章'],
  ['shao-pingxuan', '邵平軒'],        // OCR 雲溪竹隱老人邵平軒撰
  ['qiu-weiling', '邱煒萲'],          // page image 海澄 邱煒萲 菽園; the OCR's 菱 and the stored "Weiling" misread 萲
  ['chen-fuxin', '陳復心'],           // OCR 明 陳復心老人編著
  ['chen-zhizun', '陳之遵'],          // OCR 西湖後學陳之遵道升甫編著; Q45449651 is 陳之遵
  ['lei-feng', '雷豐'],               // OCR 柯城少逸雷豐補說
  ['zhou-jinquan-pub', '周近泉'],     // OCR 金陵周近泉繡梓
  ['baegun', '白雲景閑'],
  ['kunshan-national-learning-association', '崑山國樂保存會'], // OCR p29 崑山國樂保存會編校
  ['faying', '法應'],
  ['m-yang-engraver', '石埭楊氏', []],
  ['emperor-xuanzong-of-tang', '唐玄宗'],
  // No bare Han variant on the doc; the characters are in its own bylines or titles (陳摶, 南懷仁, 忽思慧, 王珪...).
  ['chen-shiduo', '陳士鐸'], ['chen-tuan', '陳摶'], ['ferdinand-verbiest', '南懷仁'], ['gaofeng-yuanmiao', '高峰原妙'], ['hu-sihui', '忽思慧'], ['kim-bu-sik', '金富軾'],
  ['liu-an', '劉安'], ['pu-songling', '蒲松齡'], ['song-yingxing', '宋應星'], ['tianru-weize', '天如惟則'], ['wuzhun-shifan', '無準師範'], ['yang-jizhou', '楊繼洲'],
  ['zhu-zaiyu-prince-of-zheng', '朱載堉'], ['kangxi-emperor', '康熙帝'],
  ['wang-gui', '王珪', []], // two men: the Song chancellor and this Yuan physician
  ['yin-zhenren', '託名尹真人', []],
  ['siksananda-trans', '實叉難陀'],
  ['sun-zi', '孫子', []], ['qintian-jian-imperial-observatory', '欽天監', []], ['qing-imperial-astronomical-bureau', '欽天監', []],
  ['matteo-ricci-and-xu-guangqi', '利瑪竇；徐光啟', []], ['johann-terrenz-schreck-and-wang-zheng', '鄧玉函；王徵', []],
  ['attributed-to-huangdi', '託名黃帝', []], ['attributed-to-hua-tuo', '託名華佗', []], ['attributed-to-yuan-tiangang', '託名袁天罡', []],
];

const HAN = /[㐀-鿿豈-﫿]/;

if (arg('emit-verdicts')) {
  const lines = MINT.map(([han, rom, o]) => JSON.stringify({
    string: o.author || han,
    verdict: 'person',
    canonical_name: `${han} (${rom})`,
    slug: mintId(han, rom),
    // Each was searched by its characters and QID first. A key hit here is the romanisation colliding, never the person.
    standalone: true,
    ...(o.extra ? { extra_variants: o.extra } : {}),
    ...(o.wikidata_id ? { wikidata_id: o.wikidata_id } : {}),
    ...(o.viaf_id ? { viaf_id: o.viaf_id } : {}),
  }));
  writeFileSync(arg('emit-verdicts'), `${lines.join('\n')}\n`);
  console.log(`${lines.length} verdicts -> ${arg('emit-verdicts')}`);
  process.exit(0);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');

/** Log the fields about to change, then write. Nothing else in this script writes to `authors`. */
async function writeDoc(id, action, update, why) {
  const fields = [...Object.keys(update.$set || {}), ...Object.keys(update.$unset || {}), ...Object.keys(update.$pull || {}), ...Object.keys(update.$addToSet || {})];
  const before = await authors.findOne({ _id: id }, { projection: Object.fromEntries(fields.map((f) => [f.split('.')[0], 1])) });
  if (!APPLY) return;
  await recordSweepAction(db, { sweep: SWEEP, book_id: `author:${id}`, action, detail: { before, update, why }, script: SCRIPT });
  await authors.updateOne({ _id: id }, { ...update, $set: { ...(update.$set || {}), updated_at: new Date() } });
}

async function moveBook(b, to, method, matched) {
  const bookId = String(b.id ?? b._id);
  if (!APPLY) return 0;
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'set-author-id', detail: { author: b.author, before: b.author_id ?? null, after: to, method }, script: SCRIPT });
  const target = await authors.findOne({ _id: to }, { projection: { wikidata_id: 1, viaf_id: 1 } });
  const anchored = Boolean(target?.wikidata_id || target?.viaf_id);
  const r = await books.updateOne(
    { _id: b._id, author_id: b.author_id ?? { $exists: false } },
    { $set: { author_id: to }, $push: { author_link_provenance: { run: SWEEP, method, matched, authors_slug: to, anchored, confidence: anchored ? 'high' : 'medium', at: new Date() } } },
  );
  return r.modifiedCount;
}

async function anchors() {
  for (const a of ANCHORS) {
    const d = await authors.findOne({ _id: a.id });
    if (!d) { console.log(`MISSING ${a.id}`); continue; }
    if (a.retire) {
      const held = await books.countDocuments({ $or: [{ author_id: a.id }, { author: { $in: d.variants || [] } }, ...(d.entity_ids?.length ? [{ author_entity_id: { $in: d.entity_ids } }] : [])] });
      if (held) { console.log(`REFUSED retiring ${a.id}: ${held} books still point at it`); continue; }
    }
    const update = {};
    if (a.set) update.$set = a.set;
    if (a.retire) update.$set = { ...(update.$set || {}), is_person: false, quarantine_reason: a.why, quarantined_at: new Date(), quarantine_run: SWEEP };
    if (a.unset) update.$unset = Object.fromEntries(a.unset.map((f) => [f, '']));
    const pull = {};
    if (a.pullSlugs) pull.variant_slugs = { $in: a.pullSlugs };
    if (a.pullAliases) pull.aliases = { $in: a.pullAliases };
    if (Object.keys(pull).length) update.$pull = pull;
    if (a.set?.wikidata_id) {
      const other = await authors.findOne({ wikidata_id: a.set.wikidata_id, _id: { $ne: a.id } }, { projection: { _id: 1 } });
      if (other) { console.log(`REFUSED ${a.id}: ${a.set.wikidata_id} is on ${other._id}`); continue; }
    }
    console.log(`${a.id}: was ${d.wikidata_id ?? '-'} ${JSON.stringify(d.aliases ?? []).slice(0, 70)} slugs ${JSON.stringify(d.variant_slugs)} -> ${JSON.stringify(update).slice(0, 170)}\n   ${a.why}`);
    await writeDoc(a.id, a.retire ? 'retire-doc' : 'correct-anchor', update, a.why);
    // The page merges the legacy entity row over the doc: a wrong QID there would come straight back.
    for (const e of d.entity_ids || []) {
      const { ObjectId } = await import('mongodb');
      const row = ObjectId.isValid(e) ? await db.collection('entities').findOne({ _id: new ObjectId(e) }, { projection: { name: 1, wikidata_id: 1, aliases: 1 } }) : null;
      if (row?.wikidata_id && a.unset) console.log(`   ENTITY ${e} [${row.name}] still carries ${row.wikidata_id}: needs eyes`);
    }
  }
  for (const [han, rom, o] of MINT) {
    if (!o.birth && !o.description) continue;
    const id = mintId(han, rom);
    const set = { ...(o.birth ? { wikidata_birth_year: o.birth } : {}), ...(o.death ? { wikidata_death_year: o.death } : {}), ...(o.description ? { wikidata_description: o.description } : {}) };
    if (await authors.findOne({ _id: id }, { projection: { _id: 1 } })) await writeDoc(id, 'set-authority-dates', { $set: set }, 'from the Wikidata item that anchors the doc');
  }
}

async function names() {
  let named = 0, added = 0, refused = 0;
  for (const [id, name, match] of NAMES) {
    const d = await authors.findOne({ _id: id });
    if (!d) { console.log(`MISSING ${id} (${name})`); continue; }
    const forms = (match ?? [name]).filter((f) => !(d.variants || []).includes(f));
    // A variant is a match key: refuse one another live doc already carries, and print which doc.
    const safe = [];
    for (const f of forms) {
      const other = await authors.findOne({ variants: f, _id: { $ne: id }, merged_into: { $exists: false } }, { projection: { _id: 1 } });
      if (other) { console.log(`  REFUSED variant ${f} on ${id}: already on ${other._id}`); refused++; } else safe.push(f);
    }
    const n = await books.countDocuments({ ...LIVE_ZH, author_id: id });
    console.log(`${String(n).padStart(4)} ${id.padEnd(40)} ${d.canonical_name} [${d.wikidata_id ?? ''}] name=${name} +variants=${safe.join(',') || '-'}`);
    const update = { $set: { 'localized.zh.name': name } };
    if (safe.length) update.$addToSet = { variants: { $each: safe } };
    await writeDoc(id, 'set-han-name', update, 'Han name form, hand-read (#8035)');
    named++; added += safe.length;
  }
  // The rest of the docs Chinese volumes reach: a Latin heading, exactly one bare Han variant. Printed; a rule, read before applied.
  const ids = await books.distinct('author_id', { ...LIVE_ZH, author_id: { $type: 'string' } });
  const listed = new Set(NAMES.map(([id]) => id));
  let ruled = 0;
  for (const d of await authors.find({ _id: { $in: ids.filter((i) => !listed.has(i)) }, merged_into: { $exists: false }, is_person: { $ne: false } }).toArray()) {
    if (HAN.test(d.canonical_name || '') || d.localized?.zh?.name) continue;
    const bare = (d.variants || []).filter((v) => HAN.test(v) && !/[A-Za-z0-9;；、,，()（）]/.test(v));
    console.log(`  rule ${d._id.padEnd(36)} ${d.canonical_name} -> ${bare.join(' / ') || 'NONE, stays Latin'}`);
    if (bare.length !== 1) continue;
    await writeDoc(d._id, 'set-han-name', { $set: { 'localized.zh.name': bare[0] } }, 'the doc\'s one bare Han variant');
    ruled++;
  }
  console.log({ named, added, refused, ruled, apply: APPLY });
}

async function links() {
  let fixed = 0, linked = 0, unlinked = 0, left = 0;
  for (const f of BYLINE) {
    const doc = MINT_ID.get(f.doc) || f.doc;
    for (const b of await books.find({ ...LIVE_ZH, author: f.author, title: f.title }, { projection: { id: 1, author: 1, author_id: 1, title: 1 } }).toArray()) {
      console.log(`byline ${f.author} -> ${f.to}, ${doc}: ${String(b.title).slice(0, 26)}`);
      if (!APPLY) continue;
      await recordSweepAction(db, { sweep: SWEEP, book_id: String(b.id ?? b._id), action: 'correct-byline', detail: { before: f.author, after: f.to, why: f.evidence }, script: SCRIPT });
      fixed += (await setCatalogueFields(db, String(b.id ?? b._id), { author: f.to }, { source: 'title_read_by_hand', script: SCRIPT, issue: 8035, evidence: f.evidence })).modified;
      linked += await moveBook(b, doc, 'hand-read-byline-correction', f.to);
    }
  }
  const table = new Map();
  for (const [han, rom, o] of MINT) table.set(o.author || han, mintId(han, rom));
  for (const [s, han] of Object.entries(LINK_COMPOUND)) table.set(s, MINT_ID.get(han));
  for (const [s, id] of Object.entries(LINK_EXISTING)) table.set(s, id);
  for (const [author, id] of table) {
    const target = await authors.findOne({ _id: id }, { projection: { canonical_name: 1, merged_into: 1 } });
    const rows = await books.find({ ...LIVE_ZH, author, author_id: { $exists: false } }, { projection: { id: 1, author: 1, author_id: 1, title: 1 } }).toArray();
    if (!rows.length) continue;
    if (!target || target.merged_into) { console.log(`NO TARGET ${id} for [${author}] (${rows.length})`); left += rows.length; continue; }
    console.log(`${String(rows.length).padStart(3)} [${author.slice(0, 44)}] -> ${id} (${target.canonical_name}): ${String(rows[0].title).slice(0, 20)}`);
    for (const b of rows) linked += await moveBook(b, id, 'hand-read-han-name', author);
  }
  for (const [author, key] of Object.entries(LINK_OFF_HOLDER)) {
    const id = MINT_ID.get(key) || key;
    const rows = await books.find({ ...LIVE_ZH, author, author_id: HOLDER }, { projection: { id: 1, author: 1, author_id: 1, title: 1 } }).toArray();
    if (rows.length) console.log(`${String(rows.length).padStart(3)} off holder [${author.slice(0, 44)}] -> ${id}`);
    for (const b of rows) linked += await moveBook(b, id, 'hand-read-off-holding-library', author);
  }
  for (const { author, from, to } of OFF_WRONG_DOC) {
    const id = to && (MINT_ID.get(to) || to);
    const rows = await books.find({ author, author_id: from }, { projection: { id: 1, author: 1, author_id: 1, title: 1 } }).toArray();
    console.log(`${String(rows.length).padStart(3)} off ${from} [${author}] -> ${id ?? 'no link'}`);
    for (const b of rows) {
      if (id) { linked += await moveBook(b, id, 'hand-read-off-wrong-doc', author); continue; }
      if (!APPLY) continue;
      await recordSweepAction(db, { sweep: SWEEP, book_id: String(b.id ?? b._id), action: 'unset-author-id', detail: { author: b.author, before: b.author_id, after: null, method: 'placeholder-byline' }, script: SCRIPT });
      unlinked += (await books.updateOne({ _id: b._id, author_id: from }, { $unset: { author_id: '' } })).modifiedCount;
    }
  }
  console.log({ fixed, linked, unlinked, left, apply: APPLY });
}

/** Step 3. One rule: an id with no doc of its own (or a tombstone) moves to the single live doc that answers to it. */
async function ids() {
  const all = (await books.distinct('author_id')).filter((x) => typeof x === 'string' && x);
  const named = new Map();
  for (let i = 0; i < all.length; i += 2000) {
    for (const d of await authors.find({ _id: { $in: all.slice(i, i + 2000) } }, { projection: { merged_into: 1 } }).toArray()) named.set(d._id, d);
  }
  const stale = all.filter((x) => !named.has(x) || named.get(x).merged_into);
  let moved = 0, books_seen = 0;
  const unresolved = [];
  for (const id of stale) {
    let hits = named.has(id) ? [named.get(id)] : await authors.find({ $or: [{ slug: id }, { variant_slugs: id }] }, { projection: { merged_into: 1, canonical_name: 1 } }).toArray();
    const resolved = new Map();
    for (let d of hits) {
      for (let hop = 0; d?.merged_into && hop < 5; hop++) d = await authors.findOne({ _id: d.merged_into }, { projection: { merged_into: 1, canonical_name: 1 } });
      if (d) resolved.set(d._id, d);
    }
    const rows = await books.find({ author_id: id }, { projection: { id: 1, author: 1, author_id: 1 } }).toArray();
    books_seen += rows.length;
    const strings = [...new Set(rows.map((b) => b.author))].slice(0, 3).join(' | ').slice(0, 70);
    if (resolved.size !== 1) { unresolved.push(id); console.log(`${String(rows.length).padStart(4)} ${id} -> ${resolved.size} docs, LEFT [${strings}]`); continue; }
    const t = [...resolved.values()][0];
    console.log(`${String(rows.length).padStart(4)} ${id.padEnd(42)} -> ${t._id.padEnd(36)} ${String(t.canonical_name).slice(0, 26).padEnd(28)} [${strings}]`);
    for (const b of rows) moved += await moveBook(b, t._id, 'author-id-to-canonical-doc', id);
  }
  console.log({ stale_ids: stale.length, books_seen, moved, unresolved, apply: APPLY });
}

async function measure() {
  const rows = await books.find(LIVE_ZH, { projection: { author: 1, author_id: 1, 'localized.zh.author': 1 } }).toArray();
  const docs = new Map((await authors.find({ _id: { $in: [...new Set(rows.map((b) => b.author_id).filter(Boolean))] } }, { projection: { canonical_name: 1, variants: 1, is_person: 1, 'localized.zh.name': 1 } }).toArray()).map((d) => [d._id, d]));
  const shown = (b) => b.localized?.zh?.author || b.author || '';
  const hanDoc = (d) => HAN.test(d?.canonical_name || '') || (d?.variants || []).some((v) => HAN.test(v)) || Boolean(d?.localized?.zh?.name);
  const out = {
    live: rows.length,
    linked: rows.filter((b) => b.author_id).length,
    linked_to_a_doc: rows.filter((b) => docs.has(b.author_id)).length,
    unlinked_han_byline: rows.filter((b) => !b.author_id && HAN.test(b.author || '')).length,
    unlinked_total: rows.filter((b) => !b.author_id).length,
    han_byline_shown: rows.filter((b) => HAN.test(shown(b))).length,
    linked_to_doc_without_han: rows.filter((b) => docs.has(b.author_id) && !hanDoc(docs.get(b.author_id))).length,
    on_non_person_doc: rows.filter((b) => docs.get(b.author_id)?.is_person === false).length,
  };
  console.log(out);
  const left = new Map();
  for (const b of rows) if (!b.author_id) left.set(b.author || '(none)', (left.get(b.author || '(none)') || 0) + 1);
  console.log('still unlinked:', [...left].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s.slice(0, 50)}`).join(' || '));
  const none = new Map();
  for (const b of rows) if (!HAN.test(shown(b))) none.set(shown(b) || '(none)', (none.get(shown(b) || '(none)') || 0) + 1);
  console.log('no Han shown:', [...none].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s.slice(0, 50)}`).join(' || '));
}

const phases = { anchors, names, links, ids, measure };
if (!phases[PHASE]) { console.error(`--phase=${Object.keys(phases).join('|')}, or --emit-verdicts=<path>`); process.exit(1); }
await phases[PHASE]();
await client.close();
