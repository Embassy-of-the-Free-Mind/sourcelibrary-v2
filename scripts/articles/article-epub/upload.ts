// Puts the built EPUB in R2 at article-epubs/<slug>.epub and prints its public URL.
// Usage: node upload.mjs <slug> <file.epub>
import fs from 'fs';
import { storagePut } from '@/lib/storage';

const [slug, file] = process.argv.slice(2);
const { url } = await storagePut(`article-epubs/${slug}.epub`, fs.readFileSync(file), {
  contentType: 'application/epub+zip', access: 'public', allowOverwrite: true,
});
console.log(url);
