import sharp from 'sharp';
// @ts-ignore - codec-openjpeg types may not be fully available
import OpenJPEGJS from '@cornerstonejs/codec-openjpeg';

// Type definition for OpenJPEG J2KDecoder
// Based on actual decoder API (verified via Object.getOwnPropertyNames)
interface J2KDecoder {
  getEncodedBuffer(length: number): Uint8Array;
  getDecodedBuffer(): ArrayBuffer;
  decode(): void;
  getFrameInfo(): {
    width: number;
    height: number;
    componentCount: number;
  };
  delete(): void; // WASM cleanup method
  // Additional methods available but unused:
  // readHeader(), decodeSubResolution(), getNumDecompositions(), etc.
}

// Cache the OpenJPEG library instance to avoid re-initializing the WASM module
// This significantly improves performance when converting multiple JP2 files
// Reset periodically to prevent unbounded memory growth (safety net)
let openjpegjsInstance: any = null;
let conversionCount = 0;
const MAX_CONVERSIONS_BEFORE_RESET = 30;

async function getOpenJPEGJS() {
  // Reset WASM instance every N conversions to prevent memory leaks
  // Even with decoder.delete(), this provides an additional safety net
  if (!openjpegjsInstance || conversionCount >= MAX_CONVERSIONS_BEFORE_RESET) {
    openjpegjsInstance = await OpenJPEGJS();
    conversionCount = 0;
  }
  conversionCount++;
  return openjpegjsInstance;
}

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

/**
 * Convert any image format to JPEG buffer
 * Ensures Gemini API compatibility (doesn't support JP2)
 *
 * @param buffer - Image buffer in any format (JP2, PNG, WebP, etc.)
 * @param quality - JPEG quality (1-100, default 85)
 * @param isJp2 - Whether this is a JP2/JPEG2000 file (requires special decoding)
 * @returns JPEG buffer and MIME type
 *
 * @example
 * const { buffer: jpegBuffer, mimeType } = await convertToJpeg(jp2Buffer, 85, true);
 * await put('uploads/image.jpg', jpegBuffer, { contentType: mimeType });
 */
export async function convertToJpeg(
  buffer: Buffer,
  quality = 85,
  isJp2 = false
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Invalid image buffer');
  }

  // JP2 files need special decoding before Sharp can process them
  if (isJp2) {
    // Decoder instance (OpenJPEG WASM J2KDecoder)
    // Stored outside try block to ensure cleanup in finally
    let decoder: J2KDecoder | null = null;
    const startTime = Date.now();

    try {
      // Get cached OpenJPEG library instance (initializes only once)
      const openjpegjs = await getOpenJPEGJS();

      // Create decoder instance
      decoder = new openjpegjs.J2KDecoder() as J2KDecoder;

      // Convert Buffer to Uint8Array for the decoder
      const encodedData = new Uint8Array(buffer);

      // Get encoded buffer and copy our data into it
      const encodedBuffer = decoder.getEncodedBuffer(encodedData.length);
      encodedBuffer.set(encodedData);

      // Decode the JP2 image
      decoder.decode();

      // Get decoded pixel data and frame information
      const decodedBuffer = decoder.getDecodedBuffer();
      const frameInfo = decoder.getFrameInfo();

      // Create Sharp image from raw pixel data
      const jpegBuffer = await sharp(Buffer.from(decodedBuffer), {
        raw: {
          width: frameInfo.width,
          height: frameInfo.height,
          channels: frameInfo.componentCount as 1 | 2 | 3 | 4 // Usually 3 for RGB or 4 for RGBA
        }
      })
        .jpeg({ quality, progressive: true })
        .toBuffer();      

      return {
        buffer: jpegBuffer,
        mimeType: 'image/jpeg'
      };
    } catch (error) {
      throw new Error(`Failed to decode JP2 image: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      // CRITICAL: Free WASM memory to prevent memory leaks
      // Without this cleanup, decoder instances accumulate in memory
      // and cause "Input Buffer is empty" errors after ~70 conversions
      if (decoder && typeof decoder.delete === 'function') {
        decoder.delete();
      }
    }
  }

  // For other formats, Sharp can handle directly
  const jpegBuffer = await sharp(buffer)
    .jpeg({ quality, progressive: true })
    .toBuffer();

  return {
    buffer: jpegBuffer,
    mimeType: 'image/jpeg'
  };
}