// Puts the built EPUB in R2 at article-epubs/<name>-<hash>.epub and prints its public URL. The content hash is
// in the key because the CDN in front of images.sourcelibrary.org keeps serving an old object at a reused key
// (a rebuilt hyperborea.epub still downloaded as the first, 5 MB build).
// Usage: node upload.mjs <name> <file.epub>
import fs from 'fs';
import crypto from 'crypto';
import { storagePut } from '@/lib/storage';

const [name, file] = process.argv.slice(2);
const body = fs.readFileSync(file);
const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 8);
const { url } = await storagePut(`article-epubs/${name}-${hash}.epub`, body, {
  contentType: 'application/epub+zip', access: 'public',
});
console.log(url);
