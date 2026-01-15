export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface PageCoordinates {
  leftPage: BoundingBox;
  rightPage: BoundingBox;
}

export interface SplitResult {
  leftPageUrl: string;
  rightPageUrl: string;
}

export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}