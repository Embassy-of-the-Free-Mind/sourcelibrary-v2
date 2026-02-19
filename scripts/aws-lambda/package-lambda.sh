#!/bin/bash
set -e

echo "📦 Packaging Lambda functions with dependencies..."

# Ensure dist directory exists
if [ ! -d "dist/lambda" ]; then
  echo "❌ Error: dist/lambda directory not found. Run 'npm run lambda:build' first."
  exit 1
fi

# Clean and create packages directory
echo "🧹 Cleaning old packages..."
rm -rf dist/packages
mkdir -p dist/packages

# Create temporary build directory
rm -rf dist/lambda-temp
mkdir -p dist/lambda-temp

echo "📦 Installing production dependencies..."
# Create package.json with only required dependencies
cat > dist/lambda-temp/package.json <<EOF
{
  "dependencies": {
    "mongodb": "^6.3.0"
  }
}
EOF

# Install dependencies (production only)
cd dist/lambda-temp
npm install --production --no-package-lock
cd ../..

# Package OCR processor
echo "📦 Packaging ocr-processor..."
cp dist/lambda/ocr-processor.js dist/lambda-temp/index.js
cd dist/lambda-temp
zip -q -r ../packages/ocr-processor.zip index.js node_modules
cd ../..

# Package Translation processor
echo "📦 Packaging translation-processor..."
rm dist/lambda-temp/index.js
cp dist/lambda/translation-processor.js dist/lambda-temp/index.js
cd dist/lambda-temp
zip -q -r ../packages/translation-processor.zip index.js node_modules
cd ../..

# Package Image Extraction processor
echo "📦 Packaging image-extraction-processor..."
rm dist/lambda-temp/index.js
cp dist/lambda/image-extraction-processor.js dist/lambda-temp/index.js
cd dist/lambda-temp
zip -q -r ../packages/image-extraction-processor.zip index.js node_modules
cd ../..

# Cleanup
rm -rf dist/lambda-temp

echo "✅ Lambda packages created with dependencies:"
echo "  - dist/packages/ocr-processor.zip"
echo "  - dist/packages/translation-processor.zip"
echo "  - dist/packages/image-extraction-processor.zip"
echo ""
echo "Upload these to AWS Lambda console or use AWS CLI:"
echo "  aws lambda update-function-code --function-name sourcelibrary-ocr-processor --zip-file fileb://dist/packages/ocr-processor.zip"
echo "  aws lambda update-function-code --function-name sourcelibrary-translation-processor --zip-file fileb://dist/packages/translation-processor.zip"
echo "  aws lambda update-function-code --function-name sourcelibrary-image-extraction-processor --zip-file fileb://dist/packages/image-extraction-processor.zip"
