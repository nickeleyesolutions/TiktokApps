#!/usr/bin/env bash
# Run in Google Cloud Shell (console > Activate Cloud Shell), signed in with
# your Google account. Creates the VM. Nothing here needs a password or key.
#   bash cloudshell-create.sh                # 8 vCPU (1080p)
#   TYPE=e2-standard-4 bash cloudshell-create.sh   # 4 vCPU (720p)
set -euo pipefail
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null)}
ZONE=${ZONE:-us-central1-a}
TYPE=${TYPE:-e2-standard-8}
[ -n "$PROJECT" ] || { echo "No project selected: run  gcloud config set project YOUR_PROJECT_ID"; exit 1; }
echo "Project $PROJECT, zone $ZONE, machine $TYPE"
gcloud services enable compute.googleapis.com --project "$PROJECT"
gcloud compute instances describe arena --zone "$ZONE" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud compute instances create arena --project "$PROJECT" --zone "$ZONE" --machine-type "$TYPE" \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud --boot-disk-size 30GB --labels app=arcade-arena
echo
echo "VM ready. Next, open a terminal on it:"
echo "  gcloud compute ssh arena --zone $ZONE"
