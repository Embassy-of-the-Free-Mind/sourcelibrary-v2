#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/seed-zh-collection-copy.mjs (the same hand-written, sweep-logged shape, for collection
 * names), localize-metadata.mjs (machine-written titles and summaries; it does not touch authors), and
 * `authors.aliases[]`, which is why this is by hand: the thesaurus offers 王朴 for 王概, 白允箕 for 白雲霽 and 錢時 for 吳謙,
 * and joins Xiao Ji to Li Xiaojiang. A Han alias there is a candidate, not a name to show.
 *
 * seed-zh-author-names — the byline a reader of /zh sees on a Chinese book whose `books.author` is romanised or mixed.
 * (#8035). `books.author` is the catalogue's record and is not changed; the name goes in `localized.zh.author`.
 *
 * Measured 2026-11-04: of 12,972 live Chinese books, 12,388 have a purely Han author, 357 mixed, 217 Latin only, 10 none.
 * Every key below was read by hand against the book's title. A name not here stays as stored: names I could not vouch
 * for (Shao Pingxuan, Qiu Weiling, Wang Xi, Plenck) are left out, not guessed.
 *
 *   node --env-file=.env.production.local scripts/maintenance/seed-zh-author-names.mjs           dry run
 *   ... --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'seed-zh-author-names-8035';
const APPLY = process.argv.includes('--apply');

export const ZH_AUTHOR = {
  // Latin only
  'Cheng Dawei': '程大位',
  'James Legge': '理雅各',
  'Jia Sixie': '賈思勰',
  'Shen Kuo': '沈括',
  'Li Shizhen': '李時珍',
  'Yang Jizhou': '楊繼洲',
  'Hunter, Stephen Alexander, 1815-': '洪士提反',
  'Stephen Alexander Hunter, 1815-': '洪士提反',
  'Wang Gai': '王概',
  'Chen Tuan': '陳摶',
  'Zang Maoxun': '臧懋循',
  'Kangxi Emperor; Tomás Pereira; Teodorico Pedrini': '康熙帝；徐日昇；德理格',
  'Teodorico Pedrini; Kangxi Emperor': '德理格；康熙帝',
  'Imperial Astronomical Bureau': '欽天監',
  'Qintian Jian (Imperial Observatory)': '欽天監',
  'Qing Imperial Astronomical Bureau': '欽天監',
  'Xiao Ji': '蕭吉',
  'Chen Shiduo': '陳士鐸',
  Mozi: '墨子',
  'attributed to Huangdi': '託名黃帝',
  'attributed to Hua Tuo': '託名華佗',
  'attributed to Yuan Tiangang': '託名袁天罡',
  'Zhu Zaiyu': '朱載堉',
  'Matteo Ricci and Xu Guangqi': '利瑪竇；徐光啟',
  'Matteo Ricci & Xu Guangqi': '利瑪竇；徐光啟',
  'Matteo Ricci & Li Zhizao': '利瑪竇；李之藻',
  'Matteo Ricci; Li Zhizao': '利瑪竇；李之藻',
  'Sabbathino de Ursis (Xiong Sanba)': '熊三拔',
  'Bai Yunji': '白雲霽',
  'Song Yingxing': '宋應星',
  Laozi: '老子',
  'Wu Qian (ed.)': '吳謙 編',
  'Xu Guangqi': '徐光啟',
  'Wu Renchen': '吳任臣',
  'Hobson, Benjamin, 1816-1873': '合信',
  'Sun Simiao': '孫思邈',
  'Emperor Taizong of Tang': '唐太宗',
  'Xuanzang (trans.)': '玄奘 譯',
  'Shi Daoshi (Tang Dynasty)': '釋道世',
  'Wang Weiyi': '王惟一',
  'Yang Weide': '楊惟德',
  'Kumarajiva (tr.)': '鳩摩羅什 譯',
  'Kim Bu-sik': '金富軾',
  'Zhu Su': '朱橚',
  'Queen Sohye (commissioner)': '昭惠王后',
  'Johann Terrenz Schreck and Wang Zheng': '鄧玉函；王徵',
  Zhuangzi: '莊子',
  'Zhang Nan': '張楠',
  'Luo Guanzhong': '羅貫中',
  'Luo Guanzhong (Korean edition)': '羅貫中',
  'Zhang Li': '張理',
  'Guo Pu': '郭璞',
  'Confucius; Jesuit Missionaries': '孔子；耶穌會士',
  'Ferdinand Verbiest': '南懷仁',
  'Cao Xueqin': '曹雪芹',
  'Ge Hong': '葛洪',
  'Gan Bao': '干寶',
  'Wang Yangming': '王陽明',
  'Li Huang (Qing Dynasty)': '李潢',
  'Confucius (ed. James Legge)': '孔子；理雅各 編',
  'Mencius (ed. James Legge)': '孟子；理雅各 編',
  Faxian: '法顯',
  'Chen Yuanlong': '陳元龍',
  'Séraphin Couvreur': '顧賽芬',
  'Zhao Rugua': '趙汝适',
  'Kaibara Ekiken': '貝原益軒',
  'Anonymous (Qing Court)': '清宮佚名',
  'Anonymous (Qing Court painters)': '清宮畫師',
  'Unknown (Han Dynasty, c. 200 BCE)': '佚名',
  'Unknown (Zhou Dynasty, c. 1000 BCE)': '佚名',
  'Unknown (Ming Dynasty)': '佚名',
  'Unknown (Qing Dynasty)': '佚名',
  // Mixed: the Han name is already in the record
  'Zhang, Jiebin, 1563-1640; 張介賓, 1563-1640': '張介賓',
  '（宋）邵雍 (Shao Yong)': '（宋）邵雍',
  '吳敬梓 Wu Jingzi': '吳敬梓',
  'Pu Songling (蒲松齡)': '蒲松齡',
  'Li Yu (李漁)': '李漁',
  '道原 (Daoyuan)': '道原',
  'Li Jie (李誡)': '李誡',
  'Hunter, Stephen Alexander, 1815- ; Li, Hongzhang, 1823-1901; 李鴻章, 1823-1901': '洪士提反；李鴻章',
  'Zang Maoxun (臧懋循), compiler': '臧懋循 編',
  'Chen Ziming 陳自明': '陳自明',
  '葛洪 Ge Hong (284–363)': '葛洪',
  'Wu, Kun, 1552-1620; 吳崑, 1552-1620': '吳崑',
  '傅仁宇, active 1644.; Renyu Fu active 1644.; 林長生; 張秀; 周靖公; 張文凱; 傳維藩; Changsheng Lin; Xiu Zhang; Jinggong Zhou; Wenkai Zhang; Weifan Fu': '傅仁宇；林長生；張秀；周靖公；張文凱；傳維藩',
  '陶弘景 Tao Hongjing (456–536)': '陶弘景',
  '雪竇重顯 (Xuedou Chongxian), verses; 圜悟克勤 (Yuanwu Keqin), commentary': '雪竇重顯 頌；圜悟克勤 評唱',
  '楚石梵琦 (Chushi Fanqi)': '楚石梵琦',
  '周守忠 Zhou Shouzhong': '周守忠',
  '王珪 Wang Gui (Yuan)': '（元）王珪',
  "Wu Cheng'en (吳承恩); Li Zhuowu (李卓吾), ed.": '吳承恩；李卓吾 評',
  '莊周 (Zhuangzi)': '莊周',
  'Li Shizhen (李時珍)': '李時珍',
  '虛堂智愚 (Xutang Zhiyu); 妙源 (Miaoyuan), comp.': '虛堂智愚；妙源 編',
  '天如惟則 (Tianru Weize)': '天如惟則',
  'Ge Hong 葛洪': '葛洪',
  '師明 (Shiming), comp.': '師明 編',
  '無準師範 (Wuzhun Shifan)': '無準師範',
  "Shi Nai'an (施耐庵); Li Zhuowu (李卓吾), ed.": '施耐庵；李卓吾 評',
  '大慧宗杲 (Dahui Zonggao); 蘊聞 (Yunwen), comp.': '大慧宗杲；蘊聞 編',
  'Zhu, Zhenheng, 1281-1358; 朱震亨, 1281-1358': '朱震亨',
  'Dong Sizhang (董斯張, 1587-1628)': '董斯張',
  '雲門文偃 (Yunmen Wenyan); 守堅 (Shoujian), comp.': '雲門文偃；守堅 編',
  'Ling Mengchu (凌濛初)': '凌濛初',
  '圜悟克勤 (Yuanwu Keqin); 紹隆 (Shaolong) et al., comp.': '圜悟克勤；紹隆等 編',
  '魏伯陽 Wei Boyang (attrib.); comm. 蔣一彪 Jiang Yibiao': '託名魏伯陽；蔣一彪 注',
  'Cao Xueqin (曹雪芹)': '曹雪芹',
  'Xuanzang yi (玄奘譯)': '玄奘 譯',
  'Han Fei (韓非)': '韓非',
  "密菴咸傑 (Mi'an Xianjie); 崇岳 (Chongyue), 了悟 (Liaowu) et al., comp.": '密菴咸傑；崇岳、了悟等 編',
  '司馬遷 (Sima Qian)': '司馬遷',
  'Chen Yang (陳暘)': '陳暘',
  '丘處機 Qiu Chuji (1148–1227)': '丘處機',
  '魏伯陽 Wei Boyang; comm. 俞琰 Yu Yan': '魏伯陽；俞琰 注',
  '魏伯陽 Wei Boyang; comm. 陳致虛 Chen Zhixu': '魏伯陽；陳致虛 注',
  'Tang Xianzu (湯顯祖)': '湯顯祖',
  '列禦寇 (Liezi)': '列禦寇',
  '（宋）周惇頣 (Zhou Dunyi)': '（宋）周惇頤',
  '劉安 (Liu An) et al.': '劉安等',
  'Sichanantuo yi (實叉難陀譯)': '實叉難陀 譯',
  'Zheng Zhizhen (鄭之珍)': '鄭之珍',
  'Liang Chenyu (梁辰魚)': '梁辰魚',
  'Xue Jinyan (薛近兗)': '薛近兗',
  'Meng Chengshun (孟稱舜)': '孟稱舜',
  'Wang Jide (王驥德)': '王驥德',
  'Jiumoluoshi [Kumārajīva] yi (鳩摩羅什譯)': '鳩摩羅什 譯',
  'Jiumoluoshi yi (鳩摩羅什譯)': '鳩摩羅什 譯',
  '臨濟義玄 (Linji Yixuan); 慧然 (Huiran), comp.': '臨濟義玄；慧然 編',
  '笑隱大訢 (Xiaoyin Daxin); 延俊 (Yanjun) et al., comp.': '笑隱大訢；延俊等 編',
  '荀況 (Xunzi); 楊倞 注': '荀況；楊倞 注',
  'Zhang Hua (張華, 232-300 CE)': '張華',
  'Xuanzang (玄奘)': '玄奘',
  'Sun Simiao 孫思邈': '孫思邈',
  'Kim Busik (金富軾)': '金富軾',
  'Li Yimin (李逸民)': '李逸民',
  'Dong Jieyuan (董解元)': '董解元',
  "應菴曇華 (Ying'an Tanhua); 守詮 (Shouquan) et al., comp.": '應菴曇華；守詮等 編',
  'Yu Yan (俞琰)': '俞琰',
  "Toqto'a (脱脱) et al., comp.": '脫脫等 編',
  "破菴祖先 (Po'an Zuxian); 圓照 (Yuanzhao) et al., comp.": '破菴祖先；圓照等 編',
  'Baegun Gyeonghan (白雲景閑)': '白雲景閑',
  'Baocheng (寶成)': '寶成',
  'Zhu Xi (朱熹)': '朱熹',
  'Chen Shiduo (陳士鐸)': '陳士鐸',
  'Luo Hongxian (羅洪先)': '羅洪先',
  '張伯端 Zhang Boduan (987–1082) et al.; ed. 吳勉學 Wu Mianxue': '張伯端等；吳勉學 編',
  'Li Shi (李栻, compiler)': '李栻 編',
  'Qu Yuan (屈原)': '屈原',
  'Bai Yuchan (白玉蟾, 1194–?)': '白玉蟾',
  'Liu An (劉安)': '劉安',
  'Zhu Zaiyu (朱載堉)': '朱載堉',
  'Gao Ming (高明)': '高明',
  'Luo Guanzhong (羅貫中); Li Zhuowu (李卓吾), ed.': '羅貫中；李卓吾 評',
  'Bai Juyi (白居易)': '白居易',
  'Wang Shifu (王實甫); Wang Jide (王驥德), ed.': '王實甫；王驥德 校注',
  '尹真人 Yin Zhenren (attrib.)': '託名尹真人',
  'Mao Yuanyi (茅元儀)': '茅元儀',
  'Wang Zheng (王徵)': '王徵',
  'Chen Jiamo (陳嘉謨)': '陳嘉謨',
  'Francisco Furtado (傅汎際) & Li Zhizao (李之藻)': '傅汎際；李之藻',
  'Johann Adam Schall von Bell (湯若望); Xu Guangqi (徐光啟)': '湯若望；徐光啟',
  'Johann Schreck (鄧玉函); Wang Zheng (王徵)': '鄧玉函；王徵',
  'Mao Jin (毛晉), compiler': '毛晉 編',
  'Chen Ziming 陳自明 (Song 1237, transmitted via Ming 1547 → Japanese 1636)': '陳自明',
  'Shen Tai (沈泰), compiler': '沈泰 編',
  'Luo Guanzhong (羅貫中)': '羅貫中',
  'Xiao Yuncong (蕭雲從), illustrator': '蕭雲從 繪',
  '高峰原妙 (Gaofeng Yuanmiao)': '高峰原妙',
  'Guo Pu (郭璞) commentary': '郭璞 注',
  'Ferdinand Verbiest (南懷仁)': '南懷仁',
  'Zuihō (瑞方, 1683–1769)': '瑞方',
  '松源崇嶽 (Songyuan Chongyue); 善開 (Shankai) et al., comp.': '松源崇嶽；善開等 編',
  'Huineng (慧能); Fahai (法海), ed.': '慧能；法海 編',
  'Jiao Bingzhen (焦秉貞), paintings; Kangxi Emperor, poems': '焦秉貞 繪；康熙帝 詩',
  '姚球 (Yao Qiu)': '姚球',
  'Wang Shifu (王實甫)': '王實甫',
  'Seo Gyeongdeok (徐敬德)': '徐敬德',
  'Su Shi (蘇軾)': '蘇軾',
  '柳華陽 Liu Huayang (b. 1736)': '柳華陽',
  '錢塘 (Qian Tang)': '錢塘',
  '五祖法演 (Wuzu Fayan); 才良 (Cailiang) et al., comp.': '五祖法演；才良等 編',
  'Dai Zhen (戴震), ed.': '戴震 校',
  'Kubo Tenzui (久保天随, 1875–1934)': '久保天随',
  'Endō Ryūkichi (遠藤隆吉, 1874–1946), ed.': '遠藤隆吉 編',
  '大正一切經刊行會 (Taishō Issaikyō Kankōkai)': '大正一切經刊行會',
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const language = /^(chinese|classical chinese|literary chinese)/i;
  let matched = 0, written = 0, already = 0;
  for (const [author, name] of Object.entries(ZH_AUTHOR)) {
    // Some stored strings end in a space ("Hunter, Stephen Alexander, 1815- ").
    const rows = await books.find({ author: { $in: [author, `${author} `] }, language }, { projection: { id: 1, 'localized.zh.author': 1 } }).toArray();
    matched += rows.length;
    if (!rows.length) console.log(`no book carries: ${author}`);
    for (const b of rows) {
      if (b.localized?.zh?.author === name) { already++; continue; }
      if (!APPLY) continue;
      const bookId = String(b.id ?? b._id);
      await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'set-localized-zh-author', detail: { author, before: b.localized?.zh?.author ?? null, after: name }, script: 'scripts/maintenance/seed-zh-author-names.mjs' });
      const r = await books.updateOne({ _id: b._id }, { $set: { 'localized.zh.author': name } });
      written += r.modifiedCount;
    }
  }
  console.log({ names: Object.keys(ZH_AUTHOR).length, matched, already, written, apply: APPLY });
  await client.close();
}

if (process.argv[1]?.endsWith('seed-zh-author-names.mjs')) await main();
