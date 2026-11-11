export default function Link({ href, children }) { return <a href={href.startsWith('/') ? 'https://sourcelibrary.org' + href : href}>{children}</a>; }
