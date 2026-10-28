/**
 * The prior-translation search notice (#7598): one fresh, dated web search per
 * book, stated plainly. Either it found an earlier English translation, and we
 * link to it, or it found none, and we say when and how we looked.
 *
 * This surface takes precedence over the Translation Card and the graded
 * evidence panel wherever the book has a fresh search on record: the newest
 * search is the answer a reader gets.
 */
import type { Book } from '@/lib/types/book';
import { hasPublishablePriorTranslation, priorLinkLabel, priorTranslationSentence } from '@/lib/prior-translation';

/** The newest fresh-search attempt for a book, as loaded by the book page. */
export interface FreshSearch {
  date: string;
  result: 'found' | 'not_found' | 'inconclusive' | string;
  queries?: string[];
}

export const FRESH_SEARCH_METHOD = 'claude_subagent_verify';

const ENGLISH = new Set(['english', 'en', 'eng']);

type NoticeBook = Pick<Book, 'prior_translation' | 'pages_translated' | 'language'>;

export type NoticeKind = 'prior' | 'none_found';

/** Which notice this book gets, or null to fall back to the older surfaces. */
export function translationSearchNoticeKind(book: NoticeBook, search: FreshSearch | null): NoticeKind | null {
  if (!search) return null;
  if (hasPublishablePriorTranslation(book)) return 'prior';
  if (
    search.result === 'not_found'
    && (book.pages_translated ?? 0) > 0
    && !ENGLISH.has(String(book.language ?? '').toLowerCase())
  ) return 'none_found';
  return null;
}

function fmtDate(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Searches({ search }: { search: FreshSearch }) {
  const queries = (search.queries ?? []).filter(Boolean);
  if (queries.length === 0) return null;
  return (
    <details className="text-stone-600 text-[10px]">
      <summary className="cursor-pointer hover:text-stone-500 list-none [&::-webkit-details-marker]:hidden">
        show {queries.length} search{queries.length === 1 ? '' : 'es'}
      </summary>
      <ul className="mt-1 pl-3 space-y-0.5">
        {queries.slice(0, 12).map((q, i) => (
          <li key={i} className="text-stone-500">“{q}”</li>
        ))}
      </ul>
    </details>
  );
}

export default function TranslationSearchNotice({
  book,
  search,
  showExternalLinks,
}: {
  book: NoticeBook;
  search: FreshSearch;
  showExternalLinks: boolean;
}) {
  const kind = translationSearchNoticeKind(book, search);
  if (!kind) return null;
  const date = fmtDate(search.date);

  if (kind === 'prior' && hasPublishablePriorTranslation(book)) {
    const prior = book.prior_translation;
    return (
      <div className="mt-3">
        <details className="group">
          <summary className="inline-flex px-2.5 py-1 bg-stone-700/40 text-stone-300 hover:bg-stone-700/60 text-xs font-medium rounded-full border border-stone-600/50 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            Earlier English translation
          </summary>
          <div className="mt-2 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-xs space-y-2">
            <p className="text-stone-300">
              {priorTranslationSentence(prior)}
              {showExternalLinks && (
                <>
                  {' '}
                  <a href={prior.url} target="_blank" rel="noopener noreferrer" className="text-accent-gold hover:text-accent-gold/80 whitespace-nowrap">
                    {priorLinkLabel(prior)} &rarr;
                  </a>
                </>
              )}
            </p>
            {date && <p className="text-stone-600 text-[10px]">Found by a web search on {date}.</p>}
            <Searches search={search} />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <details className="group">
        <summary className="inline-flex items-center gap-2 px-2.5 py-1 bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 text-xs font-medium rounded-full border border-accent-gold/30 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          First English translation
        </summary>
        <div className="mt-2 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-xs space-y-2">
          <p className="text-stone-300">
            {date ? `On ${date} we searched` : 'We searched'} library catalogues, publishers and the open web for an
            earlier published English translation and found none. If you know of one, please tell us.
          </p>
          <Searches search={search} />
        </div>
      </details>
    </div>
  );
}
