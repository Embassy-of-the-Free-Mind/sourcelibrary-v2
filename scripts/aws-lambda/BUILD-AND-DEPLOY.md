# Building and Deploying Lambda Functions

## Quick Start

1. In terminal run: `npm run lambda:prepare`
2. Three packages are built:
    - `dist/packages/ocr-processor.zip`
    - `dist/packages/translation-processor.zip`
    - `dist/packages/image-extraction-processor.zip`

## Deployment Options

### Automated Deployment (AWS CLI)

**Prerequisites:**

#### 1. Install AWS CLI (if not already installed)

Check if AWS CLI is installed:
```bash
aws --version
```

If not installed, install it:

**macOS (via Homebrew):**
```bash
brew install awscli
```

**macOS (Official Installer):**
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

**Linux:**
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

**Windows:**
Download and run the installer from: https://awscli.amazonaws.com/AWSCLIV2.msi

#### 2. Configure AWS Credentials

Add your AWS credentials to `.env.local` (recommended):
```bash
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=eu-central-1
```

The deployment script will automatically load credentials from `.env.local` or `.env`.

Alternatively, export them in your shell:
```bash
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_REGION=eu-central-1
```

#### Option 1: Deploy All Functions

Deploy all three Lambda functions at once:

```bash
npm run lambda:deploy:all
```

Or manually:
```bash
./scripts/aws-lambda/deploy-lambda.sh --all
```

#### Option 2: Deploy Single Function

Deploy only one specific function:

```bash
npm run lambda:deploy -- ocr-processor
# or
npm run lambda:deploy -- translation-processor
# or
npm run lambda:deploy -- image-extraction-processor
```

Direct script call:
```bash
./scripts/aws-lambda/deploy-lambda.sh ocr-processor
```

#### Option 3: Deploy Multiple Functions

Deploy any combination of functions in a single command:

```bash
# Deploy OCR and Translation processors only
npm run lambda:deploy -- ocr-processor translation-processor

# Deploy Translation and Image Extraction processors
npm run lambda:deploy -- translation-processor image-extraction-processor

# Deploy OCR and Image Extraction processors
npm run lambda:deploy -- ocr-processor image-extraction-processor
```

Direct script call:
```bash
./scripts/aws-lambda/deploy-lambda.sh ocr-processor translation-processor
```

#### Option 4: Full Workflow (Build + Package + Deploy)

Build, package, and deploy all functions in one command:

```bash
npm run lambda:full
```

This runs:
1. `lambda:build` - Compiles TypeScript to bundled JS
2. `lambda:package` - Creates zip files with dependencies
3. `lambda:deploy:all` - Uploads all three to AWS

**Note:** Old files in `dist/lambda` and `dist/packages` are automatically cleaned during build and package steps.

#### Deployment Output

The deployment script will:
- ✅ Validate AWS credentials
- ✅ Check zip files exist in `dist/packages/`
- ✅ Verify Lambda functions exist in AWS
- ✅ Upload each package with progress timestamps
- ✅ Report deployment status (code size, last modified timestamp)

### Manual Deployment (AWS Console)

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