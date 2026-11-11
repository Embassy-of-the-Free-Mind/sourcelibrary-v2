export default function SourceQuote({ book, page, printedPage, src, source, original, href, children }) {
  const h = href ?? `/book/${book}?page=${page}`;
  return <blockquote data-book={book} data-page={page} data-src={src}>
    {original && <p><i>{original}</i></p>}
    <div>{children}</div>
    <p className="cite">— {source}, <a href={'https://sourcelibrary.org' + h}>p. {printedPage ?? page}</a></p>
  </blockquote>;
}
