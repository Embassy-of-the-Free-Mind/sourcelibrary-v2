import sharp from 'sharp';

/**
 * Compresses a photo buffer to the specified width and quality.
 * @param imageBuffer Source image buffer
 * @param width Width to resize to.
 * @param quality Compressed image quality (1-100)
 * @returns Compressed image buffer.
 */
export async function compress_photo(imageBuffer: Buffer, width: number, quality: number): Promise<Buffer> {
  if(!imageBuffer || imageBuffer.length === 0) {
    throw new Error('Invalid image buffer');
  }
     
  const compressedBuffer = await sharp(imageBuffer)
    .resize(width, null, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality, progressive: true })
      .toBuffer();    

  return compressedBuffer;
}