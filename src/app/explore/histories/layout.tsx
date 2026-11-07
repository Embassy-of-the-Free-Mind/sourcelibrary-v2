// The histories read as articles: the article link style (body colour, gold
// underline, no red text) comes from .article-page in globals.css.
export default function HistoriesLayout({ children }: { children: React.ReactNode }) {
  return <div className="article-page">{children}</div>;
}
