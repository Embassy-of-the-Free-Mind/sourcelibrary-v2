import Page from '__PAGE__';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
fs.writeFileSync('article.html', renderToStaticMarkup(<Page />));
