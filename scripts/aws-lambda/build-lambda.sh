#!/bin/bash
set -e

echo "🔨 Building Lambda functions..."

# Create dist directory
mkdir -p dist/lambda

# Build OCR processor
echo "📦 Building ocr-processor..."
npx esbuild src/workers/ocr-processor.ts \
  --bundle \
  --platform=node \
  --target=node24 \
  --external:@aws-sdk/* \
  --outfile=dist/lambda/ocr-processor.js

# Build Translation processor
echo "📦 Building translation-processor..."
npx esbuild src/workers/translation-processor.ts \
  --bundle \
  --platform=node \
  --target=node24 \
  --external:@aws-sdk/* \
  --outfile=dist/lambda/translation-processor.js

# Build Image Extraction processor
echo "📦 Building image-extraction-processor..."
npx esbuild src/workers/image-extraction-processor.ts \
  --bundle \
  --platform=node \
  --target=node24 \
  --external:@aws-sdk/* \
  --outfile=dist/lambda/image-extraction-processor.js

echo "✅ Lambda functions built successfully!"
echo ""
echo "Next steps:"
echo "1. Create deployment packages: npm run lambda:package"
echo "2. Upload to AWS Lambda console or use AWS CLI"
