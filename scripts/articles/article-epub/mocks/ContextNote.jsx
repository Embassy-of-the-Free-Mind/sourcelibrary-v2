// The article's skippable background note, as a set-apart panel in the book.
export default function ContextNote({ title, children }) {
  return <aside className="context"><p className="ctx-label">Context</p>{title && <p className="ctx-title">{title}</p>}{children}</aside>;
}
