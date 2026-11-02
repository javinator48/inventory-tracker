# Public demo on Google Cloud Run

The demo is the same app built with `DEMO_MODE=1`:

- **Fictional data:** 43 items from `demo/items.json`, with CC0 / public-domain photos from Wikimedia Commons (`demo/uploads/demo/`, credits in `demo/images.json`). `scripts/fetch-demo-images.py` refetches the photos, and `scripts/build-demo.mjs` builds `demo/inventory.db`. The Docker build runs the second one.
- **A private sandbox per visitor:** a cookie picks a copy of the demo database. Each copy is deleted after a day idle, or when there are more than 150 copies (`lib/db.ts`). Visitors can't see each other's changes, chats or try-on photos.
- **No password, but daily caps:** per visitor (cookie and IP) and across all visitors: 30 / 600 AI requests, 3 / 40 try-on images, and 40 / 1500 photo uploads (`lib/demo-shared.ts`). The counters are in memory, so the service must run as a single instance (`--max-instances 1`).
- **Its own API keys,** stored in Secret Manager. Your personal `.env.local` and `data/` are never uploaded (`.gcloudignore`, `.dockerignore`).

## One-time setup

1. **Project and billing.** Create a project at https://console.cloud.google.com/projectcreate, then link a billing account at https://console.cloud.google.com/billing/linkedaccount.
2. **Budget alert.** Add one at https://console.cloud.google.com/billing/budgets (e.g. $10/month, with emails at 50/90/100%).
3. **Enable the APIs:**
   ```
   gcloud config set project PROJECT_ID
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
   ```
4. **Demo API keys.** Keep these separate from your personal ones:
   - **Claude:** create a workspace called "demo" at https://console.anthropic.com/settings/workspaces, give it a monthly spend limit, and create a key in it.
   - **Gemini:** create a key at https://aistudio.google.com/apikey in **this** GCP project, so it uses this project's billing. The image model has no free tier.
5. **Store the keys as secrets.** `read -s` keeps them out of shell history:
   ```
   read -s K && printf %s "$K" | gcloud secrets create demo-anthropic-key --data-file=-
   read -s K && printf %s "$K" | gcloud secrets create demo-gemini-key --data-file=-
   PN=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
   for s in demo-anthropic-key demo-gemini-key; do
     gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$PN-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
   done
   ```

## Deploy

```
scripts/deploy-demo.sh PROJECT_ID
```

The script prints the service URL. Run it again to ship new code; each deploy also resets every sandbox. To rotate a key, run `gcloud secrets versions add demo-anthropic-key --data-file=-` and redeploy.
