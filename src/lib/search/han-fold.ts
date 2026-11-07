/**
 * PRIOR ART: `src/lib/search/original-snippet.ts` folds Latin u/v and i/j to LOCATE a
 * hit in a page, after the search has run. `src/lib/search/word-forms.ts` expands
 * Latin-script word forms. Neither touches Han, and the search lanes match exact
 * characters: a reader who typed 红楼梦 got plays and commentaries, not 紅樓夢 (#7537).
 *
 * The corpus prints traditional forms and mainland readers type Simplified, so a
 * Simplified query is converted to traditional once, before any lane sees it.
 *
 * Converter: OpenCC `cn` to `t`, chosen by round-tripping all 976 live Chinese title
 * cores that change under simplification (2026-11-04). `t` recovered 92.4% of them, `tw`
 * 92.2%, `hk` 85.8%. `twp` also recovered ~92% but rewrites vocabulary (圖像 to 影像), so
 * it is unusable on historical text. Most misses are variants of one character that
 * the books themselves disagree on (注/註); this does not fold those.
 */
import { Converter } from 'opencc-js';

const HAN = /[㐀-鿿]/;
// Kana means Japanese, whose kanji must not be rewritten as if they were Simplified.
const KANA = /[぀-ヿ]/;

const toTraditional = Converter({ from: 'cn', to: 't' });
const toSimplified = Converter({ from: 't', to: 'cn' });

/**
 * The query to send to the search lanes. Only a query written purely in Simplified
 * is converted. A query holding any traditional-only character is left as typed, so
 * a reader who typed 紅樓夢 or 皇后 gets exactly that, and shared characters such as
 * 后 and 云 are never rewritten on a traditional query.
 */
export function foldSimplifiedHan(query: string): string {
  if (!HAN.test(query) || KANA.test(query)) return query;
  if (toSimplified(query) !== query) return query;
  return toTraditional(query);
}
