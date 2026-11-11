// sharp and archiver are native/CommonJS: load them through the banner's require (rooted at the repo's
// package.json), since the bundle runs from a temp dir an ESM import could not resolve them from.
export const sharp = globalThis.__repoRequire('sharp');
export const archiver = globalThis.__repoRequire('archiver');
