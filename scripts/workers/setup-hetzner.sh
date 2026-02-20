#!/bin/bash
#
# Setup script for Source Library pipeline workers on Hetzner
#
# This script:
#   1. Creates log directories with rotation
#   2. Installs crontab entries
#   3. Documents required environment variables
#
# Usage:
#   bash scripts/workers/setup-hetzner.sh
#
# Prerequisites:
#   - Node.js 20+ installed
#   - MongoDB URI accessible from this server
#   - .env.production.local with all required env vars
#   - git clone of sourcelibrary at /opt/sourcelibrary (or modify INSTALL_DIR)
#

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/sourcelibrary}"
LOG_DIR="/var/log/sourcelibrary"
ENV_FILE="${INSTALL_DIR}/.env.production.local"

echo "=== Source Library Worker Setup ==="
echo "Install dir: ${INSTALL_DIR}"
echo "Log dir: ${LOG_DIR}"
echo ""

# ── Check prerequisites ──

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Install Node.js 20+."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "ERROR: Node.js 20+ required (found v${NODE_VERSION})"
    exit 1
fi

if [ ! -d "$INSTALL_DIR" ]; then
    echo "ERROR: ${INSTALL_DIR} does not exist."
    echo "Clone the repo: git clone <repo-url> ${INSTALL_DIR}"
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: ${ENV_FILE} not found."
    echo ""
    echo "Required environment variables:"
    echo "  MONGODB_URI          - MongoDB Atlas connection string"
    echo "  CRON_SECRET          - Auth token for internal API calls"
    echo "  NEXT_PUBLIC_URL      - Production URL (https://sourcelibrary.org)"
    echo "  GEMINI_API_KEY       - Primary Gemini API key"
    echo "  GEMINI_API_KEY_2     - Secondary Gemini API key (batch)"
    echo "  GEMINI_API_KEY_TIER3 - Tier 3 Gemini API key (no rate limits)"
    echo ""
    echo "Copy from your local .env.production.local or generate from Vercel:"
    echo "  vercel env pull .env.production.local"
    exit 1
fi

# ── Create log directory ──

echo "Creating log directory..."
sudo mkdir -p "$LOG_DIR"
sudo chown "$(whoami)" "$LOG_DIR"

# ── Install npm dependencies ──

echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --production 2>/dev/null || npm install

# ── Setup log rotation ──

echo "Setting up log rotation..."
sudo tee /etc/logrotate.d/sourcelibrary > /dev/null <<LOGROTATE
${LOG_DIR}/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 644 $(whoami) $(whoami)
}
LOGROTATE

# ── Install crontab ──

echo "Installing crontab entries..."

# Backup existing crontab
crontab -l > /tmp/crontab_backup_$(date +%Y%m%d) 2>/dev/null || true

# Remove old sourcelibrary entries if any
(crontab -l 2>/dev/null || true) | grep -v 'sourcelibrary' | grep -v '^#.*Source Library' > /tmp/crontab_clean || true

# Add new entries
cat >> /tmp/crontab_clean <<CRON

# Source Library Pipeline Workers (installed $(date +%Y-%m-%d))
# Batch collector: collect Gemini Batch API results every 10 minutes
*/10 * * * * cd ${INSTALL_DIR} && flock -n /tmp/sl-collector.lock bash -c 'set -a; source .env.production.local; set +a; node scripts/workers/batch-collector.mjs' >> ${LOG_DIR}/collector.log 2>&1

# Pipeline orchestrator: advance books through pipeline every 5 minutes
*/5 * * * * cd ${INSTALL_DIR} && flock -n /tmp/sl-pipeline.lock bash -c 'set -a; source .env.production.local; set +a; node scripts/workers/pipeline-orchestrator.mjs' >> ${LOG_DIR}/pipeline.log 2>&1

# Sync worker: refresh page counts and gallery images every 2 hours
0 */2 * * * cd ${INSTALL_DIR} && flock -n /tmp/sl-sync.lock bash -c 'set -a; source .env.production.local; set +a; node scripts/workers/sync-worker.mjs' >> ${LOG_DIR}/sync.log 2>&1
CRON

crontab /tmp/crontab_clean
rm /tmp/crontab_clean

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Workers installed:"
echo "  */5  min  - pipeline-orchestrator.mjs  -> ${LOG_DIR}/pipeline.log"
echo "  */10 min  - batch-collector.mjs        -> ${LOG_DIR}/collector.log"
echo "  every 2h  - sync-worker.mjs            -> ${LOG_DIR}/sync.log"
echo ""
echo "Monitoring:"
echo "  tail -f ${LOG_DIR}/pipeline.log"
echo "  tail -f ${LOG_DIR}/collector.log"
echo "  tail -f ${LOG_DIR}/sync.log"
echo ""
echo "Verify crontab:"
echo "  crontab -l"
echo ""
echo "IMPORTANT: Run both Vercel crons and local workers in parallel for 24h"
echo "before disabling Vercel crons. Check for duplicate processing."
echo ""
echo "To disable Vercel crons after verification:"
echo "  Remove process-batches, post-import-pipeline, submit-ocr,"
echo "  submit-batch-ocr, sync-page-counts, sync-gallery-images"
echo "  from vercel.json and redeploy."
