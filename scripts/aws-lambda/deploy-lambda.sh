#!/bin/bash

# Deploy Lambda functions to AWS
# Usage:
#   ./deploy-lambda.sh --all                                    # Deploy all functions
#   ./deploy-lambda.sh ocr-processor                            # Deploy single function
#   ./deploy-lambda.sh ocr-processor translation-processor      # Deploy multiple functions

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Timestamp helper
timestamp() {
  date +"%H:%M:%S"
}

# Log functions
log_info() {
  echo -e "${BLUE}[$(timestamp)]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[$(timestamp)]${NC} ✅ $1"
}

log_error() {
  echo -e "${RED}[$(timestamp)]${NC} ❌ $1"
}

log_warning() {
  echo -e "${YELLOW}[$(timestamp)]${NC} ⚠️  $1"
}

# Load environment variables from .env files
load_env_file() {
  local env_file=$1
  if [ -f "$env_file" ]; then
    log_info "Loading environment from $env_file"
    # Read .env file line by line, skip comments and empty lines
    while IFS= read -r line || [ -n "$line" ]; do
      # Skip comments and empty lines
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      
      # Only export AWS, MongoDB, Gemini, Blob, and SQS variables
      if [[ "$line" =~ ^(AWS_|MONGODB_|GEMINI_|BLOB_|SQS_) ]]; then
        # Remove leading/trailing whitespace and export
        line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        export "$line"
      fi
    done < "$env_file"
  fi
}

# Try loading .env.local first, then .env
if [ -f ".env.local" ]; then
  load_env_file ".env.local"
elif [ -f ".env" ]; then
  load_env_file ".env"
fi

# Get Lambda function name from processor name
get_lambda_name() {
  case "$1" in
    "ocr-processor")
      echo "sourcelibrary-ocr-processor"
      ;;
    "translation-processor")
      echo "sourcelibrary-translation-processor"
      ;;
    "image-extraction-processor")
      echo "sourcelibrary-image-extraction-processor"
      ;;
    "write-processor")
      echo "sourcelibrary-db-write-processor"
      ;;
    *)
      echo ""
      ;;
  esac
}

# Available functions
AVAILABLE_FUNCTIONS=("ocr-processor" "translation-processor" "image-extraction-processor" "write-processor")

# Default AWS region
AWS_REGION="${AWS_REGION:-eu-central-1}"

# Parse arguments
FUNCTIONS_TO_DEPLOY=()

if [ $# -eq 0 ]; then
  log_error "No arguments provided"
  echo ""
  echo "Usage:"
  echo "  $0 --all                                    # Deploy all functions"
  echo "  $0 ocr-processor                            # Deploy single function"
  echo "  $0 ocr-processor translation-processor      # Deploy multiple functions"
  echo ""
  echo "Available functions:"
  for func in "${AVAILABLE_FUNCTIONS[@]}"; do
    echo "  - $func"
  done
  exit 1
fi

if [ "$1" == "--all" ]; then
  FUNCTIONS_TO_DEPLOY=("${AVAILABLE_FUNCTIONS[@]}")
else
  for arg in "$@"; do
    LAMBDA_NAME=$(get_lambda_name "$arg")
    if [ -z "$LAMBDA_NAME" ]; then
      log_error "Unknown function: $arg"
      echo "Available functions: ${AVAILABLE_FUNCTIONS[*]}"
      exit 1
    fi
    FUNCTIONS_TO_DEPLOY+=("$arg")
  done
fi

log_info "Deploying ${#FUNCTIONS_TO_DEPLOY[@]} Lambda function(s) to region: $AWS_REGION"
echo ""

# Validation: Check AWS credentials
log_info "Validating AWS credentials..."
if ! aws sts get-caller-identity --region "$AWS_REGION" > /dev/null 2>&1; then
  log_error "AWS credentials not configured or invalid"
  echo "Please configure AWS credentials using:"
  echo "  export AWS_ACCESS_KEY_ID=your-key"
  echo "  export AWS_SECRET_ACCESS_KEY=your-secret"
  echo "  export AWS_REGION=$AWS_REGION"
  exit 1
fi

CALLER_IDENTITY=$(aws sts get-caller-identity --region "$AWS_REGION" --output json)
ACCOUNT_ID=$(echo "$CALLER_IDENTITY" | grep -o '"Account": "[^"]*' | sed 's/"Account": "//')
USER_ARN=$(echo "$CALLER_IDENTITY" | grep -o '"Arn": "[^"]*' | sed 's/"Arn": "//')
log_success "Authenticated as: $USER_ARN"
echo ""

# Validation: Check zip files exist
DIST_DIR="dist/packages"
log_info "Checking deployment packages in $DIST_DIR..."

VALIDATION_FAILED=0
for func in "${FUNCTIONS_TO_DEPLOY[@]}"; do
  ZIP_FILE="$DIST_DIR/${func}.zip"
  if [ ! -f "$ZIP_FILE" ]; then
    log_error "Zip file not found: $ZIP_FILE"
    VALIDATION_FAILED=1
  else
    ZIP_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
    log_success "Found $func.zip ($ZIP_SIZE)"
  fi
done

if [ $VALIDATION_FAILED -eq 1 ]; then
  echo ""
  log_error "Missing deployment packages. Run: npm run lambda:prepare"
  exit 1
fi
echo ""

# Validation: Check Lambda functions exist in AWS
log_info "Verifying Lambda functions exist in AWS..."

for func in "${FUNCTIONS_TO_DEPLOY[@]}"; do
  LAMBDA_NAME=$(get_lambda_name "$func")
  if ! aws lambda get-function --function-name "$LAMBDA_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
    log_error "Lambda function not found: $LAMBDA_NAME"
    VALIDATION_FAILED=1
  else
    log_success "Verified: $LAMBDA_NAME"
  fi
done

if [ $VALIDATION_FAILED -eq 1 ]; then
  echo ""
  log_error "Some Lambda functions don't exist in AWS"
  exit 1
fi
echo ""

# Deploy each function
log_info "Starting deployment..."
echo ""

DEPLOY_SUCCESS=0
DEPLOY_FAILED=0

for func in "${FUNCTIONS_TO_DEPLOY[@]}"; do
  LAMBDA_NAME=$(get_lambda_name "$func")
  ZIP_FILE="$DIST_DIR/${func}.zip"
  ZIP_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
  
  log_info "Uploading $func.zip ($ZIP_SIZE) to $LAMBDA_NAME..."
  
  if RESPONSE=$(aws lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --region "$AWS_REGION" \
    --output json 2>&1); then
    
    # Parse response to get LastModified and CodeSize
    LAST_MODIFIED=$(echo "$RESPONSE" | grep -o '"LastModified": "[^"]*' | sed 's/"LastModified": "//')
    CODE_SIZE=$(echo "$RESPONSE" | grep -o '"CodeSize": [0-9]*' | sed 's/"CodeSize": //')
    CODE_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $CODE_SIZE/1024/1024}")
    
    log_success "Deployed $LAMBDA_NAME (${CODE_SIZE_MB}MB, updated: $LAST_MODIFIED)"
    ((DEPLOY_SUCCESS++))
  else
    log_error "Failed to deploy $LAMBDA_NAME"
    echo "$RESPONSE"
    ((DEPLOY_FAILED++))
  fi
  echo ""
done

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $DEPLOY_FAILED -eq 0 ]; then
  log_success "Deployment complete! $DEPLOY_SUCCESS function(s) deployed successfully"
  exit 0
else
  log_error "Deployment completed with errors: $DEPLOY_SUCCESS succeeded, $DEPLOY_FAILED failed"
  exit 1
fi
