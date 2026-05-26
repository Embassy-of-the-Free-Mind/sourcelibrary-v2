// Gallery image URLs are tenant-agnostic, so the root /gallery/image/[id]
// route mirrors the metadata + JSON-LD that the tenant version emits via
// src/app/[tenant]/gallery/image/[id]/layout.tsx. Re-exporting keeps the
// two surfaces in lockstep with zero duplication.

import ImageLayout, { generateMetadata as parentGenerateMetadata } from '../../../[tenant]/gallery/image/[id]/layout';

export { parentGenerateMetadata as generateMetadata };
export default ImageLayout;
