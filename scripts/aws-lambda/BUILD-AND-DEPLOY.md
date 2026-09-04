# Building and Deploying Lambda Functions

> **Merging a PR does NOT deploy these functions.** A merge ships the Vercel side only. The
> Lambdas are hand-deployed, so deployed code and `main` drift silently — and a diagnosis made by
> reading `src/workers/` is then wrong in a way that reads exactly like being right. Before
> trusting worker source, run `node --env-file=.env.production.local scripts/audit/lambda-drift.mjs`
> (see [Verifying what is actually deployed](#verifying-what-is-actually-deployed)).

## Quick Start

1. In terminal run: `npm run lambda:prepare`
2. **Four** packages are built — one per worker:
    - `dist/packages/ocr-processor.zip` → `sourcelibrary-ocr-processor`
    - `dist/packages/translation-processor.zip` → `sourcelibrary-translation-processor`
    - `dist/packages/image-extraction-processor.zip` → `sourcelibrary-image-extraction-processor`
    - `dist/packages/write-processor.zip` → **`sourcelibrary-db-write-processor`**

**The last mapping is not uniform** — the entry point is `write-processor`, the deployed function
is `db-write-processor`. `--all` covers all four; a doc that said "three" is how the write
processor gets forgotten.

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

## Verifying what is actually deployed

`LastModified` tells you when someone last uploaded. It never tells you **what** they uploaded.
The only honest check is comparing bytes:

```bash
# from the MAIN checkout, not a worktree
node --env-file=.env.production.local scripts/audit/lambda-drift.mjs
```

It rebuilds each worker with the same esbuild invocation the deploy uses, downloads the deployed
zip via `aws lambda get-function`, and compares `index.js` byte-for-byte. Exit 0 = all current,
1 = drift, 2 = could not check.

**Run it from the main checkout.** esbuild embeds each module's resolved path in a comment, and a
worktree has no local `node_modules` — so it resolves `../../../node_modules/...` and every
comparison reports drift that is not real. The script refuses to run from a worktree for this
reason.

Found this way on 2026-09-04: `db-write` was one commit stale, missing #4523's
`{ $ne: ["$ocr.unreadable", true] }`, so it counted attempted-but-unreadable pages as OCR'd.
Nothing was failing — the number was just wrong. That is the failure mode this check exists for.

### What the IAM user can and cannot do

The `sourcelibrary` IAM user (credentials in the app environment) has `lambda:GetFunction`,
`lambda:GetFunctionConfiguration` and `lambda:UpdateFunctionCode`, all **scoped to the four
`sourcelibrary-*-processor` functions**. It does **not** have `lambda:ListFunctions` or
`lambda:UpdateFunctionConfiguration` — so you can replace a worker's **code** but cannot change an
**environment variable**. Env changes need the AWS console or an admin.

**Two traps when deploying:**

- **A "timed out" upload may have succeeded.** The CLI can exceed a 2-minute foreground timeout
  after the upload has landed. Always re-read `aws lambda get-function-configuration` and check
  `CodeSha256` before retrying — never assume the failure meant nothing shipped.
- **`get-function` and `get-function-configuration` print `Environment.Variables` in plaintext** —
  `MONGODB_URI` and `GEMINI_API_KEY` among them. Do not redirect those responses into a file you
  leave lying around, and do not paste them into an issue. (This also means the AWS key can read
  Gemini keys that Vercel's `sensitive` flag withholds.)

## Architecture

Each Lambda function processes **one page** per invocation:
- **OCR Processor**: Reads page image, performs OCR, saves to MongoDB
- **Translation Processor**: Translates OCR text with context from previous page
- **Image Extraction Processor**: Detects and extracts illustrations
- **Write Processor** (`db-write`): consumes the write-results SQS queue and applies the results
  to MongoDB. It holds no Gemini key — it is the only one of the four that spends nothing.

All processors:
- Update job progress directly in MongoDB
- Check for job cancellation before processing
- Mark job complete when all pages are done