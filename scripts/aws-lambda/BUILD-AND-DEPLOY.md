# Building and Deploying Lambda Functions

## Quick Start

1. In terminal run: `npm run lambda:all`
2. Three packages are built:
    - `dist/packages/ocr-processor.zip`
    - `dist/packages/translation-processor.zip`
    - `dist/packages/image-extraction-processor.zip`

## Manual Deployment (AWS Console)

1. AWS Console -> Lambda -> Functions
2. Select Lambda function (e.g., `sourcelibrary-ocr-processor`)
3. Code Tab -> Upload from -> .zip file
4. Select the zip file from `dist/packages/`
5. Repeat for other processors as needed

## Architecture

Each Lambda function processes **one page** per invocation:
- **OCR Processor**: Reads page image, performs OCR, saves to MongoDB
- **Translation Processor**: Translates OCR text with context from previous page
- **Image Extraction Processor**: Detects and extracts illustrations

All processors:
- Update job progress directly in MongoDB
- Check for job cancellation before processing
- Mark job complete when all pages are done