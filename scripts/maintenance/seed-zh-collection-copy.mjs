#!/usr/bin/env node
/**
 * Chinese names and intros for the shelves /zh/collections surfaces (#8035). A collection appears
 * on that index once it has `localized.zh.name`, so this list IS the index.
 *
 * Written by hand, not machine-glossed: every work named was checked to be a member of its shelf
 * on 2026-11-04. Where the English intro names something the shelf does not hold (Dream Pool
 * Essays on chinese-technology), the Chinese leaves it out.
 *
 * PRIOR ART: scripts/maintenance/localize-metadata.mjs — the bulk writer of this map. It goes
 * through the paid API and translates whatever the English says, including those claims.
 * This never overwrites an existing `localized.zh.description` unless --force, so the two
 * hand-checked exhibits from #7537 are safe.
 *
 *   node --env-file=.env.production.local scripts/maintenance/seed-zh-collection-copy.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const SWEEP = 'seed-zh-collection-copy-8035';

const COPY = {
  'east-asia': ['东亚', '中国、日本与朝鲜半岛的文学、哲学与技术文献。'],
  'chinese-classics': ['中国经典', '中国的文学与思想遗产：儒家经典、道教经书、禅宗典籍、医书与兵书。'],
  'chinese-natural-knowledge': ['中国自然知识', '李时珍《本草纲目》、沈括《梦溪笔谈》与图文并茂的《三才图会》，可见中国学者与工匠如何考察天文、地理、农事与技艺。'],
  'chinese-technology': ['中国技术与科学', '宋明以来的图解技术文献，包括宋应星 1637 年的《天工开物》，记录制造、农事与军事技术。'],
  'chinese-natural-history': ['博物与本草', '植物、医药与博物类著作。'],
  'chinese-military-technology': ['军事技术', '兵器、城防与水战工程。'],
  'chinese-medicine-natural-philosophy': ['中医与自然哲学', '李时珍《本草纲目》、沈括《梦溪笔谈》与贾思勰《齐民要术》等医药、博物与农学著作。'],
  'chinese-history-statecraft': ['历史与治道', '史书、政书与兵学著作，其中以茅元仪《武备志》篇幅最大。'],
  'chinese-divination-cosmology': ['术数与宇宙论', '易学、堪舆、星占与术数著作，探讨天象与人事的对应。'],
  'chinese-astrology': ['天文与星占', '萧吉《五行大义》、易图与星命之书。'],
  'chinese-daoist-magic': ['道教与方术', '符箓、祭祀与占卜诸术，见于《道藏》、蒲松龄《聊斋志异》与高延（De Groot）关于鬼神与巫术的研究。'],
  'confucian-classics': ['儒家经典', '孔子、孟子、朱熹、王阳明一脉的经典与注疏，也收入耶稣会士的拉丁文译本《中国哲学家孔子》。'],
  'daoist-classics': ['道家经典', '《道德经》《庄子》及其注疏、内丹与易学图式。'],
  'chinese-buddhist-texts': ['汉传佛典', '汉译佛经（如《法华经》）、禅宗灯录、敦煌写本与佛传图本。'],
  'chinese-fiction': ['中国小说', '《西游记》《水浒传》《红楼梦》等长篇小说，《聊斋志异》等志怪，以及白话小说与文学选集。'],
  'zen-chan': ['禅宗', '中国禅宗及其在日本的传承，从语录、公案集到铃木大拙的著作。'],
  'daoist-alchemy': ['道教炼丹', '葛洪《抱朴子》、《参同契》及其注疏与白玉蟾文集，涉及内丹与外丹。'],
  'correct-meaning-of-the-pitch-pipes': ['律吕正义', '康熙朝律学著作《律吕正义》与乾隆朝《律吕正义后编》，可逐卷阅读。'],
  'hogwarts-library': ['霍格沃茨图书馆', '霍格沃茨世界背后真实的历史书籍：炼金术、动物寓言集、魔法书与本草，多附现代英语译文。'],
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const cols = db.collection('collections');
let wrote = 0, kept = 0;
for (const [slug, [name, description]] of Object.entries(COPY)) {
  const d = await cols.findOne({ slug }, { projection: { visible: 1, 'localized.zh': 1 } });
  if (!d) { console.log(`MISSING ${slug}`); continue; }
  if (d.visible === false) { console.log(`HIDDEN ${slug}: copy not written`); continue; }
  if (d.localized?.zh?.description && !FORCE) { kept++; console.log(`keep ${slug}`); continue; }
  console.log(`${APPLY ? 'write' : 'would write'} ${slug}: ${name}`);
  if (!APPLY) continue;
  await recordSweepAction(db, { sweep: SWEEP, book_id: `collection:${slug}`, action: 'set-localized-zh', detail: { before: d.localized?.zh ?? null, name, description }, script: 'seed-zh-collection-copy.mjs' });
  const r = await cols.updateOne({ slug }, { $set: { 'localized.zh.name': name, 'localized.zh.description': description } });
  wrote += r.modifiedCount;
}
console.log(`${APPLY ? 'wrote' : 'dry run'} ${wrote}, kept ${kept}, of ${Object.keys(COPY).length}`);
await client.close();
