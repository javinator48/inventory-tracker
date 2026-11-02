#!/usr/bin/env bash
# Builds the demo image with Cloud Build and deploys it to Cloud Run.
# Usage: scripts/deploy-demo.sh <gcp-project-id> [region]
# One-time setup (APIs, secrets) is in docs/demo-deploy.md.
set -euo pipefail
PROJECT=${1:?usage: scripts/deploy-demo.sh <gcp-project-id> [region]}
REGION=${2:-us-central1}
cd "$(dirname "$0")/.."

gcloud run deploy inventory-demo \
  --project "$PROJECT" --region "$REGION" --source . \
  --allow-unauthenticated \
  --max-instances 1 --min-instances 0 \
  --memory 1Gi --cpu 1 --concurrency 40 --timeout 300 \
  --set-secrets "ANTHROPIC_API_KEY=demo-anthropic-key:latest,GEMINI_API_KEY=demo-gemini-key:latest"
