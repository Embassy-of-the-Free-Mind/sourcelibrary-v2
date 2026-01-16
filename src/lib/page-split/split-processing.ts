/**
 * Shared utilities for split detection and image cropping
 * Used by upload route, split routes, and job processing
 */

import sharp from 'sharp';
import { put } from '@vercel/blob';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

import { compress_photo } from '../image-manipulation';
import { detectSplitFromBuffer, type SplitDetectionResult } from './splitDetection';
import { extractFeatures, predictWithModel, detectSplitWithGemini, type SplitModel } from './splitDetectionML';
import type { Page } from '../types/page';

/**
 * Configurable split detection using environment variable
 *
 * Environment variable: SPLIT_DETECTION_METHOD
 * Values: heuristic | ml | gemini | cascade
 * Default: heuristic
 */
export async function detectSplit(
  buffer: Buffer,
  imageUrl?: string,
  db?: Db
): Promise<SplitDetectionResult> {
  const method = process.env.SPLIT_DETECTION_METHOD_ON_UPLOAD || 'gemini';

  switch (method) {
    case 'heuristic':
      // Local heuristics only (fast, free, always works)
      return await detectSplitFromBuffer(buffer);

    case 'ml':
      // ML model only (requires trained model)
      if (!db) throw new Error('Database required for ML detection');
      const model = await db.collection('split_models')
        .findOne<SplitModel>({ isActive: true }, { sort: { version: -1 } });
      if (!model) {
        throw new Error('No trained ML model available. Train a model first or use SPLIT_DETECTION_METHOD=heuristic');
      }
      const features = await extractFeatures(buffer, 500);
      const mlPosition = predictWithModel(features, model);
      return {
        isTwoPageSpread: true,
        confidence: 'high',
        splitPosition: mlPosition,
        splitPositionPercent: mlPosition / 10,
        hasTextAtSplit: false,
        metrics: {
          aspectRatio: features.aspectRatio,
          gutterScore: 0,
          maxDarkRunAtSplit: 0,
          transitionsAtSplit: 0,
          windowAvgDarkRun: 0,
          windowAvgTransitions: 0
        }
      };

    case 'gemini':      
      // Gemini Vision only (most accurate, requires API key and image URL)
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY required for Gemini detection');
      }
      if (!imageUrl) {
        throw new Error('Image URL required for Gemini detection (upload image first)');
      }
      const geminiResult = await detectSplitWithGemini(imageUrl);
      return {
        isTwoPageSpread: geminiResult.isTwoPageSpread,
        confidence: geminiResult.confidence,
        splitPosition: geminiResult.splitPosition,
        splitPositionPercent: geminiResult.splitPosition / 10,
        hasTextAtSplit: false,
        textWarning: geminiResult.reasoning,
        metrics: {
          aspectRatio: 0,
          gutterScore: 0,
          maxDarkRunAtSplit: 0,
          transitionsAtSplit: 0,
          windowAvgDarkRun: 0,
          windowAvgTransitions: 0
        }
      };

    case 'cascade':
    default:
      // Try methods in order: heuristic → ML (if available) → gemini (if low confidence)
      try {
        const heuristicResult = await detectSplitFromBuffer(buffer);
        if (heuristicResult.confidence === 'high') {
          console.log('Using heuristic detection (high confidence)');
          return heuristicResult;
        }

        // Try ML if available
        if (db) {
          const mlModel = await db.collection('split_models')
            .findOne<SplitModel>({ isActive: true }, { sort: { version: -1 } });
          if (mlModel) {
            const mlFeatures = await extractFeatures(buffer, 500);
            const mlPos = predictWithModel(mlFeatures, mlModel);
            console.log('Using ML detection (model available)');
            return {
              isTwoPageSpread: true,
              confidence: 'high',
              splitPosition: mlPos,
              splitPositionPercent: mlPos / 10,
              hasTextAtSplit: false,
              metrics: heuristicResult.metrics
            };
          }
        }

        // If heuristic confidence is low and imageUrl + API key available, try Gemini
        if (imageUrl && process.env.GEMINI_API_KEY && heuristicResult.confidence === 'low') {
          const gemRes = await detectSplitWithGemini(imageUrl);
          console.log('Using Gemini detection (low confidence heuristic)');
          return {
            isTwoPageSpread: true,
            confidence: gemRes.confidence,
            splitPosition: gemRes.splitPosition,
            splitPositionPercent: gemRes.splitPosition / 10,
            hasTextAtSplit: false,
            textWarning: gemRes.reasoning,
            metrics: heuristicResult.metrics
          };
        }

        // Fall back to heuristic result
        console.log('Using heuristic detection (fallback)');
        return heuristicResult;
      } catch (cascadeError) {
        console.error('Cascade detection failed, falling back to heuristics:', cascadeError);
        return await detectSplitFromBuffer(buffer);
      }
  }
}

/**
 * Crop and upload a single half of a spread image
 * Shared by upload route and job processing
 */
export async function cropAndUploadHalf(
  buffer: Buffer,
  crop: { xStart: number; xEnd: number },
  bookId: string,
  pageId: string
): Promise<{ url: string; buffer: Buffer }> {
  // Get dimensions
  const metadata = await sharp(buffer).metadata();
  const imgWidth = metadata.width || 1000;
  const imgHeight = metadata.height || 1000;

  // Convert crop (0-1000 scale) to pixel coordinates
  const left = Math.round((crop.xStart / 1000) * imgWidth);
  const cropWidth = Math.round(((crop.xEnd - crop.xStart) / 1000) * imgWidth);

  // Crop, resize, and compress
  const croppedBuffer = await sharp(buffer)
    .extract({
      left,
      top: 0,
      width: Math.min(cropWidth, imgWidth - left),
      height: imgHeight
    })
    .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();

  // Upload to Vercel Blob
  const blob = await put(
    `cropped/${bookId}/${pageId}.jpg`,
    croppedBuffer,
    {
      access: 'public',
      contentType: 'image/jpeg',
      allowOverwrite: true
    }
  );

  return { url: blob.url, buffer: croppedBuffer };
}

/**
 * Generate and upload thumbnail from cropped buffer
 */
export async function generateAndUploadThumbnail(
  croppedBuffer: Buffer,
  bookId: string,
  pageId: string
): Promise<{ url: string }> {
  const thumbnailBuffer = await compress_photo(croppedBuffer, 150, 60);
  const thumbnailBlob = await put(
    `uploads/${bookId}/thumbnails/${pageId}.jpg`,
    thumbnailBuffer,
    {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false
    }
  );

  return { url: thumbnailBlob.url };
}

/**
 * Process a single (non-split) image for upload
 * Accepts already-uploaded original and thumbnail URLs
 */
export async function processSingleImage(
  bookId: string,
  pageNumber: number,
  originalImageUrl: string,
  thumbnailUrl: string
): Promise<Page> {
  // Create page record
  const pageId = new ObjectId().toHexString();
  const page: Page = {
    id: pageId,
    tenant_id: 'default',
    book_id: bookId,
    page_number: pageNumber,
    photo: originalImageUrl,
    photo_original: originalImageUrl,
    thumbnail: thumbnailUrl,
    created_at: new Date(),
    updated_at: new Date()
  };

  return page;
}

/**
 * Process a two-page spread image (split into left and right)
 * Accepts already-uploaded original URL, crops both halves, generates thumbnails
 */
export async function processSplitImage(
  buffer: Buffer,
  bookId: string,
  startPageNumber: number,
  originalImageUrl: string,
  splitResult: SplitDetectionResult
): Promise<[Page, Page]> {

  // Calculate crop coordinates
  const leftCrop = { xStart: 0, xEnd: splitResult.splitPosition };
  const rightCrop = { xStart: splitResult.splitPosition, xEnd: 1000 };

  // Generate page IDs
  const leftPageId = new ObjectId().toHexString();
  const rightPageId = new ObjectId().toHexString();

  // Crop and upload both halves in parallel
  const [leftResult, rightResult] = await Promise.all([
    cropAndUploadHalf(buffer, leftCrop, bookId, leftPageId),
    cropAndUploadHalf(buffer, rightCrop, bookId, rightPageId)
  ]);

  // Generate thumbnails in parallel
  const [leftThumbnail, rightThumbnail] = await Promise.all([
    generateAndUploadThumbnail(leftResult.buffer, bookId, leftPageId),
    generateAndUploadThumbnail(rightResult.buffer, bookId, rightPageId)
  ]);

  // Create left page
  const leftPage: Page = {
    id: leftPageId,
    tenant_id: 'default',
    book_id: bookId,
    page_number: startPageNumber,
    photo: leftResult.url,
    photo_original: originalImageUrl,
    cropped_photo: leftResult.url,
    thumbnail: leftThumbnail.url,
    crop: leftCrop,
    ocr: undefined,
    translation: undefined,
    summary: undefined,
    split_detection: {
      isTwoPageSpread: true,
      confidence: splitResult.confidence,
      splitPosition: splitResult.splitPosition,
      splitPositionPercent: splitResult.splitPositionPercent,
      hasTextAtSplit: splitResult.hasTextAtSplit,
      textWarning: splitResult.textWarning,
      metrics: splitResult.metrics,
      detected_at: new Date()
    },
    created_at: new Date(),
    updated_at: new Date()
  };

  // Create right page
  const rightPage: Page = {
    id: rightPageId,
    tenant_id: 'default',
    book_id: bookId,
    page_number: startPageNumber + 1,
    photo: rightResult.url,
    photo_original: originalImageUrl,
    cropped_photo: rightResult.url,
    thumbnail: rightThumbnail.url,
    crop: rightCrop,
    split_from: leftPageId,
    ocr: undefined,
    translation: undefined,
    summary: undefined,
    split_detection: leftPage.split_detection,
    created_at: new Date(),
    updated_at: new Date()
  };

  return [leftPage, rightPage];
}
