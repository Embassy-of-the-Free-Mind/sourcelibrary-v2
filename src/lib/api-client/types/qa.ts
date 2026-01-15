/**
 * QA API Types
 */

export interface SampleResult {
  pageId: string;
  bookId: string;
  bookTitle: string;
  pageNumber: number;
  ocrModel: string | null;
  translationModel: string | null;
  ocrPrompt: string | null;
  translationPrompt: string | null;
  hasOcr: boolean;
  hasTranslation: boolean;
  ocrLength: number;
  translationLength: number;
  ocrIssues: number;
  translationIssues: number;
  ocrPreview: string;
  translationPreview: string;
  photo: string;
}

export interface ModelStats {
  model: string;
  count: number;
  withIssues: number;
  issueRate: number;
  avgLength: number;
  totalIssues: number;
}

export interface QASampleResponse {
  population: {
    totalPages: number;
    translatedPages: number;
    sampleSize: number;
    samplingRate: number;
  };
  estimate: {
    issueRate: number;
    confidenceInterval: { lower: number; upper: number };
    confidenceLevel: number;
    estimatedPagesWithIssues: { lower: number; upper: number; point: number };
  };
  modelStats: {
    ocr: ModelStats[];
    translation: ModelStats[];
  };
  samples: SampleResult[];
}
