#!/bin/bash
set -e

echo "📦 Packaging Lambda functions with dependencies..."

# Ensure dist directory exists
if [ ! -d "dist/lambda" ]; then
  echo "❌ Error: dist/lambda directory not found. Run 'npm run lambda:build' first."
  exit 1
fi

# Create packages directory
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

# Package book processor
echo "📦 Packaging book-processor..."
cp dist/lambda/book-processor.js dist/lambda-temp/
cd dist/lambda-temp
zip -q -r book-processor.zip book-processor.js node_modules
mv book-processor.zip ../packages/
cd ../..

# Package OCR processor
echo "📦 Packaging ocr-processor..."
rm dist/lambda-temp/book-processor.js
cp dist/lambda/ocr-processor.js dist/lambda-temp/
cd dist/lambda-temp
zip -q -r ocr-processor.zip ocr-processor.js node_modules
mv ocr-processor.zip ../packages/
cd ../..

# Cleanup
rm -rf dist/lambda-temp

echo "✅ Lambda packages created with dependencies:"
echo "  - dist/packages/book-processor.zip"
echo "  - dist/packages/ocr-processor.zip"
echo ""
echo "Upload these to AWS Lambda console or use AWS CLI:"
echo "  aws lambda update-function-code --function-name sourcelibrary-book-processor --zip-file fileb://dist/packages/book-processor.zip"
echo "  aws lambda update-function-code --function-name sourcelibrary-ocr-processor --zip-file fileb://dist/packages/ocr-processor.zip"
