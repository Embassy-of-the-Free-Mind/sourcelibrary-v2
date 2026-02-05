#!/bin/bash
set -e

echo "🔨 Building Lambda functions..."

# Create dist directory
mkdir -p dist/lambda

# Build book processor
echo "📦 Building book-processor..."
npx esbuild src/workers/book-processor.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --external:@aws-sdk/* \
  --outfile=dist/lambda/book-processor.js

# Build OCR processor
echo "📦 Building ocr-processor..."
npx esbuild src/workers/ocr-processor.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --external:@aws-sdk/* \
  --outfile=dist/lambda/ocr-processor.js

echo "✅ Lambda functions built successfully!"
echo ""
echo "Next steps:"
echo "1. Create deployment packages: npm run lambda:package"
echo "2. Upload to AWS Lambda console or use AWS CLI"
